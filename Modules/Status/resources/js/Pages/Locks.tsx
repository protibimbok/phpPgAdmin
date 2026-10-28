import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { useRequest } from '@/api/useRequest'
import { urls } from '@/level'
import { listDatabases } from '@databases/js/api'
import { locks, type Lock } from '../api'
import StatusNav, { AutoRefresh } from '../StatusNav'

type Column = Exclude<keyof Lock, 'granted' | 'fastpath'>

const COLUMNS: Column[] = ['pid', 'locktype', 'datname', 'relation', 'page', 'tuple', 'virtualxid', 'transactionid', 'classid', 'objid', 'objsubid', 'virtualtransaction', 'mode']

/** The columns that hold numbers, right-aligned in monospace as phpMyAdmin shows them. */
const NUMERIC = new Set<Column>(['pid', 'page', 'tuple', 'objid', 'objsubid'])

/**
 * pgAdmin's Locks panel on a phpMyAdmin Status page: the Filters card (only the locks not
 * granted yet, one database), then pg_locks in a striped table with the waiting locks
 * highlighted as on the Processes page, and the auto refresh below.
 */
export default function Locks() {
  const { t } = useTranslation('status')
  const [waiting, setWaiting] = useState(false)
  const [database, setDatabase] = useState('')
  const { data, error, reload } = useRequest(() => locks({ database: database || undefined, waiting }), [database, waiting])
  const { data: databases } = useRequest(() => listDatabases(), [])

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="card mb-3" id="tableFilter">
        <div className="card-header">{t('processes.filters')}</div>
        <div className="card-body">
          <form className="row row-cols-lg-auto gy-1 gx-3 align-items-center" onSubmit={(e) => { e.preventDefault(); reload() }}>
            <div className="col-12">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="showWaiting" checked={waiting} onChange={(e) => setWaiting(e.target.checked)} />
                <label className="form-check-label" htmlFor="showWaiting">
                  {t('locks.only_waiting')}
                </label>
              </div>
            </div>
            <div className="col-12">
              <select className="form-select" aria-label={t('processes.database')} value={database} onChange={(e) => setDatabase(e.target.value)}>
                <option value="">{t('processes.all_databases')}</option>
                {(databases ?? []).map((d) => (
                  <option key={d.did} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-12">
              <input className="btn btn-secondary" type="submit" value={t('processes.refresh')} />
            </div>
          </form>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      <div className="responsivetable row">
        <table id="tablelocks" className="table table-striped table-hover w-auto">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th scope="col" key={column} className="text-nowrap">
                  {t(`locks.columns.${column}`)}
                </th>
              ))}
              <th scope="col">{t('locks.columns.granted')}</th>
              <th scope="col">{t('locks.columns.fastpath')}</th>
            </tr>
          </thead>
          <tbody>
            {data && data.locks.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 2}>{t('locks.none')}</td>
              </tr>
            )}
            {(data?.locks ?? []).map((lock, i) => (
              <tr key={i} className={lock.granted ? undefined : 'table-warning'}>
                {COLUMNS.map((column) => (
                  <td key={column} className={NUMERIC.has(column) ? 'font-monospace text-end' : 'text-nowrap'}>
                    {column === 'datname' && lock.datname ? <Link to={urls.database(lock.datname)}>{lock.datname}</Link> : lock[column]}
                  </td>
                ))}
                <td>{lock.granted ? t('locks.yes') : t('locks.no')}</td>
                <td>{lock.fastpath ? t('locks.yes') : t('locks.no')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AutoRefresh reload={reload} />
    </div>
  )
}
