import { useState, type FormEvent } from 'react'
import { Input } from '../../../lib/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../lib/shadcn/select'
import { useCreateOperator, useCreateTask, useCreateRobot, useCreateShift } from '../../../hooks/backend/data'
import { Field, FormError } from './fields'

export type FormProps = { onDone: (message: string) => void }

function Submit({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
    >
      {busy ? 'Saving…' : label}
    </button>
  )
}

export function OperatorForm({ onDone }: FormProps) {
  const { trigger, loading } = useCreateOperator()
  const [name, setName] = useState('')
  const [hireDate, setHireDate] = useState('')
  const [hourlyCost, setHourlyCost] = useState('28')
  const [proficiencyDays, setProficiencyDays] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await trigger({
        name,
        hireDate,
        hourlyCost: hourlyCost === '' ? undefined : Number(hourlyCost),
        proficiencyDays: proficiencyDays === '' ? undefined : Number(proficiencyDays),
      }).result
      onDone((res as { message: string }).message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name" htmlFor="op-name">
        <Input id="op-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Maya Torres" required />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hire date" htmlFor="op-hire">
          <Input id="op-hire" type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} required />
        </Field>
        <Field label="Hourly cost ($)" htmlFor="op-cost">
          <Input id="op-cost" type="number" min="1" step="0.5" value={hourlyCost} onChange={(e) => setHourlyCost(e.target.value)} />
        </Field>
      </div>
      <Field label="Proficiency days (optional)" hint="Days until the operator met standard — leave blank if still in training.">
        <Input type="number" min="0" max="365" value={proficiencyDays} onChange={(e) => setProficiencyDays(e.target.value)} />
      </Field>
      <FormError message={error} />
      <Submit busy={loading} label="Add operator" />
    </form>
  )
}

export function TaskForm({ onDone }: FormProps) {
  const { trigger, loading } = useCreateTask()
  const [task, setTask] = useState('')
  const [weeklyTarget, setWeeklyTarget] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await trigger({ task, weeklyTarget: Number(weeklyTarget) }).result
      onDone((res as { message: string }).message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Task" htmlFor="task-name" hint="Use snake_case, e.g. window_cleaning. Existing data uses names like kitchen_reset.">
        <Input id="task-name" value={task} onChange={(e) => setTask(e.target.value)} placeholder="window_cleaning" required />
      </Field>
      <Field label="Weekly target (episodes)" htmlFor="task-target">
        <Input id="task-target" type="number" min="1" step="1" value={weeklyTarget} onChange={(e) => setWeeklyTarget(e.target.value)} placeholder="50" required />
      </Field>
      <FormError message={error} />
      <Submit busy={loading} label="Add task" />
    </form>
  )
}

export function RobotForm({ onDone }: FormProps) {
  const { trigger, loading } = useCreateRobot()
  const [name, setName] = useState('')
  const [costPerHour, setCostPerHour] = useState('15')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await trigger({ name, costPerHour: costPerHour === '' ? undefined : Number(costPerHour) }).result
      onDone((res as { message: string }).message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Robot name" htmlFor="robot-name" hint="Existing robots follow the pattern RB-01 Atlas.">
        <Input id="robot-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="RB-09 Iris" required />
      </Field>
      <Field label="Cost per hour ($)" htmlFor="robot-cost">
        <Input id="robot-cost" type="number" min="0" step="0.5" value={costPerHour} onChange={(e) => setCostPerHour(e.target.value)} />
      </Field>
      <FormError message={error} />
      <Submit busy={loading} label="Add robot" />
    </form>
  )
}

export function ShiftForm({ onDone }: FormProps) {
  const { trigger, loading } = useCreateShift()
  const [day, setDay] = useState('')
  const [shift, setShift] = useState<string>('')
  const [planned, setPlanned] = useState('')
  const [filled, setFilled] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await trigger({ day, shift, plannedOperators: Number(planned), filledOperators: Number(filled) }).result
      onDone((res as { message: string }).message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Day" htmlFor="shift-day">
          <Input id="shift-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        </Field>
        <Field label="Shift" htmlFor="shift-type">
          <Select value={shift} onValueChange={setShift} required>
            <SelectTrigger id="shift-type" className="w-full">
              <SelectValue placeholder="Select shift" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="morning">Morning</SelectItem>
              <SelectItem value="evening">Evening</SelectItem>
              <SelectItem value="overnight">Overnight</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Planned operators" htmlFor="shift-planned">
          <Input id="shift-planned" type="number" min="0" step="1" value={planned} onChange={(e) => setPlanned(e.target.value)} required />
        </Field>
        <Field label="Filled operators" htmlFor="shift-filled">
          <Input id="shift-filled" type="number" min="0" step="1" value={filled} onChange={(e) => setFilled(e.target.value)} required />
        </Field>
      </div>
      <FormError message={error} />
      <Submit busy={loading} label="Add shift" />
    </form>
  )
}
