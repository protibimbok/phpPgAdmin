import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import { notifyError } from '@/notify'
import { runQuery, type RowsResult } from '../api'
import QueryChart, { type ChartSeries, type ChartType } from '../chart/QueryChart'
import { defaultMaxRows } from '../results/ResultsGrid'
import { useStatementGuard } from '../useStatementGuard'
import { isNumericType } from '../sql'

const TYPES: ChartType[] = ['bar', 'column', 'line', 'spline', 'area', 'pie']

/**
 * phpMyAdmin's "Display chart" page (table/chart/tbl_chart.twig) for a query's rows: the chart
 * type, Stacked, the title, the X axis column and the series columns (the numeric ones), the axis
 * labels, or "Series names are in a column" with a series and a value column, the start row and
 * number of rows, and the chart with "Save chart as image". The statement comes in the navigation
 * state (or ?sql=) from the results' "Display chart" link and is run again for the rows asked.
 */
export default function Chart() {
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
  const [type, setType] = useState<ChartType>('line')
  const [stacked, setStacked] = useState(false)
  const [title, setTitle] = useState('')
  const [xAxis, setXAxis] = useState(0)
  const [series, setSeries] = useState<number[]>([])
  const [xLabel, setXLabel] = useState('')
  const [yLabel, setYLabel] = useState(t('chart.y_values'))
  const [byColumn, setByColumn] = useState(false)
  const [seriesColumn, setSeriesColumn] = useState(1)
  const [valueColumn, setValueColumn] = useState(-1)
  const svg = useRef<SVGSVGElement>(null)

  async function load(offset: number, limit: number) {
    try {
      const response = await runQuery(db ?? null, { sql, limit, offset, count: false })
      const first = response.results[0]
      if (!first) return setError(t('chart.no_rows'))
      if (first.kind === 'error') return setError(first.error.message)
      if (first.kind !== 'rows') return setError(t('chart.not_rows'))
      setError(null)
      setResult(first)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  // The first page of rows, once per statement; Go reads the others.
  useEffect(() => {
    if (sql.trim() !== '') guard(() => void load(0, rows))
  }, [sql])

  const numeric = useMemo(() => (result?.columns ?? []).map((c) => isNumericType(c.type_name)), [result])

  // phpMyAdmin's defaults: the first column on the X axis, every other numeric column a series.
  useEffect(() => {
    if (!result) return
    setXAxis(0)
    setXLabel(result.columns[0]?.name ?? '')
    const others = result.columns.map((_, i) => i).filter((i) => numeric[i] && i !== 0)
    setSeries(others.length > 0 ? others : numeric[0] ? [0] : [])
    setSeriesColumn(Math.min(1, result.columns.length - 1))
    setValueColumn(result.columns.findIndex((_, i) => numeric[i] && i !== 0 && i !== 1))
  }, [result, numeric])

  const chart = useMemo((): { categories: string[]; series: ChartSeries[] } => {
    if (!result) return { categories: [], series: [] }
    const value = (v: string | null) => (v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
    if (!byColumn) {
      return {
        categories: result.rows.map((row) => row[xAxis] ?? 'NULL'),
        series: series.map((i) => ({ name: result.columns[i].name, values: result.rows.map((row) => value(row[i])) })),
      }
    }
    // A long table: one series per distinct name in the series column, over the distinct X values.
    const categories = [...new Set(result.rows.map((row) => row[xAxis] ?? 'NULL'))]
    const names = [...new Set(result.rows.map((row) => row[seriesColumn] ?? 'NULL'))]

    return {
      categories,
      series: names.map((name) => ({
        name,
        values: categories.map((category) => {
          const row = result.rows.find((r) => (r[xAxis] ?? 'NULL') === category && (r[seriesColumn] ?? 'NULL') === name)

          return row && valueColumn >= 0 ? value(row[valueColumn]) : null
        }),
      })),
    }
  }, [result, xAxis, series, byColumn, seriesColumn, valueColumn])

  function submit(e: FormEvent) {
    e.preventDefault()
    guard(() => void load(start, rows))
  }

  /** The chart as a PNG: the SVG with its computed colours inlined, drawn on a canvas. */
  function saveImage() {
    const source = svg.current
    if (!source) return
    const copy = source.cloneNode(true) as SVGSVGElement
    const originals = source.querySelectorAll('*')
    copy.querySelectorAll('*').forEach((node, i) => {
      const style = getComputedStyle(originals[i])
      ;(node as SVGElement).setAttribute('style', ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'font-size', 'font-family'].map((p) => `${p}:${style.getPropertyValue(p)}`).join(';'))
    })
    const data = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = source.width.baseVal.value
      canvas.height = source.height.baseVal.value
      canvas.getContext('2d')?.drawImage(image, 0, 0)
      const link = document.createElement('a')
      link.download = 'chart.png'
      link.href = canvas.toDataURL('image/png')
      // Some browsers download only from a link that is in the document.
      document.body.appendChild(link)
      link.click()
      link.remove()
    }
    image.onerror = () => notifyError(t('chart.save_failed'))
    image.src = data
  }

  if (sql.trim() === '') {
    return (
      <div className="container-fluid my-3">
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {t('chart.missing')}
        </div>
      </div>
    )
  }

  const columns = result?.columns ?? []
  const canPie = !byColumn && series.length === 1

  return (
    <div id="div_view_options" className="container-fluid">
      {dialog}
      <h2>{t('operations.display_chart')}</h2>

      <div className="card">
        <div className="card-body">
          <form method="post" id="tblchartform" onSubmit={submit}>
            <fieldset className="mb-3" role="radiogroup">
              <legend className="visually-hidden">{t('chart.type')}</legend>
              {TYPES.filter((value) => value !== 'pie' || canPie).map((value) => (
                <div className="form-check form-check-inline" key={value}>
                  <input className="form-check-input" type="radio" name="chartType" value={value} id={`${value}ChartTypeRadio`} checked={type === value} onChange={() => setType(value)} />
                  <label className="form-check-label" htmlFor={`${value}ChartTypeRadio`}>
                    {t(`chart.types.${value}`)}
                  </label>
                </div>
              ))}
            </fieldset>

            {(type === 'bar' || type === 'column' || type === 'area') && (
              <div className="form-check mb-3" id="barStacked">
                <input className="form-check-input" type="checkbox" name="barStackedCheckbox" id="barStackedCheckbox" checked={stacked} onChange={(e) => setStacked(e.target.checked)} />
                <label className="form-check-label" htmlFor="barStackedCheckbox">
                  {t('chart.stacked')}
                </label>
              </div>
            )}

            <div className="mb-3">
              <label className="form-label" htmlFor="chartTitleInput">
                {t('chart.title')}
              </label>
              <input className="form-control" type="text" name="chartTitleInput" id="chartTitleInput" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="chartXAxisSelect">
                {t('chart.x_axis')}
              </label>
              <select className="form-select" name="chartXAxisSelect" id="chartXAxisSelect" value={xAxis} onChange={(e) => { setXAxis(Number(e.target.value)); setXLabel(columns[Number(e.target.value)]?.name ?? '') }}>
                {columns.map((column, i) => (
                  <option key={i} value={i}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>

            {!byColumn && (
              <div className="mb-3">
                <label className="form-label" htmlFor="chartSeriesSelect">
                  {t('chart.series')}
                </label>
                <select className="form-select resize-vertical" name="chartSeriesSelect" id="chartSeriesSelect" multiple value={series.map(String)} onChange={(e) => { const next = Array.from(e.target.selectedOptions, (o) => Number(o.value)); setSeries(next); if (type === 'pie' && next.length !== 1) setType('column') }}>
                  {columns.map((column, i) =>
                    numeric[i] ? (
                      <option key={i} value={i}>
                        {column.name}
                      </option>
                    ) : null,
                  )}
                </select>
              </div>
            )}

            <div className="mb-3">
              <label className="form-label" htmlFor="xAxisLabelInput">
                {t('chart.x_label')}
              </label>
              <input className="form-control" type="text" name="xAxisLabelInput" id="xAxisLabelInput" value={xLabel} onChange={(e) => setXLabel(e.target.value)} />
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="yAxisLabelInput">
                {t('chart.y_label')}
              </label>
              <input className="form-control" type="text" name="yAxisLabelInput" id="yAxisLabelInput" value={yLabel} onChange={(e) => setYLabel(e.target.value)} />
            </div>

            <div className="form-check mb-3">
              <input className="form-check-input" type="checkbox" id="seriesColumnCheckbox" name="seriesColumnCheckbox" checked={byColumn} onChange={(e) => { setByColumn(e.target.checked); if (e.target.checked && type === 'pie') setType('column') }} />
              <label className="form-check-label" htmlFor="seriesColumnCheckbox">
                {t('chart.series_in_column')}
              </label>
            </div>

            {byColumn && (
              <>
                <div className="mb-3">
                  <label className="form-label" htmlFor="chartSeriesColumnSelect">
                    {t('chart.series_column')}
                  </label>
                  <select className="form-select" name="chartSeriesColumnSelect" id="chartSeriesColumnSelect" value={seriesColumn} onChange={(e) => setSeriesColumn(Number(e.target.value))}>
                    {columns.map((column, i) => (
                      <option key={i} value={i}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mb-3">
                  <label className="form-label" htmlFor="chartValueColumnSelect">
                    {t('chart.value_column')}
                  </label>
                  <select className="form-select" name="chartValueColumnSelect" id="chartValueColumnSelect" value={valueColumn} onChange={(e) => setValueColumn(Number(e.target.value))}>
                    {columns.map((column, i) =>
                      numeric[i] ? (
                        <option key={i} value={i}>
                          {column.name}
                        </option>
                      ) : null,
                    )}
                  </select>
                </div>
              </>
            )}

            <fieldset className="row g-3 align-items-center my-3">
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

            {error && (
              <div className="alert alert-danger" role="alert">
                {error}
              </div>
            )}

            {result && !error && (
              <div id="resizer" className="position-relative d-inline-block">
                <div className="position-absolute top-0 end-0 mt-1 me-1 z-1">
                  <a className="disableAjax" id="saveChart" href="#save" onClick={(e) => { e.preventDefault(); saveImage() }}>
                    <Icon name="b_saveimage" title={t('chart.save_image')} />
                  </a>
                </div>
                <div id="querychart" dir="ltr">
                  {chart.series.length === 0 || chart.categories.length === 0 ? (
                    <div className="alert alert-primary m-3" role="alert">
                      <Icon name="s_notice" /> {t('chart.no_series')}
                    </div>
                  ) : (
                    <QueryChart ref={svg} type={type === 'pie' && !canPie ? 'column' : type} stacked={stacked} title={title} xLabel={xLabel} yLabel={yLabel} categories={chart.categories} series={chart.series} />
                  )}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
