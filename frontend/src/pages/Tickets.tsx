import { useEffect, useState } from 'react'
import { Ticket as TicketIcon, Inbox, Loader, CheckCircle2, Clock } from 'lucide-react'
import { useGetTickets, useUpdateTicket } from '../hooks/backend/tickets'
import type { TicketsResult, Ticket } from './data/types'
import { MetricCard } from './ui/MetricCard'
import { Section, Loading, ErrorBox } from './ui/Section'
import { useDaysRange } from './ui/range'
import { TicketDetailDialog } from './ui/TicketDetailDialog'
import { num, prettify, shortDate, minutesLabel } from './ui/format'
import { cn } from '../lib/shadcn/utils'
import { Button } from '../lib/shadcn/button'
import { Badge } from '../lib/shadcn/badge'

type StatusFilter = 'all' | 'open' | 'in_progress' | 'resolved'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'resolved', label: 'Resolved' },
]

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-amber-100 text-amber-900 dark:bg-amber-400/20 dark:text-amber-200',
  in_progress: 'bg-blue-100 text-blue-900 dark:bg-blue-400/20 dark:text-blue-200',
  resolved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/20 dark:text-emerald-200',
}

const SEVERITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-900 dark:bg-red-400/20 dark:text-red-200',
  medium: 'bg-orange-100 text-orange-900 dark:bg-orange-400/20 dark:text-orange-200',
  low: 'bg-slate-100 text-slate-800 dark:bg-slate-400/20 dark:text-slate-200',
}

export default function Tickets() {
  const { data, loading, error, trigger } = useGetTickets({ cachePolicy: 'stale-while-revalidate' })
  const update = useUpdateTicket()
  const days = useDaysRange(trigger)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [detail, setDetail] = useState<Ticket | null>(null)

  useEffect(() => {
    // Refresh the list after a ticket update settles.
    if (update.data) trigger({ days })
  }, [update.data, trigger, days])

  if (error) return <ErrorBox message={`Failed to load tickets: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as TicketsResult | null
  if (!d) return <Loading />

  const visible = filter === 'all' ? d.tickets : d.tickets.filter((t) => t.status === filter)

  const setTicket = (id: number, status: 'open' | 'in_progress' | 'resolved') => {
    update.trigger({ id, status })
    setDetail(null)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Open tickets" value={num(d.counts.open)} sub="Bots down or awaiting triage" icon={Inbox} tone={d.counts.open > 0 ? 'warn' : 'good'} />
        <MetricCard label="In progress" value={num(d.counts.inProgress)} sub="Being worked right now" icon={Loader} />
        <MetricCard label="Resolved" value={num(d.counts.resolved)} sub={`Closed in the last ${days} days`} icon={CheckCircle2} tone="good" />
        <MetricCard
          label="Avg downtime per ticket"
          value={d.tickets.length > 0 ? minutesLabel(d.tickets.reduce((s, t) => s + t.downtimeMinutes, 0) / d.tickets.length) : '—'}
          sub="Failure to recovery, all tickets"
          icon={Clock}
        />
      </div>

      <Section
        title="Downtime tickets"
        description="Every robot downtime event becomes a ticket — triage, assign and close them here."
      >
        <div className="mb-3 flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                filter === f.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No tickets in this view.</p>
        ) : (
          <div className="space-y-1.5">
            {visible.map((t) => (
              <TicketRow
                key={t.id}
                t={t}
                busy={update.loading}
                onSet={setTicket}
                onReopen={() => setDetail(t)}
              />
            ))}
          </div>
        )}
        {update.error ? <p className="mt-2 text-xs text-destructive">Update failed: {update.error}</p> : null}
      </Section>

      <TicketDetailDialog
        ticket={detail}
        busy={update.loading}
        onConfirm={(id) => setTicket(id, 'open')}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
      />
    </div>
  )
}

function TicketRow({
  t,
  busy,
  onSet,
  onReopen,
}: {
  t: Ticket
  busy: boolean
  onSet: (id: number, s: 'open' | 'in_progress' | 'resolved') => void
  onReopen: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <TicketIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{t.title}</span>
          <Badge className={cn('border-transparent text-[10px]', SEVERITY_BADGE[t.severity] ?? '')}>{prettify(t.severity)}</Badge>
          <Badge className={cn('border-transparent text-[10px]', STATUS_BADGE[t.status] ?? '')}>{prettify(t.status)}</Badge>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          #{t.id} · {t.robotName} · opened {shortDate(t.createdAt)} · down {minutesLabel(t.downtimeMinutes)}
          {t.recovered ? ' · recovered' : ' · still down'}
          {t.assignee ? ` · assigned to ${t.assignee}` : ''}
        </p>
      </div>
      <div className="flex gap-1.5">
        {t.status === 'open' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onSet(t.id, 'in_progress')}>
            Start work
          </Button>
        )}
        {t.status !== 'resolved' && (
          <Button size="sm" disabled={busy} onClick={() => onSet(t.id, 'resolved')}>
            Resolve
          </Button>
        )}
        {t.status === 'resolved' && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onReopen}>
            Reopen
          </Button>
        )}
      </div>
    </div>
  )
}
