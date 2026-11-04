import { useRef, useState } from 'react'
import type { Chat, Effort, ModelId, Workspace } from '@shared/types'
import { useStore, reportError } from '../store'
import { IconDown, IconPlus, IconStop, IconUp } from '../icons'

export const MODELS: { id: ModelId; label: string }[] = [
  { id: 'opus', label: 'Opus' },
  { id: 'sonnet', label: 'Sonnet' },
  { id: 'haiku', label: 'Haiku' }
]
export const EFFORTS: Effort[] = ['low', 'medium', 'high']

export function Composer({ chat }: { chat: Chat; ws: Workspace }) {
  const [text, setText] = useState('')
  const [picker, setPicker] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const running = chat.status === 'running'

  const submit = async () => {
    const t = text.trim()
    if (!t || running) return
    setText('')
    try {
      await window.api.sendMessage(chat.id, t)
    } catch (e) {
      reportError(e)
    }
  }

  const update = async (patch: Partial<Pick<Chat, 'model' | 'effort'>>) => {
    useStore.getState().upsertChat(await window.api.updateChat(chat.id, patch))
  }

  const model = MODELS.find((m) => m.id === chat.model)?.label ?? chat.model

  return (
    <div className="shrink-0 px-8 pb-5">
      <div className="mx-auto max-w-3xl rounded-xl border border-line bg-panel focus-within:border-faint">
        <textarea
          ref={ta}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
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
          <button className="rounded p-1.5 text-muted hover:bg-hover hover:text-fg" title="Add folder (coming soon)" disabled>
            <IconPlus />
          </button>
          {running ? (
            <button className="rounded-md bg-fg p-1.5 text-bg hover:opacity-90" title="Stop" onClick={() => void window.api.stopChat(chat.id)}>
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
