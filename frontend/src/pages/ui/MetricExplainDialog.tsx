import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, X } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../lib/shadcn/dialog'
import { cn } from '../../lib/shadcn/utils'
import type { OverviewResult, PeriodKpis } from '../data/types'
import { compare, formatValue, METRIC_INFO, rangeLabel, type Change, type MetricKey } from './metricInfo'
import { RootCause } from './RootCause'
import { tickStyle, tooltipItemStyle, tooltipStyle } from './chartTheme'
import { shortDate } from './format'

const toneText: Record<Change['tone'], string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  flat: 'text-muted-foreground',
}

export function ChangeBadge({ change, className }: { change: Change; className?: string }) {
  const Icon = change.direction === 'up' ? ArrowUpRight : change.direction === 'down' ? ArrowDownRight : Minus
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium tabular-nums', toneText[change.tone], className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {change.text}
    </span>
  )
}

export function MetricExplainDialog({
  metric,
  comparison,
  onOpenChange,
}: {
  metric: MetricKey | null
  comparison: OverviewResult['comparison']
  onOpenChange: (open: boolean) => void
}) {
  if (!metric) return null
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* keyed so the selected week resets when a different metric opens */}
        <Body key={metric} metric={metric} comparison={comparison} />
      </DialogContent>
    </Dialog>
  )
}

function Body({ metric, comparison }: { metric: MetricKey; comparison: OverviewResult['comparison'] }) {
  const info = METRIC_INFO[metric]
  const { current, previous, history } = comparison
  // A week picked on the chart, or null for the whole selected period.
  const [weekIdx, setWeekIdx] = useState<number | null>(null)

  const cur = current[metric]
  const prev = previous?.[metric]
  const change = prev != null ? compare(metric, cur, prev) : null

  const chartData = history.map((w) => ({ week: w.start, value: w[metric] }))
  const values = chartData.map((d) => d.value)
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  const lastWeek = history[history.length - 1]
  const weekBefore = history[history.length - 2]
  const weekChange = lastWeek && weekBefore ? compare(metric, lastWeek[metric], weekBefore[metric]) : null
  const scale = info.kind === 'rate' ? 100 : 1

  // What the "Why it changed" section explains: a picked week vs. the week before, or the period vs. the previous one.
  const picked: { now: PeriodKpis; before: PeriodKpis } | null =
    weekIdx != null && weekIdx > 0 ? { now: history[weekIdx], before: history[weekIdx - 1] } : null
  const target = picked ?? (previous ? { now: current, before: previous } : null)

  return (
    <>
      <DialogHeader>
        <DialogTitle>{info.label}</DialogTitle>
        <DialogDescription>{info.what}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">This period · {rangeLabel(current)}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{formatValue(info.kind, cur)}</div>
          {change ? (
            <div className="mt-1 text-sm">
              <ChangeBadge change={change} /> <span className="text-muted-foreground">vs. previous {current.days} days</span>
            </div>
          ) : (
            <div className="mt-1 text-sm text-muted-foreground">No earlier data to compare with yet.</div>
          )}
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-muted-foreground">Previous period{previous ? ` · ${rangeLabel(previous)}` : ''}</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-muted-foreground">
            {prev != null ? formatValue(info.kind, prev) : '—'}
          </div>
          {avg != null ? (
            <div className="mt-1 text-sm text-muted-foreground">
              {history.length}-week average: <span className="tabular-nums">{formatValue(info.kind, avg)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {target ? (
        <section className="rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">Why it changed</h3>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {rangeLabel(target.now)} vs. {rangeLabel(target.before)}
              {picked ? (
                <button
                  type="button"
                  onClick={() => setWeekIdx(null)}
                  className="inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 hover:text-foreground"
                >
                  <X className="h-3 w-3" /> Whole period
                </button>
              ) : null}
            </span>
          </div>
          <div className="mt-2">
            <RootCause
              metric={metric}
              start={target.now.start}
              end={target.now.end}
              total={target.now[metric] - target.before[metric]}
            />
          </div>
        </section>
      ) : null}

      {chartData.length > 1 ? (
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-medium">Week by week</h3>
            {weekChange ? (
              <span className="text-xs text-muted-foreground">
                Last 7 days vs. the 7 before: <ChangeBadge change={weekChange} />
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">Click a week to see why it went up or down from the week before.</p>
          <div className="mt-2 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                onClick={(e) => {
                  const i = e?.activeTooltipIndex
                  if (typeof i === 'number' && i > 0) setWeekIdx(i)
                }}
                style={{ cursor: 'pointer' }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="week" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
                <YAxis
                  tick={tickStyle}
                  tickLine={false}
                  width={44}
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) =>
                    info.kind === 'money' ? `$${v.toFixed(0)}` : `${num1(v * scale)}${info.kind === 'rate' ? '%' : ''}`
                  }
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={tooltipItemStyle}
                  labelFormatter={(label) => `Week of ${shortDate(String(label))} · click for why`}
                  formatter={(v) => [formatValue(info.kind, Number(v)), info.label]}
                />
                <Line dataKey="value" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                {weekIdx != null && chartData[weekIdx] ? (
                  <ReferenceDot
                    x={chartData[weekIdx].week}
                    y={chartData[weekIdx].value}
                    r={6}
                    fill="hsl(var(--primary))"
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {info.awaitsReview ? (
            <p className="mt-1 text-xs text-muted-foreground">
              The latest week usually looks worse than it will end up: its newest episodes are still waiting for QA review and only
              count once accepted.
            </p>
          ) : null}
        </section>
      ) : null}

      <section>
        <h3 className="text-sm font-medium">How it's calculated</h3>
        <p className="mt-1 rounded-md bg-muted px-3 py-2 font-mono text-xs leading-relaxed">{info.formula(current)}</p>
        {previous ? (
          <p className="mt-1 px-3 font-mono text-xs leading-relaxed text-muted-foreground">Previous: {info.formula(previous)}</p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <section>
          <h3 className="text-sm font-medium">What good looks like</h3>
          <p className="mt-1 text-sm text-muted-foreground">{info.benchmark}</p>
        </section>
        <section>
          <h3 className="text-sm font-medium">If it gets worse</h3>
          <p className="mt-1 text-sm text-muted-foreground">{info.ifWorse}</p>
        </section>
      </div>
    </>
  )
}

function num1(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(Number.isInteger(v) ? 0 : 1)
}
