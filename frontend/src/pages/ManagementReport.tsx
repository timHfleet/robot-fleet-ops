import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Check, Copy, Download, Printer } from 'lucide-react'
import { useManagementReport } from '../hooks/backend/ops'
import type { ManagementReportResult, PeriodKpis } from './data/types'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { SimpleTable } from './ui/SimpleTable'
import { RiskBadge } from './ui/RiskBadge'
import { ChangeBadge } from './ui/MetricExplainDialog'
import {
  compare,
  formatValue,
  METRIC_INFO,
  rangeLabel,
  status,
  STATUS_LABEL,
  TARGET_LABEL,
  type MetricKey,
  type Status,
} from './ui/metricInfo'
import { useDaysRange } from './ui/range'
import { num, pct, prettify, shortDate } from './ui/format'
import { tickStyle, tooltipItemStyle, tooltipStyle } from './ui/chartTheme'
import { Button } from '../lib/shadcn/button'
import { Input } from '../lib/shadcn/input'
import { cn } from '../lib/shadcn/utils'

const PERIODS = [
  { days: 7, label: 'Weekly' },
  { days: 30, label: 'Monthly' },
  { days: 90, label: 'Quarterly' },
]

const ORDER: MetricKey[] = [
  'accepted',
  'passRate',
  'costPerUsableEpisode',
  'availability',
  'robotUtilization',
  'operatorUtilization',
  'fillRate',
  'incidentRate',
]

const statusClass: Record<Status, string> = {
  on: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  watch: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  off: 'bg-red-500/15 text-red-700 dark:text-red-300',
}

function StatusPill({ s }: { s: Status }) {
  return <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', statusClass[s])}>{STATUS_LABEL[s]}</span>
}

type ScoreRow = {
  key: MetricKey
  label: string
  current: string
  previous: string
  change: ReturnType<typeof compare> | null
  target: string
  status: Status
}

type Summary = { headline: string; wins: string[]; concerns: string[]; actions: string[] }

function periodName(days: number) {
  return PERIODS.find((p) => p.days === days)?.label ?? `${days}-day`
}

function buildScorecard(r: ManagementReportResult): ScoreRow[] {
  const { current, previous, history } = r.comparison
  return ORDER.map((key) => {
    const info = METRIC_INFO[key]
    return {
      key,
      label: info.label,
      current: formatValue(info.kind, current[key]),
      previous: previous ? formatValue(info.kind, previous[key]) : '—',
      change: previous ? compare(key, current[key], previous[key]) : null,
      target: TARGET_LABEL[key],
      status: status(key, current, history),
    }
  })
}

/** Plain-language summary written from the numbers: what went well, what didn't, what to do. */
function buildSummary(r: ManagementReportResult, rows: ScoreRow[]): Summary {
  const c = r.comparison.current
  const p = r.comparison.previous
  const delta = p ? compare('accepted', c.accepted, p.accepted) : null
  const headline =
    `The fleet delivered ${num(c.accepted)} usable episodes (${pct(c.goalAttainment, 0)} of target) at a ${pct(c.passRate)} QA pass rate` +
    ` and ${formatValue('money', c.costPerUsableEpisode)} per usable episode` +
    (delta && delta.direction !== 'flat' ? `; output is ${delta.direction} ${delta.text.replace(/^[+−]/, '')} on the previous period.` : '.') +
    (c.pending > 0 ? ` ${num(c.pending)} more episodes are still awaiting QA review and are not counted yet.` : '')

  const wins = rows
    .filter((x) => x.change?.tone === 'good' && x.status === 'on')
    .slice(0, 3)
    .map((x) => `${x.label} ${x.current} (${x.change!.text} vs. previous period).`)
  const concerns = rows
    .filter((x) => x.status !== 'on' || x.change?.tone === 'bad')
    .sort((a, b) => rank(a.status) - rank(b.status))
    .slice(0, 4)
    .map((x) =>
      x.status !== 'on'
        ? `${x.label} is ${STATUS_LABEL[x.status].toLowerCase()} at ${x.current} (target ${x.target}).`
        : `${x.label} slipped to ${x.current} (${x.change!.text}).`,
    )

  const actions: string[] = []
  const lagging = r.tasks.filter((t) => t.attainment < 0.9).sort((a, b) => a.attainment - b.attainment)
  if (lagging.length)
    actions.push(
      `Rebalance collection toward ${lagging.map((t) => `${prettify(t.task)} (${pct(t.attainment, 0)} of target)`).join(', ')}.`,
    )
  const topReject = r.rejectReasons[0]
  if (topReject)
    actions.push(
      `Reduce ${prettify(topReject.reason).toLowerCase()} rejections (${pct(topReject.share, 0)} of all rejects) through operator coaching and an SOP review.`,
    )
  const worstRobot = r.robots[0]
  if (worstRobot && worstRobot.availability < 0.9)
    actions.push(
      `Prioritize maintenance on ${worstRobot.name}: ${pct(worstRobot.availability)} available, ${worstRobot.failures} failures, ${num(worstRobot.downHours, 0)}h down.`,
    )
  r.maintenance
    .filter((m) => m.level === 'high' && m.name !== worstRobot?.name)
    .forEach((m) => actions.push(`${m.name}: ${m.action}`))
  const shortShift = [...r.byShift].sort((a, b) => a.fillRate - b.fillRate)[0]
  if (shortShift && shortShift.fillRate < 0.9)
    actions.push(`Close staffing gaps on the ${shortShift.shift} shift (${pct(shortShift.fillRate, 0)} filled).`)
  const critical = r.incidents.bySeverity.find((s) => s.severity === 'critical')?.count ?? 0
  if (critical) actions.push(`Complete the safety review for ${critical} critical incident${critical > 1 ? 's' : ''}.`)

  return { headline, wins, concerns, actions: actions.slice(0, 5) }
}

const rank = (s: Status) => (s === 'off' ? 0 : s === 'watch' ? 1 : 2)

function toText(r: ManagementReportResult, rows: ScoreRow[], s: Summary, preparedBy: string, notes: string): string {
  const c = r.comparison.current
  const p = r.comparison.previous
  const L: string[] = []
  L.push(`${periodName(r.days).toUpperCase()} OPERATIONS REPORT: ROBOT DATA COLLECTION`)
  L.push(`Period: ${rangeLabel(c)}${p ? ` (compared with ${rangeLabel(p)})` : ''}`)
  if (preparedBy) L.push(`Prepared by: ${preparedBy}`)
  L.push('')
  L.push('EXECUTIVE SUMMARY')
  L.push(s.headline)
  if (s.wins.length) {
    L.push('', 'What went well')
    s.wins.forEach((w) => L.push(`- ${w}`))
  }
  if (s.concerns.length) {
    L.push('', 'Needs attention')
    s.concerns.forEach((w) => L.push(`- ${w}`))
  }
  L.push('', 'KPI SCORECARD')
  rows.forEach((x) =>
    L.push(`- ${x.label}: ${x.current} (prev ${x.previous}${x.change ? `, ${x.change.text}` : ''}) | target ${x.target} | ${STATUS_LABEL[x.status]}`),
  )
  L.push('', 'OUTPUT BY TASK')
  r.tasks.forEach((t) => L.push(`- ${prettify(t.task)}: ${num(t.accepted)} / ${num(t.target)} (${pct(t.attainment, 0)})`))
  L.push('', 'QUALITY')
  r.rejectReasons.forEach((x) => L.push(`- ${prettify(x.reason)}: ${num(x.count)} rejects (${pct(x.share, 0)})`))
  L.push(`- Reviewer agreement: ${pct(r.qaAgreement)}`)
  L.push('', 'FLEET')
  r.robots.slice(0, 3).forEach((x) => L.push(`- ${x.name}: ${pct(x.availability)} available, ${x.failures} failures, ${num(x.downHours, 0)}h down`))
  L.push('', 'SAFETY')
  L.push(`- ${r.incidents.count} incidents (${r.incidents.bySeverity.map((x) => `${x.count} ${x.severity}`).join(', ') || 'none'}), ${r.incidents.nearMiss} near misses`)
  L.push('', 'TEAM')
  L.push(`- Headcount ${r.team.headcount}, ${r.team.exits} exits, SOP adherence ${pct(r.team.sopAdherence)}, absence ${pct(r.team.absenceRate)}`)
  L.push(`- Top operators: ${r.team.topOperators.map((o) => o.name).join(', ')}`)
  if (s.actions.length) {
    L.push('', 'RECOMMENDED ACTIONS')
    s.actions.forEach((a, i) => L.push(`${i + 1}. ${a}`))
  }
  if (notes.trim()) L.push('', 'COMMENTS', notes.trim())
  return L.join('\n')
}

function toCsv(r: ManagementReportResult, rows: ScoreRow[]): string {
  const c = r.comparison.current
  const p = r.comparison.previous
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [['Metric', `Current (${c.start} to ${c.end})`, p ? `Previous (${p.start} to ${p.end})` : 'Previous', 'Change', 'Target', 'Status']]
  rows.forEach((x) => lines.push([x.label, x.current, x.previous, x.change?.text ?? '', x.target, STATUS_LABEL[x.status]]))
  return lines.map((l) => l.map(esc).join(',')).join('\n')
}

function useStored(key: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => {
    try {
      return localStorage.getItem(key) ?? ''
    } catch {
      return ''
    }
  })
  const set = (x: string) => {
    setV(x)
    try {
      localStorage.setItem(key, x)
    } catch {
      /* storage unavailable: keep it in memory */
    }
  }
  return [v, set]
}

export default function ManagementReport() {
  const { data, loading, error, trigger } = useManagementReport()
  const days = useDaysRange(trigger)
  const [, setSearchParams] = useSearchParams()
  const [preparedBy, setPreparedBy] = useStored('mgmt-report:preparedBy')
  const [notes, setNotes] = useStored(`mgmt-report:notes:${days}`)
  const [copied, setCopied] = useState(false)

  const r = data as ManagementReportResult | null
  const rows = useMemo(() => (r ? buildScorecard(r) : []), [r])
  const summary = useMemo(() => (r ? buildSummary(r, rows) : null), [r, rows])

  useEffect(() => setCopied(false), [days])

  // Print in light mode so the PDF has dark text on white paper, then restore the user's theme.
  useEffect(() => {
    const root = document.documentElement
    let wasDark = false
    const before = () => {
      wasDark = root.classList.contains('dark')
      root.classList.remove('dark')
    }
    const after = () => {
      if (wasDark) root.classList.add('dark')
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])

  const copy = async () => {
    if (!r || !summary) return
    try {
      await navigator.clipboard.writeText(toText(r, rows, summary, preparedBy, notes))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.alert('Could not copy automatically. Use Print / Save PDF instead.')
    }
  }

  const downloadCsv = () => {
    if (!r) return
    const blob = new Blob([toCsv(r, rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ops-report-${periodName(r.days).toLowerCase()}-${r.comparison.current.end}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const controls = (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4 shadow-retool-sm print:hidden">
      <div className="space-y-1 text-xs text-muted-foreground">
        <span>Report period</span>
        <div className="inline-flex rounded-md border border-border bg-background p-0.5" role="group" aria-label="Report period">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setSearchParams({ days: String(p.days) })}
              className={cn(
                'rounded-sm px-3 py-1.5 text-xs font-medium transition-colors',
                days === p.days ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <label className="space-y-1 text-xs text-muted-foreground">
        <span>Prepared by</span>
        <Input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} placeholder="Your name and title" className="w-56" />
      </label>
      <div className="ml-auto flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={copy} disabled={!r}>
          {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy as text'}
        </Button>
        <Button variant="outline" size="sm" onClick={downloadCsv} disabled={!r}>
          <Download /> Scorecard CSV
        </Button>
        <Button size="sm" onClick={() => window.print()} disabled={!r}>
          <Printer /> Print / Save PDF
        </Button>
      </div>
    </div>
  )

  if (error && !r) return <div className="space-y-4">{controls}<ErrorBox message={error} /></div>
  if (!r || !summary) return <div className="space-y-4">{controls}<Loading /></div>

  const c = r.comparison.current
  const p = r.comparison.previous
  const weekly = r.comparison.history.map((w: PeriodKpis) => ({
    week: w.start,
    accepted: w.accepted,
    target: Math.round(w.target),
  }))

  return (
    <div className={cn('space-y-4', loading && 'opacity-60 transition-opacity')}>
      {controls}
      {error ? <ErrorBox message={error} /> : null}

      <header className="border-b border-border pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{periodName(r.days)} operations report</p>
        <h2 className="mt-1 text-xl font-semibold">Robot data collection: {rangeLabel(c)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {p ? `Compared with ${rangeLabel(p)}` : 'No earlier period to compare with'}
          {' · '}Generated {new Date(r.generatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          {preparedBy ? ` · Prepared by ${preparedBy}` : ''}
        </p>
      </header>

      <Section title="Executive summary">
        <p className="text-sm leading-relaxed">{summary.headline}</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">What went well</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {summary.wins.length ? summary.wins.map((w) => <Bullet key={w} tone="good">{w}</Bullet>) : <li className="text-muted-foreground">No metric improved while on target.</li>}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">Needs attention</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {summary.concerns.length ? summary.concerns.map((w) => <Bullet key={w} tone="bad">{w}</Bullet>) : <li className="text-muted-foreground">Every metric is on track.</li>}
            </ul>
          </div>
        </div>
      </Section>

      <Section title="KPI scorecard" description={`This ${periodName(r.days).toLowerCase()} period vs. the one before, against target.`}>
        <SimpleTable
          rows={rows}
          rowKey={(x) => x.key}
          columns={[
            { key: 'metric', header: 'Metric', render: (x) => <span className="font-medium">{x.label}</span> },
            { key: 'cur', header: 'This period', align: 'right', render: (x) => x.current },
            { key: 'prev', header: 'Previous', align: 'right', render: (x) => <span className="text-muted-foreground">{x.previous}</span> },
            { key: 'chg', header: 'Change', align: 'right', render: (x) => (x.change ? <ChangeBadge change={x.change} /> : '—') },
            { key: 'target', header: 'Target', align: 'right', render: (x) => <span className="text-muted-foreground">{x.target}</span> },
            { key: 'status', header: 'Status', align: 'right', render: (x) => <StatusPill s={x.status} /> },
          ]}
        />
      </Section>

      <Section title="Weekly output vs. target" description="Usable episodes per week over the last 12 weeks.">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="week" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
              <YAxis tick={tickStyle} tickLine={false} width={44} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(l) => `Week of ${shortDate(String(l))}`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="accepted" name="Usable episodes" fill="hsl(var(--chart-3))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="target" name="Target" fill="hsl(var(--muted-foreground))" fillOpacity={0.35} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <PageGrid>
        <Section title="Output by task" description="Usable episodes vs. prorated target.">
          <SimpleTable
            rows={r.tasks}
            rowKey={(t) => t.task}
            columns={[
              { key: 'task', header: 'Task', render: (t) => prettify(t.task) },
              { key: 'acc', header: 'Usable', align: 'right', render: (t) => num(t.accepted) },
              { key: 'tgt', header: 'Target', align: 'right', render: (t) => num(t.target) },
              {
                key: 'att',
                header: 'Attainment',
                align: 'right',
                render: (t) => (
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', statusClass[t.attainment >= 0.9 ? 'on' : t.attainment >= 0.7 ? 'watch' : 'off'])}>
                    {pct(t.attainment, 0)}
                  </span>
                ),
              },
            ]}
          />
        </Section>

        <Section title="Quality" description={`Top rejection reasons · reviewer agreement ${pct(r.qaAgreement)}.`}>
          <SimpleTable
            rows={r.rejectReasons}
            rowKey={(x) => x.reason}
            columns={[
              { key: 'reason', header: 'Reason', render: (x) => prettify(x.reason) },
              { key: 'count', header: 'Rejects', align: 'right', render: (x) => num(x.count) },
              { key: 'share', header: 'Share', align: 'right', render: (x) => pct(x.share, 0) },
            ]}
          />
        </Section>
      </PageGrid>

      <PageGrid>
        <Section title="Fleet reliability" description={`${num(c.failures)} failures · MTBF ${num(c.mtbfHours, 1)}h · MTTR ${num(c.mttrMinutes, 0)}m.`}>
          <SimpleTable
            rows={r.robots.slice(0, 5)}
            rowKey={(x) => x.name}
            columns={[
              { key: 'robot', header: 'Robot (most downtime first)', render: (x) => x.name },
              { key: 'avail', header: 'Available', align: 'right', render: (x) => pct(x.availability) },
              { key: 'fail', header: 'Failures', align: 'right', render: (x) => num(x.failures) },
              { key: 'down', header: 'Down', align: 'right', render: (x) => `${num(x.downHours, 0)}h` },
            ]}
          />
          {r.maintenance.length ? (
            <ul className="mt-3 space-y-2">
              {r.maintenance.map((m) => (
                <li key={m.name} className="flex items-start gap-2 text-sm">
                  <RiskBadge level={m.level} />
                  <span>
                    <span className="font-medium">{m.name}</span>: {m.action}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title="Safety and team">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Stat label="Incidents" value={`${num(r.incidents.count)}`} sub={r.incidents.bySeverity.map((x) => `${x.count} ${x.severity}`).join(' · ') || 'none'} />
            <Stat label="Near misses" value={num(r.incidents.nearMiss)} sub={r.incidents.byRootCause.length ? `Top cause: ${r.incidents.byRootCause[0].cause}` : undefined} />
            <Stat label="Headcount" value={num(r.team.headcount)} sub={`${r.team.exits} exit(s) · ${pct(r.team.attrition)} attrition`} />
            <Stat label="SOP adherence" value={pct(r.team.sopAdherence)} sub={`Absence rate ${pct(r.team.absenceRate)}`} />
          </dl>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top operators</h3>
          <ol className="mt-2 space-y-1 text-sm">
            {r.team.topOperators.map((o) => (
              <li key={o.name} className="flex justify-between gap-2">
                <span>
                  {o.rank}. {o.name}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {num(o.accepted)} usable · {pct(o.passRate)} pass · score {num(o.score, 1)}
                </span>
              </li>
            ))}
          </ol>
        </Section>
      </PageGrid>

      <Section title="Recommended actions" description="Generated from the numbers above. Edit or add your own in the comments.">
        {summary.actions.length ? (
          <ol className="list-decimal space-y-1.5 pl-5 text-sm">
            {summary.actions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No actions needed this period.</p>
        )}
      </Section>

      <Section title="Comments for management" description="Your own context: wins, blockers, asks. Saved in this browser and included when you copy or print.">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="e.g. Borealis-05 gripper replacement is scheduled for Monday; requesting one more overnight operator."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm print:hidden"
        />
        <p className="hidden whitespace-pre-wrap text-sm print:block">{notes || 'No comments.'}</p>
      </Section>
    </div>
  )
}

function Bullet({ children, tone }: { children: string; tone: 'good' | 'bad' }) {
  return (
    <li className="flex gap-2">
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', tone === 'good' ? 'bg-emerald-500' : 'bg-red-500')} />
      {children}
    </li>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {sub ? <dd className="text-xs text-muted-foreground">{sub}</dd> : null}
    </div>
  )
}
