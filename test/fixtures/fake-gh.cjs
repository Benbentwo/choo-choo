#!/usr/bin/env node
// A stand-in for `gh` in tests: PRs, GitHub stacks and `gh stack merge`, backed by a JSON file ($FAKE_GH_STATE)
// and a bare git repo as origin. Merging squashes the PRs into origin's main like GitHub would.
const { readFileSync, writeFileSync, mkdtempSync, appendFileSync, renameSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const file = process.env.FAKE_GH_STATE
const st = JSON.parse(readFileSync(file, 'utf8'))
// Many gh calls run at once: write the state atomically, and log calls to their own file.
const save = () => {
  writeFileSync(`${file}.${process.pid}`, JSON.stringify(st, null, 2))
  renameSync(`${file}.${process.pid}`, file)
}
const a = process.argv.slice(2)
appendFileSync(`${file}.calls`, a.join(' ') + '\n')
const out = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v))
const fail = (msg) => {
  process.stderr.write(msg + '\n')
  process.exit(1)
}
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const apiStack = (s) => ({ number: s.number, pull_requests: s.prs.map((n) => ({ number: n, state: 'open', merged_at: null })) })
const branchOf = (n) => Object.keys(st.prs).find((b) => st.prs[b].number === n)

if (a[0] === 'pr' && a[1] === 'view') {
  const pr = st.prs[a[2]]
  if (!pr) fail('no pull requests found')
  out({ number: pr.number, url: `https://github.com/o/r/pull/${pr.number}`, state: pr.state, isDraft: false, title: pr.title ?? a[2], baseRefName: pr.base ?? 'main' })
} else if (a[0] === 'pr' && a[1] === 'edit') {
  const pr = Object.values(st.prs).find((p) => String(p.number) === a[2])
  if (pr) pr.base = a[a.indexOf('--base') + 1]
  save()
} else if (a[0] === 'pr' && a[1] === 'checks') {
  out('[]')
} else if (a[0] === 'extension' && a[1] === 'list') {
  out(st.ext ? 'gh stack\tgithub/gh-stack\tv0.1.0\n' : '')
} else if (a[0] === 'extension' && a[1] === 'install') {
  st.ext = true
  save()
} else if (a[0] === 'api' && a.includes('graphql')) {
  fail('graphql not stubbed')
} else if (a[0] === 'api') {
  if (!st.stacksApi) fail('HTTP 404: Not Found')
  const path = a.find((x) => x.startsWith('repos/'))
  const nums = a.filter((x) => x.startsWith('pull_requests[]=')).map((x) => Number(x.split('=')[1]))
  if (!a.includes('POST')) {
    const n = Number(path.split('pull_request=')[1])
    out(st.stacks.filter((s) => s.prs.includes(n)).map(apiStack))
  } else if (path.endsWith('/stacks')) {
    const s = { number: st.stacks.length + 1, prs: nums }
    st.stacks.push(s)
    save()
    out(apiStack(s))
  } else {
    const s = st.stacks.find((x) => x.number === Number(path.split('/')[4]))
    s.prs.push(...nums)
    save()
    out(apiStack(s))
  }
} else if (a[0] === 'stack' && a[1] === 'merge') {
  const top = Number(a[2])
  const s = st.stacks.find((x) => x.prs.includes(top))
  if (!s) fail('not in a stack')
  const upto = s.prs.slice(0, s.prs.indexOf(top) + 1)
  const topBranch = branchOf(top)
  const o = st.origin
  // One squash commit with the top PR's tree on main.
  const tree = git(['rev-parse', `refs/heads/${topBranch}^{tree}`], o)
  const main = git(['rev-parse', 'refs/heads/main'], o)
  const sq = git(['commit-tree', tree, '-p', main, '-m', `Merge stack through #${top}`], o)
  git(['update-ref', 'refs/heads/main', sq], o)
  for (const n of upto) st.prs[branchOf(n)].state = 'MERGED'
  s.prs = s.prs.slice(upto.length)
  if (st.rebase && s.prs.length) {
    // GitHub rebases the PRs left onto main, keeping each one's own commits.
    const tmp = mkdtempSync(join(tmpdir(), 'fake-gh-'))
    git(['clone', '-q', o, tmp])
    git(['config', 'user.email', 'g@h'], tmp)
    git(['config', 'user.name', 'GH'], tmp)
    const left = s.prs.map(branchOf)
    for (const b of left) git(['branch', '-f', b, `origin/${b}`], tmp)
    const oldBase = git(['rev-parse', `origin/${topBranch}`], tmp)
    git(['checkout', '-q', left[left.length - 1]], tmp)
    git(['rebase', '-q', '--update-refs', '--onto', 'origin/main', oldBase, left[left.length - 1]], tmp)
    git(['push', '-q', '-f', 'origin', ...left], tmp)
    st.prs[left[0]].base = 'main'
  }
  save()
} else {
  fail(`fake gh: not stubbed: ${a.join(' ')}`)
}
