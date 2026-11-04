import { useState } from 'react'
import type { Workspace } from '@shared/types'
import { useStore } from '../store'
import { IconDown, IconPlay, IconPlus, IconRight, IconX } from '../icons'
import { TerminalView } from './TerminalView'

type Tab = { kind: 'setup' } | { kind: 'run' } | { kind: 'term'; id: string; n: number }

// Terminal tabs per workspace survive switching workspaces (the ptys live in the main process).
const termTabs: Record<string, { id: string; n: number }[]> = {}

export function BottomPanel({ ws }: { ws: Workspace }) {
  const s = useStore()
  const terms = (termTabs[ws.id] ??= [{ id: `${ws.id}:term-1`, n: 1 }])
  const [active, setActive] = useState<Record<string, string>>({})
  const [, force] = useState(0)
  const cur = active[ws.id] ?? terms[0]?.id ?? 'setup'

  const tab = (id: string): Tab =>
    id === 'setup' ? { kind: 'setup' } : id === 'run' ? { kind: 'run' } : { kind: 'term', ...(terms.find((t) => t.id === id) ?? terms[0]) }

  const addTerm = () => {
    const n = Math.max(0, ...terms.map((t) => t.n)) + 1
    const t = { id: `${ws.id}:term-${n}`, n }
    terms.push(t)
    setActive({ ...active, [ws.id]: t.id })
    s.set({ bottomOpen: true })
  }
  const closeTerm = (id: string) => {
    window.api.ptyKill(id)
    termTabs[ws.id] = terms.filter((t) => t.id !== id)
    if (cur === id) setActive({ ...active, [ws.id]: termTabs[ws.id][0]?.id ?? 'setup' })
    force((x) => x + 1)
  }

  const t = tab(cur)
  const TabBtn = (p: { id: string; label: string; closable?: boolean }) => (
    <div className={`group flex h-9 items-center gap-1 border-b-2 px-2.5 ${cur === p.id ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
      <button onClick={() => { setActive({ ...active, [ws.id]: p.id }); s.set({ bottomOpen: true }) }}>{p.label}</button>
      {p.closable && (
        <button className="invisible text-faint group-hover:visible hover:text-fg" onClick={() => closeTerm(p.id)}>
          <IconX width={11} height={11} />
        </button>
      )}
    </div>
  )

  return (
    <div className={`flex min-h-0 flex-col border-t border-line ${s.bottomOpen ? 'flex-[1_1_50%]' : ''}`}>
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-1">
        <button className="rounded p-1 text-muted hover:text-fg" onClick={() => s.set({ bottomOpen: !s.bottomOpen })}>
          {s.bottomOpen ? <IconDown /> : <IconRight />}
        </button>
        <TabBtn id="setup" label="Setup" />
        <TabBtn id="run" label="Run" />
        {terms.map((tt) => (
          <TabBtn key={tt.id} id={tt.id} label={terms.length > 1 ? `Terminal ${tt.n}` : 'Terminal'} closable={terms.length > 1} />
        ))}
        <button className="rounded p-1 text-muted hover:text-fg" onClick={addTerm} title="New terminal">
          <IconPlus />
        </button>
        <div className="flex-1" />
        <div className="mr-1 flex items-center rounded-md border border-line">
          <button className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-hover" title="Run script (coming next)" onClick={() => s.set({ error: 'Run scripts land in the next update.' })}>
            <IconPlay width={11} height={11} /> Run <span className="text-faint">⌘R</span>
          </button>
          <button className="border-l border-line px-1 py-0.5 hover:bg-hover">
            <IconDown />
          </button>
        </div>
      </div>
      {s.bottomOpen && (
        <div className="min-h-0 flex-1 bg-bg">
          {t.kind === 'term' ? (
            <TerminalView key={t.id} id={t.id} workspaceId={ws.id} />
          ) : (
            <div className="p-4 text-faint">
              {t.kind === 'setup' ? 'Setup scripts run here when a workspace is created.' : 'Your run script output appears here.'} Coming in the next update.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
