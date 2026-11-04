import { useState } from 'react'
import { useStore, addRepository, newWorkspace } from '../store'
import { IconBranch, IconGear, IconHome, IconLeft, IconPlus, IconRepo, IconRight, IconSearch, IconSidebar } from '../icons'
import { Stats } from './Stats'

export function Sidebar() {
  const s = useStore()
  const [showHidden, setShowHidden] = useState(false)
  const visible = s.repos.filter((r) => showHidden || !r.hidden)
  const hiddenCount = s.repos.filter((r) => r.hidden).length

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="drag flex h-11 items-center gap-1 pr-2 pl-[84px]">
        <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ sidebarOpen: false })} title="Hide sidebar (⌘B)">
          <IconSidebar width={16} height={16} />
        </button>
        <div className="flex-1" />
        <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30" disabled={s.historyIndex <= 0} onClick={s.back}>
          <IconLeft width={16} height={16} />
        </button>
        <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30" disabled={s.historyIndex >= s.history.length - 1} onClick={s.forward}>
          <IconRight width={16} height={16} />
        </button>
      </div>

      <nav className="px-2 pb-3">
        <NavItem icon={<IconHome />} label="Home" active={!s.selectedWs} onClick={() => s.selectWorkspace(null)} />
        <NavItem icon={<IconPlus />} label="Create" onClick={() => s.set({ modal: 'create' })} />
        <NavItem icon={<IconSearch />} label="Search" onClick={() => s.set({ modal: 'palette' })} hint="⌘K" />
      </nav>

      <div className="border-t border-line" />

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1 flex items-center px-2 text-[11px] font-medium text-faint">
          <span className="flex-1">My workspaces</span>
          <button className="rounded p-0.5 hover:bg-hover hover:text-fg" title="Add repository (⌘O)" onClick={() => s.set({ modal: 'create' })}>
            <IconPlus />
          </button>
        </div>
        {visible.length === 0 && (
          <button onClick={() => void addRepository()} className="mx-2 mt-2 w-[calc(100%-16px)] rounded-lg border border-dashed border-line px-3 py-4 text-left text-muted hover:border-faint hover:text-fg">
            Add a repository to get started
          </button>
        )}
        {visible.map((repo) => {
          const wss = s.workspaces.filter((w) => w.repoId === repo.id && !w.archived)
          return (
            <div key={repo.id} className="mb-1">
              <div className="group flex h-9 items-center gap-2 rounded-md px-2 hover:bg-hover">
                <IconRepo className="shrink-0 text-faint" />
                <span className={`flex-1 truncate font-medium ${repo.hidden ? 'text-faint' : ''}`}>{repo.name}</span>
                <button
                  className="hidden rounded px-1 text-[11px] text-faint group-hover:block hover:text-fg"
                  onClick={() => void window.api.setRepoHidden(repo.id, !repo.hidden).then(() => useStore.getState().set({ repos: s.repos.map((r) => (r.id === repo.id ? { ...r, hidden: !r.hidden } : r)) }))}
                >
                  {repo.hidden ? 'Show' : 'Hide'}
                </button>
                <button className="rounded p-1 text-muted hover:bg-raised hover:text-fg" title="New workspace" onClick={() => void newWorkspace(repo.id)}>
                  <IconPlus />
                </button>
              </div>
              {wss.map((w) => {
                const running = s.chats.some((c) => c.workspaceId === w.id && c.status === 'running')
                const unread = s.chats.some((c) => c.workspaceId === w.id && c.unread)
                return (
                  <button
                    key={w.id}
                    onClick={() => s.selectWorkspace(w.id)}
                    className={`flex h-9 w-full items-center gap-2 rounded-md pr-2 pl-5 text-left ${s.selectedWs === w.id ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
                  >
                    {running ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-fg" /> : <IconBranch className="shrink-0" />}
                    <span className={`flex-1 truncate ${unread ? 'font-semibold text-fg' : ''}`}>{w.title}</span>
                    {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />}
                    <Stats stats={s.stats[w.id]} />
                  </button>
                )
              })}
            </div>
          )
        })}
        {hiddenCount > 0 && (
          <button className="mt-2 px-2 text-[12px] text-faint hover:text-fg" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Hide hidden repositories' : 'Show hidden repositories'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-faint">
        <span className="flex-1 text-[11px]">Choo Choo</span>
        <button className="rounded p-1 hover:bg-hover hover:text-fg" title="Settings (⌘,)" onClick={() => s.set({ modal: 'settings' })}>
          <IconGear />
        </button>
      </div>
    </aside>
  )
}

function NavItem(p: { icon: React.ReactNode; label: string; active?: boolean; hint?: string; onClick: () => void }) {
  return (
    <button onClick={p.onClick} className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left ${p.active ? 'bg-raised' : 'hover:bg-hover'}`}>
      <span className="text-muted">{p.icon}</span>
      <span className="flex-1">{p.label}</span>
      {p.hint && <span className="text-[11px] text-faint">{p.hint}</span>}
    </button>
  )
}
