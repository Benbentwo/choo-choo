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

async function launch(world, script, video, ghData, update) {
  const env = {
    ...process.env,
    HOME: `${world}/home`,
    XDG_CONFIG_HOME: `${world}/config`,
    CLAUDE_CONFIG_DIR: `${world}/claude`,
    PATH: `${__dirname}/bin:${process.env.PATH}`,
    CHOO_DEMO_SCRIPT: script ? join(__dirname, 'scripts', script) : '',
    CHOO_DEMO_GH: ghData ? join(__dirname, 'scripts', ghData) : '',
    // A made-up downloaded update and its release notes (src/main/updater.ts).
    CHOO_DEMO_UPDATE: update ? join(__dirname, 'scripts', update) : ''
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

/** A visible pointer, a click ripple, and no comment bubble or sha-dev version. */
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

async function record(name, { script, gh, update, settings, opts }, scene) {
  const world = await freshWorld(name, settings)
  const video = join(WORK, `${name}-video`)
  rmSync(video, { recursive: true, force: true })
  const t0 = Date.now()
  const { app, page } = await launch(world, script, opts?.noGif ? undefined : video, gh, update)
  await page.waitForTimeout(1500)
  await dress(page)
  // A scene that restarts the app gets `relaunch`, which closes it and opens it again on the same world.
  const ctx = { app, page }
  const relaunch = async () => {
    await ctx.app.close()
    Object.assign(ctx, await launch(world, script, undefined, gh, update))
    await ctx.page.waitForTimeout(1500)
    await dress(ctx.page)
    return director(ctx.app, ctx.page)
  }
  // `d.startGif()` cuts the GIF to start there (a little before), skipping setup the GIF doesn't need to show.
  let cut
  const d = Object.assign(director(app, page), { startGif: () => (cut = Math.max(0, (Date.now() - t0) / 1000 - 1.5)) })
  await scene(d, relaunch)
  const trimStart = Number(cut ?? opts?.trimStart ?? 0.8)
  await ctx.app.close()
  if (!opts?.noGif) toGif(video, name, { ...opts, trimStart })
}

/** Starts a workspace on trailhead-web from the sidebar + and sends it a message. */
async function startWorkspace(d, text) {
  const plus = d.side('trailhead-web').locator('xpath=ancestor::*[.//button[@title="New workspace"]][1]').locator('button[title="New workspace"]').first()
  await d.moveTo(d.side('trailhead-web'))
  await d.click(plus)
  await d.wait(900)
  await d.click(d.page.locator('textarea').first())
  await d.type(text, 26)
  await d.page.keyboard.press('Enter')
}

const scenes = {
  // An update has downloaded while a chat runs: What's new shows the release notes, and Restart when
  // idle waits for the chat to finish before restarting.
  'app-updates': () =>
    record('app-updates', { script: 'updates.json', update: 'update-release.json' }, async (d) => {
      await d.wait(500)
      await d.menu('toggle-terminal')
      await startWorkspace(d, 'Add trip notes to the itinerary page')
      await d.wait(2500)
      await d.moveTo(d.page.getByTestId('update-card'))
      await d.wait(900)
      await d.shot?.('1-update-ready-while-running')
      await d.click(d.page.getByRole('button', { name: 'What’s new' }).first())
      await d.wait(2200)
      await d.shot?.('2-whats-new')
      await d.click(d.page.getByRole('dialog').getByRole('button', { name: 'Close' }))
      await d.wait(500)
      await d.click(d.page.getByTestId('update-card').getByRole('button', { name: 'Restart when idle' }))
      await d.wait(1500)
      await d.shot?.('3-restart-when-idle')
      await d.page.getByTestId('update-card').getByText('Restarting…').first().waitFor({ timeout: 60_000 })
      await d.wait(1500)
      await d.shot?.('4-restarting')
    }),

  // A chat's turn is cut off by a restart and picks up in the same chat when the app opens again.
  // Screenshots only (CHOO_DEMO_SHOTS); no GIF.
  'resume-after-restart': () =>
    record('resume-after-restart', { script: 'updates.json', opts: { noGif: true } }, async (d, relaunch) => {
      await d.wait(500)
      await d.menu('toggle-terminal')
      await startWorkspace(d, 'Add trip notes to the itinerary page')
      await d.page.getByText('Now running the tests', { exact: false }).first().waitFor({ timeout: 30_000 })
      await d.wait(1500)
      await d.shot?.('5-running-before-restart')
      const d2 = await relaunch()
      await d2.menu('toggle-terminal')
      await d2.click(d2.side('Trip notes on the itinerary'))
      await d2.wait(800)
      await d2.page.getByText('Trip notes now show under the itinerary', { exact: false }).first().waitFor({ timeout: 30_000 })
      await d2.wait(1200)
      await d2.shot?.('6-picked-up-after-restart')
    }),

  // Settings search: type to find a setting in any section, Enter jumps to it and flashes the row.
  stop: () =>
    record('stop', { script: 'stop.json' }, async (d) => {
      await d.wait(500)
      await d.menu('toggle-terminal')
      await startWorkspace(d, 'Run the end-to-end tests')
      await d.page.getByText('npm run test:e2e', { exact: false }).first().waitFor({ timeout: 30_000 })
      await d.wait(1500)
      await d.shot?.('1-working')
      // This Claude ignores the stop, as a stuck one would: Stopping…, then Force stop.
      await d.click(d.page.getByTestId('stop-button'))
      await d.wait(900)
      await d.shot?.('2-stopping')
      await d.page.locator('[data-testid="stop-button"][data-stopping="slow"]').waitFor({ timeout: 30_000 })
      await d.moveTo(d.page.getByTestId('stop-button'))
      await d.wait(1200)
      await d.shot?.('3-force-stop')
      await d.click(d.page.getByTestId('stop-button'))
      await d.page.getByTestId('stopped-marker').waitFor({ timeout: 30_000 })
      await d.wait(1800)
      await d.shot?.('4-stopped')
      // The test run it started is gone too.
      let left = ''
      try {
        left = execFileSync('pgrep', ['-f', 'sleep 6011']).toString().trim()
      } catch {}
      console.log(left ? `stop: test run still alive (${left})` : 'stop: test run process is gone')
    }),

  // A long wait reads as what it is (the run it waits on and for how long), and Check in answers
  // "what are you doing?" from the chat so far while the turn keeps going.
  'check-in': () =>
    record('check-in', { script: 'check-in.json' }, async (d) => {
      await d.wait(500)
      await d.menu('toggle-terminal')
      await startWorkspace(d, 'Ship the trip notes page once CI passes')
      await d.page.getByText('Waiting on run 48213', { exact: false }).first().waitFor({ timeout: 30_000 })
      await d.wait(4500)
      await d.shot?.('1-waiting')
      await d.click(d.page.getByRole('button', { name: 'Check in' }))
      await d.page.getByText('checks the run every 20 seconds', { exact: false }).waitFor({ timeout: 30_000 })
      await d.wait(2200)
      await d.shot?.('2-check-in')
      await d.click(d.page.locator('textarea').first())
      await d.type('How’s it going?', 45)
      await d.page.keyboard.press('Enter')
      await d.page.getByText('Going fine, just slow', { exact: false }).waitFor({ timeout: 30_000 })
      await d.wait(2500)
      await d.shot?.('3-status-question')
      await d.page.keyboard.press('Escape')
      await d.wait(800)
    }),

  'stop-queued': () =>
    record('stop-queued', { script: 'stop.json', settings: { whileRunning: 'queue' }, opts: { noGif: true } }, async (d) => {
      await d.wait(500)
      await d.menu('toggle-terminal')
      await startWorkspace(d, 'Add search filters for price and distance')
      await d.page.getByText('npm test -- search', { exact: false }).first().waitFor({ timeout: 30_000 })
      await d.wait(800)
      await d.click(d.page.locator('textarea').first())
      await d.type('Then add a reset filters button', 20)
      await d.page.keyboard.press('Enter')
      await d.wait(1200)
      await d.shot?.('5-queued')
      await d.page.keyboard.press('Escape')
      await d.page.getByTestId('stopped-marker').waitFor({ timeout: 30_000 })
      await d.wait(1200)
      await d.shot?.('6-stopped-queued-back')
      let left = ''
      try {
        left = execFileSync('pgrep', ['-f', 'sleep 6012']).toString().trim()
      } catch {}
      console.log(left ? `stop-queued: test run still alive (${left})` : 'stop-queued: test run process is gone')
    }),

  'settings-search': () =>
    record('settings-search', {}, async (d) => {
      await d.wait(600)
      await d.menu('settings')
      await d.wait(900)
      const box = d.page.getByRole('searchbox', { name: 'Search settings' })
      await d.click(box)
      await d.type('notif', 90)
      await d.wait(1400)
      await d.shot?.('settings-search-results')
      await d.page.keyboard.press('ArrowDown')
      await d.wait(500)
      await d.page.keyboard.press('ArrowDown')
      await d.wait(700)
      await d.page.keyboard.press('Enter')
      await d.wait(500)
      await d.shot?.('settings-search-jump')
      await d.wait(1600)
      await d.page.keyboard.press('Meta+f')
      await d.type('dark mode', 90)
      await d.wait(1200)
      await d.page.keyboard.press('Enter')
      await d.wait(400)
      await d.shot?.('settings-search-theme')
      await d.wait(2000)
    }),

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
      await d.wait(1600)
      // Fold a repo to hide its PRs for now, then bring them back.
      await d.click(d.page.getByRole('button', { name: /trailhead\/api/ }))
      await d.wait(1400)
      await d.shot?.('prs-folded')
      await d.click(d.page.getByRole('button', { name: /trailhead\/api/ }))
      await d.wait(1200)
      // Temporary filters: typed in plain words, kept while you look elsewhere, cleared with Reset.
      await d.click(d.page.getByPlaceholder(/Filter for now/))
      await d.type('only PRs by maya-chen', 70)
      await d.wait(500)
      await d.page.keyboard.press('Enter')
      await d.wait(600)
      await d.type('drafts', 90)
      await d.page.keyboard.press('Enter')
      await d.wait(1400)
      await d.shot?.('prs-quick')
      await d.click(d.side('Home'))
      await d.wait(1000)
      await d.click(d.side('PRs'))
      await d.wait(1400)
      await d.shot?.('prs-quick-back')
      await d.click(d.page.getByRole('button', { name: 'Reset' }))
      await d.wait(2000)
    }),

  // GitHub links in a reply turn into short pills with a state dot; hovering one shows a small card.
  'link-previews': () =>
    record('link-previews', { script: 'links.json', gh: 'links-gh.json' }, async (d) => {
      await d.wait(500)
      await d.menu('toggle-terminal')
      await startWorkspace(d, 'Add a date range picker to trip search for https://github.com/trailhead/web/issues/471')
      const pill = (label) => d.page.locator('a.gh-pill', { hasText: label }).first()
      await pill('web#488').waitFor({ timeout: 30_000 })
      await d.wait(1600)
      await d.moveTo(pill('web#488'), 700)
      await d.wait(1500)
      await d.shot?.('1-pr-card')
      // Into the card: it stays open while the pointer is on it.
      await d.moveTo(d.page.getByRole('dialog', { name: 'Link preview' }).getByText('Open in Choo Choo'), 500)
      await d.wait(1300)
      await d.moveTo(pill('api#241'), 700)
      await d.wait(1600)
      await d.shot?.('2-merged-card')
      await d.moveTo(pill('web#471'), 700)
      await d.wait(1600)
      await d.shot?.('3-issue-card')
      await d.moveTo(d.page.locator('a[data-gh-link="file"]').first(), 700)
      await d.wait(1700)
      await d.shot?.('4-file-card')
      await d.moveTo(d.page.locator('textarea').first(), 600)
      await d.wait(900)
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

  // A thread resolves on its own once its work is archived (or its PRs merged or closed): it leaves the
  // sidebar, stays under Resolved and in ⌘K, and Reopen brings it back.
  'resolve-threads': () =>
    record('resolve-threads', { script: 'projects.json' }, async (d) => {
      const archiveRow = (title) => d.side(title).locator('xpath=ancestor::div[@role="button"][1]').locator('button[title="Archive workspace"]')
      await d.wait(400)
      await d.click(d.side('Trip checkout'))
      await d.page.getByTestId('close-right').click()
      await d.click(d.page.locator('textarea').first())
      await d.type('Add Apple Pay to checkout: a button in the web app, and an endpoint in the API for the payment intent.', 4)
      await d.page.keyboard.press('Enter')
      await d.wait(2600)
      await d.click(d.side('Apple Pay at checkout'))
      await d.page.locator('aside').getByText('Payment intent endpoint', { exact: true }).first().waitFor()
      // Both workspaces finish and the thread reports back.
      await d.page.getByText('Want me to open the PRs?').first().waitFor({ timeout: 30_000 })
      // The GIF starts here: projects-threads already shows a thread starting its work.
      d.startGif()
      await d.wait(1200)
      await d.shot?.('1-thread-with-work')
      await d.moveTo(d.side('Apple Pay button'))
      await d.click(archiveRow('Apple Pay button'), 300)
      await d.wait(1400)
      await d.moveTo(d.side('Payment intent endpoint'))
      await d.click(archiveRow('Payment intent endpoint'), 300)
      await d.page.getByTestId('resolved-banner').waitFor({ timeout: 10_000 })
      await d.wait(1400)
      await d.shot?.('2-resolved-on-screen')
      await d.click(d.side('Trip checkout'))
      await d.wait(1200)
      await d.click(d.page.getByTestId('resolved-toggle'))
      await d.wait(1400)
      await d.shot?.('3-sidebar-resolved')
      await d.menu('search')
      await d.wait(400)
      await d.type('apple pay', 60)
      await d.wait(1500)
      await d.shot?.('4-palette')
      await d.page.keyboard.press('Escape')
      await d.wait(400)
      const row = d.page.locator('aside').getByText('Apple Pay at checkout', { exact: true }).first()
      await d.moveTo(row)
      await d.click(row.locator('xpath=ancestor::div[@role="button"][1]').getByRole('button', { name: 'Reopen' }), 300)
      await d.wait(1500)
      await d.shot?.('5-reopened')
    }),

  // The title bar's pane toggles (Threads, Analytics, Details) and the x on each pane. Screenshots only.
  'pane-toggles': () =>
    record('pane-toggles', { script: 'projects.json', opts: { noGif: true } }, async (d) => {
      await d.wait(600)
      await d.click(d.side('Trip checkout'))
      await d.click(d.page.locator('textarea').first())
      await d.type('Add Apple Pay to checkout: a button in the web app, and an endpoint in the API for the payment intent.', 2)
      await d.page.keyboard.press('Enter')
      await d.wait(5000)
      await d.shot?.('project')
      await d.click(d.side('Apple Pay button'))
      await d.wait(4000)
      await d.shot?.('workspace')
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
