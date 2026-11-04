import { useEffect, useState } from 'react'
import type { Workspace } from '@shared/types'
import { useStore } from '../store'

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  oldNo?: number
  newNo?: number
}

export function parseDiff(diff: string): Line[] {
  const out: Line[] = []
  let o = 0
  let n = 0
  let inHunk = false
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/)
      o = m ? Number(m[1]) : 0
      n = m ? Number(m[2]) : 0
      inHunk = true
      out.push({ kind: 'hunk', text: raw })
    } else if (!inHunk) {
      continue // file headers
    } else if (raw.startsWith('+')) {
      out.push({ kind: 'add', text: raw.slice(1), newNo: n++ })
    } else if (raw.startsWith('-')) {
      out.push({ kind: 'del', text: raw.slice(1), oldNo: o++ })
    } else if (raw.startsWith('\\')) {
      out.push({ kind: 'meta', text: raw })
    } else if (raw.length > 0 || out.length) {
      out.push({ kind: 'ctx', text: raw.slice(1), oldNo: o++, newNo: n++ })
    }
  }
  while (out.length && out[out.length - 1].kind === 'ctx' && out[out.length - 1].text === '') out.pop()
  return out
}

export function DiffView({ ws, file }: { ws: Workspace; file: string }) {
  const [diff, setDiff] = useState<string | null>(null)
  const stats = useStore((s) => s.stats[ws.id])

  useEffect(() => {
    setDiff(null)
    void window.api.getFileDiff(ws.id, file).then(setDiff, (e) => setDiff(`error: ${e}`))
  }, [ws.id, file, stats])

  if (diff === null) return <div className="flex-1 p-6 text-faint">Loading diff…</div>
  const lines = parseDiff(diff)
  return (
    <div className="selectable flex-1 overflow-auto font-mono text-[12px] leading-[20px]">
      <div className="sticky top-0 z-10 border-b border-line bg-panel px-4 py-2 text-muted">{file}</div>
      {lines.length === 0 && <div className="p-6 font-sans text-faint">No textual changes (binary or empty file).</div>}
      <table className="w-full border-collapse">
        <tbody>
          {lines.map((l, i) => (
            <tr
              key={i}
              className={
                l.kind === 'add' ? 'bg-add/10' : l.kind === 'del' ? 'bg-del/10' : l.kind === 'hunk' ? 'bg-raised text-faint' : ''
              }
            >
              <td className="w-12 pr-2 text-right text-faint select-none">{l.oldNo ?? ''}</td>
              <td className="w-12 pr-2 text-right text-faint select-none">{l.newNo ?? ''}</td>
              <td className={`w-4 select-none ${l.kind === 'add' ? 'text-add' : l.kind === 'del' ? 'text-del' : 'text-faint'}`}>
                {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}
              </td>
              <td className="pr-4 whitespace-pre">{l.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
