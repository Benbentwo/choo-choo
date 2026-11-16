# PRD: GitHub link previews

| | |
|---|---|
| Status | Shipped (PR #125); open-or-go-to in review |
| Owner | Choo Choo maintainers |
| Requested by | Ben, 2026-11-16 |
| Last updated | 2026-11-16 |

## Problem

Agents link PRs, issues, commits and files all the time. In chat these are long URLs that take a line each and say nothing about the thing they point at: is the PR merged, are checks green, what does that line of code say? Finding out means leaving the app.

> When you hover a link in a conversation, can we have it do a preview if it's a GitHub link? What do you think is the best way to have this look and work without taking up too much of the space?

## Goals

- See what a GitHub link points at without leaving the chat or clicking.
- Take less room than today: no embeds, nothing that moves the chat.
- Jump from a link to a workspace on that PR or issue.

## Non-goals

- Previews for non-GitHub sites (Linear, Notion, docs). The card is built so other kinds could be added.
- Live updates while a card is open; the refresh button asks again.

## User experience

- **Pills.** A GitHub link whose text is just its URL (Claude's usual way of writing one, and any GitHub URL you paste in your own message) shows as a small pill: `web#488 ●` for a PR or issue, `web@abc1234` for a commit, `dates.ts:10-16` for a file, `owner/repo` for a repo. PR and issue pills carry a state dot (green open, gray draft or not planned, purple merged or completed, red closed), loaded once the pill scrolls into view. Links with their own text keep it.
- **Hover card.** Hovering any GitHub link (pill or not) for 400 ms opens a 320 px card beside it, below the link when there's room and above otherwise. It floats over the chat, so nothing moves. Moving the pointer into the card keeps it open; leaving both closes it after a moment. Escape, scrolling or switching windows closes it.
- **What the card shows.**
  - PR: repo and number, state badge, title, author and last update, checks (passed, failed or running), review (approved, changes requested, review requested), +/- lines and files, head → base branch.
  - Issue: state, title, author, up to four labels in their GitHub colors, assignees.
  - Commit: subject and body, author, date, +/- lines and files.
  - File: path and ref, and up to eight of the linked lines with line numbers (the top of the file when no lines are linked).
  - Repo: description, language, stars, open issues, last push.
- **Actions.** Open in Choo Choo, GitHub, Copy, and refresh. Open in Choo Choo goes to the workspace that already holds the PR or issue when there is one (an accent dot on the button and its tooltip say which), and otherwise opens one: for a PR, a workspace on the Review tab, cloning the repo first if needed, the same as the PRs page; for an issue, a workspace started from it. A workspace holds a PR when it was opened from it or adopted it (`Workspace.prNumber`), when its branch is the PR's branch, or when the PR is a layer of its stack; it holds an issue when it was started from it (`Workspace.issueNumber`). The lookup runs live against open workspaces, so it's right even while the preview itself is cached. The PRs page uses the same lookup (`src/shared/workspaceFor.ts`).
- **Errors.** The card says why there's no preview: gh missing, signed out, not found or no access, rate limited.
- **Setting.** Settings › General › GitHub link previews, on by default. Off, links render as plain links again.

## Requirements

1. Only `github.com` URLs for PRs, issues, commits, blobs and repos are treated; GitHub's own pages (`/settings`, `/orgs/…`, `/marketplace`) are not.
2. The card opens after 400 ms of hover and never shifts the chat layout.
3. The card is portaled to `document.body` so it isn't clipped by scroll containers or caught in a window drag region.
4. Data comes from the person's `gh` sign-in, REST only (no GraphQL), cached per linked item for 3 minutes (30 s for failures), with concurrent asks for the same item shared and at most four `gh` processes at once.
5. Blob URLs whose branch has slashes resolve by trying longer refs.
6. An `/issues/N` link that is really a PR shows the PR.

## Design

- `src/shared/githubLink.ts`: URL parsing, pill labels, shaping REST answers (`prPreview`, `issuePreview`, `commitPreview`, `checksSummary`, `reviewState`, `fileExcerpt`).
- `src/main/linkPreview.ts`: fetches through `gh api` with the cache and limit above. A PR is `pulls/N`, `pulls/N/reviews` and `commits/<head>/check-runs`; a file is `contents/<path>?ref=` with the raw media type.
- IPC `link:preview` (`Api.linkPreview(url, fresh?)`) returns the preview plus the local project for its repo and, for a PR, the open workspace on its branch.
- `src/renderer/src/components/GithubLink.tsx`: `ChatLink`, the `a` override in `MARKDOWN_COMPONENTS`, renders the pill and the card. Styles for `.gh-pill` are in `styles.css`.
- Setting `githubLinkPreviews` (default true).

## Compliance, privacy and security

- No Claude access involved.
- Calls go to the GitHub API through the person's own `gh` login; nothing else leaves the machine. Avatars load from GitHub's avatar host (already allowed by the CSP's `img-src https:`).
- No secrets stored.

## Testing

`test/githubLink.test.ts` covers parsing, labels, review and check summaries, file excerpts, and the fetcher with `gh` stubbed (caching, issue → PR, slashed refs, not found). The `link-previews` scene in `scripts/demo/record.cjs` drives the real app with a stand-in `gh` that answers REST calls from `scripts/demo/scripts/links-gh.json`.

## Rollout

On by default, with a switch in Settings › General.

## Open questions

- None. Ben confirmed (2026-11-16) that GitHub URLs in the person's own messages also become pills; other URLs there become plain links.

## Future work

- Previews for Linear and Notion links through their integrations.
- Show CI details (failed check names) and a Re-run button in the PR card.
