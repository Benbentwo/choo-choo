# PRD: Comment mode

| | |
|---|---|
| Status | Shipped. Dev builds since PR #12; release builds open a workspace or an issue (decision [0011](../decisions/0011-release-comments-open-a-workspace.md)); the 💬 bubble shows in release builds too, with a Settings switch (2026-11-13) |
| Requested by | Ben, 2026-11-06; release builds 2026-11-10 |
| Last updated | 2026-11-10 |

## Problem

Iterating on UI with an agent is slow when you have to describe which element you mean. Pointing at it is faster. Screenshots work best for Ben's input; Claude can't watch video.

In a release build there is no checkout running the app, so a comment can't be fixed live. It should still turn into a fix.

## Goals

- In `npm run dev`, click any element, type a note, and a Claude Code session working on the repo picks it up with full context.
- In a release build, the same gesture opens a workspace on choo-choo itself with the note and a screenshot, and Claude starts on the fix there.
- Anyone can use it: people without push access work on a fork and open the PR upstream; people who don't want an agent can file an issue.

## Non-goals

- Uploading screenshots to GitHub issues (the API can't; the screenshot goes on the clipboard instead).
- Checking out the exact commit the build came from. Workspaces branch from current main; the build commit is in the prompt.

## User experience

Dev:

1. `npm run dev`.
2. Open Claude Code in the repo and say "watch for my comments".
3. Press ⌘⇧K (or click the 💬 Comment bubble at the bottom right), click an element, type, press Enter.

Claude makes the change and moves the comment to `.feedback/done/`. Renderer edits hot-reload; main or preload edits restart the app.

Release:

1. Click the 💬 Comment bubble at the bottom right, press ⌘⇧K, or use Help > Comment on Choo Choo….
2. Click an element and type. "Send to" defaults to **choo-choo workspace**; the other choice is **GitHub issue**.
3. **Fix it** opens a workspace on branch `comment/<slug>`, selects it, and sends Claude the note. The toast names the workspace.
4. **Open issue** opens a prefilled issue on Benbentwo/choo-choo in the browser and copies the element screenshot so it can be pasted in.

## Requirements

1. Dev or release is `app.isPackaged`. Dev offers This checkout (default), choo-choo workspace and GitHub issue; release offers the last two, workspace by default.
2. This checkout writes `.feedback/<id>.json` (comment, CSS selector, React component chain, element text, rect, window size), `<id>.element.png` (element plus 24px padding) and `<id>.full.png`. The JSON is written last. `.feedback/` is gitignored.
3. The workspace path finds a choo-choo checkout in this order: an added repo whose `origin` is Benbentwo/choo-choo; an added repo whose `upstream` is (a fork); otherwise a clone into `~/choo-choo/repos/choo-choo`. Without push access (`gh api repos/Benbentwo/choo-choo` `.permissions.push`), it forks first, clones the fork, and sets `upstream` as gh's default so `gh pr create` targets it.
4. The workspace branches from `origin/main` (or `upstream/main` for a fork).
5. The first message carries the note, React components, selector, on-screen rect, element text (fenced as data, escaped), the app version and build commit, and how to work (typecheck, test, PRD, PR target). Screenshots are image attachments, not files in the repo.
6. The element screenshot is always attached. The whole window is a checkbox, on in dev and off in release, because it can show private repos and code.
7. Not signed in to `gh`: the workspace path fails with a message pointing to `gh auth login` or the issue option.
8. The 💬 Comment bubble sits at the bottom right in dev and release builds. Settings › General › Comment bubble (on by default, `Settings.commentBubble`) hides it; ⌘⇧K and the Help menu still work, and while comment mode is on or a result is showing the bubble stays so there is a way out (`showCommentBubble` in `src/shared/uiComment.ts`).
9. The build commit is stamped at build time (`__BUILD_COMMIT__` in `electron.vite.config.ts`).

## Design

`src/shared/uiComment.ts` (targets, prompt, issue URL, slug; tested in `test/ui-comment.test.ts`), `src/main/uiComment.ts` (IPC `uiComment:info` and `uiComment:submit`, capture, repo lookup, clone or fork), `src/renderer/src/components/FeedbackOverlay.tsx` (picker and composer), Help menu item in `src/main/index.ts`. `scripts/watch-feedback.sh` prints one line per new local comment; agent instructions are in `CLAUDE.md`.

## Open questions

- None open. The bubble was hidden in release builds until 2026-11-13; it now shows by default with a switch to hide it.
