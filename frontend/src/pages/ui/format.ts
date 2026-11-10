// Formatting helpers shared by the metric pages.

export function pct(x: number | null | undefined, digits = 1): string {
  if (x == null || !isFinite(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

export function num(x: number | null | undefined, digits = 0): string {
  if (x == null || !isFinite(x)) return '—'
  return x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

export function money(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return '—'
  return `$${x.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function hoursLabel(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return '—'
  return `${num(x, 1)}h`
}

export function minutesLabel(x: number | null | undefined): string {
  if (x == null || !isFinite(x)) return '—'
  return `${num(x, 0)}m`
}

export function prettify(key: string): string {
  const connectors = new Set(['and', 'or', 'of', 'the', 'to'])
  return key
    .split('_')
    .map((w, i) => {
      const cap = w.charAt(0).toUpperCase() + w.slice(1)
      // Keep connector words lowercase except at the start.
      return i > 0 && connectors.has(w.toLowerCase()) ? w.toLowerCase() : cap
    })
    .join(' ')
}
