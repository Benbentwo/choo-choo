// Issues are public: the "GitHub issue" path in comment mode must never capture, copy or attach a screenshot,
// or put anything from the person's machine in the issue text.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...a: unknown[]) => unknown>(),
  clipboard: { write: vi.fn(), writeImage: vi.fn(), writeBuffer: vi.fn(), writeText: vi.fn() },
  openExternal: vi.fn(async () => undefined),
  capturePage: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: true, getVersion: () => '0.9.2', getPath: () => '/tmp' },
  clipboard: h.clipboard,
  ClipboardItem: class {},
  nativeImage: { createFromBuffer: vi.fn() },
  shell: { openExternal: h.openExternal },
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => h.handlers.set(ch, fn) }
}))

import { registerUiComment } from '../src/main/uiComment'

const win = {
  getContentSize: () => [1200, 800],
  webContents: { capturePage: h.capturePage }
}

describe('comment mode GitHub issue', () => {
  beforeEach(() => {
    h.handlers.clear()
    vi.clearAllMocks()
    registerUiComment({
      getWin: () => win as never,
      repos: () => [],
      reposRoot: '/tmp/repos',
      addRepo: vi.fn(),
      createWorkspace: vi.fn(),
      sendToChat: vi.fn()
    })
  })

  it('opens the issue without taking, copying or attaching a screenshot', async () => {
    const res = (await h.handlers.get('uiComment:submit')!(
      {},
      {
        comment: 'Button is misaligned',
        selector: 'button.x',
        component: 'Header',
        text: 'acme-internal/payments',
        rect: { x: 10, y: 10, width: 50, height: 20 },
        target: 'issue',
        includeFull: true
      }
    )) as { target: string; url: string }
    expect(res.target).toBe('issue')
    expect(h.capturePage).not.toHaveBeenCalled()
    for (const fn of Object.values(h.clipboard)) expect(fn).not.toHaveBeenCalled()
    expect(h.openExternal).toHaveBeenCalledTimes(1)
    const body = new URL(res.url).searchParams.get('body') ?? ''
    expect(body).toContain('Button is misaligned')
    expect(body).not.toMatch(/screenshot|clipboard|paste|data:image|\.png|acme|macOS/i)
  })
})
