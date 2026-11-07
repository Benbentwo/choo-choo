import { useState } from 'react'
import { useStore, addRepository, openOrchestrator } from '../store'
import { IconEye, IconFolder, IconFolderPlus, IconGear, IconGlobe, IconOrchestrator, IconSidebar, IconTool } from '../icons'
import { BrandMark } from './BrandMark'

export function Home() {
  const s = useStore()
  const [hideExplore, setHideExplore] = useState(() => {
    try {
      return localStorage.getItem('home-explore-hidden') === '1'
    } catch {
      return false
    }
  })
  const settings = (tab: 'agents' | 'plugins' | 'mcp' | 'integrations' | 'appearance') => () => s.set({ modal: 'settings', settingsTab: tab })
  const firstRepo = s.repos.find((r) => !r.hidden)
  const explore: { title: string; body: string; icon: React.ReactNode; run: () => void }[] = [
    { title: 'Helper agents', body: 'Scout, reviewer, security reviewer and an advisor that checks each turn (from oh-my-pi).', icon: <IconEye width={16} height={16} />, run: settings('agents') },
    {
      title: 'Orchestrator',
      body: 'Say what you want and it starts and steers workspaces for you.',
      icon: <IconOrchestrator width={16} height={16} />,
      run: firstRepo ? () => void openOrchestrator(firstRepo.id) : () => s.set({ modal: 'create' })
    },
    { title: 'Plugins and skills', body: 'Install Claude Code plugins and turn skills on or off.', icon: <IconTool width={16} height={16} />, run: settings('plugins') },
    { title: 'MCP servers', body: 'See and manage the tools your agents can reach, per project.', icon: <IconGear width={16} height={16} />, run: settings('mcp') },
    { title: 'Integrations', body: 'Connect Linear and Notion so agents can use them.', icon: <IconGlobe width={16} height={16} />, run: settings('integrations') },
    { title: 'Themes', body: 'Colors, accent, font size and density.', icon: <IconEye width={16} height={16} />, run: settings('appearance') },
    { title: 'Import from Conductor', body: 'Bring over projects, workspaces and chats.', icon: <IconFolder width={16} height={16} />, run: () => s.set({ modal: 'conductor' }) }
  ]
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
        {!hideExplore && (
          <div className="mt-10">
            <div className="mb-2 flex items-center text-[12px] font-medium text-faint">
              <span className="flex-1">Explore</span>
              <button
                className="font-normal hover:text-fg"
                onClick={() => {
                  setHideExplore(true)
                  try {
                    localStorage.setItem('home-explore-hidden', '1')
                  } catch {
                    /* storage unavailable */
                  }
                }}
              >
                Hide
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {explore.map((e) => (
                <button key={e.title} onClick={e.run} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5 text-left hover:bg-hover">
                  <span className="mt-0.5 text-muted">{e.icon}</span>
                  <span className="min-w-0">
                    <span className="block">{e.title}</span>
                    <span className="block text-[12px] text-faint">{e.body}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
