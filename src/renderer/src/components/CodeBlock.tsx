import { useRef, useState, type ComponentProps } from 'react'
import type { Components } from 'react-markdown'
import { IconCheck, IconCopy } from '../icons'

/** A Markdown code block with a faint copy button in its top-right corner. */
function CodeBlock(props: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const { node: _node, ...rest } = props as ComponentProps<'pre'> & { node?: unknown }
  const copy = () => {
    void navigator.clipboard.writeText(ref.current?.textContent ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="group/code relative">
      <pre ref={ref} {...rest} />
      <button
        title={copied ? 'Copied' : 'Copy'}
        onClick={copy}
        className="absolute top-2 right-2 rounded-md border border-line bg-panel/80 p-1 text-faint opacity-50 backdrop-blur-sm transition-opacity group-hover/code:opacity-100 hover:text-fg"
      >
        {copied ? <IconCheck width={13} height={13} className="text-add" /> : <IconCopy width={13} height={13} />}
      </button>
    </div>
  )
}

/** Shared react-markdown overrides for chat text. */
export const MARKDOWN_COMPONENTS: Components = { pre: CodeBlock }
