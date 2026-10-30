import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Modal from '@/components/Modal'
import { urls, useLevel, type RelationKind } from '@/level'
import { notify, notifyError } from '@/notify'
import { fetchRow, relationColumns, runQuery, saveRows, type CommandResult, type RelationColumn, type RowKeys, type RowsResult } from '../api'
import ScatterChart, { type AxisKind, type ScatterPoint } from '../chart/ScatterChart'
import { fieldKind } from '../fields/kinds'
import ResultMessage from '../results/ResultMessage'
import { qualifiedName } from '../sql'
import { condition, CriterionInput, operatorsFor, UNARY, type Criterion } from './Search'
import SearchTabs from './SearchTabs'

/** phpMyAdmin's maxRowPlotLimit. */
const MAX_PLOT_LIMIT = 500

interface Row {
  column: string
  criterion: Criterion
}

interface Plot {
  result: RowsResult
  x: string
  y: string
  label: string
  points: (ScatterPoint & { row: number })[]
  xKind: AxisKind
  yKind: AxisKind
}

/**
 * phpMyAdmin's "Zoom search" (table/zoom_search/index.twig, result_form.twig,
 * zoom_plot_jqplot.js): a "query by example" on two columns, the X and Y axes, with two more
 * optional criteria, the column that labels each point and the most rows to plot. The rows
 * found are plotted; a drag zooms in, a click on a point opens the row in the "Data point
 * content" dialog to edit it.
 */
export default function ZoomSearch() {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const kind: RelationKind = useLevel().kind ?? 'table'
  const relationUrl = urls.relation(db, schema, table, kind)
  const { data: info, error } = useRequest(() => relationColumns(db, schema, table), [db, schema, table])
  const columns = info?.columns ?? []

  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 4 }, () => ({ column: '', criterion: { operator: '', value: '' } })))
  const [dataLabel, setDataLabel] = useState<string | null>(null)
  const [maxPlot, setMaxPlot] = useState(MAX_PLOT_LIMIT)
  const [formShown, setFormShown] = useState(true)
  const [plot, setPlot] = useState<Plot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [help, setHelp] = useState(false)
  const [point, setPoint] = useState<{ keys: RowKeys; row: Record<string, string | null>; edited: Record<string, string | null> } | null>(null)
  const [saved, setSaved] = useState<CommandResult | null>(null)
  const [saving, setSaving] = useState(false)
  // Only the latest Go's answer is plotted.
  const searchSeq = useRef(0)

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }
  if (!info) return null

  // Relation::getDisplayField without the configuration storage: the first text column.
  const label = dataLabel ?? columns.find((c) => ['char', 'text'].includes(fieldKind(c)))?.name ?? ''
  const columnOf = (name: string) => columns.find((c) => c.name === name)

  function setRow(index: number, next: Row) {
    setRows((current) => current.map((row, i) => (i === index ? next : row)))
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    const [x, y] = [rows[0].column, rows[1].column]
    if (x === '' || y === '') {
      notify(t('zoom.select_two'))

      return
    }
    if (x === y) {
      notify(t('zoom.select_different'))

      return
    }
    const where = rows
      .flatMap((row) => {
        const column = columnOf(row.column)

        return column ? [condition(column, { ...row.criterion, operator: row.criterion.operator || operatorsFor(column)[0] })] : []
      })
      .filter(Boolean)
    const seq = ++searchSeq.current
    const sql = `SELECT * FROM ${qualifiedName(schema, table)}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''} LIMIT ${Math.max(1, maxPlot)}`
    try {
      const response = await runQuery(db, { sql, limit: null, count: false })
      if (seq !== searchSeq.current) return
      const result = response.results[0]
      if (result.kind === 'error') throw new Error(result.error.message)
      if (result.kind !== 'rows') return
      const xi = result.columns.findIndex((c) => c.name === x)
      const yi = result.columns.findIndex((c) => c.name === y)
      const li = result.columns.findIndex((c) => c.name === label)
      const xKind = axisKind(columnOf(x)!)
      const yKind = axisKind(columnOf(y)!)
      const points = result.rows
        .map((row, i) => ({ x: axisValue(row[xi], xKind, columnOf(x)!), y: axisValue(row[yi], yKind, columnOf(y)!), label: li === -1 ? null : row[li], row: i }))
        .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      setPlot({ result, x, y, label, points, xKind, yKind })
      setFailure(null)
      setSaved(null)
      setResetKey((k) => k + 1)
      setFormShown(false)
    } catch (err) {
      if (seq !== searchSeq.current) return
      setPlot(null)
      setFailure(errorMessage(err))
    }
  }

  async function openPoint(index: number) {
    if (!plot) return
    if (info!.primary_keys.length === 0) {
      notify(t('zoom.no_primary_key'))

      return
    }
    const source = plot.result.rows[plot.points[index].row]
    const keys = Object.fromEntries(info!.primary_keys.map((name) => [name, source[plot.result.columns.findIndex((c) => c.name === name)] ?? null]))
    try {
      const loaded = await fetchRow(db, schema, table, keys)
      setPoint({ keys, row: loaded.row, edited: { ...loaded.row } })
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function savePoint() {
    if (!point || saving) return
    const changed = Object.fromEntries(Object.entries(point.edited).filter(([name, value]) => value !== point.row[name]))
    if (Object.keys(changed).length === 0) {
      setPoint(null)

      return
    }
    setSaving(true)
    try {
      const outcome = await saveRows(db, schema, table, { updated: [{ keys: point.keys, values: changed }] })
      // The dialog stays open with its edits when the UPDATE fails.
      setPoint(null)
      setSaved({ kind: 'command', sql: outcome.sql.join(';\n'), line: 1, duration_ms: 0, notices: [], affected_rows: outcome.updated.length, command_tag: 'UPDATE' })
      // The plot follows the row's new values.
      if (plot && (plot.x in changed || plot.y in changed || plot.label in changed)) {
        const result = plot.result
        const keyIndexes = info!.primary_keys.map((name) => result.columns.findIndex((c) => c.name === name))
        const rowIndex = result.rows.findIndex((row) => info!.primary_keys.every((name, i) => row[keyIndexes[i]] === point.keys[name]))
        if (rowIndex !== -1) {
          const nextRows = result.rows.map((row, i) => (i === rowIndex ? result.columns.map((c, ci) => (c.name in changed ? changed[c.name] : row[ci])) : row))
          const xi = result.columns.findIndex((c) => c.name === plot.x)
          const yi = result.columns.findIndex((c) => c.name === plot.y)
          const li = result.columns.findIndex((c) => c.name === plot.label)
          const points = nextRows
            .map((row, i) => ({ x: axisValue(row[xi], plot.xKind, columnOf(plot.x)!), y: axisValue(row[yi], plot.yKind, columnOf(plot.y)!), label: li === -1 ? null : row[li], row: i }))
            .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
          setPlot({ ...plot, result: { ...result, rows: nextRows }, points })
        }
      }
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <SearchTabs relationUrl={relationUrl} active="zoom" />

      {formShown && (
        <form name="insertForm" id="zoom_search_form" className="ajax lock-page" onSubmit={search}>
          <div className="card mb-3">
            <div className="card-header">{t('zoom.legend')}</div>
            <div className="card-body" id="inputSection">
              <table className="table table-striped table-hover table-sm w-auto" id="tableFieldsId">
                <thead>
                  <tr>
                    <th>{t('search.column')}</th>
                    <th>{t('search.type')}</th>
                    <th>{t('search.collation')}</th>
                    <th>{t('search.operator')}</th>
                    <th>{t('search.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const column = row.column === '' ? undefined : columnOf(row.column)
                    const operators = column ? operatorsFor(column) : []
                    const criterion = { ...row.criterion, operator: row.criterion.operator || operators[0] || '' }

                    return (
                      <Fragment key={i}>
                        {i === 2 && (
                          <tr>
                            <th>{t('zoom.additional')}</th>
                          </tr>
                        )}
                        <tr className="noclick">
                          <th>
                            <select name="criteriaColumnNames[]" id={`tableid_${i}`} value={row.column} onChange={(e) => setRow(i, { column: e.target.value, criterion: { operator: '', value: '' } })} aria-label={t('search.column')}>
                              <option value="">{t('grid.none')}</option>
                              {columns.map((c) => (
                                <option key={c.name} value={c.name}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </th>
                          <td dir="ltr">{column?.type ?? ''}</td>
                          <td>{column?.collation ?? ''}</td>
                          <td>
                            {column && (
                              <select className="column-operator" id={`ColumnOperator${i}`} name={`criteriaColumnOperators[${i}]`} value={criterion.operator} onChange={(e) => setRow(i, { ...row, criterion: { ...criterion, operator: e.target.value } })} aria-label={t('search.operator')}>
                                {operators.map((op) => (
                                  <option key={op} value={op}>
                                    {op}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td>{column && !UNARY.has(criterion.operator) && <CriterionInput db={db} column={column} index={i} criterion={criterion} onChange={(value) => setRow(i, { ...row, criterion: { ...criterion, value } })} />}</td>
                          <td />
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>

              <table className="table table-borderless table-sm w-auto">
                <tbody>
                  <tr>
                    <td>
                      <label htmlFor="dataLabel">{t('zoom.data_label')}</label>
                    </td>
                    <td>
                      <select name="dataLabel" id="dataLabel" value={label} onChange={(e) => setDataLabel(e.target.value)}>
                        <option value="">{t('grid.none')}</option>
                        {columns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <label htmlFor="maxRowPlotLimit">{t('zoom.max_rows')}</label>
                    </td>
                    <td>
                      <input type="number" name="maxPlotLimit" id="maxRowPlotLimit" required min={1} value={maxPlot} onChange={(e) => setMaxPlot(Number(e.target.value) || 1)} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card-footer">
              <input className="btn btn-primary" type="submit" name="zoom_submit" id="inputFormSubmitId" value={tApp('go')} />
            </div>
          </div>
        </form>
      )}

      {plot && (
        <div id="togglesearchformdiv">
          <a
            id="togglesearchformlink"
            href="#toggle"
            onClick={(e) => {
              e.preventDefault()
              setFormShown((shown) => !shown)
            }}
          >
            {formShown ? t('zoom.hide_criteria') : t('zoom.show_criteria')}
          </a>
        </div>
      )}

      <div id="sqlqueryresultsouter">
        {failure && (
          <div className="alert alert-danger" role="alert">
            {failure}
          </div>
        )}
        {saved && <ResultMessage result={saved} />}
      </div>

      {plot && (
        <form name="displayResultForm" id="zoom_display_form" className="ajax" onSubmit={(e) => e.preventDefault()}>
          <div className="card">
            <div className="card-header">{t('zoom.browse_points')}</div>
            <div className="card-body">
              {plot.points.length > 0 && (
                <div className="text-center">
                  <PlotArea plot={plot} resetKey={resetKey} onHelp={() => setHelp(true)} onReset={() => setResetKey((k) => k + 1)} onPointClick={(i) => void openPoint(i)} />
                </div>
              )}
            </div>
          </div>
        </form>
      )}

      <Modal show={help} id="helpModal" title={t('zoom.help_title')} onClose={() => setHelp(false)}>
        <ul>
          {(['help_rows', 'help_hover', 'help_zoom', 'help_reset', 'help_click', 'help_resize'] as const).map((key) => (
            <li key={key}>{t(`zoom.${key}`)}</li>
          ))}
        </ul>
      </Modal>

      <Modal
        show={point !== null}
        id="dataPointModal"
        size="lg"
        title={t('zoom.data_point')}
        onClose={() => setPoint(null)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" id="dataPointSaveButton" disabled={saving} onClick={() => void savePoint()}>
              {tApp('save')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPoint(null)}>
              {tApp('close')}
            </button>
          </>
        }
      >
        {point && <PointForm columns={columns} values={point.edited} onChange={(edited) => setPoint({ ...point, edited })} onSubmit={() => void savePoint()} />}
      </Modal>
    </>
  )
}

/** The plot in its resizable box with the "How to use" link and the "Reset zoom" button, as result_form.twig lays them out. */
function PlotArea({ plot, resetKey, onHelp, onReset, onPointClick }: { plot: Plot; resetKey: number; onHelp: () => void; onReset: () => void; onPointClick: (index: number) => void }) {
  const { t } = useTranslation('sql')
  const [size, setSize] = useState({ width: 600, height: 400 })
  const box = useRef<HTMLDivElement>(null)

  // The box is resized from its corner; the plot takes 96% of it, as zoom_plot_jqplot.js sizes it.
  useEffect(() => {
    const element = box.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.max(200, Math.round(width * 0.96)), height: Math.max(150, Math.round(height * 0.96) - 60) })
    })
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  return (
    <div id="resizer" ref={box} style={{ width: 625, height: 480 }}>
      <a className="text-center" id="help_dialog" href="#help" onClick={(e) => { e.preventDefault(); onHelp() }}>
        {t('zoom.how_to_use')}
      </a>
      <div id="querychart">
        <ScatterChart points={plot.points} xLabel={plot.x} yLabel={plot.y} xKind={plot.xKind} yKind={plot.yKind} width={size.width} height={size.height} resetKey={resetKey} onPointClick={onPointClick} />
      </div>
      <button type="button" className="btn btn-primary button-reset" onClick={onReset}>
        {t('zoom.reset_zoom')}
      </button>
    </div>
  )
}

/** The "Data point content" table: each column with its Null box and its value. */
function PointForm({ columns, values, onChange, onSubmit }: { columns: RelationColumn[]; values: Record<string, string | null>; onChange: (values: Record<string, string | null>) => void; onSubmit: () => void }) {
  const { t } = useTranslation('sql')

  return (
    <div id="dataDisplay">
      <table className="table align-middle">
        <thead>
          <tr>
            <th>{t('search.column')}</th>
            <th>{t('grid.null')}</th>
            <th>{t('search.value')}</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column, i) => {
            const value = values[column.name] ?? null
            const set = (next: string | null) => onChange({ ...values, [column.name]: next })

            return (
              <tr key={column.name} className="noclick">
                <th>{column.name}</th>
                <th>{column.nullable && <input type="checkbox" className="checkbox_null" name={`criteriaColumnNullFlags[${i}]`} id={`edit_fields_null_id_${i}`} checked={value === null} onChange={(e) => set(e.target.checked ? null : '')} aria-label={`${column.name} ${t('grid.null')}`} />}</th>
                <th>
                  {column.enum_values && column.enum_values.length > 0 ? (
                    <select id={`edit_fieldID_${i}`} value={value ?? ''} onChange={(e) => set(e.target.value)} aria-label={column.name}>
                      <option value="" />
                      {column.enum_values.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="textfield"
                      id={`edit_fieldID_${i}`}
                      size={40}
                      value={value ?? ''}
                      onChange={(e) => set(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter saves, as zoom_search.js binds it in the dialog.
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          onSubmit()
                        }
                      }}
                      aria-label={column.name}
                    />
                  )}
                </th>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** How a column plots, as zoom_search.js's getType classes it: dates and times on a time axis, the rest as numbers. */
function axisKind(column: RelationColumn): AxisKind {
  const kind = fieldKind(column)

  return kind === 'date' ? 'date' : kind === 'datetime' || kind === 'time' ? 'datetime' : 'number'
}

/** A value as a position on its axis; NaN for one that cannot be plotted (a text column, a NULL). */
function axisValue(value: string | null, kind: AxisKind, column: RelationColumn): number {
  if (value === null) return NaN
  if (kind === 'number') return parseFloat(value)
  // A time of day plots on 1970-01-01, as getTimeStamp does; the server's text is read as UTC.
  const text = fieldKind(column) === 'time' ? `1970-01-01T${value}` : value.replace(' ', 'T')
  const zone = text.slice(10).match(/([+-])(\d\d):?(\d\d)?$/)
  // PostgreSQL prints a zone as +05 or +05:30; Date.parse wants +05:00.
  const iso = zone ? `${text.slice(0, text.length - zone[0].length)}${zone[1]}${zone[2]}:${zone[3] ?? '00'}` : `${text}${kind === 'date' ? 'T00:00:00' : ''}Z`

  return Date.parse(iso)
}
