import { useState } from 'react'
import type { Repo } from '@shared/types'
import { useStore, refreshState, reportError } from '../store'

const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

/** Asks whether removing a project should also delete its workspace folders. */
export function RemoveProjectBody({ repo, onClose }: { repo: Repo; onClose: () => void }) {
  const s = useStore()
  const [busy, setBusy] = useState(false)
  const wss = s.workspaces.filter((w) => w.repoId === repo.id && !w.orchestrator)
  const go = async (deleteFiles: boolean) => {
    setBusy(true)
    try {
      await window.api.removeProject(repo.id, { deleteFiles })
      await refreshState()
      if (s.selectedWs && wss.some((w) => w.id === s.selectedWs)) s.selectWorkspace(null)
      onClose()
    } catch (e) {
      reportError(e)
      setBusy(false)
    }
  }
  return (
    <>
      <div className="border-b border-line px-5 py-3 font-medium">Remove {repo.name}?</div>
      <div className="space-y-2 p-5 text-[13px]">
        <p>
          This takes the project out of Choo Choo. The repository at <span className="text-muted">{tilde(repo.path)}</span> is never touched.
        </p>
        {wss.length > 0 ? (
          <p className="text-muted">
            It has {wss.length} {wss.length === 1 ? 'workspace' : 'workspaces'} ({wss.filter((w) => w.archived).length} archived). Delete their folders too? Branches stay in git either way. If you keep them, you can delete
            them later from Settings &gt; Projects.
          </p>
        ) : (
          <p className="text-muted">It has no workspaces.</p>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button className="rounded-md px-3 py-1.5 text-muted hover:text-fg" onClick={onClose}>
          Cancel
        </button>
        {wss.length > 0 && (
          <button disabled={busy} className="rounded-md border border-line px-3 py-1.5 hover:bg-hover disabled:opacity-40" onClick={() => void go(false)}>
            Remove, keep files
          </button>
        )}
        <button disabled={busy} className="rounded-md bg-del px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:opacity-40" onClick={() => void go(true)}>
          {busy ? 'Removing…' : wss.length ? 'Remove and delete files' : 'Remove'}
        </button>
      </div>
    </>
  )
}

/** Settings > Projects: every project and workspace, with permanent delete, plus folders left behind by earlier removals. */
export function ProjectsSettings() {
  const s = useStore()
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    try {
      await fn()
      await refreshState()
    } catch (e) {
      reportError(e)
    } finally {
      setBusy(null)
      setConfirm(null)
    }
  }
  const del = (key: string, label: string, fn: () => Promise<void>) =>
    confirm === key ? (
      <span className="flex shrink-0 items-center gap-1.5 text-[12px]">
        <button className="text-muted hover:text-fg" onClick={() => setConfirm(null)}>
          Cancel
        </button>
        <button className="rounded bg-del px-2 py-0.5 font-medium text-white" disabled={!!busy} onClick={() => void run(key, fn)}>
          {busy === key ? 'Deleting…' : 'Delete for good'}
        </button>
      </span>
    ) : (
      <button className="shrink-0 rounded px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-del" onClick={() => setConfirm(key)}>
        {label}
      </button>
    )

  return (
    <div className="p-5 text-[13px]">
      <p className="mb-4 text-[12px] text-faint">Deleting a workspace removes its folder, archived copy and chats. Its branch stays in git.</p>
      {s.repos.length === 0 && <div className="text-muted">No projects.</div>}
      {s.repos.map((repo) => {
        const wss = s.workspaces.filter((w) => w.repoId === repo.id && !w.orchestrator)
        return (
          <div key={repo.id} className="mb-5">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-medium">{repo.name}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-faint">{tilde(repo.path)}</span>
              <button className="shrink-0 rounded px-2 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-del" onClick={() => s.set({ modal: 'remove-repo', removeRepoId: repo.id })}>
                Remove project…
              </button>
            </div>
            {wss.length === 0 && <div className="pl-3 text-[12px] text-faint">No workspaces</div>}
            {wss.map((w) => (
              <div key={w.id} className="flex items-center gap-2 py-1 pl-3">
                <span className="min-w-0 flex-1 truncate">
                  {w.title} <span className="text-[12px] text-faint">· {w.branch}</span>
                </span>
                <span className="shrink-0 text-[11px] text-faint">{w.archived ? 'archived' : 'open'}</span>
                {del(`ws:${w.id}`, 'Delete', () => window.api.deleteWorkspace(w.id))}
              </div>
            ))}
          </div>
        )
      })}
      {s.leftovers.length > 0 && (
        <>
          <div className="mt-6 mb-1 font-medium">Left on disk</div>
          <p className="mb-2 text-[12px] text-faint">Workspace folders kept when these projects were removed.</p>
          {s.leftovers.map((l) => (
            <div key={l.id} className="flex items-start gap-2 py-1">
              <div className="min-w-0 flex-1">
                <div>{l.repoName}</div>
                {l.paths.map((p) => (
                  <div key={p} className="truncate text-[12px] text-faint">
                    {tilde(p)}
                  </div>
                ))}
              </div>
              {del(`l:${l.id}`, `Delete ${l.paths.length} ${l.paths.length === 1 ? 'folder' : 'folders'}`, () => window.api.deleteLeftover(l.id))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
