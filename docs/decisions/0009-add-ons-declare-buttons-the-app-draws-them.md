# 0009: Add-ons declare buttons in named places; the app draws them

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Decided by | Ben asked for add-ons to add buttons to the app (2026-11-10: "buttons on a workspace, near the 'create PR button' etc. creating the framework for extension") and chose all five places. Claude (project thread) chose how, building on [0006](0006-add-ons-are-claude-code-plugins.md) and [0007](0007-add-on-tools-run-in-a-background-page.md). |

## Context

Until now an add-on could only fill a frame of its own: a page in the sidebar, a page under a project, a tab beside a workspace. It could not touch the app's own interface, so it could not put a button where the work happens, such as next to Create PR or on a workspace's row.

Add-ons come from anywhere, including private repos the app's authors never see. What makes one safe to turn on is that its code runs only inside a sandboxed frame and reaches the app through a permission-checked API ([0006](0006-add-ons-are-claude-code-plugins.md)). Letting add-on code or markup into the app window would end that: the window has the preload bridge, every workspace, and the person's trust in what its buttons do.

## Decision

1. The app has a fixed list of **places** where add-ons may have buttons: `workspace-header`, `workspace-row`, `project-row`, `view-row` and `palette`.
2. An add-on lists its buttons in the manifest (`actions`): an id, a title, a place, an icon **named from the app's own set**, and optionally one of its views to open. Nothing else. No markup, no image, no script, no style.
3. The app draws every button, with its own components, and says in the tooltip which add-on it comes from.
4. A press is a message. It goes to the view the button names, which the app opens first, or to the add-on's background page. It carries the button's id, the place, and the ids of the project and workspace it was pressed on. What happens next is ordinary add-on code using the host API with the permissions the person granted.
5. Buttons need the `ui:buttons` permission and are listed, with their places, before the add-on is turned on. One add-on gets at most 2 buttons per place and 8 in the palette.
6. A new place is added to the app, never by an add-on.

## Consequences

- A button from an add-on can't look like something it isn't, can't run code in the app window, and can't do more than the add-on could already do from its own view.
- The set of buttons is known without running add-on code, so the permissions panel can show it and an update that adds buttons is reviewed like any other change.
- Add-on authors get no pixel-level control. A button can't be hidden, disabled, renamed or given a count while the app runs. If that is needed, it will be a host API method that sets a few plain fields, checked like every other call.
- Each new place is a small change to the app and its docs. Add-ons can't invent places, so the app stays recognisable with many add-ons on.
- Several add-ons share each place. The per-place limit keeps one from crowding it; many add-ons could still fill a header, which would call for an overflow menu.

## Alternatives considered

- **A frame in the place of each button** (the add-on renders its own button in a tiny sandboxed frame): full freedom for authors, but dozens of frames in the sidebar, buttons that don't match the app or each other, and a frame can draw anything, including a fake Create PR.
- **Let add-ons inject components or CSS into the app window**: what browser-style extensions do. It gives up the sandbox, and every app release would break someone's add-on.
- **Buttons only inside the add-on's own views**: what there was. It keeps add-ons out of the places where people actually work.
- **Add-on supplied icons** (an SVG file from the add-on, drawn as an image): safe as an image, but it can't follow the theme's colors and invites look-alike icons. The app's set can grow instead.
