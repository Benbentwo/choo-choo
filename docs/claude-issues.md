# Claude issue to PR

A maintainer adds the `claude` label to an issue, and Claude writes a draft pull request for it. The workflow is [.github/workflows/claude-issue.yml](../.github/workflows/claude-issue.yml). It runs on Ben's Anthropic API credits through the official [Claude Code GitHub Action](https://code.claude.com/docs/en/github-actions).

## Using it

1. Read the issue. Its text goes to Claude, so only label issues whose text you'd hand to a coworker as-is. Edit out anything odd first.
2. Add the `claude` label. Only people with write access can start a run. Anyone else's label is ignored.
3. Within about 30 minutes, Claude opens a draft PR from `claude-issue/<number>` with the `claude-issue` label, or comments on the issue to say why it made no change. The run removes the `claude` label when it ends.
4. Review the PR like a stranger's. Then mark it ready and merge it yourself.

To retry or to try again after editing the issue, add the label again. The new run replaces the branch and updates the open PR.

## Never auto-merged

PRs labeled `claude-issue` (branches `claude-issue/*`) are never auto-merged, even with green CI. Our own project threads' PRs still merge on green CI, but these need a maintainer's review because they come from untrusted issue text. See [decision 0024](decisions/0024-issue-prs-are-sandboxed-and-reviewed.md).

## Restraints

The repo is public, so anyone can file an issue, and an issue can carry instructions aimed at Claude. Each restraint below limits what such text could do.

| Restraint | How |
|---|---|
| Only maintainers start it | Runs only on the `claude` label. The `gate` job checks that whoever added it has write, maintain or admin access. The action checks again. |
| Claude can't write to the repo | The `claude` job's token can only read. The checkout keeps no credentials. Claude's work leaves the job as a patch file. |
| Claude can only edit files | No shell, web or GitHub tools, and no subagents. It can't run commands or reach the network, so it can't run repo code or send anything out. Reads of `/proc`, `/sys`, `/etc`, `~/.claude`, `~/.config`, `~/.ssh`, the runner temp folder and `.git` are denied. (Not the whole home folder: the checkout lives under it.) |
| No other secrets | Only `ANTHROPIC_API_KEY` is referenced, and only by the `claude` job. Signing, notarization and Homebrew secrets are never available to this workflow. |
| Risky files are refused | The `publish` job (plain shell, no Claude) refuses a patch that touches `.github/`, `.claude/`, `.husky/`, `.mcp.json`, `.npmrc`, `CLAUDE.md` or `package-lock.json`. A changed workflow could otherwise reach secrets once merged, or a changed agent config could steer later agents. |
| Token-shaped text is refused | Added lines and the PR description are scanned for Anthropic and GitHub tokens and private keys. A match stops the run without printing the match, since logs on a public repo are public. |
| Build files are flagged | Changes to `package.json`, `scripts/`, `build/` or `electron-builder.yml` get a warning at the top of the PR. |
| Spend is capped | 40 turns and 30 minutes for the Claude job. One label starts one run, one run per issue at a time. |
| Drafts only | PRs open as drafts, assigned to whoever added the label. |

What's left: an injected issue can still ask for a bad change in ordinary code. The review catches that, which is why these PRs never auto-merge.

## CI on these PRs

Pushes and PRs made with a workflow's own token don't start other workflows. So after opening the PR, `publish` starts `ci.yml` and `codeql.yml` on the branch with `workflow_dispatch`. Their results show on the PR's checks. Claude can't run tests itself, so CI is its first test run.

## Setup (once, by Ben)

1. In the [Anthropic Console](https://console.anthropic.com), create a workspace for this (for example `choo-choo-issues`) and set its monthly spend limit. A workspace limit stops requests once it's reached, so runs can never cost more than that.
2. Under **Billing**, leave auto-reload off, so the account never buys credits beyond what's already there.
3. Create an API key in that workspace.
4. In GitHub, open the repo's **Settings › Secrets and variables › Actions**, choose **New repository secret**, name it `ANTHROPIC_API_KEY`, and paste the key.
5. In **Settings › Actions › General › Workflow permissions**, turn on **Allow GitHub Actions to create and approve pull requests**. The workflow token opens the PR, so it needs this. Leave the default permission at read.

The Claude GitHub App is not needed: the workflow uses its own job token so that Claude never holds a token that can push.

A small change costs cents (the first run on #152 cost about $0.05). Runs use Sonnet to stretch the credits (`--model` in the workflow) and are capped at 40 turns and 30 minutes. To stop runs, delete the secret or revoke the key in the Console.

## When a run does nothing

The issue comment shows Claude's description, or its last message if it wrote none. If the API call itself fails (an invalid key, no credit balance, a spend limit reached), the failure comment quotes the API's error. The `claude` job's "Collect the change as a patch" step lists every tool call the permission rules refused. The first run (#152) changed nothing because a `Read(~/**)` deny rule also covered the checkout, which lives under the runner's home folder; that rule is now narrowed.
