# 0012: Merge stacks through GitHub's stacked pull requests

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Decided by | Claude (project thread), after Ben asked to add Orca's stack merge and GitHub stack registration (2026-11-10). |

## Context

[Orca](https://www.onorca.dev/docs/review/github) registers stacks with GitHub and offers "Merge through #N · M PRs": the PR and every PR below it merge together, or none do. GitHub now has [stacked pull requests](https://docs.github.com/en/pull-requests/get-started/about-stacked-prs): a REST API to create and extend stacks (`POST /repos/{owner}/{repo}/stacks`, `…/stacks/{n}/add`), an atomic, merge-queue-aware stack merge, and server-side retargeting and rebasing of the PRs left above. A registered stack can't be merged with the old synchronous merge endpoint, and GitHub's docs don't yet spell out the asynchronous one; the documented client is the official `gh stack` extension.

Choo Choo already keeps the stack itself (decision 0010): branches, restacks and PR bases.

## Decision

1. Choo Choo's stack stays the source of truth. "Link on GitHub" creates the GitHub stack from the open PRs, bottom first, or appends the PRs GitHub's stack is missing. It never reorders or dissolves a GitHub stack.
2. "Merge through #N" only runs on a linked stack, and goes through `gh stack merge <N> --squash --yes` (GitHub's own extension, installed with one click as `gh extension install github/gh-stack`). Unlinked stacks keep the single-PR merge, like Orca.
3. After the merge, the app takes GitHub's rebased branches for the PRs left when GitHub rebased all of them onto the new base; otherwise it restacks them itself as Sync with main does. Merging needs every branch pushed and restacked first, so nothing local is lost either way.
4. Calls to the stacks API send `X-GitHub-Api-Version: 2026-03-10`. A repo where the API answers with an error shows no GitHub stack controls.

## Consequences

- Merges are atomic and respect branch protection and merge queues, because GitHub does them.
- Merging needs the `gh stack` extension. When GitHub documents the asynchronous merge endpoint, `mergeThrough` can call it with `gh api` and drop the extension.
- A stack linked on GitHub with a different order (made elsewhere) is reported, not fixed.

## Alternatives considered

- **Merge each PR in turn with `gh pr merge`**: not atomic, needs a restack between merges, and fails on a stack GitHub already knows about.
- **Use `gh stack` for everything (init, submit, rebase)**: it keeps its own local stack state and rebases on its own, which would fight Choo Choo's restacks (decision 0010).
