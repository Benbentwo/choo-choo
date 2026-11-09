/**
 * The script every add-on view loads from `/@choo/host.js`. It defines `window.choo`, which talks
 * to the app window with postMessage; the view has no other way out of its sandbox. Kept as a
 * string because it runs in the view, not in the app. See docs/addon-api.md.
 */
export const HOST_SCRIPT_PATH = '/@choo/host.js'

export const HOST_SCRIPT = String.raw`(() => {
  if (window.choo) return
  let seq = 0
  const pending = new Map()
  const listeners = { workspaces: new Set(), theme: new Set() }
  let resolveReady
  const ready = new Promise((r) => (resolveReady = r))

  function applyTheme(theme, dark) {
    const root = document.documentElement
    for (const [k, v] of Object.entries(theme)) root.style.setProperty('--choo-' + k, v)
    root.style.colorScheme = dark ? 'dark' : 'light'
    root.dataset.chooTheme = dark ? 'dark' : 'light'
  }

  const call = (method, args) =>
    new Promise((resolve, reject) => {
      const id = ++seq
      pending.set(id, { resolve, reject })
      window.parent.postMessage({ choo: 1, type: 'call', id, method, args }, '*')
    })

  window.addEventListener('message', (e) => {
    if (e.source !== window.parent) return
    const m = e.data
    if (!m || m.choo !== 1) return
    if (m.type === 'init') {
      choo.context = m.context
      choo.theme = m.theme
      choo.dark = m.dark
      choo.apiVersion = m.apiVersion
      applyTheme(m.theme, m.dark)
      resolveReady(choo)
    } else if (m.type === 'result') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error))
    } else if (m.type === 'event') {
      if (m.name === 'theme') {
        choo.theme = m.theme
        choo.dark = m.dark
        applyTheme(m.theme, m.dark)
      }
      for (const cb of listeners[m.name] || []) {
        try {
          cb(m)
        } catch (err) {
          console.error(err)
        }
      }
    }
  })

  const choo = {
    /** Resolves with choo once the app has sent this view's context and theme. */
    ready,
    context: null,
    theme: {},
    dark: true,
    apiVersion: 0,
    call,
    /** on('workspaces', cb): something about a workspace changed, list again. on('theme', cb): colors changed. Returns a function that stops listening. */
    on(name, cb) {
      if (!listeners[name]) throw new Error('Unknown event ' + name)
      listeners[name].add(cb)
      return () => listeners[name].delete(cb)
    },
    app: { info: () => call('app.info') },
    repos: { list: () => call('repos.list') },
    workspaces: {
      list: (opts) => call('workspaces.list', opts),
      read: (workspaceId, opts) => call('workspaces.read', { workspaceId, ...(opts || {}) }),
      start: (opts) => call('workspaces.start', opts),
      message: (workspaceId, message) => call('workspaces.message', { workspaceId, message }),
      stop: (workspaceId) => call('workspaces.stop', { workspaceId })
    },
    prs: { status: (workspaceId) => call('prs.status', { workspaceId }) },
    store: {
      get: (key) => call('store.get', { key }),
      set: (key, value) => call('store.set', { key, value }),
      delete: (key) => call('store.delete', { key }),
      keys: () => call('store.keys')
    },
    ui: {
      openWorkspace: (workspaceId) => call('ui.openWorkspace', { workspaceId }),
      notify: (title, body, workspaceId) => call('ui.notify', { title, body, workspaceId })
    }
  }
  window.choo = choo
  window.parent.postMessage({ choo: 1, type: 'hello' }, '*')
})()
`
