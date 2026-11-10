import { makeHook } from '../../lib/api'
import type {
  CoverageResult,
  EfficiencyResult,
  IncidentsResult,
  OperatorLeaderboardResult,
  OperatorsResult,
  OverviewResult,
  QualityResult,
  ThroughputResult,
  UptimeResult,
} from '../../pages/data/types'

type Days = { days?: number }

export const useOverview = makeHook<Days, OverviewResult>('metrics/overview')
export const useQuality = makeHook<Days, QualityResult>('metrics/quality')
export const useThroughput = makeHook<Days, ThroughputResult>('metrics/throughput')
export const useUptime = makeHook<Days, UptimeResult>('metrics/uptime')
export const useEfficiency = makeHook<Days, EfficiencyResult>('metrics/efficiency')
export const useCoverage = makeHook<Days, CoverageResult>('metrics/coverage')
export const useIncidents = makeHook<Days, IncidentsResult>('metrics/incidents')
export const useOperators = makeHook<Days, OperatorsResult>('metrics/operators')
export const useOperatorLeaderboard = makeHook<Days, OperatorLeaderboardResult>('metrics/operatorLeaderboard')
