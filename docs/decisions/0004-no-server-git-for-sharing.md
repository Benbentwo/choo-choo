# 0004: No Choo Choo server; share through the repo's git remote

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Decided by | Shared sessions thread, Ben's request |

## Context

Shared sessions need somewhere to put a workspace snapshot and chats that a coworker can fetch. Running a server means accounts, hosting, cost and a new place for code and transcripts to leak.

## Decision

A share is one commit pushed to a hidden ref, `refs/choo-choo/shares/<id>`, in the repo's own `origin`. Whoever can read the repo can open the share; nobody else can. Choo Choo has no server and no accounts.

## Consequences

- Access control is the repo's access control. A share in a public repo is public, and the UI says so.
- Works with any git host the person can push to.
- Updates are pull-based (30-second polling), not real-time.
- Future collaboration features should extend this mechanism before considering a server.

## Alternatives considered

- **Gists**: anyone with the link can read them.
- **A hosted relay**: cost, accounts, and a new trust boundary.
