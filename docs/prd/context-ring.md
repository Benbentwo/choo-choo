# PRD: Context ring in the composer

| | |
|---|---|
| Status | In progress |
| Owner | Claude |
| Requested by | Ben, 2026-11-24 |
| Last updated | 2026-11-24 |

## Problem

> We want the little red circle icon to show your 1. Usage 2. Context. I suppose usage is in the bottom left, how can we best show context fillup and differentiate it from other "gauges"?

How full a chat's context window is shows only in the usage graphs, which few people open. A chat can fill up and get compacted with no warning in the place you're typing.

## Goals

- See how full this chat's context is from the composer, without opening anything.
- Never confuse it with the plan usage gauges in the sidebar footer.

## Non-goals

- Showing plan usage (5-hour or weekly) in the composer. That stays in the sidebar footer ([subscription-limits.md](subscription-limits.md)).
- Codex chats, which have no Claude Code transcript.
- Compacting on demand from the ring.

## User experience

A 16px ring sits at the right of the composer's bottom row, before the attach buttons. It appears after the chat's first reply.

- **Shape and place set it apart:** plan usage is shown as bars in the sidebar and covers the account. Context is a ring in the composer and covers this chat. Switching chats changes the ring.
- **Fill:** the arc shows the share of the window used by the last main-agent response. Subagents have their own window and don't count.
- **Color only when it matters:** a neutral stroke and faint percent under 70%, amber from 70%, red from 90% (the same thresholds as the sidebar bars). The percent always shows beside the ring: without it, a partly filled ring looks like a loading spinner.
- **Compactions:** a dot in the middle once the conversation has been compacted.
- **Hover:** "Context: 124k of 200k (62% used, 38% left)", how many times it compacted, a note that Claude Code compacts automatically when it fills, and "This chat only. Plan usage is in the sidebar."
- **Click:** opens the chat's usage graphs.

## Requirements

1. Hidden for Codex chats and before the first reply.
2. Used tokens = input + cache write + cache read + output of the last non-subagent response, out of `chat.contextWindow`, or 1M when the model is a `[1m]` one or usage is past 200k, otherwise 200k. Capped at 100%.
3. Refreshes right away on opening a chat, then 1.5 s after the chat goes quiet (status change or new items).
4. Never shows another chat's number while the new chat's usage loads.
5. Cheap on long chats: the main process reads only the bytes appended since the last read (87 ms for the first read of a 64 MB transcript, about 0 ms after that).

## Design

- `src/shared/contextGauge.ts`: `contextGauge(ChatContext)` and `contextGaugeTitle`.
- `contextNow` in `src/main/usage.ts`, IPC `chat:context` (`Api.getChatContext`, type `ChatContext`). It keeps a per-transcript scan (bytes read, compaction count, last main response) and parses only the newly appended complete lines, and only those that are compaction or assistant lines. A file that shrank is read again from the start. The full `sessionUsage` parse (170 ms on a 64 MB transcript) stays for the graphs.
- `src/renderer/src/components/ContextRing.tsx`: the ring.
- Placed in `Composer.tsx`.

## Compliance, privacy and security

Reads Claude Code's local transcript, as the usage graphs already do. Nothing leaves the machine; no Claude access changes.

## Testing

`test/contextGauge.test.ts`, and `contextNow` in `test/usage.test.ts` (appends, half-written lines, rewrites). Manually: in `npm run dev`, send a few messages and check that the ring fills, the tooltip and click work, and that it is hidden for Codex chats.

## Rollout

On for everyone, no setting.

## Open questions

- Claude Code's exact auto-compact threshold isn't reported, so the ring can't mark it. The tooltip only says that compaction is automatic.
