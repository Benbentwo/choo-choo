import type * as Pty from 'node-pty'
import { homedir } from 'node:os'

type Out = (id: string, data: string) => void
type Exit = (id: string, code: number) => void

const MAX_BUFFER = 256 * 1024

// Loaded lazily so a broken native build disables terminals instead of the whole app.
let ptyMod: typeof Pty | null = null
function loadPty(): typeof Pty {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (ptyMod ??= require('node-pty') as typeof Pty)
}

interface Term {
  proc: Pty.IPty
  buffer: string
}

const terms = new Map<string, Term>()

/** Creates the terminal if needed and returns its scrollback so a remounted view can replay it. */
export function create(id: string, cwd: string, env: Record<string, string>, onData: Out, onExit: Exit): string {
  const existing = terms.get(id)
  if (existing) return existing.buffer
  const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/zsh')
  let proc: Pty.IPty
  try {
    proc = loadPty().spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: cwd || homedir(),
      env: { ...(process.env as Record<string, string>), ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    })
  } catch (e) {
    return `\x1b[31mTerminal unavailable: ${(e as Error).message}\x1b[0m\r\n`
  }
  const t: Term = { proc, buffer: '' }
  terms.set(id, t)
  proc.onData((d) => {
    t.buffer = (t.buffer + d).slice(-MAX_BUFFER)
    onData(id, d)
  })
  proc.onExit(({ exitCode }) => {
    terms.delete(id)
    onExit(id, exitCode)
  })
  return ''
}

export function write(id: string, data: string) {
  terms.get(id)?.proc.write(data)
}

export function resize(id: string, cols: number, rows: number) {
  if (cols > 0 && rows > 0) terms.get(id)?.proc.resize(cols, rows)
}

export function kill(id: string) {
  terms.get(id)?.proc.kill()
  terms.delete(id)
}

export function killPrefix(prefix: string) {
  for (const id of [...terms.keys()]) if (id.startsWith(prefix)) kill(id)
}

export function killAll() {
  for (const id of [...terms.keys()]) kill(id)
}
