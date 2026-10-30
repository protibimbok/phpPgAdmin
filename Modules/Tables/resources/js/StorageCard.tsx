import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { notify } from '@/notify'
import type { AutovacuumEnabled, Table, TableChanges, VacuumSetting } from './api'

export interface StorageCardProps {
  properties: Table
  onPreview: (changes: TableChanges) => void
  onSave: (changes: TableChanges) => void
}

type Values = Record<string, string>

/** The values a table sets, by setting name, as the inputs hold them. */
function valuesOf(settings: VacuumSetting[] | undefined): Values {
  return Object.fromEntries((settings ?? []).map((s) => [s.name, s.value === undefined ? '' : String(s.value)]))
}

/**
 * The table's storage parameters, after pgAdmin's Parameter and Autovacuum tabs and the classic
 * phpPgAdmin's per-table autovacuum page: fill factor, parallel workers and TOAST tuple target,
 * then, behind "Custom auto-vacuum", autovacuum_enabled and the autovacuum settings of the table
 * and of its TOAST table, each with the server's default as its placeholder. Switching the custom
 * settings off resets them all.
 */
export default function StorageCard({ properties, onPreview, onSave }: StorageCardProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [fillfactor, setFillfactor] = useState('')
  const [parallelWorkers, setParallelWorkers] = useState('')
  const [toastTupleTarget, setToastTupleTarget] = useState('')
  const [custom, setCustom] = useState(false)
  const [enabled, setEnabled] = useState<AutovacuumEnabled>('x')
  const [table, setTable] = useState<Values>({})
  const [toastCustom, setToastCustom] = useState(false)
  const [toastEnabled, setToastEnabled] = useState<AutovacuumEnabled>('x')
  const [toast, setToast] = useState<Values>({})

  useEffect(() => {
    setFillfactor(properties.fillfactor ?? '')
    setParallelWorkers(properties.parallel_workers ?? '')
    setToastTupleTarget(properties.toast_tuple_target ?? '')
    setCustom(properties.autovacuum_custom ?? false)
    setEnabled(properties.autovacuum_enabled ?? 'x')
    setTable(valuesOf(properties.vacuum_table))
    setToastCustom(properties.toast_autovacuum ?? false)
    setToastEnabled(properties.toast_autovacuum_enabled ?? 'x')
    setToast(valuesOf(properties.vacuum_toast))
  }, [properties])

  /** Only what differs from the table as it stands; the server compares the settings again. */
  function changes(): TableChanges {
    const out: TableChanges = {}
    if (fillfactor !== (properties.fillfactor ?? '')) out.fillfactor = fillfactor
    if (parallelWorkers !== (properties.parallel_workers ?? '')) out.parallel_workers = parallelWorkers
    if (toastTupleTarget !== (properties.toast_tuple_target ?? '')) out.toast_tuple_target = toastTupleTarget

    const changed = (values: Values, settings: VacuumSetting[] | undefined) => {
      const before = valuesOf(settings)

      return Object.entries(values)
        .filter(([name, value]) => value.trim() !== (before[name] ?? ''))
        .map(([name, value]) => ({ name, value: value.trim() === '' ? null : value.trim() }))
    }

    if (custom !== (properties.autovacuum_custom ?? false)) out.autovacuum_custom = custom
    if (custom) {
      if (enabled !== (properties.autovacuum_enabled ?? 'x')) out.autovacuum_enabled = enabled
      const rows = changed(table, properties.vacuum_table)
      if (rows.length > 0) out.vacuum_table = { changed: rows }
    }
    if (toastCustom !== (properties.toast_autovacuum ?? false)) out.toast_autovacuum = toastCustom
    if (toastCustom) {
      if (toastEnabled !== (properties.toast_autovacuum_enabled ?? 'x')) out.toast_autovacuum_enabled = toastEnabled
      const rows = changed(toast, properties.vacuum_toast)
      if (rows.length > 0) out.vacuum_toast = { changed: rows }
    }

    return out
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const out = changes()
    if (Object.keys(out).length === 0) return notify(tApp('nothing_to_change'))
    onSave(out)
  }

  const number = (id: string, label: string, value: string, set: (value: string) => void, props: { min?: number; max?: number; placeholder?: string } = {}) => (
    <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
      <div className="col-6">
        <label htmlFor={id}>{label}</label>
      </div>
      <div className="col-6">
        <input className="form-control" id={id} type="number" value={value} onChange={(e) => set(e.target.value)} {...props} />
      </div>
    </div>
  )

  const section = (prefix: 'table' | 'toast', on: boolean, setOn: (on: boolean) => void, state: AutovacuumEnabled, setState: (state: AutovacuumEnabled) => void, settings: VacuumSetting[] | undefined, values: Values, setValues: (values: Values) => void) => (
    <fieldset className="mb-3">
      <div className="form-check form-switch mb-2">
        <input className="form-check-input" type="checkbox" role="switch" id={`${prefix}_autovacuum_custom`} checked={on} onChange={(e) => setOn(e.target.checked)} />
        <label className="form-check-label" htmlFor={`${prefix}_autovacuum_custom`}>
          {t(`storage.custom_${prefix}`)}
        </label>
      </div>
      {on && (
        <>
          <div className="mb-2 row row-cols-lg-auto g-3 align-items-center">
            <div className="col-6">
              <label htmlFor={`${prefix}_autovacuum_enabled`}>{t('storage.enabled')}</label>
            </div>
            <div className="col-6">
              <select className="form-select" id={`${prefix}_autovacuum_enabled`} value={state} onChange={(e) => setState(e.target.value as AutovacuumEnabled)}>
                <option value="x">{t('storage.enabled_default')}</option>
                <option value="t">{t('storage.enabled_on')}</option>
                <option value="f">{t('storage.enabled_off')}</option>
              </select>
            </div>
          </div>
          <table className="table table-sm table-striped w-auto">
            <thead>
              <tr>
                <th>{t('storage.setting')}</th>
                <th>{t('storage.value')}</th>
                <th>{t('storage.default')}</th>
              </tr>
            </thead>
            <tbody>
              {(settings ?? []).map((s) => (
                <tr key={s.name}>
                  <td>
                    <label htmlFor={`${prefix}_${s.name}`}>
                      <code>{s.name}</code>
                    </label>
                  </td>
                  <td>
                    <input className="form-control form-control-sm" id={`${prefix}_${s.name}`} type="number" step={s.column_type === 'number' ? 'any' : 1} value={values[s.name] ?? ''} placeholder={s.setting} onChange={(e) => setValues({ ...values, [s.name]: e.target.value })} />
                  </td>
                  <td dir="ltr">{s.setting}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </fieldset>
  )

  return (
    <form id="tableStorageForm" onSubmit={submit}>
      <div className="card mb-2">
        <div className="card-header">{t('storage.title')}</div>
        <div className="card-body">
          {number('storage_fillfactor', t('storage.fillfactor'), fillfactor, setFillfactor, { min: 10, max: 100, placeholder: '100' })}
          {number('storage_parallel_workers', t('storage.parallel_workers'), parallelWorkers, setParallelWorkers, { min: 0, max: 1024 })}
          {number('storage_toast_tuple_target', t('storage.toast_tuple_target'), toastTupleTarget, setToastTupleTarget, { min: 128, max: 8160, placeholder: '2032' })}
          {section('table', custom, setCustom, enabled, setEnabled, properties.vacuum_table, table, setTable)}
          {section('toast', toastCustom, setToastCustom, toastEnabled, setToastEnabled, properties.vacuum_toast, toast, setToast)}
        </div>
        <div className="card-footer text-end">
          <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={() => onPreview(changes())} />
          <input className="btn btn-primary" type="submit" value={tApp('go')} />
        </div>
      </div>
    </form>
  )
}
