# 0014: Automations get their own page; GitHub events are polled

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Decided by | Ben |

## Context

Automations are checks that run by themselves and open a workspace per finding. Two placements were mocked up: inside each project (listed in its Threads panel, always posting to the project), or on their own page next to Pull requests, where each automation picks where results go. Some checks, like fixing red CI, don't belong to any project. Choo Choo also has no server ([0004](0004-no-server-git-for-sharing.md)), so nothing can receive a webhook.

## Decision

- Automations live on their own page in the top nav. Each one targets a project (its runs post in a thread there) or a repo (a chat on the repo's orchestrator).
- GitHub events come from polling the PR inbox every two minutes while the app is open, and fire only on change.
- The app, not the agent, enforces the per-run cap and the ledger of findings already handled, through `start_workspace`'s `finding_id`.

## Consequences

- Checks that span no project still work, and project checks still post in the project.
- Runs happen only while Choo Choo is open; a schedule missed while closed runs once on the next start. Instant triggers and closed-app runs wait for cloud runs.
- Any trigger we add later only has to produce a reason and some context for the run prompt; the run itself stays the same.

## Alternatives considered

- **Inside each project**: every automation would need a project, and repo-only checks would need a fake one.
- **Webhooks through a relay**: needs a server, which 0004 rules out.
