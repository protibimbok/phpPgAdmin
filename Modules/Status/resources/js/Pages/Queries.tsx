import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'
import { listDatabases } from '@databases/js/api'
import { roleUrl } from '@roles/js/Pages/Roles'
import HighlightedSql from '@sql/js/editor/HighlightedSql'
import { quoteIdent } from '@sql/js/sql'
import { queryStatistics, resetQueryStatistics, type QueryStatistics, type StatementSort } from '../api'
import StatusNav from '../StatusNav'

const integer = new Intl.NumberFormat()
const decimals = (digits: number) => new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
const twoDecimals = decimals(2)
const threeDecimals = decimals(3)

const SORTS: StatementSort[] = ['calls', 'total_exec_time', 'mean_exec_time', 'rows', 'shared_blks_hit', 'shared_blks_read']

/** The query cut to this many characters until "Show full queries", as on the Processes page. */
const TRUNCATE = 100

function truncate(query: string): string {
  const line = query.replace(/\s+/g, ' ').trim()

  return line.length <= TRUNCATE ? line : `${line.slice(0, TRUNCATE)}…`
}

/**
 * phpMyAdmin's Status » Query statistics (server/status/queries) for PostgreSQL: the statements
 * pg_stat_statements has counted, in a database the extension is installed in (the maintenance
 * database, which sees every database's statements, when none is chosen). The heading counts
 * the calls since the statistics were reset, with their averages per hour, minute and second;
 * the table lists the top statements by the column clicked, with each one's share of the total
 * time. Reset runs pg_stat_statements_reset(). Without the extension, a notice says how to get it.
 */
export default function Queries() {
  const { t } = useTranslation('status')
  const [database, setDatabase] = useState('')
  const [sort, setSort] = useState<{ column: StatementSort; desc: boolean }>({ column: 'total_exec_time', desc: true })
  const [full, setFull] = useState(false)
  const [reset, setReset] = useState<string | null>(null)
  const { data, error, reload } = useRequest(() => queryStatistics({ database: database || undefined, sort: sort.column, order: sort.desc ? 'desc' : 'asc' }), [database, sort])
  const { data: databases } = useRequest(() => listDatabases(), [])

  const sortBy = (column: StatementSort) => setSort((s) => ({ column, desc: s.column === column ? !s.desc : true }))

  async function runReset() {
    setReset(null)
    try {
      await resetQueryStatistics(database || undefined)
      notifySuccess(t('queries.reset_done'))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      reload()
    }
  }

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="card mb-3" id="tableFilter">
        <div className="card-header">{t('processes.filters')}</div>
        <div className="card-body">
          <form className="row row-cols-lg-auto gy-1 gx-3 align-items-center" onSubmit={(e) => { e.preventDefault(); reload() }}>
            <div className="col-12">
              <select className="form-select" aria-label={t('processes.database')} value={database} onChange={(e) => setDatabase(e.target.value)}>
                <option value="">{t('queries.all_databases')}</option>
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
            {data?.statements && (
              <div className="col-12">
                <input className="btn btn-secondary" type="button" id="resetQueryStatistics" value={t('queries.reset')} onClick={() => setReset(`SELECT ${quoteIdent(data.schema ?? 'public')}.pg_stat_statements_reset();`)} />
              </div>
            )}
          </form>
        </div>
      </div>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}

      {data && <Statistics data={data} sort={sort} sortBy={sortBy} full={full} toggleFull={() => setFull((f) => !f)} />}

      <ConfirmQuery show={reset !== null} sql={reset ?? ''} warning={t('queries.reset_warning')} confirmLabel={t('queries.reset')} onClose={() => setReset(null)} onConfirm={() => void runReset()} />
    </div>
  )
}

interface StatisticsProps {
  data: QueryStatistics
  sort: { column: StatementSort; desc: boolean }
  sortBy: (column: StatementSort) => void
  full: boolean
  toggleFull: () => void
}

function Statistics({ data, sort, sortBy, full, toggleFull }: StatisticsProps) {
  const { t } = useTranslation('status')
  const code = { code: <code /> }

  if (!data.available) {
    return (
      <div className="row">
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> <Trans t={t} i18nKey="queries.not_available" components={code} />
        </div>
      </div>
    )
  }
  if (!data.installed) {
    return (
      <div className="row">
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" />{' '}
          <Trans
            t={t}
            i18nKey="queries.not_installed"
            values={{ database: data.database }}
            components={{ ...code, extensions: <Link to={`${urls.database(data.database)}/objects#extensions_section`} /> }}
          />
        </div>
      </div>
    )
  }
  if (!data.loaded) {
    return (
      <div className="row">
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" />{' '}
          <Trans t={t} i18nKey="queries.not_loaded" components={{ ...code, variables: <Link to="/server/variables?filter=shared_preload_libraries" /> }} />
        </div>
      </div>
    )
  }
  if (data.error || !data.totals || !data.statements) {
    return (
      <div className="alert alert-danger" role="alert">
        {data.error}
      </div>
    )
  }

  const { totals, statements } = data
  const seconds = Math.max(totals.now - (totals.stats_reset ?? totals.start_time), 1)
  const perSecond = totals.calls / seconds

  return (
    <>
      <div className="row">
        <h3 id="serverstatusqueries">
          {t(totals.stats_reset === null ? 'queries.calls_since_start' : 'queries.calls_since_reset', { total: integer.format(totals.calls) })}{' '}
          <a href="https://www.postgresql.org/docs/current/pgstatstatements.html" target="_blank" rel="noopener noreferrer">
            <Icon name="b_help" title={t('queries.documentation')} />
          </a>
        </h3>
      </div>

      <div className="row">
        <ul>
          <li>
            ø {t('queries.per_hour')} {integer.format(Math.round(perSecond * 3600))}
          </li>
          <li>
            ø {t('queries.per_minute')} {integer.format(Math.round(perSecond * 60))}
          </li>
          {perSecond >= 1 && (
            <li>
              ø {t('queries.per_second')} {integer.format(Math.round(perSecond))}
            </li>
          )}
        </ul>
      </div>

      {totals.statements > statements.length && (
        <div className="row">
          <p>{t('queries.top', { shown: statements.length, total: integer.format(totals.statements) })}</p>
        </div>
      )}

      <div className="responsivetable row">
        <table id="serverStatusQueriesDetails" className="table table-striped table-hover sortable w-auto">
          <thead>
            <tr>
              <th scope="col">
                {t('queries.columns.query')}
                <a href="#full" onClick={(e) => { e.preventDefault(); toggleFull() }}>
                  <Icon name={full ? 's_partialtext' : 's_fulltext'} title={full ? t('processes.truncate') : t('processes.full')} className="icon_fulltext" />
                </a>
              </th>
              {data.all && <th scope="col">{t('queries.columns.datname')}</th>}
              <th scope="col">{t('queries.columns.rolname')}</th>
              {SORTS.map((column) => (
                <th scope="col" key={column} className="text-end text-nowrap">
                  <a href={`#sort-${column}`} className="sortlink" onClick={(e) => { e.preventDefault(); sortBy(column) }}>
                    {t(`queries.columns.${column}`)}
                    {sort.column === column && <Icon name={sort.desc ? 's_desc' : 's_asc'} title={sort.desc ? t('processes.descending') : t('processes.ascending')} className="soimg" />}
                  </a>
                </th>
              ))}
              <th scope="col" className="text-end">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {statements.length === 0 && (
              <tr>
                <td colSpan={SORTS.length + (data.all ? 4 : 3)}>{t('queries.none')}</td>
              </tr>
            )}
            {statements.map((s, i) => (
              <tr key={`${s.queryid}-${s.datname}-${s.rolname}-${i}`}>
                <td>
                  <HighlightedSql sql={full ? s.query : truncate(s.query)} />
                </td>
                {data.all && <td>{s.datname ? <Link to={urls.database(s.datname)}>{s.datname}</Link> : ''}</td>}
                <td>{s.rolname ? <Link to={roleUrl(s.rolname)}>{s.rolname}</Link> : ''}</td>
                <td className="font-monospace text-end">{integer.format(s.calls)}</td>
                <td className="font-monospace text-end">{threeDecimals.format(s.total_exec_time)}</td>
                <td className="font-monospace text-end">{threeDecimals.format(s.mean_exec_time)}</td>
                <td className="font-monospace text-end">{integer.format(s.rows)}</td>
                <td className="font-monospace text-end">{integer.format(s.shared_blks_hit)}</td>
                <td className="font-monospace text-end">{integer.format(s.shared_blks_read)}</td>
                <td className="font-monospace text-end">{totals.total_exec_time > 0 ? twoDecimals.format((s.total_exec_time / totals.total_exec_time) * 100) : '---'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
