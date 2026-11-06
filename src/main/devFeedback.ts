// Dev-only: comments left on the UI in feedback mode are written to .feedback/ in the repo
// so the agent iterating on the app can pick them up.
import { app, ipcMain, type BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface FeedbackPayload {
  comment: string
  selector: string
  component: string | null
  text: string
  rect: { x: number; y: number; width: number; height: number }
}

export function registerDevFeedback(getWin: () => BrowserWindow | null) {
  if (app.isPackaged) return
  const dir = join(process.cwd(), '.feedback')
  ipcMain.handle('devFeedback:submit', async (_e, p: FeedbackPayload) => {
    const win = getWin()
    if (!win) throw new Error('no window')
    mkdirSync(dir, { recursive: true })
    const id = new Date().toISOString().replace(/[:.]/g, '-')
    const pad = 24
    const [w, h] = win.getContentSize()
    const x = Math.max(0, Math.floor(p.rect.x - pad))
    const y = Math.max(0, Math.floor(p.rect.y - pad))
    const crop = {
      x,
      y,
      width: Math.min(w - x, Math.ceil(p.rect.width + pad * 2)),
      height: Math.min(h - y, Math.ceil(p.rect.height + pad * 2))
    }
    const [full, el] = await Promise.all([win.webContents.capturePage(), win.webContents.capturePage(crop)])
    writeFileSync(join(dir, `${id}.full.png`), full.toPNG())
    writeFileSync(join(dir, `${id}.element.png`), el.toPNG())
    // Write the JSON last: its appearance is the signal that the comment is complete.
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, ...p, window: { width: w, height: h } }, null, 2))
    return id
  })
}
