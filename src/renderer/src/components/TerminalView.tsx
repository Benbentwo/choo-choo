import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'

export function TerminalView({ id, workspaceId }: { id: string; workspaceId: string }) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "'SF Mono', 'JetBrains Mono', Menlo, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: { background: '#1a1817', foreground: '#e8e4e1', cursor: '#e8e4e1', selectionBackground: '#3a3735' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el.current!)
    let disposed = false

    const offData = window.api.onPtyData((pid, data) => pid === id && term.write(data))
    const offExit = window.api.onPtyExit((pid) => pid === id && term.write('\r\n[process exited]\r\n'))
    term.onData((d) => window.api.ptyWrite(id, d))

    const doFit = () => {
      if (disposed || !el.current?.offsetWidth) return
      fit.fit()
      window.api.ptyResize(id, term.cols, term.rows)
    }
    void window.api.ptyCreate(id, workspaceId).then((scrollback) => {
      if (scrollback) term.write(scrollback)
      doFit()
    })
    const ro = new ResizeObserver(() => doFit())
    ro.observe(el.current!)

    return () => {
      disposed = true
      ro.disconnect()
      offData()
      offExit()
      term.dispose()
    }
  }, [id, workspaceId])

  return <div ref={el} className="selectable h-full w-full" />
}
