/**
 * "Review plan": fresh reviewers read a plan with none of the chat that produced it.
 *
 * The idea and the reviewer roles are adapted from the Elephant-Goldfish Model
 * (https://github.com/google/elephant-goldfish-model), Apache License 2.0, Copyright Google LLC.
 * The agent that wrote the plan is the elephant: it knows everything said so far, so it stops
 * seeing what it never wrote down. Each reviewer here is a goldfish: it gets only the plan and
 * read access to the repo, so it catches unstated assumptions and gaps.
 * Changes from the original: condensed to three reviewers for a chat plan instead of a design doc,
 * and the output format matches the advisor's.
 */
import { parseAdvice, redactSecrets } from './extras'

export interface PlanReviewer {
  id: string
  label: string
  prompt: string
}

const COMMON = `You are a fresh reviewer. You have never seen the conversation that produced this plan. Read it as a new teammate would, and judge only what is written plus what you can verify in the repository.
You are read-only: use Read, Grep and Glob to check claims against the code. Never try to change anything.
Files the plan says it will create don't exist yet; that is expected, not a finding.

How to reply:
- If you find nothing that would make the plan fail or force the implementer to guess, reply with exactly SILENT and nothing else.
- Otherwise give at most 4 findings, one per line, each starting with [blocker] or [note]. A blocker would make the build wrong or stall it. Everything else is a note.
- Each finding names the plan step or file it is about, says what is wrong or missing, and what to do instead. One or two sentences.
- No praise, no summaries, no style nits.`

export const PLAN_REVIEWERS: PlanReviewer[] = [
  {
    id: 'design',
    label: 'Design',
    prompt: `${COMMON}

Your lens: design. You are a skeptical senior engineer. Stress-test the approach:
- Claims about how the system behaves that the plan doesn't back up, or that the code contradicts.
- Failure modes it ignores: errors, concurrency, partial failure, data loss, security.
- A simpler or more conventional approach the codebase already uses.`
  },
  {
    id: 'readiness',
    label: 'Readiness',
    prompt: `${COMMON}

Your lens: implementation readiness. You are the engineer who will write this code tomorrow. For each step ask: do I know exactly what to change, where, and how?
- Steps that are summaries ("update the service") instead of concrete changes (which file, which function, which field).
- Decisions left to the implementer: data shapes, API signatures, error handling, migrations of saved data.
- How the result will be checked: missing tests or verification steps.`
  },
  {
    id: 'codebase',
    label: 'Codebase',
    prompt: `${COMMON}

Your lens: fit with the codebase. You are a pedantic auditor. Check every file, function, type, setting and command the plan says exists today:
- References that don't exist, or that work differently from what the plan says. These are blockers.
- Callers, consumers or tests of the changed code that the plan forgets to update.
- Existing helpers the plan reinvents.`
  }
]

export interface ReviewerResult {
  reviewer: PlanReviewer
  notes: string[]
  blocker: boolean
  error?: string
}

/** One finding line per note, tagged with the reviewer's lens, e.g. "[blocker] Design: ...". */
export function combineFindings(results: ReviewerResult[]): { text: string; blocker: boolean; silent: boolean } {
  const lines: string[] = []
  for (const r of results) {
    for (const n of r.notes) {
      const m = n.match(/^\[(blocker|note)\]\s*/i)
      const tag = m ? `[${m[1].toLowerCase()}]` : '[note]'
      lines.push(`${tag} ${r.reviewer.label}: ${m ? n.slice(m[0].length) : n}`)
    }
  }
  const failed = results.filter((r) => r.error)
  if (!lines.length) {
    if (failed.length === results.length) return { text: `Plan review failed: ${failed[0]?.error ?? 'unknown error'}`, blocker: false, silent: true }
    const ok = results.length - failed.length
    return { text: `No concerns from ${ok} fresh reviewer${ok === 1 ? '' : 's'}${failed.length ? ` (${failed.map((f) => f.reviewer.label).join(', ')} failed)` : ''}`, blocker: false, silent: true }
  }
  if (failed.length) lines.push(`[note] ${failed.map((f) => f.reviewer.label).join(', ')} reviewer failed: ${failed[0].error}`)
  return { text: lines.join('\n'), blocker: results.some((r) => r.blocker), silent: false }
}

/** The message that sends the findings back to the planning agent. */
export function revisePlanMessage(findings: string[]): string {
  return `Fresh reviewers read your plan without seeing this conversation, and raised:\n\n${findings.join('\n')}\n\nSome of these may come from context that never made it into the plan. Revise the plan where they hold up, writing that context into the plan itself, and say briefly why for any you reject. Then present the revised plan.`
}

// The SDK is ESM-only; load it lazily from the CJS main bundle.
let sdk: Promise<typeof import('@anthropic-ai/claude-agent-sdk')> | null = null
const loadSdk = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'))

async function runReviewer(
  reviewer: PlanReviewer,
  plan: string,
  opts: { cwd: string; model: string; env: Record<string, string | undefined>; executable?: string; signal: AbortSignal }
): Promise<ReviewerResult> {
  try {
    const { query } = await loadSdk()
    const abort = new AbortController()
    opts.signal.addEventListener('abort', () => abort.abort(), { once: true })
    const q = query({
      prompt: `Here is a plan for changes to the repository in your working directory.\n\n<plan>\n${redactSecrets(plan)}\n</plan>\n\nReview it and reply as instructed.`,
      options: {
        pathToClaudeCodeExecutable: opts.executable,
        cwd: opts.cwd,
        model: opts.model,
        systemPrompt: reviewer.prompt,
        tools: ['Read', 'Grep', 'Glob'],
        allowedTools: ['Read', 'Grep', 'Glob'],
        permissionMode: 'dontAsk',
        maxTurns: 20,
        persistSession: false,
        // No CLAUDE.md, memory or plugins: the reviewer starts from the plan alone.
        settingSources: [],
        abortController: abort,
        env: opts.env
      } as never
    })
    let last = ''
    for await (const m of q as AsyncIterable<any>) {
      if (m.type === 'assistant') {
        const text = (m.message?.content ?? [])
          .filter((b: { type: string }) => b.type === 'text')
          .map((b: { text: string }) => b.text)
          .join('')
        if (text.trim()) last = text
      }
    }
    const advice = parseAdvice(last)
    return { reviewer, notes: advice.silent ? [] : advice.notes.slice(0, 4), blocker: advice.blocker }
  } catch (e) {
    return { reviewer, notes: [], blocker: false, error: opts.signal.aborted ? 'stopped' : (e as Error).message || String(e) }
  }
}

/** Runs every reviewer in parallel and combines their findings. */
export async function reviewPlan(
  plan: string,
  opts: { cwd: string; model: string; env: Record<string, string | undefined>; executable?: string; signal: AbortSignal }
) {
  const results = await Promise.all(PLAN_REVIEWERS.map((r) => runReviewer(r, plan, opts)))
  return combineFindings(results)
}
