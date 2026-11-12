import type { Workspace } from '@shared/types'
import { leftOutLabel } from '@shared/reviewUpdates'
import { useSinceReview } from '../sinceReview'
import { usePrReview } from '../prReview'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * All changes | Since your review: switches the Files list and the diff between the whole PR and
 * what the author changed since your last review. Shows nothing until there is something since.
 */
export function SinceReviewToggle({ ws, className = '' }: { ws: Workspace; className?: string }) {
  const { data, on, setOn } = useSinceReview(ws)
  const review = usePrReview(ws)
  if (!data) return null
  const base = review?.pr.baseRefName || 'main'
  const left = leftOutLabel(data, base)
  const seg = 'px-2.5 py-0.5 whitespace-nowrap'
  return (
    <div className={`font-sans ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex overflow-hidden rounded-md border border-line text-[12px]" role="radiogroup" aria-label="Which changes to show">
          <button role="radio" aria-checked={!on} className={`${seg} ${!on ? 'bg-raised text-fg' : 'text-muted hover:bg-hover'}`} onClick={() => setOn(false)}>
            All changes
          </button>
          <button role="radio" aria-checked={on} className={`${seg} ${on ? 'bg-accent/20 font-medium text-accent' : 'text-muted hover:bg-hover'}`} onClick={() => setOn(true)}>
            Since your review · {plural(data.files.length, 'file')}
          </button>
        </span>
        <span className="text-[12px] text-faint">{plural(data.commits, 'commit')} since your review</span>
      </div>
      {on && left && (
        <div className="mt-1.5 text-[12px] text-faint" title={[...data.leftOut, ...data.ignored].join('\n')}>
          {left}{' '}
          <button className="text-sky-400 hover:underline" onClick={() => setOn(false)}>
            Show them
          </button>
        </div>
      )}
      {on && !data.exact && <div className="mt-1 text-[12px] text-amber-400">Some files clash with the new base, so they show every change since your review.</div>}
    </div>
  )
}
