import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, normalizeExtras, normalizeTelemetry, type AppState, type ChatItem } from '@shared/types'

const dir = () => join(app.getPath('userData'), 'data')
const chatDir = () => join(dir(), 'chats')

function writeAtomic(file: string, data: unknown) {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(data))
  renameSync(tmp, file)
}

let state: AppState = { repos: [], workspaces: [], chats: [], settings: { ...DEFAULT_SETTINGS } }
const items = new Map<string, ChatItem[]>()
const dirty = new Set<string>()
let stateDirty = false
let timer: NodeJS.Timeout | null = null

export function load(): AppState {
  mkdirSync(chatDir(), { recursive: true })
  const f = join(dir(), 'state.json')
  if (existsSync(f)) state = { ...state, ...JSON.parse(readFileSync(f, 'utf8')) }
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings }
  state.settings.extras = normalizeExtras(state.settings.extras)
  state.settings.telemetry = normalizeTelemetry(state.settings.telemetry)
  // A chat cannot still be running after a restart.
  for (const c of state.chats) if (c.status === 'running') c.status = 'idle'
  return state
}

export const get = () => state

export function save() {
  stateDirty = true
  schedule()
}

export function chatItems(chatId: string): ChatItem[] {
  let list = items.get(chatId)
  if (!list) {
    const f = join(chatDir(), `${chatId}.json`)
    list = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as ChatItem[]) : []
    items.set(chatId, list)
  }
  return list
}

export function upsertItem(chatId: string, item: ChatItem) {
  const list = chatItems(chatId)
  const i = list.findIndex((x) => x.id === item.id)
  if (i >= 0) list[i] = item
  else list.push(item)
  dirty.add(chatId)
  schedule()
}

export function replaceItems(chatId: string, list: ChatItem[]) {
  items.set(chatId, list)
  dirty.add(chatId)
  schedule()
}

export function deleteChatItems(chatId: string) {
  items.delete(chatId)
  rmSync(join(chatDir(), `${chatId}.json`), { force: true })
}

function schedule() {
  if (timer) return
  timer = setTimeout(flush, 500)
}

export function flush() {
  if (timer) clearTimeout(timer)
  timer = null
  if (stateDirty) writeAtomic(join(dir(), 'state.json'), state)
  stateDirty = false
  for (const id of dirty) {
    const list = items.get(id)
    if (list) writeAtomic(join(chatDir(), `${id}.json`), list)
  }
  dirty.clear()
}
