# 0019: Resume stopped chats only after the server's reset time

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-12 |
| Decided by | Ben (feature), Claude (mechanism) |

## Context

Ben runs many chats at once and runs out of his plan's 5-hour window. He asked for chats to continue when the window resets, in an order he picks. Claude Code's own auto-continue (CLI setting and desktop checkbox) does this for one interactive session, but not for Agent SDK sessions, which is how Choo Choo runs chats. Anything Choo Choo does here must stay inside the plan's limits ([0001](0001-official-claude-access-only.md)).

## Decision

Choo Choo resumes a chat that stopped on a usage limit only after the reset time Claude reported, plus a minute, and only once Claude Code's `/usage` shows the window open again. It resumes in the same session with a plain prompt, a few chats at a time, and stops starting new ones once the new window passes a threshold. It never retries a refused window in a loop, never switches accounts or API keys to keep going, and never turns on extra usage.

## Consequences

- Same behavior as Claude Code's own auto-continue, extended to many chats with an order and a cap.
- Weekly limits more than a day away are not waited on.
- If `/usage` is unavailable, the server's reset time alone decides; a chat that hits the limit again goes back to the front at most twice.

## Alternatives considered

- **Retry on a timer until a turn succeeds**: spends requests against a refused window. No.
- **Resume everything at once at reset**: burns the new window in minutes; the cap and threshold exist for that.
- **Leave it to Claude Code's auto-continue**: it only runs in interactive sessions.
