# 0016: Workspaces are in Build or Review mode, and the top right shows one next step

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-12 |
| Decided by | Ben (asked for less clutter and a review vs. development distinction you can switch); Claude (the design) |

## Context

The workspace header and right panel grew a button per feature: Review, a comments pill, a checks pill, the PR button and menu, an owner pill, split, phone, Claude desktop and usage icons. Who owns the PR already changed comment routing (PR #84), but only a pill showed it, and you couldn't override it when collaborating on a coworker's PR.

## Decision

- Every workspace has a mode, **Build** or **Review**. It defaults from PR ownership (Review on someone else's open PR) and the person can switch it per workspace.
- The mode, not ownership, drives line-comment defaults, "don't push" wording to the agent, the right panel's tabs and the primary button.
- The top right is one PR chip plus one primary button for the next step; everything else lives in that button's menu, the ⋯ workspace menu, More tabs or shortcuts.

## Consequences

- New PR or workspace actions go into a menu by default. A new always-visible button needs a reason it beats the next-step button.
- New features that differ for builders and reviewers should read `useWorkspaceMode` rather than `isTheirs`.
- Review mode doesn't sandbox the agent; it relies on prompts, as before.
