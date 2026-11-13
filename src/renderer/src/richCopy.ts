/**
 * Copying from Claude's chat text puts plain, semantic HTML on the clipboard (no classes, inline
 * styles or buttons), so pasting into Notion, Docs or Slack keeps tables, lists, headings, links
 * and code without the app's dark-theme styling. Selections that start or end inside a table keep
 * the table around the copied cells.
 */

const KEEP_ATTRS: Record<string, string[]> = { A: ['href'], TH: ['colspan', 'rowspan'], TD: ['colspan', 'rowspan'], OL: ['start'] }

function clean(root: ParentNode) {
  root.querySelectorAll('button, svg, script, style').forEach((el) => el.remove())
  root.querySelectorAll('*').forEach((el) => {
    const keep = KEEP_ATTRS[el.tagName] ?? []
    for (const a of Array.from(el.attributes)) if (!keep.includes(a.name)) el.removeAttribute(a.name)
  })
  // Wrappers like the code block's group div add nothing once their classes are gone.
  root.querySelectorAll('div, span').forEach((el) => el.replaceWith(...Array.from(el.childNodes)))
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

/** The selection as clean HTML, or null when it isn't (only) Claude's chat text. */
export function selectionHtml(sel: Selection): string | null {
  const box = document.createElement('div')
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
    const frag = range.cloneContents()
    const inTable = ancEl.closest('tr, thead, tbody, tfoot, table') && !ancEl.closest('td, th')
    box.append(inTable ? wrapInTable(frag, ancEl) : frag)
  }
  clean(box)
  return box.innerHTML
}

export function installRichCopy() {
  document.addEventListener('copy', (e) => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !e.clipboardData) return
    // Text fields copy their own text; leave the composer and inputs alone.
    const t = e.target as Element | null
    if (t?.closest?.('input, textarea, [contenteditable]')) return
    const html = selectionHtml(sel)
    if (html == null) return
    e.preventDefault()
    e.clipboardData.setData('text/html', `<meta charset="utf-8">${html}`)
    e.clipboardData.setData('text/plain', sel.toString())
  })
}
