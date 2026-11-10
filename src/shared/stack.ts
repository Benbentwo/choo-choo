import type { PrComment, Stack, StackJob } from './types'
import { prCommentsPrompt } from './prComments'

/** Position of a branch in the stack, or -1. */
export function layerIndex(stack: Stack, branch: string): number {
  return stack.layers.findIndex((l) => l.branch === branch)
}

/** What a layer is built on: the branch below it, or the base for the bottom one. */
export function parentRef(stack: Stack, i: number, baseRef: string): string {
  return i === 0 ? baseRef : stack.layers[i - 1].branch
}

/** The branch a layer's PR should merge into: the branch below it, or the repo's default branch. */
export function prBaseFor(stack: Stack | undefined, branch: string, defaultBranch: string): string {
  if (!stack) return defaultBranch
  const i = layerIndex(stack, branch)
  return i > 0 ? stack.layers[i - 1].branch : defaultBranch
}

/** A name for a new branch on top: the bottom branch with the next free number, e.g. ben/export-3. */
export function nextLayerBranch(stack: Stack, taken: (name: string) => boolean): string {
  const root = stack.layers[0].branch.replace(/-\d+$/, '')
  for (let n = stack.layers.length + 1; ; n++) {
    const name = `${root}-${n}`
    if (!stack.layers.some((l) => l.branch === name) && !taken(name)) return name
  }
}

/** The branches to work through, bottom of the stack first, skipping any not in the stack. */
export function bottomFirst(stack: Stack, branches: string[]): string[] {
  return stack.layers.map((l) => l.branch).filter((b) => branches.includes(b))
}

/** Progress steps for addressing feedback: fix a PR, restack what's above it, then the next PR. */
export function feedbackSteps(stack: Stack, order: { branch: string; number: number; comments: number }[]): StackJob['steps'] {
  const steps: StackJob['steps'] = []
  for (const o of order) {
    steps.push({ label: `Fix ${o.comments} comment${o.comments === 1 ? '' : 's'} on #${o.number}`, state: 'todo' })
    if (layerIndex(stack, o.branch) < stack.layers.length - 1) steps.push({ label: `Restack the PRs above #${o.number}`, state: 'todo' })
  }
  return steps
}

/** Marks the first unfinished step as running, or done/failed. Returns a new array. */
export function advanceStep(steps: StackJob['steps'], to: 'doing' | 'done' | 'failed'): StackJob['steps'] {
  const out = steps.map((s) => ({ ...s }))
  const i = out.findIndex((s) => s.state === 'todo' || s.state === 'doing')
  if (i >= 0) out[i].state = to
  return out
}

/** The feedback message for one PR of a stack. Comment text stays fenced as data (see prComments). */
export function stackFeedbackPrompt(
  layer: { branch: string; index: number; total: number },
  pr: { number: number; url: string },
  comments: PrComment[],
  reply: boolean
): string {
  return [
    `You are on branch \`${layer.branch}\`, PR ${layer.index + 1} of ${layer.total} in a stack of PRs. Choo Choo keeps the rest of the stack in sync.`,
    `- Commit only to \`${layer.branch}\`. Don't switch branches, rebase, merge or push other branches: after this turn Choo Choo rebases the PRs above this one onto your commits and pushes them.`,
    `- Push this branch when you're done: \`git push origin ${layer.branch}\` (add \`--force-with-lease\` only if it was rebased).`,
    reply
      ? '- When you are done, reply on GitHub to each review thread you addressed with one line on what changed (`gh api` or `gh pr comment`), and resolve the threads you fixed.'
      : '- Don\'t reply on GitHub; just summarize here.',
    '',
    prCommentsPrompt(pr, comments)
  ].join('\n')
}

/** Hands a stopped rebase to the agent. */
export function restackConflictPrompt(branch: string, parent: string, files: string[]): string {
  return [
    `Restacking the PR on \`${branch}\` onto \`${parent}\` stopped on conflicts in:`,
    ...files.map((f) => `- \`${f}\``),
    '',
    'A rebase is in progress in this worktree. Resolve each conflict so both sides\' intent is kept, `git add` the files, then run `GIT_EDITOR=true git rebase --continue`. If more conflicts come up, repeat. Don\'t push and don\'t switch branches: when the rebase finishes, Choo Choo carries on restacking and pushes the PRs.',
    'If a conflict can\'t be resolved sensibly, run `git rebase --abort` and explain why.'
  ].join('\n')
}

/** The bottom layers whose PRs merged, which leave the stack when it is restacked onto the base. */
export function mergedBottom(states: ({ state: string } | null)[]): number {
  let n = 0
  while (n < states.length && states[n]?.state === 'MERGED') n++
  return n
}
