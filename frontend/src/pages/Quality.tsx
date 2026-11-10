import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CheckCircle2, ClipboardCheck, Split, AlertCircle } from 'lucide-react'
import { useQuality } from '../hooks/backend/metrics'
import type { QualityResult } from './data/types'
import { MetricCard, MetricRow, ProgressBar } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { SimpleTable } from './ui/SimpleTable'
import { DonutChart } from './ui/DonutChart'
import { useDaysRange } from './ui/range'
import { pct, num, shortDate, prettify } from './ui/format'
import { colorAt, tickStyle, tooltipStyle, tooltipItemStyle } from './ui/chartTheme'

export default function Quality() {
  const { data, loading, error, trigger } = useQuality({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)

  if (error) return <ErrorBox message={`Failed to load quality metrics: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as QualityResult | null
  if (!d) return <Loading />

  const rejectData = d.rejectReasons.map((r) => ({ reason: prettify(r.reason), count: r.count }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="QA pass rate"
          value={pct(d.passRate)}
          sub="Accepted ÷ reviewed episodes"
          icon={CheckCircle2}
          tone={d.passRate >= 0.85 ? 'good' : d.passRate >= 0.7 ? 'warn' : 'bad'}
        />
        <MetricCard label="Reviewed episodes" value={num(d.reviewed)} sub={`Last ${days} days`} icon={ClipboardCheck} />
        <MetricCard label="Accepted episodes" value={num(d.accepted)} sub="Usable for training" icon={CheckCircle2} />
        <MetricCard
          label="Inter-reviewer agreement"
          value={pct(d.agreement.rate)}
          sub={`${num(d.agreement.agree)} of ${num(d.agreement.samples)} double-reviewed samples agree`}
          icon={Split}
          tone={d.agreement.rate >= 0.9 ? 'good' : d.agreement.rate >= 0.8 ? 'warn' : 'bad'}
        />
      </div>

      <PageGrid>
        <Section title="Rejection reasons" description="Share of rejects by reason — target the biggest failure mode.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rejectData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                <XAxis type="number" tick={tickStyle} tickLine={false} />
                <YAxis type="category" dataKey="reason" tick={tickStyle} tickLine={false} width={110} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
                <Bar dataKey="count" name="Rejects" radius={[0, 4, 4, 0]}>
                  {rejectData.map((_, i) => (
                    <Cell key={i} fill={colorAt(i)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>

        <Section title="Weekly pass rate" description="Accepted ÷ reviewed by week — watch for drift after SOP changes.">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="weekStart" tickFormatter={shortDate} tick={tickStyle} tickLine={false} />
                <YAxis tick={tickStyle} tickLine={false} width={44} domain={[0, 1]} tickFormatter={(v: number) => pct(v, 0)} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={tooltipItemStyle}
                  labelFormatter={(label) => shortDate(String(label))}
                  formatter={(value) => [pct(Number(value)), 'Pass rate']}
                />
                <Line dataKey="passRate" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} name="Pass rate" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Section>
      </PageGrid>

      <PageGrid>
        <Section title="Rejection breakdown" description="Count and share by reason.">
          <SimpleTable
            rows={d.rejectReasons}
            rowKey={(r) => r.reason}
            columns={[
              { key: 'reason', header: 'Reason', render: (r) => prettify(r.reason) },
              { key: 'count', header: 'Rejects', align: 'right', render: (r) => num(r.count) },
              {
                key: 'share',
                header: 'Share',
                align: 'right',
                render: (r) => {
                  const total = d.rejectReasons.reduce((s, x) => s + x.count, 0)
                  return <span className="inline-flex items-center gap-2 justify-end">{pct(total > 0 ? r.count / total : 0)}</span>
                },
              },
            ]}
          />
        </Section>

        <Section title="Reject reasons share" description="Proportion of rejects in each category.">
          <DonutChart data={rejectData.map((r) => ({ label: r.reason, value: r.count }))} />
        </Section>

        <Section title="Inter-reviewer agreement detail" description="Double-reviewed samples where QA reviewers gave the same verdict.">
          <div className="mb-3">
            <ProgressBar value={d.agreement.rate} />
          </div>
          <MetricRow label="Samples double-reviewed" value={num(d.agreement.samples)} />
          <MetricRow label="Both reviewers accept" value={num(d.agreement.bothAccept)} />
          <MetricRow label="Both reviewers reject" value={num(d.agreement.bothReject)} />
          <MetricRow
            label="Disagreements"
            value={num(d.agreement.samples - d.agreement.agree)}
            tone={d.agreement.samples - d.agreement.agree > d.agreement.samples * 0.15 ? 'warn' : 'default'}
          />
          <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Low agreement means the quality standard itself is ambiguous — tighten definitions before coaching operators.
          </p>
        </Section>
      </PageGrid>
    </div>
  )
}
