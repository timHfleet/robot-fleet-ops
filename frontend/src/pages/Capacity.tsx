import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Bot, Target, TrendingDown, ShieldCheck } from 'lucide-react'
import { useCapacity } from '../hooks/backend/ops'
import { MetricCard, ProgressBar } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { RiskBadge } from './ui/RiskBadge'
import { pct, num } from './ui/format'
import { tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'
import { Checkbox } from '../lib/shadcn/checkbox'
import { Button } from '../lib/shadcn/button'
import { cn } from '../lib/shadcn/utils'

const GOAL = 0.9 // "on target" means at least 90% of the weekly goal

export default function Capacity() {
  const { data, loading, error, trigger } = useCapacity({ cachePolicy: 'stale-while-revalidate' })
  const [down, setDown] = useState<Set<number>>(new Set())
  const [days, setDays] = useState(3)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    trigger({})
  }, [trigger])

  // Start the scenario with whatever is actually down or high-risk right now.
  useEffect(() => {
    if (data && !touched) setDown(new Set(data.robots.filter((r) => r.downNow || r.risk === 'high').map((r) => r.id)))
  }, [data, touched])

  const model = useMemo(() => {
    if (!data) return null
    const lost = data.robots.filter((r) => down.has(r.id)).reduce((s, r) => s + (r.weeklyAccepted * days) / 7, 0)
    const projected = data.weeklyCapacity - lost
    const attainment = data.weeklyTarget ? projected / data.weeklyTarget : 0
    const shortfall = Math.max(0, data.weeklyTarget * GOAL - projected)
    const perRobotDay = data.robots.length ? data.weeklyCapacity / data.robots.length / 7 : 0

    // What-if curve: N robots down for the chosen number of days.
    const byOutput = [...data.robots].sort((a, b) => b.weeklyAccepted - a.weeklyAccepted)
    const curve = byOutput.map((_, i) => {
      const n = i
      const worst = byOutput.slice(0, n).reduce((s, r) => s + (r.weeklyAccepted * days) / 7, 0)
      const best = byOutput.slice(byOutput.length - n).reduce((s, r) => s + (n ? (r.weeklyAccepted * days) / 7 : 0), 0)
      return {
        n,
        worst: (data.weeklyCapacity - worst) / data.weeklyTarget,
        best: (data.weeklyCapacity - best) / data.weeklyTarget,
      }
    })
    const safeWorst = curve.filter((c) => c.worst >= GOAL).length - 1
    return { lost, projected, attainment, shortfall, perRobotDay, curve, safeWorst }
  }, [data, down, days])

  if (error) return <ErrorBox message={`Failed to load capacity data: ${error}`} />
  if (loading && !data) return <Loading />
  if (!data || !model) return <Loading />

  const toggle = (id: number) => {
    setTouched(true)
    setDown((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const onTarget = model.attainment >= GOAL
  const extraRobotDays = model.perRobotDay ? Math.ceil(model.shortfall / model.perRobotDay) : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Weekly target" value={num(data.weeklyTarget)} sub="Accepted episodes, all tasks" icon={Target} />
        <MetricCard
          label="Full-fleet capacity"
          value={num(data.weeklyCapacity)}
          sub={`${pct(data.weeklyCapacity / data.weeklyTarget, 0)} of target with every robot up`}
          icon={Bot}
        />
        <MetricCard
          label="Projected this scenario"
          value={num(model.projected)}
          sub={`−${num(model.lost)} episodes from ${down.size} robot(s) × ${days} day(s)`}
          icon={TrendingDown}
          tone={onTarget ? 'good' : model.attainment >= 0.75 ? 'warn' : 'bad'}
        />
        <MetricCard
          label="Robots you can lose"
          value={num(Math.max(model.safeWorst, 0))}
          sub={`For ${days} day(s), worst case, staying ≥ ${pct(GOAL, 0)} of target`}
          icon={ShieldCheck}
        />
      </div>

      <PageGrid>
        <Section title="Build a scenario" description="Tick the robots that will be down and set how long. Robots down now or at high risk start ticked.">
          <div className="mb-4">
            <div className="flex items-center justify-between text-sm">
              <label htmlFor="days" className="font-medium">Days down this week</label>
              <span className="tabular-nums text-muted-foreground">{days} of 7</span>
            </div>
            <input
              id="days"
              type="range"
              min={1}
              max={7}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="mt-2 w-full accent-[hsl(var(--primary))]"
            />
          </div>

          <ul className="divide-y divide-border rounded-md border border-border">
            {data.robots.map((r) => {
              const checked = down.has(r.id)
              return (
                <li key={r.id}>
                  <label className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', checked && 'bg-red-500/5')}>
                    <Checkbox checked={checked} onCheckedChange={() => toggle(r.id)} aria-label={`${r.name} down`} />
                    <span className="w-28 font-medium">{r.name}</span>
                    <RiskBadge level={r.risk} />
                    {r.downNow ? <span className="rounded bg-red-600 px-1.5 py-0.5 text-[11px] font-medium text-white">Down now</span> : null}
                    <span className="ml-auto tabular-nums text-muted-foreground">{num(r.weeklyAccepted)}/wk</span>
                  </label>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { setTouched(true); setDown(new Set()) }}>Clear</Button>
            <Button variant="outline" size="sm" onClick={() => { setTouched(false) }}>Reset to current state</Button>
          </div>
        </Section>

        <Section title="Result" description={`Based on each robot's accepted episodes over the last ${data.basisDays} days.`}>
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-muted-foreground">Goal attainment</span>
            <span className={cn('text-3xl font-semibold tabular-nums', onTarget ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              {pct(model.attainment, 0)}
            </span>
          </div>
          <ProgressBar value={model.attainment} className="mt-2 h-3" />
          <div
            className={cn(
              'mt-4 rounded-md border p-3 text-sm',
              onTarget ? 'border-emerald-400/50 bg-emerald-500/5' : 'border-red-400/50 bg-red-500/5',
            )}
          >
            {onTarget ? (
              <p>
                <span className="font-semibold">On track.</span> The fleet still makes {num(model.projected)} of {num(data.weeklyTarget)} episodes. No spare robots or
                overtime needed.
              </p>
            ) : (
              <p>
                <span className="font-semibold">At risk.</span> About {num(model.shortfall)} episodes short of the {pct(GOAL, 0)} line. That's roughly{' '}
                <span className="font-semibold">{extraRobotDays} extra robot-day(s)</span> of collection: bring in a spare, add a weekend shift, or move
                operators onto the highest-output robots that are still up.
              </p>
            )}
          </div>

          <h3 className="mb-1 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Attainment vs. robots down ({days} day{days > 1 ? 's' : ''})
          </h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={model.curve}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="n" tick={tickStyle} tickLine={false} label={{ value: 'robots down', position: 'insideBottom', offset: -2, fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={tickStyle} tickLine={false} width={44} tickFormatter={(v: number) => pct(v, 0)} domain={[0, 'auto']} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} formatter={(v) => pct(Number(v), 0)} labelFormatter={(l) => `${l} robot(s) down`} />
                <ReferenceLine y={GOAL} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="worst" name="Worst case (top robots down)" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                <Line dataKey="best" name="Best case (weakest robots down)" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </PageGrid>
    </div>
  )
}
