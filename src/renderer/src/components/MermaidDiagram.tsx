import { useEffect, useId, useState } from 'react'
import { APPEARANCE_EVENT } from '../appearance'

type Mermaid = typeof import('mermaid').default
let loading: Promise<Mermaid> | null = null
/** Mermaid is large, so it loads the first time a diagram is drawn. */
const loadMermaid = () => (loading ??= import('mermaid').then((m) => m.default))

const isDark = () => document.documentElement.style.colorScheme === 'dark'

/** Follows the app's light/dark theme so diagrams redraw when it changes. */
function useDark() {
  const [dark, setDark] = useState(isDark)
  useEffect(() => {
    const on = () => setDark(isDark())
    window.addEventListener(APPEARANCE_EVENT, on)
    return () => window.removeEventListener(APPEARANCE_EVENT, on)
  }, [])
  return dark
}

/**
 * A ```mermaid fenced block drawn as its diagram. Rendered in Mermaid's strict mode (no scripts,
 * no click handlers, labels sanitized). A diagram that doesn't parse shows the error over its source.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const id = `mmd-${useId().replace(/[^\w-]/g, '')}`
  const dark = useDark()
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)

  useEffect(() => {
    let live = true
    void loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default', fontFamily: 'var(--font-sans)' })
        const out = await mermaid.render(id, source)
        if (live) {
          setSvg(out.svg)
          setError(null)
        }
      })
      .catch((e: unknown) => {
        // A failed render can leave its scratch element in the body.
        document.getElementById(`d${id}`)?.remove()
        if (live) {
          setSvg(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      live = false
    }
  }, [id, source, dark])

  const sourceBlock = (
    <pre>
      <code className="language-mermaid">{source}</code>
    </pre>
  )
  return (
    <div className="group/mmd relative my-2">
      {error ? (
        <>
          <div className="mb-1 font-sans text-[12px] text-del">Mermaid diagram didn't render: {error.split('\n')[0]}</div>
          {sourceBlock}
        </>
      ) : showSource ? (
        sourceBlock
      ) : svg ? (
        // Mermaid's strict mode sanitizes the SVG it returns.
        <div className="mermaid-diagram flex justify-center overflow-x-auto" dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <div className="py-2 font-sans text-[12px] text-faint">Drawing diagram…</div>
      )}
      {!error && svg && (
        <button
          onClick={() => setShowSource((s) => !s)}
          className="absolute top-1 right-1 rounded-md border border-line bg-panel/80 px-1.5 py-0.5 font-sans text-[11px] text-faint opacity-0 backdrop-blur-sm transition-opacity group-hover/mmd:opacity-100 hover:text-fg"
        >
          {showSource ? 'Diagram' : 'Source'}
        </button>
      )}
    </div>
  )
}
