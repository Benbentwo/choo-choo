import { useEffect, useRef, useState } from 'react'
import type { FilePreview, Workspace } from '@shared/types'

export function FileView({ ws, file, line }: { ws: Workspace; file: string; line?: number }) {
  const [f, setF] = useState<FilePreview | null>(null)
  const target = useRef<HTMLTableRowElement>(null)
  useEffect(() => target.current?.scrollIntoView({ block: 'center' }), [f, line])
  useEffect(() => {
    setF(null)
    void window.api.readFile(ws.id, file).then(setF, (e) => setF({ path: file, content: null, reason: String(e) }))
  }, [ws.id, file])

  if (!f) return <div className="flex-1 p-6 text-faint">Loading…</div>
  if (f.content === null) return <div className="flex-1 p-6 text-faint">{f.reason}</div>
  const lines = f.content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return (
    <div className="selectable flex-1 overflow-auto font-mono text-[12px] leading-[20px]">
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-2 text-muted">{file}</div>
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} ref={i + 1 === line ? target : undefined} className={i + 1 === line ? 'bg-accent/15' : undefined}>
              <td className="w-12 pr-3 text-right align-top text-faint select-none">{i + 1}</td>
              <td className="pr-4 whitespace-pre">{l}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
