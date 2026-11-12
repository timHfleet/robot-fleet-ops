// Plain-language explanations for the dashboard's headline metrics, plus the
// formatting rules used to compare one period with another.
import type { PeriodKpis } from '../data/types'
import { num, pct } from './format'

export type MetricKey =
  | 'passRate'
  | 'accepted'
  | 'availability'
  | 'robotUtilization'
  | 'operatorUtilization'
  | 'costPerUsableEpisode'
  | 'fillRate'
  | 'incidentRate'

type Kind = 'rate' | 'count' | 'money' | 'perK'

export type MetricInfo = {
  label: string
  kind: Kind
  /** true when a bigger number is better. */
  higherIsBetter: boolean
  /** What the number means, in one or two sentences. */
  what: string
  /** The formula, filled in with this period's actual inputs. */
  formula: (k: PeriodKpis) => string
  /** What "good" looks like. */
  benchmark: string
  /** What to do when it moves the wrong way. */
  ifWorse: string
  /** Depends on QA verdicts, so the newest days look low until review catches up. */
  awaitsReview?: boolean
}

export const METRIC_INFO: Record<MetricKey, MetricInfo> = {
  passRate: {
    label: 'QA pass rate',
    kind: 'rate',
    higherIsBetter: true,
    what:
      'The share of reviewed episodes that QA accepted as usable training data. It tells you how much of the collection effort actually turns into data researchers can use.',
    formula: (k) => `${num(k.accepted)} accepted ÷ ${num(k.reviewed)} reviewed = ${pct(k.passRate)}`,
    benchmark: '85% or higher is healthy; 70–85% needs attention; under 70% means a lot of wasted collection time.',
    ifWorse:
      'Open the Quality page and check the top rejection reasons. Grasp failures and SOP deviations usually point to operator coaching or an unclear SOP; robot faults point to maintenance.',
  },
  accepted: {
    label: 'Usable episodes',
    kind: 'count',
    higherIsBetter: true,
    awaitsReview: true,
    what:
      'The number of episodes that passed QA in the period — the actual output the fleet delivers. Goal attainment compares it with the prorated weekly targets for every task.',
    formula: (k) =>
      `${num(k.accepted)} accepted ÷ ${num(k.target)} target = ${pct(k.goalAttainment)} goal attainment`,
    benchmark: '90%+ of target is on track; 70–90% is behind; under 70% puts research timelines at risk.',
    ifWorse:
      'Check whether the drop comes from fewer episodes collected (staffing, robot downtime) or more rejections (quality). Throughput and Coverage show which tasks are lagging.',
  },
  availability: {
    label: 'Fleet availability',
    kind: 'rate',
    higherIsBetter: true,
    what:
      'The share of scheduled robot hours when robots were actually ready to work, i.e. not down for faults, repairs or charging problems.',
    formula: (k) =>
      `${num(k.readyHours, 0)} ready hours ÷ ${num(k.scheduledHours, 0)} scheduled hours = ${pct(k.availability)} · ${num(k.failures)} failures, MTBF ${num(k.mtbfHours, 1)}h, MTTR ${num(k.mttrMinutes, 0)}m`,
    benchmark: '90%+ is healthy; 80–90% means failures or slow repairs are eating capacity; under 80% is a fleet problem.',
    ifWorse:
      'Look at Uptime and Maintenance Alerts for the robots with the most failures or longest repairs. Falling MTBF means things break more often; rising MTTR means repairs take longer.',
  },
  robotUtilization: {
    label: 'Robot utilization',
    kind: 'rate',
    higherIsBetter: true,
    what:
      'Of the hours robots were ready, the share spent actually collecting episodes. The rest is idle time — waiting for an operator, resets, setup.',
    formula: (k) =>
      `${num(k.robotCollectingHours, 0)} collecting hours ÷ ${num(k.readyHours, 0)} ready hours = ${pct(k.robotUtilization)}`,
    benchmark: '60%+ is good for teleoperated collection; below that, robots are sitting idle while available.',
    ifWorse:
      'Check Efficiency for the least-used robots. Low utilization usually means unfilled shifts, long resets between episodes, or robots without an operator assigned.',
  },
  operatorUtilization: {
    label: 'Operator utilization',
    kind: 'rate',
    higherIsBetter: true,
    what:
      'Of the hours operators were paid for, the share spent actually collecting. The rest goes to resets, waiting on robots, breaks and admin.',
    formula: (k) =>
      `${num(k.operatorCollectingHours, 0)} collecting hours ÷ ${num(k.paidHours, 0)} paid hours = ${pct(k.operatorUtilization)}`,
    benchmark: '60%+ is good; 50–60% is typical when robots are often down or resets are slow.',
    ifWorse:
      'Compare waiting time with reset time on the Efficiency page. Waiting points to robot downtime; long resets point to scene setup or the SOP.',
  },
  costPerUsableEpisode: {
    label: 'Cost per usable episode',
    kind: 'money',
    higherIsBetter: false,
    awaitsReview: true,
    what:
      'What one accepted episode costs once operator labor and robot time are both included. It is the clearest single number for collection efficiency.',
    formula: (k) =>
      `(${money(k.laborCost)} labor + ${money(k.robotCost)} robot) ÷ ${num(k.accepted)} accepted = ${money(k.costPerUsableEpisode)}`,
    benchmark: 'Lower is better. Watch the trend more than the level: it rises whenever pass rate or utilization falls.',
    ifWorse:
      'A rise almost always comes from a lower pass rate (paying for rejected episodes) or lower utilization (paying for idle time). Check those two first.',
  },
  fillRate: {
    label: 'Shift fill rate',
    kind: 'rate',
    higherIsBetter: true,
    what: 'The share of planned operator slots that were actually staffed.',
    formula: (k) =>
      `${num(k.filledShifts)} filled ÷ ${num(k.plannedShifts)} planned operator slots = ${pct(k.fillRate)}`,
    benchmark: '90%+ is healthy; below that, robots sit idle for lack of operators.',
    ifWorse: 'See Coverage for which shift is short (often overnight), then adjust hiring or scheduling.',
  },
  incidentRate: {
    label: 'Incident rate',
    kind: 'perK',
    higherIsBetter: false,
    what:
      'Safety and operational incidents per 1,000 robot operating hours. Normalizing by hours makes busy and quiet periods comparable.',
    formula: (k) =>
      `${num(k.incidents)} incidents ÷ ${num(k.operatingHours, 0)} operating hours × 1,000 = ${num(k.incidentRate, 1)}`,
    benchmark: '5 or fewer per 1,000 hours is the target here. Any upward trend deserves a look.',
    ifWorse: 'Open Incidents to see root causes and severity. Repeated causes should trigger a safety review.',
  },
}

export type Status = 'on' | 'watch' | 'off'

export const STATUS_LABEL: Record<Status, string> = { on: 'On track', watch: 'Watch', off: 'Off track' }

/** Short target text for the management scorecard. */
export const TARGET_LABEL: Record<MetricKey, string> = {
  passRate: '≥ 85%',
  accepted: '≥ 90% of target',
  availability: '≥ 90%',
  robotUtilization: '≥ 60%',
  operatorUtilization: '≥ 60%',
  costPerUsableEpisode: '≤ 12-wk avg',
  fillRate: '≥ 90%',
  incidentRate: '≤ 5.0',
}

/** Same thresholds the dashboard cards use to color their numbers. */
export function status(key: MetricKey, k: PeriodKpis, history: PeriodKpis[]): Status {
  const band = (v: number, on: number, watch: number) => (v >= on ? 'on' : v >= watch ? 'watch' : 'off')
  switch (key) {
    case 'passRate':
      return band(k.passRate, 0.85, 0.7)
    case 'accepted':
      return band(k.goalAttainment, 0.9, 0.7)
    case 'availability':
      return band(k.availability, 0.9, 0.8)
    case 'robotUtilization':
      return band(k.robotUtilization, 0.6, 0.5)
    case 'operatorUtilization':
      return band(k.operatorUtilization, 0.6, 0.5)
    case 'fillRate':
      return band(k.fillRate, 0.9, 0.8)
    case 'incidentRate':
      return k.incidentRate <= 5 ? 'on' : k.incidentRate <= 8 ? 'watch' : 'off'
    case 'costPerUsableEpisode': {
      const vals = history.map((h) => h.costPerUsableEpisode).filter((v) => v > 0)
      if (!vals.length) return 'on'
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      return k.costPerUsableEpisode <= avg * 1.05 ? 'on' : k.costPerUsableEpisode <= avg * 1.15 ? 'watch' : 'off'
    }
  }
}

function money(v: number): string {
  return formatValue('money', v)
}

export function formatValue(kind: Kind, v: number): string {
  switch (kind) {
    case 'rate':
      return pct(v)
    case 'count':
      return num(v)
    case 'money':
      return isFinite(v) ? `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
    case 'perK':
      return num(v, 1)
  }
}

export type Change = {
  /** e.g. "+1.2 pts", "−4.0%", "+$1.05" */
  text: string
  /** good / bad / flat, from the metric's preferred direction */
  tone: 'good' | 'bad' | 'flat'
  direction: 'up' | 'down' | 'flat'
}

/** How `cur` compares with `prev` for a given metric. */
export function compare(key: MetricKey, cur: number, prev: number): Change {
  const info = METRIC_INFO[key]
  const diff = cur - prev
  let text: string
  let flat: boolean
  if (info.kind === 'rate') {
    const pts = diff * 100
    flat = Math.abs(pts) < 0.05
    text = `${sign(pts)}${Math.abs(pts).toFixed(1)} pts`
  } else if (info.kind === 'money') {
    flat = Math.abs(diff) < 0.005
    text = `${sign(diff)}$${Math.abs(diff).toFixed(2)}`
  } else if (info.kind === 'perK') {
    flat = Math.abs(diff) < 0.05
    text = `${sign(diff)}${Math.abs(diff).toFixed(1)}`
  } else {
    const rel = prev ? (diff / prev) * 100 : 0
    flat = diff === 0
    text = `${sign(diff)}${num(Math.abs(diff))} (${sign(rel)}${Math.abs(rel).toFixed(1)}%)`
  }
  if (flat) return { text: 'No change', tone: 'flat', direction: 'flat' }
  const better = info.higherIsBetter ? diff > 0 : diff < 0
  return { text, tone: better ? 'good' : 'bad', direction: diff > 0 ? 'up' : 'down' }
}

function sign(x: number): string {
  return x > 0 ? '+' : x < 0 ? '−' : ''
}

export function rangeLabel(k: PeriodKpis): string {
  const fmt = (s: string) =>
    new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  return `${fmt(k.start)} – ${fmt(k.end)}`
}
