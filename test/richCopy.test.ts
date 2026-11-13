// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { linkTarget, selectionCopy, selectionHtml, setLinkContext, tableText } from '../src/renderer/src/richCopy'

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

describe('links survive pasting', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div data-workspace-id="ws1">
        <div class="prose-chat">
          <p>See <a href="src/renderer/src/richCopy.ts:12">richCopy.ts</a>, <a href="#top">above</a>,
          <a href="https://example.com/a">the docs</a>, <code>https://example.com/b</code> and https://example.com/c.</p>
        </div>
      </div>`
  })

  it('opens file links on GitHub, links bare and code URLs, and drops dead anchors', () => {
    setLinkContext('ws1', { slug: 'acme/app', ref: 'feature/x', root: '/w/app' })
    const prose = document.querySelector('.prose-chat')!
    const html = selectionHtml(select(prose, 0, prose, prose.childNodes.length))!
    expect(html).toContain('<a href="https://github.com/acme/app/blob/feature/x/src/renderer/src/richCopy.ts#L12">richCopy.ts</a>')
    expect(html).toContain('<a href="https://example.com/a">the docs</a>')
    expect(html).toContain('<a href="https://example.com/b"><code>https://example.com/b</code></a>')
    expect(html).toContain('<a href="https://example.com/c">https://example.com/c</a>.')
    expect(html).toContain(', above,')
    expect(html).not.toContain('#top')
  })

  it('keeps file link text but drops the link when the repo is not on GitHub', () => {
    setLinkContext('ws1', {})
    const prose = document.querySelector('.prose-chat')!
    const html = selectionHtml(select(prose, 0, prose, prose.childNodes.length))!
    expect(html).toContain('See richCopy.ts,')
  })

  it('gives Copy Link the resolved URL', () => {
    setLinkContext('ws1', { slug: 'acme/app', ref: 'main', root: '/w/app' })
    const [file, anchor, web] = Array.from(document.querySelectorAll('a'))
    expect(linkTarget(file)).toBe('https://github.com/acme/app/blob/main/src/renderer/src/richCopy.ts#L12')
    expect(linkTarget(anchor)).toBeNull()
    expect(linkTarget(web)).toBe('https://example.com/a')
  })
})

describe('copy for Slack', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="prose-chat">
        <h2>Plan <em>now</em></h2>
        <p><strong>Bold</strong> and <a href="https://example.com">a link</a>.</p>
        <ul><li><input type="checkbox" checked disabled> Done</li><li>Next<ul><li>Sub</li></ul></li></ul>
        <hr>
        <table><thead><tr><th>Name</th><th>Status</th></tr></thead>
          <tbody><tr><td>Launch v2 onboarding</td><td>Done</td></tr><tr><td>API</td><td>Open</td></tr></tbody></table>
        <pre><code>const a = 1</code></pre>
      </div>`
  })

  const copyAll = () => {
    const prose = document.querySelector('.prose-chat')!
    return selectionCopy(select(prose, 0, prose, prose.childNodes.length), 'slack')!
  }

  it('turns headings into bold lines and tables into aligned code blocks', () => {
    const { html } = copyAll()
    expect(html).not.toMatch(/<h\d|<table|<hr|<input/)
    expect(html).toContain('<p><b>Plan <em>now</em></b></p>')
    expect(html).toContain('<pre>Name                 | Status\n---------------------|-------\nLaunch v2 onboarding | Done\nAPI                  | Open</pre>')
    expect(html).toContain('<a href="https://example.com">a link</a>')
    expect(html).toContain('☑ Done')
  })

  it('writes Slack-style plain text with links spelled out', () => {
    const { text } = copyAll()
    expect(text).toContain('*Plan _now_*')
    expect(text).toContain('*Bold* and a link (https://example.com).')
    expect(text).toContain('• ☑ Done\n• Next\n    • Sub')
    expect(text).toContain('```\nName                 | Status')
    expect(text).toContain('```\nconst a = 1\n```')
  })

  it('leaves the normal copy shaped for Notion', () => {
    const prose = document.querySelector('.prose-chat')!
    const html = selectionHtml(select(prose, 0, prose, prose.childNodes.length))!
    expect(html).toContain('<h2>Plan <em>now</em></h2>')
    expect(html).toContain('<table>')
  })
})

describe('tableText', () => {
  it('pads ragged rows', () => {
    const t = document.createElement('table')
    t.innerHTML = '<tr><td>a</td><td>bb</td></tr><tr><td>ccc</td></tr>'
    expect(tableText(t)).toBe('a   | bb\nccc |')
  })
})
