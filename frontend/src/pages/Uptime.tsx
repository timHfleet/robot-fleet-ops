import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Radio, Wrench, TimerReset, AlertTriangle } from 'lucide-react'
import { useUptime } from '../hooks/backend/metrics'
import type { UptimeResult } from './data/types'
import { MetricCard } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { SimpleTable } from './ui/SimpleTable'
import { useDaysRange } from './ui/range'
import { pct, num, shortDate, prettify } from './ui/format'
import { colorAt, tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'

export default function Uptime() {
  const { data, loading, error, trigger } = useUptime({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)

  if (error) return <ErrorBox message={`Failed to load uptime metrics: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as UptimeResult | null
  if (!d) return <Loading />

  const faultData = d.faults.map((f) => ({ fault: prettify(f.faultCode), count: f.count }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Fleet availability"
          value={pct(d.availability)}
          sub={`${num(d.readyHours, 0)} ready of ${num(d.scheduledHours, 0)} scheduled robot-hours`}
          icon={Radio}
          tone={d.availability >= 0.9 ? 'good' : d.availability >= 0.8 ? 'warn' : 'bad'}
        />
        <MetricCard
          label="MTBF"
          value={`${num(d.mtbfHours, 1)} h`}
          sub={`${num(d.operatingHours, 0)} operating h ÷ ${num(d.failures)} failures`}
          icon={Wrench}
          tone={d.mtbfHours >= 10 ? 'good' : d.mtbfHours >= 5 ? 'warn' : 'bad'}
        />
        <MetricCard
          label="MTTR"
          value={`${num(d.mttrMinutes, 0)} min`}
          sub="Average failure → recovery"
          icon={TimerReset}
          tone={d.mttrMinutes <= 60 ? 'good' : d.mttrMinutes <= 120 ? 'warn' : 'bad'}
        />
        <MetricCard
          label="Failures"
          value={num(d.failures)}
          sub={`Last ${days} days — recurring faults go to engineering`}
          icon={AlertTriangle}
        />
      </div>

      <PageGrid>
        <Section title="Availability by robot" description="Robot-hours ready ÷ scheduled — the laggards drive repairs and spares.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.perRobot.map((r) => ({ name: r.name, availability: r.availability }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="name" tick={tickStyle} tickLine={false} interval={0} angle={-30} height={50} textAnchor="end" />
                <YAxis tick={tickStyle} tickLine={false} width={44} domain={[0, 1]} tickFormatter={(v: number) => pct(v, 0)} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} formatter={(v) => [pct(Number(v)), 'Availability']} />
                <Bar dataKey="availability" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Faults by type" description="Recurring faults worth escalating to engineering.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={faultData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={tickStyle} tickLine={false} />
                <YAxis type="category" dataKey="fault" tick={tickStyle} tickLine={false} width={110} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
                <Bar dataKey="count" name="Failures" radius={[0, 4, 4, 0]}>
                  {faultData.map((_, i) => (
                    <Cell key={i} fill={colorAt(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </PageGrid>

      <PageGrid>
        <Section title="Weekly availability trend" description="Watch for degradation after usage spikes or deferred maintenance.">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="weekStart" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
                <YAxis tick={tickStyle} tickLine={false} width={44} domain={[0.7, 1]} tickFormatter={(v: number) => pct(v, 0)} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(l) => shortDate(String(l))} formatter={(v) => [pct(Number(v)), 'Availability']} />
                <Line dataKey="availability" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Robot reliability detail" description="Per-robot availability, failures, MTBF and MTTR.">
          <SimpleTable
            rows={d.perRobot}
            rowKey={(r) => r.name}
            columns={[
              { key: 'name', header: 'Robot', render: (r) => r.name },
              { key: 'avail', header: 'Availability', align: 'right', render: (r) => pct(r.availability) },
              { key: 'fail', header: 'Failures', align: 'right', render: (r) => num(r.failures) },
              { key: 'mtbf', header: 'MTBF', align: 'right', render: (r) => `${num(r.mtbfHours, 1)}h` },
              { key: 'mttr', header: 'MTTR', align: 'right', render: (r) => `${num(r.mttrMinutes, 0)}m` },
            ]}
          />
        </Section>
      </PageGrid>
    </div>
  )
}
