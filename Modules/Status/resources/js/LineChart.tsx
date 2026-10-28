import { useState, type PointerEvent } from 'react'

export interface ChartPoint {
  /** Seconds since the epoch. */
  time: number
  /** One value per series, in the series' order. */
  values: number[]
}

export interface LineChartProps {
  title: string
  /** The series names, at most three: they take the chart colours in this order. */
  series: string[]
  points: ChartPoint[]
  /** How a value reads on the axis, in the legend and in the tooltip. */
  format?: (value: number) => string
  width?: number
  height?: number
}

const PAD = { top: 31, right: 10, bottom: 18, left: 34 }

/**
 * One chart of the Monitor page, drawn as phpMyAdmin's jqPlot charts are: the title above a
 * grey plot with a light grid, time ticks under it and value ticks beside it, the legend
 * below with each series' latest value. Hovering the plot draws a crosshair at the nearest
 * sample and a tooltip listing every series there.
 */
export default function LineChart({ title, series, points, format = String, width = 364, height = 200 }: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const plotWidth = width - PAD.left - PAD.right
  const plotHeight = height - PAD.top - PAD.bottom
  const first = points[0]?.time ?? 0
  const last = points[points.length - 1]?.time ?? 1
  const span = Math.max(last - first, 1)
  const ticks = niceTicks(Math.max(0, ...points.flatMap((p) => p.values)))
  const top = ticks[ticks.length - 1]
  const x = (time: number) => PAD.left + ((time - first) / span) * plotWidth
  const y = (value: number) => PAD.top + plotHeight - (value / top) * plotHeight
  const timeTicks = points.length < 2 ? [] : [0, 0.25, 0.5, 0.75, 1].map((f) => first + f * span)
  const latest = points[points.length - 1]

  function move(e: PointerEvent<SVGRectElement>) {
    if (points.length === 0) return
    const box = e.currentTarget.getBoundingClientRect()
    const time = first + ((e.clientX - box.left) / box.width) * span
    let nearest = 0
    points.forEach((p, i) => {
      if (Math.abs(p.time - time) < Math.abs(points[nearest].time - time)) nearest = i
    })
    setHover(nearest)
  }

  const hovered = hover === null ? null : points[hover]
  const tipLeft = hovered ? Math.min(x(hovered.time) + 8, width - 130) : 0

  return (
    <>
      <div className="monitorChart jqplot-target" style={{ width, height }}>
        <div className="jqplot-title" style={{ position: 'absolute', top: 0, left: 0, width }}>
          {title}
        </div>
        <svg width={width} height={height} role="img" aria-label={title}>
          {ticks.map((value) => (
            <g key={value}>
              <line className="jqplot-grid" x1={PAD.left} x2={width - PAD.right} y1={y(value)} y2={y(value)} />
              <text className="jqplot-tick" x={PAD.left - 4} y={y(value) + 3} textAnchor="end">
                {format(value)}
              </text>
            </g>
          ))}
          {timeTicks.map((time, i) => (
            <g key={time}>
              <line className="jqplot-grid" x1={x(time)} x2={x(time)} y1={PAD.top} y2={PAD.top + plotHeight} />
              {/* The last tick ends at the plot's edge rather than running past the chart. */}
              <text className="jqplot-tick" x={x(time)} y={height - 5} textAnchor={i === timeTicks.length - 1 ? 'end' : 'middle'}>
                {clock(time)}
              </text>
            </g>
          ))}
          <line className="jqplot-axis-line" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotHeight} y2={PAD.top + plotHeight} />
          {series.map((name, s) =>
            points.length === 1 ? (
              <circle key={name} className={`jqplot-marker-${s + 1}`} cx={PAD.left + plotWidth} cy={y(points[0].values[s] ?? 0)} r={4} />
            ) : (
              <polyline key={name} className={`jqplot-series-${s + 1}`} points={points.map((p) => `${x(p.time)},${y(p.values[s] ?? 0)}`).join(' ')} />
            ),
          )}
          {hovered && (
            <g>
              <line className="jqplot-crosshair" x1={x(hovered.time)} x2={x(hovered.time)} y1={PAD.top} y2={PAD.top + plotHeight} />
              {series.map((name, s) => (
                <circle key={name} className={`jqplot-marker-${s + 1}`} cx={x(hovered.time)} cy={y(hovered.values[s] ?? 0)} r={4} />
              ))}
            </g>
          )}
          <rect x={PAD.left} y={PAD.top} width={plotWidth} height={plotHeight} fill="transparent" onPointerMove={move} onPointerLeave={() => setHover(null)} />
        </svg>
        {hovered && (
          <div className="jqplot-highlighter-tooltip" style={{ left: tipLeft, top: PAD.top + 4 }}>
            <div className="text-muted">{clock(hovered.time)}</div>
            {series.map((name, s) => (
              <div key={name}>
                <span className={`tooltip-key jqplot-swatch-${s + 1}`} />
                <strong>{format(hovered.values[s] ?? 0)}</strong> {name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="jqplot-table-legend">
        {series.map((name, s) => (
          <span key={name}>
            <span className={`jqplot-table-legend-swatch jqplot-swatch-${s + 1}`} />
            {name}
            {latest && <> {format(latest.values[s] ?? 0)}</>}
          </span>
        ))}
      </div>
    </>
  )
}

/** Up to five round values from 0 covering the largest one, as jqPlot's auto scale picks them. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const rough = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude
  const count = Math.ceil(max / step)

  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)))
}

function clock(time: number): string {
  return new Date(time * 1000).toLocaleTimeString(undefined, { hour12: false })
}
