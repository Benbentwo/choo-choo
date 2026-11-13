// Records the README GIFs from the real app, driven by Playwright under xvfb, with the stand-in
// Claude in scripts/demo/bin. See docs/demo-gifs.md.
//
//   xvfb-run -a -s "-screen 0 1600x1000x24" node scripts/demo/record.cjs [scene…]
//
// Needs `npm run build` first, Playwright (`npm i -g playwright` or on NODE_PATH) and ffmpeg.
const { _electron } = require('playwright')
const { execFileSync } = require('node:child_process')
const { mkdirSync, readdirSync, rmSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

const REPO = resolve(__dirname, '../..')
const OUT = join(REPO, 'docs/media/gifs')
const WORK = process.env.CHOO_DEMO_DIR || '/tmp/choo-demo'
const W = 1280
const H = 800

async function launch(world, script, video, ghData) {
  const env = {
    ...process.env,
    HOME: `${world}/home`,
    XDG_CONFIG_HOME: `${world}/config`,
    CLAUDE_CONFIG_DIR: `${world}/claude`,
    PATH: `${__dirname}/bin:${process.env.PATH}`,
    CHOO_DEMO_SCRIPT: script ? join(__dirname, 'scripts', script) : '',
    CHOO_DEMO_GH: ghData ? join(__dirname, 'scripts', ghData) : ''
  }
  delete env.ANTHROPIC_API_KEY
  delete env.CLAUDE_CODE_OAUTH_TOKEN
  const app = await _electron.launch({
    executablePath: join(REPO, 'node_modules/electron/dist/electron'),
    args: [REPO, '--no-sandbox'],
    env,
    cwd: REPO,
    ...(video ? { recordVideo: { dir: video, size: { width: W, height: H } } } : {})
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(w, h)
    win.center()
  }, [W, H])
  await page.setViewportSize({ width: W, height: H })
  // Demo owners are made up: draw a plain letter tile instead of fetching a real GitHub avatar.
  await page.route('https://avatars.githubusercontent.com/**', (route) => {
    const owner = new URL(route.request().url()).pathname.slice(1)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" rx="6" fill="#4f7cac"/><text x="20" y="27" font-family="sans-serif" font-size="22" font-weight="600" fill="#fff" text-anchor="middle">${owner[0]?.toUpperCase() ?? '?'}</text></svg>`
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg })
  })
  return { app, page }
}

/** A visible pointer, a click ripple, and no dev-only chrome (comment pill, sha-dev version). */
async function dress(page) {
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = `
      button[title^="Comment mode"] { display: none !important; }
      #demo-cursor { position: fixed; z-index: 2147483647; pointer-events: none; width: 22px; height: 22px; left: 0; top: 0;
        transform: translate(-3px, -2px); transition: left .02s linear, top .02s linear; }
      .demo-ripple { position: fixed; z-index: 2147483646; pointer-events: none; width: 28px; height: 28px; margin: -14px 0 0 -14px;
        border-radius: 50%; border: 2px solid rgba(255,255,255,.85); animation: demo-ripple .45s ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }`
    document.head.appendChild(style)
    const c = document.createElement('div')
    c.id = 'demo-cursor'
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 13.8 L10.5 20 L13.2 18.8 L10.3 12.7 L16.5 12.7 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    c.style.left = '640px'
    c.style.top = '420px'
    document.body.appendChild(c)
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div')
      r.className = 'demo-ripple'
      r.style.left = e.clientX + 'px'
      r.style.top = e.clientY + 'px'
      document.body.appendChild(r)
      setTimeout(() => r.remove(), 500)
    }, true)
    // The sidebar footer shows "<sha>-dev" in a source build; a release shows the version.
    const hideDev = () => document.querySelectorAll('aside span').forEach((s) => { if (/-dev$/.test(s.textContent ?? '')) s.textContent = '' })
    hideDev()
    new MutationObserver(hideDev).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
}

function director(app, page) {
  let pos = { x: 640, y: 420 }
  const d = {
    page,
    wait: (ms) => page.waitForTimeout(ms),
    menu: (cmd) => app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), cmd),
    async moveTo(target, ms = 600) {
      const box = await target.boundingBox()
      if (!box) throw new Error(`not visible: ${target}`)
      const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 }
      const steps = Math.max(8, Math.round(ms / 16))
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
        await page.mouse.move(pos.x + (to.x - pos.x) * e, pos.y + (to.y - pos.y) * e)
        await page.waitForTimeout(ms / steps)
      }
      pos = to
    },
    async click(target, ms) {
      await d.moveTo(target, ms)
      await page.waitForTimeout(120)
      await page.mouse.down()
      await page.mouse.up()
      await page.waitForTimeout(200)
    },
    async type(text, delay = 28) {
      await page.keyboard.type(text, { delay })
    },
    shot: process.env.CHOO_DEMO_SHOTS ? (n) => page.screenshot({ path: `${process.env.CHOO_DEMO_SHOTS}/${n}.png` }) : null,
    side: (text) => page.locator('aside').getByText(text, { exact: true }).first()
  }
  return d
}

/** A fresh demo world with the two sample repos, as a project, and the stand-in Claude selected. */
async function freshWorld(name, extra) {
  const world = join(WORK, name)
  execFileSync(join(__dirname, 'setup.sh'), [world], { stdio: 'ignore' })
  const { app, page } = await launch(world)
  await page.waitForTimeout(1200)
  await page.evaluate(async ([world, extraSettings]) => {
    const web = await window.api.addRepo(`${world}/home/code/trailhead-web`)
    const api = await window.api.addRepo(`${world}/home/code/trailhead-api`)
    await window.api.saveSettings({ experimentalProjects: true, claudeBinary: 'installed', notifications: false, checkAppUpdates: false, checkClaudeUpdates: false, ...extraSettings })
    await window.api.saveGroup({ name: 'Trip checkout', repoIds: [web.id, api.id], icon: 'rocket' })
  }, [world, extra ?? {}])
  await page.waitForTimeout(800)
  await app.close()
  return world
}

function toGif(videoDir, name, { fps = 8, width = 1000, trimStart = 0 } = {}) {
  const webm = readdirSync(videoDir).filter((f) => f.endsWith('.webm')).map((f) => join(videoDir, f))[0]
  const gif = join(OUT, `${name}.gif`)
  mkdirSync(OUT, { recursive: true })
  const filters = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(trimStart), '-i', webm, '-vf', filters, '-loop', '0', gif])
  console.log(`${gif}  ${(statSync(gif).size / 1024).toFixed(0)} KB`)
}

async function record(name, { script, gh, settings, opts }, scene) {
  const world = await freshWorld(name, settings)
  const video = join(WORK, `${name}-video`)
  rmSync(video, { recursive: true, force: true })
  const { app, page } = await launch(world, script, video, gh)
  await page.waitForTimeout(1500)
  await dress(page)
  await scene(director(app, page))
  const trimStart = Number(opts?.trimStart ?? 0.8)
  await app.close()
  toGif(video, name, { ...opts, trimStart })
}

const scenes = {
  // The PRs page: PRs waiting on your review and your own, grouped by repo, with filters.
  'prs-page': () =>
    record('prs-page', { gh: 'prs.json' }, async (d) => {
      await d.wait(600)
      await d.click(d.side('PRs'))
      await d.wait(1800)
      await d.moveTo(d.page.getByText('Show trip weather on the itinerary'))
      await d.wait(1400)
      await d.shot?.('prs')
      await d.moveTo(d.page.getByText('Rate limit the search endpoint'))
      await d.wait(1000)
      await d.click(d.page.getByRole('button', { name: /^Mine/ }))
      await d.wait(1800)
      await d.click(d.page.getByRole('button', { name: /^All/ }))
      await d.wait(2200)
    }),

  // A project chat routes a request to a new thread, the thread starts a workspace (git worktree) in
  // each repo, and the workspace agents do the work.
  'projects-threads': () =>
    record('projects-threads', { script: 'projects.json' }, async (d) => {
      await d.wait(600)
      await d.click(d.side('Trip checkout'))
      await d.menu('toggle-right')
      await d.wait(700)
      await d.click(d.page.locator('textarea').first())
      await d.type('Add Apple Pay to checkout: a button in the web app, and an endpoint in the API for the payment intent.', 22)
      await d.wait(300)
      await d.page.keyboard.press('Enter')
      await d.wait(3000)
      await d.click(d.side('Apple Pay at checkout'))
      await d.wait(3600)
      await d.click(d.side('Apple Pay button'))
      await d.menu('toggle-right')
      await d.wait(200)
      await d.menu('toggle-terminal')
      await d.wait(7000)
      await d.click(d.page.getByText('ApplePayButton.tsx').last())
      await d.wait(3000)
    }),

  // Two workspaces from the + on each repo, agents working in parallel, then side by side.
  'parallel-workspaces': () =>
    record('parallel-workspaces', { script: 'workspaces.json' }, async (d) => {
      const plus = (repo) => d.side(repo).locator('xpath=ancestor::*[.//button[@title="New workspace"]][1]').locator('button[title="New workspace"]').first()
      await d.wait(500)
      await d.moveTo(d.side('trailhead-web'))
      await d.click(plus('trailhead-web'))
      await d.wait(900)
      await d.menu('toggle-terminal')
      await d.click(d.page.locator('textarea').first())
      await d.type('Add a dark mode toggle to the header', 26)
      await d.page.keyboard.press('Enter')
      await d.wait(1800)
      await d.moveTo(d.side('trailhead-api'))
      await d.click(plus('trailhead-api'))
      await d.wait(900)
      await d.click(d.page.locator('textarea').first())
      await d.type('Fix the flaky orders test', 26)
      await d.page.keyboard.press('Enter')
      await d.wait(600)
      await d.menu('toggle-right')
      await d.wait(400)
      await d.menu('split-right')
      await d.wait(1200)
      await d.click(d.page.getByText('Dark mode toggle', { exact: true }).last())
      await d.wait(4000)
      await d.shot?.('split-after')
      await d.wait(6000)
    })
}

;(async () => {
  const wanted = process.argv.slice(2)
  for (const [name, run] of Object.entries(scenes)) if (!wanted.length || wanted.includes(name)) await run()
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
