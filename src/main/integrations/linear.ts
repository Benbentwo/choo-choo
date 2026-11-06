import { clearAuth, getAuth, setAuth, type StoredAuth } from './tokens'
import { pkce, postForm, randomState, startLoopback } from './oauth'
import * as api from './linearApi'
import type { Provider } from './index'

/**
 * Public OAuth client id of the Choo Choo app registered in Linear (Settings → API → OAuth applications).
 * It is not a secret: sign-in uses PKCE, so no client secret ships in the app.
 * CHOO_LINEAR_CLIENT_ID overrides it, for testing your own OAuth app.
 */
const BUILT_IN_CLIENT_ID = ''
const clientId = () => process.env.CHOO_LINEAR_CLIENT_ID || BUILT_IN_CLIENT_ID

/** Fixed so it can be registered as the app's callback URL in Linear. */
export const LINEAR_REDIRECT_PORT = 47821

type TokenResponse = { access_token: string; refresh_token?: string; expires_in?: number }

const toAuth = (t: TokenResponse, prev?: StoredAuth | null): StoredAuth => ({
  ...prev,
  accessToken: t.access_token,
  refreshToken: t.refresh_token ?? prev?.refreshToken,
  expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined
})

let refreshing: Promise<StoredAuth> | null = null

/** A valid access token, refreshed when it is within 5 minutes of expiring. Throws if not signed in. */
async function token(): Promise<string> {
  const auth = getAuth('linear')
  if (!auth) throw new api.LinearAuthError()
  if (!auth.expiresAt || auth.expiresAt - Date.now() > 5 * 60_000 || !auth.refreshToken) return auth.accessToken
  refreshing ??= postForm<TokenResponse>(api.LINEAR_TOKEN_URL, { grant_type: 'refresh_token', refresh_token: auth.refreshToken, client_id: clientId() })
    .then((t) => {
      const next = toAuth(t, auth)
      setAuth('linear', next)
      return next
    })
    .finally(() => (refreshing = null))
  try {
    return (await refreshing).accessToken
  } catch {
    throw new api.LinearAuthError()
  }
}

/** Runs a Linear call, forgetting the sign-in if Linear says it is no longer valid. */
async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await token())
  } catch (e) {
    if (e instanceof api.LinearAuthError) clearAuth('linear')
    throw e
  }
}

export const linear: Provider = {
  id: 'linear',
  label: 'Linear',
  description: 'Start a workspace from a Linear issue, on the branch Linear suggests for it.',
  configured: () => !!clientId(),
  async connect() {
    if (!clientId()) throw new Error('Linear sign-in is not set up in this build yet.')
    const { verifier, challenge } = pkce()
    const state = randomState()
    const loop = await startLoopback(LINEAR_REDIRECT_PORT)
    const url = new URL(api.LINEAR_AUTHORIZE_URL)
    url.search = new URLSearchParams({
      client_id: clientId(),
      redirect_uri: loop.redirectUri,
      response_type: 'code',
      scope: 'read,write',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'consent'
    }).toString()
    const code = await loop.waitForCode(url.toString(), state)
    const t = await postForm<TokenResponse>(api.LINEAR_TOKEN_URL, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: loop.redirectUri,
      client_id: clientId(),
      code_verifier: verifier
    })
    const auth = toAuth(t)
    auth.account = await api.viewer(auth.accessToken).catch(() => undefined)
    setAuth('linear', auth)
  },
  async disconnect() {
    const auth = getAuth('linear')
    clearAuth('linear')
    if (auth) await postForm(api.LINEAR_REVOKE_URL, { token: auth.accessToken }, { authorization: `Bearer ${auth.accessToken}` }).catch(() => {})
  }
}

export const searchIssues = (query: string) => withToken((t) => api.searchIssues(t, query))
export const getIssue = (id: string) => withToken((t) => api.getIssue(t, id))
/** Best effort: a workspace still starts if Linear won't change the status. */
export const markStarted = (id: string) => withToken((t) => api.markStarted(t, id)).catch(() => {})
