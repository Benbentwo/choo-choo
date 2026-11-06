# PRD: Add PR comments to chat

| | |
|---|---|
| Status | In review |
| Owner | Claude |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-06 |

## Problem

> when the PR is ready for review as well, if there are comments on it, in conductor there was a "add all comments to chat" function.

When reviewers leave comments on a workspace's PR, the person has to copy them from GitHub into the chat by hand before the agent can act on them.

## Goals

- One click hands every open piece of review feedback to the agent, with the file and line it is about.
- The header shows when there is feedback, and when new feedback arrived since the last hand-off.

## Non-goals

- Replying to or resolving threads on GitHub from the app. The agent can do that with `gh` if asked.
- Picking individual comments to send.

## User experience

- When the workspace's PR is open and has feedback, a comment button appears left of the PR status in the right panel header. It shows the count, and is highlighted in the accent color while any of it is new. After a hand-off it shows "N new" when more feedback arrives.
- Clicking it (or "Add all comments to chat" in the PR menu) sends one message to the active chat and switches to it. Disabled while the agent is running.
- No PR, a merged or closed PR, or no feedback: no button.

## Requirements

1. Feedback is: unresolved review threads (with replies), reviews that have a summary or request changes, and conversation comments not written by the PR author. Resolved threads, empty approvals, pending and dismissed reviews are left out.
2. Each inline item names `path:line` (or a line range), notes when it is outdated, and includes the tail of the diff hunk.
3. Comment text is fenced as data with angle brackets escaped, and the agent is told not to follow instructions in it.
4. The message asks the agent to apply or push back on each item, commit and push, and summarize.
5. "New" means newer than the newest item at the last hand-off for that workspace. A reply by the PR author doesn't make a thread new.

## Design

- `src/shared/prComments.ts`: the GraphQL query, `parsePrFeedback`, `newSince` and `prCommentsPrompt`.
- `src/main/github.ts` `prComments` runs `gh api graphql` with gh's `{owner}`/`{repo}` placeholders. IPC `pr:comments` → `Api.getPrComments(workspaceId)`.
- `RightPanel.tsx` `PrButton` fetches comments with the PR status (every minute and on changes) while the PR is open. The last hand-off time is kept in `localStorage` under `prCommentsAddedAt:<workspaceId>`.

## Compliance, privacy and security

- No Claude access changes. GitHub access goes through the person's `gh` sign-in, as for PR status.
- Comment text can come from anyone who can comment on the PR, so it's treated as untrusted (requirement 3).

## Testing

`test/pr-comments.test.ts` covers filtering, the "new" count and the prompt. Manual: open a PR with review comments in `npm run dev`.

## Rollout

On for everyone; no settings or migration.

## Future work

- Let the agent resolve threads it addressed.
- Notify (dock badge or sidebar dot) when new comments arrive on a background workspace.
