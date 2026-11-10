import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '../../lib/shadcn/utils'

const OPTIONS = [7, 30, 90]

/** Reads `?days=` from the URL and triggers a backend hook whenever it changes. */
export function useDaysRange(trigger: (params: { days: number }) => void): number {
  const [searchParams] = useSearchParams()
  const days = parseDays(searchParams.get('days'))
  useEffect(() => {
    trigger({ days })
  }, [days, trigger])
  return days
}

function parseDays(raw: string | null): number {
  const n = Number(raw)
  return OPTIONS.includes(n) ? n : 30
}

export function RangePicker() {
  const [searchParams, setSearchParams] = useSearchParams()
  const days = parseDays(searchParams.get('days'))
  return (
    <div className="inline-flex rounded-md border border-border bg-card p-0.5" role="group" aria-label="Date range">
      {OPTIONS.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => setSearchParams({ days: String(d) })}
          className={cn(
            'rounded-sm px-3 py-1 text-xs font-medium transition-colors',
            days === d
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {d}d
        </button>
      ))}
    </div>
  )
}
