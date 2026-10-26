import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useRequest } from '@/api/useRequest'
import { formatSize } from '@/format'
import { urls } from '@/level'
import { listDatabases } from '../api'

/**
 * The server's databases, laid out like phpMyAdmin's "Databases" tab: a striped table with a
 * light header, the row count underneath. What is listed comes from pg_database, as in pgAdmin.
 */
export default function Databases() {
  const { t } = useTranslation('databases')
  const { data: databases, error } = useRequest(() => listDatabases(), [])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (databases === undefined) {
    return null
  }

  return (
    <div id="databases">
      <h2>{t('title')}</h2>

      <div className="table-responsive">
        <table className="table table-light table-striped table-hover w-auto">
          <thead>
            <tr>
              <th>{t('columns.database')}</th>
              <th>{t('columns.owner')}</th>
              <th>{t('columns.encoding')}</th>
              <th>{t('columns.collation')}</th>
              <th className="text-end">{t('columns.size')}</th>
              <th>{t('columns.comment')}</th>
            </tr>
          </thead>
          <tbody>
            {databases.map((database) => (
              <tr key={database.did} className={database.datallowconn ? undefined : 'text-muted'}>
                <th scope="row" className="fw-normal">
                  {database.datallowconn ? <Link to={urls.database(database.name)}>{database.name}</Link> : database.name}
                  {database.is_template && <span className="badge bg-secondary ms-2">{t('template')}</span>}
                </th>
                <td>{database.datowner}</td>
                <td>{database.encoding}</td>
                <td>{database.datcollate}</td>
                <td className="text-end text-nowrap">
                  {database.size === null ? (
                    <span title={t('no_connect')}>–</span>
                  ) : (
                    formatSize(database.size)
                  )}
                </td>
                <td>{database.comments}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={6} className="fw-normal">
                {t('total', { count: databases.length })}
              </th>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
