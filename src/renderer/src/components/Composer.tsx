import { useEffect, useMemo, useRef, useState } from 'react'
import type { Chat, Effort, ModelId, SlashCommandInfo, Workspace } from '@shared/types'
import { useStore, reportError } from '../store'
import { IconDown, IconPlus, IconStop, IconUp, IconX } from '../icons'
import { applyCompletion, findTrigger, rank, type Trigger } from '../autocomplete'

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
]
export const EFFORTS: Effort[] = ['low', 'medium', 'high']

// Drafts survive switching tabs.
const drafts: Record<string, string> = {}
const draftListeners = new Set<(chatId: string) => void>()

export function setDraft(chatId: string, text: string) {
  drafts[chatId] = text
  for (const l of draftListeners) l(chatId)
}

export function Composer({ chat, ws }: { chat: Chat; ws: Workspace }) {
  const [text, setTextState] = useState(drafts[chat.id] ?? '')
  const [picker, setPicker] = useState(false)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [sel, setSel] = useState(0)
  const [files, setFiles] = useState<string[] | null>(null)
  const [commands, setCommands] = useState<SlashCommandInfo[] | null>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const running = chat.status === 'running'

  const setText = (t: string) => {
    drafts[chat.id] = t
    setTextState(t)
  }

  useEffect(() => {
    setTextState(drafts[chat.id] ?? '')
    setTrigger(null)
    ta.current?.focus()
  }, [chat.id])

  useEffect(() => {
    const l = (id: string) => id === chat.id && setTextState(drafts[id] ?? '')
    draftListeners.add(l)
    return () => {
      draftListeners.delete(l)
    }
  }, [chat.id])

  useEffect(() => {
    setFiles(null)
    setCommands(null)
  }, [ws.id])

  // Load candidates lazily the first time a trigger appears.
  useEffect(() => {
    if (trigger?.kind === '@' && !files) void window.api.listFiles(ws.id).then(setFiles, () => setFiles([]))
    if (trigger?.kind === '/' && !commands) void window.api.listCommands(ws.id).then(setCommands, () => setCommands([]))
  }, [trigger?.kind, ws.id])

  const options = useMemo(() => {
    if (!trigger) return []
    if (trigger.kind === '@') return rank(files ?? [], trigger.query).map((f) => ({ value: f, label: f, hint: '' }))
    const cmds = commands ?? []
    const names = rank(
      cmds.map((c) => c.name),
      trigger.query,
      10
    )
    return names.map((n) => ({ value: n, label: `/${n}`, hint: cmds.find((c) => c.name === n)?.description ?? '' }))
  }, [trigger, files, commands])

  const updateTrigger = (value: string, caret: number) => {
    const t = findTrigger(value, caret)
    setTrigger(t)
    setSel(0)
  }

  const complete = (value: string) => {
    if (!trigger || !ta.current) return
    const r = applyCompletion(text, ta.current.selectionStart, trigger, value)
    setText(r.text)
    setTrigger(null)
    requestAnimationFrame(() => {
      ta.current?.setSelectionRange(r.caret, r.caret)
      ta.current?.focus()
    })
  }

  const submit = async () => {
    const t = text.trim()
    if (!t || running) return
    setText('')
    setTrigger(null)
    try {
      await window.api.sendMessage(chat.id, t)
    } catch (e) {
      reportError(e)
    }
  }

  const update = async (patch: Partial<Pick<Chat, 'model' | 'effort'>>) => {
    useStore.getState().upsertChat(await window.api.updateChat(chat.id, patch))
  }
  const addFolder = async () => useStore.getState().upsertChat(await window.api.addChatFolder(chat.id))
  const removeFolder = async (d: string) => useStore.getState().upsertChat(await window.api.removeChatFolder(chat.id, d))

  const model = MODELS.find((m) => m.id === chat.model)?.label ?? chat.model
  const showPopup = trigger && options.length > 0

  return (
    <div className="shrink-0 px-8 pb-5">
      <div className="relative mx-auto max-w-3xl rounded-xl border border-line bg-panel focus-within:border-faint">
        {showPopup && (
          <div className="absolute right-0 bottom-full left-0 z-30 mb-2 max-h-72 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-xl">
            {options.map((o, i) => (
              <button
                key={o.value}
                onMouseDown={(e) => {
                  e.preventDefault()
                  complete(o.value)
                }}
                onMouseEnter={() => setSel(i)}
                className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${i === sel ? 'bg-hover' : ''}`}
              >
                <span className={`truncate ${trigger.kind === '@' ? 'font-mono text-[12px]' : ''}`}>{o.label}</span>
                {o.hint && <span className="flex-1 truncate text-right text-[11px] text-faint">{o.hint}</span>}
              </button>
            ))}
          </div>
        )}
        {(chat.additionalDirectories?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {chat.additionalDirectories!.map((d) => (
              <span key={d} className="flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 font-mono text-[11px] text-muted" title={d}>
                {d.split('/').pop()}
                <button className="hover:text-fg" onClick={() => void removeFolder(d)}>
                  <IconX width={10} height={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            updateTrigger(e.target.value, e.target.selectionStart)
          }}
          onClick={(e) => updateTrigger(text, e.currentTarget.selectionStart)}
          onBlur={() => setTimeout(() => setTrigger(null), 100)}
          onKeyDown={(e) => {
            if (showPopup) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                return setSel((sel + 1) % options.length)
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                return setSel((sel - 1 + options.length) % options.length)
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                return complete(options[sel].value)
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                return setTrigger(null)
              }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
            if (e.key === 'Escape' && running) void window.api.stopChat(chat.id)
          }}
          rows={3}
          placeholder="Ask to make changes, @mention files, run /commands"
          className="selectable block max-h-72 w-full resize-none bg-transparent px-4 pt-3 text-[13px] outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-2 px-3 pb-2.5">
          <div className="relative">
            <button className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-hover" onClick={() => setPicker(!picker)}>
              <span>{model}</span>
              <span className="text-muted capitalize">{chat.effort}</span>
              <IconDown className="text-faint" />
            </button>
            {picker && (
              <div className="absolute bottom-8 left-0 z-20 w-48 rounded-lg border border-line bg-raised p-1 shadow-xl" onMouseLeave={() => setPicker(false)}>
                <div className="px-2 py-1 text-[11px] text-faint">Model</div>
                {MODELS.map((m) => (
                  <button key={m.id} onClick={() => void update({ model: m.id })} className={`block w-full rounded px-2 py-1 text-left hover:bg-hover ${chat.model === m.id ? 'text-fg' : 'text-muted'}`}>
                    {chat.model === m.id ? '✓ ' : '  '}
                    {m.label}
                  </button>
                ))}
                <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-[11px] text-faint">Effort</div>
                {EFFORTS.map((e) => (
                  <button key={e} onClick={() => void update({ effort: e })} className={`block w-full rounded px-2 py-1 text-left capitalize hover:bg-hover ${chat.effort === e ? 'text-fg' : 'text-muted'}`}>
                    {chat.effort === e ? '✓ ' : '  '}
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1" />
          <button className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title="Add folder" onClick={() => void addFolder()}>
            <IconPlus />
          </button>
          {running ? (
            <button className="rounded-md bg-fg p-1.5 text-bg hover:opacity-90" title="Stop (Esc)" onClick={() => void window.api.stopChat(chat.id)}>
              <IconStop />
            </button>
          ) : (
            <button className="rounded-md bg-fg p-1.5 text-bg hover:opacity-90 disabled:opacity-30" disabled={!text.trim()} title="Send (Enter)" onClick={() => void submit()}>
              <IconUp />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
