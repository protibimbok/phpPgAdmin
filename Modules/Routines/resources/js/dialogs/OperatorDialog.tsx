import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { operators as operatorsOf, routineOptions, type Operator, type OperatorData, type RoutineOptions } from '../api'

export interface OperatorDialogProps {
  show: boolean
  db: string
  scid: number
  operator: Operator | null
  onClose: () => void
  onSaved: () => void
}

const EMPTY: OperatorData = {
  name: '',
  owner: '',
  description: '',
  operproc: '',
  lefttype: '',
  righttype: '',
  commutator: '',
  negator: '',
  restrproc: '',
  joinproc: '',
  support_hash: false,
  support_merge: false,
}

/**
 * The operator editor, after the classic phpPgAdmin's operator properties and the fields of
 * CREATE OPERATOR, in the trigger editor's dialog layout: the name, the function and operand
 * types, the commutator and negator, the selectivity estimators, HASHES and MERGES, the owner
 * and comment. ALTER OPERATOR reaches only the estimators, owner, schema and comment; the
 * server drops and re-creates the operator for the rest, which the SQL preview shows.
 */
export default function OperatorDialog({ show, db, scid, operator, onClose, onSaved }: OperatorDialogProps) {
  const { t } = useTranslation('routines')
  const { t: tApp } = useTranslation()
  const [options, setOptions] = useState<RoutineOptions | null>(null)
  const [form, setForm] = useState<OperatorData>(EMPTY)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setForm(
      operator
        ? {
            name: operator.name,
            schema: operator.schema,
            owner: operator.owner,
            description: operator.description ?? '',
            operproc: operator.operproc,
            lefttype: operator.lefttype ?? '',
            righttype: operator.righttype ?? '',
            commutator: operator.commutator ?? '',
            negator: operator.negator ?? '',
            restrproc: operator.restrproc ?? '',
            joinproc: operator.joinproc ?? '',
            support_hash: operator.support_hash,
            support_merge: operator.support_merge,
          }
        : EMPTY,
    )
  }, [show, operator])

  useEffect(() => {
    if (show && !options) routineOptions(db, scid).then(setOptions, () => setOptions({ types: [], languages: [], variables: [], support_functions: [], roles: [], schemas: [] }))
  }, [show, options, db, scid])

  const set = (key: keyof OperatorData, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }))

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (operator) await operatorsOf(db, scid).update(operator.oid, form)
      else await operatorsOf(db, scid).create(form)
      notifySuccess(operator ? t('operator.altered', { name: form.name }) : t('operator.created', { name: form.name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    operatorsOf(db, scid)
      .modifiedSql(form, operator?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  const input = (key: Exclude<keyof OperatorData, 'support_hash' | 'support_merge'>, label: string, extra: { placeholder?: string; list?: string; required?: boolean; size?: number; hint?: string } = {}) => (
    <tr>
      <td>{label}</td>
      <td>
        <input type="text" name={`opr_${key}`} value={String(form[key] ?? '')} onChange={(e) => set(key, e.target.value)} size={extra.size ?? 30} dir="ltr" placeholder={extra.placeholder} list={extra.list} required={extra.required} />
        {extra.hint && <div className="form-text">{extra.hint}</div>}
      </td>
    </tr>
  )

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="operatorDialogModal"
        size="lg"
        title={operator ? t('operator.edit_title', { name: operator.signature }) : t('operator.create_title')}
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
        <form
          className="rte_form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <datalist id="operatorTypes">
            {(options?.types ?? []).map((type) => (
              <option key={`${type.schema}.${type.name}`} value={type.name} />
            ))}
          </datalist>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              {input('name', t('operator.name'), { required: true, placeholder: '===', size: 10 })}
              {input('operproc', t('operator.function'), { required: true, placeholder: 'int4eq' })}
              {input('lefttype', t('operator.left_type'), { list: 'operatorTypes', hint: t('operator.left_type_hint') })}
              {input('righttype', t('operator.right_type'), { required: true, list: 'operatorTypes' })}
              {input('commutator', t('operator.commutator'))}
              {input('negator', t('operator.negator'))}
              {input('restrproc', t('operator.restrict'), { placeholder: 'eqsel' })}
              {input('joinproc', t('operator.join'), { placeholder: 'eqjoinsel' })}
              <tr>
                <td>HASHES</td>
                <td>
                  <input type="checkbox" name="opr_support_hash" checked={form.support_hash} onChange={(e) => set('support_hash', e.target.checked)} />
                </td>
              </tr>
              <tr>
                <td>MERGES</td>
                <td>
                  <input type="checkbox" name="opr_support_merge" checked={form.support_merge} onChange={(e) => set('support_merge', e.target.checked)} />
                </td>
              </tr>
              <tr>
                <td>{t('editor.owner')}</td>
                <td>
                  <select name="opr_owner" value={form.owner} onChange={(e) => set('owner', e.target.value)}>
                    <option value="">{t('editor.current_role')}</option>
                    {(options?.roles ?? []).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              {operator !== null && (
                <tr>
                  <td>{t('aggregate.schema')}</td>
                  <td>
                    <select name="opr_schema" value={form.schema ?? operator.schema} onChange={(e) => set('schema', e.target.value)}>
                      {(options?.schemas ?? [operator.schema]).map((schema) => (
                        <option key={schema} value={schema}>
                          {schema}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}
              {input('description', t('editor.comment'), { size: 50 })}
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
