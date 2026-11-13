// Mirrors the result shapes of the backend metric functions in /backend/metrics.

export type OverviewResult = {
  quality: { passRate: number; reviewed: number; accepted: number }
  throughput: { accepted: number; target: number; goalAttainment: number; perOperatorHour: number }
  uptime: { availability: number; mtbfHours: number; mttrMinutes: number }
  efficiency: { robotUtilization: number; operatorUtilization: number; costPerUsableEpisode: number }
  coverage: { fillRate: number }
  incidents: { ratePer1000RobotHours: number; count: number }
  daily: { day: string; accepted: number; rejected: number }[]
  comparison: {
    current: PeriodKpis
    previous: PeriodKpis | null
    history: PeriodKpis[]
  }
}

/** Value formats used by root-cause rows. */
export type DriverKind = 'rate' | 'count' | 'money' | 'decimal'

/** One piece of a metric change. `impact` is in the metric's own units and all rows sum to the total change. */
export type DriverRow = {
  name: string
  current: number
  previous: number
  impact: number
  /** Ratio rows only: the denominator. 0 means the segment had no activity in that window. */
  currentBase?: number
  previousBase?: number
  /** Only on factor rows that mix units. */
  kind?: DriverKind
}

export type DriverGroup = {
  title: string
  /** What the row values describe, e.g. "rejections" or "pass rate". */
  subject: string
  kind: DriverKind | 'mixed'
  valueLabel: string
  rows: DriverRow[]
}

export type DriversResult = {
  metric: string
  current: { start: string; end: string }
  previous: { start: string; end: string }
  primary: DriverGroup
  breakdowns: DriverGroup[]
  context: { label: string; current: number; previous: number; kind: DriverKind }[]
}

export type ManagementReportResult = {
  generatedAt: string
  days: number
  comparison: OverviewResult['comparison']
  rejectReasons: { reason: string; count: number; share: number }[]
  qaAgreement: number
  robots: { name: string; availability: number; failures: number; downHours: number; mttrMinutes: number }[]
  faults: { faultCode: string; count: number }[]
  incidents: {
    count: number
    nearMiss: number
    bySeverity: { severity: string; count: number }[]
    byRootCause: { cause: string; count: number }[]
    avgResolveMinutes: number
  }
  tasks: { task: string; weeklyTarget: number; target: number; accepted: number; attainment: number }[]
  byShift: { shift: string; planned: number; filled: number; fillRate: number }[]
  team: {
    headcount: number
    exits: number
    attrition: number
    sopAdherence: number
    absenceRate: number
    topOperators: { rank: number; name: string; score: number; accepted: number; passRate: number; perHour: number }[]
  }
  maintenance: { name: string; level: 'high' | 'medium'; action: string }[]
}

/** Headline KPIs for one date window (inclusive start/end), used for period comparisons. */
export type PeriodKpis = {
  start: string
  end: string
  days: number
  passRate: number
  accepted: number
  reviewed: number
  /** Collected but not yet reviewed by QA. */
  pending: number
  target: number
  goalAttainment: number
  availability: number
  scheduledHours: number
  readyHours: number
  operatingHours: number
  robotCollectingHours: number
  failures: number
  mttrMinutes: number
  mtbfHours: number
  robotUtilization: number
  operatorUtilization: number
  paidHours: number
  operatorCollectingHours: number
  laborCost: number
  robotCost: number
  costPerUsableEpisode: number
  fillRate: number
  plannedShifts: number
  filledShifts: number
  incidents: number
  incidentRate: number
}

export type QualityResult = {
  passRate: number
  reviewed: number
  accepted: number
  rejectReasons: { reason: string; count: number }[]
  agreement: { samples: number; agree: number; rate: number; bothAccept: number; bothReject: number }
  trend: { weekStart: string; reviewed: number; accepted: number; passRate: number }[]
}

export type ThroughputResult = {
  accepted: number
  target: number
  goalAttainment: number
  cycleTime: { p50: number; p90: number; avgCollect: number; avgReset: number }
  perOperator: { name: string; paidHours: number; accepted: number; perHour: number }[]
  daily: { day: string; total: number; accepted: number }[]
  cycleTrend: { weekStart: string; p50: number }[]
}

export type UptimeResult = {
  availability: number
  scheduledHours: number
  readyHours: number
  operatingHours: number
  failures: number
  mtbfHours: number
  mttrMinutes: number
  perRobot: {
    name: string
    scheduled: number
    ready: number
    operating: number
    availability: number
    failures: number
    mtbfHours: number
    mttrMinutes: number
  }[]
  faults: { faultCode: string; count: number }[]
  trend: { weekStart: string; availability: number }[]
}

export type EfficiencyResult = {
  robotUtilization: number
  operatorUtilization: number
  resetOverhead: number
  costPerUsableEpisode: number
  laborCost: number
  robotCost: number
  accepted: number
  paidHours: number
  collectingHours: number
  waitingHours: number
  perRobot: { name: string; collectingHours: number; readyHours: number; utilization: number }[]
  robotUtilTrend: { weekStart: string; utilization: number }[]
  resetTrend: { weekStart: string; resetShare: number }[]
}

export type CoverageResult = {
  fillRate: number
  plannedShifts: number
  filledShifts: number
  taskCoverage: { task: string; weeklyTarget: number; target: number; accepted: number; attainment: number }[]
  byShift: { shift: string; planned: number; filled: number; fillRate: number }[]
  diversity: { homes: number; objects: number; lighting: number; accepted: number }
  byHome: { label: string; accepted: number }[]
  byLighting: { label: string; accepted: number }[]
  byObject: { label: string; accepted: number }[]
}

export type IncidentsResult = {
  count: number
  nearMiss: number
  rootCauseKnown: number
  repeatRate: number
  ratePer1000RobotHours: number
  timing: { detectMin: number; respondMin: number; resolveMin: number; totalMin: number }
  bySeverity: { severity: string; count: number }[]
  byRootCause: { cause: string; count: number }[]
  trend: { weekStart: string; count: number; nearMiss: number }[]
}

export type FormOptions = {
  operators: { id: number; name: string; active: boolean }[]
  robots: { id: number; name: string }[]
  tasks: string[]
  homes: string[]
  objects: string[]
  lighting: string[]
}

export type Ticket = {
  id: number
  title: string
  robotName: string
  faultCode: string
  severity: string
  status: string
  assignee: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  recovered: boolean
  downtimeMinutes: number
}

export type TicketsResult = {
  tickets: Ticket[]
  counts: { open: number; inProgress: number; resolved: number }
}

export type LeaderboardEntry = {
  rank: number
  name: string
  score: number
  accepted: number
  paidHours: number
  perHour: number
  passRate: number
  sopRate: number | null
  attendance: number
}

export type OperatorLeaderboardResult = {
  entries: LeaderboardEntry[]
  weights: { output: number; quality: number; sop: number; attendance: number }
  minHours: number
}

export type OperatorsResult = {
  avgProficiencyDays: number
  sopAdherence: number
  audited: number
  passed: number
  attrition: number
  exits: number
  headcount: number
  absenceRate: number
  roster: {
    name: string
    hireDate: string
    exitDate: string | null
    proficiencyDays: number | null
    paidHours: number
    accepted: number
    passRate: number
    sopAudited: number
    sopPassed: number
    absenceRate: number
  }[]
}
