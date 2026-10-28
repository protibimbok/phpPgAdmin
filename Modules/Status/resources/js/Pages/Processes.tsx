import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { notify, notifyError, notifySuccess } from '@/notify'
import { listDatabases } from '@databases/js/api'
import { roleUrl } from '@roles/js/Pages/Roles'
import HighlightedSql from '@sql/js/editor/HighlightedSql'
import { activity, signalSession, type Session } from '../api'
import StatusNav, { AutoRefresh } from '../StatusNav'

type Column = 'pid' | 'usename' | 'datname' | 'application_name' | 'client_addr' | 'backend_type' | 'state' | 'wait_event' | 'blocking_pids' | 'backend_start' | 'time' | 'query'

const COLUMNS: Column[] = ['pid', 'usename', 'datname', 'application_name', 'client_addr', 'backend_type', 'state', 'wait_event', 'blocking_pids', 'backend_start', 'time', 'query']

/** phpMyAdmin truncates a process's query to this many characters until "Show full queries". */
const TRUNCATE = 100

/** The query on one line, cut at TRUNCATE characters. */
function truncate(query: string): string {
  const line = query.replace(/\s+/g, ' ').trim()

  return line.length <= TRUNCATE ? line : `${line.slice(0, TRUNCATE)}…`
}

/** Seconds the current statement has been running (activity.sql gives minutes). */
const seconds = (session: Session) => Math.round(session.active_since * 60)

/**
 * phpMyAdmin's Status » Processes with pgAdmin's Sessions panel: the Filters card (only active
 * sessions, one database, the background processes), then pg_stat_activity in a sortable
 * striped table with Cancel (pg_cancel_backend) and Terminate (pg_terminate_backend) per
 * session, each confirmed with its statement, the query truncated until "Show full queries",
 * and the auto refresh below.
 */
export default function Processes() {
  const { t } = useTranslation('status')
  const { t: tApp } = useTranslation()
  const [onlyActive, setOnlyActive] = useState(false)
  const [database, setDatabase] = useState('')
  const [background, setBackground] = useState(false)
  const [full, setFull] = useState(false)
  const [sort, setSort] = useState<{ column: Column; desc: boolean }>({ column: 'pid', desc: false })
  const [signal, setSignal] = useState<{ session: Session; action: 'cancel' | 'terminate' } | null>(null)
  const { data, error, reload } = useRequest(() => activity({ database: database || undefined, active: onlyActive }), [database, onlyActive])
  const { data: databases } = useRequest(() => listDatabases(), [])

  const sessions = useMemo(() => {
    const rows = (data?.sessions ?? []).filter((session) => background || session.backend_type === 'client backend')
    const key = (session: Session): string | number => (sort.column === 'time' ? seconds(session) : sort.column === 'pid' ? session.pid : (session[sort.column] ?? ''))

    return [...rows].sort((a, b) => {
      const [x, y] = [key(a), key(b)]
      const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))

      return sort.desc ? -order : order
    })
  }, [data, background, sort])

  async function send({ session, action }: NonNullable<typeof signal>) {
    setSignal(null)
    try {
      const result = await signalSession(session.pid, action)
      if (result.ok) notifySuccess(t(`processes.done.${action}`, { pid: session.pid }))
      else notify(t('processes.not_signalled', { pid: session.pid }), 'error')
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  const sortBy = (column: Column) => setSort((s) => ({ column, desc: s.column === column ? !s.desc : false }))

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="card mb-3" id="tableFilter">
        <div className="card-header">{t('processes.filters')}</div>
        <div className="card-body">
          <form className="row row-cols-lg-auto gy-1 gx-3 align-items-center" onSubmit={(e) => { e.preventDefault(); reload() }}>
            <div className="col-12">
              <div className="form-check">
                <input className="form-check-input autosubmit" type="checkbox" name="showExecuting" id="showExecuting" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
                <label className="form-check-label" htmlFor="showExecuting">
                  {t('processes.only_active')}
                </label>
              </div>
            </div>
            <div className="col-12">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" id="showBackground" checked={background} onChange={(e) => setBackground(e.target.checked)} />
                <label className="form-check-label" htmlFor="showBackground">
                  {t('processes.background')}
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
        <table id="tableprocesslist" className="table table-striped table-hover sortable w-auto">
          <thead>
            <tr>
              <th>{t('processes.processes')}</th>
              {COLUMNS.map((column) => (
                <th scope="col" key={column} className="text-nowrap">
                  <a href={`#sort-${column}`} className="sortlink" onClick={(e) => { e.preventDefault(); sortBy(column) }}>
                    {t(`processes.columns.${column}`)}
                    {sort.column === column && <Icon name={sort.desc ? 's_desc' : 's_asc'} title={sort.desc ? t('processes.descending') : t('processes.ascending')} className="soimg" />}
                  </a>
                  {column === 'query' && (
                    <a href="#full" onClick={(e) => { e.preventDefault(); setFull((f) => !f) }}>
                      <Icon name={full ? 's_partialtext' : 's_fulltext'} title={full ? t('processes.truncate') : t('processes.full')} className="icon_fulltext" />
                    </a>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data && sessions.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + 1}>{t('processes.none')}</td>
              </tr>
            )}
            {sessions.map((session) => (
              <tr key={session.pid} className={session.blocking_pids ? 'table-warning' : undefined}>
                <td className="text-nowrap">
                  {session.backend_type === 'client backend' && session.pid !== data?.own_pid && (
                    <>
                      <a className="ajax kill_process" href="#cancel" onClick={(e) => { e.preventDefault(); setSignal({ session, action: 'cancel' }) }}>
                        {t('processes.cancel')}
                      </a>{' '}
                      <a className="ajax kill_process" href="#terminate" onClick={(e) => { e.preventDefault(); setSignal({ session, action: 'terminate' }) }}>
                        {t('processes.terminate')}
                      </a>
                    </>
                  )}
                </td>
                <td className="font-monospace text-end">{session.pid}</td>
                <td>{session.usename ? <Link to={roleUrl(session.usename)}>{session.usename}</Link> : ''}</td>
                <td>{session.datname ? <Link to={urls.database(session.datname)}>{session.datname}</Link> : <em>{t('processes.no_database')}</em>}</td>
                <td>{session.application_name}</td>
                <td>{session.client_addr ?? (session.backend_type === 'client backend' ? <em>{t('processes.local')}</em> : '')}</td>
                <td className="text-nowrap">{session.backend_type}</td>
                <td className="text-nowrap">{session.state ?? '---'}</td>
                <td className="text-nowrap">{session.wait_event}</td>
                <td className="font-monospace">{session.blocking_pids}</td>
                <td className="text-nowrap">{session.backend_start}</td>
                <td className="font-monospace text-end">{session.state === 'active' ? seconds(session) : 0}</td>
                <td>{session.query === '' ? '---' : <HighlightedSql sql={full ? session.query : truncate(session.query)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AutoRefresh reload={reload} />

      <ConfirmQuery
        show={signal !== null}
        sql={signal ? `SELECT pg_catalog.${signal.action === 'cancel' ? 'pg_cancel_backend' : 'pg_terminate_backend'}(${signal.session.pid});` : ''}
        confirmLabel={signal?.action === 'terminate' ? t('processes.terminate') : tApp('go')}
        confirmClass={signal?.action === 'terminate' ? 'btn-danger' : 'btn-primary'}
        onClose={() => setSignal(null)}
        onConfirm={() => signal && void send(signal)}
      />
    </div>
  )
}
