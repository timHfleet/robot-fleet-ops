import { cn } from '../../lib/shadcn/utils'
import type { RiskLevel } from '../data/opsTypes'

const STYLES: Record<RiskLevel, string> = {
  high: 'bg-red-100 text-red-900 dark:bg-red-400/20 dark:text-red-200',
  medium: 'bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200',
  low: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-200',
}

const LABELS: Record<RiskLevel, string> = { high: 'High risk', medium: 'Watch', low: 'Healthy' }

export function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', STYLES[level], className)}>
      {LABELS[level]}
    </span>
  )
}
