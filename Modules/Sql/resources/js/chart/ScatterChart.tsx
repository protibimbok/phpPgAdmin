import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { formatTick, niceTicks } from './QueryChart'

export interface ScatterPoint {
  x: number
  y: number
  /** Shown when the pointer is over the point (the "label each point" column); none, no tooltip. */
  label?: string | null
}

/** How an axis reads: numbers, or times as milliseconds since the epoch (dates print as such). */
export type AxisKind = 'number' | 'date' | 'datetime'

export interface ScatterChartProps {
  points: ScatterPoint[]
  xLabel: string
  yLabel: string
  xKind: AxisKind
  yKind: AxisKind
  width: number
  height: number
  /** A click on a point, by its index in "points". */
  onPointClick?: (index: number) => void
  /** Changing it zooms back out: the "Reset zoom" button. */
  resetKey?: number
}

interface Domain {
  x: [number, number]
  y: [number, number]
}

const PAD = { top: 14, right: 16, bottom: 46, left: 70 }

/**
 * The zoom search plot (zoom_plot_jqplot.js): one marker per row on the Display chart's
 * surface, grid and axes, the axis labels beside the axes. Dragging over the plot zooms into
 * the box drawn, as jqPlot's cursor zoom does; hovering a point shows its label.
 */
export default function ScatterChart({ points, xLabel, yLabel, xKind, yKind, width, height, onPointClick, resetKey }: ScatterChartProps) {
  const [zoom, setZoom] = useState<Domain | null>(null)
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  useEffect(() => setZoom(null), [resetKey])

  const plotW = Math.max(width - PAD.left - PAD.right, 10)
  const plotH = Math.max(height - PAD.top - PAD.bottom, 10)
  const extent = (values: number[]): [number, number] => {
    if (values.length === 0) return [0, 1]
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    // A little room around the outermost points, as jqPlot pads its axes.
    const pad = hi === lo ? Math.abs(hi) * 0.1 || 1 : (hi - lo) * 0.05

    return [lo - pad, hi + pad]
  }
  const domain: Domain = zoom ?? { x: extent(points.map((p) => p.x)), y: extent(points.map((p) => p.y)) }
  const xTicks = ticksIn(domain.x)
  const yTicks = ticksIn(domain.y)
  const sx = (v: number) => PAD.left + ((v - domain.x[0]) / (domain.x[1] - domain.x[0] || 1)) * plotW
  const sy = (v: number) => PAD.top + plotH - ((v - domain.y[0]) / (domain.y[1] - domain.y[0] || 1)) * plotH
  const inside = (p: ScatterPoint) => p.x >= domain.x[0] && p.x <= domain.x[1] && p.y >= domain.y[0] && p.y <= domain.y[1]

  function local(e: PointerEvent): { x: number; y: number } {
    const box = svg.current!.getBoundingClientRect()

    return { x: Math.min(Math.max(e.clientX - box.left, PAD.left), PAD.left + plotW), y: Math.min(Math.max(e.clientY - box.top, PAD.top), PAD.top + plotH) }
  }

  function finishDrag() {
    if (!drag) return
    setDrag(null)
    if (Math.abs(drag.x1 - drag.x0) < 5 || Math.abs(drag.y1 - drag.y0) < 5) return
    const ix = (px: number) => domain.x[0] + ((px - PAD.left) / plotW) * (domain.x[1] - domain.x[0])
    const iy = (py: number) => domain.y[0] + ((PAD.top + plotH - py) / plotH) * (domain.y[1] - domain.y[0])
    setZoom({ x: [ix(Math.min(drag.x0, drag.x1)), ix(Math.max(drag.x0, drag.x1))], y: [iy(Math.max(drag.y0, drag.y1)), iy(Math.min(drag.y0, drag.y1))] })
  }

  return (
    <div className="queryChart" style={{ width, height }} onMouseLeave={() => setTip(null)}>
      <svg ref={svg} xmlns="http://www.w3.org/2000/svg" width={width} height={height} role="img" aria-label={`${xLabel} / ${yLabel}`}>
        <rect className="queryChart-surface" x={0} y={0} width={width} height={height} />
        {xTicks.map((v) => (
          <g key={`x-${v}`}>
            <line className="jqplot-grid" x1={sx(v)} x2={sx(v)} y1={PAD.top} y2={PAD.top + plotH} />
            <text className="jqplot-tick" x={sx(v)} y={PAD.top + plotH + 14} textAnchor="middle">
              {tickLabel(v, xKind)}
            </text>
          </g>
        ))}
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line className="jqplot-grid" x1={PAD.left} x2={PAD.left + plotW} y1={sy(v)} y2={sy(v)} />
            <text className="jqplot-tick" x={PAD.left - 5} y={sy(v) + 3} textAnchor="end">
              {tickLabel(v, yKind)}
            </text>
          </g>
        ))}
        <line className="jqplot-axis-line" x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={PAD.top + plotH} />
        <line className="jqplot-axis-line" x1={PAD.left} x2={PAD.left + plotW} y1={PAD.top + plotH} y2={PAD.top + plotH} />
        <text className="jqplot-tick queryChart-axis-label" x={PAD.left + plotW / 2} y={PAD.top + plotH + 36} textAnchor="middle">
          {xLabel}
        </text>
        <text className="jqplot-tick queryChart-axis-label" x={14} y={PAD.top + plotH / 2} textAnchor="middle" transform={`rotate(-90 14 ${PAD.top + plotH / 2})`}>
          {yLabel}
        </text>
        {/* The plot area takes the drags; the points sit above it and take the clicks. */}
        <rect
          className="queryChart-plot jqplot-event-canvas"
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          pointerEvents="all"
          style={{ cursor: 'crosshair' }}
          onPointerDown={(e) => {
            const p = local(e)
            e.currentTarget.setPointerCapture(e.pointerId)
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
          }}
          onPointerMove={(e) => {
            if (!drag) return
            const p = local(e)
            setDrag({ ...drag, x1: p.x, y1: p.y })
          }}
          onPointerUp={finishDrag}
        />
        <g>
          {points.map((p, i) =>
            inside(p) ? (
              <circle
                key={i}
                className="jqplot-marker-1 jqplot-point"
                data-index={i}
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={4.5}
                style={{ cursor: onPointClick ? 'pointer' : undefined }}
                onMouseMove={(e) => p.label && setTip({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY, text: p.label })}
                onMouseOut={() => setTip(null)}
                onClick={() => onPointClick?.(i)}
              />
            ) : null,
          )}
        </g>
        {drag && <rect className="jqplot-zoom-box" x={Math.min(drag.x0, drag.x1)} y={Math.min(drag.y0, drag.y1)} width={Math.abs(drag.x1 - drag.x0)} height={Math.abs(drag.y1 - drag.y0)} />}
      </svg>
      {tip && (
        <div className="jqplot-highlighter-tooltip" style={{ left: Math.min(tip.x + 10, width - 160), top: Math.max(tip.y - 28, 0) }}>
          {tip.text}
        </div>
      )}
    </div>
  )
}

/** The ticks niceTicks picks over the range, those that fall inside it. */
function ticksIn([lo, hi]: [number, number]): number[] {
  return niceTicks(lo, hi).filter((v) => v >= lo && v <= hi)
}

function tickLabel(value: number, kind: AxisKind): string {
  if (kind === 'number') return formatTick(value)
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const iso = date.toISOString()

  // jqPlot's DateAxisRenderer prints a date column as %Y-%m-%d.
  return kind === 'date' ? iso.slice(0, 10) : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
}
