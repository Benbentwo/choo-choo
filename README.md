<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/choo-choo-horizontal-dark.svg">
  <img src="docs/brand/choo-choo-horizontal-light.svg" alt="Choo Choo" width="420">
</picture>

**Run a team of Claude Code agents in parallel on your Mac.**<br>
Each agent gets its own git worktree. You review the diffs and ship the PRs from one window.

An open-source, MIT-licensed alternative to [Conductor](https://conductor.build).

[![CI](https://github.com/Benbentwo/choo-choo/actions/workflows/ci.yml/badge.svg)](https://github.com/Benbentwo/choo-choo/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Benbentwo/choo-choo?label=download)](https://github.com/Benbentwo/choo-choo/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![macOS](https://img.shields.io/badge/macOS-Apple%20silicon%20%7C%20Intel-lightgrey)

[Download](https://github.com/Benbentwo/choo-choo/releases/latest) · [Features](#features) · [Coming from Conductor](#coming-from-conductor) · [Docs](docs/README.md) · [Contributing](#contributing)

</div>

<p align="center">
  <img src="docs/media/gifs/parallel-workspaces.gif" alt="Starting two workspaces from the sidebar. Each agent works in its own git worktree, and the two chats sit side by side in split panes." width="900">
</p>

## Why Choo Choo

On November 4, 2026, the Conductor team [announced that Conductor is joining Meta](https://www.conductor.build/changelog/0.93.0-conductor-is-joining-meta). Conductor Cloud is winding down, and the Mac app will keep getting new models and critical bug fixes until early 2027. Congratulations to the team: they built a workflow a lot of developers now rely on.

Choo Choo is an open-source, community-driven option for people who want to keep working that way for the long run. The code is MIT-licensed, so anyone can read it, fork it and keep it going. It is built to be a drop-in switch: it follows Conductor's layout and workflow closely, and it reads the same `conductor.json` scripts and `CONDUCTOR_*` environment variables, so your repos work without changes. See [docs/PARITY.md](docs/PARITY.md) for the full feature checklist.

> Choo Choo is an independent project. It is not affiliated with, endorsed by or sponsored by the makers of Conductor or by Anthropic. "Conductor" and "Claude" are trademarks of their owners and are used here only to describe compatibility.

## Features

**Work in parallel**
- **Agents in isolated worktrees.** Press + to start a workspace: a fresh git worktree and branch where a Claude Code agent works without touching your other checkouts.
- **Chat built for coding agents.** Opus, Sonnet and Haiku with effort levels, plan mode, @file mentions, /slash commands and skills, image and file attachments, and "revert to here" checkpoints.
- **Stop that always stops.** Stop (or Esc) shows Stopping… right away and ends the turn within seconds. If Claude doesn't respond, Force stop ends it and everything it started, and queued messages go back to the message box.
- **Attach any file.** Drop, paste or pick any file into the message box. Pictures go to Claude as images; other files show as chips and go as paths the agent reads in place.
- **Markdown as you type.** The message box formats `code`, **bold**, lists, links and code blocks in place, Slack-style, and sends plain Markdown.
- **Check in without stopping.** A running chat says what it's doing and for how long, such as "Waiting on run 48213 · 14m", or "Compacting" while Claude Code summarizes a long conversation. Press Check in, type `/btw` and a question, or just ask "how's it going?" to get a quick answer while Claude keeps working.
- **Orchestrator.** Tell a repo's orchestrator what you want and it splits the work into workspaces, briefs each agent, reads their diffs and follows up.
- **Projects** (on by default). One project per big goal, across several repos. The project chat routes each message to a thread, and each thread owns its workspaces and PRs. A thread whose work is all merged or closed resolves itself and leaves the sidebar, still a click or ⌘K away. Rename a thread, or let Haiku name it from the conversation. Drag projects to put them in any order. Automations run checks on a schedule or on GitHub events and open a workspace per finding.
- **Split panels and resizable panes.** Put workspaces and chats side by side, drag either sidebar to size it, and expand the right panel with ⌘⇧E. With a chat beside your files, the next file you click opens on the file side; drag file tabs between panes, and right-click one to close the others, the ones to its right, or all of them.

<p align="center">
  <img src="docs/media/gifs/projects-threads.gif" alt="A request in a project's chat starts a thread. The thread starts a workspace in each of two repos, and each agent makes its change in its own worktree." width="900"><br>
  <sub>Ask a project for something; it opens a thread, which starts a workspace (git worktree and agent) in each repo it touches.</sub>
</p>

<p align="center">
  <img src="docs/media/gifs/resolve-threads.gif" alt="A thread's two workspaces are archived, so the thread resolves on its own and shows a Resolved card. It leaves the sidebar for a Resolved list under the project, ⌘K still finds it, and Reopen brings it back." width="900"><br>
  <sub>Finished threads resolve themselves: out of the sidebar, never deleted, and back with Reopen.</sub>
</p>

<p align="center">
  <img src="docs/media/gifs/thread-names.gif" alt="The Threads panel is dragged wider. A thread is renamed by double-clicking its title, then renamed again from the sidebar's right-click menu with Regenerate name. Expand lists the threads across the whole pane, and picking one goes back to its chat." width="900"><br>
  <sub>Rename a thread, or let Haiku name it from the conversation. Drag the Threads panel wider, or expand it over the pane.</sub>
</p>

<p align="center">
  <img src="docs/media/gifs/reorder-projects.gif" alt="Four projects in the sidebar. Gift cards is dragged to the top and Trip checkout to the bottom, with a line showing where each will land." width="900"><br>
  <sub>Drag projects into the order you want; it sticks.</sub>
</p>

<p align="center">
  <img src="docs/media/gifs/file-tabs.gif" alt="A diff tab is right-clicked and split to the right of the chat. With the chat focused, the next file clicked in Changes still opens on the file side. A file tab is dragged into the chat's group, and Close all tabs from the right-click menu clears the file side." width="900"><br>
  <sub>Files open beside the chat, not over it. Drag file tabs between panes, and right-click one to close several at once.</sub>
</p>

<p align="center">
  <img src="docs/media/gifs/composer-markdown.gif" alt="Typing in the message box: backtick-wrapped names turn into inline code as soon as the closing backtick is typed, double asterisks turn bold, a list and a code block format as they're typed. Clicking into inline code shows its backticks again. Sent, the message looks the same in the chat." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/file-attachments.gif" alt="Four files are picked with the attach button and show as chips above the message box. One is removed with its ×. The message is sent with the remaining three listed as paths, and Claude reads each one." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/check-in.gif" alt="Claude waits on a CI run. The line under the chat reads Waiting on run 48213 with a running timer. Check in adds a card explaining what it's waiting on and what comes next; typing How's it going? gets another quick answer while the run keeps going." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/compacting.gif" alt="Claude runs the booking tests, then the line under the chat reads Compacting with a timer while Claude Code compacts the long conversation. When it finishes, Claude picks up where it was." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/stop.gif" alt="Claude is running a long test command and doesn't respond to Stop. The button shows Stopping…, then turns into Force stop; clicking it ends the turn and the chat shows Stopped by you." width="900">
</p>

**Review and ship**
- **Build and Review modes.** Each workspace knows whether you're building it or reviewing someone else's PR, and the top right shows the PR and one button for the next step.
- **Review before you ship.** Diffs against the PR's target branch, an agent code review with inline Fix buttons, and line comments that go to the agent or into a GitHub review.
- **Markdown preview diffs.** A Markdown file's diff shows the rendered document with changed blocks marked, and you can comment right on it. Mermaid diagrams draw as diagrams. Code diffs keep their syntax colors on the green and red lines.
- **Image diffs.** A changed PNG or SVG shows before and after side by side. Click one to open it full size and flip between the two.
- **PRs page.** Every open PR waiting on your review, plus your own, grouped by repo. One click opens a workspace on the PR's branch. "Since your review" shows only what the author changed.
- **Stacked PRs.** Keep a stack of PRs in one workspace, switch layers in one click, and let the app restack the PRs above after a change.
- **PRs in one click.** Create a PR or draft, watch checks, re-run failures and squash-merge, all through your `gh` login.
- **GitHub link previews.** GitHub links in chat show as short pills like `web#488` with a state dot. Hover one for a small card with its title, state, checks, review and size, and open it in a workspace from there.

<p align="center">
  <img src="docs/media/gifs/markdown-diff.gif" alt="A Markdown file's diff opens as the rendered document: an edited sentence shows its old text in red above the new text in green, a removed list item is red and new sections are green. Clicking + Comment beside a list item opens the comment box, and the comment is queued for the agent under that item. Code shows the Markdown source, and a TSX file's diff keeps its syntax colors on the green and red lines." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/mermaid-diff.gif" alt="A Markdown file's diff with a Mermaid flowchart: the old diagram is drawn in red above the new one in green, which adds an Apple Pay branch. Clicking + Comment beside the new diagram queues a comment for the agent under it." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/image-diff.gif" alt="A changed PNG opens as Before and After side by side. Clicking After opens it full size, and the arrow keys flip between the two. A changed SVG shows the same preview, and its Code switch shows the line diff." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/prs-page.gif" alt="The PRs page lists PRs waiting on your review and your own, grouped by repo, with To review, Mine and All filters." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/link-previews.gif" alt="An agent's reply links two PRs, an issue and a file. Each GitHub link shows as a short pill with a state dot, and hovering one opens a small card: the PR's checks and review, the issue's labels, or the linked lines of the file." width="900">
</p>

**Stay on top of usage**
- **Plan limits in the sidebar**, and a **Usage page** with a year of plan window history, every limit hit, and which repos and chats used it.
- **Up next.** Chats that stop at the usage limit resume in order when the window resets, along with any work you queue for the next window.
- **Lighter project threads.** Workspaces hand their thread a short report instead of a whole transcript, threads get one update per batch of finished work, and you pick the model and thinking level for project chats, threads and their workspaces, per project if you like. On by default; the Usage page shows what threads used next to the work they started.

**Make it yours**
- **Add-ons.** Claude Code plugins with a Choo Choo manifest add views, buttons and tools. Install them from any git repo, including private ones for your team. See [Writing an add-on](docs/addon-api.md).
- **Integrations.** Sign in to Notion and start a workspace from a page; agents can search and update it too. MCP servers, plugins and skills are managed in Settings.
- **Appearance.** Themes, accents, fonts, size and density.
- **Output style.** Pick how Claude writes in every chat: Claude Code's built-in styles, ones from your plugins, or your own prompt. A chat can still pick its own from its model menu.
- **Searchable Settings.** Press ⌘F in Settings and type; Enter jumps to the setting and highlights it.

<p align="center">
  <img src="docs/media/gifs/output-style.gif" alt="In Settings, Prompts, Output style is set to Custom and a short prompt is typed: lead with the result, then at most three bullets. In a chat's model menu, the Output style section shows Settings default (Custom) checked, with Default, Proactive, Concise, Explanatory, Learning and Custom to pick from." width="900">
</p>

<p align="center">
  <img src="docs/media/gifs/settings-search.gif" alt="Typing notif in Settings search lists matching settings from General, Reviews and Continue work. Enter opens one and highlights it, then dark mode finds Theme." width="900">
</p>

**Everywhere else**
- **Continue on your phone, in the cloud or in Claude desktop**, and bring the chat back when you return.
- **Shared sessions.** Send a coworker a link to your workspace: branch, uncommitted changes and chats.
- **Copy that pastes well.** Replies copy cleanly into Notion and Docs, or as Slack-ready text, and file links point at GitHub.
- **Real terminals.** Setup, Run (⌘R) and terminal tabs per workspace, driven by `choo-choo.json` or `conductor.json`.
- **Codex too.** Optionally run OpenAI's Codex CLI as a workspace agent.
- **Keyboard first.** ⌘K search, ⌘T/⌘W tabs, ⌘B/⌘J panels, ⌘⇧U next unread.
- **Native Mac app.** Signed and notarized builds for Apple silicon and Intel that update themselves, on a Stable or Beta channel. **What's new** shows what an update brings, and restarting waits for running chats; a chat that a restart cuts off picks up where it left off.

<p align="center">
  <img src="docs/media/gifs/app-updates.gif" alt="An update has downloaded while a chat is running. What's new lists the changes since your version, and Restart when idle waits for the chat to finish before restarting." width="900">
</p>

## Coming from Conductor

| | Conductor | Choo Choo |
|---|---|---|
| Source code | Closed | Open, MIT license |
| Agents | Claude Code, Codex | Claude Code (official Agent SDK), Codex |
| Workspaces | Git worktrees | Git worktrees at `~/choo-choo/workspaces/<repo>/<city>` |
| Repo scripts | `conductor.json` | `choo-choo.json`, falling back to `conductor.json` |
| Env vars | `CONDUCTOR_*` | `CONDUCTOR_*`, plus `CHOO_*` aliases |
| PRs and checks | Built in | Built in, via the `gh` CLI |
| Data | On your Mac | On your Mac, plain JSON files |

To switch, [install Choo Choo](#install), [sign in](#signing-in), then open Settings > Import from Conductor. It shows a preview, then brings over your projects, open workspaces (left where they are), their chats and your default model. Claude chats keep their session, so the agent picks up with full context. Conductor's database is copied and read, never changed. Your existing `conductor.json` setup and run scripts are picked up as they are.

Using Conductor Cloud? The import reads your Mac's local Conductor data, so first move each cloud workspace to your Mac in Conductor (right-click it > Transfer to local), then import.

## Install

With [Homebrew](https://brew.sh):

```sh
brew install --cask benbentwo/tap/choo-choo
```

Or download the `.dmg` from the [latest release](https://github.com/Benbentwo/choo-choo/releases/latest) (`arm64` for Apple silicon, `x64` for Intel) and drag Choo Choo to Applications.

On Linux (x64), download the `.AppImage` or the `.deb` from the same page. Linux builds are unsigned; the AppImage updates itself, and the `.deb` shows a link to the release page.

Mac builds are signed and notarized, and the app updates itself (Settings > Updates). To try new features early, pick Settings > Updates > Update channel > **Beta**: you'll get a signed build from every merge to `main`.

You'll also want the [`gh` CLI](https://cli.github.com/) (`brew install gh`, then `gh auth login`) for PR features.

## Signing in

Choo Choo runs agents through Anthropic's official [Claude Agent SDK](https://docs.claude.com/en/docs/agent-sdk/overview) and the unmodified Claude Code binary that ships with it. It never handles your Claude password or tokens itself. Use one of these:

1. **Your Claude Code login.** Install [Claude Code](https://docs.claude.com/en/docs/claude-code/setup), run `claude`, and sign in with `/login`. Choo Choo's agents use that login.
2. **An Anthropic API key.** Create one in the [Anthropic Console](https://console.anthropic.com/) and paste it into Settings > Anthropic API key, or set `ANTHROPIC_API_KEY`.

Your use of Claude is covered by Anthropic's terms for whichever sign-in you pick. Don't point Choo Choo at tools that reuse a Claude subscription by imitating Claude Code; that is against Anthropic's terms.

Codex is optional: install the Codex CLI (`npm i -g @openai/codex`) and run `codex login`.

## How it works

- Each workspace is a git worktree under `~/choo-choo/workspaces/<repo>/<city>`, on its own branch.
- App data lives in `~/Library/Application Support/Choo Choo/data`, as plain JSON files.
- Setup, run and archive scripts come from `choo-choo.json`, falling back to `conductor.json`.
- Scripts and agents see `CONDUCTOR_ROOT_PATH`, `CONDUCTOR_WORKSPACE_NAME`, `CONDUCTOR_WORKSPACE_PATH`, `CONDUCTOR_DEFAULT_BRANCH` and `CONDUCTOR_PORT`, also available as `CHOO_*`.
- The orchestrator keeps a memory file per repository at `~/choo-choo/memory/<repo>.md`, which you can edit.
- Integrations sign in through your browser (no pasted tokens), and their tokens are encrypted with the macOS keychain.
- Shared sessions are pushed to a hidden ref, `refs/choo-choo/shares/<id>`, in the repo's own remote. There is no Choo Choo server, so only people who can read the repo can open a share.
- Settings > Telemetry can send OpenTelemetry metrics, events and traces from agents to any OTLP collector. Only structure is exported unless you turn on content options.

Each feature has a PRD with the details in [docs/prd/](docs/README.md#prds).

## Contributing

Bug reports, ideas and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers how to send a change, and [docs/development.md](docs/development.md) covers building from source and the project docs.

## License

[MIT](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
