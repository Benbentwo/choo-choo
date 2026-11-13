/**
 * Copying from Claude's chat text puts plain, semantic HTML on the clipboard (no classes, inline
 * styles or buttons), so pasting into Notion or Docs keeps tables, lists, headings, links and code
 * without the app's dark-theme styling. Selections that start or end inside a table keep the table
 * around the copied cells.
 *
 * "Copy for Slack" (Edit menu, ⌥⌘C, or the right-click menu) shapes the same selection for Slack,
 * which can't show tables or headings: tables become aligned code blocks and headings bold lines.
 *
 * Either way, links are made to work outside the app: file paths Claude links to open on GitHub at
 * the workspace's branch, bare URLs become links, and links with no target outside the app are
 * dropped to plain text.
 */
import { BARE_URL, resolveHref, type LinkContext } from '@shared/linkHref'

export type CopyMode = 'rich' | 'slack'

const KEEP_ATTRS: Record<string, string[]> = { A: ['href'], TH: ['colspan', 'rowspan'], TD: ['colspan', 'rowspan'], OL: ['start'] }

function clean(root: ParentNode) {
  // Task-list checkboxes would paste as nothing (or as a live box); keep them as a mark.
  root.querySelectorAll('input[type=checkbox]').forEach((el) => el.replaceWith(`${(el as HTMLInputElement).checked ? '☑' : '☐'}`))
  root.querySelectorAll('button, svg, script, style, input').forEach((el) => el.remove())
  root.querySelectorAll('*').forEach((el) => {
    const keep = KEEP_ATTRS[el.tagName] ?? []
    for (const a of Array.from(el.attributes)) if (!keep.includes(a.name)) el.removeAttribute(a.name)
  })
  // Wrappers like the code block's group div add nothing once their classes are gone.
  root.querySelectorAll('div, span').forEach((el) => el.replaceWith(...Array.from(el.childNodes)))
}

/** Points every link somewhere that works after pasting, and links URLs that are only text. */
export function fixLinks(root: Element, ctx: LinkContext = {}) {
  for (const a of Array.from(root.querySelectorAll('a'))) {
    const href = resolveHref(a.getAttribute('href') ?? '', ctx)
    if (href) a.setAttribute('href', href)
    else a.replaceWith(...Array.from(a.childNodes))
  }
  // A URL in inline code (`https://…`) is still meant to be opened.
  for (const code of Array.from(root.querySelectorAll('code'))) {
    if (code.closest('pre, a')) continue
    const t = code.textContent?.trim() ?? ''
    if (!/^(https?:\/\/|www\.)\S+$/i.test(t)) continue
    const a = document.createElement('a')
    a.setAttribute('href', resolveHref(t) ?? t)
    code.replaceWith(a)
    a.append(code)
  }
  // Bare URLs in text that no link covers.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!(n.parentElement?.closest('a, pre, code') ?? null) && BARE_URL.test((n as Text).data)) texts.push(n as Text)
    BARE_URL.lastIndex = 0
  }
  for (const t of texts) {
    const frag = document.createDocumentFragment()
    let last = 0
    for (const m of t.data.matchAll(BARE_URL)) {
      frag.append(t.data.slice(last, m.index))
      const a = document.createElement('a')
      a.setAttribute('href', resolveHref(m[0]) ?? m[0])
      a.textContent = m[0]
      frag.append(a)
      last = m.index! + m[0].length
    }
    frag.append(t.data.slice(last))
    t.replaceWith(frag)
  }
}

/** A table as monospaced text with padded columns, for destinations that can't show tables. */
export function tableText(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.querySelectorAll('th, td')).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim())
  )
  const cols = Math.max(0, ...rows.map((r) => r.length))
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...rows.map((r) => [...(r[i] ?? '')].length)))
  const line = (r: string[]) => widths.map((w, i) => (r[i] ?? '').padEnd(w)).join(' | ').trimEnd()
  const out = rows.map(line)
  // Rule under the header row, like Markdown.
  if (rows.length > 1 && table.querySelector('tr')?.querySelector('th')) out.splice(1, 0, widths.map((w) => '-'.repeat(w)).join('-|-'))
  return out.join('\n')
}

/** Rewrites what Slack can't show: headings become bold lines, tables code blocks, rules nothing. */
export function slackify(root: Element) {
  for (const t of Array.from(root.querySelectorAll('table'))) {
    const pre = document.createElement('pre')
    pre.textContent = tableText(t)
    t.replaceWith(pre)
  }
  for (const h of Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))) {
    const p = document.createElement('p')
    const b = document.createElement('b')
    b.append(...Array.from(h.childNodes))
    p.append(b)
    h.replaceWith(p)
  }
  root.querySelectorAll('hr').forEach((el) => el.remove())
}

/**
 * The same content as Slack-style text, for when Slack (or any plain-text field) takes the plain
 * version: *bold*, _italic_, `code`, ``` blocks, bullets, and links as "text (url)".
 */
export function slackText(root: Node): string {
  const inline = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n as Text).data.replace(/\s+/g, ' ')
    if (!(n instanceof Element)) return ''
    const inner = () => Array.from(n.childNodes).map(inline).join('')
    switch (n.tagName) {
      case 'BR':
        return '\n'
      case 'B':
      case 'STRONG':
        return wrap('*', inner())
      case 'I':
      case 'EM':
        return wrap('_', inner())
      case 'DEL':
      case 'S':
        return wrap('~', inner())
      case 'CODE':
        return '`' + (n.textContent ?? '') + '`'
      case 'A': {
        const href = n.getAttribute('href') ?? ''
        const text = inner().trim()
        if (!href) return text
        if (!text || text === href || `https://${text}` === href || text === href.replace(/^mailto:/, '')) return href
        return `${text} (${href})`
      }
      default:
        return inner()
    }
  }
  const blocks: string[] = []
  const block = (n: Node, indent = '') => {
    if (!(n instanceof Element)) {
      const t = inline(n).trim()
      if (t) blocks.push(indent + t)
      return
    }
    switch (n.tagName) {
      case 'PRE':
        blocks.push('```\n' + (n.textContent ?? '').replace(/\n$/, '') + '\n```')
        return
      case 'UL':
      case 'OL': {
        let i = Number(n.getAttribute('start') ?? 1)
        for (const li of Array.from(n.children)) {
          if (li.tagName !== 'LI') continue
          const mark = n.tagName === 'OL' ? `${i++}. ` : '• '
          const own = Array.from(li.childNodes).filter((c) => !(c instanceof Element && ['UL', 'OL', 'PRE', 'P'].includes(c.tagName)))
          const paras = Array.from(li.children).filter((c) => c.tagName === 'P')
          const text = [own.map(inline).join(''), ...paras.map(inline)].map((s) => s.trim()).filter(Boolean).join(' ')
          blocks.push(indent + mark + text)
          for (const sub of Array.from(li.children)) if (['UL', 'OL', 'PRE'].includes(sub.tagName)) block(sub, indent + '    ')
        }
        return
      }
      case 'BLOCKQUOTE': {
        const start = blocks.length
        for (const c of Array.from(n.childNodes)) block(c, indent)
        const quoted = blocks.splice(start).join('\n').split('\n')
        blocks.push(quoted.map((l) => '> ' + l).join('\n'))
        return
      }
      case 'P':
      case 'H1':
      case 'H2':
      case 'H3':
      case 'H4':
      case 'H5':
      case 'H6': {
        const t = inline(n).trim()
        if (t) blocks.push(indent + t)
        return
      }
      case 'LI':
      case 'TR':
      case 'TD':
      case 'TH': {
        const t = inline(n).trim()
        if (t) blocks.push(indent + t)
        return
      }
      default: {
        // A fragment or wrapper: inline runs between blocks are their own paragraphs.
        let run = ''
        const flush = () => {
          if (run.trim()) blocks.push(indent + run.trim())
          run = ''
        }
        for (const c of Array.from(n.childNodes)) {
          if (c instanceof Element && /^(P|PRE|UL|OL|BLOCKQUOTE|H[1-6]|TABLE|LI|TR|TD|TH|DIV)$/.test(c.tagName)) {
            flush()
            block(c, indent)
          } else run += inline(c)
        }
        flush()
      }
    }
  }
  block(root)
  return blocks.join('\n')
}

function wrap(mark: string, s: string) {
  const t = s.trim()
  if (!t) return s
  const lead = s.match(/^\s*/)![0]
  const trail = s.match(/\s*$/)![0]
  return `${lead}${mark}${t}${mark}${trail}`
}

/** Re-adds the table, section and row elements a partial selection inside a table leaves out. */
function wrapInTable(frag: DocumentFragment, ancestor: Element): Node {
  let node: Node = frag
  for (let el: Element | null = ancestor; el; el = el.parentElement) {
    if (!['TR', 'THEAD', 'TBODY', 'TFOOT', 'TABLE'].includes(el.tagName)) continue
    const wrap = document.createElement(el.tagName.toLowerCase())
    wrap.append(node)
    node = wrap
    if (el.tagName === 'TABLE') break
  }
  return node
}

// Link targets per workspace (GitHub slug, branch, folder), fetched when its chat is shown so the
// copy handler, which must answer synchronously, has them.
const contexts = new Map<string, LinkContext>()

export function setLinkContext(workspaceId: string, ctx: LinkContext) {
  contexts.set(workspaceId, ctx)
}

/** Fetches a workspace's link targets (again, since its branch can change); called by the chat view. */
export function primeLinkContext(workspaceId: string) {
  if (!window.api?.linkContext) return
  window.api
    .linkContext(workspaceId)
    .then((ctx) => contexts.set(workspaceId, ctx))
    .catch(() => {})
}

export function linkContextFor(node: Node | null): LinkContext {
  const el = node instanceof Element ? node : node?.parentElement
  const id = el?.closest<HTMLElement>('[data-workspace-id]')?.dataset.workspaceId
  return (id && contexts.get(id)) || {}
}

export interface CopyContent {
  html: string
  text: string
}

/** The selection shaped for pasting, or null when it isn't (only) Claude's chat text. */
export function selectionCopy(sel: Selection, mode: CopyMode = 'rich'): CopyContent | null {
  const box = document.createElement('div')
  let ctx: LinkContext = {}
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i)
    const anc = range.commonAncestorContainer
    const ancEl = anc instanceof Element ? anc : anc.parentElement
    if (!ancEl) return null
    if (!ancEl.closest('.prose-chat')) {
      // Spans several messages: use it only if it touches chat text.
      const parts = Array.from(ancEl.querySelectorAll('.prose-chat'))
      if (!parts.some((p) => range.intersectsNode(p))) return null
    }
    if (i === 0) ctx = linkContextFor(ancEl)
    const frag = range.cloneContents()
    const inTable = ancEl.closest('tr, thead, tbody, tfoot, table') && !ancEl.closest('td, th')
    box.append(inTable ? wrapInTable(frag, ancEl) : frag)
  }
  clean(box)
  fixLinks(box, ctx)
  if (mode === 'slack') {
    slackify(box)
    return { html: box.innerHTML, text: slackText(box) }
  }
  return { html: box.innerHTML, text: sel.toString() }
}

/** The selection as clean HTML, or null when it isn't (only) Claude's chat text. */
export function selectionHtml(sel: Selection, mode: CopyMode = 'rich'): string | null {
  return selectionCopy(sel, mode)?.html ?? null
}

/** The URL "Copy Link" should copy for a link in the app. */
export function linkTarget(a: HTMLAnchorElement): string | null {
  const raw = a.getAttribute('href')
  if (!raw) return null
  return resolveHref(raw, linkContextFor(a)) ?? (raw.startsWith('#') ? null : raw)
}

function copySlack() {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return
  const c = selectionCopy(sel, 'slack')
  // Outside chat text there's nothing to reshape; a plain copy of the text still helps.
  void window.api.writeClipboard(c ?? { text: sel.toString() })
}

export function installRichCopy() {
  document.addEventListener('copy', (e) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !e.clipboardData) return
    // Text fields copy their own text; leave the composer and inputs alone.
    const t = e.target as Element | null
    if (t?.closest?.('input, textarea, [contenteditable]')) return
    const c = selectionCopy(sel)
    if (c == null) return
    e.preventDefault()
    e.clipboardData.setData('text/html', `<meta charset="utf-8">${c.html}`)
    e.clipboardData.setData('text/plain', c.text)
  })

  // Right-click on a link offers Open/Copy Link; on selected chat text, Copy and Copy for Slack.
  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return
    const target = e.target as Element | null
    if (target?.closest?.('input, textarea, [contenteditable]')) return
    const a = target?.closest?.('a[href]') as HTMLAnchorElement | null
    const link = a ? linkTarget(a) : null
    const sel = window.getSelection()
    const selection = !!sel && !sel.isCollapsed && sel.toString().trim() !== ''
    if (!link && !selection) return
    e.preventDefault()
    window.api.showContextMenu({ link: link ?? undefined, selection })
  })

  window.api.onMenu((action) => {
    if (action === 'copy-slack') copySlack()
  })
}
