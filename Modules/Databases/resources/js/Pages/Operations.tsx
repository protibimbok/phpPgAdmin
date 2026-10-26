import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { databaseProperties, resolveDatabase, type DatabaseAcl } from '../api'

const PRIVILEGE_NAMES: Record<string, string> = { c: 'CONNECT', C: 'CREATE', T: 'TEMPORARY' }

function describe(acl: DatabaseAcl): string {
  const names = acl.privileges.map((p) => `${PRIVILEGE_NAMES[p.privilege_type] ?? p.privilege_type}${p.with_grant ? '*' : ''}`)

  return `${acl.grantee}: ${names.join(', ')}`
}

/**
 * The database's "Operations" page, laid out like phpMyAdmin's database/operations/index.twig:
 * one card per operation (comment, create table, rename, remove, copy), preceded by the
 * database's properties. The forms that change the database arrive with phase 3; until then
 * they are shown disabled.
 */
export default function Operations() {
  const { t } = useTranslation('databases')
  const db = useParams().db ?? ''
  const { data, error } = useRequest(() => resolveDatabase(db).then(databaseProperties), [db])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const facts: [string, string][] = [
    [t('operations.fields.owner'), data.datowner],
    [t('operations.fields.encoding'), data.encoding],
    [t('operations.fields.collation'), data.datcollate],
    [t('operations.fields.ctype'), data.datctype],
    [t('operations.fields.tablespace'), data.spcname ?? ''],
    [t('operations.fields.connection_limit'), data.datconnlimit < 0 ? t('operations.unlimited') : String(data.datconnlimit)],
    [t('operations.fields.template'), data.is_template ? '✓' : '—'],
    [t('operations.fields.allow_connections'), data.datallowconn ? '✓' : '—'],
    [t('operations.fields.size'), data.size === null ? '—' : formatSize(data.size)],
    [t('operations.fields.privileges'), data.datacl.length === 0 ? '—' : data.datacl.map(describe).join('; ')],
  ]

  const soon = <small className="text-muted ms-2">{t('operations.coming')}</small>

  return (
    <div className="container my-3">
      <h2>{t('operations.title')}</h2>

      <div className="card mb-2">
        <div className="card-header">
          <Icon name="s_db" /> {t('operations.properties')}
        </div>
        <ul className="list-group list-group-flush">
          {facts.map(([label, value]) => (
            <li key={label} className="list-group-item">
              <strong>{label}:</strong> <span dir="ltr">{value}</span>
            </li>
          ))}
        </ul>
      </div>

      <form id="formDatabaseComment" onSubmit={(e) => e.preventDefault()}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_comment" /> {t('operations.comment')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="databaseCommentInput">
                  {t('operations.comment')}
                </label>
                <input className="form-control textfield" id="databaseCommentInput" type="text" defaultValue={data.comments ?? ''} disabled />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {soon}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} disabled />
          </div>
        </div>
      </form>

      <form id="createTableMinimalForm" className="card mb-2" onSubmit={(e) => e.preventDefault()}>
        <div className="card-header">
          <Icon name="b_table_add" /> {t('operations.create_table')}
        </div>
        <div className="card-body row row-cols-lg-auto g-3">
          <div className="col-md-6">
            <label htmlFor="createTableNameInput" className="form-label">
              {t('operations.table_name')}
            </label>
            <input type="text" className="form-control" id="createTableNameInput" maxLength={63} disabled />
          </div>
          <div className="col-md-6">
            <label htmlFor="createTableNumFieldsInput" className="form-label">
              {t('operations.number_of_columns')}
            </label>
            <input type="number" className="form-control" id="createTableNumFieldsInput" min={1} defaultValue={4} disabled />
          </div>
        </div>
        <div className="card-footer text-end">
          {soon}
          <input className="btn btn-primary" type="submit" value={t('operations.create')} disabled />
        </div>
      </form>

      <form id="rename_db_form" onSubmit={(e) => e.preventDefault()}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_edit" /> {t('operations.rename')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="new_db_name">
                  {t('operations.new_name')}
                </label>
                <input className="form-control textfield" id="new_db_name" type="text" maxLength={63} defaultValue={db} disabled />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {soon}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} disabled />
          </div>
        </div>
      </form>

      <div className="card mb-2">
        <div className="card-header">
          <Icon name="b_deltbl" /> {t('operations.remove')}
        </div>
        <div className="card-body">
          <div className="card-text">
            <span id="drop_db_anchor" className="text-danger text-decoration-line-through">
              {t('operations.drop')}
            </span>
            {soon}
          </div>
        </div>
      </div>

      <form id="copy_db_form" onSubmit={(e) => e.preventDefault()}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_edit" /> {t('operations.copy')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="copyDbNameInput">
                  {t('operations.copy_name')}
                </label>
                <input className="form-control textfield" id="copyDbNameInput" type="text" maxLength={63} defaultValue={db} disabled />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {soon}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} disabled />
          </div>
        </div>
      </form>
    </div>
  )
}
