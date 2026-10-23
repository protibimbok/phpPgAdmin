import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { listDatabases, type Database } from '../api'

/** Bytes as phpMyAdmin prints sizes: a unit from B to TiB with one decimal. */
export function formatSize(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

/**
 * The server's databases, laid out like phpMyAdmin's "Databases" tab: a striped table with a
 * light header, the row count underneath. What is listed comes from pg_database, as in pgAdmin.
 */
export default function Databases() {
  const { t } = useTranslation('databases')
  const [databases, setDatabases] = useState<Database[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listDatabases().then(setDatabases, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error}
      </div>
    )
  }

  if (databases === null) {
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
              <tr key={database.name} className={database.allow_connections ? undefined : 'text-muted'}>
                <th scope="row" className="fw-normal">
                  {database.name}
                  {database.is_template && <span className="badge bg-secondary ms-2">{t('template')}</span>}
                </th>
                <td>{database.owner}</td>
                <td>{database.encoding}</td>
                <td>{database.collation}</td>
                <td className="text-end text-nowrap">
                  {database.size === null ? (
                    <span title={t('no_connect')}>–</span>
                  ) : (
                    formatSize(database.size)
                  )}
                </td>
                <td>{database.comment}</td>
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
