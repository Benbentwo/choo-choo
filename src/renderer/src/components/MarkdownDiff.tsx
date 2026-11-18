import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Parser } from '@lezer/common'
import { MARKDOWN_COMPONENTS } from './CodeBlock'
import { highlightLines, parserForLang } from '../syntax'
import type { MdView, PreviewBlock } from '../mdPreview'

/** A fenced code block in the preview, colored like the code diff. */
function PreviewCode(props: ComponentProps<'code'> & { node?: unknown }) {
  const { node: _node, className, children, ...rest } = props
  const lang = /language-([\w+#.-]+)/.exec(className ?? '')?.[1]
  const [parser, setParser] = useState<Parser | null>(null)
  useEffect(() => {
    let live = true
    setParser(null)
    if (lang) void parserForLang(lang).then((p) => live && setParser(p))
    return () => {
      live = false
    }
  }, [lang])
  const text = typeof children === 'string' ? children.replace(/\n$/, '') : null
  if (!parser || text === null)
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  const lines = text.split('\n')
  const toks = highlightLines(text, parser)
  return (
    <code className={className} {...rest}>
      {lines.map((l, i) => {
        const parts: ReactNode[] = []
        let at = 0
        for (const t of toks[i]) {
          if (t.from > at) parts.push(l.slice(at, t.from))
          parts.push(
            <span key={t.from} className={t.cls}>
              {l.slice(t.from, t.to)}
            </span>
          )
          at = t.to
        }
        if (at < l.length) parts.push(l.slice(at))
        return (
          <span key={i}>
            {parts}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        )
      })}
    </code>
  )
}

export const COMPONENTS: Components = { ...MARKDOWN_COMPONENTS, code: PreviewCode }

const BLOCK_STYLE: Record<string, string> = {
  'new:add': 'border-add bg-add/10',
  'new:changed': 'border-add bg-add/10',
  'old:del': 'border-del bg-del/10',
  'old:changed': 'border-del bg-del/10',
  'new:same': 'border-transparent'
}

function label(b: PreviewBlock) {
  const lines = b.start === b.end ? `${b.start}` : `${b.start}–${b.end}`
  if (b.status === 'same') return { text: lines, cls: 'text-faint' }
  if (b.side === 'old') return { text: `−${lines}`, cls: 'text-del' }
  return { text: `+${lines}`, cls: 'text-add' }
}

/**
 * The rendered Markdown diff: the new version of the file drawn as a document, with added and
 * changed blocks in green and removed blocks (and the old text of changed ones) in red. Click a
 * block's line numbers to comment on it; shift-click extends to more blocks. `below(i)` is what goes
 * under block i: comments, threads and the comment box.
 */
export function MarkdownDiff({
  blocks,
  lo,
  hi,
  onPick,
  below
}: {
  blocks: PreviewBlock[]
  lo: number
  hi: number
  onPick: (i: number, e: React.MouseEvent) => void
  below: (i: number) => ReactNode
}) {
  if (!blocks.length) return <div className="p-6 font-sans text-faint">This file is empty.</div>
  return (
    <div className="py-3 font-sans text-[13px] leading-normal">
      {blocks.map((b, i) => {
        const l = label(b)
        const picked = i >= lo && i <= hi
        return (
          <div key={`${b.side}:${b.start}`} className="mb-1" data-new-line={b.side === 'new' ? b.start : undefined}>
            <div className="group/block flex items-stretch">
              <button
                className="w-[6.5rem] shrink-0 pt-[3px] pr-3 text-right align-top font-mono text-[11px] select-none"
                title="Comment on this block. Shift-click to take in more blocks."
                onMouseDown={(e) => onPick(i, e)}
              >
                <span className={`${l.cls} group-hover/block:hidden ${picked ? 'hidden' : ''}`}>{l.text}</span>
                <span className={`rounded bg-accent px-1.5 py-[1px] text-[11px] font-medium text-bg ${picked ? 'inline-block' : 'hidden group-hover/block:inline-block'}`}>+ Comment</span>
              </button>
              <div
                data-find
                className={`prose-chat md-preview min-w-0 max-w-3xl flex-1 rounded-r-md border-l-[3px] px-3 py-0.5 mr-4 ${picked ? 'border-accent bg-accent/15' : BLOCK_STYLE[`${b.side}:${b.status}`]} ${b.side === 'old' ? 'opacity-80' : ''}`}
                title={b.side === 'old' ? (b.status === 'del' ? 'Removed' : 'Before this change') : b.status === 'add' ? 'Added' : b.status === 'changed' ? 'Changed' : undefined}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
                  {b.source}
                </ReactMarkdown>
              </div>
            </div>
            {below(i)}
          </div>
        )
      })}
    </div>
  )
}

/** The Preview | Code switch in a Markdown file's header. */
export function MdViewSwitch({ preview, onChange, previewDisabled }: { preview: boolean; onChange: (v: MdView) => void; previewDisabled?: string }) {
  return (
    <span className="flex shrink-0 overflow-hidden rounded-md border border-line font-sans text-[12px]">
      {(['preview', 'code'] as const).map((v) => (
        <button
          key={v}
          disabled={v === 'preview' && !!previewDisabled}
          title={v === 'preview' ? (previewDisabled ?? 'The file as rendered Markdown') : 'The Markdown source, line by line'}
          className={`px-2 py-0.5 disabled:opacity-40 ${(v === 'preview') === preview ? 'bg-raised text-fg' : 'hover:bg-hover'}`}
          onClick={() => onChange(v)}
        >
          {v === 'preview' ? 'Preview' : 'Code'}
        </button>
      ))}
    </span>
  )
}
