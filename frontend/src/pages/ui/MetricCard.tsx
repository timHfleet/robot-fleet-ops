import type { LucideIcon } from 'lucide-react'
import { cn } from '../../lib/shadcn/utils'

type Tone = 'default' | 'good' | 'warn' | 'bad'

const toneText: Record<Tone, string> = {
  default: 'text-foreground',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  bad: 'text-red-600 dark:text-red-400',
}

export function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  icon?: LucideIcon
  tone?: Tone
}) {
  return (
    <div className="rounded-lg border border-border bg-card text-card-foreground p-4 shadow-retool-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon ? <Icon className="h-4 w-4 text-muted-foreground" aria-hidden /> : null}
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', toneText[tone])}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

export function MetricRow({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: Tone
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('font-medium tabular-nums', toneText[tone])}>{value}</span>
    </div>
  )
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(1, value))
  const color = clamped >= 0.9 ? 'bg-emerald-500 dark:bg-emerald-400' : clamped >= 0.7 ? 'bg-amber-500 dark:bg-amber-400' : 'bg-red-500 dark:bg-red-400'
  return (
    <div className={cn('h-2 w-full min-w-16 overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full', color)} style={{ width: `${clamped * 100}%` }} />
    </div>
  )
}
