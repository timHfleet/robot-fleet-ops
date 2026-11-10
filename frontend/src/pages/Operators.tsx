import { useEffect } from 'react'
import { GraduationCap, ClipboardCheck, UserMinus, CalendarX } from 'lucide-react'
import { useOperators, useOperatorLeaderboard } from '../hooks/backend/metrics'
import type { OperatorsResult } from './data/types'
import { MetricCard } from './ui/MetricCard'
import { Section, PageGrid, Loading, ErrorBox } from './ui/Section'
import { SimpleTable } from './ui/SimpleTable'
import { Leaderboard } from './ui/Leaderboard'
import { useDaysRange } from './ui/range'
import { pct, num, shortDate } from './ui/format'

export default function Operators() {
  const { data, loading, error, trigger } = useOperators({ cachePolicy: 'stale-while-revalidate' })
  const board = useOperatorLeaderboard({ cachePolicy: 'stale-while-revalidate' })
  const days = useDaysRange(trigger)

  useEffect(() => {
    board.trigger({ days })
  }, [days, board.trigger])

  if (error) return <ErrorBox message={`Failed to load operator metrics: ${error}`} />
  if (loading && !data) return <Loading />
  const d = (data ?? null) as OperatorsResult | null
  if (!d) return <Loading />

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard
          label="Time to proficiency"
          value={`${num(d.avgProficiencyDays, 0)} days`}
          sub="Average days until a new operator meets standard"
          icon={GraduationCap}
        />
        <MetricCard
          label="SOP adherence"
          value={pct(d.sopAdherence)}
          sub={`${num(d.passed)} of ${num(d.audited)} audited sessions pass`}
          icon={ClipboardCheck}
          tone={d.sopAdherence >= 0.8 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Attrition"
          value={pct(d.attrition)}
          sub={`${num(d.exits)} exits of ${num(d.headcount)} in period`}
          icon={UserMinus}
          tone={d.attrition <= 0.1 ? 'good' : 'warn'}
        />
        <MetricCard
          label="Absence rate"
          value={pct(d.absenceRate)}
          sub="Scheduled days missed — catch burnout early"
          icon={CalendarX}
          tone={d.absenceRate <= 0.1 ? 'good' : 'warn'}
        />
      </div>

      <Section
        title="Operator leaderboard"
        description={`Top performers for the last ${days} days, ranked by a composite of output, quality and reliability.`}
      >
        <Leaderboard
          entries={board.data?.entries ?? []}
          weights={board.data?.weights ?? { output: 0.4, quality: 0.25, sop: 0.2, attendance: 0.15 }}
          minHours={board.data?.minHours ?? 8}
        />
        {board.error ? <p className="mt-2 text-xs text-destructive">Failed to load leaderboard: {board.error}</p> : null}
      </Section>

      <PageGrid>
        <Section
          title="Operator roster"
          description={`Output, quality and adherence per operator for the last ${days} days.`}
        >
          <SimpleTable
            rows={d.roster}
            rowKey={(r) => r.name}
            columns={[
              { key: 'name', header: 'Operator', render: (r) => r.name },
              {
                key: 'hire',
                header: 'Hired',
                align: 'right',
                render: (r) => (r.exitDate ? `${shortDate(r.hireDate)} – ${shortDate(r.exitDate)}` : shortDate(r.hireDate)),
              },
              { key: 'prof', header: 'Proficiency', align: 'right', render: (r) => (r.proficiencyDays != null ? `${r.proficiencyDays}d` : '—') },
              { key: 'accepted', header: 'Accepted', align: 'right', render: (r) => num(r.accepted) },
              { key: 'pass', header: 'QA pass', align: 'right', render: (r) => pct(r.passRate) },
              { key: 'sop', header: 'SOP', align: 'right', render: (r) => (r.sopAudited > 0 ? `${r.sopPassed}/${r.sopAudited}` : '—') },
              { key: 'abs', header: 'Absence', align: 'right', render: (r) => pct(r.absenceRate) },
            ]}
          />
        </Section>

        <Section title="Reading this page" description="What each metric drives.">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Time to proficiency</span> — long ramps push training improvements; compare
              cohorts hired at different times.
            </li>
            <li>
              <span className="font-medium text-foreground">SOP adherence</span> — failures mean fix the training or the procedure itself;
              audit more sessions where rates are unclear.
            </li>
            <li>
              <span className="font-medium text-foreground">Attrition & absence</span> — rising together usually indicates burnout; check
              scheduling load before hiring replacements.
            </li>
            <li>
              <span className="font-medium text-foreground">QA pass by operator</span> — persistent outliers get coaching, not just more
              reviews.
            </li>
          </ul>
        </Section>
      </PageGrid>
    </div>
  )
}
