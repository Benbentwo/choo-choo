# 0021: Restarts wait for running chats, and cut-off turns resume their session

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Decided by | Claude, for Ben (he asked for sessions that survive a restart, or a restart that waits until none are running, and left the choice to us) |

## Context

"Restart to update" quit the app at once. Each chat's turn runs in a Claude Code process the Agent SDK starts as a child of the app, so quitting stopped every turn mid-way and the chat just said "Stopped". The work isn't lost on disk, though: Claude Code writes the session transcript as it goes, and the SDK can start a new turn in the same session (`resume: <session id>`), which is how every follow-up message already works.

Updates aren't the only way a turn gets cut off: quitting, a crash, or `npm run dev` rebuilding the main process do the same.

## Decision

Do both:

1. **Restart when idle.** Installing an update that restarts the app waits while any chat is running, then restarts the moment the last one finishes. The card says how many are running and offers **Restart now** and **Cancel**.
2. **Resume on launch.** Before quitting, running chats are marked as interrupted; a chat still saved as running at launch counts too (crash). On the next launch each one gets a fixed message, in its own session, telling Claude its turn was cut off and to carry on after checking the state of what it was doing. On by default, with a switch in Settings > Updates.

## Consequences

- Updating never loses a turn, even with Restart now, and a crash or a quit no longer leaves work half done until someone notices.
- The resumed turn starts from the last thing Claude Code saved. A command that was running (tests, a build) was killed and has to run again; the message tells Claude so.
- A long-running chat can keep the restart waiting. The person can always pick Restart now, and an update that's downloaded still installs on the next quit.
- Automations and Up next can still start chats while a restart waits, so a very busy app might not reach idle. Watch for that; holding automatic starts while waiting is the follow-up.

## Alternatives considered

- **Keep agent processes alive across the restart** (detach them, reattach after): the SDK's process speaks over stdio to the app that started it, so a new app can't pick up the stream, and permission prompts and tools that call back into the app (orchestrator, add-ons) would hang. It would also mean leaving processes running with no UI. Resuming the saved session gets the same result with supported SDK features.
- **Only wait, never resume**: doesn't help with crashes or quits, and Restart now would still lose the turn.
- **Only resume, never wait**: works, but costs a repeated step (a killed test run starts over) on every update for no reason when waiting a minute would avoid it.
