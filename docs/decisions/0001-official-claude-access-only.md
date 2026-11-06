# 0001: Agents use official Claude access only

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 (stack), reaffirmed 2026-11-06 |
| Decided by | Ben and the build thread |

## Context

Choo Choo runs Claude agents for people who mostly have Claude Pro or Max subscriptions. Anthropic's terms ban third-party apps from routing requests through Free, Pro or Max credentials, and the Consumer Terms ban automated access except through an API key. Tools that reuse a subscription by impersonating Claude Code on the wire (User-Agent, `x-app`, beta headers) are against those terms.

## Decision

- Agents run through Anthropic's official Claude Agent SDK and the **unmodified** Claude Code binary: the one bundled with the SDK, or the person's own installed `claude` (Settings > Claude Code).
- People sign in with Claude Code's own `/login`, or paste an Anthropic API key (or set `ANTHROPIC_API_KEY`).
- Choo Choo never shows its own Claude login, never reads or handles Claude tokens, and never patches or wraps the binary to look like something else.
- When Claude Code isn't signed in, the chat tells the person to run `claude` and `/login`.

## Consequences

- Every feature that runs a model (advisor, reflect, orchestrator, naming, extra agents) goes through the SDK and inherits the same sign-in.
- Shared sessions can't carry SDK sessions or credentials; the coworker resumes with their own login and a transcript handoff.
- No claude.ai Projects integration: there is no public API, and reusing the claude.ai login is not allowed.
- The PR template asks every contributor to confirm "Agents use official Claude access only".

## Alternatives considered

- **Our own OAuth to claude.ai**: not permitted for third-party apps.
- **oh-my-pi as a backend**: see [0002](0002-no-oh-my-pi-backend.md).
