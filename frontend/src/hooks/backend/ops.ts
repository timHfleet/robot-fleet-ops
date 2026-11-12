import { makeHook } from '../../lib/api'
import type { CapacityResult, MaintenanceResult, ShiftHandoffResult, ShiftName } from '../../pages/data/opsTypes'
import type { ManagementReportResult } from '../../pages/data/types'

type None = Record<string, never>

export const useMaintenance = makeHook<None, MaintenanceResult>('ops/maintenance')
export const useShiftHandoff = makeHook<{ day?: string; shift?: ShiftName }, ShiftHandoffResult>('ops/shiftHandoff')
export const useCapacity = makeHook<None, CapacityResult>('ops/capacity')
export const useManagementReport = makeHook<{ days?: number }, ManagementReportResult>('ops/managementReport')
