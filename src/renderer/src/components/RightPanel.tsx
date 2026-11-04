import { useEffect, useState } from 'react'
import type { FileChange, Workspace } from '@shared/types'
import { useStore, type RightTab } from '../store'
import { IconDown, IconEye, IconPR, IconSearch } from '../icons'
import { BottomPanel } from './BottomPanel'
import { fmt } from './Stats'

const TABS: { id: RightTab; label: string }[] = [
  { id: 'artifacts', label: 'Artifacts' },
  { id: 'files', label: 'All files' },
  { id: 'changes', label: 'Changes' },
  { id: 'checks', label: 'Checks' }
]

export function RightPanel({ ws }: { ws: Workspace }) {
  const s = useStore()
  const [changes, setChanges] = useState<FileChange[]>([])
  const stats = s.stats[ws.id]

  useEffect(() => {
    void window.api.getChanges(ws.id).then(setChanges, () => setChanges([]))
  }, [ws.id, stats])

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l border-line bg-panel">
      <div className="drag flex h-11 shrink-0 items-center justify-end gap-2 border-b border-line px-3">
        <div className="no-drag flex items-center rounded-md border border-line">
          <button className="flex items-center gap-1.5 px-2.5 py-1 hover:bg-hover" title="Create PR (coming next)" onClick={() => s.set({ error: 'Create PR lands in the next update.' })}>
            <IconPR /> Create PR
          </button>
          <button className="border-l border-line px-1.5 py-1 hover:bg-hover">
            <IconDown />
          </button>
        </div>
      </div>

      <div className={`flex min-h-0 flex-col ${s.bottomOpen ? 'flex-[1_1_50%]' : 'flex-1'}`}>
        <div className="flex h-10 shrink-0 items-center gap-1 px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => s.set({ rightTab: t.id })}
              className={`rounded-md px-2.5 py-1 ${s.rightTab === t.id ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}
            >
              {t.label}
              {t.id === 'changes' && changes.length > 0 && <span className="ml-1.5 text-faint">{changes.length}</span>}
            </button>
          ))}
          <button onClick={() => s.set({ rightTab: 'review' })} className={`flex items-center gap-1 rounded-md px-2.5 py-1 ${s.rightTab === 'review' ? 'bg-raised text-fg' : 'text-muted hover:text-fg'}`}>
            <IconEye /> Review
          </button>
          <div className="flex-1" />
          <button className="rounded p-1 text-faint hover:text-fg">
            <IconSearch />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {s.rightTab === 'changes' ? (
            <ChangesList ws={ws} changes={changes} />
          ) : (
            <div className="p-6 text-center text-faint">Coming soon</div>
          )}
        </div>
      </div>

      <BottomPanel ws={ws} />
    </aside>
  )
}

const STATUS_COLOR: Record<FileChange['status'], string> = {
  A: 'text-add',
  U: 'text-add',
  M: 'text-yellow-400',
  R: 'text-sky-400',
  D: 'text-del'
}

function ChangesList({ ws, changes }: { ws: Workspace; changes: FileChange[] }) {
  const s = useStore()
  const add = changes.reduce((n, c) => n + c.additions, 0)
  const del = changes.reduce((n, c) => n + c.deletions, 0)
  if (changes.length === 0) return <div className="p-6 text-center text-faint">No changes yet</div>
  return (
    <div>
      <div className="flex items-center px-4 py-2 text-muted">
        <span className="flex-1">
          {changes.length} file{changes.length === 1 ? '' : 's'} changed
        </span>
        <span className="font-mono text-[11px]">
          <span className="text-add">+{fmt(add)}</span> <span className="text-del">-{fmt(del)}</span>
        </span>
      </div>
      {changes.map((c) => {
        const slash = c.path.lastIndexOf('/')
        const open = s.openDiff[ws.id] === c.path
        return (
          <button
            key={c.path}
            onClick={() => s.set({ openDiff: { ...s.openDiff, [ws.id]: c.path } })}
            className={`flex w-full items-center gap-2 px-4 py-1.5 text-left ${open ? 'bg-raised' : 'hover:bg-hover'}`}
            title={c.path}
          >
            <span className="min-w-0 flex-1 truncate">
              {slash >= 0 && <span className="text-faint">{c.path.slice(0, slash + 1)}</span>}
              <span className={c.status === 'D' ? 'line-through' : ''}>{c.path.slice(slash + 1)}</span>
            </span>
            <span className={`font-mono text-[11px] ${STATUS_COLOR[c.status]}`}>{c.status}</span>
            <span className="w-16 text-right font-mono text-[11px]">
              {c.additions > 0 && <span className="text-add">+{fmt(c.additions)}</span>}
              {c.deletions > 0 && <span className="ml-1 text-del">-{fmt(c.deletions)}</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}
