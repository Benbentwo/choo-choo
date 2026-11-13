# README GIFs

The GIFs in the README (`docs/media/gifs/`) are recorded from the real, built app, not mocked up. Any user-facing feature should add a GIF or update the one it changes, in the same PR.

## How recording works

`scripts/demo/record.cjs` launches the built Electron app under Playwright, drives it like a person would (a drawn pointer, typed messages, clicks), records a video and turns it into a GIF with ffmpeg. Each run starts from a throwaway world (`scripts/demo/setup.sh`): a fake `HOME` with two small sample repos, `trailhead-web` and `trailhead-api`, each with a local bare `origin`, added to the app as the project "Trip checkout".

No model is called. `scripts/demo/bin/` goes first on the app's `PATH`, and Settings is set to use the installed Claude Code, so the app runs these stand-ins:

- `bin/claude` speaks enough of the Agent SDK's stream-json protocol to replay scripted turns. A turn is picked by matching the prompt against `match` regexes in a script under `scripts/demo/scripts/`. Steps stream text, show tool calls (a `writeFile` really writes the file, so Changes and diffs are real), and can call the app's own MCP tools (`"mcp": "choo"`), so `send_to_thread` and `start_workspace` really create threads, branches and worktrees. The app's naming prompts get titles from the script's `titles`.
- `bin/gh` answers the PRs page searches from a JSON file and fails everything else.
- `CHOO_DEMO_UPDATE` (a scene's `update` option, read by `src/main/updater.ts` in source builds only) gives the app a made-up downloaded update and release list, so the update card and What's new show without GitHub. Restarting just shows "Restarting…".

A scene gets a second argument, `relaunch()`, which closes the app and opens it again on the same world (the `resume-after-restart` scene uses it to cut a turn off). Scenes with `opts: { noGif: true }` only take screenshots.

Everything else (sidebar, worktrees, diffs, split panes) is the app's own code.

## Recording

```sh
npm run build
npm i -g playwright   # or anything that puts playwright on NODE_PATH
NODE_PATH=$(npm root -g) xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/demo/record.cjs            # every scene
NODE_PATH=$(npm root -g) xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/demo/record.cjs prs-page   # one scene
```

On a Mac, drop `xvfb-run …` and run `node scripts/demo/record.cjs` (a window will open). `CHOO_DEMO_SHOTS=<dir>` also saves the screenshots a scene asks for with `d.shot('name')`, which is the quickest way to check a scene while writing it. Recording works in a Linux cloud container too; there the terminal panel is closed because `node-pty` isn't built for Electron.

## Adding a scene

1. Add a scene to `scenes` in `record.cjs`. `d.click(locator)` moves the pointer there and clicks, `d.type(text)` types, `d.menu('toggle-right')` runs an app menu command, `d.side(text)` finds a sidebar row.
2. If agents talk, add a script in `scripts/demo/scripts/` and pass it as `script`. Put more specific `match` patterns first; the first match wins.
3. Keep it short (about 15 to 30 seconds) and the file small (under about 5 MB): GIFs are 1000 px wide at 8 fps. Trim waits rather than lowering quality.
4. Use only made-up names: the Trailhead sample repos, people like `maya-chen`, and avatars drawn as letter tiles (the recorder never fetches real GitHub avatars).
5. Embed it in the README next to the feature's bullet, with alt text that says what happens.
