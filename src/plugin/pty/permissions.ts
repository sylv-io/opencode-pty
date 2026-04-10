import type { ToolContext } from '@opencode-ai/plugin'
import type { PluginClient } from '../types.ts'
import { allStructured } from './wildcard.ts'

type PermissionAction = 'allow' | 'ask' | 'deny'
type BashPermissions = PermissionAction | Record<string, PermissionAction>

interface PermissionConfig {
  bash?: BashPermissions
  external_directory?: PermissionAction
}

let _client: PluginClient | null = null
let _directory: string | null = null

export function initPermissions(client: PluginClient, directory: string): void {
  _client = client
  _directory = directory
}

async function getPermissionConfig(): Promise<PermissionConfig> {
  if (!_client) {
    return {}
  }
  try {
    const response = await _client.config.get()
    if (response.error || !response.data) {
      return {}
    }
    return (response.data as { permission?: PermissionConfig }).permission ?? {}
  } catch {
    return {}
  }
}

async function showToast(
  message: string,
  variant: 'info' | 'success' | 'error' = 'info'
): Promise<void> {
  if (!_client) return
  try {
    await _client.tui.showToast({ body: { message, variant } })
  } catch {
    // Ignore toast errors
  }
}

async function denyWithToast(msg: string, details?: string): Promise<never> {
  await showToast(msg, 'error')
  throw new Error(details ? `${msg} ${details}` : msg)
}

function formatCommandLine(command: string, args: string[]): string {
  return args.length > 0 ? `${command} ${args.join(' ')}` : command
}

/**
 * Check permissions for multiple commands in a single batch.
 * Fetches config once, evaluates each command against rules, and fires
 * at most one ctx.ask() for all commands that require user approval.
 */
export async function checkCommandPermissions(
  commands: Array<{ command: string; args: string[] }>,
  ctx: ToolContext
): Promise<void> {
  if (commands.length === 0) return
  const config = await getPermissionConfig()
  const bashPerms = config.bash

  if (!bashPerms) return

  const toAsk: string[] = []
  const always = new Set<string>()

  for (const { command, args } of commands) {
    const line = formatCommandLine(command, args)

    if (typeof bashPerms === 'string') {
      if (bashPerms === 'deny') {
        await denyWithToast('PTY denied: All bash commands are disabled by user configuration.')
      }
      if (bashPerms === 'ask') {
        toAsk.push(line)
        always.add(`${command} *`)
      }
      continue
    }

    const action = allStructured({ head: command, tail: args }, bashPerms)
    if (action === 'deny') {
      await denyWithToast(
        `PTY denied: Command "${line}" is explicitly denied by user configuration.`
      )
    }
    if (action === 'ask') {
      toAsk.push(line)
      always.add(`${command} *`)
    }
  }

  if (toAsk.length === 0) return
  await ctx.ask({
    permission: 'bash',
    patterns: toAsk,
    always: Array.from(always),
    metadata: {},
  })
}

/** Single-command convenience wrapper (used by pty_spawn). */
export async function checkCommandPermission(
  command: string,
  args: string[],
  ctx: ToolContext
): Promise<void> {
  await checkCommandPermissions([{ command, args }], ctx)
}

export async function checkWorkdirPermission(workdir: string, ctx: ToolContext): Promise<void> {
  if (!_directory) {
    return
  }

  const normalizedWorkdir = workdir.replace(/\/$/, '')
  const normalizedProject = _directory.replace(/\/$/, '')

  if (normalizedWorkdir.startsWith(normalizedProject)) {
    return
  }

  const config = await getPermissionConfig()
  const extDirPerm = config.external_directory

  if (extDirPerm === 'deny') {
    await denyWithToast(
      `PTY spawn denied: Working directory "${workdir}" is outside project directory "${_directory}". External directory access is denied by user configuration.`
    )
  }

  if (extDirPerm === 'ask') {
    await ctx.ask({
      permission: 'external_directory',
      patterns: [workdir],
      always: [`${workdir}/*`],
      metadata: { workdir },
    })
  }
}
