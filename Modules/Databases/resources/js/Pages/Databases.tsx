import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { notAvailable } from '@/unbuilt'
import { formatSize } from '@/format'
import { urls } from '@/level'
import { listDatabases } from '../api'

/**
 * The server's databases, laid out like phpMyAdmin's "Databases" tab (server/databases/
 * index.twig): the heading, the check-all and search bar, a striped table with a checkbox per
 * row and the action links, the total underneath. What is listed comes from pg_database, as
 * in pgAdmin. Creating and dropping databases arrive with phase 3.
 */
export default function Databases() {
  const { t } = useTranslation('databases')
  const { t: tApp } = useTranslation()
  const { data: databases, error } = useRequest(() => listDatabases(), [])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()

    return (databases ?? []).filter((database) => needle === '' || database.name.toLowerCase().includes(needle))
  }, [databases, filter])

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

  const allChecked = visible.length > 0 && visible.every((database) => checked.has(database.did))

  function toggleAll(value: boolean) {
    setChecked(value ? new Set(visible.map((database) => database.did)) : new Set())
  }

  function toggle(did: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(did)
      else next.delete(did)

      return next
    })
  }

  return (
    <div className="container-fluid my-3" id="databases">
      <h2>
        <Icon name="s_db" /> {t('title')}
      </h2>

      <div className="d-flex flex-wrap my-3">
        <div>
          <div className="input-group">
            <div className="input-group-text">
              <div className="form-check mb-0">
                <input className="form-check-input checkall_box" type="checkbox" id="checkAllCheckbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
                <label className="form-check-label" htmlFor="checkAllCheckbox">
                  {tApp('check_all')}
                </label>
              </div>
            </div>
            <button className="btn btn-outline-secondary" id="bulkActionDropButton" type="button" title={t('actions.drop')} onClick={notAvailable}>
              <Icon name="db_drop" /> {t('actions.drop')}
            </button>
          </div>
        </div>

        <div className="ms-auto">
          <div className="input-group">
            <span className="input-group-text">
              <Icon name="b_search" title={tApp('search')} />
            </span>
            <input className="form-control" type="text" id="filterText" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tApp('search')} aria-label={tApp('search')} />
          </div>
        </div>
      </div>

      <form id="dbStatsForm" onSubmit={(e) => e.preventDefault()}>
        <div className="table-responsive">
          <table className="table table-striped table-hover w-auto">
            <thead>
              <tr>
                <th />
                <th>{t('columns.database')}</th>
                <th>{t('columns.owner')}</th>
                <th>{t('columns.encoding')}</th>
                <th>{t('columns.collation')}</th>
                <th className="text-end">{t('columns.size')}</th>
                <th>{t('columns.comment')}</th>
                <th colSpan={1}>{t('columns.action')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((database) => (
                <tr key={database.did} className={database.datallowconn ? undefined : 'text-muted'}>
                  <td className="tool">
                    <input
                      type="checkbox"
                      name="selected_dbs[]"
                      className="checkall"
                      title={database.name}
                      value={database.name}
                      checked={checked.has(database.did)}
                      disabled={!database.can_drop}
                      onChange={(e) => toggle(database.did, e.target.checked)}
                    />
                  </td>
                  <td className="name">
                    {database.datallowconn ? <Link to={urls.database(database.name)}>{database.name}</Link> : database.name}
                    {database.is_template && <span className="badge bg-secondary ms-2">{t('template')}</span>}
                  </td>
                  <td>{database.datowner}</td>
                  <td>
                    <span lang="en" dir="ltr">
                      {database.encoding}
                    </span>
                  </td>
                  <td>
                    <span lang="en" dir="ltr">
                      {database.datcollate}
                    </span>
                  </td>
                  <td className="text-end text-nowrap">
                    {database.size === null ? (
                      <span title={t('no_connect')}>–</span>
                    ) : (
                      formatSize(database.size)
                    )}
                  </td>
                  <td>{database.comments}</td>
                  <td className="tool text-nowrap">
                    {database.datallowconn && (
                      <Link to={`${urls.database(database.name)}/ddl`}>
                        <Icon name="b_sql" title={t('actions.sql')} /> {t('actions.sql')}
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="fw-bold">{t('total', { count: visible.length })}</div>
      </form>
    </div>
  )
}
