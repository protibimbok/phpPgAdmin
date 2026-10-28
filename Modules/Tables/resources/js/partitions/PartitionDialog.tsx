import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { attachCandidates, partitions as partitionsOf, partitionType, type PartitionData } from '../api'

export interface PartitionDialogProps {
  show: boolean
  db: string
  scid: number
  tid: number
  /** The parent's PARTITION BY clause. */
  scheme: string
  onClose: () => void
  onSaved: () => void
}

/**
 * phpMyAdmin's partition definition row (columns_definitions/partitions.twig) as a dialog for
 * one partition of a PostgreSQL table: a new partition by name, or an existing table attached,
 * with the bounds the parent's strategy takes (FROM / TO, IN, MODULUS / REMAINDER, or DEFAULT)
 * and a comment. Go saves through the partition node; Preview SQL shows the statement.
 */
export default function PartitionDialog({ show, db, scid, tid, scheme, onClose, onSaved }: PartitionDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const type = partitionType(scheme)
  const [attach, setAttach] = useState(false)
  const [name, setName] = useState('')
  const [table, setTable] = useState('')
  const [candidates, setCandidates] = useState<{ oid: number; table_name: string }[]>([])
  const [isDefault, setIsDefault] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [values, setValues] = useState('')
  const [modulus, setModulus] = useState('')
  const [remainder, setRemainder] = useState('')
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setAttach(false)
    setName('')
    setTable('')
    setIsDefault(false)
    setFrom('')
    setTo('')
    setValues('')
    setModulus('')
    setRemainder('')
    setComment('')
    attachCandidates(db, scid, tid).then(setCandidates, () => setCandidates([]))
  }, [show, db, scid, tid])

  function data(): PartitionData {
    const bounds: PartitionData = isDefault && type !== 'hash' ? { is_default: true } : type === 'range' ? { values_from: from, values_to: to } : type === 'list' ? { values_in: values } : { values_modulus: modulus, values_remainder: remainder }

    return attach ? { is_attach: true, partition_name: table, ...bounds } : { name, description: comment, ...bounds }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      const node = await partitionsOf(db, scid, tid).create(data())
      notifySuccess(attach ? t('partitions.attached', { name: node.label }) : t('partitions.created', { name: node.label }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    partitionsOf(db, scid, tid)
      .modifiedSql(data())
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
        id="partitionDialogModal"
        title={t('partitions.add_title')}
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
          <p>
            {t('partitions.partitioned_by')} <code>{scheme}</code>
          </p>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <tr>
                <td>{t('partitions.source')}</td>
                <td>
                  <label className="me-3">
                    <input type="radio" name="partition_source" checked={!attach} onChange={() => setAttach(false)} /> {t('partitions.new_table')}
                  </label>
                  <label>
                    <input type="radio" name="partition_source" checked={attach} onChange={() => setAttach(true)} /> {t('partitions.attach_existing')}
                  </label>
                </td>
              </tr>
              {attach ? (
                <tr>
                  <td>{t('partitions.table')}</td>
                  <td>
                    <select name="partition_table" value={table} onChange={(e) => setTable(e.target.value)} required>
                      <option value="" />
                      {candidates.map((c) => (
                        <option key={c.oid} value={c.table_name}>
                          {c.table_name}
                        </option>
                      ))}
                    </select>
                    <div className="form-text">{t('partitions.attach_hint')}</div>
                  </td>
                </tr>
              ) : (
                <tr>
                  <td>{t('partitions.name')}</td>
                  <td>
                    <input type="text" name="partition_name" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
                  </td>
                </tr>
              )}
              {type !== 'hash' && (
                <tr>
                  <td>{t('partitions.default')}</td>
                  <td>
                    <input type="checkbox" name="partition_default" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                  </td>
                </tr>
              )}
              {!isDefault && type === 'range' && (
                <>
                  <tr>
                    <td>{t('partitions.from')}</td>
                    <td>
                      <input type="text" name="values_from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="'2024-01-01'" required />
                    </td>
                  </tr>
                  <tr>
                    <td>{t('partitions.to')}</td>
                    <td>
                      <input type="text" name="values_to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="'2025-01-01'" required />
                    </td>
                  </tr>
                </>
              )}
              {!isDefault && type === 'list' && (
                <tr>
                  <td>{t('partitions.in')}</td>
                  <td>
                    <input type="text" name="values_in" value={values} onChange={(e) => setValues(e.target.value)} placeholder="'a', 'b'" required />
                  </td>
                </tr>
              )}
              {type === 'hash' && (
                <>
                  <tr>
                    <td>{t('partitions.modulus')}</td>
                    <td>
                      <input type="number" min={1} name="values_modulus" value={modulus} onChange={(e) => setModulus(e.target.value)} required />
                    </td>
                  </tr>
                  <tr>
                    <td>{t('partitions.remainder')}</td>
                    <td>
                      <input type="number" min={0} name="values_remainder" value={remainder} onChange={(e) => setRemainder(e.target.value)} required />
                    </td>
                  </tr>
                </>
              )}
              {!attach && (
                <tr>
                  <td>{t('partitions.comment')}</td>
                  <td>
                    <input type="text" name="partition_comment" value={comment} onChange={(e) => setComment(e.target.value)} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
