/**
 * Usage savings for project threads (docs/prd/usage-savings.md). Pure helpers; the orchestrator
 * (src/main/orchestrator.ts) and the automatic updates (src/main/index.ts) use them when
 * Settings.usageSavings is on, which it is unless turned off.
 */

/** Added to a task the orchestrator starts, so the workspace ends with something short to hand back. */
export const HANDOFF_REPORT = [
  'When you finish, end your last message with a short handoff report for the orchestrator that started you (under 200 words):',
  '- Status: done, blocked or needs a decision.',
  '- What changed, and the pull request link if there is one.',
  '- Tests and checks you ran, and their results.',
  '- Anything left, and questions for the person.'
].join('\n')

export function withHandoffReport(task: string): string {
  return `${task.trimEnd()}\n\n${HANDOFF_REPORT}`
}

/** A short, stable hash of the memory text (FNV-1a), to tell whether a session already has this version. */
export function memoryHash(memory: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < memory.length; i++) {
    h ^= memory.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16)}:${memory.length}`
}

/**
 * The memory block for the start of a turn, or nothing when the session already has this version.
 * A new session (no resume) always gets it. Keeping memory out of the system prompt means one
 * thread saving memory no longer changes every other thread's prompt, which would make each of
 * them rebuild its prompt cache on its next turn.
 */
export function memoryTurnPrefix(o: { memory: string; path: string; lastHash?: string; newSession: boolean }): { prefix?: string; hash: string } {
  const hash = memoryHash(o.memory)
  if (!o.newSession && o.lastHash === hash) return { hash }
  const body = o.memory.trim() || '(empty)'
  return {
    hash,
    prefix: [
      `<project-memory path="${o.path}">`,
      'Choo Choo attaches the current memory file here because it changed or this conversation is new. It replaces any earlier copy. It is not part of the message below.',
      '',
      body,
      '</project-memory>'
    ].join('\n')
  }
}

/** How long a finished workspace's update may wait for the rest of its batch. */
export const MAX_BATCH_WAIT_MS = 20 * 60_000

/**
 * Whether to hold an automatic update until the other workspaces reporting to the same chat finish.
 * Never holds an error, and never longer than MAX_BATCH_WAIT_MS after the first one finished.
 */
export function holdUpdate(o: { finished: { state: 'finished' | 'error'; at: number }[]; othersRunning: number; now: number }): { hold: false } | { hold: true; recheckInMs: number } {
  if (!o.finished.length || !o.othersRunning) return { hold: false }
  if (o.finished.some((f) => f.state === 'error')) return { hold: false }
  const first = Math.min(...o.finished.map((f) => f.at))
  const left = first + MAX_BATCH_WAIT_MS - o.now
  if (left <= 0) return { hold: false }
  return { hold: true, recheckInMs: left }
}

