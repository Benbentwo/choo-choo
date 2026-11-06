import { useState } from 'react'
import { useStore, addRepository, newWorkspace, refreshState, reportError } from '../store'
import { IconFolder, IconFolderPlus, IconGlobe } from '../icons'
import type { MenuItem } from './Menu'

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

/** The Add project choices: local folder, GitHub, quick start, then recent folders not already in the sidebar. */
export function addProjectItems(): MenuItem[] {
  const s = useStore.getState()
  const open = new Set(s.repos.filter((r) => !r.hidden).map((r) => r.path))
  const recents = s.recentPaths.filter((p) => !open.has(p)).slice(0, 5)
  const items: MenuItem[] = [
    { label: 'Open project', icon: <IconFolder />, onClick: () => void addRepository() },
    { label: 'Open GitHub project', icon: <IconGlobe />, onClick: () => s.set({ modal: 'create' }) },
    { label: 'Quick start', icon: <IconFolderPlus />, onClick: () => s.set({ modal: 'quickstart' }) }
  ]
  if (recents.length) {
    items.push({ kind: 'label', label: 'Recents' })
    for (const p of recents)
      items.push({
        label: tilde(p),
        icon: <IconFolder />,
        onClick: () =>
          void window.api.addRepo(p).then(refreshState, reportError)
      })
  }
  return items
}

export function QuickStartModalBody({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const repo = await window.api.quickStart(name)
      await refreshState()
      onClose()
      await newWorkspace(repo.id)
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="border-b border-line px-5 py-3 font-medium">Quick start</div>
      <div className="p-5">
        <div className="mb-1.5 text-[12px] text-muted">Creates a new git repository in ~/choo-choo/repos and opens a workspace in it.</div>
        <div className="flex gap-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void go()}
            placeholder="Project name"
            className="flex-1 rounded-md border border-line bg-bg px-2.5 py-1.5 outline-none focus:border-faint"
          />
          <button disabled={!name.trim() || busy} onClick={() => void go()} className="rounded-md bg-fg px-3 font-medium text-bg disabled:opacity-40">
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </>
  )
}
