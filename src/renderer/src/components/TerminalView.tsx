import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

/**
 * A shell terminal, or with `attach` a read/write view onto a script's pty that the main process started.
 */
export function TerminalView({ id, workspaceId, attach }: { id: string; workspaceId: string; attach?: boolean }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: !attach,
      allowProposedApi: true,
      convertEol: false,
      theme: { background: '#1a1817', foreground: '#e8e4e1', cursor: '#e8e4e1', selectionBackground: '#3a3735' }
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

    return () => {
      disposed = true
      ro.disconnect()
      offData()
      offExit()
      offStart()
      term.dispose()
    }
  }, [id, workspaceId, attach])

  return <div ref={el} className="selectable h-full w-full" />
}
