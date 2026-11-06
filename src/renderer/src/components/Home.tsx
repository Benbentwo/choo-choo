import { useStore, addRepository, newWorkspace } from '../store'
import { IconBranch, IconFolder, IconGithub, IconSidebar } from '../icons'
import { Stats } from './Stats'
import { BrandMark } from './BrandMark'

export function Home() {
  const s = useStore()
  const recent = [...s.workspaces].filter((w) => !w.archived).sort((a, b) => b.createdAt - a.createdAt).slice(0, 8)
  return (
    <div className="flex flex-1 flex-col">
      <div className="drag flex h-11 items-center px-3">
        {!s.sidebarOpen && (
          <button className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-xl flex-1 px-6 pt-24">
        <h1 className="mb-2 flex items-center gap-3 text-[28px] font-[750] tracking-[-0.025em]">
          <BrandMark size={64} />
          Choo Choo
        </h1>
        <p className="mb-8 text-muted">Run Claude Code agents in parallel, each in its own git worktree.</p>
        <div className="mb-8 flex flex-wrap gap-2 [&>button]:whitespace-nowrap">
          <button onClick={() => void addRepository()} className="flex items-center gap-2 rounded-lg bg-fg px-3 py-2 font-medium text-bg hover:opacity-90">
            <IconFolder /> Open project
          </button>
          <button onClick={() => s.set({ modal: 'create' })} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 hover:bg-hover">
            <IconGithub /> Clone from GitHub
          </button>
          {s.repos[0] && (
            <button onClick={() => void newWorkspace(s.repos[0].id)} className="rounded-lg border border-line px-3 py-2 hover:bg-hover">
              New workspace in {s.repos[0].name}
            </button>
          )}
        </div>
        {recent.length > 0 && (
          <>
            <div className="mb-2 text-[11px] font-medium text-faint">Recent workspaces</div>
            {recent.map((w) => (
              <button key={w.id} onClick={() => s.selectWorkspace(w.id)} className="flex h-10 w-full items-center gap-3 rounded-md px-2 text-left hover:bg-hover">
                <IconBranch className="text-faint" />
                <span className="flex-1 truncate">{w.title}</span>
                <span className="text-[12px] text-faint">{s.repos.find((r) => r.id === w.repoId)?.name}</span>
                <Stats stats={s.stats[w.id]} />
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
