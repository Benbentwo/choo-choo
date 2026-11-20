# 0023: Projects are on by default

| | |
|---|---|
| Status | Accepted; changes the "ship behind Settings › Experimental" line of [0013](0013-project-threads.md) |
| Date | 2026-11-20 |
| Decided by | Ben |

## Context

Projects (threads, orchestrator routing, the project › repo › PR sidebar, Automations) shipped behind Settings › Experimental in PR #79 so the Conductor layout stayed the same for everyone else. Ben has used them daily since and finds them the most helpful part of the app.

## Decision

- Projects are on for everyone unless they turned them off. `DEFAULT_SETTINGS.experimentalProjects` is `true`, so people who never touched the switch get projects, and anyone who switched it off keeps it off.
- The switch moves to Settings › Projects as "Project threads", next to "Resolve finished threads". The Experimental section is gone until something new needs it.
- The stored key keeps its name, `experimentalProjects`, so earlier opt-outs still count.

## Consequences

- New installs see project groups as projects, the Threads panel and the Automations page from the start.
- Turning the switch off still brings back the old Project groups list and pauses automations; nothing is deleted.
- Code checking the flag should read it from merged settings (main and renderer both merge `DEFAULT_SETTINGS`) or treat a missing value as on.

## Alternatives considered

- **Rename the key to `projects`:** cleaner, but would need a migration to keep opt-outs, for no visible gain.
- **Keep it Experimental and only change the default:** an "Experimental, on by default" switch reads as unfinished.
