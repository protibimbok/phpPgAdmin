import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { extendedStatistics, type Column, type ExtendedStatistics, type StatisticsData } from '../api'

export interface StatisticsDialogProps {
  show: boolean
  db: string
  scid: number
  table: string
  columns: Column[]
  statistics: ExtendedStatistics | null
  onClose: () => void
  onSaved: () => void
}

const STAT_TYPES = ['ndistinct', 'dependencies', 'mcv']

/**
 * The extended statistics editor after pgAdmin's statistics dialog, in the index editor's
 * dialog layout: the name (which PostgreSQL 16+ can choose itself), the table's columns to
 * cover, the expressions, the kinds to collect, the statistics target and the comment. What
 * an object covers cannot be altered, so an existing one shows it read-only and only the name,
 * target and comment are saved.
 */
export default function StatisticsDialog({ show, db, scid, table, columns, statistics, onClose, onSaved }: StatisticsDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [expressions, setExpressions] = useState('')
  const [kinds, setKinds] = useState<string[]>([])
  const [target, setTarget] = useState('')
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setName(statistics?.name ?? '')
    setPicked(statistics?.columns ?? [])
    setExpressions(statistics?.expression_list ?? '')
    setKinds(statistics?.stat_types ?? [])
    setTarget(statistics && statistics.stattarget >= 0 ? String(statistics.stattarget) : '')
    setComment(statistics?.comment ?? '')
  }, [show, statistics])

  const readOnly = statistics !== null

  function data(): StatisticsData {
    const common: StatisticsData = { name, stattarget: target, comment }

    return readOnly ? common : { ...common, table, columns: picked, expression_list: expressions, stat_types: kinds }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      const node = statistics ? await extendedStatistics(db, scid).update(statistics.oid, data()) : await extendedStatistics(db, scid).create(data())
      notifySuccess(statistics ? t('structure.extended_statistics.altered', { name: node.label }) : t('structure.extended_statistics.created', { name: node.label }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    extendedStatistics(db, scid)
      .modifiedSql(data(), statistics?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="statisticsDialogModal"
        size="lg"
        title={statistics ? t('structure.extended_statistics.edit_title', { name: statistics.name }) : t('structure.extended_statistics.create_title')}
        footer={
          <>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
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
        <form className="rte_form" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <tr>
                <td>{t('structure.extended_statistics.name')}</td>
                <td>
                  <input type="text" name="statistics_name" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} placeholder={readOnly ? undefined : t('structure.extended_statistics.name_hint')} />
                </td>
              </tr>
              <tr>
                <td>{t('structure.extended_statistics.columns')}</td>
                <td>
                  <select name="statistics_columns" multiple size={Math.min(8, Math.max(3, columns.length))} value={picked} onChange={(e) => setPicked(Array.from(e.target.selectedOptions, (o) => o.value))} disabled={readOnly}>
                    {columns.map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                    {readOnly && picked.filter((c) => !columns.some((column) => column.name === c)).map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {!readOnly && <div className="form-text">{t('structure.extended_statistics.columns_hint')}</div>}
                </td>
              </tr>
              <tr>
                <td>{t('structure.extended_statistics.expressions')}</td>
                <td>
                  <input type="text" name="statistics_expressions" size={50} value={expressions} onChange={(e) => setExpressions(e.target.value)} placeholder="(lower(name)), (date_trunc('day', created_at))" readOnly={readOnly} />
                  {!readOnly && <div className="form-text">{t('structure.extended_statistics.expressions_hint')}</div>}
                </td>
              </tr>
              <tr>
                <td>{t('structure.extended_statistics.kinds')}</td>
                <td>
                  {STAT_TYPES.map((kind) => (
                    <label key={kind} className="me-3">
                      <input type="checkbox" name="statistics_kinds" value={kind} checked={kinds.includes(kind)} onChange={(e) => setKinds((current) => (e.target.checked ? [...current, kind] : current.filter((k) => k !== kind)))} disabled={readOnly} /> {kind}
                    </label>
                  ))}
                  {!readOnly && <div className="form-text">{t('structure.extended_statistics.kinds_hint')}</div>}
                </td>
              </tr>
              <tr>
                <td>{t('structure.extended_statistics.target')}</td>
                <td>
                  <input type="number" name="statistics_target" min={0} max={10000} value={target} onChange={(e) => setTarget(e.target.value)} placeholder={t('structure.extended_statistics.target_default')} />
                </td>
              </tr>
              <tr>
                <td>{t('structure.extended_statistics.comment')}</td>
                <td>
                  <input type="text" name="statistics_comment" size={50} value={comment} onChange={(e) => setComment(e.target.value)} />
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
