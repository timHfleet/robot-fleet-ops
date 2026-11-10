import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { colorAt, tooltipStyle, tooltipItemStyle } from './chartTheme'

export type PieSlice = { label: string; value: number }

export function DonutChart({ data, heightClass = 'h-64' }: { data: PieSlice[]; heightClass?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  const chartData = data.map((d) => ({
    name: `${d.label} · ${total > 0 ? Math.round((d.value / total) * 100) : 0}%`,
    value: d.value,
  }))

  return (
    <div className={heightClass}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {chartData.map((_, i) => (
              <Cell key={i} fill={colorAt(i)} />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} />
          <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
