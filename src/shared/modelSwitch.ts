import type { ChatItem, ModelId } from './types'

export type ModelItem = Extract<ChatItem, { kind: 'model' }>

/** What to do to the transcript: add or update one divider, or drop one. */
export type ModelSwitchChange = { put: ModelItem } | { remove: string } | null

/**
 * The person picked another model. Adds a "switched to model X" divider, or, when the last thing in
 * the chat is already a divider nobody has sent a message after, updates it (or drops it when they
 * switch back). A chat with nothing in it yet needs no divider.
 */
export function onModelPicked(items: ChatItem[], from: ModelId, to: ModelId, id: string, ts: number): ModelSwitchChange {
  if (from === to || !items.length) return null
  const last = items[items.length - 1]
  if (last.kind === 'model' && !last.resolved) {
    if ((last.from ?? from) === to) return { remove: last.id }
    return { put: { ...last, model: to, ts } }
  }
  return { put: { id, kind: 'model', model: to, from, ts } }
}

/**
 * Claude Code reported the model a turn runs on. Confirms the pending divider for the picked model,
 * or adds a divider when the model changed without one (e.g. an alias now points at a newer model).
 */
export function onModelReported(items: ChatItem[], picked: ModelId, reported: string, previous: string | undefined, id: string, ts: number): ModelSwitchChange {
  if (!reported) return null
  const pending = [...items].reverse().find((x): x is ModelItem => x.kind === 'model')
  if (pending && !pending.resolved && pending.model === picked) return { put: { ...pending, resolved: reported } }
  if (previous && previous !== reported) return { put: { id, kind: 'model', model: picked, resolved: reported, ts } }
  return null
}
