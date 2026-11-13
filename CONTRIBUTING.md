# Contributing to Choo Choo

Thanks for helping. Bug reports, feature ideas and pull requests are all welcome, and you don't need to ask before starting on something small.

## Ways to help

- **Report a bug:** open an issue with what you did, what you expected and what happened. Include your macOS version, chip (Apple silicon or Intel) and Choo Choo version, plus a screenshot if it's visual.
- **Suggest a feature:** open an issue describing the workflow you want. If Conductor already does it, say how it behaves there, since matching it is a goal.
- **Send a fix or feature:** for anything larger than a day's work, open an issue first so we can agree on the approach.

## Getting set up

You need macOS, Node 22+, git, and a Claude sign-in (see [Signing in](README.md#signing-in)). The `gh` CLI is needed for PR features.

```sh
git clone https://github.com/Benbentwo/choo-choo.git
cd choo-choo
npm install
npm run dev
```

Code layout:

- `src/main`: Electron main process. Agents (`agent.ts`, `codex.ts`), git and worktrees, terminals (`pty.ts`), storage.
- `src/preload`: the bridge the UI uses to call the main process.
- `src/renderer`: the React UI.
- `src/shared`: types shared by both sides.
- `test`: Vitest unit tests.

## Pull requests

1. Fork the repo and branch from `main`.
2. Keep each PR to one change, and add or update tests where it makes sense.
3. Run the same checks CI runs:
   ```sh
   npm run typecheck
   npm test
   npm run build
   ```
4. Describe what changed and why, and add a screenshot for UI changes.

PRs are labeled automatically from their branch name, title and files (start a title with "Fix", "Add" or "Docs", or a branch with `fix/`, `feat/` or `docs/`). The label decides where the change shows in the release notes, so a maintainer may adjust it.

CI builds the app on macOS for both Apple silicon and Intel. A maintainer reviews and squash-merges.

## Adding an integration

Write `src/main/integrations/<name>.ts` exporting a `Provider` (see `index.ts`), sign in with `startLoopback` and `pkce` from `oauth.ts` (or `mcpOAuth.ts` for a hosted MCP server), store the result with `setAuth` from `tokens.ts`, and add it to the `providers` list. Integrations sign in with OAuth, never pasted tokens ([decision 0003](docs/decisions/0003-oauth-for-integrations.md)).

## Ground rules

- **Use official Claude access only.** Agents must run through the Claude Agent SDK and the bundled Claude Code binary, or an Anthropic API key. We can't accept code that reuses a Claude subscription by imitating Claude Code or by reading its stored credentials, because Anthropic's terms forbid it. Other model providers are welcome through their own official CLIs or APIs.
- **No Conductor code or assets.** Matching Conductor's behaviour is fine; copying its code, icons, images or text is not.
- **No secrets.** Never commit API keys, tokens or signing certificates.
- **Third-party code:** if you adapt code from another project, check its license is compatible with MIT and add its notice to [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Using AI agents (Choo Choo included) to write your PR is fine. You're responsible for reviewing what it produced.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
