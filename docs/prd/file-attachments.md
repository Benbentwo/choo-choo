# PRD: Attach files to a message

| | |
|---|---|
| Status | Shipped (PR #162) |
| Requested by | Ben, 2026-11-23 (in-app comment on the message box) |
| Last updated | 2026-11-23 |

## Problem

The message box took pictures only (PNG, JPEG, GIF, WebP). Dropping any other file, such as a diagram or a spreadsheet export, did nothing, so the person had to find the path and type it.

> I should be able to drag and drop a file here (like an excalidraw) and see it attached and send it (with a message possibly) to the agent

## Goals

- Drop, paste or pick any file and see it attached before sending.
- Send it with or without a typed message.

## Non-goals

- Uploading or copying the file. The agent reads it from where it is.
- Previews of attached files.

## User experience

Drop a file on the message box, paste one copied from Finder, or pick one with the attach button. Pictures show as thumbnails as before. Any other file (or folder) shows as a chip with its name, its full path on hover, and an × to remove it. Send works with only a file attached. The sent message ends with the list of paths, and the agent reads the files with its usual tools.

## Requirements

1. PNG, JPEG, GIF and WebP files under 5 MB are sent as images, as before.
2. Any other file is attached by its absolute path, shown as a removable chip above the text.
3. The same file is attached once; at most 20 files per message.
4. With nothing typed, the message reads "See the attached file." followed by the paths.
5. The attach button picks any file, not only images.

## Design

- `src/shared/attachments.ts`: `INLINE_IMAGE`, `addAttachedFiles`, `fileName`, `withAttachedFiles` (adds "Attached files (read them from these paths):" and one line per path to the text).
- `Api.pathForFile(file)` in the preload wraps Electron's `webUtils.getPathForFile`. A file with no path (a pasted screenshot of an unsupported type) is skipped.
- `Composer.tsx` keeps the paths in state next to the images and builds the text on send. Nothing changes in the main process: paths travel in the message text, so steering, queueing, Up next and Codex chats work unchanged.

## Compliance, privacy and security

- Claude access is unchanged: the message goes through the Agent SDK as text.
- Only the path leaves the renderer. The agent reads the file under the chat's permission setting, so a file outside the workspace can raise a permission prompt in the stricter modes.

## Testing

`test/attachments.test.ts` covers the message text, de-duplication, the cap and file names. Manual: `npm run dev`, drop a non-image file on the message box, check the chip, send, and check the agent reads it. The README GIF comes from the `file-attachments` scene in `scripts/demo/record.cjs`, which picks files with the attach button, removes one and sends the rest. Drag and drop from Finder can't be driven there, so check it by hand.

## Rollout

On for everyone; no setting and no migration.

## Future work

- Keep attachments with the draft when switching chats.
- Show attached files as chips in the sent message.
