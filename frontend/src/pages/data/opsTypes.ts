// Shapes returned by backend/app/ops.py.

export type RiskLevel = 'high' | 'medium' | 'low'

export type RobotRisk = {
  id: number
  name: string
  score: number
  level: RiskLevel
  action: string
  reasons: string[]
  downNow: boolean
  failuresRecent: number
  failuresBaselineWeekly: number
  mttrRecent: number
  mttrBaseline: number
  availabilityRecent: number
  availabilityBaseline: number
  topFault: string | null
  weeklyFailures: { weekStart: string; failures: number }[]
}

export type MaintenanceResult = {
  robots: RobotRisk[]
  counts: Record<RiskLevel, number>
  downNow: number
  windowDays: number
  baselineDays: number
}

export type ShiftName = 'morning' | 'evening' | 'overnight'

export type ShiftHandoffResult = {
  day: string
  shift: ShiftName
  start: string
  end: string
  inProgress: boolean
  staffing: { planned: number; filled: number }
  episodes: {
    collected: number
    accepted: number
    rejected: number
    pending: number
    target: number
    attainment: number
    passRate: number | null
  }
  byTask: { task: string; collected: number; accepted: number }[]
  topRejects: { reason: string; count: number }[]
  operators: { name: string; collected: number; accepted: number; passRate: number | null }[]
  failures: { robot: string; faultCode: string; failedAt: string; recovered: boolean; downtimeMinutes: number }[]
  robotsDown: { robot: string; faultCode: string; since: string; minutesDown: number }[]
  incidents: { robot: string; severity: string; nearMiss: boolean; rootCause: string | null; occurredAt: string; resolved: boolean }[]
  openTickets: number
  watchlist: { name: string; level: RiskLevel; action: string; reasons: string[] }[]
  highlights: string[]
}

export type CapacityResult = {
  robots: { id: number; name: string; weeklyAccepted: number; availability: number; risk: RiskLevel; downNow: boolean }[]
  weeklyTarget: number
  weeklyCapacity: number
  basisDays: number
}
