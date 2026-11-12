import { useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, Target, Radio, Gauge, Users, DollarSign, CalendarCheck, Siren } from 'lucide-react'
import { useOverview } from '../hooks/backend/metrics'
import type { OverviewResult } from './data/types'
import { MetricCard } from './ui/MetricCard'
import { ChangeBadge, MetricExplainDialog } from './ui/MetricExplainDialog'
import { compare, type MetricKey } from './ui/metricInfo'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { useDaysRange } from './ui/range'
import { pct, num, money, shortDate } from './ui/format'
import { tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'

export default function Dashboard() {
  const { data, loading, error, trigger } = useOverview({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)
  const [open, setOpen] = useState<MetricKey | null>(null)

  if (error) return <ErrorBox message={`Failed to load overview: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as OverviewResult | null
  if (!d) return <Loading />

  const cmp = d.comparison
  // Card props shared by every headline metric: click to explain, badge vs. previous period.
  const explain = (key: MetricKey) => ({
    onClick: () => setOpen(key),
    footer:
      cmp?.previous != null ? (
        <span className="text-muted-foreground">
          <ChangeBadge change={compare(key, cmp.current[key], cmp.previous[key])} /> vs. prev {days}d
        </span>
      ) : undefined,
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
        <MetricCard
          label="QA pass rate"
          value={pct(d.quality.passRate)}
          sub={`${num(d.quality.accepted)} accepted of ${num(d.quality.reviewed)} reviewed`}
          icon={CheckCircle2}
          tone={d.quality.passRate >= 0.85 ? 'good' : d.quality.passRate >= 0.7 ? 'warn' : 'bad'}
          {...explain('passRate')}
        />
        <MetricCard
          label="Usable episodes"
          value={num(d.throughput.accepted)}
          sub={`Goal attainment ${pct(d.throughput.goalAttainment)} of ${num(d.throughput.target)}`}
          icon={Target}
          tone={d.throughput.goalAttainment >= 0.9 ? 'good' : d.throughput.goalAttainment >= 0.7 ? 'warn' : 'bad'}
          {...explain('accepted')}
        />
        <MetricCard
          label="Fleet availability"
          value={pct(d.uptime.availability)}
          sub={`MTBF ${num(d.uptime.mtbfHours, 1)}h · MTTR ${num(d.uptime.mttrMinutes, 0)}m`}
          icon={Radio}
          tone={d.uptime.availability >= 0.9 ? 'good' : d.uptime.availability >= 0.8 ? 'warn' : 'bad'}
          {...explain('availability')}
        />
        <MetricCard
          label="Robot utilization"
          value={pct(d.efficiency.robotUtilization)}
          sub="Hours collecting ÷ hours available"
          icon={Gauge}
          tone={d.efficiency.robotUtilization >= 0.6 ? 'good' : 'warn'}
          {...explain('robotUtilization')}
        />
        <MetricCard
          label="Operator utilization"
          value={pct(d.efficiency.operatorUtilization)}
          sub="Hours collecting ÷ paid hours"
          icon={Users}
          tone={d.efficiency.operatorUtilization >= 0.6 ? 'good' : 'warn'}
          {...explain('operatorUtilization')}
        />
        <MetricCard
          label="Cost per usable episode"
          value={money(d.efficiency.costPerUsableEpisode)}
          sub="Labor + robot cost ÷ accepted"
          icon={DollarSign}
          {...explain('costPerUsableEpisode')}
        />
        <MetricCard
          label="Shift fill rate"
          value={pct(d.coverage.fillRate)}
          sub="Filled shifts ÷ planned shifts"
          icon={CalendarCheck}
          tone={d.coverage.fillRate >= 0.9 ? 'good' : 'warn'}
          {...explain('fillRate')}
        />
        <MetricCard
          label="Incident rate"
          value={num(d.incidents.ratePer1000RobotHours, 1)}
          sub={`${num(d.incidents.count)} incidents per 1,000 robot-hours basis`}
          icon={Siren}
          tone={d.incidents.ratePer1000RobotHours <= 5 ? 'good' : 'warn'}
          {...explain('incidentRate')}
        />
      </div>
      <p className="text-xs text-muted-foreground">Click any card for what it means, how it's calculated, and how it compares over time.</p>

      {cmp ? <MetricExplainDialog metric={open} comparison={cmp} onOpenChange={(o) => !o && setOpen(null)} /> : null}

      <Section
        title={`Episodes collected — last ${days} days`}
        description="Accepted vs. rejected episodes per day. Drives goal attainment and quality coaching."
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={d.daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="day" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
              <YAxis tick={tickStyle} tickLine={false} width={32} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelFormatter={(label) => shortDate(String(label))} />
              <Area dataKey="accepted" stackId="1" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.35} name="Accepted" />
              <Area dataKey="rejected" stackId="1" stroke="hsl(var(--chart-1))" fill="hsl(var(--chart-1))" fillOpacity={0.35} name="Rejected" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <PageGrid>
        <Section title="Usable episodes per operator-hour" description="Accepted episodes ÷ paid operator-hours — compare operators and tasks.">
          <div className="text-3xl font-semibold tabular-nums">{num(d.throughput.perOperatorHour, 2)}</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Across {num(d.quality.accepted)} accepted episodes in the last {days} days.
          </p>
        </Section>
        <Section title="Decisions this dashboard drives" description="Where each number points next.">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>Pass rate below target → coach operators or fix the SOP.</li>
            <li>Availability slipping → adjust repairs or spare capacity.</li>
            <li>Utilization low → find idle robots and waiting time.</li>
            <li>Fill rate low → adjust hiring and scheduling.</li>
            <li>Incidents rising → trigger a safety review.</li>
          </ul>
        </Section>
      </PageGrid>
    </div>
  )
}
