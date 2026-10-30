import { forwardRef, useState, type ReactNode } from 'react'

export type ChartType = 'bar' | 'column' | 'line' | 'spline' | 'area' | 'pie'

export interface ChartSeries {
  name: string
  /** One value per category; null where the row has none. */
  values: (number | null)[]
}

export interface QueryChartProps {
  type: ChartType
  stacked: boolean
  title: string
  xLabel: string
  yLabel: string
  /** The X axis values, in the rows' order. */
  categories: string[]
  series: ChartSeries[]
  width?: number
  height?: number
}

/** jqPlot's series colours as the chart tokens carry them; a series past the eighth takes them again. */
const COLOURS = 8

const PAD = { top: 34, right: 16, bottom: 52, left: 64 }

/**
 * A query's rows as a chart, drawn in SVG the way phpMyAdmin's jqPlot query charts look, with
 * the Monitor charts' surface, grid and series colours: bars (horizontal) or columns, side by
 * side or stacked, lines, smoothed lines, areas, or a pie of the first series. The title is
 * above, the axis labels beside the axes and the legend below. Hovering a mark shows its value.
 */
const QueryChart = forwardRef<SVGSVGElement, QueryChartProps>(function QueryChart({ type, stacked, title, xLabel, yLabel, categories, series, width = 720, height = 420 }, ref) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const legendRows = Math.ceil((type === 'pie' ? categories.length : series.length) / 4)
  const chartHeight = height + legendRows * 18 + 6
  const show = (x: number, y: number, text: string) => setTip({ x, y, text })
  const hide = () => setTip(null)
  const cls = (prefix: string, i: number) => `jqplot-${prefix}-${(i % COLOURS) + 1}`

  const body = type === 'pie' ? pie() : axes()

  return (
    <div className="queryChart" style={{ width, height: chartHeight }} onMouseLeave={hide}>
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={width} height={chartHeight} role="img" aria-label={title || 'chart'}>
        <rect className="queryChart-surface" x={0} y={0} width={width} height={chartHeight} />
        {title && (
          <text className="jqplot-title-text" x={width / 2} y={20} textAnchor="middle">
            {title}
          </text>
        )}
        {body}
        {legend()}
      </svg>
      {tip && (
        <div className="jqplot-highlighter-tooltip" style={{ position: 'absolute', left: Math.min(tip.x + 10, width - 160), top: Math.max(tip.y - 28, 0) }}>
          {tip.text}
        </div>
      )}
    </div>
  )

  function legend() {
    const names = type === 'pie' ? categories : series.map((s) => s.name)
    const top = height + 12

    return names.map((name, i) => {
      const x = 16 + (i % 4) * ((width - 32) / 4)
      const y = top + Math.floor(i / 4) * 18

      return (
        <g key={`legend-${i}`}>
          <rect className={cls('fill', i)} x={x} y={y - 10} width={12} height={12} />
          <text className="jqplot-tick" x={x + 17} y={y}>
            {name.length > 28 ? `${name.slice(0, 28)}…` : name}
          </text>
        </g>
      )
    })
  }

  function pie() {
    const values = (series[0]?.values ?? []).map((v) => Math.max(v ?? 0, 0))
    const total = values.reduce((a, b) => a + b, 0)
    const cx = width / 2
    const cy = PAD.top + (height - PAD.top - PAD.bottom) / 2
    const r = Math.min(width, height - PAD.top - PAD.bottom) / 2 - 10
    if (total === 0) return null
    let angle = -Math.PI / 2

    return values.map((value, i) => {
      const sweep = (value / total) * Math.PI * 2
      const start = angle
      angle += sweep
      const share = `${categories[i]}: ${value} (${((value / total) * 100).toFixed(1)}%)`
      const mid = start + sweep / 2
      const label = sweep > 0.25 ? (
        <text className="jqplot-tick queryChart-slice-label" x={cx + Math.cos(mid) * r * 0.65} y={cy + Math.sin(mid) * r * 0.65 + 4} textAnchor="middle">
          {`${((value / total) * 100).toFixed(1)}%`}
        </text>
      ) : null
      const path =
        sweep >= Math.PI * 2 - 1e-9
          ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
          : `M ${cx} ${cy} L ${cx + Math.cos(start) * r} ${cy + Math.sin(start) * r} A ${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} 1 ${cx + Math.cos(angle) * r} ${cy + Math.sin(angle) * r} Z`

      return (
        <g key={`slice-${i}`}>
          <path className={cls('fill', i)} d={path} onMouseMove={(e) => show(e.nativeEvent.offsetX, e.nativeEvent.offsetY, share)} />
          {label}
        </g>
      )
    })
  }

  function axes() {
    const horizontal = type === 'bar'
    const plotW = width - PAD.left - PAD.right
    const plotH = height - PAD.top - PAD.bottom
    const n = Math.max(categories.length, 1)
    const stackable = stacked && (type === 'bar' || type === 'column' || type === 'area')

    // The value range: stacked marks add up per category, the others stand alone.
    const sums = categories.map((_, c) => series.reduce((acc, s) => acc + Math.max(s.values[c] ?? 0, 0), 0))
    const all = stackable ? sums : series.flatMap((s) => s.values.filter((v): v is number => v !== null))
    const min = Math.min(0, ...all)
    const ticks = niceTicks(min, Math.max(0, ...all))
    const lo = ticks[0]
    const hi = ticks[ticks.length - 1]
    const scale = (v: number) => (v - lo) / (hi - lo || 1)

    // Positions: along the category axis, and of a value on the value axis.
    const band = (horizontal ? plotH : plotW) / n
    const along = (c: number) => (horizontal ? PAD.top : PAD.left) + band * c + band / 2
    const valueAt = (v: number) => (horizontal ? PAD.left + scale(v) * plotW : PAD.top + plotH - scale(v) * plotH)
    const zero = valueAt(Math.max(lo, 0))
    const every = Math.max(1, Math.ceil(n / (horizontal ? plotH / 16 : plotW / 60)))

    const grid = ticks.map((v) => (
      <g key={`tick-${v}`}>
        {horizontal ? <line className="jqplot-grid" x1={valueAt(v)} x2={valueAt(v)} y1={PAD.top} y2={PAD.top + plotH} /> : <line className="jqplot-grid" x1={PAD.left} x2={PAD.left + plotW} y1={valueAt(v)} y2={valueAt(v)} />}
        <text className="jqplot-tick" x={horizontal ? valueAt(v) : PAD.left - 5} y={horizontal ? PAD.top + plotH + 14 : valueAt(v) + 3} textAnchor={horizontal ? 'middle' : 'end'}>
          {formatTick(v)}
        </text>
      </g>
    ))
    const labels = categories.map((name, c) =>
      c % every === 0 ? (
        <text key={`cat-${c}`} className="jqplot-tick" x={horizontal ? PAD.left - 5 : along(c)} y={horizontal ? along(c) + 3 : PAD.top + plotH + 14} textAnchor={horizontal ? 'end' : 'middle'}>
          {name.length > 12 ? `${name.slice(0, 12)}…` : name}
        </text>
      ) : null,
    )

    let marks: ReactNode[] = []
    if (type === 'bar' || type === 'column') {
      const inner = band * 0.8
      const width1 = stackable ? inner : inner / Math.max(series.length, 1)
      const offsets = categories.map(() => 0)
      marks = series.flatMap((s, i) =>
        s.values.map((v, c) => {
          if (v === null) return null
          const base = stackable ? offsets[c] : 0
          if (stackable) offsets[c] += Math.max(v, 0)
          const from = valueAt(stackable ? base : Math.min(v, 0) < 0 ? v : 0)
          const to = valueAt(stackable ? base + Math.max(v, 0) : Math.max(v, 0))
          const start = along(c) - inner / 2 + (stackable ? 0 : i * width1)
          const text = `${s.name}, ${categories[c]}: ${v}`
          const box = horizontal ? { x: Math.min(from, to), y: start, width: Math.abs(to - from), height: width1 } : { x: start, y: Math.min(from, to), width: width1, height: Math.abs(to - from) }

          return <rect key={`m-${i}-${c}`} className={cls('fill', i)} {...box} onMouseMove={(e) => show(e.nativeEvent.offsetX, e.nativeEvent.offsetY, text)} />
        }),
      )
    } else {
      const offsets = categories.map(() => 0)
      marks = series.map((s, i) => {
        const points = s.values.map((v, c) => {
          const base = stackable ? offsets[c] : 0
          const value = v === null ? null : base + (stackable ? Math.max(v, 0) : v)
          if (stackable && v !== null) offsets[c] += Math.max(v, 0)

          return value === null ? null : { x: along(c), y: valueAt(value), base: valueAt(base), v, c }
        })
        const present = points.filter((p): p is NonNullable<typeof p> => p !== null)
        const line = type === 'spline' ? smooth(present) : present.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
        const area =
          type === 'area' && present.length > 0
            ? `${line} ${[...present].reverse().map((p) => `L ${p.x} ${stackable ? p.base : zero}`).join(' ')} Z`
            : null

        return (
          <g key={`s-${i}`}>
            {area && <path className={`${cls('fill', i)} queryChart-area`} d={area} />}
            <path className={cls('series', i)} d={line} />
            {present.map((p) => (
              <circle key={p.c} className={cls('marker', i)} cx={p.x} cy={p.y} r={3.5} onMouseMove={(e) => show(e.nativeEvent.offsetX, e.nativeEvent.offsetY, `${s.name}, ${categories[p.c]}: ${p.v}`)} />
            ))}
          </g>
        )
      })
    }

    return (
      <>
        <rect className="queryChart-plot" x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
        {grid}
        {marks}
        {labels}
        <line className="jqplot-axis-line" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + plotH} />
        <line className="jqplot-axis-line" x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH} />
        {xLabel && (
          <text className="jqplot-tick queryChart-axis-label" x={horizontal ? 14 : PAD.left + plotW / 2} y={horizontal ? PAD.top + plotH / 2 : PAD.top + plotH + 34} textAnchor="middle" transform={horizontal ? `rotate(-90 14 ${PAD.top + plotH / 2})` : undefined}>
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text className="jqplot-tick queryChart-axis-label" x={horizontal ? PAD.left + plotW / 2 : 14} y={horizontal ? PAD.top + plotH + 34 : PAD.top + plotH / 2} textAnchor="middle" transform={horizontal ? undefined : `rotate(-90 14 ${PAD.top + plotH / 2})`}>
            {yLabel}
          </text>
        )}
      </>
    )
  }
})

export default QueryChart

/** A cubic curve through the points, its control points a sixth of the way to the neighbours (Catmull-Rom). */
function smooth(points: { x: number; y: number }[]): string {
  if (points.length < 3) return points.map((p, j) => `${j === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[Math.min(i + 2, points.length - 1)]
    d += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`
  }

  return d
}

/** Round axis ticks from min to max: 1, 2 or 5 times a power of ten apart, five or so of them. */
export function niceTicks(min: number, max: number): number[] {
  if (max === min) max = min + 1
  const raw = (max - min) / 5
  const power = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? power * 10
  const ticks: number[] = []
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)))
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)

  return ticks
}

/** A tick value, shortened with k, M and G. */
export function formatTick(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${Number((v / 1e9).toPrecision(3))}G`
  if (abs >= 1e6) return `${Number((v / 1e6).toPrecision(3))}M`
  if (abs >= 1e4) return `${Number((v / 1e3).toPrecision(3))}k`

  return String(Number(v.toPrecision(6)))
}
