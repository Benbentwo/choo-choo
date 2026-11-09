/**
 * A small client for a hosted MCP server over Streamable HTTP. Enough to call a tool from the main
 * process (for a provider that needs to look something up itself); agents use the SDK's own client.
 */

export class McpError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

let nextId = 1

/** Reads a JSON-RPC response from a JSON body or from a text/event-stream body. */
async function readResponse(res: Response, id: number): Promise<any> {
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('text/event-stream')) return res.status === 202 ? null : res.json()
  const text = await res.text()
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n')
    if (!data) continue
    try {
      const msg = JSON.parse(data)
      if (msg.id === id) return msg
    } catch {
      /* not JSON */
    }
  }
  return null
}

async function rpc(url: string, token: string, sessionId: string | undefined, method: string, params: unknown, notify = false) {
  const id = nextId++
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {})
    },
    body: JSON.stringify(notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params })
  })
  if (!res.ok) throw new McpError(res.status === 401 ? 'Not signed in' : `MCP ${method} failed (${res.status})`, res.status)
  const body = notify ? null : await readResponse(res, id)
  if (body?.error) throw new McpError(body.error.message ?? `MCP ${method} failed`)
  return { result: body?.result, sessionId: res.headers.get('mcp-session-id') ?? sessionId }
}

/** Opens a session, calls one tool and returns its text content. */
export async function callTool(url: string, token: string, name: string, args: Record<string, unknown>): Promise<string> {
  const init = await rpc(url, token, undefined, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'choo-choo', version: '1.0.0' }
  })
  const sid = init.sessionId
  await rpc(url, token, sid, 'notifications/initialized', {}, true)
  const { result } = await rpc(url, token, sid, 'tools/call', { name, arguments: args })
  const text = ((result?.content ?? []) as { type: string; text?: string }[])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
  if (result?.isError) throw new McpError(text || `${name} failed`)
  return text
}
