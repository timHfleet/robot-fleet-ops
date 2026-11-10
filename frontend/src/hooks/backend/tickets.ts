import { makeHook } from '../../lib/api'
import type { TicketsResult } from '../../pages/data/types'

type TicketStatus = 'open' | 'in_progress' | 'resolved'

export const useGetTickets = makeHook<{ days?: number; status?: TicketStatus }, TicketsResult>('tickets/getTickets')
export const useUpdateTicket = makeHook<
  { id: number; status?: TicketStatus; assignee?: string; notes?: string },
  TicketsResult
>('tickets/updateTicket')
