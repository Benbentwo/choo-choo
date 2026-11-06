import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { shell } from 'electron'

/** PKCE verifier and S256 challenge (RFC 7636). */
export function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export const randomState = () => randomBytes(16).toString('base64url')

const page = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:90vh;color:#333"><div style="text-align:center"><h2>${title}</h2><p>${body}</p></div></body>`

export interface Loopback {
  /** The exact redirect_uri to register or send, e.g. http://127.0.0.1:47821/callback. */
  redirectUri: string
  /** Opens `authUrl` in the browser and resolves with the code once the provider redirects back. */
  waitForCode(authUrl: string, state: string): Promise<string>
  close(): void
}

/**
 * Starts a one-shot HTTP listener on 127.0.0.1 for the OAuth redirect. Pass a fixed `port` when the
 * provider needs the redirect URI registered ahead of time; 0 picks a free port (for dynamic client
 * registration, where the URI is sent at registration).
 */
export async function startLoopback(port = 0, path = '/callback', timeoutMs = 5 * 60_000): Promise<Loopback> {
  let resolve!: (code: string) => void
  let reject!: (e: Error) => void
  const result = new Promise<string>((res, rej) => ((resolve = res), (reject = rej)))
  result.catch(() => {})
  let expected = ''
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== path) {
      res.writeHead(404).end()
      return
    }
    const err = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (err) {
      res.end(page('Sign-in cancelled', 'You can close this tab and go back to Choo Choo.'))
      reject(new Error(url.searchParams.get('error_description') || err))
    } else if (!code || url.searchParams.get('state') !== expected) {
      res.end(page('Sign-in failed', 'The response did not match this sign-in. Try again from Choo Choo.'))
      reject(new Error('OAuth state mismatch'))
    } else {
      res.end(page('Signed in', 'You can close this tab and go back to Choo Choo.'))
      resolve(code)
    }
  })
  await new Promise<void>((res, rej) => {
    server.once('error', (e: NodeJS.ErrnoException) =>
      rej(e.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use, so sign-in can't receive the redirect. Close whatever uses it and try again.`) : e)
    )
    server.listen(port, '127.0.0.1', () => res())
  })
  const actual = (server.address() as { port: number }).port
  let timer: NodeJS.Timeout | undefined
  const close = () => {
    if (timer) clearTimeout(timer)
    server.close()
  }
  return {
    redirectUri: `http://127.0.0.1:${actual}${path}`,
    async waitForCode(authUrl, state) {
      expected = state
      timer = setTimeout(() => reject(new Error('Sign-in timed out')), timeoutMs)
      try {
        await shell.openExternal(authUrl)
        return await result
      } finally {
        close()
      }
    },
    close
  }
}

/** POSTs a form to a token endpoint and returns the JSON, with the provider's error text on failure. */
export async function postForm<T>(url: string, form: Record<string, string>, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...headers },
    body: new URLSearchParams(form).toString()
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Token request failed (${res.status}): ${text.slice(0, 300)}`)
  return JSON.parse(text) as T
}
