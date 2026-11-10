import { useEffect, useState } from 'react'
import { ClipboardList, Users, Target, CheckCircle2, Printer, Copy, Check, RotateCcw } from 'lucide-react'
import { useShiftHandoff } from '../hooks/backend/ops'
import type { ShiftHandoffResult, ShiftName } from './data/opsTypes'
import { MetricCard } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { SimpleTable } from './ui/SimpleTable'
import { RiskBadge } from './ui/RiskBadge'
import { pct, num, prettify } from './ui/format'
import { Button } from '../lib/shadcn/button'
import { Input } from '../lib/shadcn/input'
import { cn } from '../lib/shadcn/utils'

const SHIFTS: { key: ShiftName; label: string; hours: string }[] = [
  { key: 'morning', label: 'Morning', hours: '06:00–14:00' },
  { key: 'evening', label: 'Evening', hours: '14:00–22:00' },
  { key: 'overnight', label: 'Overnight', hours: '22:00–06:00' },
]

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
const dayLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
const duration = (m: number) => (m >= 90 ? `${num(m / 60, 1)}h` : `${num(m, 0)}m`)

/** Plain-text version for pasting into Slack, Teams or email. */
function toText(r: ShiftHandoffResult): string {
  const lines: string[] = []
  lines.push(`SHIFT HANDOFF: ${prettify(r.shift)} shift, ${dayLabel(r.day)} (${time(r.start)}–${time(r.end)} UTC)`)
  lines.push('')
  lines.push('SUMMARY')
  r.highlights.forEach((h) => lines.push(`- ${h}`))
  lines.push('')
  lines.push('OUTPUT')
  lines.push(`- Collected ${r.episodes.collected} | accepted ${r.episodes.accepted} | rejected ${r.episodes.rejected} | pending QA ${r.episodes.pending}`)
  lines.push(`- Target ${r.episodes.target} → ${pct(r.episodes.attainment, 0)} attainment; QA pass rate ${pct(r.episodes.passRate)}`)
  if (r.topRejects.length) lines.push(`- Top rejects: ${r.topRejects.map((x) => `${prettify(x.reason)} (${x.count})`).join(', ')}`)
  lines.push('')
  lines.push('ROBOTS')
  if (r.robotsDown.length) r.robotsDown.forEach((d) => lines.push(`- DOWN: ${d.robot}, ${prettify(d.faultCode)}, down ${duration(d.minutesDown)}`))
  else lines.push('- All robots up')
  r.failures.forEach((f) =>
    lines.push(`- ${time(f.failedAt)} ${f.robot}: ${prettify(f.faultCode)} (${f.recovered ? `recovered after ${duration(f.downtimeMinutes)}` : 'not recovered'})`),
  )
  if (r.incidents.length) {
    lines.push('')
    lines.push('INCIDENTS')
    r.incidents.forEach((i) =>
      lines.push(`- ${time(i.occurredAt)} ${i.robot}: ${i.severity}${i.nearMiss ? ' (near miss)' : ''}${i.rootCause ? `, ${i.rootCause}` : ''}${i.resolved ? '' : ', OPEN'}`),
    )
  }
  if (r.watchlist.length) {
    lines.push('')
    lines.push('FOR THE NEXT SHIFT')
    r.watchlist.forEach((w) => lines.push(`- ${w.name}: ${w.action}`))
  }
  lines.push(`- Open downtime tickets: ${r.openTickets}`)
  return lines.join('\n')
}

export default function ShiftHandoff() {
  const { data, loading, error, trigger } = useShiftHandoff()
  const [day, setDay] = useState('')
  const [shift, setShift] = useState<ShiftName | ''>('')
  const [copied, setCopied] = useState(false)

  // First load: the backend picks the shift that most recently ended.
  useEffect(() => {
    trigger({})
  }, [trigger])

  // Keep the pickers in sync with whatever shift the report shows.
  useEffect(() => {
    if (data) {
      setDay(data.day)
      setShift(data.shift)
    }
  }, [data])

  const load = (d: string, s: ShiftName) => {
    setDay(d)
    setShift(s)
    if (d) trigger({ day: d, shift: s })
  }

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(toText(data))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.alert('Could not copy automatically. Use Print / Save PDF instead.')
    }
  }

  const controls = (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4 shadow-retool-sm print:hidden">
      <label className="space-y-1 text-xs text-muted-foreground">
        <span>Date (UTC)</span>
        <Input type="date" value={day} onChange={(e) => shift && load(e.target.value, shift)} className="w-40" />
      </label>
      <div className="space-y-1 text-xs text-muted-foreground">
        <span>Shift</span>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="Shift">
          {SHIFTS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => day && load(day, s.key)}
              title={s.hours}
              className={cn(
                'rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
                shift === s.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => trigger({})}>
        <RotateCcw /> Latest shift
      </Button>
      <div className="ml-auto flex gap-2">
        <Button variant="outline" size="sm" onClick={copy} disabled={!data}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy as text'}
        </Button>
        <Button size="sm" onClick={() => window.print()} disabled={!data}>
          <Printer /> Print / Save PDF
        </Button>
      </div>
    </div>
  )

  if (error && !data) return <div className="space-y-4">{controls}<ErrorBox message={error} /></div>
  if (!data) return <div className="space-y-4">{controls}<Loading /></div>
  const r = data
  const e = r.episodes
  const gap = r.staffing.planned - r.staffing.filled

  return (
    <div className={cn('space-y-4', loading && 'opacity-60 transition-opacity')}>
      {controls}
      {error ? <ErrorBox message={error} /> : null}

      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">
            {prettify(r.shift)} shift handoff · {dayLabel(r.day)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {time(r.start)}–{time(r.end)} UTC{r.inProgress ? ' · shift still in progress, numbers so far' : ''}
          </p>
        </div>
      </header>

      <Section title="30-second summary" description="Read this first.">
        <ul className="space-y-1.5 text-sm">
          {r.highlights.map((h) => (
            <li key={h} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              {h}
            </li>
          ))}
        </ul>
      </Section>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Accepted vs target"
          value={`${num(e.accepted)} / ${num(e.target)}`}
          sub={`${pct(e.attainment, 0)} of shift target`}
          icon={Target}
          tone={e.attainment >= 0.9 ? 'good' : e.attainment >= 0.7 ? 'warn' : 'bad'}
        />
        <MetricCard label="Collected" value={num(e.collected)} sub={`${num(e.pending)} still waiting for QA`} icon={ClipboardList} />
        <MetricCard
          label="QA pass rate"
          value={pct(e.passRate)}
          sub={`${num(e.rejected)} rejected`}
          icon={CheckCircle2}
          tone={e.passRate == null ? 'default' : e.passRate >= 0.85 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Staffing"
          value={`${num(r.staffing.filled)} / ${num(r.staffing.planned)}`}
          sub={gap > 0 ? `${gap} operator(s) short` : 'Fully staffed'}
          icon={Users}
          tone={gap > 0 ? 'warn' : 'good'}
        />
      </div>

      <PageGrid>
        <Section title="Robots" description="Still down, plus every failure during this shift.">
          {r.robotsDown.length ? (
            <ul className="mb-3 space-y-2">
              {r.robotsDown.map((d) => (
                <li key={d.robot + d.since} className="flex items-center justify-between rounded-md border border-red-400/50 bg-red-500/5 px-3 py-2 text-sm">
                  <span>
                    <span className="mr-2 rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white">DOWN</span>
                    <span className="font-medium">{d.robot}</span> · {prettify(d.faultCode)}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{duration(d.minutesDown)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-400">All robots are up right now.</p>
          )}
          <SimpleTable
            rows={r.failures}
            rowKey={(f) => f.robot + f.failedAt}
            columns={[
              { key: 'time', header: 'Time', render: (f) => time(f.failedAt) },
              { key: 'robot', header: 'Robot', render: (f) => f.robot },
              { key: 'fault', header: 'Fault', render: (f) => prettify(f.faultCode) },
              {
                key: 'status',
                header: 'Downtime',
                align: 'right',
                render: (f) => (f.recovered ? duration(f.downtimeMinutes) : <span className="text-red-600 dark:text-red-400">ongoing</span>),
              },
            ]}
          />
        </Section>

        <Section title="For the next shift" description={`Maintenance watchlist · ${r.openTickets} open downtime ticket(s).`}>
          {r.watchlist.length ? (
            <ul className="space-y-3">
              {r.watchlist.map((w) => (
                <li key={w.name} className="rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{w.name}</span>
                    <RiskBadge level={w.level} />
                  </div>
                  <p className="mt-1 text-sm">{w.action}</p>
                  {w.reasons.length ? <p className="mt-0.5 text-xs text-muted-foreground">{w.reasons.join(' · ')}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No robots on the maintenance watchlist.</p>
          )}
          {r.incidents.length ? (
            <div className="mt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Incidents this shift</h3>
              <ul className="space-y-1 text-sm">
                {r.incidents.map((i) => (
                  <li key={i.occurredAt + i.robot}>
                    {time(i.occurredAt)} · <span className="font-medium">{i.robot}</span> · {i.severity}
                    {i.nearMiss ? ' (near miss)' : ''}
                    {i.rootCause ? ` · ${i.rootCause}` : ''}
                    {i.resolved ? '' : <span className="text-red-600 dark:text-red-400"> · open</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      </PageGrid>

      <PageGrid>
        <Section title="Output by task" description="Collected vs. accepted this shift.">
          <SimpleTable
            rows={r.byTask}
            rowKey={(t) => t.task}
            columns={[
              { key: 'task', header: 'Task', render: (t) => prettify(t.task) },
              { key: 'collected', header: 'Collected', align: 'right', render: (t) => num(t.collected) },
              { key: 'accepted', header: 'Accepted', align: 'right', render: (t) => num(t.accepted) },
            ]}
          />
          {r.topRejects.length ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Top reject reasons: {r.topRejects.map((x) => `${prettify(x.reason)} (${x.count})`).join(', ')}
            </p>
          ) : null}
        </Section>

        <Section title="Operators on shift" description="Output and QA pass rate per operator.">
          <SimpleTable
            rows={r.operators}
            rowKey={(o) => o.name}
            columns={[
              { key: 'name', header: 'Operator', render: (o) => o.name },
              { key: 'collected', header: 'Collected', align: 'right', render: (o) => num(o.collected) },
              { key: 'accepted', header: 'Accepted', align: 'right', render: (o) => num(o.accepted) },
              { key: 'pass', header: 'QA pass', align: 'right', render: (o) => pct(o.passRate) },
            ]}
          />
        </Section>
      </PageGrid>
    </div>
  )
}
