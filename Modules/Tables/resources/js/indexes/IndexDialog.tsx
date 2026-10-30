import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { indexes as indexesOf, tableModifiedSql, updateTable, type Column, type IndexColumnData, type IndexData, type IndexProperties, type TableOptions } from '../api'

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

interface Row {
  name: string
  desc: boolean
}

/** The access methods whose indexes a table can be clustered on (pg_am.amclusterable). */
const CLUSTERABLE = ['btree', 'gist']

/**
 * phpMyAdmin's index dialog (modals/index_dialog_modal.twig with table/index_form.twig): the
 * index name, its choice (PRIMARY, INDEX, UNIQUE), the advanced options folded away (here
 * the access method, fillfactor, WHERE condition and comment where phpMyAdmin has the key
 * block size, type, parser and comment), the columns with their order, and "Add N column(s)
 * to index". Go saves through the index node (or the table node for a primary key), Preview
 * SQL shows the statements.
 */
export default function IndexDialog({ show, db, scid, tid, columns, options, index, initialColumns = 1, hasPrimary, onClose, onSaved }: IndexDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState('')
  const [choice, setChoice] = useState<Choice>('INDEX')
  const [advanced, setAdvanced] = useState(false)
  const [method, setMethod] = useState('btree')
  const [fillfactor, setFillfactor] = useState('')
  const [where, setWhere] = useState('')
  const [comment, setComment] = useState('')
  const [clustered, setClustered] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [addCount, setAddCount] = useState(1)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    if (index) {
      setName(index.name)
      setChoice(index.indisunique ? 'UNIQUE' : 'INDEX')
      setMethod(index.amname)
      setFillfactor(index.fillfactor === null || index.fillfactor === undefined ? '' : String(index.fillfactor))
      setWhere(index.indconstraint ?? '')
      setComment(index.description ?? '')
      setClustered(Boolean(index.indisclustered))
      setRows(index.columns.map((c) => ({ name: c.colname, desc: Boolean(c.sort_order) })))
    } else {
      setName('')
      setChoice('INDEX')
      setMethod('btree')
      setFillfactor('')
      setWhere('')
      setComment('')
      setClustered(false)
      setRows(Array.from({ length: Math.max(1, initialColumns) }, (_, i) => ({ name: columns[i]?.name ?? '', desc: false })))
    }
    setAdvanced(false)
    setAddCount(1)
  }, [show, index, initialColumns, columns])

  const chosen = rows.filter((row) => row.name !== '')

  function indexData(): IndexData {
    const data: IndexData = {
      name: name || undefined,
      amname: method,
      indisunique: choice === 'UNIQUE',
      columns: chosen.map((row): IndexColumnData => ({ colname: row.name, sort_order: method === 'btree' ? row.desc : undefined, nulls: method === 'btree' ? false : undefined })),
      indconstraint: where || undefined,
      fillfactor: fillfactor || undefined,
      description: comment || undefined,
      // CLUSTER ON marks the index the table is clustered by; only B-tree and GiST indexes can be.
      indisclustered: CLUSTERABLE.includes(method) ? clustered : false,
    }

    return data
  }

  const primaryChanges = () => ({ primary_key: { added: [{ name: name || undefined, columns: chosen.map((row) => ({ column: row.name })) }] } })

  function showPreview() {
    setPreview({ sql: null, error: null })
    const promise = choice === 'PRIMARY' ? tableModifiedSql(db, scid, primaryChanges(), tid) : indexesOf(db, scid, tid).modifiedSql(indexData(), index?.oid)
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
      if (choice === 'PRIMARY') {
        await updateTable(db, scid, tid, primaryChanges())
      } else if (index) {
        await indexesOf(db, scid, tid).update(index.oid, indexData())
      } else {
        await indexesOf(db, scid, tid).create(indexData())
      }
      notifySuccess(tApp('query_executed'))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="indexDialogModal"
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
              <div>
                <div className="label">
                  <strong>
                    <label htmlFor="input_index_name">{t('index_dialog.name')}</label>
                  </strong>
                </div>
                <input type="text" name="index[Key_name]" id="input_index_name" size={25} maxLength={63} value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} />
              </div>

              <div>
                <div className="label">
                  <strong>
                    <label htmlFor="select_index_choice">{t('index_dialog.choice')}</label>
                  </strong>
                </div>
                <select name="index[Index_choice]" id="select_index_choice" value={choice} onChange={(e) => setChoice(e.target.value as Choice)} disabled={Boolean(index)}>
                  {!hasPrimary && !index && <option value="PRIMARY">PRIMARY</option>}
                  <option value="INDEX">INDEX</option>
                  <option value="UNIQUE">UNIQUE</option>
                </select>
              </div>

              <div className="mb-3">
                <button className="btn btn-sm btn-secondary" type="button" aria-expanded={advanced} aria-controls="advancedOptions" onClick={() => setAdvanced((o) => !o)}>
                  {t('index_dialog.advanced')}
                </button>
              </div>
              <div className={`collapse mb-3${advanced ? ' show' : ''}`} id="advancedOptions">
                <div>
                  <div className="label">
                    <strong>
                      <label htmlFor="select_index_type">{t('index_dialog.type')}</label>
                    </strong>
                  </div>
                  <select name="index[Index_type]" id="select_index_type" value={method} onChange={(e) => setMethod(e.target.value)} disabled={choice === 'PRIMARY'}>
                    {(options?.index_methods ?? ['btree']).map((am) => (
                      <option key={am} value={am}>
                        {am.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="label">
                    <strong>
                      <label htmlFor="input_fillfactor">{t('index_dialog.fillfactor')}</label>
                    </strong>
                  </div>
                  <input type="text" name="index[Fillfactor]" id="input_fillfactor" size={30} value={fillfactor} onChange={(e) => setFillfactor(e.target.value)} />
                </div>
                <div>
                  <div className="label">
                    <strong>
                      <label htmlFor="input_where">{t('index_dialog.where')}</label>
                    </strong>
                  </div>
                  <input type="text" name="index[Where]" id="input_where" size={30} value={where} onChange={(e) => setWhere(e.target.value)} disabled={choice === 'PRIMARY'} />
                </div>
                <div>
                  <div className="label">
                    <strong>
                      <label htmlFor="input_index_comment">{t('index_dialog.comment')}</label>
                    </strong>
                  </div>
                  <input type="text" name="index[Index_comment]" id="input_index_comment" size={30} maxLength={1024} value={comment} onChange={(e) => setComment(e.target.value)} disabled={choice === 'PRIMARY'} />
                </div>
                {choice !== 'PRIMARY' && CLUSTERABLE.includes(method) && (
                  <div>
                    <div className="form-check mt-2">
                      <input className="form-check-input" type="checkbox" name="index[Clustered]" id="input_clustered" checked={clustered} onChange={(e) => setClustered(e.target.checked)} />
                      <label className="form-check-label" htmlFor="input_clustered">
                        {t('index_dialog.clustered')}
                      </label>
                    </div>
                  </div>
                )}
              </div>

              <div className="clearfloat" />

              <table className="table align-middle" id="index_columns">
                <thead>
                  <tr>
                    <th />
                    <th>{t('index_dialog.column')}</th>
                    <th>{t('index_dialog.order')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr className="noclick" key={i}>
                      <td>
                        <span className="drag_icon" title={t('index_dialog.drag')} />
                      </td>
                      <td>
                        <select name="index[columns][names][]" value={row.name} onChange={(e) => setRows((current) => current.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}>
                          <option value="">-- {t('index_dialog.ignore')} --</option>
                          {columns.map((column) => (
                            <option key={column.attnum} value={column.name}>
                              {column.name} [{column.displaytypname}]
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select name="index[columns][order][]" value={row.desc ? 'DESC' : 'ASC'} onChange={(e) => setRows((current) => current.map((r, j) => (j === i ? { ...r, desc: e.target.value === 'DESC' } : r)))} disabled={method !== 'btree'}>
                          <option value="ASC">ASC</option>
                          <option value="DESC">DESC</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="add_more">
                <input type="number" className="mx-2" min={1} max={16} value={addCount} onChange={(e) => setAddCount(Math.max(1, Number(e.target.value) || 1))} aria-label={t('index_dialog.add_columns', { count: addCount })} />
                <div className="add_fields">
                  <input className="btn btn-secondary" type="button" id="add_fields" value={t('index_dialog.add_columns', { count: addCount })} onClick={() => setRows((current) => [...current, ...Array.from({ length: addCount }, () => ({ name: '', desc: false }))])} />
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
