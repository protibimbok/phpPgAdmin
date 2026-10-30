import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { preference } from '@/preferences'
import { notify } from '@/notify'
import type { Order, ResultColumn, RowsResult } from '../api'
import DateTimeInput from '../fields/DateTimeInput'
import { useForeignValues, foreignOptions } from '../fields/ForeignSelect'
import { dateFieldClass, dateKind, fieldKind, fractionDigits, hasTimeZone, padFraction } from '../fields/kinds'
import { LIMIT_CHARS, MAX_ROWS, SHOW_BROWSE_COMMENTS } from '../preferences'
import { isBinaryType, isNumericType } from '../sql'
import BrowseForeign from '../fields/BrowseForeign'

/** Where in the result set the grid is and how it is ordered; the page decides what to do about a change. */
export interface GridNav {
  pos: number
  /** Rows per page; null shows every row. */
  maxRows: number | null
  order: Order[]
}

export const ROWS_OPTIONS = [25, 50, 100, 250, 500]

/** The rows a result shows per page, the role's "Number of rows" setting (MaxRows). */
export const defaultMaxRows = (): number => preference<number>(MAX_ROWS)

/**
 * The most rows "Show all" is offered for, as phpMyAdmin offers it only for a result of at most
 * 500 rows (Results.php's has_show_all, with ShowAll off); it still asks before showing them.
 */
export const SHOW_ALL_LIMIT = 500

/** phpMyAdmin's LimitChars: how much of a long text a cell shows in "Partial texts" mode. */
const limitChars = (): number => preference<number>(LIMIT_CHARS)

export interface SortKey {
  label: string
  order: Order[]
}

export interface RowAction {
  label: string
  icon: string
  title?: string
  className?: string
  onClick: (rowIndex: number) => void
}

/** In-place editing of cells: which columns allow it, and what saves a new value. */
export interface CellEditor {
  /** The database the rows come from, for a foreign key's value list. */
  db: string
  canEdit: (column: ResultColumn) => boolean
  /** Rejects when the save failed; the cell then stays open. */
  save: (rowIndex: number, column: ResultColumn, value: string | null) => Promise<void>
}

interface Editing {
  row: number
  col: number
  value: string
  isNull: boolean
  saving: boolean
}

export interface ResultsGridProps {
  result: RowsResult
  nav: GridNav
  onNavigate: (nav: GridNav) => void
  /** The indexes to offer under "Sort by key"; none hides the select. */
  sortKeys?: SortKey[]
  /** Per-row Edit, Copy and Delete; shown when the result is editable. */
  rowActions?: RowAction[]
  /** The "With selected" actions; given the checked row indexes. */
  bulkActions?: { label: string; icon: string; onClick: (rows: number[]) => void }[]
  /** Double-click editing of the cells; left out, the cells are read-only. */
  cellEditor?: CellEditor
  /** Below the grid: phpMyAdmin's "Query results operations" card. */
  footer?: ReactNode
}

/**
 * phpMyAdmin's results grid (display/results/table.twig): the navigation bar above and below
 * (page buttons, page selector, Show all, rows per page, filter, sort by key), the "Extra
 * options" collapse, the sortable headers, the rows with their checkbox and Edit / Copy /
 * Delete, the "With selected" bar.
 */
export default function ResultsGrid({ result, nav, onNavigate, sortKeys, rowActions = [], bulkActions = [], cellEditor, footer }: ResultsGridProps) {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const uniqueId = useId().replace(/:/g, '')
  const [filter, setFilter] = useState('')
  const [extraOpen, setExtraOpen] = useState(false)
  const [fullTexts, setFullTexts] = useState(false)
  const showComments = preference<boolean>(SHOW_BROWSE_COMMENTS)
  const [showBinary, setShowBinary] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<Editing | null>(null)

  // A new result set (another page, a reload after a save or a delete) closes the editor and
  // forgets the ticked rows, whose indexes now point at other rows.
  useEffect(() => {
    setEditing(null)
    setChecked(new Set())
  }, [result])

  const total = result.total_rows
  const pageSize = nav.maxRows
  const pos = result.offset
  const showingAll = pageSize === null
  const pageCount = total !== null && pageSize !== null ? Math.max(1, Math.ceil(total / pageSize)) : null
  const pageNumber = pageSize !== null ? Math.floor(pos / pageSize) + 1 : 1
  const isLastPage = showingAll || (!result.has_more && (total === null || pos + result.row_count >= total))
  const numeric = useMemo(() => result.columns.map((c) => isNumericType(c.type_name)), [result.columns])
  // ORDER BY a name two columns share is ambiguous, so only a column whose name is its own sorts.
  const sortable = useMemo(() => {
    const seen = new Map<string, number>()
    for (const c of result.columns) seen.set(c.name, (seen.get(c.name) ?? 0) + 1)

    return result.columns.map((c) => result.pageable && seen.get(c.name) === 1)
  }, [result.columns, result.pageable])
  const offerShowAll = showingAll || total === null || total <= SHOW_ALL_LIMIT
  const needle = filter.trim().toLowerCase()
  const visibleRows = useMemo(() => {
    const indexed = result.rows.map((row, index) => ({ row, index }))
    if (needle === '') return indexed

    return indexed.filter(({ row }) => row.some((value) => value !== null && value.toLowerCase().includes(needle)))
  }, [result.rows, needle])
  const hasActions = rowActions.length > 0 || bulkActions.length > 0
  const allChecked = visibleRows.length > 0 && visibleRows.every(({ index }) => checked.has(index))

  function go(next: Partial<GridNav>) {
    setChecked(new Set())
    onNavigate({ ...nav, ...next })
  }

  function sort(column: string) {
    const current = nav.order.find((o) => o.name === column)
    // phpMyAdmin's SMART order: a date or time column starts descending (newest first), the
    // rest ascending; a second click turns the order round.
    const meta = result.columns.find((c) => c.name === column)
    const first = meta !== undefined && dateKind(meta) !== null
    go({ order: [{ name: column, desc: current ? !current.desc : first }], pos: 0 })
  }

  function startEditing(row: number, col: number) {
    if (!cellEditor || !cellEditor.canEdit(result.columns[col]) || editing?.saving) return
    const value = result.rows[row][col]
    const column = result.columns[col]
    // A time's fraction is padded to the column's digits before editing, as makegrid does; a JSON document is laid out.
    const text = value === null ? '' : fieldKind(column) === 'json' ? prettyJson(value) : padFraction(value, fractionDigits(column))
    setEditing({ row, col, value: text, isNull: value === null, saving: false })
  }

  async function commitEditing() {
    if (!editing || !cellEditor || editing.saving) return
    const original = result.rows[editing.row][editing.col]
    const next = editing.isNull ? null : editing.value
    if (next === original) {
      setEditing(null)

      return
    }
    setEditing({ ...editing, saving: true })
    try {
      await cellEditor.save(editing.row, result.columns[editing.col], next)
    } catch {
      setEditing((e) => (e ? { ...e, saving: false } : e))
    }
  }

  function toggle(index: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(index)
      else next.delete(index)

      return next
    })
  }

  const navigation = (
    <table className="navigation d-print-none">
      <tbody>
        <tr>
          <td className="navigation_separator" />
          {/* Paging runs the statement again, which only a read-only SELECT may be. */}
          {result.pageable && (
            <>
              {pos > 0 && !showingAll && (
                <>
                  <td>
                    <input type="submit" name="navig" className="btn btn-secondary ajax" value="<<" title={t('grid.begin')} onClick={() => go({ pos: 0 })} />
                  </td>
                  <td>
                    <input type="submit" name="navig" className="btn btn-secondary ajax" value="<" title={t('grid.previous')} onClick={() => go({ pos: Math.max(0, pos - (pageSize ?? 0)) })} />
                  </td>
                </>
              )}
              {pageCount !== null && pageCount > 1 && (
                <td>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <label htmlFor={`pageselector_${uniqueId}`} className="visually-hidden">
                      {t('grid.page_number')}
                    </label>
                    <select
                      id={`pageselector_${uniqueId}`}
                      className="pageselector ajax"
                      name="pos"
                      value={pos}
                      onChange={(e) => go({ pos: Number(e.target.value) })}
                    >
                      {pageOptions(pageCount, pageNumber).map((page) => (
                        <option key={page} value={(page - 1) * (pageSize ?? 0)}>
                          {page}
                        </option>
                      ))}
                    </select>
                  </form>
                </td>
              )}
              {!isLastPage && (
                <>
                  <td>
                    <input type="submit" name="navig" className="btn btn-secondary ajax" value=">" title={t('grid.next')} onClick={() => go({ pos: pos + (pageSize ?? 0) })} />
                  </td>
                  {total !== null && pageSize !== null && (
                    <td>
                      <input
                        type="submit"
                        name="navig"
                        className="btn btn-secondary ajax"
                        value=">>"
                        title={t('grid.end')}
                        onClick={() => go({ pos: Math.max(0, Math.floor((total - 1) / pageSize) * pageSize) })}
                      />
                    </td>
                  )}
                </>
              )}
              {(pageCount === null || pageCount !== 1) && (
                <td>
                  <div className="navigation_separator">|</div>
                </td>
              )}
              {offerShowAll && (
                <>
                  <td>
                    <form onSubmit={(e) => e.preventDefault()}>
                      <input
                        type="checkbox"
                        name="navig"
                        id={`showAll_${uniqueId}`}
                        className="showAllRows"
                        value="all"
                        checked={showingAll}
                        onChange={(e) => {
                          // phpMyAdmin's "Prompt to confirm on Show All".
                          if (e.target.checked && !window.confirm(t('grid.show_all_warning'))) return
                          go({ maxRows: e.target.checked ? null : defaultMaxRows(), pos: 0 })
                        }}
                      />
                      <label htmlFor={`showAll_${uniqueId}`}>{t('grid.show_all')}</label>
                    </form>
                  </td>
                  <td>
                    <div className="navigation_separator">|</div>
                  </td>
                </>
              )}
              <td className="navigation_goto">
                <form className="maxRowsForm" onSubmit={(e) => e.preventDefault()}>
                  <label htmlFor={`sessionMaxRowsSelect_${uniqueId}`}>{t('grid.number_of_rows')}</label>
                  <select
                    className="autosubmit"
                    name="session_max_rows"
                    id={`sessionMaxRowsSelect_${uniqueId}`}
                    value={showingAll ? '' : String(pageSize)}
                    onChange={(e) => go({ maxRows: Number(e.target.value), pos: 0 })}
                  >
                    {showingAll && (
                      <option value="" disabled>
                        {t('grid.all')}
                      </option>
                    )}
                    {[...new Set([...ROWS_OPTIONS, ...(pageSize !== null ? [pageSize] : [])])]
                      .sort((a, b) => a - b)
                      .map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                  </select>
                </form>
              </td>
              <td className="navigation_separator" />
            </>
          )}
          <td className="largescreenonly">
            <span>{t('grid.filter_rows')}</span>
            <input
              type="text"
              className="filter_rows"
              placeholder={t('grid.search_this_table')}
              aria-label={t('grid.filter_rows')}
              data-for={uniqueId}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          </td>
          <td className="largescreenonly">
            {sortKeys && sortKeys.length > 0 && (
              <form className="d-print-none" onSubmit={(e) => e.preventDefault()}>
                {t('grid.sort_by_key')}
                <select
                  name="sql_query"
                  className="autosubmit"
                  aria-label={t('grid.sort_by_key')}
                  value={sortKeys.findIndex((key) => sameOrder(key.order, nav.order))}
                  onChange={(e) => {
                    const index = Number(e.target.value)
                    go({ order: index < 0 ? [] : sortKeys[index].order, pos: 0 })
                  }}
                >
                  <option value={-1}>{t('grid.none')}</option>
                  {sortKeys.map((key, index) => (
                    <option key={key.label} value={index}>
                      {key.label}
                    </option>
                  ))}
                </select>
              </form>
            )}
          </td>
          <td className="navigation_separator" />
        </tr>
      </tbody>
    </table>
  )

  return (
    <div className="sqlqueryresults ajax">
      {navigation}

      <form name="displayOptionsForm" className="ajax d-print-none" onSubmit={(e) => e.preventDefault()}>
        <div className="mb-3">
          <button className="btn btn-sm btn-secondary" type="button" id={`extraOptionsButton_${uniqueId}`} aria-expanded={extraOpen} onClick={() => setExtraOpen((o) => !o)}>
            {t('grid.extra_options')}
          </button>
        </div>
        <div className={`collapse mb-3${extraOpen ? ' show' : ''}`}>
          <div className="card">
            <div className="card-body">
              <div className="row">
                <fieldset className="col-auto">
                  <div className="form-check">
                    <input className="form-check-input" type="radio" name="pftext" id={`partialFulltextRadioP${uniqueId}`} value="P" checked={!fullTexts} onChange={() => setFullTexts(false)} />
                    <label className="form-check-label" htmlFor={`partialFulltextRadioP${uniqueId}`}>
                      {t('grid.partial_texts')}
                    </label>
                  </div>
                  <div className="form-check">
                    <input className="form-check-input" type="radio" name="pftext" id={`partialFulltextRadioF${uniqueId}`} value="F" checked={fullTexts} onChange={() => setFullTexts(true)} />
                    <label className="form-check-label" htmlFor={`partialFulltextRadioF${uniqueId}`}>
                      {t('grid.full_texts')}
                    </label>
                  </div>
                </fieldset>
                <fieldset className="col-auto">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" name="display_binary" id={`display_binary_${uniqueId}`} checked={showBinary} onChange={(e) => setShowBinary(e.target.checked)} />
                    <label className="form-check-label" htmlFor={`display_binary_${uniqueId}`}>
                      {t('grid.show_binary')}
                    </label>
                  </div>
                </fieldset>
              </div>
            </div>
            <div className="card-footer">
              <input className="btn btn-primary" type="submit" value={tApp('go')} onClick={() => setExtraOpen(false)} />
            </div>
          </div>
        </div>
      </form>

      <form name="resultsForm" id={`resultsForm_${uniqueId}`} className="ajax" onSubmit={(e) => e.preventDefault()}>
        <div className="table-responsive-md">
          <table className="table table-striped table-hover table-sm table_results data ajax w-auto" data-uniqueid={uniqueId}>
            <thead>
              <tr>
                {hasActions && (
                  <th className="column_action position-sticky d-print-none" colSpan={1 + rowActions.length}>
                    <a
                      href="#texts"
                      title={fullTexts ? t('grid.partial_texts') : t('grid.full_texts')}
                      onClick={(e) => {
                        e.preventDefault()
                        setFullTexts((f) => !f)
                      }}
                    >
                      <Icon name={fullTexts ? 's_partialtext' : 's_fulltext'} title={fullTexts ? t('grid.partial_texts') : t('grid.full_texts')} />
                    </a>
                  </th>
                )}
                {result.columns.map((column, i) => {
                  const sorted = sortable[i] ? nav.order.find((o) => o.name === column.name) : undefined

                  return (
                    <th
                      key={i}
                      className={`draggable position-sticky bg-body${numeric[i] ? ' text-end' : ''}${sortable[i] ? ' column_heading marker pointer' : ''}`}
                      data-column={column.name}
                    >
                      {sortable[i] ? (
                        <a
                          href="#sort"
                          className="sortlink"
                          title={sorted?.desc ? t('grid.ascending') : t('grid.descending')}
                          onClick={(e) => {
                            e.preventDefault()
                            sort(column.name)
                          }}
                        >
                          {column.name}
                          {sorted && <Icon name={sorted.desc ? 's_desc' : 's_asc'} className="soimg" title={sorted.desc ? t('grid.descending') : t('grid.ascending')} />}
                        </a>
                      ) : (
                        column.name
                      )}
                      {showComments && column.comment && <ColumnComment comment={column.comment} />}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ row, index }) => (
                <tr key={index}>
                  {hasActions && (
                    <td className="text-center d-print-none">
                      <input
                        type="checkbox"
                        className="multi_checkbox checkall"
                        id={`id_rows_to_delete${index}_${uniqueId}`}
                        name={`rows_to_delete[${index}]`}
                        checked={checked.has(index)}
                        onChange={(e) => toggle(index, e.target.checked)}
                      />
                    </td>
                  )}
                  {rowActions.map((action) => (
                    <td key={action.label} className="text-center d-print-none edit_row_anchor">
                      <span className="text-nowrap">
                        <a
                          href={`#${action.label}`}
                          className={action.className}
                          title={action.title}
                          onClick={(e) => {
                            e.preventDefault()
                            action.onClick(index)
                          }}
                        >
                          <Icon name={action.icon} /> {action.label}
                        </a>
                      </span>
                    </td>
                  ))}
                  {row.map((value, i) =>
                    editing && editing.row === index && editing.col === i ? (
                      <td key={i} data-type={result.columns[i].type_name} data-decimals={fractionDigits(result.columns[i])} className={`edited ${cellClasses(result.columns[i], numeric[i], fullTexts)}`}>
                        <CellEditorBox
                          db={cellEditor?.db ?? ''}
                          editing={editing}
                          column={result.columns[i]}
                          onChange={(patch) => setEditing((e) => (e ? { ...e, ...patch } : e))}
                          onCommit={() => void commitEditing()}
                          onCancel={() => setEditing(null)}
                          nullLabel={t('grid.null')}
                        />
                      </td>
                    ) : (
                      <Cell
                        key={i}
                        value={value}
                        column={result.columns[i]}
                        numeric={numeric[i]}
                        fullTexts={fullTexts}
                        showBinary={showBinary}
                        onDoubleClick={cellEditor && cellEditor.canEdit(result.columns[i]) ? () => startEditing(index, i) : undefined}
                      />
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {hasActions && (
          <div className="d-print-none">
            <Icon name="select_all_arrow" title={tApp('with_selected')} />
            <input
              type="checkbox"
              id={`resultsForm_${uniqueId}_checkall`}
              className="checkall_box"
              title={tApp('check_all')}
              checked={allChecked}
              onChange={(e) => setChecked(e.target.checked ? new Set(visibleRows.map(({ index }) => index)) : new Set())}
            />
            <label htmlFor={`resultsForm_${uniqueId}_checkall`}>{tApp('check_all')}</label>
            <em className="with-selected">{tApp('with_selected')}</em>
            {bulkActions.map((action) => (
              <button
                key={action.label}
                className="btn btn-link mult_submit"
                type="button"
                title={action.label}
                onClick={() => (checked.size === 0 ? notify(t('grid.no_row_selected'), 'notice') : action.onClick([...checked].sort((a, b) => a - b)))}
              >
                <Icon name={action.icon} title={action.label} /> {action.label}
              </button>
            ))}
          </div>
        )}
      </form>

      {navigation}

      {footer}
    </div>
  )
}

interface CellProps {
  value: string | null
  column: ResultColumn
  numeric: boolean
  fullTexts: boolean
  showBinary: boolean
  onDoubleClick?: () => void
}

/**
 * The classes phpMyAdmin's Results.php gives a cell for its type: datefield / timefield /
 * datetimefield (never wrapped), enum, relation for a foreign key, hex for a binary, text with
 * pre_wrap for the rest of the strings and text-nowrap for numbers.
 */
/** phpMyAdmin's comment_for_row.twig: a column's comment under its name, cut at LimitChars. */
function ColumnComment({ comment }: { comment: string }) {
  const limit = limitChars()

  return (
    <>
      <br />
      <span className="tblcomment" title={comment}>
        {comment.length > limit ? `${comment.slice(0, limit)}…` : comment}
      </span>
    </>
  )
}

function cellClasses(column: ResultColumn, numeric: boolean, fullTexts: boolean): string {
  const kind = fieldKind(column)
  const classes: string[] = []
  const date = dateFieldClass(column)
  if (date) classes.push(date, 'text-nowrap')
  else if (kind === 'enum') classes.push('text', 'pre_wrap', 'enum')
  else if (kind === 'binary') classes.push('text', 'hex')
  else if (numeric) classes.push('text-nowrap')
  else classes.push(fullTexts ? 'pre_wrap' : 'text-nowrap')
  if (column.foreign_key) classes.push('relation')

  return classes.join(' ')
}

/** One value: NULL in italics, numbers at the end, long texts cut unless "Full texts" is on. */
function Cell({ value, column, numeric, fullTexts, showBinary, onDoubleClick }: CellProps) {
  const { t } = useTranslation('sql')
  const typeName = column.type_name
  const editable = onDoubleClick ? ' grid_edit' : ''
  const classes = cellClasses(column, numeric, fullTexts)
  const decimals = fractionDigits(column)

  if (value === null) {
    return (
      <td data-type={typeName} data-decimals={decimals} className={`${numeric ? 'text-end ' : ''}null ${classes}${editable}`} onDoubleClick={onDoubleClick}>
        <em>{t('grid.null')}</em>
      </td>
    )
  }

  if (value === '') {
    return <td data-type={typeName} data-decimals={decimals} className={`${numeric ? 'text-end ' : ''}${classes}${editable}`} onDoubleClick={onDoubleClick} />
  }

  if (isBinaryType(typeName) && !showBinary) {
    return (
      <td data-type={typeName} className="text-start hex text-nowrap">
        [BLOB - {formatBytes(value)}]
      </td>
    )
  }

  const limit = limitChars()
  const truncated = !fullTexts && value.length > limit
  const shown = truncated ? `${value.slice(0, limit)}...` : value

  return (
    <td
      data-type={typeName}
      data-decimals={decimals}
      data-originallength={value.length}
      className={`${numeric ? 'text-end' : 'text-start'}${truncated ? ' truncated' : ''} ${classes}${editable}`}
      onDoubleClick={onDoubleClick}
    >
      {shown}
    </td>
  )
}

/** A JSON document laid out over lines for editing, as makegrid shows one; left alone when it does not parse. */
function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 4)
  } catch {
    return value
  }
}

interface CellEditorBoxProps {
  db: string
  editing: Editing
  column: ResultColumn
  onChange: (patch: Partial<Editing>) => void
  onCommit: () => void
  onCancel: () => void
  nullLabel: string
}

/**
 * phpMyAdmin's cell editor (makegrid's .cEdit): the value in a box, a NULL checkbox for a
 * nullable column, and under it what the column's type calls for: an enum's select, a foreign
 * key's dropdown, the date or time picker opened at once. Enter saves, Escape gives up, leaving
 * the cell saves what changed.
 */
function CellEditorBox({ db, editing, column, onChange, onCommit, onCancel, nullLabel }: CellEditorBoxProps) {
  const { t } = useTranslation('sql')
  const box = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const kind = fieldKind(column)
  const picker = dateKind(column)
  const foreign = useForeignValues(db, column.foreign_key)
  // While the Browse foreign values window is open, focus is in it, which is not leaving the editor.
  const [browsing, setBrowsing] = useState(false)
  const multiline = kind === 'text' || kind === 'json' || editing.value.includes('\n')

  useEffect(() => {
    box.current?.focus()
    box.current?.setSelectionRange(box.current.value.length, box.current.value.length)
  }, [])

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
      e.preventDefault()
      onCommit()
    }
  }

  const onBlur = (e: { relatedTarget: EventTarget | null }) => {
    // Leaving for the NULL box, a select or the picker is not leaving the editor.
    if (browsing) return
    if (!(e.relatedTarget instanceof HTMLElement && e.relatedTarget.closest('.cEdit'))) onCommit()
  }
  const common = {
    ref: box,
    className: `edit_box${editing.saving ? ' edit_box_posting' : ''}`,
    value: editing.value,
    onChange: (e: { target: { value: string } }) => onChange({ value: e.target.value, isNull: false }),
    onKeyDown,
    onBlur,
    'aria-label': column.name,
  }
  const setValue = (value: string) => onChange({ value, isNull: false })

  const nullBox = column.nullable && (
    <div className="null_div">
      <label>
        {nullLabel}:
        <input type="checkbox" checked={editing.isNull} onChange={(e) => onChange({ isNull: e.target.checked, value: e.target.checked ? '' : editing.value })} onKeyDown={onKeyDown} />
      </label>
    </div>
  )
  const hint = (
    <div className="cell_edit_hint">
      {t('fields.cell_edit_hint')}
      <br />
      {t('fields.cell_edit_hint_newline')}
    </div>
  )

  let area: ReactNode
  if (column.foreign_key) {
    area = (
      <>
        {foreign?.truncated && column.foreign_key ? (
          <>
            <a
              className="ajax browse_foreign"
              href="#browse-foreign"
              onClick={(e) => {
                e.preventDefault()
                setBrowsing(true)
              }}
            >
              <Icon name="b_browse" title={t('fields.browse_foreign')} />
            </a>
            <BrowseForeign
              show={browsing}
              db={db}
              foreignKey={column.foreign_key}
              value={editing.value}
              onPick={(key) => {
                setBrowsing(false)
                setValue(key)
                box.current?.focus()
              }}
              onClose={() => {
                setBrowsing(false)
                box.current?.focus()
              }}
            />
          </>
        ) : (
          <select value={editing.value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} aria-label={column.name}>
            {foreignOptions(foreign)}
          </select>
        )}
        {nullBox}
        {hint}
      </>
    )
  } else if (kind === 'enum') {
    area = (
      <>
        <select value={editing.value} onChange={(e) => setValue(e.target.value)} onKeyDown={onKeyDown} aria-label={column.name}>
          {(column.enum_values ?? []).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {nullBox}
        {hint}
      </>
    )
  } else {
    area = nullBox ? (
      <>
        {nullBox}
        {picker === null && hint}
      </>
    ) : null
  }

  return (
    <div
      className="cEdit"
      onMouseDown={(e) => {
        // A click on the editor's chrome keeps the focus (and so the editor) where it is.
        if (!(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement)) e.preventDefault()
      }}
    >
      {picker !== null ? (
        <DateTimeInput kind={picker} decimals={fractionDigits(column)} withTimeZone={hasTimeZone(column)} inline inputRef={box} className={common.className} value={editing.value} onValueChange={setValue} onKeyDown={onKeyDown} onBlur={onBlur} aria-label={column.name}>
          {area && <div className="edit_area">{area}</div>}
        </DateTimeInput>
      ) : (
        <>
          {multiline ? <textarea {...common} rows={4} /> : <input type="text" {...common} />}
          {area && <div className="edit_area">{area}</div>}
        </>
      )}
    </div>
  )
}

/** The length of a bytea value in its hex form, as a size. */
function formatBytes(hex: string): string {
  const bytes = hex.startsWith('\\x') ? (hex.length - 2) / 2 : hex.length
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

/**
 * The page numbers phpMyAdmin's page selector offers: every page when there are few, otherwise
 * the first and last few, the pages around the current one, and sparser steps in between.
 */
function pageOptions(pageCount: number, current: number): number[] {
  if (pageCount <= 200) return Array.from({ length: pageCount }, (_, i) => i + 1)

  const pages = new Set<number>()
  for (let i = 1; i <= 5; i++) pages.add(i)
  for (let i = pageCount - 4; i <= pageCount; i++) pages.add(i)
  for (let i = current - 5; i <= current + 5; i++) if (i >= 1 && i <= pageCount) pages.add(i)
  for (let step = 10; step < pageCount; step *= 10) {
    for (let i = step; i <= pageCount; i += step) pages.add(i)
  }

  return [...pages].sort((a, b) => a - b)
}

function sameOrder(a: Order[], b: Order[]): boolean {
  return a.length === b.length && a.every((o, i) => o.name === b[i].name && Boolean(o.desc) === Boolean(b[i].desc))
}
