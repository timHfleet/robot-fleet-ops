import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Siren, Eye, Timer, CircleAlert } from 'lucide-react'
import { useIncidents } from '../hooks/backend/metrics'
import type { IncidentsResult } from './data/types'
import { MetricCard } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { DonutChart } from './ui/DonutChart'
import { useDaysRange } from './ui/range'
import { pct, num, shortDate, prettify } from './ui/format'
import { colorAt, tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'

const SEVERITY_TONES: Record<string, string> = {
  minor: 'hsl(var(--chart-3))',
  major: 'hsl(var(--chart-4))',
  critical: 'hsl(var(--destructive))',
}

export default function Incidents() {
  const { data, loading, error, trigger } = useIncidents({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)

  if (error) return <ErrorBox message={`Failed to load incident metrics: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as IncidentsResult | null
  if (!d) return <Loading />

  const severityData = d.bySeverity.map((s) => ({ severity: prettify(s.severity), count: s.count }))
  const causeData = d.byRootCause.map((c) => ({ cause: c.cause, count: c.count }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Incident rate"
          value={num(d.ratePer1000RobotHours, 1)}
          sub={`Per 1,000 robot-hours (${num(d.count)} incidents, last ${days} days)`}
          icon={Siren}
          tone={d.ratePer1000RobotHours <= 5 ? 'good' : 'warn'}
        />
        <MetricCard label="Near misses" value={num(d.nearMiss)} sub="Reported near-miss events" icon={Eye} />
        <MetricCard
          label="Known root cause"
          value={pct(d.repeatRate)}
          sub="Share of incidents with a root cause identified"
          icon={CircleAlert}
          tone={d.repeatRate >= 0.8 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Time to resolve"
          value={`${num(d.timing.totalMin, 0)} min`}
          sub={`Occurred → resolved, on average`}
          icon={Timer}
          tone={d.timing.totalMin <= 120 ? 'good' : 'warn'}
        />
      </div>

      <PageGrid>
        <Section title="Response pipeline" description="Average minutes at each stage: detection, response, resolution.">
          <div className="space-y-4">
            {[
              { label: 'Time to detect', value: d.timing.detectMin, hint: 'Occurred → detected. Slow detection means better alerts.' },
              { label: 'Time to respond', value: d.timing.respondMin, hint: 'Detected → responded. Drives escalation policy.' },
              { label: 'Time to resolve', value: d.timing.resolveMin, hint: 'Responded → resolved. Drives triage and spares.' },
            ].map((stage, i) => {
              const max = Math.max(d.timing.detectMin, d.timing.respondMin, d.timing.resolveMin, 1)
              return (
                <div key={stage.label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{stage.label}</span>
                    <span className="tabular-nums text-muted-foreground">{num(stage.value, 0)} min</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(stage.value / max) * 100}%`, backgroundColor: colorAt(i) }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{stage.hint}</p>
                </div>
              )
            })}
          </div>
        </Section>

        <Section title="Incidents by severity" description="Critical incidents should trigger a review or stop.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={severityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="severity" tick={tickStyle} tickLine={false} />
                <YAxis tick={tickStyle} tickLine={false} width={32} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
                <Bar dataKey="count" name="Incidents" radius={[4, 4, 0, 0]}>
                  {severityData.map((s, i) => (
                    <Cell key={i} fill={SEVERITY_TONES[s.severity.toLowerCase()] ?? colorAt(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Severity share" description="Proportion of incidents in each severity band.">
          <DonutChart
            data={severityData.map((s) => ({ label: s.severity, value: s.count }))}
            heightClass="h-64"
          />
        </Section>
      </PageGrid>

      <PageGrid>
        <Section title="Weekly incident & near-miss counts" description="Rising counts per week justify a safety review.">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="weekStart" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
                <YAxis tick={tickStyle} tickLine={false} width={30} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(l) => shortDate(String(l))} />
                <Line dataKey="count" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={false} name="Incidents" />
                <Line dataKey="nearMiss" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} name="Near misses" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Root causes" description="Repeat incident rate — test whether fixes worked by watching causes shrink.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={causeData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={tickStyle} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="cause" tick={tickStyle} tickLine={false} width={140} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
                <Bar dataKey="count" name="Incidents" radius={[0, 4, 4, 0]}>
                  {causeData.map((_, i) => (
                    <Cell key={i} fill={colorAt(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </PageGrid>
    </div>
  )
}
