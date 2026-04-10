import { resolve, dirname } from 'node:path'
import { Language, Parser } from 'web-tree-sitter'

let cached: Parser | undefined

async function getParser(): Promise<Parser> {
  if (cached) return cached

  // Resolve WASM paths from package.json locations (not main entry points)
  const treePath = resolve(dirname(require.resolve('web-tree-sitter/package.json')), 'web-tree-sitter.wasm')
  await Parser.init({ locateFile: () => treePath })

  const bashPath = resolve(dirname(require.resolve('tree-sitter-bash/package.json')), 'tree-sitter-bash.wasm')
  const lang = await Language.load(bashPath)
  cached = new Parser()
  cached.setLanguage(lang)
  return cached
}

/**
 * Extract executable command source texts from a bash script using tree-sitter.
 * Only `command` AST nodes are returned — variable assignments, declarations,
 * function/loop structure, and other non-executable syntax are skipped.
 * Mirrors the approach in opencode's built-in bash tool.
 */
export async function extractCommandNodes(script: string): Promise<string[]> {
  const parser = await getParser()
  const tree = parser.parse(script)
  if (!tree) return []
  return tree.rootNode
    .descendantsOfType('command')
    .map((node) => {
      const parent = node.parent
      return (parent?.type === 'redirected_statement' ? parent.text : node.text).trim()
    })
    .filter(Boolean)
}
