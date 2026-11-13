# PRD: Telemetry (OpenTelemetry export)

| | |
|---|---|
| Status | Shipped (PR #33, PR #37 usage graphs); project tags and usage everywhere added 2026-11-13 |
| Requested by | Ben, 2026-11-06 |
| Last updated | 2026-11-13 |

## Problem

With many agents running, people want to see cost, token use, tool decisions and where turns spend time, in the observability tools they already use. See the [Agent SDK observability guide](https://code.claude.com/docs/en/agent-sdk/observability).

## Goals

- Export metrics, log events and traces from every Claude agent to any OTLP collector.
- Filter by repo, workspace and branch in the backend.
- Export structure by default, content only on explicit opt-in.

## Non-goals

- A Choo Choo-hosted collector or dashboard.
- Product analytics about how people use Choo Choo. Choo Choo sends nothing anywhere by default.

## User experience

Settings > Telemetry (also in ⌘K). Off by default. Endpoint (default `http://localhost:4318`), protocol (HTTP protobuf, HTTP JSON, gRPC), auth headers (password field), service name (default `choo-choo`), extra resource attributes. Toggles for metrics, logs and traces. Content opt-ins, all off: prompts, tool inputs, tool output (traces only).

## Requirements

1. Configure Claude Code through its env vars: `CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_*` exporters, protocol, endpoint, headers, service name. Traces also set `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`.
2. Tag every export with `choo.repo`, `choo.workspace` and `choo.branch` resource attributes (percent-encoded). Project work also gets `choo.project` (the project's name), and a project thread's turns, or a workspace a thread started, get `choo.thread` (the thread's title). Tags come from `telemetryTags()` in `src/shared/projects.ts`.
3. Short export intervals (2s logs and traces, 10s metrics) so short turns don't drop data.
4. Never use the `console` exporter: stdout is the SDK's message channel.
5. Applies to chats, the advisor and reflection (everything that uses `agentEnv`).

6. Session usage graphs work the same for every workspace: repo workspaces, a project's or repo's orchestrator chat, project threads, and workspaces a thread started. Each place shows them in the right panel (More › Usage in a workspace; the Usage panel beside an orchestrator or thread, which has no branch of its own), the ⋯ menu's Usage and context, the Usage link after a turn, and ⌘K.

## Design

`Telemetry`, `DEFAULT_TELEMETRY`, `normalizeTelemetry` and `telemetryEnv()` in `src/shared/types.ts`; merged into `agentEnv` in `src/main/index.ts`; UI in `Modals.tsx`.

## Compliance, privacy and security

Data goes only to the endpoint the person sets. Raw API body logging (`OTEL_LOG_RAW_API_BODIES`) and detailed hook tracing are deliberately left out of the UI because they export the whole conversation; people can still set them in their shell.

## Testing

`test/telemetry.test.ts` covers the env builder and the project/thread tags.
