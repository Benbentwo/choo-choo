import { execFile } from 'node:child_process'

/** One row of `ps`: a process, its parent and its command line. */
export interface Proc {
  pid: number
  ppid: number
  command: string
}

/** Parses `ps -A -o pid=,ppid=,command=` output. */
export function parsePs(out: string): Proc[] {
  const list: Proc[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s?(.*)$/)
    if (m) list.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] ?? '' })
  }
  return list
}

/** Every process below `root` (children, grandchildren, ...), deepest last. `root` itself is not included. */
export function descendantsOf(list: Proc[], root: number): Proc[] {
  const kids = new Map<number, Proc[]>()
  for (const p of list) kids.set(p.ppid, [...(kids.get(p.ppid) ?? []), p])
  const out: Proc[] = []
  const seen = new Set<number>([root])
  const queue = [root]
  while (queue.length) {
    for (const p of kids.get(queue.shift()!) ?? []) {
      if (seen.has(p.pid)) continue
      seen.add(p.pid)
      out.push(p)
      queue.push(p.pid)
    }
  }
  return out
}

/** Lists the processes on this machine. Empty on Windows or if `ps` fails. */
export function listProcesses(): Promise<Proc[]> {
  if (process.platform === 'win32') return Promise.resolve([])
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'pid=,ppid=,command='], { maxBuffer: 16 * 1024 * 1024, timeout: 5000 }, (err, stdout) => resolve(err ? [] : parsePs(stdout)))
  })
}

/** The processes a turn's Claude Code process started, to clean up if stopping it leaves them behind. */
export async function snapshotTree(pid: number | undefined): Promise<Proc[]> {
  if (!pid) return []
  return descendantsOf(await listProcesses(), pid)
}

function signal(pid: number, sig: NodeJS.Signals) {
  try {
    process.kill(pid, sig)
    return true
  } catch {
    return false
  }
}

/**
 * Kills `root` and everything below it now. Children are found before the parent dies, because once
 * it is gone they belong to launchd and can't be traced back.
 */
export async function killTree(root: number | undefined, sig: NodeJS.Signals = 'SIGKILL'): Promise<number> {
  if (!root) return 0
  const below = await snapshotTree(root)
  let n = signal(root, sig) ? 1 : 0
  for (const p of below) if (signal(p.pid, sig)) n++
  return n
}

/**
 * Kills processes from an earlier snapshot that are still alive. A pid is only signalled if it still
 * runs the same command, so a pid the system has since reused for something else is left alone.
 */
export async function killLeftovers(snapshot: Proc[], sig: NodeJS.Signals = 'SIGKILL'): Promise<number> {
  if (!snapshot.length) return 0
  const now = new Map((await listProcesses()).map((p) => [p.pid, p.command]))
  let n = 0
  for (const p of snapshot) if (now.get(p.pid) === p.command && signal(p.pid, sig)) n++
  return n
}
