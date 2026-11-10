import { useState, useEffect, useRef } from 'react'
import { CheckCircle2, ClipboardList, Bot, Users, CalendarPlus, Play, Siren, Plus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../lib/shadcn/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../lib/shadcn/select'
import { useGetFormOptions } from '../../../hooks/backend/data'
import type { FormOptions } from '../../data/types'
import { OperatorForm, TaskForm, RobotForm, ShiftForm } from './SimpleForms'
import { EpisodeForm, IncidentForm } from './LogForms'

type Kind = 'operator' | 'task' | 'robot' | 'shift' | 'episode' | 'incident'

const KINDS: { value: Kind; label: string; desc: string; icon: typeof Users }[] = [
  { value: 'operator', label: 'Operator', desc: 'Add someone to the roster', icon: Users },
  { value: 'episode', label: 'Episode', desc: 'Log a data-collection session', icon: Play },
  { value: 'task', label: 'Task target', desc: 'New task with a weekly goal', icon: ClipboardList },
  { value: 'robot', label: 'Robot', desc: 'Add a robot to the fleet', icon: Bot },
  { value: 'shift', label: 'Shift', desc: 'Plan a day\'s staffing', icon: CalendarPlus },
  { value: 'incident', label: 'Incident', desc: 'Record a safety event', icon: Siren },
]

export default function AddDataDialog() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('operator')
  const [success, setSuccess] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const formOptions = useGetFormOptions()
  const optionsRef = useRef<FormOptions | null>(null)
  if (formOptions.data) optionsRef.current = formOptions.data as FormOptions

  // Load dropdown options each time the dialog opens (fresh, no cache).
  useEffect(() => {
    if (open) {
      formOptions.trigger({}, { skipCache: true })
      setSuccess(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function onDone(message: string) {
    setSuccess(message)
    setFormKey((k) => k + 1) // remount the form so it starts blank for the next entry
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add data
      </button>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSuccess(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add data</DialogTitle>
            <DialogDescription>
              Pick what to add, fill in the details, and save. The form stays open so you can enter several records in a row.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setSuccess(null) }}>
              <SelectTrigger className="w-full" aria-label="Record type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label} — {k.desc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {success ? (
              <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span>{success}</span>
              </div>
            ) : null}

            {formOptions.error && (kind === 'episode' || kind === 'incident') ? (
              <p className="text-xs text-destructive">Failed to load dropdown options: {formOptions.error}</p>
            ) : null}

            <div key={`${kind}-${formKey}`}>
              {kind === 'operator' && <OperatorForm onDone={onDone} />}
              {kind === 'task' && <TaskForm onDone={onDone} />}
              {kind === 'robot' && <RobotForm onDone={onDone} />}
              {kind === 'shift' && <ShiftForm onDone={onDone} />}
              {kind === 'episode' && <EpisodeForm options={optionsRef.current} onDone={onDone} />}
              {kind === 'incident' && <IncidentForm options={optionsRef.current} onDone={onDone} />}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
