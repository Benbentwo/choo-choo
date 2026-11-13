import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Settings } from '@shared/types'
import { isNewer, type UpdateStatus } from '@shared/updates'
import { changeCount, type ReleaseNote } from '@shared/releaseNotes'
import { busyLine, waitingLine } from '@shared/restart'
import { reportError } from '../store'

/** Live update status from the main process. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    void window.api.updateStatus().then(setStatus)
    return window.api.onUpdateStatus(setStatus)
  }, [])
  return status
}

const ago = (t?: number) => {
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 1 ? 'checked just now' : m < 60 ? `checked ${m}m ago` : `checked ${Math.round(m / 60)}h ago`
}

const btn = 'rounded-md border border-line px-2.5 py-1 hover:bg-hover disabled:opacity-50'
const primary = 'rounded-md bg-fg px-2.5 py-1 text-[12px] font-medium text-bg disabled:opacity-50'

function appAction(a: UpdateStatus['app']): string | null {
  if (a.state === 'ready') return a.running ? 'Restart when idle' : 'Restart to update'
  if (a.state === 'installing') return a.method === 'brew' ? 'Updating…' : 'Restarting…'
  if (a.state !== 'available') return null
  return a.method === 'brew' ? 'Update with Homebrew' : 'Download'
}

function appLine(a: UpdateStatus['app']): string {
  switch (a.state) {
    case 'checking':
      return 'Checking…'
    case 'up-to-date':
      return `Up to date · ${ago(a.checkedAt)}`
    case 'available':
      return `${a.latest} is available${a.method === 'download' ? '. This build isn’t signed, so it can’t update itself.' : ''}`
    case 'downloading':
      return `Downloading ${a.latest}…`
    case 'ready':
      return a.restartWhenIdle ? `${a.latest} has downloaded. ${waitingLine(a.running ?? 0)}` : `${a.latest} has downloaded${a.running ? `. ${busyLine(a.running)}` : ''}`
    case 'installing':
      return a.method === 'brew' ? `Running brew upgrade --cask choo-choo…` : 'Restarting…'
    case 'error':
    case 'unavailable':
      return a.error ?? 'Could not check'
    default:
      return 'Not checked yet'
  }
}

function claudeLine(c: UpdateStatus['claude']): string {
  switch (c.state) {
    case 'checking':
      return 'Checking…'
    case 'up-to-date':
      return `Up to date · ${ago(c.checkedAt)}`
    case 'available':
      return c.source === 'installed'
        ? `${c.latest} is available`
        : `${c.latest} is out. The bundled copy updates with Choo Choo releases${c.installedPath ? ', or switch to your installed claude to get it now' : ''}.`
    case 'updating':
      return 'Running claude update…'
    case 'error':
      return c.error ?? 'Could not check'
    default:
      return 'Not checked yet'
  }
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4 border-b border-line px-5 py-3.5 last:border-0">
      <div className="flex-1">
        <div>{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-faint">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}

/** Settings > Updates: versions, a toggle per check, and buttons to check or update now. */
export function UpdatesSettings({ settings, save }: { settings: Settings; save: (patch: Partial<Settings>) => void }) {
  const st = useUpdateStatus()
  const check = (which: 'app' | 'claude') => void window.api.checkForUpdates(which).catch(reportError)
  if (!st) return null
  const { app: a, claude: c } = st
  const action = appAction(a)
  return (
    <>
      <Row label="Check for Choo Choo updates" hint="Looks for new releases on GitHub when the app starts and every 6 hours.">
        <input type="checkbox" aria-label="Check for Choo Choo updates" checked={settings.checkAppUpdates} onChange={(e) => save({ checkAppUpdates: e.target.checked })} />
      </Row>
      <Row
        label="Update channel"
        hint={
          settings.updateChannel === 'beta'
            ? 'Beta: a new signed build after every merged PR. Newest features, more bugs.'
            : a.current.includes('-')
              ? 'Stable: published releases only. You’re on a beta build, so you’ll move to the next stable release that’s newer than it.'
              : 'Stable: published releases only.'
        }
      >
        <select
          aria-label="Update channel"
          className="rounded-md border border-line bg-bg px-2 py-1 outline-none"
          value={settings.updateChannel}
          onChange={(e) => save({ updateChannel: e.target.value as Settings['updateChannel'] })}
        >
          <option value="stable">Stable</option>
          <option value="beta">Beta</option>
        </select>
      </Row>
      <Row
        label={`Choo Choo ${a.current}`}
        hint={
          <>
            {appLine(a)}
            {a.error && a.state !== 'error' && a.state !== 'unavailable' && <div>{a.error}</div>}
          </>
        }
      >
        <WhatsNewButton app={a} />
        <RestartButtons app={a} action={action} />
        <button className={btn} disabled={a.state === 'checking' || a.state === 'downloading' || a.state === 'installing'} onClick={() => check('app')}>
          Check now
        </button>
      </Row>
      <Row
        label="Pick up interrupted chats after a restart"
        hint="When Choo Choo restarts, quits or closes while Claude is working, those chats continue in the same session the next time it opens."
      >
        <input
          type="checkbox"
          aria-label="Pick up interrupted chats after a restart"
          checked={settings.resumeAfterRestart}
          onChange={(e) => save({ resumeAfterRestart: e.target.checked })}
        />
      </Row>
      <Row label="Check for Claude Code updates" hint="Compares the Claude Code your agents run with the newest release on npm, at start and every 6 hours.">
        <input type="checkbox" aria-label="Check for Claude Code updates" checked={settings.checkClaudeUpdates} onChange={(e) => save({ checkClaudeUpdates: e.target.checked })} />
      </Row>
      <Row
        label={`Claude Code ${c.current ?? 'version unknown'}`}
        hint={
          <>
            <div>
              {c.source === 'installed' ? 'Your installed claude' : 'Bundled with Choo Choo'}
              {c.path ? ` · ${c.path}` : ''}
            </div>
            <div>{claudeLine(c)}</div>
          </>
        }
      >
        {c.state === 'available' && c.source === 'installed' && (
          <button className={primary} onClick={() => void window.api.updateClaude().catch(reportError)}>
            Update Claude Code
          </button>
        )}
        {c.state === 'available' && c.source === 'bundled' && c.installedPath && (
          <button className={primary} onClick={() => save({ claudeBinary: 'installed' })}>
            Use my installed claude
          </button>
        )}
        <button className={btn} disabled={c.state === 'checking' || c.state === 'updating'} onClick={() => check('claude')}>
          Check now
        </button>
      </Row>
    </>
  )
}

const DISMISS_KEY = 'choo-choo:dismissed-claude-update'

/** Sidebar cards for an app update and, until dismissed, a newer Claude Code. */
export function UpdateBanners({ openSettings }: { openSettings: () => void }) {
  const st = useUpdateStatus()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY))
  if (!st) return null
  const { app: a, claude: c } = st
  const action = appAction(a)
  const showClaude = c.state === 'available' && c.latest && dismissed !== c.latest
  const dismiss = () => {
    if (!c.latest) return
    localStorage.setItem(DISMISS_KEY, c.latest)
    setDismissed(c.latest)
  }
  return (
    <>
      {action && (
        <div className="mx-2 mb-2 rounded-lg border border-line bg-raised p-3" data-testid="update-card">
          <div className="mb-1 font-medium">{a.state === 'ready' || (a.state === 'installing' && a.method !== 'brew') ? 'Update ready' : 'Update available'}</div>
          <div className="mb-2 text-[12px] text-muted">
            {a.state === 'ready'
              ? `Choo Choo ${a.latest} has downloaded.${a.restartWhenIdle ? ` ${waitingLine(a.running ?? 0)}` : a.running ? ` ${busyLine(a.running)}` : ''}`
              : a.state === 'installing'
                ? a.method === 'brew'
                  ? 'Updating with Homebrew…'
                  : 'Restarting…'
                : `Choo Choo ${a.latest} is out. You have ${a.current}.${a.running && a.method === 'brew' ? ` ${busyLine(a.running)}` : ''}`}
          </div>
          <div className="flex flex-wrap gap-2">
            <RestartButtons app={a} action={action} />
            <WhatsNewButton app={a} />
          </div>
        </div>
      )}
      {showClaude && (
        <div className="mx-2 mb-2 rounded-lg border border-line bg-raised p-3">
          <div className="mb-1 font-medium">Claude Code {c.latest}</div>
          <div className="mb-2 text-[12px] text-muted">
            Your agents run {c.current}
            {c.source === 'bundled' ? ', bundled with Choo Choo.' : '.'}
          </div>
          <div className="flex gap-2">
            {c.source === 'installed' ? (
              <button className={primary} onClick={() => void window.api.updateClaude().catch(reportError)}>
                Update
              </button>
            ) : (
              <button className={primary} onClick={openSettings}>
                Details
              </button>
            )}
            <button className={`${btn} text-[12px]`} onClick={dismiss}>
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  )
}

/** Whether installing quits the app, so it should wait for running chats. */
const restarts = (a: UpdateStatus['app']) => a.state === 'ready' || (a.method === 'brew' && a.state === 'available')

/**
 * The install button, which waits for running chats (Restart when idle). While it waits: Restart now
 * (their turns pick up after) and Cancel. With chats running and nothing pending, Restart now is offered too.
 */
function RestartButtons({ app: a, action }: { app: UpdateStatus['app']; action: string | null }) {
  if (!action || (a.state === 'installing' && a.method !== 'brew')) return null
  const install = (now?: boolean) => void window.api.installAppUpdate(now ? { now } : undefined).catch(reportError)
  if (a.restartWhenIdle)
    return (
      <>
        <button className={primary} onClick={() => install(true)} title="Running chats are cut off and pick up again after the restart">
          Restart now
        </button>
        <button className={`${btn} text-[12px]`} onClick={() => void window.api.cancelRestart().catch(reportError)}>
          Cancel
        </button>
      </>
    )
  const label = a.method === 'brew' && a.state === 'available' && a.running ? 'Update when idle' : action
  return (
    <>
      <button className={primary} disabled={a.state === 'installing'} onClick={() => install()}>
        {label}
      </button>
      {restarts(a) && !!a.running && (
        <button className={`${btn} text-[12px]`} onClick={() => install(true)} title="Running chats are cut off and pick up again after the restart">
          Restart now
        </button>
      )}
    </>
  )
}

/** "What's new" next to the install button, whenever a newer version is known. */
export function WhatsNewButton({ app: a }: { app: UpdateStatus['app'] }) {
  const [open, setOpen] = useState(false)
  const show = !!a.latest && isNewer(a.latest, a.current) && ['available', 'downloading', 'ready', 'installing'].includes(a.state)
  if (!show) return null
  return (
    <>
      <button className={`${btn} text-[12px]`} onClick={() => setOpen(true)}>
        What’s new
      </button>
      {open && <WhatsNew app={a} close={() => setOpen(false)} />}
    </>
  )
}

const day = (t?: number) => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')

/** The release notes for every version between yours and the update, newest first. */
export function WhatsNew({ app: a, close }: { app: UpdateStatus['app']; close: () => void }) {
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    window.api
      .releaseNotes()
      .then(setNotes)
      .catch((e) => setError((e as Error)?.message ?? String(e)))
  }, [a.latest])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const action = appAction(a)
  const count = notes ? changeCount(notes) : 0
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="What’s new" className="flex max-h-[80vh] w-[560px] flex-col rounded-xl border border-line bg-panel shadow-2xl">
        <div className="border-b border-line px-5 py-4">
          <div className="text-[15px] font-semibold">What’s new in Choo Choo {a.latest}</div>
          <div className="mt-0.5 text-[12px] text-muted">
            Since your version, {a.current}
            {notes && notes.length > 1 ? ` · ${notes.length} releases, ${count} changes` : ''}
          </div>
        </div>
        <div className="min-h-[120px] flex-1 overflow-y-auto px-5 py-3">
          {error ? (
            <div className="text-[12.5px] text-muted">
              Couldn’t load the release notes ({error}).{' '}
              <button className="text-accent hover:underline" onClick={() => void window.api.openExternal(a.url ?? 'https://github.com/Benbentwo/choo-choo/releases')}>
                Open the release page
              </button>
            </div>
          ) : !notes ? (
            <div className="text-[12.5px] text-faint">Loading…</div>
          ) : !count ? (
            <div className="text-[12.5px] text-muted">Small fixes and polish.</div>
          ) : (
            notes
              .filter((r) => r.sections.length)
              .map((r) => (
                <section key={r.version} className="mb-4 last:mb-1">
                  <div className="mb-1.5 flex items-baseline gap-2">
                    <span className="font-semibold">{r.version}</span>
                    {r.prerelease && <span className="rounded bg-hover px-1.5 text-[10.5px] text-muted">beta</span>}
                    <span className="text-[11.5px] text-faint">{day(r.publishedAt)}</span>
                    <div className="flex-1" />
                    {r.url && (
                      <button className="text-[11.5px] text-faint hover:text-fg hover:underline" onClick={() => void window.api.openExternal(r.url!)}>
                        Release page
                      </button>
                    )}
                  </div>
                  {r.sections.map((sec, i) => (
                    <div key={i} className="mb-2">
                      {sec.title && <div className="mb-0.5 text-[11.5px] font-medium uppercase tracking-wide text-faint">{sec.title}</div>}
                      <ul className="list-disc space-y-0.5 pl-5 text-[13px]">
                        {sec.items.map((it, j) => (
                          <li key={j}>{it}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-line px-5 py-3">
          <button className={btn} onClick={close}>
            Close
          </button>
          <div className="flex-1" />
          {action && <RestartButtons app={a} action={action} />}
        </div>
      </div>
    </div>,
    document.body
  )
}
