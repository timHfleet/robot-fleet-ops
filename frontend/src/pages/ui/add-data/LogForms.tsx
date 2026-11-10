import { useState, type FormEvent } from 'react'
import { Input } from '../../../lib/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../lib/shadcn/select'
import { Checkbox } from '../../../lib/shadcn/checkbox'
import { useLogEpisode, useLogIncident } from '../../../hooks/backend/data'
import type { FormOptions } from '../../data/types'
import { Field, FormError, nowLocal } from './fields'
import type { FormProps } from './SimpleForms'

type OptionsProps = FormProps & { options: FormOptions | null }

// Display homes as "Site Lab A" while keeping the stored home_A-style values.
export function siteLabel(home: string): string {
  const m = /^home_([A-Za-z0-9]+)$/.exec(home)
  return m && m[1] !== undefined ? `Site Lab ${m[1].toUpperCase()}` : home
}

export function EpisodeForm({ options, onDone }: OptionsProps) {
  const { trigger, loading } = useLogEpisode()
  const [operatorId, setOperatorId] = useState('')
  const [robotId, setRobotId] = useState('')
  const [task, setTask] = useState('')
  const [home, setHome] = useState('')
  const [object, setObject] = useState('')
  const [lighting, setLighting] = useState('')
  const [startedAt, setStartedAt] = useState(nowLocal)
  const [collectMinutes, setCollectMinutes] = useState('')
  const [resetMinutes, setResetMinutes] = useState('')
  const [status, setStatus] = useState('accepted')
  const [rejectionReason, setRejectionReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await trigger({
        operatorId: Number(operatorId),
        robotId: Number(robotId),
        task,
        environmentHome: home,
        objectCategory: object,
        lighting,
        startedAt: new Date(startedAt).toISOString(),
        collectMinutes: Number(collectMinutes),
        resetMinutes: resetMinutes === '' ? 0 : Number(resetMinutes),
        status,
        rejectionReason: status === 'rejected' ? rejectionReason : null,
      }).result
      onDone((res as { message: string }).message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Operator" htmlFor="ep-operator">
          <Select value={operatorId} onValueChange={setOperatorId} required>
            <SelectTrigger id="ep-operator" className="w-full">
              <SelectValue placeholder="Select operator" />
            </SelectTrigger>
            <SelectContent>
              {(options?.operators ?? []).map((o) => (
                <SelectItem key={o.id} value={String(o.id)} disabled={!o.active}>
                  {o.name}{o.active ? '' : ' (exited)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Robot" htmlFor="ep-robot">
          <Select value={robotId} onValueChange={setRobotId} required>
            <SelectTrigger id="ep-robot" className="w-full">
              <SelectValue placeholder="Select robot" />
            </SelectTrigger>
            <SelectContent>
              {(options?.robots ?? []).map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Task" htmlFor="ep-task">
          <Select value={task} onValueChange={setTask} required>
            <SelectTrigger id="ep-task" className="w-full">
              <SelectValue placeholder="Select task" />
            </SelectTrigger>
            <SelectContent>
              {(options?.tasks ?? []).map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Started at" htmlFor="ep-start">
          <Input id="ep-start" type="datetime-local" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} required />
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Site" htmlFor="ep-home">
          <Select value={home} onValueChange={setHome} required>
            <SelectTrigger id="ep-home" className="w-full">
              <SelectValue placeholder="Site" />
            </SelectTrigger>
            <SelectContent>
              {(options?.homes ?? []).map((h) => (
                <SelectItem key={h} value={h}>{siteLabel(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Object" htmlFor="ep-object">
          <Select value={object} onValueChange={setObject} required>
            <SelectTrigger id="ep-object" className="w-full">
              <SelectValue placeholder="Object" />
            </SelectTrigger>
            <SelectContent>
              {(options?.objects ?? []).map((o) => (
                <SelectItem key={o} value={o}>{o}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Lighting" htmlFor="ep-light">
          <Select value={lighting} onValueChange={setLighting} required>
            <SelectTrigger id="ep-light" className="w-full">
              <SelectValue placeholder="Lighting" />
            </SelectTrigger>
            <SelectContent>
              {(options?.lighting ?? []).map((l) => (
                <SelectItem key={l} value={l}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Collect (min)" htmlFor="ep-collect">
          <Input id="ep-collect" type="number" min="0" step="0.1" value={collectMinutes} onChange={(e) => setCollectMinutes(e.target.value)} required />
        </Field>
        <Field label="Reset (min)" htmlFor="ep-reset">
          <Input id="ep-reset" type="number" min="0" step="0.1" value={resetMinutes} onChange={(e) => setResetMinutes(e.target.value)} />
        </Field>
        <Field label="Status" htmlFor="ep-status">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="ep-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {status === 'rejected' ? (
        <Field label="Rejection reason" htmlFor="ep-reject">
          <Select value={rejectionReason} onValueChange={setRejectionReason} required>
            <SelectTrigger id="ep-reject" className="w-full">
              <SelectValue placeholder="Select reason" />
            </SelectTrigger>
            <SelectContent>
              {['robot_fault', 'grasp_failure', 'occlusion', 'sop_deviation', 'scene_drift', 'drop'].map((r) => (
                <SelectItem key={r} value={r}>{r}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <FormError message={error} />
      <Submit busy={loading} label="Log episode" />
    </form>
  )
}

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

export function IncidentForm({ options, onDone }: OptionsProps) {
  const { trigger, loading } = useLogIncident()
  const [robotId, setRobotId] = useState('')
  const [occurredAt, setOccurredAt] = useState(nowLocal)
  const [severity, setSeverity] = useState('minor')
  const [nearMiss, setNearMiss] = useState(false)
  const [rootCause, setRootCause] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const res = await trigger({
        robotId: Number(robotId),
        occurredAt: new Date(occurredAt).toISOString(),
        severity,
        isNearMiss: nearMiss,
        rootCause: rootCause === '' ? null : rootCause,
      }).result
      onDone((res as { message: string }).message)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Robot" htmlFor="inc-robot">
          <Select value={robotId} onValueChange={setRobotId} required>
            <SelectTrigger id="inc-robot" className="w-full">
              <SelectValue placeholder="Select robot" />
            </SelectTrigger>
            <SelectContent>
              {(options?.robots ?? []).map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Occurred at" htmlFor="inc-time">
          <Input id="inc-time" type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} required />
        </Field>
      </div>
      <Field label="Severity" htmlFor="inc-sev">
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger id="inc-sev" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minor">Minor</SelectItem>
            <SelectItem value="major">Major</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Root cause (optional)" hint="Leave blank if the cause is not yet known.">
        <Select value={rootCause} onValueChange={setRootCause}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Not known yet" />
          </SelectTrigger>
          <SelectContent>
            {['path collision', 'network loss', 'sensor miscalibration', 'power fault', 'human error', 'gripper jam'].map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={nearMiss} onCheckedChange={(v) => setNearMiss(v === true)} />
        Near miss (no damage or injury)
      </label>
      <FormError message={error} />
      <Submit busy={loading} label="Log incident" />
    </form>
  )
}
