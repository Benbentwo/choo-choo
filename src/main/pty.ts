import type * as Pty from 'node-pty'
import { homedir } from 'node:os'

type Out = (id: string, data: string) => void
type Exit = (id: string, code: number) => void

const MAX_BUFFER = 256 * 1024

// Loaded lazily so a broken native build disables terminals instead of the whole app.
let ptyMod: typeof Pty | null = null
function loadPty(): typeof Pty {
  return (ptyMod ??= require('node-pty') as typeof Pty)
}

interface Term {
  proc: Pty.IPty | null
  buffer: string
  /** Script terminals keep their output after the process exits. */
  keepOnExit: boolean
}

const terms = new Map<string, Term>()

/**
 * Starts a shell (or `command` through the login shell) unless one is already alive under this id.
 * Returns the scrollback so a remounted view can replay it.
 */
export function create(
  id: string,
  cwd: string,
  env: Record<string, string>,
  onData: Out,
  onExit: Exit,
  command?: string,
  banner = ''
): string {
  const existing = terms.get(id)
  if (existing?.proc) return existing.buffer
  const shell = process.env.SHELL || '/bin/zsh'
  const t: Term = { proc: null, buffer: '', keepOnExit: !!command }
  const push = (d: string) => {
    t.buffer = (t.buffer + d).slice(-MAX_BUFFER)
    onData(id, d)
  }
  terms.set(id, t)
  if (banner) push(banner)
  try {
    t.proc = loadPty().spawn(shell, command ? ['-lc', command] : ['-l'], {
      name: 'xterm-256color',
      cols: 100,
      rows: 30,
      cwd: cwd || homedir(),
      env: { ...(process.env as Record<string, string>), ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
    })
  } catch (e) {
    push(`\x1b[31mTerminal unavailable: ${(e as Error).message}\x1b[0m\r\n`)
    return t.buffer
  }
  const proc = t.proc
  proc.onData(push)
  proc.onExit(({ exitCode }) => {
    if (terms.get(id) !== t) return // replaced by a newer process
    t.proc = null
    if (t.keepOnExit) push(`\r\n\x1b[2m[exited with code ${exitCode}]\x1b[0m\r\n`)
    else terms.delete(id)
    onExit(id, exitCode)
  })
  return banner ? t.buffer : ''
}

/** Scrollback for an existing terminal, without starting anything. */
export function attach(id: string): string {
  return terms.get(id)?.buffer ?? ''
}

export function write(id: string, data: string) {
  terms.get(id)?.proc?.write(data)
}

export function resize(id: string, cols: number, rows: number) {
  if (cols > 0 && rows > 0) terms.get(id)?.proc?.resize(cols, rows)
}

export function kill(id: string) {
  const t = terms.get(id)
  terms.delete(id)
  t?.proc?.kill()
}

export function isAlive(id: string) {
  return !!terms.get(id)?.proc
}

export function killPrefix(prefix: string) {
  for (const id of [...terms.keys()]) if (id.startsWith(prefix)) kill(id)
}

export function killAll() {
  for (const id of [...terms.keys()]) kill(id)
}
