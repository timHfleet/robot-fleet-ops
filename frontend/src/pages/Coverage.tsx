import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarCheck, Layers, Home, Sun, Sunrise, Sunset, MoonStar } from 'lucide-react'
import { useCoverage } from '../hooks/backend/metrics'
import type { CoverageResult } from './data/types'
import { MetricCard, ProgressBar } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { SimpleTable } from './ui/SimpleTable'
import { DonutChart } from './ui/DonutChart'
import { useDaysRange } from './ui/range'
import { pct, num, prettify } from './ui/format'
import { colorAt, tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'

export default function Coverage() {
  const { data, loading, error, trigger } = useCoverage({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)

  if (error) return <ErrorBox message={`Failed to load coverage metrics: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as CoverageResult | null
  if (!d) return <Loading />

  const distChart = (rows: { label: string; accepted: number }[]) => (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="label" tick={tickStyle} tickLine={false} />
          <YAxis tick={tickStyle} tickLine={false} width={36} />
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
          <Bar dataKey="accepted" name="Accepted" radius={[4, 4, 0, 0]}>
            {rows.map((_, i) => (
              <Cell key={i} fill={colorAt(i)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Shift fill rate"
          value={pct(d.fillRate)}
          sub={`${num(d.filledShifts)} filled ÷ ${num(d.plannedShifts)} planned`}
          icon={CalendarCheck}
          tone={d.fillRate >= 0.9 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Homes covered"
          value={num(d.diversity.homes)}
          sub={`Across ${num(d.diversity.accepted)} accepted episodes`}
          icon={Home}
        />
        <MetricCard label="Object categories" value={num(d.diversity.objects)} sub="Distinct objects collected" icon={Layers} />
        <MetricCard label="Lighting conditions" value={num(d.diversity.lighting)} sub="Distinct lighting setups" icon={Sun} />
      </div>

      <Section
        title="Shift coverage"
        description="Filled vs planned operators across the three shifts — Morning, Evening and Overnight."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(d.byShift ?? []).map((s) => {
            const Icon = s.shift === 'morning' ? Sunrise : s.shift === 'evening' ? Sunset : MoonStar
            return (
              <div key={s.shift} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                    {prettify(s.shift)}
                  </span>
                  <span className="text-sm tabular-nums">{pct(s.fillRate, 0)}</span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(s.fillRate, 1) * 100}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {num(s.filled)} filled of {num(s.planned)} planned
                </p>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Task coverage vs. target" description="Usable episodes vs. prorated target by task — rebalance priorities where attainment lags.">
        <SimpleTable
          rows={d.taskCoverage}
          rowKey={(r) => r.task}
          columns={[
            { key: 'task', header: 'Task', render: (r) => prettify(r.task) },
            { key: 'accepted', header: 'Accepted', align: 'right', render: (r) => num(r.accepted) },
            { key: 'target', header: `Target (${days}d)`, align: 'right', render: (r) => num(r.target) },
            {
              key: 'attainment',
              header: 'Attainment',
              align: 'right',
              render: (r) => (
                <div className="flex items-center justify-end gap-2">
                  <ProgressBar value={r.attainment} className="w-20" />
                  <span className="w-12 text-right">{pct(r.attainment, 0)}</span>
                </div>
              ),
            },
          ]}
        />
      </Section>

      <PageGrid>
        <Section title="Episodes by home" description="Environment diversity across homes — narrow coverage means brittle models.">
          {distChart(d.byHome)}
        </Section>
        <Section title="Episodes by lighting" description="Distribution across lighting conditions.">
          {distChart(d.byLighting)}
        </Section>
      </PageGrid>

      <Section title="Episodes by object category" description="Distribution across object types, with the share of each category.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {distChart(d.byObject)}
          <DonutChart data={d.byObject.map((o) => ({ label: prettify(o.label), value: o.accepted }))} />
        </div>
      </Section>
    </div>
  )
}
