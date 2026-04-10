import { describe, it, expect } from 'bun:test'
import { extractCommandNodes } from '../src/plugin/pty/parser.ts'

describe('extractCommandNodes', () => {
  it('should extract simple commands', async () => {
    const commands = await extractCommandNodes('echo hello\nls -la')
    expect(commands).toContain('echo hello')
    expect(commands).toContain('ls -la')
    expect(commands).toHaveLength(2)
  })

  it('should skip variable assignments', async () => {
    const commands = await extractCommandNodes('FOO=bar\necho $FOO')
    expect(commands).toEqual(['echo $FOO'])
  })

  it('should skip export/declare declarations', async () => {
    const commands = await extractCommandNodes(
      'export PATH=/usr/bin\ndeclare -a arr\nlocal x=1\necho done'
    )
    expect(commands).toEqual(['echo done'])
  })

  it('should extract commands inside for loops', async () => {
    const script = `for i in 1 2 3; do
  echo $i
  ls /tmp
done`
    const commands = await extractCommandNodes(script)
    expect(commands).toContain('echo $i')
    expect(commands).toContain('ls /tmp')
    expect(commands).toHaveLength(2)
  })

  it('should extract commands inside if statements', async () => {
    const script = `if true; then
  echo yes
else
  echo no
fi`
    const commands = await extractCommandNodes(script)
    expect(commands).toContain('echo yes')
    expect(commands).toContain('echo no')
    // 'true' is also a command node
    expect(commands).toContain('true')
    expect(commands).toHaveLength(3)
  })

  it('should extract commands from function bodies', async () => {
    const script = `my_func() {
  echo "inside func"
  ls -la
}
echo "outside"`
    const commands = await extractCommandNodes(script)
    expect(commands).toContain('echo "inside func"')
    expect(commands).toContain('ls -la')
    expect(commands).toContain('echo "outside"')
    expect(commands).toHaveLength(3)
  })

  it('should skip shell structure fragments', async () => {
    const script = `PASS=0
FAIL=0
wait_ssh() {
    timeout 120 bash -c 'until ssh -o ConnectTimeout=5 localhost true; do sleep 3; done'
}
for CYCLE in 1 2 3; do
    echo "cycle $CYCLE"
    if [ "$CYCLE" = "1" ]; then
        echo "first"
    fi
done`
    const commands = await extractCommandNodes(script)
    // Should NOT contain: PASS=0, FAIL=0, }, local, for, if, fi, done
    for (const cmd of commands) {
      expect(cmd).not.toBe('}')
      expect(cmd).not.toBe('{')
      expect(cmd).not.toStartWith('PASS=')
      expect(cmd).not.toStartWith('FAIL=')
    }
    // Should contain the actual commands
    expect(commands).toContain('timeout 120 bash -c \'until ssh -o ConnectTimeout=5 localhost true; do sleep 3; done\'')
    expect(commands.some((c) => c.startsWith('echo'))).toBe(true)
  })

  it('should include redirections', async () => {
    const commands = await extractCommandNodes('echo test > output.txt')
    expect(commands).toEqual(['echo test > output.txt'])
  })

  it('should extract commands from pipelines', async () => {
    const commands = await extractCommandNodes('ls -la | grep foo | wc -l')
    expect(commands).toContain('ls -la')
    expect(commands).toContain('grep foo')
    expect(commands).toContain('wc -l')
  })

  it('should extract commands from && chains', async () => {
    const commands = await extractCommandNodes('mkdir foo && cd foo && echo done')
    expect(commands).toContain('mkdir foo')
    expect(commands).toContain('cd foo')
    expect(commands).toContain('echo done')
  })

  it('should return empty for control characters only', async () => {
    const commands = await extractCommandNodes('')
    expect(commands).toEqual([])
  })

  it('should handle the real-world VirtualBox test script', async () => {
    const script = `export VBOX_INSTALL_PATH=/home/user/virtualbox/out/linux.amd64/release/bin
VBOXM="$VBOX_INSTALL_PATH/VBoxManage"
G="sshpass -p secunet ssh -o StrictHostKeyChecking=no -p 2224 secunet@localhost"
VM=ubuntu-xhci-pt
PASS=0; FAIL=0
snapshot() {
    local label=$1
    local lsout size bd
    lsout=$($G lsusb 2>/dev/null | grep "30c9:00f5")
    $G "ffmpeg -i /dev/video0 -vframes 1 /tmp/cam.jpg -y" >/dev/null 2>&1
    echo "  capture done"
}
for CYCLE in 1 2 3; do
    echo "====== CYCLE $CYCLE ======"
    $VBOXM controlvm $VM savestate
    $VBOXM startvm $VM --type headless
    echo "done"
done
echo "SUMMARY"
`
    const commands = await extractCommandNodes(script)

    // Should NOT have variable assignments or shell structure
    for (const cmd of commands) {
      expect(cmd).not.toMatch(/^[A-Z_]+=/)
      expect(cmd).not.toBe('}')
      expect(cmd).not.toMatch(/^local /)
    }

    // Should have actual commands
    expect(commands.some((c) => c.includes('lsusb'))).toBe(true)
    expect(commands.some((c) => c.includes('grep'))).toBe(true)
    expect(commands.some((c) => c.includes('ffmpeg') || c.includes('$G'))).toBe(true)
    expect(commands.some((c) => c.includes('echo'))).toBe(true)
    expect(commands.some((c) => c.includes('controlvm') || c.includes('$VBOXM'))).toBe(true)
  })
})
