import { useStore, addRepository } from '../store'
import { IconFolder, IconFolderPlus, IconGlobe, IconSidebar } from '../icons'
import { BrandMark } from './BrandMark'

export function Home() {
  const s = useStore()
  const actions = [
    { label: 'Open project', icon: <IconFolder width={18} height={18} />, run: () => void addRepository() },
    { label: 'Open GitHub project', icon: <IconGlobe width={18} height={18} />, run: () => s.set({ modal: 'create' }) },
    { label: 'Quick start', icon: <IconFolderPlus width={18} height={18} />, run: () => s.set({ modal: 'quickstart' }) }
  ]
  return (
    <div className="flex flex-1 flex-col">
      <div className="drag flex h-11 items-center px-3">
        {!s.sidebarOpen && (
          <button className="no-drag ml-[72px] rounded p-1 text-muted hover:bg-hover" onClick={() => s.set({ sidebarOpen: true })}>
            <IconSidebar width={16} height={16} />
          </button>
        )}
      </div>
      <div className="mx-auto w-full max-w-2xl flex-1 px-6 pt-24">
        <h1 className="mb-2 flex items-center gap-3 text-[28px] font-[750] tracking-[-0.025em]">
          <BrandMark size={64} />
          Choo Choo
        </h1>
        <p className="mb-8 text-muted">Run Claude Code agents in parallel, each in its own git worktree.</p>
        <div className="grid grid-cols-3 gap-3">
          {actions.map((a) => (
            <button key={a.label} onClick={a.run} className="flex flex-col items-start gap-3 rounded-lg border border-line px-4 py-3 text-left whitespace-nowrap hover:bg-hover">
              <span className="text-muted">{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
        <button onClick={() => s.set({ modal: 'open-share' })} className="mt-4 text-[12px] text-muted hover:text-fg">
          Open a shared session…
        </button>
      </div>
    </div>
  )
}
