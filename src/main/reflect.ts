import type { Repo, Workspace } from '@shared/types'
import { REFLECT_PROMPT, condenseTranscript, parseReflectResult, type ReflectProposal, type ReflectResult } from '@shared/reflect'
import * as store from './store'
import * as git from './git'
import { claudeExecutable } from './claudeBinary'

const running = new Map<string, AbortController>()

export function cancel(wsId: string) {
  running.get(wsId)?.abort()
}

/** The file as it is on the default branch, which is where the follow-up PR starts. */
async function readAtRef(repo: Repo, ref: string, file: string): Promise<string | null> {
  try {
    return await git.git(repo.path, ['show', `${ref}:${file}`])
  } catch {
    return null
  }
}

/**
 * Has an agent read the workspace's chats and the repo's agent setup, and suggest changes
 * that would have avoided the friction. Read-only: nothing is written here.
 */
export async function reflect(ws: Workspace, repo: Repo, env: Record<string, string>, model: string): Promise<ReflectResult> {
  if (running.has(ws.id)) throw new Error('Already reflecting on this workspace')
  const chats = store
    .get()
    .chats.filter((c) => c.workspaceId === ws.id)
    .map((c) => ({ title: c.title, items: store.chatItems(c.id) }))
  const transcript = condenseTranscript(chats)
  if (!transcript.trim()) return { summary: 'This workspace has no conversation to reflect on.', proposals: [] }

  const abort = new AbortController()
  running.set(ws.id, abort)
  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')
    const q = query({
      prompt: `${REFLECT_PROMPT}\n\nThe repo is checked out in the current directory.\n\n<session>\n${transcript}\n</session>`,
      options: {
        pathToClaudeCodeExecutable: claudeExecutable(),
        cwd: ws.path,
        model,
        effort: 'high',
        maxTurns: 40,
        tools: ['Read', 'Glob', 'Grep'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // No project hooks or settings: this agent only reads.
        settingSources: [],
        persistSession: false,
        abortController: abort,
        env: { ...process.env, ...env }
      } as never
    })
    let last = ''
    for await (const m of q as AsyncIterable<any>) {
      if (m.type !== 'assistant') continue
      const text = (m.message?.content ?? [])
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('')
      if (text) last = text
    }
    const result = parseReflectResult(last)
    if (!result) throw new Error('The reflect agent did not return any suggestions')
    const ref = await git.baseRefFor(repo.path, repo.defaultBranch)
    const out: ReflectProposal[] = []
    for (const p of result.proposals) {
      const before = await readAtRef(repo, ref, p.file)
      if (before === p.after) continue
      out.push({ ...p, before })
    }
    return { summary: result.summary, proposals: out }
  } finally {
    running.delete(ws.id)
  }
}

/** The message that asks the new workspace's agent to commit the accepted changes and open a PR. */
export function applyPrompt(source: Workspace, proposals: ReflectProposal[], baseBranch: string, branch: string): string {
  const list = proposals.map((p) => `- \`${p.file}\`: ${p.title}${p.why ? `. ${p.why}` : ''}`).join('\n')
  return [
    `These agent-setup changes came from reflecting on the merged workspace "${source.title}". I reviewed and accepted them, and they are already written to this worktree:`,
    '',
    list,
    '',
    'Do not change their content. Do this:',
    '1. Run `git status` and check that only these files changed.',
    '2. Commit them with a message like "Improve agent setup from session reflection".',
    `3. Push: \`git push -u origin ${branch}\`.`,
    `4. Open a PR against \`${baseBranch}\` with \`gh pr create\`. Title it "Improve agent setup", and list each change and why in the description.`,
    'Reply with the PR URL.'
  ].join('\n')
}
