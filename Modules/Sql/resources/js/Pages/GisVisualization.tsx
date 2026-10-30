import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { notifyError } from '@/notify'
import { notAvailable } from '@/unbuilt'
import { runQuery, type RowsResult } from '../api'
import { bounds, isSpatialType, parseSpatial, type Shape, type XY } from '../gis/geometry'
import { defaultMaxRows } from '../results/ResultsGrid'
import { useStatementGuard } from '../useStatementGuard'

const WIDTH = 600
const HEIGHT = 450
const PADDING = 20

/** phpMyAdmin's GIS colours, one per row, in turn. */
const COLORS = ['#B02EE0', '#E0642E', '#E0D62E', '#2E97E0', '#BCE02E', '#E02E75', '#5CE02E', '#E0B02E', '#0022E0', '#726CB1', '#481A36', '#BAC658', '#127224', '#825119', '#238C74', '#4C489B', '#87C9BF']

/**
 * phpMyAdmin's "Display GIS Visualization" (table/gis_visualization/gis_visualization.twig) for
 * a query's rows: the label column, the spatial column, the start row and number of rows, the
 * drawing (each row's shapes in its colour, its label on hover; the wheel zooms and a drag
 * pans), and Save as PNG or SVG. It draws SVG itself, as phpMyAdmin's SVG view does, for the
 * built-in geometric types (point, lseg, box, path, polygon, circle) and PostGIS geometry and
 * geography. The statement comes in the navigation state (or ?sql=) from the results' "Visualize
 * GIS data" link.
 */
export default function GisVisualization() {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { db } = useParams()
  const [search] = useSearchParams()
  const location = useLocation()
  const sql = (location.state as { sql?: string } | null)?.sql ?? search.get('sql') ?? ''
  // A statement that is not a read is shown and asked about before it runs: a link can carry any.
  const { guard, dialog } = useStatementGuard(sql)
  const [start, setStart] = useState(0)
  const [rows, setRows] = useState(() => defaultMaxRows())
  const [result, setResult] = useState<RowsResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [labelColumn, setLabelColumn] = useState(-1)
  const [spatialColumn, setSpatialColumn] = useState(-1)
  const [saveMenu, setSaveMenu] = useState(false)
  const [view, setView] = useState<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 1 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)

  async function load(offset: number, limit: number) {
    try {
      const response = await runQuery(db ?? null, { sql, limit, offset, count: false })
      const first = response.results[0]
      if (!first) return setError(t('gis.no_rows'))
      if (first.kind === 'error') return setError(first.error.message)
      if (first.kind !== 'rows') return setError(t('gis.no_rows'))
      setError(null)
      setResult(first)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  useEffect(() => {
    if (sql.trim() !== '') guard(() => void load(0, rows))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql])

  const columns = result?.columns ?? []
  const spatial = columns.map((c, i) => ({ c, i })).filter(({ c }) => isSpatialType(c.type_name))
  const labels = columns.map((c, i) => ({ c, i })).filter(({ c }) => !isSpatialType(c.type_name))

  // phpMyAdmin's defaults: the first spatial column, and the first other column as the label.
  useEffect(() => {
    if (!result) return
    const s = result.columns.findIndex((c) => isSpatialType(c.type_name))
    setSpatialColumn(s)
    setLabelColumn(result.columns.findIndex((c) => !isSpatialType(c.type_name)))
    setView({ x: 0, y: 0, scale: 1 })
  }, [result])

  // A drawing starts unzoomed.
  useEffect(() => setView({ x: 0, y: 0, scale: 1 }), [spatialColumn])

  const drawn = useMemo(() => {
    if (!result || spatialColumn < 0) return { items: [] as { shapes: Shape[]; label: string; color: string }[], unreadable: 0 }
    const type = result.columns[spatialColumn].type_name ?? ''
    let unreadable = 0
    const items = result.rows.flatMap((row, i) => {
      const value = row[spatialColumn]
      const shapes = parseSpatial(type, value)
      if (shapes === null) {
        if (value !== null) unreadable++
        return []
      }
      return [{ shapes, label: labelColumn >= 0 ? (row[labelColumn] ?? '') : '', color: COLORS[i % COLORS.length] }]
    })
    return { items, unreadable }
  }, [result, spatialColumn, labelColumn])

  // Data coordinates to the drawing's: the bounds fit the box, y upwards.
  const project = useMemo(() => {
    const box = bounds(drawn.items.flatMap((d) => d.shapes))
    if (!box) return null
    let [minX, minY, maxX, maxY] = box
    if (maxX - minX === 0) [minX, maxX] = [minX - 1, maxX + 1]
    if (maxY - minY === 0) [minY, maxY] = [minY - 1, maxY + 1]
    const scale = Math.min((WIDTH - 2 * PADDING) / (maxX - minX), (HEIGHT - 2 * PADDING) / (maxY - minY))
    const offX = (WIDTH - (maxX - minX) * scale) / 2
    const offY = (HEIGHT - (maxY - minY) * scale) / 2
    return { scale, point: ([x, y]: XY): XY => [offX + (x - minX) * scale, HEIGHT - offY - (y - minY) * scale] }
  }, [drawn])

  function submit(e: FormEvent) {
    e.preventDefault()
    guard(() => void load(start, rows))
  }

  function wheel(e: WheelEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * WIDTH
    const my = ((e.clientY - rect.top) / rect.height) * HEIGHT
    const factor = e.deltaY < 0 ? 1.25 : 0.8
    setView((v) => ({ scale: v.scale * factor, x: mx - (mx - v.x) * factor, y: my - (my - v.y) * factor }))
  }

  function pointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = ((e.clientX - drag.current.x) / rect.width) * WIDTH
    const dy = ((e.clientY - drag.current.y) / rect.height) * HEIGHT
    drag.current = { x: e.clientX, y: e.clientY }
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }))
  }

  /** The drawing as a file: SVG as it is, PNG through a canvas. */
  function save(format: 'png' | 'svg') {
    const source = svg.current
    if (!source) return
    const text = new XMLSerializer().serializeToString(source)
    const download = (href: string) => {
      const link = document.createElement('a')
      link.download = `${result?.columns[spatialColumn]?.name ?? 'gis'}.${format}`
      link.href = href
      document.body.appendChild(link)
      link.click()
      link.remove()
    }
    if (format === 'svg') {
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
      download(url)
      URL.revokeObjectURL(url)
      return
    }
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = WIDTH
      canvas.height = HEIGHT
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, WIDTH, HEIGHT)
      ctx.drawImage(image, 0, 0)
      download(canvas.toDataURL('image/png'))
    }
    image.onerror = () => notifyError(t('gis.save_failed'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`
  }

  if (sql.trim() === '') {
    return (
      <div className="container-fluid my-3">
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {t('gis.missing')}
        </div>
      </div>
    )
  }

  // Lines and points keep their size whatever the zoom.
  const stroke = 2 / view.scale
  const path = (points: XY[], closed: boolean) => (project ? points.map((p, i) => `${i === 0 ? 'M' : 'L'}${project.point(p).join(',')}`).join(' ') + (closed ? ' Z' : '') : '')

  return (
    <div id="div_view_options" className="container-fluid">
      {dialog}
      <h2>{t('gis.title')}</h2>

      <div className="card">
        <div id="gis_div" className="card-body">
          <form method="post" className="row g-3 align-items-start" onSubmit={submit}>
            <div className="col-12 col-md-6 col-xl">
              <label className="form-label" htmlFor="labelColumn">
                {t('gis.label_column')}
              </label>
              <select name="labelColumn" id="labelColumn" className="form-select" value={labelColumn} onChange={(e) => setLabelColumn(Number(e.target.value))}>
                <option value={-1}>{t('gis.none')}</option>
                {labels.map(({ c, i }) => (
                  <option key={i} value={i}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12 col-md-6 col-xl">
              <label className="form-label" htmlFor="spatialColumn">
                {t('gis.spatial_column')}
              </label>
              <select name="spatialColumn" id="spatialColumn" className="form-select" value={spatialColumn} onChange={(e) => setSpatialColumn(Number(e.target.value))}>
                {spatial.map(({ c, i }) => (
                  <option key={i} value={i}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-12">
              <fieldset className="row g-3 align-items-center">
                <div className="col-auto">
                  <label className="col-form-label" htmlFor="startRowInput">
                    {t('chart.start_row')}
                  </label>
                </div>
                <div className="col-auto">
                  <input className="form-control" id="startRowInput" type="number" name="pos" min={0} value={start} onChange={(e) => setStart(Number(e.target.value))} required />
                </div>
                <div className="col-auto">
                  <label className="col-form-label" htmlFor="maxRowsInput">
                    {t('chart.number_of_rows')}
                  </label>
                </div>
                <div className="col-auto">
                  <input className="form-control" id="maxRowsInput" type="number" name="session_max_rows" min={1} value={rows} onChange={(e) => setRows(Number(e.target.value))} required />
                </div>
                <div className="col-auto">
                  <input className="btn btn-primary" type="submit" name="submit" value={tApp('go')} />
                </div>
              </fieldset>
            </div>

            <div className="d-flex justify-content-between align-items-center">
              <div className="form-check form-switch">
                <input className="form-check-input" type="checkbox" name="useBaseLayer" id="useOsmAsBaseLayerSwitch" checked={false} onChange={(e) => notAvailable(e)} />
                <label className="form-check-label" htmlFor="useOsmAsBaseLayerSwitch" id="useOsmAsBaseLayerSwitchLabel">
                  {t('gis.use_osm')}
                </label>
              </div>
              <div className="dropdown position-relative">
                <button className="btn btn-secondary dropdown-toggle" type="button" id="saveImageButton" aria-expanded={saveMenu} onClick={() => setSaveMenu((o) => !o)}>
                  <Icon name="b_saveimage" /> {t('gis.save')}
                </button>
                <ul className={`dropdown-menu dropdown-menu-end${saveMenu ? ' show' : ''}`} data-bs-popper="static" aria-labelledby="saveImageButton" onClick={() => setSaveMenu(false)}>
                  <li>
                    <a className="dropdown-item" href="#png" onClick={(e) => { e.preventDefault(); save('png') }}>
                      PNG
                    </a>
                  </li>
                  <li>
                    <a className="dropdown-item" href="#pdf" onClick={(e) => notAvailable(e)}>
                      PDF
                    </a>
                  </li>
                  <li>
                    <a className="dropdown-item" href="#svg" onClick={(e) => { e.preventDefault(); save('svg') }}>
                      SVG
                    </a>
                  </li>
                </ul>
              </div>
            </div>
          </form>

          {error && (
            <div className="alert alert-danger mt-3" role="alert">
              {error}
            </div>
          )}
          {result && !error && spatial.length === 0 && (
            <div className="alert alert-primary mt-3" role="alert">
              <Icon name="s_notice" /> {t('gis.no_spatial')}
            </div>
          )}
          {drawn.unreadable > 0 && (
            <div className="alert alert-warning mt-3" role="alert">
              <Icon name="s_attention" /> {t('gis.unreadable', { count: drawn.unreadable })}
            </div>
          )}

          {result && !error && spatial.length > 0 && (
            <div id="visualization-placeholder" className="mt-3">
              <svg
                ref={svg}
                xmlns="http://www.w3.org/2000/svg"
                width={WIDTH}
                height={HEIGHT}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                id="gis_svg"
                className="border"
                style={{ maxWidth: '100%', height: 'auto', cursor: drag.current ? 'grabbing' : 'grab', touchAction: 'none', background: '#fff' }}
                onWheel={wheel}
                onPointerDown={(e) => {
                  drag.current = { x: e.clientX, y: e.clientY }
                  e.currentTarget.setPointerCapture(e.pointerId)
                }}
                onPointerMove={pointerMove}
                onPointerUp={() => (drag.current = null)}
              >
                <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
                  {project &&
                    drawn.items.map((item, i) => (
                      <g key={i} className="gis-row" data-label={item.label}>
                        <title>{item.label}</title>
                        {item.shapes.map((s, j) => {
                          if (s.kind === 'point') {
                            const [x, y] = project.point(s.at)
                            return <circle key={j} cx={x} cy={y} r={3 / view.scale} fill="#fff" stroke={item.color} strokeWidth={stroke} />
                          }
                          if (s.kind === 'circle') {
                            const [x, y] = project.point(s.at)
                            return <circle key={j} cx={x} cy={y} r={s.r * project.scale} fill={item.color} fillOpacity={0.6} stroke="#000" strokeWidth={stroke / 2} />
                          }
                          if (s.kind === 'line') return <path key={j} d={path(s.points, s.closed)} fill="none" stroke={item.color} strokeWidth={stroke} />
                          return <path key={j} d={s.rings.map((ring) => path(ring, true)).join(' ')} fillRule="evenodd" fill={item.color} fillOpacity={0.6} stroke="#000" strokeWidth={stroke / 2} />
                        })}
                      </g>
                    ))}
                </g>
              </svg>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
