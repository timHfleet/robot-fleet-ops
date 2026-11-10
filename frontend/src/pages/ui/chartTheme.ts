// Shared Recharts styling: theme-aware colors and common axis/tooltip props.
export const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

export const GOOD = 'hsl(var(--chart-3))'
export const BAD = 'hsl(var(--chart-1))'

export function colorAt(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length] ?? CHART_COLORS[0] ?? 'hsl(var(--chart-1))'
}

export const tickStyle = { fontSize: 12, fill: 'hsl(var(--muted-foreground))' }

export const tooltipStyle = {
  backgroundColor: 'hsl(var(--popover))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  color: 'hsl(var(--popover-foreground))',
  fontSize: 12,
}

export const tooltipItemStyle = { color: 'hsl(var(--popover-foreground))' }
