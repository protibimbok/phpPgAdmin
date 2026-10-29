import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'

/** An OPTIONS entry of a foreign data wrapper, server or user mapping. */
export interface OptionPair {
  option: string
  value: string
}

/** A column of a foreign table: attnum is null for one not created yet. */
export interface ColumnRow {
  attnum: number | null
  name: string
  cltype: string
  attnotnull: boolean
  defval: string
  coloptions: OptionPair[]
}

export type Value = string | boolean | OptionPair[] | ColumnRow[]

export type Values = Record<string, Value>

export interface Field {
  key: string
  label: string
  kind: 'text' | 'select' | 'checkbox' | 'textarea' | 'options' | 'columns'
  options?: { value: string; label: string }[]
  /** The label of the empty choice a select starts with; none when left out. */
  empty?: string
  /** Shown only when this holds for the values. */
  visible?: (values: Values) => boolean
  readOnly?: boolean
  required?: boolean
  hint?: string
  placeholder?: string
}

export interface NodeDialogProps {
  show: boolean
  id: string
  title: string
  fields: Field[]
  /** The values the form opens with. */
  initial: Values
  onValuesChange?: (values: Values) => void
  save: (values: Values) => Promise<unknown>
  preview: (values: Values) => Promise<string>
  savedMessage: (values: Values) => string
  onClose: () => void
  onSaved: () => void
}

/**
 * The editor of an object of the database's Objects page, in the dialog layout of the trigger
 * and collation editors (a two-column rte_table with Go, Preview SQL and Close), its fields
 * given by the object type: pgAdmin's dialog for that node, one field per row.
 */
export default function NodeDialog({ show, id, title, fields, initial, onValuesChange, save, preview, savedMessage, onClose, onSaved }: NodeDialogProps) {
  const { t: tApp } = useTranslation()
  const [values, setValues] = useState<Values>(initial)
  const [busy, setBusy] = useState(false)
  const [sql, setSql] = useState<{ sql: string | null; error: string | null } | null>(null)

  useEffect(() => {
    if (show) setValues(initial)
    // The form restarts when it opens; the initial values are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  function set(key: string, value: Value) {
    const next = { ...values, [key]: value }
    setValues(next)
    onValuesChange?.(next)
  }

  async function submit() {
    if (busy) return
    setBusy(true)
    try {
      await save(values)
      notifySuccess(savedMessage(values))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setSql({ sql: null, error: null })
    preview(values).then(
      (text) => setSql({ sql: text, error: null }),
      (e: unknown) => setSql({ sql: null, error: errorMessage(e) }),
    )
  }

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id={id}
        size="lg"
        title={title}
        footer={
          <>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
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
            void submit()
          }}
        >
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              {fields
                .filter((field) => !field.visible || field.visible(values))
                .map((field) => {
                  const name = `${id}_${field.key}`
                  const value = values[field.key]

                  return (
                    <tr key={field.key}>
                      <td>
                        <label htmlFor={name}>{field.label}</label>
                      </td>
                      <td>
                        {field.kind === 'columns' ? (
                          <ColumnsInput id={name} columns={Array.isArray(value) ? (value as ColumnRow[]) : []} onChange={(columns) => set(field.key, columns)} />
                        ) : field.kind === 'options' ? (
                          <OptionsInput id={name} pairs={Array.isArray(value) ? (value as OptionPair[]) : []} readOnly={field.readOnly} onChange={(pairs) => set(field.key, pairs)} />
                        ) : field.kind === 'checkbox' ? (
                          <input type="checkbox" id={name} name={field.key} checked={value === true} onChange={(e) => set(field.key, e.target.checked)} disabled={field.readOnly} />
                        ) : field.kind === 'select' && !field.readOnly ? (
                          <select id={name} name={field.key} value={String(value ?? '')} onChange={(e) => set(field.key, e.target.value)} required={field.required}>
                            {field.empty !== undefined && <option value="">{field.empty}</option>}
                            {(field.options ?? []).map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        ) : field.kind === 'textarea' ? (
                          <textarea id={name} name={field.key} rows={3} cols={50} value={String(value ?? '')} onChange={(e) => set(field.key, e.target.value)} readOnly={field.readOnly} />
                        ) : (
                          <input
                            type="text"
                            id={name}
                            name={field.key}
                            size={50}
                            value={field.kind === 'select' ? (field.options?.find((o) => o.value === value)?.label ?? String(value ?? '')) : String(value ?? '')}
                            onChange={(e) => set(field.key, e.target.value)}
                            readOnly={field.readOnly}
                            required={field.required}
                            placeholder={field.placeholder}
                          />
                        )}
                        {field.hint && <div className="form-text">{field.hint}</div>}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={sql !== null} sql={sql?.sql ?? null} error={sql?.error} onClose={() => setSql(null)} />
    </>
  )
}

/**
 * The OPTIONS of a foreign object: a row per option with its name and value, a button to
 * remove it, and one to add a row, as pgAdmin's options grid.
 */
function OptionsInput({ id, pairs, readOnly, onChange }: { id: string; pairs: OptionPair[]; readOnly?: boolean; onChange: (pairs: OptionPair[]) => void }) {
  const { t } = useTranslation('dbobjects')
  const update = (index: number, change: Partial<OptionPair>) => onChange(pairs.map((pair, i) => (i === index ? { ...pair, ...change } : pair)))

  return (
    <table className="table table-sm table-borderless mb-0" id={id}>
      <thead>
        <tr>
          <th>{t('options.option')}</th>
          <th>{t('options.value')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {pairs.map((pair, index) => (
          <tr key={index}>
            <td>
              <input type="text" name={`${id}_option_${index}`} value={pair.option} onChange={(e) => update(index, { option: e.target.value })} readOnly={readOnly} />
            </td>
            <td>
              {/* A stored password comes back as a dummy; typing replaces it, leaving it keeps the stored one. */}
              <input
                type={pair.option === 'password' ? 'password' : 'text'}
                autoComplete={pair.option === 'password' ? 'new-password' : undefined}
                name={`${id}_value_${index}`}
                value={pair.value}
                onChange={(e) => update(index, { value: e.target.value })}
                onFocus={pair.option === 'password' ? (e) => e.target.select() : undefined}
                readOnly={readOnly}
              />
            </td>
            <td>
              {!readOnly && (
                <button type="button" className="btn btn-link p-0" title={t('options.remove')} onClick={() => onChange(pairs.filter((_, i) => i !== index))}>
                  <Icon name="b_drop" /> {t('options.remove')}
                </button>
              )}
            </td>
          </tr>
        ))}
        {!readOnly && (
          <tr>
            <td colSpan={3}>
              <button type="button" className="btn btn-link p-0" id={`${id}_add`} onClick={() => onChange([...pairs, { option: '', value: '' }])}>
                <Icon name="b_plus" /> {t('options.add')}
              </button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

/**
 * The columns of a foreign table, a row each with its name, type, NOT NULL, default and the
 * wrapper's column options, after the column grid of pgAdmin's foreign table dialog.
 */
function ColumnsInput({ id, columns, onChange }: { id: string; columns: ColumnRow[]; onChange: (columns: ColumnRow[]) => void }) {
  const { t } = useTranslation('dbobjects')
  const update = (index: number, change: Partial<ColumnRow>) => onChange(columns.map((column, i) => (i === index ? { ...column, ...change } : column)))

  return (
    <table className="table table-sm table-borderless mb-0" id={id}>
      <thead>
        <tr>
          <th>{t('columns_grid.name')}</th>
          <th>{t('columns_grid.type')}</th>
          <th>{t('columns_grid.not_null')}</th>
          <th>{t('columns_grid.default')}</th>
          <th>{t('columns_grid.options')}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {columns.map((column, index) => (
          <tr key={column.attnum ?? `new${index}`}>
            <td>
              <input type="text" name={`${id}_name_${index}`} size={12} value={column.name} onChange={(e) => update(index, { name: e.target.value })} />
            </td>
            <td>
              <input type="text" name={`${id}_type_${index}`} size={12} list="foreign_table_types" value={column.cltype} onChange={(e) => update(index, { cltype: e.target.value })} />
            </td>
            <td>
              <input type="checkbox" name={`${id}_notnull_${index}`} checked={column.attnotnull} onChange={(e) => update(index, { attnotnull: e.target.checked })} />
            </td>
            <td>
              <input type="text" name={`${id}_default_${index}`} size={10} value={column.defval} onChange={(e) => update(index, { defval: e.target.value })} />
            </td>
            <td>
              <OptionsInput id={`${id}_options_${index}`} pairs={column.coloptions} onChange={(coloptions) => update(index, { coloptions })} />
            </td>
            <td>
              <button type="button" className="btn btn-link p-0" title={t('options.remove')} onClick={() => onChange(columns.filter((_, i) => i !== index))}>
                <Icon name="b_drop" /> {t('options.remove')}
              </button>
            </td>
          </tr>
        ))}
        <tr>
          <td colSpan={6}>
            <button type="button" className="btn btn-link p-0" id={`${id}_add`} onClick={() => onChange([...columns, { attnum: null, name: '', cltype: 'text', attnotnull: false, defval: '', coloptions: [] }])}>
              <Icon name="b_column_add" /> {t('columns_grid.add')}
            </button>
            <datalist id="foreign_table_types">
              {['integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision', 'text', 'character varying', 'boolean', 'date', 'timestamp without time zone', 'timestamp with time zone', 'uuid', 'jsonb', 'bytea'].map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </td>
        </tr>
      </tbody>
    </table>
  )
}
