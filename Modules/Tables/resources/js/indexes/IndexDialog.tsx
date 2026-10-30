import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { exclusionOptions, indexes as indexesOf, tableModifiedSql, updateTable, type Column, type IndexColumnData, type IndexData, type IndexProperties, type TableOptions } from '../api'

export interface IndexDialogProps {
  show: boolean
  db: string
  scid: number
  tid: number
  columns: Column[]
  options: TableOptions | null
  /** The index to edit; a new one when left out. */
  index?: IndexProperties | null
  /** How many column rows a new index starts with. */
  initialColumns?: number
  /** Whether the table has a primary key already, which hides the PRIMARY choice. */
  hasPrimary: boolean
  onClose: () => void
  onSaved: () => void
}

type Choice = 'PRIMARY' | 'INDEX' | 'UNIQUE'

/** One row of the columns table: a column of the table, or an expression. */
interface Row {
  /** The column's name; '' for "-- Ignore --". */
  name: string
  isExp: boolean
  expression: string
  opClass: string
  collation: string
  desc: boolean
  nullsFirst: boolean
}

/** The value of the column select's "-- Expression --" choice. */
const EXPRESSION = '\u0000expression'

/** The access methods whose indexes a table can be clustered on (pg_am.amclusterable). */
const CLUSTERABLE = ['btree', 'gist']

/** The storage parameters each access method takes (pgAdmin's index "With" fieldset). */
const PARAMETERS: Record<string, string[]> = {
  btree: ['fillfactor', 'deduplicate_items'],
  hash: ['fillfactor'],
  gist: ['fillfactor', 'buffering'],
  spgist: ['fillfactor'],
  gin: ['fastupdate', 'gin_pending_list_limit'],
  brin: ['pages_per_range', 'autosummarize'],
}

/** What PostgreSQL assumes for an on/off parameter the index does not set. */
const BOOLEAN_DEFAULTS = { deduplicate_items: true, fastupdate: true, autosummarize: false } as const
type BooleanParameter = keyof typeof BOOLEAN_DEFAULTS

/** The type's default collation, which an index column needs no COLLATE for. */
const DEFAULT_COLLATION = 'pg_catalog."default"'

const emptyRow = (name = ''): Row => ({ name, isExp: false, expression: '', opClass: '', collation: '', desc: false, nullsFirst: false })

/**
 * phpMyAdmin's index dialog (modals/index_dialog_modal.twig with table/index_form.twig): the
 * index name, its choice (PRIMARY, INDEX, UNIQUE), the advanced options folded away (here
 * pgAdmin's index fields where phpMyAdmin has the key block size, type, parser and comment:
 * the access method, tablespace, INCLUDE columns, the method's storage parameters, WHERE,
 * comment, CLUSTER ON and CONCURRENTLY), the columns or expressions with their operator class,
 * collation, order and NULLs placement, and "Add N column(s) to index". Go saves through the
 * index node (or the table node for a primary key), Preview SQL shows the statements.
 */
export default function IndexDialog({ show, db, scid, tid, columns, options, index, initialColumns = 1, hasPrimary, onClose, onSaved }: IndexDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState('')
  const [choice, setChoice] = useState<Choice>('INDEX')
  const [advanced, setAdvanced] = useState(false)
  const [method, setMethod] = useState('btree')
  const [tablespace, setTablespace] = useState('')
  const [include, setInclude] = useState<string[]>([])
  const [fillfactor, setFillfactor] = useState('')
  const [pendingListLimit, setPendingListLimit] = useState('')
  const [pagesPerRange, setPagesPerRange] = useState('')
  const [buffering, setBuffering] = useState('')
  const [flags, setFlags] = useState<Record<BooleanParameter, boolean>>({ ...BOOLEAN_DEFAULTS })
  const [where, setWhere] = useState('')
  const [comment, setComment] = useState('')
  const [clustered, setClustered] = useState(false)
  const [concurrently, setConcurrently] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [addCount, setAddCount] = useState(1)
  const [opClasses, setOpClasses] = useState<string[]>([])
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    const text = (value: number | string | null | undefined) => (value === null || value === undefined ? '' : String(value))
    if (index) {
      setName(index.name)
      setChoice(index.indisunique ? 'UNIQUE' : 'INDEX')
      setMethod(index.amname)
      setTablespace(index.spcname ?? '')
      setInclude(index.include ?? [])
      setFillfactor(text(index.fillfactor))
      setPendingListLimit(text(index.gin_pending_list_limit))
      setPagesPerRange(text(index.pages_per_range))
      setBuffering(index.buffering ?? '')
      setFlags({
        deduplicate_items: index.deduplicate_items ?? BOOLEAN_DEFAULTS.deduplicate_items,
        fastupdate: index.fastupdate ?? BOOLEAN_DEFAULTS.fastupdate,
        autosummarize: index.autosummarize ?? BOOLEAN_DEFAULTS.autosummarize,
      })
      setWhere(index.indconstraint ?? '')
      setComment(index.description ?? '')
      setClustered(Boolean(index.indisclustered))
      setRows(
        index.columns.map((c) => ({
          name: c.is_exp ? '' : c.colname,
          isExp: Boolean(c.is_exp),
          expression: c.is_exp ? c.colname : '',
          opClass: c.op_class ?? '',
          collation: c.collspcname && c.collspcname !== DEFAULT_COLLATION ? c.collspcname : '',
          desc: Boolean(c.sort_order),
          nullsFirst: Boolean(c.nulls),
        })),
      )
    } else {
      setName('')
      setChoice('INDEX')
      setMethod('btree')
      setTablespace('')
      setInclude([])
      setFillfactor('')
      setPendingListLimit('')
      setPagesPerRange('')
      setBuffering('')
      setFlags({ ...BOOLEAN_DEFAULTS })
      setWhere('')
      setComment('')
      setClustered(false)
      setRows(Array.from({ length: Math.max(1, initialColumns) }, (_, i) => emptyRow(columns[i]?.name ?? '')))
    }
    setConcurrently(false)
    setAdvanced(false)
    setAddCount(1)
  }, [show, index, initialColumns, columns])

  // The operator classes the access method offers besides each type's default one.
  useEffect(() => {
    if (!show) return
    let stale = false
    exclusionOptions(db, scid, tid, method, []).then(
      (found) => {
        if (!stale) setOpClasses(found.oper_classes)
      },
      () => {
        if (!stale) setOpClasses([])
      },
    )

    return () => {
      stale = true
    }
  }, [show, db, scid, tid, method])

  const primary = choice === 'PRIMARY'
  const btree = method === 'btree'
  const parameters = primary ? ['fillfactor'] : (PARAMETERS[method] ?? [])
  const takesInclude = primary || (options?.include_methods ?? ['btree', 'gist', 'spgist']).includes(method)
  const tablespaces = (options?.tablespaces ?? []).filter((space) => space !== 'pg_global')
  const chosen = rows.filter((row) => (row.isExp ? row.expression.trim() !== '' : row.name !== ''))
  const collatable = (row: Row) => row.isExp || (columns.find((c) => c.name === row.name)?.collspcname ?? '') !== ''

  /** An on/off parameter goes out when it differs from what the index has now (PostgreSQL's default for a new one). */
  function flag(param: BooleanParameter): boolean | undefined {
    const was = index && index.amname === method ? index[param] : null
    const value = flags[param]
    if (was === null || was === undefined) return value === BOOLEAN_DEFAULTS[param] ? undefined : value

    return value
  }

  function indexData(): IndexData {
    const has = (param: string) => parameters.includes(param)
    const data: IndexData = {
      name: name || undefined,
      amname: method,
      indisunique: choice === 'UNIQUE',
      isconcurrent: !index && concurrently ? true : undefined,
      columns: chosen.map(
        (row): IndexColumnData => ({
          colname: row.isExp ? row.expression.trim() : row.name,
          is_exp: row.isExp,
          op_class: row.opClass || undefined,
          collspcname: collatable(row) ? row.collation || undefined : undefined,
          sort_order: btree ? row.desc : undefined,
          nulls: btree ? row.nullsFirst : undefined,
        }),
      ),
      include: takesInclude ? include : [],
      indconstraint: where || undefined,
      fillfactor: has('fillfactor') ? fillfactor || undefined : undefined,
      deduplicate_items: has('deduplicate_items') ? flag('deduplicate_items') : undefined,
      fastupdate: has('fastupdate') ? flag('fastupdate') : undefined,
      gin_pending_list_limit: has('gin_pending_list_limit') ? pendingListLimit || undefined : undefined,
      buffering: has('buffering') ? buffering || undefined : undefined,
      pages_per_range: has('pages_per_range') ? pagesPerRange || undefined : undefined,
      autosummarize: has('autosummarize') ? flag('autosummarize') : undefined,
      spcname: tablespace || undefined,
      description: index ? comment : comment || undefined,
      // CLUSTER ON marks the index the table is clustered by; only B-tree and GiST indexes can be.
      indisclustered: CLUSTERABLE.includes(method) ? clustered : false,
    }

    return data
  }

  const primaryChanges = () => ({
    primary_key: {
      added: [
        {
          name: name || undefined,
          columns: chosen.filter((row) => !row.isExp).map((row) => ({ column: row.name })),
          include,
          fillfactor: fillfactor || undefined,
          spcname: tablespace || undefined,
          comment: comment || undefined,
        },
      ],
    },
  })

  function showPreview() {
    setPreview({ sql: null, error: null })
    const promise = primary ? tableModifiedSql(db, scid, primaryChanges(), tid) : indexesOf(db, scid, tid).modifiedSql(indexData(), index?.oid)
    promise.then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  async function save() {
    if (chosen.length === 0) {
      notifyError(t('index_dialog.no_columns'))

      return
    }
    setBusy(true)
    try {
      let message = tApp('query_executed')
      if (primary) {
        await updateTable(db, scid, tid, primaryChanges())
      } else if (index) {
        await indexesOf(db, scid, tid).update(index.oid, indexData())
      } else {
        // A new index is announced by the name it got, PostgreSQL's own when none was typed.
        const node = await indexesOf(db, scid, tid).create(indexData())
        message = t('index_dialog.created', { name: node.label })
      }
      notifySuccess(message)
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const updateRow = (i: number, patch: Partial<Row>) => setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  function changeMethod(am: string) {
    setMethod(am)
    // The operator classes are the method's own; each column starts again from its type's default.
    setRows((current) => current.map((row) => ({ ...row, opClass: '' })))
  }

  /** One phpMyAdmin index_info row: the bold label over its control. */
  const field = (id: string, label: string, control: ReactNode) => (
    <div>
      <div className="label">
        <strong>
          <label htmlFor={id}>{label}</label>
        </strong>
      </div>
      {control}
    </div>
  )

  const checkbox = (id: string, label: ReactNode, checked: boolean, onChange: (checked: boolean) => void) => (
    <div>
      <div className="form-check mt-2">
        <input className="form-check-input" type="checkbox" id={id} checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <label className="form-check-label" htmlFor={id}>
          {label}
        </label>
      </div>
    </div>
  )

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="indexDialogModal"
        size="lg"
        title={index ? t('index_dialog.edit_title') : t('index_dialog.add_title')}
        footer={
          <>
            <button type="button" className="btn btn-primary" id="indexDialogModalGoButton" onClick={() => void save()} disabled={busy}>
              {tApp('go')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={showPreview}>
              {tApp('preview_sql')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {tApp('close')}
            </button>
          </>
        }
      >
        <form name="index_frm" id="index_frm" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <fieldset className="pma-fieldset" id="index_edit_fields">
            <div className="index_info">
              {field('input_index_name', t('index_dialog.name'), <input type="text" name="index[Key_name]" id="input_index_name" size={25} maxLength={63} value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />)}

              {field(
                'select_index_choice',
                t('index_dialog.choice'),
                <select name="index[Index_choice]" id="select_index_choice" value={choice} onChange={(e) => setChoice(e.target.value as Choice)} disabled={Boolean(index)}>
                  {!hasPrimary && !index && <option value="PRIMARY">PRIMARY</option>}
                  <option value="INDEX">INDEX</option>
                  <option value="UNIQUE">UNIQUE</option>
                </select>,
              )}

              <div className="mb-3">
                <button className="btn btn-sm btn-secondary" type="button" aria-expanded={advanced} aria-controls="advancedOptions" onClick={() => setAdvanced((o) => !o)}>
                  {t('index_dialog.advanced')}
                </button>
              </div>
              <div className={`collapse mb-3${advanced ? ' show' : ''}`} id="advancedOptions">
                {!primary &&
                  field(
                    'select_index_type',
                    t('index_dialog.type'),
                    <select name="index[Index_type]" id="select_index_type" value={method} onChange={(e) => changeMethod(e.target.value)}>
                      {[...new Set([method, ...(options?.index_methods ?? ['btree'])])].map((am) => (
                        <option key={am} value={am}>
                          {am.toUpperCase()}
                        </option>
                      ))}
                    </select>,
                  )}
                {field(
                  'select_index_tablespace',
                  t('index_dialog.tablespace'),
                  <select name="index[Tablespace]" id="select_index_tablespace" value={tablespace} onChange={(e) => setTablespace(e.target.value)}>
                    <option value="" />
                    {[...new Set([...(tablespace ? [tablespace] : []), ...tablespaces])].map((space) => (
                      <option key={space} value={space}>
                        {space}
                      </option>
                    ))}
                  </select>,
                )}
                {takesInclude &&
                  field(
                    'select_index_include',
                    t('index_dialog.include'),
                    <select name="index[Include][]" id="select_index_include" multiple size={Math.min(5, Math.max(2, columns.length))} value={include} onChange={(e) => setInclude(Array.from(e.target.selectedOptions, (o) => o.value))}>
                      {columns.map((column) => (
                        <option key={column.attnum} value={column.name}>
                          {column.name} [{column.displaytypname}]
                        </option>
                      ))}
                    </select>,
                  )}
                {parameters.includes('fillfactor') && field('input_fillfactor', t('index_dialog.fillfactor'), <input type="text" name="index[Fillfactor]" id="input_fillfactor" size={30} value={fillfactor} onChange={(e) => setFillfactor(e.target.value)} />)}
                {parameters.includes('gin_pending_list_limit') && field('input_gin_pending_list_limit', t('index_dialog.gin_pending_list_limit'), <input type="text" name="index[Gin_pending_list_limit]" id="input_gin_pending_list_limit" size={30} value={pendingListLimit} onChange={(e) => setPendingListLimit(e.target.value)} />)}
                {parameters.includes('pages_per_range') && field('input_pages_per_range', t('index_dialog.pages_per_range'), <input type="text" name="index[Pages_per_range]" id="input_pages_per_range" size={30} value={pagesPerRange} onChange={(e) => setPagesPerRange(e.target.value)} />)}
                {parameters.includes('buffering') &&
                  field(
                    'select_buffering',
                    t('index_dialog.buffering'),
                    <select name="index[Buffering]" id="select_buffering" value={buffering} onChange={(e) => setBuffering(e.target.value)}>
                      <option value="" />
                      <option value="auto">AUTO</option>
                      <option value="on">ON</option>
                      <option value="off">OFF</option>
                    </select>,
                  )}
                {!primary && field('input_where', t('index_dialog.where'), <input type="text" name="index[Where]" id="input_where" size={30} value={where} onChange={(e) => setWhere(e.target.value)} />)}
                {field('input_index_comment', t('index_dialog.comment'), <input type="text" name="index[Index_comment]" id="input_index_comment" size={30} maxLength={1024} value={comment} onChange={(e) => setComment(e.target.value)} />)}
                {(['deduplicate_items', 'fastupdate', 'autosummarize'] as const)
                  .filter((param) => parameters.includes(param))
                  .map((param) => (
                    <Fragment key={param}>{checkbox(`input_${param}`, t(`index_dialog.${param}`), flags[param], (checked) => setFlags((current) => ({ ...current, [param]: checked })))}</Fragment>
                  ))}
                {!primary && CLUSTERABLE.includes(method) && checkbox('input_clustered', t('index_dialog.clustered'), clustered, setClustered)}
                {!primary && !index && checkbox('input_concurrently', t('index_dialog.concurrently'), concurrently, setConcurrently)}
              </div>

              <div className="clearfloat" />

              <table className="table align-middle" id="index_columns">
                <thead>
                  <tr>
                    <th />
                    <th>{t('index_dialog.column')}</th>
                    {!primary && <th>{t('index_dialog.oper_class')}</th>}
                    {!primary && <th>{t('index_dialog.collation')}</th>}
                    {!primary && btree && <th>{t('index_dialog.order')}</th>}
                    {!primary && btree && <th>{t('index_dialog.nulls')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr className="noclick" key={i}>
                      <td>
                        <span className="drag_icon" title={t('index_dialog.drag')} />
                      </td>
                      <td>
                        <select
                          name="index[columns][names][]"
                          aria-label={t('index_dialog.column')}
                          value={row.isExp ? EXPRESSION : row.name}
                          onChange={(e) => (e.target.value === EXPRESSION ? updateRow(i, { isExp: true, name: '' }) : updateRow(i, { isExp: false, name: e.target.value, collation: '' }))}
                        >
                          <option value="">-- {t('index_dialog.ignore')} --</option>
                          {columns.map((column) => (
                            <option key={column.attnum} value={column.name}>
                              {column.name} [{column.displaytypname}]
                            </option>
                          ))}
                          {!primary && <option value={EXPRESSION}>-- {t('index_dialog.expression')} --</option>}
                        </select>
                        {row.isExp && !primary && (
                          <input type="text" className="ms-1" name="index[columns][expressions][]" size={20} dir="ltr" placeholder="lower(email)" aria-label={t('index_dialog.expression')} value={row.expression} onChange={(e) => updateRow(i, { expression: e.target.value })} />
                        )}
                      </td>
                      {!primary && (
                        <td>
                          <select name="index[columns][op_classes][]" aria-label={t('index_dialog.oper_class')} value={row.opClass} onChange={(e) => updateRow(i, { opClass: e.target.value })}>
                            <option value="">{t('index_dialog.default_class')}</option>
                            {[...new Set([...(row.opClass ? [row.opClass] : []), ...opClasses])].map((opc) => (
                              <option key={opc} value={opc}>
                                {opc}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {!primary && (
                        <td>
                          {collatable(row) && (
                            <select name="index[columns][collations][]" aria-label={t('index_dialog.collation')} value={row.collation} onChange={(e) => updateRow(i, { collation: e.target.value })}>
                              <option value="">{t('index_dialog.default_class')}</option>
                              {[...new Set([...(row.collation ? [row.collation] : []), ...(options?.collations ?? [])])].map((collation) => (
                                <option key={collation} value={collation}>
                                  {collation}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      )}
                      {!primary && btree && (
                        <td>
                          {/* DESC puts NULLs first by default, as PostgreSQL does. */}
                          <select name="index[columns][order][]" aria-label={t('index_dialog.order')} value={row.desc ? 'DESC' : 'ASC'} onChange={(e) => updateRow(i, { desc: e.target.value === 'DESC', nullsFirst: e.target.value === 'DESC' })}>
                            <option value="ASC">ASC</option>
                            <option value="DESC">DESC</option>
                          </select>
                        </td>
                      )}
                      {!primary && btree && (
                        <td>
                          <select name="index[columns][nulls][]" aria-label={t('index_dialog.nulls')} value={row.nullsFirst ? 'FIRST' : 'LAST'} onChange={(e) => updateRow(i, { nullsFirst: e.target.value === 'FIRST' })}>
                            <option value="FIRST">NULLS FIRST</option>
                            <option value="LAST">NULLS LAST</option>
                          </select>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="add_more">
                <input type="number" className="mx-2" min={1} max={16} value={addCount} onChange={(e) => setAddCount(Math.max(1, Number(e.target.value) || 1))} aria-label={t('index_dialog.add_columns', { count: addCount })} />
                <div className="add_fields">
                  <input className="btn btn-secondary" type="button" id="add_fields" value={t('index_dialog.add_columns', { count: addCount })} onClick={() => setRows((current) => [...current, ...Array.from({ length: addCount }, () => emptyRow())])} />
                </div>
              </div>
            </div>
          </fieldset>
        </form>
      </Modal>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
