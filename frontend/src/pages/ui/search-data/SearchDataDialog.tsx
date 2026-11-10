import { useState, useEffect, type FormEvent } from 'react'
import { Search, X } from 'lucide-react'
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
import { Input } from '../../../lib/shadcn/input'
import { useSearchRecords } from '../../../hooks/backend/data'
import { SimpleTable, type Column } from '../SimpleTable'
import { shortDate, minutesLabel, money } from '../format'
import { siteLabel } from '../add-data/LogForms'

type Kind = 'operator' | 'task' | 'robot' | 'shift' | 'episode' | 'incident'

const KINDS: { value: Kind; label: string; placeholder: string }[] = [
  { value: 'operator', label: 'Operators', placeholder: 'Search by operator name…' },
  { value: 'episode', label: 'Episodes', placeholder: 'Search by task, status, site, object or names…' },
  { value: 'task', label: 'Task targets', placeholder: 'Search by task…' },
  { value: 'robot', label: 'Robots', placeholder: 'Search by robot name…' },
  { value: 'shift', label: 'Shifts', placeholder: 'Search by shift name or day…' },
  { value: 'incident', label: 'Incidents', placeholder: 'Search by robot, severity or root cause…' },
]

type OperatorRow = { id: number; name: string; hireDate: string; exitDate: string | null; hourlyCost: number; proficiencyDays: number | null }
type TaskRow = { id: number; task: string; weeklyTarget: number }
type RobotRow = { id: number; name: string; costPerHour: number }
type ShiftRow = { id: number; day: string; shift: string; plannedOperators: number; filledOperators: number }
type EpisodeRow = { id: number; startedAt: string; operatorName: string; robotName: string; task: string; home: string; object: string; lighting: string; status: string; rejectionReason: string | null; collectMinutes: number; resetMinutes: number }
type IncidentRow = { id: number; occurredAt: string; robotName: string; severity: string; nearMiss: boolean; rootCause: string | null }

function columnsFor(kind: Kind): Column<never>[] {
  switch (kind) {
    case 'operator':
      return [
        { key: 'name', header: 'Operator', render: (r: OperatorRow) => r.name },
        { key: 'hire', header: 'Hired', align: 'right', render: (r: OperatorRow) => (r.exitDate ? `${shortDate(r.hireDate)} – ${shortDate(r.exitDate)}` : shortDate(r.hireDate)) },
        { key: 'prof', header: 'Proficiency', align: 'right', render: (r: OperatorRow) => (r.proficiencyDays != null ? `${r.proficiencyDays}d` : '—') },
        { key: 'cost', header: 'Cost/hour', align: 'right', render: (r: OperatorRow) => money(r.hourlyCost) },
      ] as Column<never>[]
    case 'task':
      return [
        { key: 'task', header: 'Task', render: (r: TaskRow) => r.task },
        { key: 'target', header: 'Weekly target', align: 'right', render: (r: TaskRow) => r.weeklyTarget },
      ] as Column<never>[]
    case 'robot':
      return [
        { key: 'name', header: 'Robot', render: (r: RobotRow) => r.name },
        { key: 'cost', header: 'Cost/hour', align: 'right', render: (r: RobotRow) => money(r.costPerHour) },
      ] as Column<never>[]
    case 'shift':
      return [
        { key: 'day', header: 'Day', render: (r: ShiftRow) => shortDate(r.day) },
        { key: 'shift', header: 'Shift', render: (r: ShiftRow) => r.shift },
        { key: 'filled', header: 'Filled / planned', align: 'right', render: (r: ShiftRow) => `${r.filledOperators} / ${r.plannedOperators}` },
      ] as Column<never>[]
    case 'episode':
      return [
        { key: 'when', header: 'Started', render: (r: EpisodeRow) => shortDate(r.startedAt) },
        { key: 'who', header: 'Operator', render: (r: EpisodeRow) => r.operatorName },
        { key: 'robot', header: 'Robot', render: (r: EpisodeRow) => r.robotName },
        { key: 'task', header: 'Task', render: (r: EpisodeRow) => r.task },
        { key: 'site', header: 'Site', render: (r: EpisodeRow) => siteLabel(r.home) },
        { key: 'status', header: 'Status', align: 'right', render: (r: EpisodeRow) => r.status + (r.rejectionReason ? ` (${r.rejectionReason})` : '') },
        { key: 'collect', header: 'Collect', align: 'right', render: (r: EpisodeRow) => minutesLabel(r.collectMinutes) },
        { key: 'reset', header: 'Reset', align: 'right', render: (r: EpisodeRow) => minutesLabel(r.resetMinutes) },
      ] as Column<never>[]
    case 'incident':
      return [
        { key: 'when', header: 'Occurred', render: (r: IncidentRow) => shortDate(r.occurredAt) },
        { key: 'robot', header: 'Robot', render: (r: IncidentRow) => r.robotName },
        { key: 'sev', header: 'Severity', render: (r: IncidentRow) => r.severity },
        { key: 'near', header: 'Near miss', align: 'right', render: (r: IncidentRow) => (r.nearMiss ? 'Yes' : '—') },
        { key: 'cause', header: 'Root cause', render: (r: IncidentRow) => r.rootCause ?? 'Unknown' },
      ] as Column<never>[]
  }
}

export default function SearchDataDialog() {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('operator')
  const [query, setQuery] = useState('')
  const search = useSearchRecords()

  const active = KINDS.find((k) => k.value === kind) ?? KINDS[0]!

  // Fresh list of recent records whenever the dialog opens or the type changes.
  useEffect(() => {
    if (open) search.trigger({ kind, query: '' }, { skipCache: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind])

  async function submit(e: FormEvent) {
    e.preventDefault()
    await search.trigger({ kind, query }, { skipCache: true }).result
  }

  const rows = (search.data ?? []) as unknown[]

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        aria-label="Search data"
      >
        <Search className="h-4 w-4" aria-hidden />
        Search
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Search data</DialogTitle>
            <DialogDescription>
              Look up operators, episodes, tasks, robots, shifts and incidents. Leave the search box empty to list the most recent records.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr_auto]">
              <Select value={kind} onValueChange={(v) => { setKind(v as Kind); setQuery('') }}>
                <SelectTrigger className="w-full" aria-label="Record type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <form onSubmit={submit} className="flex gap-2">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={active.placeholder}
                  aria-label="Search query"
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  aria-label="Run search"
                >
                  <Search className="h-4 w-4" aria-hidden />
                </button>
              </form>
              {query ? (
                <button
                  onClick={() => { setQuery(''); search.trigger({ kind, query: '' }, { skipCache: true }) }}
                  className="flex shrink-0 items-center gap-1 rounded-md border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                  Clear
                </button>
              ) : null}
            </div>

            <div className="min-h-0 overflow-y-auto">
              {search.error ? (
                <p className="text-sm text-destructive">Search failed: {search.error}</p>
              ) : search.loading && !search.data ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Searching…</p>
              ) : (
                <>
                  <SimpleTable columns={columnsFor(kind)} rows={rows as never[]} rowKey={(r) => String((r as { id: number }).id)} />
                  {rows.length >= 50 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Showing the first 50 matches — refine the search to narrow it down.</p>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
