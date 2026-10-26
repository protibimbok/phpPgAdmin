import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { constraints as constraintsOf, type Column, type Constraint, type ConstraintType } from '../api'

export interface ConstraintDialogProps {
  show: boolean
  db: string
  scid: number
  tid: number
  columns: Column[]
  /** The constraint to edit; a new one of the given type when left out. */
  constraint?: { type: ConstraintType; row: Constraint } | null
  newType?: ConstraintType
  onClose: () => void
  onSaved: () => void
}

/**
 * A small dialog in the index dialog's shape for the constraints phpMyAdmin has no page for:
 * it renames and comments an existing one (what ALTER CONSTRAINT allows) and adds a check,
 * unique or primary key constraint with its expression or columns.
 */
export default function ConstraintDialog({ show, db, scid, tid, columns, constraint, newType = 'check_constraint', onClose, onSaved }: ConstraintDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const type = constraint?.type ?? newType
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [expression, setExpression] = useState('')
  const [chosen, setChosen] = useState<string[]>([])
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setName(constraint?.row.name ?? '')
    setComment(constraint?.row.comment ?? '')
    setExpression(constraint?.row.consrc ?? '')
    setChosen([])
  }, [show, constraint])

  function data(): Record<string, unknown> {
    if (constraint) return { name: name || undefined, comment }
    if (type === 'check_constraint') return { name: name || undefined, consrc: expression, comment: comment || undefined }

    return { name: name || undefined, columns: chosen.filter(Boolean).map((column) => ({ column })), comment: comment || undefined }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    constraintsOf(db, scid, tid, type)
      .modifiedSql(data(), constraint?.row.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  async function save() {
    setBusy(true)
    try {
      if (constraint) await constraintsOf(db, scid, tid, type).update(constraint.row.oid, data())
      else await constraintsOf(db, scid, tid, type).create(data())
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
        id="constraintDialogModal"
        title={constraint ? t('constraint_dialog.edit_title', { name: constraint.row.name }) : t('constraint_dialog.add_title', { type: t(`structure.constraint_types.${type}`) })}
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
        <form id="index_frm" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <fieldset className="pma-fieldset">
            <div className="index_info">
              <div>
                <div className="label">
                  <strong>
                    <label htmlFor="input_constraint_name">{t('constraint_dialog.name')}</label>
                  </strong>
                </div>
                <input type="text" id="input_constraint_name" size={25} maxLength={63} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              {!constraint && type === 'check_constraint' && (
                <div>
                  <div className="label">
                    <strong>
                      <label htmlFor="input_constraint_expression">{t('constraint_dialog.expression')}</label>
                    </strong>
                  </div>
                  <input type="text" id="input_constraint_expression" size={30} value={expression} onChange={(e) => setExpression(e.target.value)} placeholder="price > 0" required />
                </div>
              )}
              {!constraint && type !== 'check_constraint' && (
                <div>
                  <div className="label">
                    <strong>
                      <label htmlFor="select_constraint_columns">{t('constraint_dialog.columns')}</label>
                    </strong>
                  </div>
                  <select id="select_constraint_columns" multiple size={Math.min(8, Math.max(3, columns.length))} value={chosen} onChange={(e) => setChosen(Array.from(e.target.selectedOptions, (o) => o.value))}>
                    {columns.map((column) => (
                      <option key={column.attnum} value={column.name}>
                        {column.name} [{column.displaytypname}]
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {constraint?.row.consrc && (
                <div>
                  <div className="label">
                    <strong>{t('constraint_dialog.expression')}</strong>
                  </div>
                  <code dir="ltr">{constraint.row.consrc}</code>
                </div>
              )}
              <div>
                <div className="label">
                  <strong>
                    <label htmlFor="input_constraint_comment">{t('constraint_dialog.comment')}</label>
                  </strong>
                </div>
                <input type="text" id="input_constraint_comment" size={30} maxLength={1024} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
          </fieldset>
        </form>
      </Modal>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
