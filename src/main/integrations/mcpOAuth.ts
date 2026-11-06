import { createHash, randomBytes } from 'node:crypto'

/**
 * OAuth for a hosted MCP server (the MCP authorization spec): discover the authorization server,
 * register this app as a public client (dynamic client registration), then authorization code + PKCE.
 * No client secret is involved, so it works in an open-source desktop app.
 */

export interface McpAuthServer {
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint?: string
}

export interface McpTokens {
  accessToken: string
  refreshToken?: string
  /** Epoch ms. */
  expiresAt?: number
  clientId: string
  tokenEndpoint: string
}

const b64url = (b: Buffer) => b.toString('base64url')

export function pkce() {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

async function getJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

/** Finds the authorization server for an MCP endpoint, falling back to /authorize, /token and /register on its origin. */
export async function discover(mcpUrl: string): Promise<McpAuthServer> {
  const u = new URL(mcpUrl)
  const resource =
    (await getJson(`${u.origin}/.well-known/oauth-protected-resource${u.pathname}`)) ?? (await getJson(`${u.origin}/.well-known/oauth-protected-resource`))
  const issuer: string = resource?.authorization_servers?.[0] ?? u.origin
  const meta = (await getJson(`${issuer.replace(/\/$/, '')}/.well-known/oauth-authorization-server`)) ?? (await getJson(`${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`))
  if (meta?.authorization_endpoint && meta?.token_endpoint) return meta
  return { authorization_endpoint: `${u.origin}/authorize`, token_endpoint: `${u.origin}/token`, registration_endpoint: `${u.origin}/register` }
}

export async function register(server: McpAuthServer, redirectUri: string, clientName: string): Promise<string> {
  if (!server.registration_endpoint) throw new Error('This server does not support app registration')
  const res = await fetch(server.registration_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    })
  })
  if (!res.ok) throw new Error(`App registration failed (${res.status}): ${await res.text()}`)
  const body = (await res.json()) as { client_id?: string }
  if (!body.client_id) throw new Error('App registration returned no client id')
  return body.client_id
}

export function authorizeUrl(server: McpAuthServer, p: { clientId: string; redirectUri: string; challenge: string; state: string; resource: string }) {
  const u = new URL(server.authorization_endpoint)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', p.clientId)
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('code_challenge', p.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  u.searchParams.set('state', p.state)
  u.searchParams.set('resource', p.resource)
  return u.toString()
}

async function tokenRequest(endpoint: string, clientId: string, params: Record<string, string>): Promise<McpTokens> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, ...params })
  })
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}): ${await res.text()}`)
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number }
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? params.refresh_token,
    expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : undefined,
    clientId,
    tokenEndpoint: endpoint
  }
}

export function exchangeCode(server: McpAuthServer, p: { clientId: string; code: string; verifier: string; redirectUri: string; resource: string }) {
  return tokenRequest(server.token_endpoint, p.clientId, {
    grant_type: 'authorization_code',
    code: p.code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    resource: p.resource
  })
}

export function refresh(t: McpTokens, resource: string) {
  if (!t.refreshToken) throw new Error('Sign-in expired. Sign in again in Settings.')
  return tokenRequest(t.tokenEndpoint, t.clientId, { grant_type: 'refresh_token', refresh_token: t.refreshToken, resource })
}

/** True when the token is missing an expiry or has more than a minute left. */
export const fresh = (t: McpTokens) => !t.expiresAt || t.expiresAt - Date.now() > 60_000
