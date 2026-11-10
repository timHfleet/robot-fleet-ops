import { Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Gauge, Users, Recycle, DollarSign } from 'lucide-react'
import { useEfficiency } from '../hooks/backend/metrics'
import type { EfficiencyResult } from './data/types'
import { MetricCard, MetricRow } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { useDaysRange } from './ui/range'
import { pct, num, money, shortDate } from './ui/format'
import { tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'

export default function Efficiency() {
  const { data, loading, error, trigger } = useEfficiency({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)
  void days

  if (error) return <ErrorBox message={`Failed to load efficiency metrics: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as EfficiencyResult | null
  if (!d) return <Loading />

  const utilTrend = d.robotUtilTrend.map((r, i) => ({
    weekStart: r.weekStart,
    utilization: r.utilization,
    resetShare: d.resetTrend[i]?.resetShare ?? 0,
  }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Robot utilization"
          value={pct(d.robotUtilization)}
          sub="Hours collecting ÷ hours available"
          icon={Gauge}
          tone={d.robotUtilization >= 0.6 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Operator utilization"
          value={pct(d.operatorUtilization)}
          sub="Hours collecting ÷ paid hours"
          icon={Users}
          tone={d.operatorUtilization >= 0.6 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Reset overhead"
          value={pct(d.resetOverhead)}
          sub="Reset time ÷ total session time"
          icon={Recycle}
          tone={d.resetOverhead <= 0.2 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Cost per usable episode"
          value={money(d.costPerUsableEpisode)}
          sub={`${num(d.accepted)} accepted episodes`}
          icon={DollarSign}
        />
      </div>

      <PageGrid>
        <Section title="Robot utilization by robot" description="Idle robots stand out at the bottom — rebalance tasks or spares.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.perRobot.map((r) => ({ name: r.name, utilization: r.utilization }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={tickStyle} tickLine={false} interval={0} angle={-30} height={50} textAnchor="end" />
                <YAxis tick={tickStyle} tickLine={false} width={44} domain={[0, 1]} tickFormatter={(v: number) => pct(v, 0)} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} formatter={(v) => [pct(Number(v)), 'Utilization']} />
                <Bar dataKey="utilization" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Weekly utilization & reset overhead" description="Robot utilization (bars) and reset share of session time (line).">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={utilTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="weekStart" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
                <YAxis tick={tickStyle} tickLine={false} width={44} domain={[0, 1]} tickFormatter={(v: number) => pct(v, 0)} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(l) => shortDate(String(l))} />
                <Bar dataKey="utilization" fill="hsl(var(--chart-3))" fillOpacity={0.5} name="Robot utilization" radius={[4, 4, 0, 0]} />
                <Line dataKey="resetShare" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Reset overhead" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </PageGrid>

      <Section title="Cost & time decomposition" description="What the operation spends to produce usable episodes.">
        <div className="grid gap-x-10 gap-y-1 md:grid-cols-2">
          <div>
            <MetricRow label="Labor cost (paid operator-hours)" value={money(d.laborCost)} />
            <MetricRow label="Robot cost (available robot-hours)" value={money(d.robotCost)} />
            <MetricRow label="Total cost" value={money(d.laborCost + d.robotCost)} />
            <MetricRow label="Accepted (usable) episodes" value={num(d.accepted)} />
          </div>
          <div>
            <MetricRow label="Paid operator-hours" value={num(d.paidHours, 1)} />
            <MetricRow label="Collecting hours" value={num(d.collectingHours, 1)} />
            <MetricRow label="Waiting hours (idle while paid)" value={num(d.waitingHours, 1)} />
            <MetricRow label="Reset hours" value={num(d.collectingHours > 0 ? (d.resetOverhead / (1 - d.resetOverhead)) * d.collectingHours : 0, 1)} />
          </div>
        </div>
      </Section>
    </div>
  )
}
