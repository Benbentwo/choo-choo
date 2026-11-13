import { describe, it, expect } from 'vitest'
import { DESKTOP_COMMAND, desktopArgs, desktopFailure } from '../src/main/desktop'

describe('open in Claude desktop', () => {
  it("resumes the chat's session with Claude Code's --desktop", () => {
    expect(desktopArgs({ sdkSessionId: '0b5c3d2e-1111-4222-8333-944445555666' })).toEqual(['--desktop', '--resume', '0b5c3d2e-1111-4222-8333-944445555666'])
    expect(() => desktopArgs({ sdkSessionId: undefined })).toThrow(/Send a message first/)
  })

  it('treats /desktop and /app as the handoff, nothing else', () => {
    expect(DESKTOP_COMMAND.test('/desktop')).toBe(true)
    expect(DESKTOP_COMMAND.test('/app ')).toBe(true)
    expect(DESKTOP_COMMAND.test('/Desktop')).toBe(true)
    expect(DESKTOP_COMMAND.test('/desktop please')).toBe(false)
    expect(DESKTOP_COMMAND.test('open /desktop')).toBe(false)
    expect(DESKTOP_COMMAND.test('/desktops')).toBe(false)
  })

  it("explains failures from Claude Code's output", () => {
    const missing = desktopFailure('\x1b[31mClaude Desktop is not installed. Install it from https://claude.ai/download\x1b[0m\r\n\r\n[exited with code 1]', 'darwin')
    expect(missing).toMatch(/^Couldn't open this chat in Claude desktop\./)
    expect(missing).toContain('Claude Desktop is not installed')
    expect(missing).not.toContain('exited with code')
    expect(missing).toMatch(/claude\.ai\/download, then try again/)
    expect(desktopFailure("error: unknown option '--desktop'", 'darwin')).toMatch(/too old/)
    expect(desktopFailure('--desktop requires signing in with a Claude account. Run `claude auth login` to sign in.', 'darwin')).toMatch(/\/login/)
    expect(desktopFailure("--desktop isn't available on this platform.", 'linux')).toMatch(/macOS and Windows/)
    expect(desktopFailure('', 'darwin')).toBe("Couldn't open this chat in Claude desktop.")
  })
})
