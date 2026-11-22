# 0024: PRs from labeled issues are sandboxed and never auto-merged

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-22 |
| Decided by | Ben |

## Context

Ben wanted issues turned into PRs automatically with the Claude Code GitHub Action and his subscription. The repo is public, so issue text is untrusted and can carry prompt injection. Our project threads auto-merge their own PRs once CI is green.

## Decision

- Claude starts only when someone with write access adds the `claude` label.
- Claude edits files in a read-only job with no shell, network or GitHub tools. A separate job without Claude checks the patch and opens a draft PR from `claude-issue/<n>`.
- The workflow can reach no secret but the Claude OAuth token, and refuses changes to workflows, agent config, `CLAUDE.md` and the lockfile.
- PRs labeled `claude-issue` are never auto-merged. A maintainer reviews and merges them. Threads leave them alone.

Details are in [claude-issues.md](../claude-issues.md).

## Consequences

- Claude can't run tests in the job; CI on the PR is its first run. Fixes that need a lockfile or workflow change get described in the PR instead of made.
- These PRs use the job token, so CI is started with `workflow_dispatch` rather than by the PR event.
- Runs share Ben's subscription limits.

## Alternatives considered

- **Run on every new issue**: anyone on the internet could spend the subscription and feed Claude text.
- **Let the action push and open PRs with the Claude GitHub App**: that token can push and change workflows, so an injected issue could add a workflow that reads the signing secrets.
- **Allow Bash so Claude can run tests**: running code from an untrusted request in a job that holds the OAuth token risks leaking it.
