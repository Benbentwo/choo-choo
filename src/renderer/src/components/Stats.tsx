import type { DiffStats } from '@shared/types'

export function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n)
}

export function Stats({ stats }: { stats?: DiffStats }) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null
  return (
    <span className="shrink-0 font-mono text-[11px]">
      {stats.additions > 0 && <span className="text-add">+{fmt(stats.additions)}</span>}
      {stats.deletions > 0 && <span className="ml-1 text-del">-{fmt(stats.deletions)}</span>}
    </span>
  )
}
