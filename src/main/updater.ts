import { app, dialog, type BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

type Send = (channel: string, ...args: unknown[]) => void

let started = false
let ready: string | null = null

/** Checks GitHub releases for a newer build, downloads it in the background and offers a restart. */
export function startUpdater(send: Send) {
  if (!app.isPackaged || started) return
  started = true
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    ready = info.version
    send('update:ready', info.version)
  })
  autoUpdater.on('error', (e) => console.warn('[updater]', e?.message ?? e))
  const check = () => void autoUpdater.checkForUpdates().catch((e) => console.warn('[updater]', e?.message ?? e))
  check()
  setInterval(check, 6 * 60 * 60 * 1000)
}

/** For the menu item: tells the user the outcome either way. */
export async function checkNow(win: BrowserWindow | null) {
  const show = (message: string, detail?: string) => win && void dialog.showMessageBox(win, { message, detail })
  if (!app.isPackaged) return show('Updates are only available in the packaged app.')
  if (ready) return installUpdate()
  try {
    const r = await autoUpdater.checkForUpdates()
    const latest = r?.updateInfo?.version
    if (!latest || latest === app.getVersion()) show(`Choo Choo ${app.getVersion()} is up to date.`)
    else show(`Downloading Choo Choo ${latest}…`, 'You will be asked to restart when it is ready.')
  } catch (e) {
    show('Could not check for updates.', `${(e as Error).message}\n\nAutomatic updates need a signed build.`)
  }
}

export function installUpdate() {
  autoUpdater.quitAndInstall()
}
