/**
 * Where a chat's links point once they leave the app. Claude often links files by path
 * (`[richCopy.ts](src/renderer/src/richCopy.ts:12)`), which only means something inside the
 * workspace; pasted into Slack or Notion it should open the file on GitHub instead.
 */
export interface LinkContext {
  /** GitHub owner/name of the workspace's repo, when it is on GitHub. */
  slug?: string
  /** Branch (or commit) the links should open at. */
  ref?: string
  /** The workspace folder, so absolute paths inside it map to repo paths. */
  root?: string
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i
const SAFE_SCHEME = /^(https?|mailto):/i

function encodePath(p: string) {
  return p.split('/').map(encodeURIComponent).join('/')
}

/** Splits `path:12`, `path:12-20`, `path#L12` and `path#L12-L20` into the path and a GitHub line anchor. */
function splitLine(raw: string): { path: string; anchor: string } {
  let m = raw.match(/^(.*?)#L(\d+)(?:-L?(\d+))?$/)
  if (!m) m = raw.match(/^(.*?):(\d+)(?:[-:](\d+))?$/)
  if (!m) return { path: raw.replace(/#.*$/, ''), anchor: '' }
  return { path: m[1], anchor: `#L${m[2]}${m[3] ? `-L${m[3]}` : ''}` }
}

/** Normalizes `./a/../b` and reports whether the path climbs above its start. */
function normalize(p: string): string | null {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!out.length) return null
      out.pop()
    } else out.push(part)
  }
  return out.join('/')
}

/**
 * The URL a link should carry outside the app, or null when it has no useful target there (an
 * in-page anchor, a path we can't place on GitHub, or a script/app-internal scheme).
 */
export function resolveHref(href: string, ctx: LinkContext = {}): string | null {
  const h = href.trim()
  if (!h || h.startsWith('#')) return null
  if (SAFE_SCHEME.test(h)) return h
  if (/^www\./i.test(h)) return `https://${h}`
  let path = h
  if (/^file:/i.test(path)) {
    try {
      path = decodeURIComponent(new URL(path).pathname)
    } catch {
      return null
    }
  } else if (SCHEME.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null
  path = path.replace(/\\/g, '/')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Leave odd escapes as they are.
  }
  if (!ctx.slug) return null
  const { path: file, anchor } = splitLine(path)
  let rel = file
  if (rel.startsWith('/')) {
    const root = ctx.root?.replace(/\\/g, '/').replace(/\/+$/, '')
    if (!root || !(rel === root || rel.startsWith(root + '/'))) return null
    rel = rel.slice(root.length)
  }
  const dir = rel.endsWith('/')
  const norm = normalize(rel)
  if (norm == null) return null
  const ref = ctx.ref || 'HEAD'
  const base = `https://github.com/${ctx.slug}`
  if (!norm) return `${base}/tree/${encodePath(ref)}`
  return `${base}/${dir ? 'tree' : 'blob'}/${encodePath(ref)}/${encodePath(norm)}${dir ? '' : anchor}`
}

/** URLs in running text: http(s) links and bare www. hosts, without trailing punctuation. */
export const BARE_URL = /\b(?:https?:\/\/|www\.)[^\s<>"'`]*[^\s<>"'`.,;:!?)\]}]/gi
