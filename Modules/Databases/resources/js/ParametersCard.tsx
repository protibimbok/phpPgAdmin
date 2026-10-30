import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { notify } from '@/notify'
import type { DatabaseChanges, DatabaseVariable } from './api'

export interface ParametersCardProps {
  db: string
  /** The settings as the database's properties carry them (pg_db_role_setting). */
  variables: { name: string; value: unknown; role?: string | null }[]
  settings: string[]
  roles: string[]
  onPreview: (changes: DatabaseChanges) => void
  onSave: (changes: DatabaseChanges) => void
}

const key = (v: { name: string; role: string | null }) => `${v.role ?? ''}\u0000${v.name}`

/**
 * The settings the database gives its sessions, as the classic phpPgAdmin's database Variables
 * and pgAdmin's Parameters tab show them: ALTER DATABASE … SET for every role, or ALTER ROLE …
 * IN DATABASE … SET for one. A row removed is RESET. "Show all settings" runs SHOW ALL in the
 * database, the values its sessions start with.
 */
export default function ParametersCard({ db, variables, settings, roles, onPreview, onSave }: ParametersCardProps) {
  const { t } = useTranslation('databases')
  const { t: tApp } = useTranslation()
  const original = (): DatabaseVariable[] => variables.map((v) => ({ name: v.name, value: v.value === false ? 'off' : v.value === true ? 'on' : String(v.value ?? ''), role: v.role ?? null }))
  const [rows, setRows] = useState<DatabaseVariable[]>(original)

  // The rows start over whenever the database's settings are read again.
  useEffect(() => setRows(original()), [variables])

  function changes(): DatabaseChanges {
    const before = new Map(original().map((v) => [key(v), v]))
    const after = new Map(rows.filter((v) => v.name.trim() !== '').map((v) => [key({ ...v, name: v.name.trim() }), { ...v, name: v.name.trim() }]))
    const added = [...after.values()].filter((v) => !before.has(key(v)))
    const changed = [...after.values()].filter((v) => before.has(key(v)) && before.get(key(v))!.value !== v.value)
    const deleted = [...before.values()].filter((v) => !after.has(key(v)))
    if (added.length + changed.length + deleted.length === 0) return {}

    return { variables: { added, changed, deleted } }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const out = changes()
    if (!out.variables) return notify(tApp('nothing_to_change'))
    onSave(out)
  }

  const set = (i: number, patch: Partial<DatabaseVariable>) => setRows((current) => current.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  return (
    <form id="db_parameters_form" onSubmit={submit}>
      <div className="card mb-2">
        <div className="card-header">
          <Icon name="s_vars" /> {t('parameters.title')}
        </div>
        <div className="card-body">
          <datalist id="db_parameter_names">
            {settings.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {rows.length === 0 && <p className="card-text">{t('parameters.none')}</p>}
          {rows.length > 0 && (
            <table className="table table-sm table-striped w-auto align-middle">
              <thead>
                <tr>
                  <th>{t('parameters.name')}</th>
                  <th>{t('parameters.value')}</th>
                  <th>{t('parameters.role')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i}>
                    <td>
                      <input type="text" className="form-control form-control-sm" list="db_parameter_names" dir="ltr" aria-label={t('parameters.name')} value={row.name} onChange={(e) => set(i, { name: e.target.value })} />
                    </td>
                    <td>
                      <input type="text" className="form-control form-control-sm" dir="ltr" aria-label={t('parameters.value')} value={row.value} onChange={(e) => set(i, { value: e.target.value })} />
                    </td>
                    <td>
                      <select className="form-select form-select-sm" aria-label={t('parameters.role')} value={row.role ?? ''} onChange={(e) => set(i, { role: e.target.value || null })}>
                        <option value="">{t('parameters.all_roles')}</option>
                        {[...new Set([...(row.role ? [row.role] : []), ...roles])].map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <a href="#remove" onClick={(e) => { e.preventDefault(); setRows((current) => current.filter((_, j) => j !== i)) }}>
                        <Icon name="b_drop" /> {t('parameters.remove')}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <input type="button" className="btn btn-secondary" value={t('parameters.add')} onClick={() => setRows((current) => [...current, { name: '', value: '', role: null }])} />{' '}
          <Link className="btn btn-link" to={`${urls.database(db)}/sql?${new URLSearchParams({ sql: 'SHOW ALL', run: '1' })}`}>
            {t('parameters.show_all')}
          </Link>
        </div>
        <div className="card-footer text-end">
          <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={() => onPreview(changes())} />
          <input className="btn btn-primary" type="submit" value={tApp('go')} />
        </div>
      </div>
    </form>
  )
}
