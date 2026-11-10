import { makeHook } from '../../lib/api'
import type { FormOptions } from '../../pages/data/types'

type Created = { id: number; message: string; name?: string; task?: string }
export type SearchKind = 'operator' | 'task' | 'robot' | 'shift' | 'episode' | 'incident'

export const useGetFormOptions = makeHook<Record<string, never>, FormOptions>('data/getFormOptions')
export const useSearchRecords = makeHook<{ kind: SearchKind; query?: string }, unknown[]>('data/searchRecords')

export const useCreateOperator = makeHook<
  { name: string; hireDate: string; exitDate?: string | null; hourlyCost?: number; proficiencyDays?: number | null },
  Created
>('data/createOperator')
export const useCreateRobot = makeHook<{ name: string; costPerHour?: number }, Created>('data/createRobot')
export const useCreateShift = makeHook<
  { day: string; shift: string; plannedOperators: number; filledOperators: number },
  Created
>('data/createShift')
export const useCreateTask = makeHook<{ task: string; weeklyTarget: number }, Created>('data/createTask')
export const useLogEpisode = makeHook<
  {
    operatorId: number
    robotId: number
    task: string
    environmentHome: string
    objectCategory: string
    lighting: string
    startedAt: string
    collectMinutes: number
    resetMinutes: number
    status: string
    rejectionReason?: string | null
  },
  Created
>('data/logEpisode')
export const useLogIncident = makeHook<
  { robotId: number; occurredAt: string; severity: string; isNearMiss?: boolean; rootCause?: string | null },
  Created
>('data/logIncident')
