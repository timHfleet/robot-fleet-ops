import { useEffect } from 'react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { ShieldAlert, Eye, ShieldCheck, PowerOff } from 'lucide-react'
import { useMaintenance } from '../hooks/backend/ops'
import type { RobotRisk } from './data/opsTypes'
import { MetricCard } from './ui/MetricCard'
import { Section, Loading, ErrorBox } from './ui/Section'
import { RiskBadge } from './ui/RiskBadge'
import { pct, num, shortDate, prettify } from './ui/format'
import { tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'
import { cn } from '../lib/shadcn/utils'

const BAR_COLOR: Record<RobotRisk['level'], string> = {
  high: 'hsl(var(--destructive))',
  medium: 'hsl(var(--warning))',
  low: 'hsl(var(--chart-3))',
}

function Compare({ label, now, usual, worseWhenHigher = true, format }: {
  label: string
  now: number
  usual: number
  worseWhenHigher?: boolean
  format: (v: number) => string
}) {
  const worse = worseWhenHigher ? now > usual * 1.15 : now < usual - 0.02
  return (
    <div className="rounded-md bg-muted/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-sm font-semibold tabular-nums', worse && 'text-red-600 dark:text-red-400')}>{format(now)}</div>
      <div className="text-[11px] text-muted-foreground">usually {format(usual)}</div>
    </div>
  )
}

function RobotCard({ r }: { r: RobotRisk }) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-4 shadow-retool-sm',
        r.level === 'high' ? 'border-red-400/60' : r.level === 'medium' ? 'border-amber-400/60' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">{r.name}</h3>
          <RiskBadge level={r.level} />
          {r.downNow ? (
            <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Down now</span>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums">{r.score}</div>
          <div className="text-[11px] text-muted-foreground">risk score / 100</div>
        </div>
      </div>

      <p className={cn('mt-1 text-sm', r.level === 'low' ? 'text-muted-foreground' : 'font-medium')}>{r.action}</p>
      {r.reasons.length ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {r.reasons.map((why) => (
            <li key={why}>{why}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Compare label="Failures / wk" now={r.failuresRecent} usual={r.failuresBaselineWeekly} format={(v) => num(v, 1)} />
        <Compare label="Repair time" now={r.mttrRecent} usual={r.mttrBaseline} format={(v) => `${num(v, 0)}m`} />
        <Compare
          label="Availability"
          now={r.availabilityRecent}
          usual={r.availabilityBaseline}
          worseWhenHigher={false}
          format={(v) => pct(v, 1)}
        />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="text-xs text-muted-foreground">
          {r.topFault ? (
            <>
              Most common fault (14d): <span className="font-medium text-foreground">{prettify(r.topFault)}</span>
            </>
          ) : (
            'No faults in the last 14 days'
          )}
        </div>
        <div className="h-12 w-40 shrink-0" aria-label={`Weekly failures for ${r.name}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={r.weeklyFailures}>
              <XAxis dataKey="weekStart" hide />
              <Tooltip
                contentStyle={tooltipStyle}
                itemStyle={tooltipItemStyle}
                labelFormatter={(l) => `Week of ${shortDate(String(l))}`}
                cursor={{ fill: 'hsl(var(--muted))' }}
              />
              <Bar dataKey="failures" name="Failures" fill={BAR_COLOR[r.level]} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

export default function Maintenance() {
  const { data, loading, error, trigger } = useMaintenance({ cachePolicy: 'stale-while-revalidate' })
  useEffect(() => {
    trigger({})
  }, [trigger])

  if (error) return <ErrorBox message={`Failed to load maintenance alerts: ${error}`} />
  if (loading && !data) return <Loading />
  if (!data) return <Loading />

  const atRisk = data.robots.filter((r) => r.level !== 'low')
  const healthy = data.robots.filter((r) => r.level === 'low')

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="High risk" value={num(data.counts.high)} sub="Pull for maintenance within 24h" icon={ShieldAlert} tone={data.counts.high ? 'bad' : 'good'} />
        <MetricCard label="On watch" value={num(data.counts.medium)} sub="Inspect this week" icon={Eye} tone={data.counts.medium ? 'warn' : 'good'} />
        <MetricCard label="Healthy" value={num(data.counts.low)} sub="Running at their normal rate" icon={ShieldCheck} tone="good" />
        <MetricCard label="Down right now" value={num(data.downNow)} sub="Unrecovered failures" icon={PowerOff} tone={data.downNow ? 'bad' : 'good'} />
      </div>

      <Section
        title="Robots trending toward failure"
        description={`Each robot's last ${data.windowDays} days compared with its own previous ${data.baselineDays} days: more failures, slower repairs and lost availability raise the score.`}
      >
        {atRisk.length ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {atRisk.map((r) => (
              <RobotCard key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No robots are trending worse than their baseline. 🎉</p>
        )}
      </Section>

      <Section title="Healthy robots" description="Failure rate, repair time and availability are in line with their usual levels.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {healthy.map((r) => (
            <RobotCard key={r.id} r={r} />
          ))}
        </div>
      </Section>

      <Section title="How the score works" description="Simple and explainable, so a shift lead can trust it.">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li><span className="font-medium text-foreground">45 pts</span> — failures this week vs. the robot's normal weekly rate (3× normal = full points).</li>
          <li><span className="font-medium text-foreground">25 pts</span> — average repair time vs. normal (2× longer = full points).</li>
          <li><span className="font-medium text-foreground">30 pts</span> — drop in availability (8 percentage points = full points).</li>
          <li>55+ is high risk, 30–54 is on watch. Comparing each robot with itself avoids flagging robots that simply work harder.</li>
        </ul>
      </Section>
    </div>
  )
}
