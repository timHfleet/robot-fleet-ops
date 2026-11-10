import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Target, Timer, Users, Zap } from 'lucide-react'
import { useThroughput } from '../hooks/backend/metrics'
import type { ThroughputResult } from './data/types'
import { MetricCard, ProgressBar } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { SimpleTable } from './ui/SimpleTable'
import { useDaysRange } from './ui/range'
import { pct, num, shortDate } from './ui/format'
import { tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'

export default function Throughput() {
  const { data, loading, error, trigger } = useThroughput({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)
  void days

  if (error) return <ErrorBox message={`Failed to load throughput metrics: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as ThroughputResult | null
  if (!d) return <Loading />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Goal attainment"
          value={pct(d.goalAttainment)}
          sub={`${num(d.accepted)} usable ÷ ${num(d.target)} target`}
          icon={Target}
          tone={d.goalAttainment >= 0.9 ? 'good' : d.goalAttainment >= 0.7 ? 'warn' : 'bad'}
        />
        <MetricCard
          label="Median cycle time"
          value={`${num(d.cycleTime.p50, 1)} min`}
          sub={`P90 ${num(d.cycleTime.p90, 1)} min, including reset`}
          icon={Timer}
        />
        <MetricCard
          label="Avg collect / reset"
          value={`${num(d.cycleTime.avgCollect, 1)} / ${num(d.cycleTime.avgReset, 1)} min`}
          sub="Where the cycle time goes"
          icon={Zap}
        />
        <MetricCard
          label="Usable per operator-hour"
          value={num(d.perOperator.reduce((s, o) => s + o.accepted, 0) / Math.max(d.perOperator.reduce((s, o) => s + o.paidHours, 0), 0.001), 2)}
          sub="Team-wide, accepted ÷ paid hours"
          icon={Users}
        />
      </div>

      <Section
        title="Episodes per day"
        description="Total collected vs. accepted (usable) — the gap is quality loss, the slope is throughput."
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={d.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
              <YAxis tick={tickStyle} tickLine={false} width={32} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(l) => shortDate(String(l))} />
              <Line dataKey="total" stroke="hsl(var(--chart-2))" strokeWidth={1.5} dot={false} name="Collected" />
              <Line dataKey="accepted" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} name="Accepted" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <PageGrid>
        <Section title="Usable episodes per operator-hour" description="Compare operators — low output per paid hour points at waiting, resets, or rejections.">
          <SimpleTable
            rows={d.perOperator}
            rowKey={(r) => r.name}
            columns={[
              { key: 'name', header: 'Operator', render: (r) => r.name },
              { key: 'paid', header: 'Paid hours', align: 'right', render: (r) => num(r.paidHours, 1) },
              { key: 'accepted', header: 'Accepted', align: 'right', render: (r) => num(r.accepted) },
              { key: 'perHour', header: 'Per hour', align: 'right', render: (r) => num(r.perHour, 2) },
            ]}
          />
        </Section>

        <div className="space-y-4">
          <Section title="Median cycle time by week" description="Median minutes per episode including reset — find workflow bottlenecks.">
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={d.cycleTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="weekStart" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
                  <YAxis tick={tickStyle} tickLine={false} width={36} />
                  <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(l) => shortDate(String(l))} />
                  <Line dataKey="p50" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} name="Median min" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Section>

          <Section title="Goal attainment" description="Usable episodes ÷ target for the selected period.">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{num(d.accepted)} of {num(d.target)}</span>
              <span className="font-semibold tabular-nums">{pct(d.goalAttainment)}</span>
            </div>
            <ProgressBar value={d.goalAttainment} className="mt-2" />
            <p className="mt-3 text-xs text-muted-foreground">
              Below target → reallocate people and robots to the shortfall tasks.
            </p>
          </Section>
        </div>
      </PageGrid>
    </div>
  )
}
