# Example add-ons

This folder is an add-on source: a Claude Code plugin marketplace whose plugins also carry a `choo-choo.addon.json`. Use it to see how an add-on is put together, or copy it to start your own (public or in a private repo for your team).

## Try it

In Choo Choo, open Settings › Add-ons, paste the full path to this folder into **Add source**, install **Workspace board**, and turn it on. It adds:

- **Board** in the sidebar: every workspace as a card, in columns by what it's doing.
- **Board** under each project: the same for one project, with a box to start a new workspace.
- **Notes** as a tab beside each workspace.
- Two tools for the orchestrator, `board_summary` and `set_note`, so you can ask it "leave a note on each workspace saying what's left".

## What's in an add-on

```
workspace-board/
  .claude-plugin/plugin.json   the Claude Code plugin manifest
  choo-choo.addon.json         what it adds to Choo Choo, and the permissions it needs
  ui/board.html                a view; loads /@choo/host.js to get window.choo
  ui/notes.html
  ui/background.html           runs unseen while the add-on is on; answers the orchestrator's tools
  ui/base.css                  uses the --choo-* theme variables
```

The manifest and every `window.choo` method are described in [docs/addon-api.md](../../docs/addon-api.md).
