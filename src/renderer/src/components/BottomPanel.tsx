import { useEffect, useState } from 'react'
import type { ScriptKind, Scripts, Workspace } from '@shared/types'
import { useStore, reportError } from '../store'
import { IconDown, IconPlay, IconPlus, IconRight, IconStop, IconX } from '../icons'
import { TerminalView } from './TerminalView'

// Terminal tabs per workspace survive switching workspaces (the ptys live in the main process).
const termTabs: Record<string, { id: string; n: number }[]> = {}
const activeTab: Record<string, string> = {}

const EXAMPLE = `{
  "scripts": {
    "setup": "npm install",
    "run": "npm run dev -- --port $CONDUCTOR_PORT",
    "archive": ""
  }
}`

export function BottomPanel({ ws }: { ws: Workspace }) {
  const s = useStore()
  const terms = (termTabs[ws.id] ??= [{ id: `${ws.id}:term-1`, n: 1 }])
  const [, force] = useState(0)
  const [scripts, setScripts] = useState<Scripts>({})
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const cur = activeTab[ws.id] ?? (scripts.setup ? 'setup' : terms[0]?.id ?? 'setup')
  const setCur = (id: string) => {
    activeTab[ws.id] = id
    force((x) => x + 1)
  }

  const refreshRunning = async () => {
    const [setup, run] = await Promise.all([window.api.isScriptRunning(ws.id, 'setup'), window.api.isScriptRunning(ws.id, 'run')])
    setRunning({ [`${ws.id}:setup`]: setup, [`${ws.id}:run`]: run })
  }

  useEffect(() => {
    void window.api.getScripts(ws.id).then(setScripts)
    void refreshRunning()
    const offStart = window.api.onScriptStarted((wsId, kind) => {
      if (wsId !== ws.id) return
      setRunning((r) => ({ ...r, [`${wsId}:${kind}`]: true }))
      setCur(kind)
    })
    const offExit = window.api.onPtyExit((id) => {
      if (id.startsWith(`${ws.id}:`)) setRunning((r) => ({ ...r, [id]: false }))
    })
    const offMenu = window.api.onMenu((a) => {
      if (a === 'run' && useStore.getState().selectedWs === ws.id) void toggleRun()
    })
    return () => {
      offStart()
      offExit()
      offMenu()
    }
  }, [ws.id])

  const runId = `${ws.id}:run`
  const isRunning = !!running[runId]

  async function toggleRun() {
    const kind: ScriptKind = 'run'
    if (await window.api.isScriptRunning(ws.id, kind)) {
      window.api.stopScript(ws.id, kind)
      setRunning((r) => ({ ...r, [`${ws.id}:${kind}`]: false }))
      return
    }
    const sc = await window.api.getScripts(ws.id)
    setScripts(sc)
    useStore.getState().set({ bottomOpen: true })
    if (!sc.run) {
      setCur('run')
      return
    }
    try {
      await window.api.runScript(ws.id, kind)
    } catch (e) {
      reportError(e)
    }
  }

  const addTerm = () => {
    const n = Math.max(0, ...terms.map((t) => t.n)) + 1
    const t = { id: `${ws.id}:term-${n}`, n }
    terms.push(t)
    setCur(t.id)
    s.set({ bottomOpen: true })
  }
  const closeTerm = (id: string) => {
    window.api.ptyKill(id)
    termTabs[ws.id] = terms.filter((t) => t.id !== id)
    if (cur === id) setCur(termTabs[ws.id][0]?.id ?? 'setup')
    else force((x) => x + 1)
  }

  const TabBtn = (p: { id: string; label: string; closable?: boolean; live?: boolean }) => (
    <div className={`group flex h-9 shrink-0 items-center gap-1 border-b-2 px-2.5 whitespace-nowrap ${cur === p.id ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg'}`}>
      <button
        onClick={() => {
          setCur(p.id)
          s.set({ bottomOpen: true })
        }}
      >
        {p.live && <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-add align-middle" />}
        {p.label}
      </button>
      {p.closable && (
        <button title="Close terminal" className="invisible text-faint group-hover:visible hover:text-fg" onClick={() => closeTerm(p.id)}>
          <IconX width={11} height={11} />
        </button>
      )}
    </div>
  )

  const scriptTab = cur === 'setup' || cur === 'run' ? (cur as ScriptKind) : null
  const termTab = scriptTab ? null : (terms.find((t) => t.id === cur) ?? terms[0])

  return (
    <div className={`flex min-h-0 flex-col border-t border-line ${s.bottomOpen ? 'flex-[1_1_50%]' : ''}`}>
      <div className="flex h-9 shrink-0 items-center gap-0.5 px-1">
        <button className="shrink-0 rounded p-1 text-muted hover:text-fg" onClick={() => s.set({ bottomOpen: !s.bottomOpen })}>
          {s.bottomOpen ? <IconDown /> : <IconRight />}
        </button>
        {/* Tabs scroll sideways instead of wrapping when there are many terminals. */}
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          <TabBtn id="setup" label="Setup" live={running[`${ws.id}:setup`]} />
          <TabBtn id="run" label="Run" live={isRunning} />
          {terms.map((tt) => (
            <TabBtn key={tt.id} id={tt.id} label={terms.length > 1 ? `Terminal ${tt.n}` : 'Terminal'} closable={terms.length > 1} />
          ))}
          <button className="shrink-0 rounded p-1 text-muted hover:text-fg" onClick={addTerm} title="New terminal">
            <IconPlus />
          </button>
        </div>
        <div className="mr-1 flex shrink-0 items-center rounded-md border border-line">
          <button className="flex items-center gap-1.5 px-2 py-0.5 hover:bg-hover" title={isRunning ? 'Stop (⌘R)' : 'Run (⌘R)'} onClick={() => void toggleRun()}>
            {isRunning ? <IconStop width={11} height={11} /> : <IconPlay width={11} height={11} />} {isRunning ? 'Stop' : 'Run'} <span className="text-faint">⌘R</span>
          </button>
          <button
            className="border-l border-line px-1 py-0.5 hover:bg-hover"
            title="Re-run setup"
            onClick={() => void window.api.runScript(ws.id, 'setup').then((ok) => !ok && setCur('setup'))}
          >
            <IconDown />
          </button>
        </div>
      </div>
      {s.bottomOpen && (
        <div className="min-h-0 flex-1 bg-bg">
          {termTab ? (
            <TerminalView key={termTab.id} id={termTab.id} workspaceId={ws.id} />
          ) : scriptTab && scripts[scriptTab] ? (
            <TerminalView key={`${ws.id}:${scriptTab}`} id={`${ws.id}:${scriptTab}`} workspaceId={ws.id} attach />
          ) : (
            <div className="selectable p-4 text-muted">
              <div className="mb-2">
                No {scriptTab} script yet. Add a <code className="text-fg">choo-choo.json</code> (or <code className="text-fg">conductor.json</code>) to the repo root:
              </div>
              <pre className="rounded-md border border-line bg-panel p-3 font-mono text-[11px] text-fg">{EXAMPLE}</pre>
              <div className="mt-2 text-faint">Setup runs when a workspace is created. Run starts with ⌘R.</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
