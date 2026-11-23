import { useEffect, useMemo, useRef, useState } from 'react'
import { useWorkspaceMode } from '../prReview'
import { inOpenFence } from '../markdown'
import type { Chat, Effort, ExtraAgentId, ModelId, OutputStyleInfo, Permission, SlashCommandInfo, Workspace } from '@shared/types'
import { useStore, reportError, modelLabel, setCodeComments, codeCommentsMessage, destOf, reviewTarget, openDoc } from '../store'
import { IconDown, IconFile, IconImage, IconPlus, IconStop, IconUp, IconX } from '../icons'
import { applyCompletion, findTrigger, rank, type Trigger } from '../autocomplete'
import { FORCE_STOP_AFTER_MS } from '@shared/stop'
import { INLINE_IMAGE, addAttachedFiles, fileName, withAttachedFiles } from '@shared/attachments'
import { MarkdownInput, type MarkdownInputHandle } from './MarkdownInput'

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'opus', label: 'Opus' },
  { id: 'fable', label: 'Fable' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' },
  { id: 'codex', label: 'Codex' }
]
export const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const EFFORT_LABEL: Record<Effort, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
/** Agents you can @mention, with the Settings key that enables each. */
export const AGENT_MENTIONS: { name: string; id: ExtraAgentId; hint: string }[] = [
  { name: 'scout', id: 'scout', hint: 'Fast read-only codebase search' },
  { name: 'reviewer', id: 'reviewer', hint: 'Review the current changes for bugs' },
  { name: 'security-reviewer', id: 'securityReviewer', hint: 'Look for security problems' },
  { name: 'quick-worker', id: 'quickWorker', hint: 'Cheap worker for mechanical edits' }
]
export const PERMISSIONS: { id: Permission; label: string }[] = [
  { id: 'full', label: 'Full access' },
  { id: 'auto', label: 'Auto (Claude Code decides)' },
  { id: 'edits', label: 'Ask for commands' },
  { id: 'ask', label: 'Ask for edits and commands' }
]

// Drafts survive switching tabs.
const drafts: Record<string, string> = {}
const draftListeners = new Set<(chatId: string) => void>()

export function setDraft(chatId: string, text: string) {
  drafts[chatId] = text
  for (const l of draftListeners) l(chatId)
}

/** Puts text back in a chat's message box, after anything already typed there. */
export function appendDraft(chatId: string, text: string) {
  const cur = drafts[chatId]?.trim()
  setDraft(chatId, cur ? `${cur}\n\n${text}` : text)
}

/** Stops the chat's turn; pressing again while it is stopping kills it right away. */
export function stopChat(chat: Chat) {
  return window.api.stopChat(chat.id, chat.stopping ? { force: true } : undefined).catch(reportError)
}

/**
 * The Stop button. It turns into "Stopping…" the moment it's pressed, and if the turn still hasn't
 * ended a few seconds later, into "Force stop".
 */
function StopButton({ chat, subtle }: { chat: Chat; subtle: boolean }) {
  const [pressedAt, setPressedAt] = useState<number | null>(null)
  const since = chat.stopping ?? pressedAt
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [since])
  if (!since)
    return (
      <button
        className={`rounded-md p-1.5 hover:opacity-90 ${subtle ? 'border border-line text-muted hover:text-fg' : 'bg-fg text-bg'}`}
        title="Stop (Esc)"
        data-testid="stop-button"
        onClick={() => {
          setPressedAt(Date.now())
          void stopChat(chat)
        }}
      >
        <IconStop />
      </button>
    )
  const slow = now - since >= FORCE_STOP_AFTER_MS
  return (
    <button
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] ${slow ? 'bg-del/15 text-del hover:bg-del/25' : 'border border-line text-muted hover:text-fg'}`}
      title={slow ? 'Claude is taking a while to stop. Click to kill it and everything it started now. (Esc)' : 'Stopping… Click again to force stop. (Esc)'}
      data-testid="stop-button"
      data-stopping={slow ? 'slow' : 'yes'}
      onClick={() => void window.api.stopChat(chat.id, { force: true }).catch(reportError)}
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
      {slow ? 'Force stop' : 'Stopping…'}
    </button>
  )
}

export function Composer({ chat, ws }: { chat: Chat; ws: Workspace }) {
  const limited = useStore((s) => !!s.usageLimit)
  const { mode } = useWorkspaceMode(ws)
  const [text, setTextState] = useState(drafts[chat.id] ?? '')
  const [picker, setPicker] = useState(false)
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [sel, setSel] = useState(0)
  const [files, setFiles] = useState<string[] | null>(null)
  const [commands, setCommands] = useState<SlashCommandInfo[] | null>(null)
  const [images, setImages] = useState<string[]>([])
  const allComments = useStore((s) => s.codeComments[ws.id]) ?? []
  // GitHub review drafts wait in the Review tab; only agent comments go with a chat message.
  const codeComments = allComments.filter((c) => destOf(c) === 'agent')
  const prReview = useStore((s) => s.prReview[ws.id])
  /** Paths of attached files that aren't pictures; the message lists them for the agent to read. */
  const [attached, setAttached] = useState<string[]>([])
  const hasContent = !!text.trim() || images.length > 0 || attached.length > 0 || codeComments.length > 0
  const [dragging, setDragging] = useState(false)
  const [goalOpen, setGoalOpen] = useState(false)
  const [goalText, setGoalText] = useState('')
  const [styles, setStyles] = useState<OutputStyleInfo[] | null>(null)
  const tasks = useStore((s) => s.tasks[chat.id]) ?? []
  const ta = useRef<MarkdownInputHandle>(null)
  /** The cursor sits inside a ``` block that isn't closed yet. */
  const [inCode, setInCode] = useState(false)
  const running = chat.status === 'running'
  const whileRunning = useStore((s) => s.settings.whileRunning ?? 'steer')
  const extras = useStore((s) => s.settings.extras)
  const claude = chat.model !== 'codex'
  const advisorOn = extras.advisor && chat.advisor !== false

  const setText = (t: string) => {
    drafts[chat.id] = t
    setTextState(t)
  }

  useEffect(() => {
    setTextState(drafts[chat.id] ?? '')
    setTrigger(null)
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
    setStyles(null)
  }, [ws.id])

  useEffect(() => {
    if (picker && claude && !styles) void window.api.listOutputStyles(ws.id).then(setStyles, () => setStyles([]))
  }, [picker, claude, ws.id])

  // Load candidates lazily the first time a trigger appears.
  useEffect(() => {
    if (trigger?.kind === '@' && !files) void window.api.listFiles(ws.id).then(setFiles, () => setFiles([]))
    if (trigger?.kind === '/' && !commands) void window.api.listCommands(ws.id).then(setCommands, () => setCommands([]))
  }, [trigger?.kind, ws.id])

  const options = useMemo(() => {
    if (!trigger) return []
    if (trigger.kind === '@') {
      const agents = claude ? AGENT_MENTIONS.filter((a) => extras.agents[a.id] && a.name.startsWith(trigger.query.toLowerCase())) : []
      return [
        ...agents.map((a) => ({ value: a.name, label: `${a.name} (agent)`, hint: a.hint })),
        ...rank(files ?? [], trigger.query).map((f) => ({ value: f, label: f, hint: '' }))
      ]
    }
    const cmds = [...(claude && extras.agents.quickWorker ? [{ name: 'quick', description: 'Hand a mechanical task to the quick worker' }] : []), ...(commands ?? [])]
    const names = rank(
      cmds.map((c) => c.name),
      trigger.query,
      10
    )
    return names.map((n) => ({ value: n, label: `/${n}`, hint: cmds.find((c) => c.name === n)?.description ?? '' }))
  }, [trigger, files, commands, extras, claude])

  const updateTrigger = (value: string, caret: number) => {
    const t = findTrigger(value, caret)
    setTrigger(t)
    setSel(0)
  }

  const complete = (value: string) => {
    if (!trigger || !ta.current) return
    const r = applyCompletion(text, ta.current.caret(), trigger, value)
    setText(r.text)
    setTrigger(null)
    requestAnimationFrame(() => {
      ta.current?.setCaret(r.caret)
      ta.current?.focus()
    })
  }

  /** Pictures go to the model as images; any other file is attached by its path. */
  const addFiles = (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      if (!INLINE_IMAGE.test(f.type)) {
        const path = window.api.pathForFile(f)
        if (path) setAttached((list) => addAttachedFiles(list, [path]))
        continue
      }
      if (f.size > 5 * 1024 * 1024) {
        reportError(new Error(`${f.name || 'Image'} is larger than 5 MB`))
        continue
      }
      const r = new FileReader()
      r.onload = () => setImages((imgs) => [...imgs, String(r.result)].slice(0, 10))
      r.readAsDataURL(f)
    }
  }

  const submit = async () => {
    const typed = text.trim() || (images.length && !attached.length && !codeComments.length ? 'See the attached image.' : '')
    const t = withAttachedFiles(codeComments.length ? codeCommentsMessage(codeComments, typed, reviewTarget(prReview, mode)) : typed, attached)
    if (!t) return
    const imgs = images
    setText('')
    setImages([])
    setAttached([])
    setTrigger(null)
    if (codeComments.length) setCodeComments(ws.id, (list) => list.filter((c) => destOf(c) !== 'agent'))
    try {
      await window.api.sendMessage(chat.id, t, imgs)
    } catch (e) {
      reportError(e)
    }
  }

  /** Sends a slash command as a message, such as /compact or /goal. */
  const command = async (cmd: string) => {
    setPicker(false)
    try {
      await window.api.sendMessage(chat.id, cmd)
    } catch (e) {
      reportError(e)
    }
  }
  const startGoal = async () => {
    const g = goalText.trim()
    if (!g || running) return
    setGoalOpen(false)
    setGoalText('')
    await command(`/goal ${g}`)
  }

  const update = async (patch: Partial<Pick<Chat, 'model' | 'effort' | 'planMode' | 'permission' | 'advisor' | 'fast' | 'budgetUsd' | 'outputStyle'>>) => {
    useStore.getState().upsertChat(await window.api.updateChat(chat.id, patch))
    // A model change adds, updates or drops the "switched to model" divider.
    if (patch.model) useStore.getState().setItems(chat.id, await window.api.getChatItems(chat.id))
  }
  const addFolder = async () => useStore.getState().upsertChat(await window.api.addChatFolder(chat.id))
  const removeFolder = async (d: string) => useStore.getState().upsertChat(await window.api.removeChatFolder(chat.id, d))

  const details = useStore((s) => s.modelDetails)
  const model = modelLabel(chat.model, details)
  const showPopup = trigger && options.length > 0

  return (
    <div className="shrink-0 px-8 pb-5">
      <div
        className={`relative mx-auto max-w-3xl rounded-xl border bg-panel focus-within:border-faint ${dragging ? 'border-sky-400' : chat.planMode ? 'border-amber-500/60' : 'border-line'}`}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
      >
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
        {claude && chat.goal && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]" title={chat.goal.lastReason ? `Latest check: ${chat.goal.lastReason}` : undefined}>
            <span className="text-emerald-400">◎ Goal</span>
            <span className="min-w-0 flex-1 truncate text-muted">{chat.goal.condition}</span>
            {chat.goal.iterations > 0 && <span className="shrink-0 text-faint">{chat.goal.iterations} checks</span>}
            {!running && (
              <button className="shrink-0 text-faint hover:text-fg" onClick={() => void command('/goal clear')}>
                Clear
              </button>
            )}
          </div>
        )}
        {claude && goalOpen && !chat.goal && (
          <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[12px]">
            <span className="shrink-0 text-emerald-400">Keep going until</span>
            <input
              autoFocus
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void startGoal()
                if (e.key === 'Escape') setGoalOpen(false)
              }}
              placeholder="all tests pass and lint is clean"
              className="selectable min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint"
            />
            <button className="shrink-0 rounded bg-fg px-2 py-0.5 text-bg disabled:opacity-30" disabled={!goalText.trim() || running} onClick={() => void startGoal()}>
              Start
            </button>
          </div>
        )}
        {tasks.length > 0 && (
          <div className="border-b border-line px-3 py-1.5 text-[12px]">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center gap-2 py-0.5">
                <span className="h-2 w-2 shrink-0 animate-spin rounded-full border-2 border-faint border-t-fg" />
                <span className="min-w-0 flex-1 truncate text-muted" title={t.summary ?? t.description}>
                  {t.description}
                  {t.summary && <span className="text-faint"> · {t.summary}</span>}
                </span>
                <button className="shrink-0 text-faint hover:text-del" onClick={() => void window.api.stopTask(chat.id, t.id).catch(reportError)}>
                  Stop
                </button>
              </div>
            ))}
          </div>
        )}
        {(chat.additionalDirectories?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {chat.additionalDirectories!.map((d) => (
              <span key={d} className="flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 font-mono text-[11px] text-muted" title={d}>
                {d.split('/').pop()}
                <button title="Remove folder" className="hover:text-fg" onClick={() => void removeFolder(d)}>
                  <IconX width={10} height={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {codeComments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {codeComments.map((c) => (
              <span key={c.id} className="flex max-w-[260px] items-center gap-1.5 rounded-md border border-accent/40 bg-raised px-2 py-0.5 text-[11px]" title={`${c.code}\n\n${c.text}`}>
                <button
                  className="shrink-0 font-mono text-muted hover:text-fg"
                  onClick={() => openDoc(ws.id, { kind: 'diff', path: c.file })}
                >
                  {c.file.split('/').pop()}:{c.start === c.end ? c.start : `${c.start}-${c.end}`}
                </button>
                <span className="truncate text-fg/80">{c.text}</span>
                <button title="Remove comment" className="shrink-0 text-faint hover:text-fg" onClick={() => setCodeComments(ws.id, (list) => list.filter((x) => x.id !== c.id))}>
                  <IconX width={10} height={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {images.map((src, i) => (
              <div key={i} className="group relative">
                <img src={src} className="h-14 w-14 rounded-md border border-line object-cover" />
                <button title="Remove image"
                  className="absolute -top-1.5 -right-1.5 hidden rounded-full bg-raised p-0.5 text-muted group-hover:block hover:text-fg"
                  onClick={() => setImages(images.filter((_, j) => j !== i))}
                >
                  <IconX width={10} height={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attached.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
            {attached.map((p) => (
              <span key={p} className="flex max-w-[260px] items-center gap-1.5 rounded-md bg-raised px-2 py-0.5 font-mono text-[11px] text-muted" title={p}>
                <IconFile width={11} height={11} className="shrink-0" />
                <span className="truncate">{fileName(p)}</span>
                <button title="Remove file" className="shrink-0 hover:text-fg" onClick={() => setAttached(attached.filter((x) => x !== p))}>
                  <IconX width={10} height={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        <MarkdownInput
          key={chat.id}
          ref={ta}
          className="text-[13px]"
          autoFocus
          value={drafts[chat.id] ?? ''}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files ?? [])
            if (!files.length) return false
            e.preventDefault()
            addFiles(files)
            return true
          }}
          onChange={(value, caret) => {
            setText(value)
            setInCode(inOpenFence(value.slice(0, caret)))
            updateTrigger(value, caret)
          }}
          onCaret={(value, caret, pointer) => {
            setInCode(inOpenFence(value.slice(0, caret)))
            if (pointer) updateTrigger(value, caret)
          }}
          onBlur={() => setTimeout(() => setTrigger(null), 100)}
          onKeyDown={(e) => {
            if (showPopup) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((sel + 1) % options.length)
                return true
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((sel - 1 + options.length) % options.length)
                return true
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                complete(options[sel].value)
                return true
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setTrigger(null)
                return true
              }
            }
            if (e.key === 'Tab' && e.shiftKey) {
              e.preventDefault()
              void update({ planMode: !chat.planMode })
              return true
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              // Inside an open ``` block Enter adds a line, as in an editor; ⌘Enter sends from anywhere.
              if (!e.metaKey && !e.ctrlKey && inOpenFence(text.slice(0, ta.current?.caret() ?? text.length))) return false
              e.preventDefault()
              void submit()
              return true
            }
            if (e.key === 'Escape' && running) void stopChat(chat)
            return false
          }}
          placeholder={limited && chat.model !== 'codex' ? "You're out of usage for this window. A message goes to Up next and is sent when it resets." : mode === 'review' ? "Ask about this PR, or click a line in a diff to comment" : running ? 'Steer Claude, or /btw to ask what it’s doing without interrupting' : 'Ask to make changes, @mention files, run /commands'}
        />
        {inCode && <div className="px-4 pt-1 text-[11px] text-faint">Code block · Enter adds a line · close it with ``` or press ⌘Enter to send</div>}
        <div className="flex items-center gap-2 px-3 pb-2.5">
          <div className="relative">
            <button className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-hover" onClick={() => setPicker(!picker)}>
              <span>{model}</span>
              <span className="text-muted">{EFFORT_LABEL[chat.effort] ?? chat.effort}</span>
              {claude && chat.fast && <span className="text-amber-400">· fast</span>}
              {claude && chat.permission === 'auto' && <span className="text-sky-400">· auto</span>}
              {claude && chat.permission && chat.permission !== 'full' && chat.permission !== 'auto' && <span className="text-sky-400">· asks</span>}
              <IconDown className="text-faint" />
            </button>
            {picker && (
              <div className="absolute bottom-8 left-0 z-20 max-h-[70vh] w-60 overflow-y-auto rounded-lg border border-line bg-raised p-1 shadow-xl" onMouseLeave={() => setPicker(false)}>
                <div className="px-2 py-1 text-[11px] text-faint">Model</div>
                {MODELS.map((m) => (
                  <button key={m.id} onClick={() => void update({ model: m.id })} className={`block w-full rounded px-2 py-1 text-left hover:bg-hover ${chat.model === m.id ? 'text-fg' : 'text-muted'}`}>
                    {chat.model === m.id ? '✓ ' : '  '}
                    {modelLabel(m.id, details)}
                    {details[m.id]?.description && <div className="pl-3.5 text-[11px] text-faint">{details[m.id]!.description}</div>}
                  </button>
                ))}
                <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-[11px] text-faint">Effort</div>
                {EFFORTS.map((e) => (
                  <button key={e} onClick={() => void update({ effort: e })} className={`block w-full rounded px-2 py-1 text-left hover:bg-hover ${chat.effort === e ? 'text-fg' : 'text-muted'}`}>
                    {chat.effort === e ? '✓ ' : '  '}
                    {EFFORT_LABEL[e]}
                  </button>
                ))}
                {chat.model !== 'codex' && (
                  <>
                    <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-[11px] text-faint">Permissions</div>
                    {PERMISSIONS.map((p) => (
                      <button key={p.id} onClick={() => void update({ permission: p.id })} className={`block w-full rounded px-2 py-1 text-left hover:bg-hover ${(chat.permission ?? 'full') === p.id ? 'text-fg' : 'text-muted'}`}>
                        {(chat.permission ?? 'full') === p.id ? '✓ ' : '  '}
                        {p.label}
                      </button>
                    ))}
                    <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-[11px] text-faint">Session</div>
                    <label className="flex w-full cursor-pointer items-center justify-between rounded px-2 py-1 text-muted hover:bg-hover" title="Faster output on models that support it, at a higher price per token">
                      Fast mode
                      <input type="checkbox" checked={!!chat.fast} onChange={(e) => void update({ fast: e.target.checked })} />
                    </label>
                    <label className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-muted hover:bg-hover" title="Stop a message's run once it has cost this much. Empty uses the default from Settings.">
                      Spend cap per message
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="w-16 rounded border border-line bg-bg px-1 text-right outline-none"
                        placeholder="none"
                        defaultValue={chat.budgetUsd || ''}
                        onBlur={(e) => void update({ budgetUsd: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <button className="block w-full rounded px-2 py-1 text-left text-muted hover:bg-hover disabled:opacity-40" disabled={running} onClick={() => void command('/compact')} title="Summarize the conversation so far to free up context">
                      Compact conversation
                    </button>
                    <div className="mt-1 border-t border-line px-2 pt-2 pb-1 text-[11px] text-faint">Output style</div>
                    {[{ name: '', description: "Claude Code's default", source: 'built-in' as const }, ...(styles ?? [])].map((st) => (
                      <button
                        key={st.name || 'default'}
                        onClick={() => void update({ outputStyle: st.name })}
                        className={`block w-full rounded px-2 py-1 text-left hover:bg-hover ${(chat.outputStyle ?? '') === st.name ? 'text-fg' : 'text-muted'}`}
                      >
                        {(chat.outputStyle ?? '') === st.name ? '✓ ' : '  '}
                        {st.name || 'Default'}
                        {st.description && <div className="truncate pl-3.5 text-[11px] text-faint">{st.description}</div>}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
          <button
            className={`rounded px-1.5 py-1 ${chat.planMode ? 'bg-amber-500/15 text-amber-400' : 'text-faint hover:bg-hover hover:text-fg'}`}
            title="Plan mode: the agent proposes a plan before editing (⇧Tab)"
            onClick={() => void update({ planMode: !chat.planMode })}
          >
            Plan
          </button>
          {claude && (
            <button
              className={`rounded px-1.5 py-1 ${chat.goal || goalOpen ? 'bg-emerald-500/15 text-emerald-400' : 'text-faint hover:bg-hover hover:text-fg'}`}
              title="Goal: Claude keeps working until a condition you set is met (Claude Code's /goal)"
              onClick={() => setGoalOpen(!goalOpen)}
            >
              Goal
            </button>
          )}
          {extras.advisor && (
            <button
              className={`rounded px-1.5 py-1 ${advisorOn ? 'bg-advisor/15 text-advisor' : 'text-faint hover:bg-hover hover:text-fg'}`}
              title={advisorOn ? 'Advisor on: a second model reviews each turn. Click to turn off for this chat.' : 'Advisor off for this chat. Click to turn on.'}
              onClick={() => void update({ advisor: !advisorOn })}
            >
              Advisor
            </button>
          )}
          <div className="flex-1" />
          <label className="cursor-pointer rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title="Attach images or files">
            <IconImage />
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          <button className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title="Add folder" onClick={() => void addFolder()}>
            <IconPlus />
          </button>
          {running && <StopButton key={chat.id} chat={chat} subtle={hasContent} />}
          {(!running || hasContent) && (
            <button className="rounded-md bg-fg p-1.5 text-bg hover:opacity-90 disabled:opacity-30" disabled={!hasContent} title={running ? (whileRunning === 'queue' ? 'Queue: send when Claude finishes (Enter)' : 'Steer: send now, Claude reads it at its next step (Enter)') : 'Send (Enter)'} onClick={() => void submit()}>
              <IconUp />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
