import { app, dialog, net, shell, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { isNewer, newestVersion, parseVersion, type AppUpdateMethod, type UpdateChannel, type UpdateStatus } from '@shared/updates'
import { notesBetween, type GithubRelease, type ReleaseNote } from '@shared/releaseNotes'
import { busyLine } from '@shared/restart'
import * as store from './store'
import { claudeSource, installedExecutable } from './claudeBinary'

const run = promisify(execFile)
type Send = (channel: string, ...args: unknown[]) => void

const RELEASES = 'https://github.com/Benbentwo/choo-choo/releases'
const LATEST_RELEASE_API = 'https://api.github.com/repos/Benbentwo/choo-choo/releases/latest'
const RECENT_RELEASES_API = 'https://api.github.com/repos/Benbentwo/choo-choo/releases?per_page=30'
const NOTES_API = 'https://api.github.com/repos/Benbentwo/choo-choo/releases?per_page=100'
const LATEST_CLAUDE = 'https://registry.npmjs.org/@anthropic-ai/claude-code/latest'
const EVERY = 6 * 60 * 60 * 1000
const BREW = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

/**
 * For recording the README GIFs (scripts/demo, source builds only): a JSON file with a made-up
 * downloaded update `{ current, latest, releases }`, so the update card and What's new show without GitHub.
 */
const DEMO_FILE = app.isPackaged ? undefined : process.env.CHOO_DEMO_UPDATE || undefined
let demoReleases: GithubRelease[] | null = null

let send: Send = () => {}
/** How many chats have a turn running. Restarting waits for this to reach 0. */
let busy: () => number = () => 0
let started = false
/** Set once the app is quitting to install an update, so interrupted chats know why. */
let restarting = false
const status: UpdateStatus = {
  app: { current: app.getVersion(), channel: 'stable', method: 'download', state: 'idle' },
  claude: { source: 'bundled', state: 'idle' }
}

function emit() {
  send('updates:changed', getStatus())
}
const setApp = (p: Partial<UpdateStatus['app']>) => (Object.assign(status.app, p), emit())
const setClaude = (p: Partial<UpdateStatus['claude']>) => (Object.assign(status.claude, p), emit())
const message = (e: unknown) => (e as Error)?.message ?? String(e)

export function getStatus(): UpdateStatus {
  return { app: { ...status.app }, claude: { ...status.claude } }
}

async function getJson<T = Record<string, unknown>>(url: string): Promise<T> {
  const res = await net.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'choo-choo' } })
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`)
  return (await res.json()) as T
}

// ---------- Choo Choo ----------

/** The .app bundle this process runs from, on macOS. */
const appBundle = () => join(dirname(app.getPath('exe')), '..', '..')

/**
 * Squirrel only installs an update that's signed by the same Developer ID as the running app, so unsigned
 * (ad-hoc) builds can't update in place. Those go through Homebrew when it installed them, or the release page.
 */
let method: Promise<AppUpdateMethod> | null = null
function updateMethod(): Promise<AppUpdateMethod> {
  return (method ??= (async () => {
    if (process.platform !== 'darwin') return 'auto'
    try {
      const { stderr } = await run('/usr/bin/codesign', ['-dv', '--verbose=2', appBundle()])
      if (stderr.includes('Authority=Developer ID Application')) return 'auto'
    } catch {
      /* treat as unsigned */
    }
    const brewed = ['/opt/homebrew/Caskroom/choo-choo', '/usr/local/Caskroom/choo-choo'].some(existsSync)
    return brewed && BREW.some(existsSync) ? 'brew' : 'download'
  })())
}

const channel = (): UpdateChannel => (store.get().settings.updateChannel === 'beta' ? 'beta' : 'stable')

type Release = { tag_name?: string; html_url?: string; draft?: boolean }

/** Stable: the release GitHub marks Latest. Beta: the newest of the recent releases, prereleases included. */
async function newestRelease(ch: UpdateChannel): Promise<{ latest?: string; url: string }> {
  if (ch === 'stable') {
    const rel = await getJson<Release>(LATEST_RELEASE_API)
    return { latest: parseVersion(rel.tag_name), url: rel.html_url ?? RELEASES }
  }
  const list = (await getJson<Release[]>(RECENT_RELEASES_API)).filter((r) => !r.draft)
  const latest = newestVersion(list.map((r) => parseVersion(r.tag_name)))
  return { latest, url: list.find((r) => parseVersion(r.tag_name) === latest)?.html_url ?? RELEASES }
}

let checkingApp: Promise<void> | null = null
/** Finds the newest release on your channel. Signed builds start downloading it right away. */
export function checkApp(): Promise<void> {
  return (checkingApp ??= (async () => {
    if (demoReleases) return
    if (!app.isPackaged) return setApp({ state: 'unavailable', error: 'Updates are only checked in the packaged app.' })
    if (['ready', 'installing', 'downloading'].includes(status.app.state)) return
    const ch = channel()
    setApp({ state: 'checking', error: undefined, channel: ch, method: await updateMethod() })
    try {
      const { latest, url } = await newestRelease(ch)
      if (!isNewer(latest, status.app.current)) return setApp({ state: 'up-to-date', latest, url, checkedAt: Date.now() })
      setApp({ state: 'available', latest, url, checkedAt: Date.now() })
      if (status.app.method === 'auto') {
        setApp({ state: 'downloading' })
        // The updater turns prereleases on by itself when the running build is one, so set both every time.
        // Never downgrade: someone leaving beta stays on their build until a newer stable release.
        autoUpdater.allowPrerelease = ch === 'beta'
        autoUpdater.allowDowngrade = false
        await autoUpdater.checkForUpdates()
      }
    } catch (e) {
      setApp({ state: 'error', error: message(e), checkedAt: Date.now() })
    }
  })().finally(() => (checkingApp = null)))
}

function brewBinary() {
  return BREW.find(existsSync)
}

export const isRestartingForUpdate = () => restarting

/** Whether installing quits the app: a downloaded update, or a Homebrew upgrade. */
const restarts = () => status.app.state === 'ready' || (status.app.method === 'brew' && status.app.state === 'available')

/**
 * Restarts into a downloaded update, upgrades through Homebrew, or opens the release page.
 * While chats are running it waits for them to finish (Restart when idle), unless `now` is set:
 * then their turns are cut off and pick up again after the restart (shared/restart.ts).
 */
export async function installAppUpdate(opts: { now?: boolean } = {}) {
  if (restarts() && !opts.now && busy() > 0) return setApp({ restartWhenIdle: true, running: busy() })
  if (status.app.restartWhenIdle) setApp({ restartWhenIdle: false })
  if (status.app.state === 'ready') {
    if (demoReleases) return setApp({ state: 'installing' })
    restarting = true
    return autoUpdater.quitAndInstall()
  }
  if (status.app.method === 'brew' && status.app.state === 'available') {
    const brew = brewBinary()
    if (brew) {
      setApp({ state: 'installing', error: undefined })
      try {
        await run(brew, ['upgrade', '--cask', 'choo-choo'], { timeout: 10 * 60 * 1000, env: { ...process.env, HOMEBREW_NO_ENV_HINTS: '1' } })
        restarting = true
        app.relaunch()
        app.exit(0)
        return
      } catch (e) {
        // Fall back to the release page so there's always a way forward.
        setApp({ state: 'available', method: 'download', error: `brew upgrade failed: ${message(e)}` })
      }
    }
  }
  await shell.openExternal(status.app.url ?? RELEASES)
}

/** Stops waiting to restart. The update stays downloaded and installs when you next quit. */
export function cancelRestart() {
  setApp({ restartWhenIdle: false })
}

/** Keeps the running count fresh while an update waits, and restarts once the last chat finishes. */
function watchBusy() {
  if (!restarts()) {
    if (status.app.running !== undefined || status.app.restartWhenIdle) setApp({ running: undefined, restartWhenIdle: false })
    return
  }
  const n = busy()
  if (n !== status.app.running) setApp({ running: n })
  if (status.app.restartWhenIdle && n === 0) void installAppUpdate()
}

let notesCache: { key: string; notes: Promise<ReleaseNote[]> } | null = null
/** "What's new": release notes for every version after the running one, up to the update. */
export function releaseNotes(): Promise<ReleaseNote[]> {
  const { current, latest, channel: ch } = status.app
  if (!latest || !isNewer(latest, current)) return Promise.resolve([])
  const key = `${current}>${latest}:${ch}`
  if (notesCache?.key !== key) {
    const notes = (demoReleases ? Promise.resolve(demoReleases) : getJson<GithubRelease[]>(NOTES_API)).then((list) => notesBetween(list, current, latest, ch))
    // A failed fetch isn't cached, so opening it again retries.
    notes.catch(() => notesCache?.key === key && (notesCache = null))
    notesCache = { key, notes }
  }
  return notesCache.notes
}

// ---------- Claude Code ----------

/** The Claude Code version the SDK bundles, from its package.json (its exports map hides that file from require). */
function bundledClaudeVersion(): string | undefined {
  try {
    const pkg = join(dirname(require.resolve('@anthropic-ai/claude-agent-sdk')), 'package.json')
    return parseVersion(String(JSON.parse(readFileSync(pkg, 'utf8')).claudeCodeVersion ?? ''))
  } catch {
    return undefined
  }
}

async function binaryVersion(path: string | undefined): Promise<string | undefined> {
  if (!path) return undefined
  try {
    const { stdout } = await run(path, ['--version'], { timeout: 15_000 })
    return parseVersion(stdout)
  } catch {
    return undefined
  }
}

/** Reads which Claude Code runs and its version, without asking npm for the latest. */
async function readClaude() {
  const { source, path } = claudeSource()
  const current = source === 'bundled' ? (bundledClaudeVersion() ?? (await binaryVersion(path))) : await binaryVersion(path)
  const latest = status.claude.latest
  setClaude({
    source,
    path,
    current,
    installedPath: installedExecutable(),
    ...(latest && current && status.claude.state !== 'checking' && status.claude.state !== 'updating' ? { state: isNewer(latest, current) ? 'available' : 'up-to-date' } : {})
  })
}

let checkingClaude: Promise<void> | null = null
export function checkClaude(): Promise<void> {
  return (checkingClaude ??= (async () => {
    setClaude({ state: 'checking', error: undefined })
    try {
      await readClaude()
      const latest = parseVersion(String((await getJson(LATEST_CLAUDE)).version ?? ''))
      setClaude({ latest, checkedAt: Date.now(), state: isNewer(latest, status.claude.current) ? 'available' : 'up-to-date' })
    } catch (e) {
      setClaude({ state: 'error', error: message(e), checkedAt: Date.now() })
    }
  })().finally(() => (checkingClaude = null)))
}

/** Runs `claude update` on your installed copy. The bundled one only changes with a Choo Choo update. */
export async function updateClaude(): Promise<UpdateStatus> {
  const { source, path } = claudeSource()
  if (source !== 'installed' || !path) throw new Error('The bundled Claude Code updates with Choo Choo. Switch to your installed claude to update it on its own.')
  setClaude({ state: 'updating', error: undefined })
  try {
    await run(path, ['update'], { timeout: 5 * 60 * 1000 })
  } catch (e) {
    setClaude({ state: 'error', error: `claude update failed: ${message(e)}` })
    return getStatus()
  }
  await checkClaude()
  return getStatus()
}

// ---------- Wiring ----------

/** Checks both, whatever the Settings toggles say. */
export async function checkNowFor(which: 'app' | 'claude' | 'all' = 'all'): Promise<UpdateStatus> {
  await Promise.all([which !== 'claude' && checkApp(), which !== 'app' && checkClaude()])
  return getStatus()
}

function scheduled() {
  const s = store.get().settings
  if (s.checkAppUpdates) void checkApp()
  if (s.checkClaudeUpdates) void checkClaude()
  else void readClaude()
}

export function startUpdater(sender: Send, opts: { busy?: () => number } = {}) {
  if (started) return
  started = true
  send = sender
  if (opts.busy) busy = opts.busy
  if (DEMO_FILE) {
    const demo = JSON.parse(readFileSync(DEMO_FILE, 'utf8')) as { current: string; latest: string; releases: GithubRelease[] }
    demoReleases = demo.releases
    Object.assign(status.app, { current: demo.current, latest: demo.latest, state: 'ready', method: 'auto' })
  }
  setInterval(watchBusy, 2_000).unref?.()
  status.app.channel = channel()
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => setApp({ state: 'ready', latest: info.version }))
  // The release has no update files for this build; send people to the release page instead.
  autoUpdater.on('update-not-available', () => status.app.state === 'downloading' && setApp({ state: 'available', method: 'download' }))
  autoUpdater.on('error', (e) => {
    console.warn('[updater]', message(e))
    // Downloading in place failed; the release page still works.
    if (status.app.state === 'downloading') setApp({ state: 'available', method: 'download', error: message(e) })
  })
  setTimeout(scheduled, 5_000)
  setInterval(scheduled, EVERY)
}

/** Call after Settings change, so the shown Claude Code and the toggles take effect right away. */
export function onSettingsChanged(keys: string[]) {
  if (keys.includes('claudeBinary')) void (store.get().settings.checkClaudeUpdates ? checkClaude() : readClaude())
  if (keys.includes('checkAppUpdates') && store.get().settings.checkAppUpdates) void checkApp()
  else if (keys.includes('updateChannel')) {
    setApp({ channel: channel() })
    if (store.get().settings.checkAppUpdates) void checkApp()
  }
  if (keys.includes('checkClaudeUpdates') && store.get().settings.checkClaudeUpdates) void checkClaude()
}

/** For the menu item: tells the user the outcome either way. */
export async function checkNow(win: BrowserWindow | null) {
  const show = (msg: string, detail?: string, buttons?: string[]) => (win ? dialog.showMessageBox(win, { message: msg, detail, buttons }) : null)
  if (status.app.state === 'ready') {
    const n = busy()
    if (!n) return installAppUpdate()
    const r = await show(`Choo Choo ${status.app.latest} is ready to install.`, busyLine(n), ['Restart when idle', 'Restart now', 'Cancel'])
    if (r?.response === 0) return installAppUpdate()
    if (r?.response === 1) return installAppUpdate({ now: true })
    return
  }
  await checkApp()
  const a = status.app
  if (a.state === 'unavailable') return void show(a.error ?? 'Updates are unavailable.')
  if (a.state === 'error') return void show('Could not check for updates.', a.error)
  if (a.state === 'up-to-date') return void show(`Choo Choo ${a.current} is up to date.`)
  if (a.state === 'downloading') return void show(`Downloading Choo Choo ${a.latest}…`, 'You will be asked to restart when it is ready.')
  const action = a.method === 'brew' ? 'Update with Homebrew' : 'Open download page'
  const r = await show(`Choo Choo ${a.latest} is available.`, `You have ${a.current}.`, [action, 'Later'])
  if (r?.response === 0) await installAppUpdate()
}
