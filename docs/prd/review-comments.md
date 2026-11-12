# PRD: Line comments go to the agent or a GitHub review

| | |
|---|---|
| Status | In review |
| Owner | Claude |
| Requested by | Ben, 2026-11-10 |
| Last updated | 2026-11-12 |

## Problem

> when I comment on a line, we need to figure out whether I want to send this context to an agent or whether I want to start a review and directly comment on the code.

Line comments in the diff could only go to the agent. That fits reviewing what your own agents wrote, but not reviewing a coworker's PR: there the person wants their comments to land on GitHub as a review, and sometimes still wants to ask an agent about a line.

Three cases:

1. Reviewing code your agents wrote, and sending comments back to them.
2. Reviewing someone else's PR in a workspace, and posting a GitHub review.
3. Reviewing someone else's PR, but asking an agent about some lines.

## Goals

- Every line comment has a destination, Agent or GitHub review, with a sensible default and one key to pick the other.
- A GitHub review is built up as drafts and posted in one go, with a summary and Comment, Approve or Request changes.
- Reviewer-agent findings can become comments in your review.
- Other reviewers' threads show in the diff, with Reply, Resolve and Ask agent.
- The header says whose PR the workspace is on.

## Non-goals

- Syncing with a pending review started on github.com. Drafts live in the app until submitted.
- Editing or deleting comments after they're posted.
- Suggested-change blocks written for you. The agent can draft one when asked.

## User experience

![Your GitHub review](../media/review-comments.png)

- **Default destination.** In Review mode on an open PR, comments go to your GitHub review; in Build mode they go to the agent. The mode starts as Review on someone else's open PR and can be switched in the header ([Build and Review modes](workspace-modes.md)).
- **Comment box.** Click or drag line numbers as before. The box has a "Send to: GitHub review | Agent" switch. ⌘↵ sends to the chosen one; ⌘⇧↵ sends to the other. The hint on the right says why the default was picked.
- **Drafts in the diff.** A saved comment shows on its line tagged "Pending in your GitHub review" or "Queued for the agent", with Edit, Move to the other destination, and remove.
- **Review tab.** "Your GitHub review" lists the drafts, takes an optional summary and Comment, Approve or Request changes (Approve and Request changes only on someone else's PR), and has Submit review to GitHub and Discard. After posting it shows "Review posted to GitHub" with a link. "Queued for the agent" lists agent comments with Send to agent; the chat box sends them too.
- **Agent on someone else's PR.** Agent comments and Ask agent tell the agent not to commit or push, and to answer or draft a GitHub suggestion instead.
- **Agent findings.** Each finding in the diff has "Add to my review" (someone else's PR) or "Add to GitHub review" and Fix (your own). Adding copies it into your review as a draft you can edit.
- **GitHub threads.** Unresolved threads show on their line: Reply posts on GitHub, Resolve resolves the thread, Ask agent sends the thread to the agent.
- **Header.** A pill next to the branch says "Needs your review #214 · alex", "You approved #214 · alex", or "Your PR #212". Clicking it opens the Review tab.
- **Lines GitHub won't take.** A comment can only go to GitHub when its lines are in the PR's diff, the worktree is on the PR's head commit, and the file has no uncommitted changes. Otherwise the GitHub option is off and says why, and drafts that no longer fit are marked before submit.

### When the PR is updated

> I posted a review ... then the owner of the PR reviewed it, made changes, and pushed. My local didn't get updated, and some of my comments that were stale were still there. (Ben, 2026-11-12)

- **The worktree follows the PR.** In Review mode, when the PR's head moves on GitHub the worktree fast-forwards to it, keeping uncommitted edits. It waits while the agent is working in it. In Build mode it only reports, since the new commits are usually your own agent's.
- **When it can't.** A banner above the right panel's tabs says the PR has N new commits, with Update. After a force-push, or when the worktree has commits that aren't on the PR, it says so and offers "Use the PR's version" (`git reset --keep`, confirmed first; uncommitted edits stay and the old commits are in the reflog). After an automatic update it says "Caught up with the PR: N new commits" with What changed.
- **Drafts move with the code.** Each line comment remembers the commit it was written on. When the worktree moves, comments shift to their new line numbers; ones whose lines changed are tagged "code changed" and can't be posted until you press Keep, edit or remove them.
- **Outdated threads.** Threads whose code changed no longer sit on whatever line now has their old number. They're in a collapsed "N outdated threads" group above the diff, each with the code it was written on. Threads also stay above the diff while the worktree isn't on the PR's head.
- **Since your review.** On someone else's PR in Review mode, the Review tab starts with the commits and files changed since the commit of your last submitted review (any kind). Each file opens its diff.
- **Your open threads.** Below that, the unresolved threads you started, each tagged "code changed", "replied" (the author answered last) or "no reply yet", with Resolve and Open. "Resolve N outdated" resolves the ones whose code changed. "Which are addressed?" asks the agent to read the current code and say, per comment, Addressed, Partly or Not addressed, without committing or pushing.

## Requirements

1. Ownership is the PR author compared with the signed-in gh user (`viewer`), ignoring case.
2. Drafts are kept per workspace in `localStorage` so a half-written review survives a restart.
3. Submit posts one review with all drafts through `POST /repos/{owner}/{repo}/pulls/{n}/reviews`, pinned to the PR's head commit. Nothing is posted before submit.
4. Multi-line comments use `start_line`/`line`; removed lines use side `LEFT`.
5. Reviewer text sent to the agent is fenced and escaped, as in "Add all comments to chat".
6. The worktree never moves over commits of its own without a confirmed "Use the PR's version", and never discards uncommitted edits.
7. A draft is never posted on lines that new commits changed until the person keeps it.

## Design

- `src/shared/prReview.ts`: ownership (`isTheirs`, `defaultMode`, `modeDest`, `prOwnerLabel`), `patchLines`, `draftProblem`, `reviewPayload`, `threadPrompt`.
- `src/shared/prComments.ts`: the feedback query also asks for `viewer`, thread ids and sides; `parsePrReviewInfo` adds author, viewer and the viewer's last review.
- `src/main/github.ts`: `prReview`, `prDiffLines` (PR files API), `submitReview` (gh api with the body on stdin), `replyToThread`, `resolveThread`. IPC `pr:review`, `pr:diffTarget`, `pr:submitReview`, `pr:replyThread`, `pr:resolveThread`.
- Following updates: `git.followPrHead` (check, ff-only, or `reset --keep`; fetches `refs/pull/<n>/head`, so forks work), `git.rangeDiffs`, `git.changedSince`; IPC `pr:follow`, `pr:rangeDiffs`, `pr:changedSince`. `remapRange`, `moveComments`, `myOpenThreads`, `threadStatus` and `addressedPrompt` in `src/shared/prReview.ts`. The query also asks for each review's commit (`myReviewCommit`).
- Renderer: `useFollowPrHead` and `syncPrHead` in `prReview.ts` (state in the store's `prSync`); `PrSyncBanner` and `ReviewFollowUp` in `ReviewFollowUp.tsx`; `CodeComment.commit` and `stale`.
- Renderer: `CodeComment.dest` in the store; `prReview` per workspace, loaded by the PR button and `usePrReview`; `DiffView.tsx` comment box, drafts and threads; `ReviewDrafts.tsx` at the top of the Review tab; `PrOwnerPill` in `Center.tsx`.

## Compliance, privacy and security

- No Claude access changes.
- GitHub calls go through the person's `gh` sign-in. Reviews and replies post as them, only when they press Submit or Reply.

## Testing

`test/pr-review.test.ts` covers ownership, labels, patch line parsing, the draft checks, the review payload, the thread prompt, moving comments through new commits, thread status and the "which are addressed" prompt. `test/pr-follow.test.ts` runs `followPrHead`, `rangeDiffs` and `changedSince` against real git repos: fast-forward keeping edits, refusing over a force-push, and reset when asked. Checked in the built app against a stand-in `gh`: drafts, finding to review, and the posted payload.

## Rollout

On for everyone. Old queued comments have no destination and count as agent comments.

## Future work

- Show outdated threads in place, on the lines they were written on, in a diff of the commit they were made on.
- A Files view of only the changes since your review (today the Review tab lists the files; each opens the full PR diff).
- Following updates in Build mode when someone else pushes to your branch (today it only reports).
- Turn an agent's suggestion block into a draft in one click.
