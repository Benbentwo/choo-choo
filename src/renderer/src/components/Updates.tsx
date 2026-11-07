import { useEffect, useState } from 'react'
import type { Settings } from '@shared/types'
import type { UpdateStatus } from '@shared/updates'
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
  if (a.state === 'ready') return 'Restart to update'
  if (a.state === 'installing') return 'Updating…'
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
      return `${a.latest} has downloaded`
    case 'installing':
      return `Running brew upgrade --cask choo-choo…`
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
        label={`Choo Choo ${a.current}`}
        hint={
          <>
            {appLine(a)}
            {a.error && a.state !== 'error' && a.state !== 'unavailable' && <div>{a.error}</div>}
          </>
        }
      >
        {action && (
          <button className={primary} disabled={a.state === 'installing'} onClick={() => void window.api.installAppUpdate().catch(reportError)}>
            {action}
          </button>
        )}
        <button className={btn} disabled={a.state === 'checking' || a.state === 'downloading' || a.state === 'installing'} onClick={() => check('app')}>
          Check now
        </button>
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
        <div className="mx-2 mb-2 rounded-lg border border-line bg-raised p-3">
          <div className="mb-1 font-medium">{a.state === 'ready' ? 'Update ready' : 'Update available'}</div>
          <div className="mb-2 text-[12px] text-muted">
            {a.state === 'ready' ? `Choo Choo ${a.latest} has downloaded.` : a.state === 'installing' ? 'Updating with Homebrew…' : `Choo Choo ${a.latest} is out. You have ${a.current}.`}
          </div>
          <button className={primary} disabled={a.state === 'installing'} onClick={() => void window.api.installAppUpdate().catch(reportError)}>
            {action}
          </button>
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
