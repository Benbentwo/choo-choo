import { shell } from 'electron'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const PAGE = (msg: string) =>
  `<!doctype html><meta charset="utf-8"><title>Choo Choo</title><body style="font:15px -apple-system,system-ui;display:grid;place-items:center;height:90vh;color:#444"><p>${msg}</p></body>`

/**
 * Listens on a random 127.0.0.1 port for the OAuth redirect. The redirect URI is known before the
 * browser opens, so providers that register the app first (dynamic client registration) can use it.
 */
export async function loopback(timeoutMs = 5 * 60_000) {
  let deliver: (r: { code?: string; state?: string; error?: string }) => void = () => {}
  const got = new Promise<{ code?: string; state?: string; error?: string }>((r) => (deliver = r))
  const server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (u.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    const error = u.searchParams.get('error_description') ?? u.searchParams.get('error') ?? undefined
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE(error ? 'Sign-in was cancelled. You can close this tab.' : 'Signed in. You can close this tab and go back to Choo Choo.'))
    deliver({ code: u.searchParams.get('code') ?? undefined, state: u.searchParams.get('state') ?? undefined, error })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  const redirectUri = `http://127.0.0.1:${port}/callback`
  return {
    redirectUri,
    async waitForCode(authUrl: string, state: string): Promise<string> {
      await shell.openExternal(authUrl)
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error('Sign-in timed out')), timeoutMs)))
      try {
        const r = await Promise.race([got, timeout])
        if (r.error) throw new Error(`Sign-in failed: ${r.error}`)
        if (r.state !== state) throw new Error('Sign-in failed: state mismatch')
        if (!r.code) throw new Error('Sign-in failed: no code returned')
        return r.code
      } finally {
        clearTimeout(timer)
      }
    },
    close: () => server.close()
  }
}
