import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as g from '../src/main/git'
import * as share from '../src/main/share'
import type { ChatItem } from '../src/shared/types'

describe('share links', () => {
  it('round-trips a link', () => {
    const link = share.shareLink('git@github.com:Benbentwo/choo-choo.git', 'abc123')
    expect(share.parseShareLink(link)).toEqual({ remote: 'git@github.com:Benbentwo/choo-choo.git', id: 'abc123' })
    expect(share.parseShareLink('https://example.com')).toBeNull()
    expect(share.parseShareLink('choo-choo://share?remote=x&id=../../etc')).toBeNull()
  })

  it('matches the same repo across URL styles', () => {
    const want = 'github.com/benbentwo/choo-choo'
    expect(share.normalizeRemote('git@github.com:Benbentwo/choo-choo.git')).toBe(want)
    expect(share.normalizeRemote('https://github.com/Benbentwo/choo-choo')).toBe(want)
    expect(share.normalizeRemote('https://user@github.com/Benbentwo/choo-choo.git/')).toBe(want)
    expect(share.normalizeRemote('ssh://git@github.com:22/Benbentwo/choo-choo.git')).toBe(want)
    expect(share.githubSlug('git@github.com:Benbentwo/choo-choo.git')).toBe('benbentwo/choo-choo')
    expect(share.githubSlug('git@gitlab.com:a/b.git')).toBeNull()
  })
})

describe('share contents', () => {
  it('redacts credentials', () => {
    const out = share.redact('key sk-ant-api03-abcdefghijklmnopqrstuv and ghp_abcdefghijklmnopqrstuvwxyz0123456789 and mysecretvalue', ['mysecretvalue'])
    expect(out).not.toContain('sk-ant-api03')
    expect(out).not.toContain('ghp_')
    expect(out).not.toContain('mysecretvalue')
    expect(out.match(/\[redacted\]/g)).toHaveLength(3)
  })

  it('drops local checkpoints and redacts tool output', () => {
    const items: ChatItem[] = [
      { id: '1', kind: 'user', text: 'hi', ts: 1, checkpoint: { head: 'a', tree: 'b' }, resumeAt: 'u' },
      { id: '2', kind: 'tool', name: 'Bash', input: { command: 'env' }, result: 'ANTHROPIC_API_KEY=sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzz', ts: 2 },
      { id: '3', kind: 'assistant', text: 'partial', streaming: true, ts: 3 }
    ]
    const out = share.shareableItems(items)
    expect(out).toHaveLength(2)
    expect(out[0]).not.toHaveProperty('checkpoint')
    expect(out[0]).not.toHaveProperty('resumeAt')
    expect((out[1] as { result: string }).result).toBe('ANTHROPIC_API_KEY=[redacted]')
  })

  it('builds handoff context from a transcript', () => {
    const ctx = share.handoffContext(
      [
        { id: '1', kind: 'user', text: 'Fix the bug', ts: 1 },
        { id: '2', kind: 'tool', name: 'Edit', input: { file_path: 'a.ts' }, result: 'ok', ts: 2 },
        { id: '3', kind: 'assistant', text: 'Done', ts: 3 }
      ],
      'Ben'
    )
    expect(ctx).toContain('Ben shared this conversation')
    expect(ctx).toContain('USER: Fix the bug')
    expect(ctx).toContain('TOOL Edit')
    expect(ctx).toContain('ASSISTANT: Done')
  })
})

async function repo(dir: string, ...args: string[]) {
  await g.git(dir, args)
}

describe('publishing and opening a share', () => {
  it('carries the branch, uncommitted work and chats to a coworker through the remote', async () => {
    const root = mkdtempSync(join(tmpdir(), 'share-'))
    const remote = join(root, 'remote.git')
    const mine = join(root, 'mine')
    const theirs = join(root, 'theirs')
    await g.git(root, ['init', '-q', '--bare', '-b', 'main', remote])
    await g.git(root, ['clone', '-q', remote, mine])
    for (const k of [['user.email', 'a@a'], ['user.name', 'Alice']]) await repo(mine, 'config', ...k)
    writeFileSync(join(mine, 'a.txt'), 'v1\n')
    writeFileSync(join(mine, 'gone.txt'), 'bye\n')
    await repo(mine, 'add', '.')
    await repo(mine, 'commit', '-qm', 'init')
    await repo(mine, 'push', '-q', 'origin', 'main')
    await repo(mine, 'checkout', '-qb', 'alice/feature')
    writeFileSync(join(mine, 'b.txt'), 'committed\n')
    await repo(mine, 'add', '.')
    await repo(mine, 'commit', '-qm', 'feature')
    // Uncommitted: a modification, a new file and a deletion.
    writeFileSync(join(mine, 'a.txt'), 'v2\n')
    writeFileSync(join(mine, 'draft.txt'), 'draft\n')
    rmSync(join(mine, 'gone.txt'))

    const id = share.newShareId()
    const bundle: share.ShareBundle = {
      version: 1,
      id,
      title: 'Feature work',
      repoName: 'r',
      branch: 'alice/feature',
      baseRef: 'origin/main',
      sharedBy: await share.sharerName(mine),
      sharedAt: 1000,
      chats: [{ id: 'c1', title: 'Chat', model: 'opus', effort: 'high', items: [{ id: '1', kind: 'user', text: 'hello', ts: 1 }] }]
    }
    await share.publish(mine, bundle)
    // Sharing must not disturb the sharer's worktree.
    expect(readFileSync(join(mine, 'a.txt'), 'utf8')).toBe('v2\n')
    expect(await g.git(mine, ['diff', '--cached', '--name-only'])).toBe('')

    await g.git(root, ['clone', '-q', remote, theirs])
    const list = await share.listShares(theirs)
    expect(list).toEqual([{ id, title: 'Feature work', branch: 'alice/feature', sharedBy: 'Alice', sharedAt: 1000, chats: 1 }])

    const { bundle: got, ref } = await share.fetchShare(theirs, id)
    expect(got.chats[0].items[0]).toMatchObject({ text: 'hello' })
    const wt = join(root, 'wt')
    await share.checkoutShare(theirs, wt, 'alice/feature', ref)
    expect(readFileSync(join(wt, 'a.txt'), 'utf8')).toBe('v2\n')
    expect(readFileSync(join(wt, 'b.txt'), 'utf8')).toBe('committed\n')
    expect(readFileSync(join(wt, 'draft.txt'), 'utf8')).toBe('draft\n')
    expect(existsSync(join(wt, 'gone.txt'))).toBe(false)
    expect((await g.git(wt, ['branch', '--show-current'])).trim()).toBe('alice/feature')
    expect((await g.git(wt, ['log', '-1', '--format=%s'])).trim()).toBe('feature')
    expect(await g.git(wt, ['diff', '--cached', '--name-only'])).toBe('')
    expect(await share.branchExists(theirs, 'alice/feature')).toBe(true)

    // Updating replaces the share; unsharing removes it.
    await share.publish(mine, { ...bundle, sharedAt: 2000 })
    expect((await share.fetchShare(theirs, id)).bundle.sharedAt).toBe(2000)
    await share.unpublish(mine, id)
    expect(await share.listShares(theirs)).toEqual([])
    await expect(share.fetchShare(theirs, id)).rejects.toThrow(/unshared/)
  })
})
