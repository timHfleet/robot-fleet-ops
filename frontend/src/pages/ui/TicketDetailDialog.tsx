import { Wrench, Search, ClipboardList, History } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../lib/shadcn/dialog'
import { Button } from '../../lib/shadcn/button'
import { Badge } from '../../lib/shadcn/badge'
import type { Ticket } from '../data/types'
import { prettify, shortDate, minutesLabel } from './format'
import { cn } from '../../lib/shadcn/utils'

// Pseudo diagnostics — plausible detail content per fault code, not live data.
const FAULT_INFO: Record<string, { likelyCause: string; checkFirst: string; action: string }> = {
  e_stop: {
    likelyCause: 'Emergency stop latched during an episode reset',
    checkFirst: 'E-stop button latches and the safety-relay circuit',
    action: 'Release e-stop, reset the safety relay, then re-run the startup checklist before returning the bot to collection.',
  },
  motor_fault: {
    likelyCause: 'Drive motor over-current or thermal trip',
    checkFirst: 'Motor temperature and current-draw logs around the failure window',
    action: 'Let the drive cool for 30 minutes, inspect the drivetrain for debris, and replace brushes if wear exceeds spec.',
  },
  network_drop: {
    likelyCause: 'Radio handoff failure between coverage zones',
    checkFirst: 'AP signal strength at the failure location',
    action: 'Re-provision the robot radio and verify AP firmware in the affected zone.',
  },
  gripper_jam: {
    likelyCause: 'Object wedged between the gripper jaws',
    checkFirst: 'Jaw actuator current trace and the on-board camera feed',
    action: 'Clear the jam, then recalibrate the gripper opening width for the object category.',
  },
  sensor_drift: {
    likelyCause: 'Depth-sensor calibration drift out of tolerance',
    checkFirst: 'Extrinsic calibration deltas against the last known baseline',
    action: 'Re-run the calibration routine; replace the sensor if drift exceeds 2 cm.',
  },
  battery_low: {
    likelyCause: 'Pack voltage dipped below the operating threshold mid-episode',
    checkFirst: 'Cell voltages and completed charge-cycle count',
    action: 'Swap the battery pack; schedule cell replacement if the pack is past 800 cycles.',
  },
}

const FALLBACK_INFO = {
  likelyCause: 'Unclassified hardware or software fault during collection',
  checkFirst: 'On-board error logs for the failure window',
  action: 'Pull diagnostics from the bot, reproduce the fault on the bench, and escalate to engineering if it repeats.',
}

export function TicketDetailDialog({
  ticket,
  busy,
  onConfirm,
  onOpenChange,
}: {
  ticket: Ticket | null
  busy: boolean
  onConfirm: (id: number) => void
  onOpenChange: (open: boolean) => void
}) {
  if (!ticket) return null
  const info = FAULT_INFO[ticket.faultCode] ?? FALLBACK_INFO
  // Deterministic pseudo values derived from the ticket id so they stay stable per ticket.
  const queuePos = (ticket.id % 7) + 1
  const similarCount = (ticket.id % 4) + 1
  const reportedBy = ['Auto-ticket (fleet monitor)', 'Ops supervisor (night shift)', 'Auto-ticket (health check)'][ticket.id % 3] ?? 'Auto-ticket (fleet monitor)'

  const timeline = [
    { label: 'Bot went down', at: shortDate(ticket.createdAt) },
    { label: 'Ticket opened', at: shortDate(ticket.createdAt), by: reportedBy },
    { label: 'Robot recovered', at: ticket.recovered ? shortDate(ticket.updatedAt) : 'not yet' },
    { label: 'Ticket closed', at: ticket.status === 'resolved' ? shortDate(ticket.updatedAt) : 'pending' },
  ]

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <span className="truncate">#{ticket.id} {ticket.title}</span>
            <Badge className="border-transparent text-[10px]">{prettify(ticket.severity)}</Badge>
            <Badge className="border-transparent text-[10px]">{prettify(ticket.status)}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <span className="text-muted-foreground">Robot</span>
            <span>{ticket.robotName}</span>
            <span className="text-muted-foreground">Fault code</span>
            <span className="font-mono text-xs">{ticket.faultCode}</span>
            <span className="text-muted-foreground">Total downtime</span>
            <span className="tabular-nums">{minutesLabel(ticket.downtimeMinutes)}</span>
            <span className="text-muted-foreground">Assignee</span>
            <span>{ticket.assignee ?? 'Unassigned'}</span>
            <span className="text-muted-foreground">Reported by</span>
            <span>{reportedBy}</span>
            <span className="text-muted-foreground">Priority queue</span>
            <span className="tabular-nums">#{queuePos} of {queuePos + similarCount}</span>
          </div>

          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
              <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Timeline
            </h4>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {timeline.map((step) => (
                <li key={step.label} className="flex justify-between gap-3">
                  <span>{step.label}</span>
                  <span className="tabular-nums">{step.at}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-border p-3">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Wrench className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Suggested diagnostics
            </h4>
            <dl className="space-y-2 text-xs">
              <div className="flex gap-2">
                <Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="font-medium">Likely cause</dt>
                  <dd className="text-muted-foreground">{info.likelyCause}</dd>
                </div>
              </div>
              <div className="flex gap-2">
                <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="font-medium">Check first</dt>
                  <dd className="text-muted-foreground">{info.checkFirst}</dd>
                </div>
              </div>
              <div>
                <dt className="font-medium">Recommended action</dt>
                <dd className="text-muted-foreground">{info.action}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              Indicative guidance generated for this ticket — verify against on-board logs.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            {similarCount} similar {ticket.faultCode.replace(/_/g, ' ')} events on {ticket.robotName} in the last 90 days.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className={cn('bg-primary hover:bg-primary/90')} disabled={busy} onClick={() => onConfirm(ticket.id)}>
            Confirm reopen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
