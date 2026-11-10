import { makeHook } from '../../lib/api'
import type { CapacityResult, MaintenanceResult, ShiftHandoffResult, ShiftName } from '../../pages/data/opsTypes'

type None = Record<string, never>

export const useMaintenance = makeHook<None, MaintenanceResult>('ops/maintenance')
export const useShiftHandoff = makeHook<{ day?: string; shift?: ShiftName }, ShiftHandoffResult>('ops/shiftHandoff')
export const useCapacity = makeHook<None, CapacityResult>('ops/capacity')
