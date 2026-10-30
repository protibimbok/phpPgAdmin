import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { aggregates as aggregatesOf, routineOptions, type Aggregate, type AggregateData, type RoutineOptions } from '../api'

export interface AggregateDialogProps {
  show: boolean
  db: string
  scid: number
  aggregate: Aggregate | null
  onClose: () => void
  onSaved: () => void
}

type Field = Exclude<keyof AggregateData, 'final_extra_param' | 'moving_final_extra_param'>

const EMPTY: AggregateData = {
  name: '',
  owner: '',
  description: '',
  kind: 'normal',
  input_types: '',
  state_func: '',
  state_type: '',
  state_data_size: '',
  final_func: '',
  final_extra_param: false,
  final_func_modify: '',
  combine_func: '',
  serialization_func: '',
  deserialization_func: '',
  initial_val: '',
  moving_state_func: '',
  moving_inverse_func: '',
  moving_state_type: '',
  moving_state_data_size: '',
  moving_final_func: '',
  moving_final_extra_param: false,
  moving_final_func_modify: '',
  moving_initial_val: '',
  sort_oper: '',
  parallel: '',
}

const MODIFY = ['READ_ONLY', 'SHAREABLE', 'READ_WRITE']

/**
 * The aggregate editor, after the classic phpPgAdmin's aggregate form and the fields of
 * CREATE AGGREGATE, in the trigger editor's dialog layout: the name, input types and kind,
 * the state and final functions, the optional combine, serial and sort settings, and the
 * moving-aggregate functions of a normal aggregate. PostgreSQL keeps an aggregate's kind and
 * input types, so an existing one shows them read-only; the rest is saved through CREATE OR
 * REPLACE AGGREGATE and the ALTERs.
 */
export default function AggregateDialog({ show, db, scid, aggregate, onClose, onSaved }: AggregateDialogProps) {
  const { t } = useTranslation('routines')
  const { t: tApp } = useTranslation()
  const [options, setOptions] = useState<RoutineOptions | null>(null)
  const [form, setForm] = useState<AggregateData>(EMPTY)
  const [moving, setMoving] = useState(false)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  // An existing aggregate is read afresh: the Routines list tags its rows with their own kind.
  useEffect(() => {
    if (!show) return
    setForm(EMPTY)
    setMoving(false)
    if (!aggregate) return
    let current = true
    const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))
    aggregatesOf(db, scid)
      .properties(aggregate.oid)
      .then(
        (props) => {
          if (!current) return
          setForm(Object.fromEntries(Object.entries(EMPTY).map(([key, empty]) => [key, typeof empty === 'boolean' ? Boolean(props[key as keyof Aggregate]) : text(props[key as keyof Aggregate])])) as unknown as AggregateData)
          setMoving(Boolean(props.moving_state_func))
        },
        (e: unknown) => notifyError(errorMessage(e)),
      )

    return () => {
      current = false
    }
  }, [show, aggregate, db, scid])

  useEffect(() => {
    if (show && !options) routineOptions(db, scid).then(setOptions, () => setOptions({ types: [], languages: [], variables: [], support_functions: [], roles: [], schemas: [] }))
  }, [show, options, db, scid])

  const set = (key: keyof AggregateData, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }))
  const normal = form.kind === 'normal'

  function data(): AggregateData {
    if (normal && moving) return form
    const { moving_state_func: _a, moving_inverse_func: _b, moving_state_type: _c, moving_state_data_size: _d, moving_final_func: _e, moving_final_extra_param: _f, moving_final_func_modify: _g, moving_initial_val: _h, ...rest } = form

    // The moving-aggregate fields go out blank, so that an edit clears them.
    return { ...rest, moving_state_func: '', moving_inverse_func: '', moving_state_type: '', moving_state_data_size: '', moving_final_func: '', moving_final_extra_param: false, moving_final_func_modify: '', moving_initial_val: '' }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (aggregate) await aggregatesOf(db, scid).update(aggregate.oid, data())
      else await aggregatesOf(db, scid).create(data())
      notifySuccess(aggregate ? t('aggregate.altered', { name: form.name }) : t('aggregate.created', { name: form.name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    aggregatesOf(db, scid)
      .modifiedSql(data(), aggregate?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  const input = (key: Field, label: string, extra: { placeholder?: string; list?: string; required?: boolean; readOnly?: boolean; size?: number } = {}) => (
    <tr>
      <td>{label}</td>
      <td>
        <input type="text" name={`agg_${key}`} value={String(form[key] ?? '')} onChange={(e) => set(key, e.target.value)} size={extra.size ?? 30} dir="ltr" {...extra} />
      </td>
    </tr>
  )

  const modify = (key: 'final_func_modify' | 'moving_final_func_modify', label: string) => (
    <tr>
      <td>{label}</td>
      <td>
        <select name={`agg_${key}`} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
          <option value="">{t('aggregate.default')}</option>
          {MODIFY.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
    </tr>
  )

  const check = (key: 'final_extra_param' | 'moving_final_extra_param', label: string) => (
    <tr>
      <td>{label}</td>
      <td>
        <input type="checkbox" name={`agg_${key}`} checked={Boolean(form[key])} onChange={(e) => set(key, e.target.checked)} />
      </td>
    </tr>
  )

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="aggregateDialogModal"
        size="lg"
        title={aggregate ? t('aggregate.edit_title', { name: aggregate.signature }) : t('aggregate.create_title')}
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
          <datalist id="aggregateTypes">
            {(options?.types ?? []).map((type) => (
              <option key={`${type.schema}.${type.name}`} value={type.name} />
            ))}
          </datalist>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              {input('name', t('aggregate.name'), { required: true, size: 40 })}
              <tr>
                <td>{t('aggregate.kind')}</td>
                <td>
                  {aggregate ? (
                    <input type="text" name="agg_kind" value={t(`aggregate.kinds.${form.kind}`)} readOnly />
                  ) : (
                    <select name="agg_kind" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                      {['normal', 'ordered-set', 'hypothetical-set'].map((kind) => (
                        <option key={kind} value={kind}>
                          {t(`aggregate.kinds.${kind}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
              <tr>
                <td>{t('aggregate.input_types')}</td>
                <td>
                  <input type="text" name="agg_input_types" value={form.input_types} onChange={(e) => set('input_types', e.target.value)} size={40} dir="ltr" placeholder={normal ? 'integer' : 'float8 ORDER BY anyelement'} readOnly={aggregate !== null} />
                  {aggregate === null && <div className="form-text">{t('aggregate.input_types_hint')}</div>}
                </td>
              </tr>
              {input('state_func', t('aggregate.state_func'), { required: true, placeholder: 'int4pl' })}
              {input('state_type', t('aggregate.state_type'), { required: true, list: 'aggregateTypes' })}
              {input('state_data_size', t('aggregate.state_data_size'))}
              {input('initial_val', t('aggregate.initial_val'))}
              {input('final_func', t('aggregate.final_func'))}
              {check('final_extra_param', t('aggregate.final_extra'))}
              {modify('final_func_modify', t('aggregate.final_modify'))}
              {input('combine_func', t('aggregate.combine_func'))}
              {input('serialization_func', t('aggregate.serial_func'))}
              {input('deserialization_func', t('aggregate.deserial_func'))}
              {normal && input('sort_oper', t('aggregate.sort_oper'), { placeholder: '>' })}
              <tr>
                <td>{t('editor.parallel')}</td>
                <td>
                  <select name="agg_parallel" value={form.parallel ?? ''} onChange={(e) => set('parallel', e.target.value)}>
                    <option value="">UNSAFE</option>
                    <option value="RESTRICTED">RESTRICTED</option>
                    <option value="SAFE">SAFE</option>
                  </select>
                </td>
              </tr>
              {normal && (
                <tr>
                  <td>{t('aggregate.moving')}</td>
                  <td>
                    <input type="checkbox" name="agg_moving" checked={moving} onChange={(e) => setMoving(e.target.checked)} />
                  </td>
                </tr>
              )}
              {normal && moving && (
                <>
                  {input('moving_state_func', t('aggregate.moving_state_func'), { required: true })}
                  {input('moving_inverse_func', t('aggregate.moving_inverse_func'), { required: true })}
                  {input('moving_state_type', t('aggregate.moving_state_type'), { required: true, list: 'aggregateTypes' })}
                  {input('moving_state_data_size', t('aggregate.moving_state_data_size'))}
                  {input('moving_initial_val', t('aggregate.moving_initial_val'))}
                  {input('moving_final_func', t('aggregate.moving_final_func'))}
                  {check('moving_final_extra_param', t('aggregate.moving_final_extra'))}
                  {modify('moving_final_func_modify', t('aggregate.moving_final_modify'))}
                </>
              )}
              <tr>
                <td>{t('editor.owner')}</td>
                <td>
                  <select name="agg_owner" value={form.owner} onChange={(e) => set('owner', e.target.value)}>
                    <option value="">{t('editor.current_role')}</option>
                    {(options?.roles ?? []).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              {aggregate !== null && (
                <tr>
                  <td>{t('aggregate.schema')}</td>
                  <td>
                    <select name="agg_schema" value={form.schema ?? aggregate.schema} onChange={(e) => set('schema', e.target.value)}>
                      {(options?.schemas ?? [aggregate.schema]).map((schema) => (
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
