import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight } from 'lucide-react'
import { useDrivers } from '../../hooks/backend/metrics'
import type { DriverGroup, DriverKind, DriverRow, DriversResult } from '../data/types'
import { cn } from '../../lib/shadcn/utils'
import { METRIC_INFO, type MetricKey } from './metricInfo'
import { num, pct, prettify } from './format'

/** Ignore pieces that explain less than this share of the total change. */
const MIN_SHARE = 0.05

function fmt(kind: DriverKind, v: number): string {
  switch (kind) {
    case 'rate':
      return pct(v)
    case 'count':
      return num(v)
    case 'money':
      return `$${num(v, 0)}`
    case 'decimal':
      return num(v, 1)
  }
}

/** A row's effect on the metric, in the metric's own units ("−0.7 pts", "+$1.20", "−151 episodes"). */
function impactText(metric: MetricKey, x: number): string {
  const kind = METRIC_INFO[metric].kind
  const sign = x > 0 ? '+' : x < 0 ? '−' : ''
  const a = Math.abs(x)
  if (kind === 'rate') return `${sign}${(a * 100).toFixed(1)} pts`
  if (kind === 'money') return `${sign}$${a.toFixed(2)}`
  if (kind === 'perK') return `${sign}${a.toFixed(1)}`
  return `${sign}${num(a)}`
}

function isGood(metric: MetricKey, x: number) {
  return METRIC_INFO[metric].higherIsBetter ? x > 0 : x < 0
}

const label = (name: string) => (/^[a-z_]+$/.test(name) ? prettify(name) : name)

function rowKind(g: DriverGroup, r: DriverRow): DriverKind {
  return g.kind === 'mixed' ? (r.kind ?? 'count') : g.kind
}

function Impact({ metric, value }: { metric: MetricKey; value: number }) {
  const good = isGood(metric, value)
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium tabular-nums',
        value === 0 ? 'text-muted-foreground' : good ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/15 text-red-700 dark:text-red-300',
      )}
    >
      {impactText(metric, value)}
    </span>
  )
}

/** One reason, as a sentence: "Grasp failure rejections rose 3.9% → 4.6%". */
function Reason({ metric, group, row }: { metric: MetricKey; group: DriverGroup; row: DriverRow }) {
  const k = rowKind(group, row)
  const moved = row.current > row.previous ? 'rose' : row.current < row.previous ? 'fell' : 'held'
  const Arrow = row.current >= row.previous ? ArrowUpRight : ArrowDownRight
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0 text-sm">
        <span className="font-medium">{label(row.name)}</span>
        {row.currentBase === 0 ? (
          <span className="text-muted-foreground"> was not active this time</span>
        ) : row.previousBase === 0 ? (
          <span className="text-muted-foreground"> is new this time</span>
        ) : (
          <>
            {group.subject ? <span className="text-muted-foreground"> {group.subject}</span> : null}{' '}
            <span className="text-muted-foreground">{moved}</span>
          </>
        )}
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <Arrow className="h-3 w-3" aria-hidden />
          {row.previousBase === 0 ? 'none' : fmt(k, row.previous)} → {row.currentBase === 0 ? 'none' : fmt(k, row.current)}
          {group.kind !== 'mixed' && group.valueLabel.toLowerCase() !== group.subject ? (
            <span>· {group.valueLabel.toLowerCase()}</span>
          ) : null}
        </div>
      </div>
      <Impact metric={metric} value={row.impact} />
    </li>
  )
}

function BreakdownTable({ metric, group }: { metric: MetricKey; group: DriverGroup }) {
  const [open, setOpen] = useState(false)
  const rows = group.rows.slice(0, open ? group.rows.length : 5)
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="py-1 text-left font-normal">{group.title.replace(/^By /, '').replace(/^\w/, (c) => c.toUpperCase())}</th>
            <th className="py-1 text-right font-normal">Before</th>
            <th className="py-1 text-right font-normal">Now</th>
            <th className="py-1 text-right font-normal">Effect</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-border">
              <td className="py-1.5">{label(r.name)}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {r.previousBase === 0 ? <span title="Not active in this period">new</span> : fmt(rowKind(group, r), r.previous)}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {r.currentBase === 0 ? <span className="text-muted-foreground" title="Not active in this period">gone</span> : fmt(rowKind(group, r), r.current)}
              </td>
              <td className="py-1.5 text-right">
                <Impact metric={metric} value={r.impact} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {group.rows.length > 5 ? (
        <button type="button" onClick={() => setOpen(!open)} className="mt-1 text-xs text-primary hover:underline">
          {open ? 'Show fewer' : `Show all ${group.rows.length}`}
        </button>
      ) : null}
    </div>
  )
}

function Explanation({ metric, d, total }: { metric: MetricKey; d: DriversResult; total: number }) {
  const [more, setMore] = useState(false)
  const info = METRIC_INFO[metric]
  const threshold = Math.abs(total) * MIN_SHARE
  const rows = d.primary.rows.filter((r) => Math.abs(r.impact) > 1e-9)
  const sameWay = rows.filter((r) => Math.sign(r.impact) === Math.sign(total) && Math.abs(r.impact) >= threshold).slice(0, 3)
  const against = rows.filter((r) => Math.sign(r.impact) === -Math.sign(total) && Math.abs(r.impact) >= threshold).slice(0, 2)
  const flat = Math.abs(total) < 1e-9 || !sameWay.length
  const dir = total > 0 ? 'up' : 'down'
  const lead = sameWay[0]

  return (
    <div className="space-y-3">
      <p className="text-sm">
        {flat ? (
          <>
            {info.label} barely moved. The changes below roughly cancel out.
          </>
        ) : (
          <>
            {info.label} went <span className="font-medium">{dir}</span> ({impactText(metric, total)}), mainly because of{' '}
            <span className="font-medium">
              {label(lead.name)}
              {d.primary.subject ? ` ${d.primary.subject}` : ''}
            </span>
            {sameWay.length > 1 ? `, which alone explains ${impactText(metric, lead.impact)}` : ''}.
          </>
        )}
      </p>

      {sameWay.length ? (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {flat ? 'Pushing it' : `Main reasons it went ${dir}`}
          </h4>
          <ul className="space-y-1.5">
            {sameWay.map((r) => (
              <Reason key={r.name} metric={metric} group={d.primary} row={r} />
            ))}
          </ul>
        </div>
      ) : null}

      {against.length ? (
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Partly offset by</h4>
          <ul className="space-y-1.5">
            {against.map((r) => (
              <Reason key={r.name} metric={metric} group={d.primary} row={r} />
            ))}
          </ul>
        </div>
      ) : null}

      {d.breakdowns.length || d.context.length || rows.length > sameWay.length + against.length ? (
        <div>
          <button
            type="button"
            onClick={() => setMore(!more)}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {more ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {more ? 'Hide details' : 'Full breakdown'}
          </button>
          {more ? (
            <div className="mt-3 space-y-4">
              <BreakdownTable metric={metric} group={d.primary} />
              {d.breakdowns.map((g) => (
                <BreakdownTable key={g.title} metric={metric} group={g} />
              ))}
              {d.context.length ? (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Related numbers</h4>
                  <table className="w-full text-sm">
                    <tbody>
                      {d.context.map((c) => (
                        <tr key={c.label} className="border-t border-border">
                          <td className="py-1.5">{c.label}</td>
                          <td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmt(c.kind, c.previous)}</td>
                          <td className="py-1.5 text-right tabular-nums">→ {fmt(c.kind, c.current)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                "Effect" is how much each item moved {info.label} on its own. The effects in each table add up to the
                total change.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * "Why did it change?" for one metric and one window (compared with the same-length window just before).
 * `total` is the metric's change, so the headline matches the numbers shown above it.
 */
export function RootCause({
  metric,
  start,
  end,
  total,
}: {
  metric: MetricKey
  start: string
  end: string
  total: number
}) {
  const { data, loading, error, trigger } = useDrivers({ cachePolicy: 'stale-while-revalidate' })
  useEffect(() => {
    trigger({ metric, start, end })
  }, [metric, start, end, trigger])

  const d = data && data.metric === metric && data.current.start === start && data.current.end === end ? data : null
  if (error && !d) return <p className="text-sm text-destructive">Couldn't load the breakdown: {error}</p>
  if (!d) return <p className="text-sm text-muted-foreground">{loading ? 'Working out what changed…' : ''}</p>
  return <Explanation key={`${metric}:${start}`} metric={metric} d={d} total={total} />
}
