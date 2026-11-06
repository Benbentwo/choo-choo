# 0002: No oh-my-pi backend; port its agents instead

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Decided by | Ben |

## Context

Ben asked whether [oh-my-pi](https://github.com/can1357/oh-my-pi) (omp) is TOS-compliant and whether its SDK could power Choo Choo with a Claude subscription. omp's Anthropic "oauth" login uses the Pro/Max sign-in and then impersonates Claude Code (claude-cli User-Agent, `x-app: cli`, claude-code beta header, spoofed version pinning, cloaked metadata ids). omp has no way to drive the official `claude` binary.

## Decision

Don't use omp as a backend. omp with an API key or non-Anthropic providers is fine for people on their own, but Choo Choo won't ship it. Port omp's useful agents (scout, reviewer, security reviewer, quick worker, advisor) as opt-in features on the Agent SDK. See the [extra agents PRD](../prd/extra-agents.md).

## Consequences

- Adapted prompts carry omp's MIT notice in the source and in THIRD_PARTY_NOTICES.md.
- Contributors coming from omp should not bring over its provider or login code.

## Alternatives considered

- **omp with a Claude subscription**: not compliant.
- **omp with API keys only**: adds a second agent runtime for no gain over the Agent SDK.
