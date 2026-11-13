// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { selectionHtml } from '../src/renderer/src/richCopy'

function select(start: Node, startOffset: number, end: Node, endOffset: number) {
  const sel = window.getSelection()!
  sel.removeAllRanges()
  const r = document.createRange()
  r.setStart(start, startOffset)
  r.setEnd(end, endOffset)
  sel.addRange(r)
  return sel
}

describe('rich copy', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="msg">
        <div class="header"><button class="x">Copy</button>You</div>
        <div class="prose-chat my-3" style="color:red">
          <h2 class="h">Plan</h2>
          <ul class="list"><li>One <a class="link" href="https://example.com" target="_blank">link</a></li></ul>
          <div class="group relative"><button>Copy</button><pre class="code"><code class="lang-ts"><span class="tok">const</span> a = 1</code></pre></div>
          <table class="tbl"><thead><tr><th>Name</th><th>Status</th></tr></thead>
            <tbody><tr id="r1"><td>Launch v2 onboarding</td><td>Done</td></tr><tr id="r2"><td>Migrate to new API</td><td>Open</td></tr></tbody></table>
        </div>
      </div>
      <div class="sidebar"><span>Not chat</span></div>`
  })

  it('strips classes, styles and buttons but keeps structure and links', () => {
    const prose = document.querySelector('.prose-chat')!
    const html = selectionHtml(select(prose, 0, prose, prose.childNodes.length))!
    expect(html).not.toMatch(/class=|style=|<button|<div|<span|target=/)
    expect(html).toContain('<h2>Plan</h2>')
    expect(html).toContain('<a href="https://example.com">link</a>')
    expect(html).toContain('<pre><code>const a = 1</code></pre>')
    expect(html).toContain('<th>Name</th>')
  })

  it('wraps a selection of table rows back in a table', () => {
    const tbody = document.querySelector('tbody')!
    const html = selectionHtml(select(tbody, 0, tbody, 2))!
    expect(html).toMatch(/^<table><tbody><tr><td>Launch v2 onboarding<\/td>/)
    expect(html).toContain('Migrate to new API')
  })

  it('leaves selections outside chat text to the default copy', () => {
    const side = document.querySelector('.sidebar span')!.firstChild!
    expect(selectionHtml(select(side, 0, side, 3))).toBeNull()
  })
})
