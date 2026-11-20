import { useEffect, useState } from 'react'
import type { ImageDiff as Diff, ImageSide } from '@shared/images'
import { IconX } from '../icons'

/** Transparent pixels read as a checkerboard, as in image editors. */
const CHECKER: React.CSSProperties = {
  backgroundColor: '#fff',
  backgroundImage: 'conic-gradient(#e5e5e5 25%, transparent 0 50%, #e5e5e5 0 75%, transparent 0)',
  backgroundSize: '16px 16px'
}

const kb = (n?: number) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

type Which = 'before' | 'after'
type Size = { w: number; h: number }

/** A changed PNG or SVG: before and after side by side. Click either to open it full size. */
export function ImageDiff({ ws, file, stats }: { ws: { id: string }; file: string; stats?: unknown }) {
  const [d, setD] = useState<Diff | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setD(null)
    setErr(null)
  }, [ws.id, file])
  useEffect(() => {
    let live = true
    window.api.getImageDiff(ws.id, file).then(
      (x) => live && setD(x),
      (e) => live && setErr(String(e))
    )
    return () => {
      live = false
    }
  }, [ws.id, file, stats])
  if (err) return <div className="p-6 font-sans text-faint">{err}</div>
  if (!d) return <div className="p-6 font-sans text-faint">Loading image…</div>
  return <ImagePanes before={d.before} after={d.after} />
}

/** One image, as in a file tab. */
export function ImageFile({ ws, file }: { ws: { id: string }; file: string }) {
  const [d, setD] = useState<Diff | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setD(null)
    setErr(null)
    window.api.getImageDiff(ws.id, file).then(
      (x) => live && setD(x),
      (e) => live && setErr(String(e))
    )
    return () => {
      live = false
    }
  }, [ws.id, file])
  if (err) return <div className="p-6 font-sans text-faint">{err}</div>
  if (!d) return <div className="p-6 font-sans text-faint">Loading image…</div>
  if (!d.after) return <div className="p-6 font-sans text-faint">File not found</div>
  return <ImagePanes before={null} after={d.after} single />
}

function ImagePanes({ before, after, single }: { before: ImageSide | null; after: ImageSide | null; single?: boolean }) {
  const [sizes, setSizes] = useState<Partial<Record<Which, Size>>>({})
  const [open, setOpen] = useState<Which | null>(null)
  const sides = (['before', 'after'] as const).filter((w) => (w === 'before' ? before : after))
  const side = (w: Which) => (w === 'before' ? before : after)!
  const label = (w: Which) => (single ? 'Image' : !before ? 'Added' : !after ? 'Deleted' : w === 'before' ? 'Before' : 'After')
  const tone = (w: Which) => (single ? 'border-line' : w === 'before' ? 'border-del/60' : 'border-add/60')
  if (!sides.length) return <div className="p-6 font-sans text-faint">No image on either side.</div>
  return (
    <div className="flex flex-wrap gap-4 p-4 font-sans">
      {sides.map((w) => {
        const s = side(w)
        const size = sizes[w]
        return (
          <figure key={w} className="m-0 flex min-w-[200px] flex-1 flex-col gap-1.5" style={{ maxWidth: sides.length === 1 ? '100%' : 'calc(50% - 0.5rem)' }}>
            <figcaption className="flex items-center gap-2 text-[12px] text-muted">
              <span className={`font-medium ${single ? 'text-fg' : w === 'before' ? 'text-del' : 'text-add'}`}>{label(w)}</span>
              {size && (
                <span className="text-faint">
                  {size.w} × {size.h}
                </span>
              )}
              <span className="text-faint">{kb(s.bytes)}</span>
            </figcaption>
            {s.url ? (
              <button
                className={`flex cursor-zoom-in items-center justify-center overflow-hidden rounded-md border-2 ${tone(w)}`}
                style={CHECKER}
                title="Open full size"
                onClick={() => setOpen(w)}
              >
                <img
                  src={s.url}
                  alt={label(w)}
                  className="block max-h-[60vh] max-w-full object-contain"
                  onLoad={(e) => {
                    const img = e.currentTarget
                    setSizes((p) => ({ ...p, [w]: { w: img.naturalWidth, h: img.naturalHeight } }))
                  }}
                />
              </button>
            ) : (
              <div className={`rounded-md border-2 border-dashed p-6 text-[12px] text-faint ${tone(w)}`}>{s.reason}</div>
            )}
          </figure>
        )
      })}
      {open && <Lightbox sides={sides.filter((w) => side(w).url)} start={open} url={(w) => side(w).url!} label={label} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Full-size view: fit or 100%, flip between before and after with the buttons or ← →, Esc to close. */
function Lightbox({ sides, start, url, label, onClose }: { sides: Which[]; start: Which; url: (w: Which) => string; label: (w: Which) => string; onClose: () => void }) {
  const [w, setW] = useState<Which>(start)
  const [fit, setFit] = useState(true)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && sides.includes('before')) setW('before')
      else if (e.key === 'ArrowRight' && sides.includes('after')) setW('after')
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [sides, onClose])
  const btn = (on: boolean) => `px-2.5 py-1 ${on ? 'bg-raised text-fg' : 'text-muted hover:bg-hover'}`
  return (
    <div className="anim-backdrop fixed inset-0 z-50 flex flex-col bg-black/80 font-sans" onMouseDown={onClose}>
      <div className="flex items-center gap-3 px-4 py-2 text-[12px]" onMouseDown={(e) => e.stopPropagation()}>
        {sides.length > 1 && (
          <span className="flex overflow-hidden rounded-md border border-line bg-panel">
            {sides.map((s) => (
              <button key={s} className={btn(w === s)} onClick={() => setW(s)} title={s === 'before' ? '←' : '→'}>
                {label(s)}
              </button>
            ))}
          </span>
        )}
        <span className="flex overflow-hidden rounded-md border border-line bg-panel">
          <button className={btn(fit)} onClick={() => setFit(true)}>
            Fit
          </button>
          <button className={btn(!fit)} onClick={() => setFit(false)}>
            100%
          </button>
        </span>
        <span className="flex-1" />
        <button className="rounded-md bg-panel p-1.5 text-muted hover:text-fg" title="Close (Esc)" onClick={onClose}>
          <IconX width={12} height={12} />
        </button>
      </div>
      <div className={`min-h-0 flex-1 overflow-auto p-4 ${fit ? 'flex items-center justify-center' : ''}`}>
        <img
          src={url(w)}
          alt={label(w)}
          style={CHECKER}
          className={fit ? 'max-h-full max-w-full object-contain' : 'max-w-none'}
          onMouseDown={(e) => e.stopPropagation()}
        />
      </div>
    </div>
  )
}
