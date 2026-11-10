import { Trophy, Medal } from 'lucide-react'
import { cn } from '../../lib/shadcn/utils'
import type { LeaderboardEntry } from '../data/types'
import { num, pct } from './format'

const RANK_STYLES = [
  'bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200',
  'bg-slate-200 text-slate-800 dark:bg-slate-400/20 dark:text-slate-200',
  'bg-orange-100 text-orange-900 dark:bg-orange-400/20 dark:text-orange-200',
]

function rankBadge(entry: LeaderboardEntry) {
  if (entry.rank <= 3) {
    const Icon = entry.rank === 1 ? Trophy : Medal
    return (
      <span
        className={cn('inline-flex h-7 w-7 items-center justify-center rounded-full', RANK_STYLES[entry.rank - 1])}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </span>
    )
  }
  return <span className="inline-flex h-7 w-7 items-center justify-center text-sm text-muted-foreground">{entry.rank}</span>
}

export function Leaderboard({
  entries,
  weights,
  minHours,
}: {
  entries: LeaderboardEntry[]
  weights: { output: number; quality: number; sop: number; attendance: number }
  minHours: number
}) {
  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No operators met the {minHours}h minimum in this period.</p>
  }

  return (
    <div>
      <ol className="space-y-1.5">
        {entries.map((e) => (
          <li
            key={e.name}
            className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5"
          >
            {rankBadge(e)}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{e.name}</span>
                <span className="text-sm font-semibold tabular-nums">{e.score.toFixed(1)}</span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${e.score}%` }} />
                </div>
                <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">
                  {num(e.accepted)} accepted · {e.perHour.toFixed(2)}/h · QA {pct(e.passRate)}
                  {e.sopRate != null ? ` · SOP ${pct(e.sopRate)}` : ''}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Score = {Math.round(weights.output * 100)}% output per hour + {Math.round(weights.quality * 100)}% QA pass rate +{' '}
        {Math.round(weights.sop * 100)}% SOP adherence + {Math.round(weights.attendance * 100)}% attendance. Operators
        with fewer than {minHours} paid hours are excluded.
      </p>
    </div>
  )
}
