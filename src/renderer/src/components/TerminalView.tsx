import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useStore } from '../store'
import { APPEARANCE_EVENT, pickAppearance, resolved, terminalTheme } from '../appearance'

/**
 * A shell terminal, or with `attach` a read/write view onto a script's pty that the main process started.
 */
export function TerminalView({ id, workspaceId, attach }: { id: string; workspaceId: string; attach?: boolean }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const look = () => pickAppearance(useStore.getState().settings)
    const term = new Terminal({
      fontFamily: resolved(look()).mono,
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: !attach,
      allowProposedApi: true,
      convertEol: false,
      theme: terminalTheme(look())
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el.current!)
    let disposed = false
    let ready = false
    const pending: string[] = []

    const offData = window.api.onPtyData((pid, data) => {
      if (pid !== id) return
      if (ready) term.write(data)
      else pending.push(data)
    })
    const offExit = window.api.onPtyExit((pid) => {
      if (pid === id && !attach) term.write('\r\n[process exited]\r\n')
    })
    const offStart = window.api.onScriptStarted((wsId, kind) => {
      if (`${wsId}:${kind}` === id) term.reset()
    })
    term.onData((d) => window.api.ptyWrite(id, d))

    const doFit = () => {
      if (disposed || !el.current?.offsetWidth) return
      fit.fit()
      window.api.ptyResize(id, term.cols, term.rows)
    }
    const start = attach ? window.api.ptyAttach(id) : window.api.ptyCreate(id, workspaceId)
    void start.then((scrollback) => {
      if (disposed) return
      // Scrollback already contains anything that arrived before it was read.
      term.write(scrollback || pending.join(''))
      ready = true
      doFit()
    })
    const ro = new ResizeObserver(() => doFit())
    ro.observe(el.current!)
    const onLook = () => {
      term.options.theme = terminalTheme(look())
      const font = resolved(look()).mono
      if (term.options.fontFamily !== font) {
        term.options.fontFamily = font
        doFit()
      }
    }
    window.addEventListener(APPEARANCE_EVENT, onLook)
    // The bundled mono font may still be loading; re-measure cells once it is in.
    void document.fonts.load(`12px ${resolved(look()).mono}`).then(() => {
      if (disposed) return
      term.options.fontFamily = resolved(look()).mono
      doFit()
    })

    return () => {
      disposed = true
      ro.disconnect()
      window.removeEventListener(APPEARANCE_EVENT, onLook)
      offData()
      offExit()
      offStart()
      term.dispose()
    }
  }, [id, workspaceId, attach])

  return <div ref={el} className="selectable h-full w-full" />
}
