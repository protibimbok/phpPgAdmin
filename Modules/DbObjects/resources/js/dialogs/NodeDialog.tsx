import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'

export type Values = Record<string, string | boolean>

export interface Field {
  key: string
  label: string
  kind: 'text' | 'select' | 'checkbox' | 'textarea'
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

  function set(key: string, value: string | boolean) {
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
                        {field.kind === 'checkbox' ? (
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
