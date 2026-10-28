import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { formatSize } from '@/format'
import { serverStatus } from '../api'
import StatusNav from '../StatusNav'

const integer = new Intl.NumberFormat()
const twoDecimals = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** The client session states pg_stat_activity reports, in the order they are listed. */
const STATES = ['active', 'idle', 'idle in transaction', 'idle in transaction (aborted)', 'fastpath function call', 'disabled']

interface Row {
  name: string
  value: number
  /** A size in bytes rather than a count. */
  bytes?: boolean
}

/**
 * phpMyAdmin's Status » Server for PostgreSQL: how long the server has been running, then the
 * cumulative counters of pg_stat_database (transactions, rows, block I/O, temporary files,
 * deadlocks) with their average per hour since the counters were last reset, and the client
 * sessions by state against max_connections, in phpMyAdmin's side-by-side striped tables.
 */
export default function ServerStatus() {
  const { t } = useTranslation('status')
  const { data, error } = useRequest(() => serverStatus(), [])

  if (error) {
    return (
      <div className="container-fluid">
        <StatusNav />
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      </div>
    )
  }

  if (!data) return null

  const { server, totals, sessions } = data
  const hours = Math.max(server.stats_age, 1) / 3600
  const perHour = (value: number) => value / hours
  const clients = STATES.reduce((sum, state) => sum + (sessions[state] ?? 0), 0)
  const blocks = totals.blks_read + totals.blks_hit
  const percent = (value: number, of: number) => (of === 0 ? '---' : `${twoDecimals.format((value / of) * 100)}%`)

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="row">
        <h3>{t('server.transactions_heading', { count: integer.format(totals.xact_commit + totals.xact_rollback) })}</h3>
      </div>
      <div className="row">
        <p>
          {t('server.running', { uptime: timespan(t, server.uptime), start: new Date(server.start_time * 1000).toLocaleString() })}{' '}
          {server.stats_reset === null ? t('server.counting_since_creation') : t('server.counting_since', { reset: new Date(server.stats_reset * 1000).toLocaleString() })}
        </p>
      </div>

      <div className="row align-items-start">
        <CounterTable
          title={t('server.transactions')}
          perHour={perHour}
          rows={[
            { name: t('server.committed'), value: totals.xact_commit },
            { name: t('server.rolled_back'), value: totals.xact_rollback },
            { name: t('server.total'), value: totals.xact_commit + totals.xact_rollback },
          ]}
        />

        <table className="table table-striped table-hover col-12 col-md-6 w-auto">
          <thead>
            <tr>
              <th scope="col">{t('server.sessions')}</th>
              <th className="text-end" scope="col">#</th>
              <th className="text-end" scope="col">%</th>
            </tr>
          </thead>
          <tbody>
            {STATES.filter((state) => sessions[state] !== undefined || state === 'active' || state === 'idle').map((state) => (
              <tr key={state}>
                <th scope="row">{t(`server.states.${state}`)}</th>
                <td className="font-monospace text-end">{integer.format(sessions[state] ?? 0)}</td>
                <td className="font-monospace text-end">{percent(sessions[state] ?? 0, server.max_connections)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">{t('server.background')}</th>
              <td className="font-monospace text-end">{integer.format(sessions.background ?? 0)}</td>
              <td className="font-monospace text-end">---</td>
            </tr>
            <tr>
              <th scope="row">{t('server.total')}</th>
              <td className="font-monospace text-end">{integer.format(clients)}</td>
              <td className="font-monospace text-end">{percent(clients, server.max_connections)}</td>
            </tr>
            <tr>
              <th scope="row">{t('server.max_connections')}</th>
              <td className="font-monospace text-end">{integer.format(server.max_connections)}</td>
              <td className="font-monospace text-end" title={t('server.reserved', { count: server.reserved_connections })}>
                100.00%
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="row align-items-start">
        <CounterTable
          title={t('server.rows')}
          perHour={perHour}
          rows={[
            { name: t('server.returned'), value: totals.tup_returned },
            { name: t('server.fetched'), value: totals.tup_fetched },
            { name: t('server.inserted'), value: totals.tup_inserted },
            { name: t('server.updated'), value: totals.tup_updated },
            { name: t('server.deleted'), value: totals.tup_deleted },
          ]}
        />

        <table className="table table-striped table-hover col-12 col-md-6 w-auto">
          <thead>
            <tr>
              <th scope="col">{t('server.block_io')}</th>
              <th className="text-end" scope="col">#</th>
              <th className="text-end" scope="col">{t('server.per_hour')}</th>
              <th className="text-end" scope="col">%</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: t('server.blocks_read'), value: totals.blks_read },
              { name: t('server.blocks_hit'), value: totals.blks_hit },
              { name: t('server.total'), value: blocks },
            ].map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td className="font-monospace text-end">{integer.format(row.value)}</td>
                <td className="font-monospace text-end">{twoDecimals.format(perHour(row.value))}</td>
                <td className="font-monospace text-end">{percent(row.value, blocks)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <CounterTable
          title={t('server.other')}
          perHour={perHour}
          rows={[
            { name: t('server.temp_files'), value: totals.temp_files },
            { name: t('server.temp_bytes'), value: totals.temp_bytes, bytes: true },
            { name: t('server.deadlocks'), value: totals.deadlocks },
            { name: t('server.conflicts'), value: totals.conflicts },
          ]}
        />
      </div>

      {server.in_recovery && (
        <p className="alert alert-primary clearfloat" role="alert">
          <Icon name="s_replication" /> {t('server.standby')}
        </p>
      )}
    </div>
  )
}

/** A phpMyAdmin Traffic-style table: name, count and average per hour. */
function CounterTable({ title, rows, perHour }: { title: string; rows: Row[]; perHour: (value: number) => number }) {
  const { t } = useTranslation('status')

  return (
    <table className="table table-striped table-hover col-12 col-md-5 w-auto">
      <thead>
        <tr>
          <th scope="col">{title}</th>
          <th className="text-end" scope="col">#</th>
          <th className="text-end" scope="col">{t('server.per_hour')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <th scope="row">{row.name}</th>
            <td className="font-monospace text-end">{row.bytes ? formatSize(row.value) : integer.format(row.value)}</td>
            <td className="font-monospace text-end">{row.bytes ? formatSize(Math.round(perHour(row.value))) : twoDecimals.format(perHour(row.value))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** phpMyAdmin's Util::timespanFormat: "0 days, 2 hours, 8 minutes and 52 seconds". */
function timespan(t: (key: string, options?: Record<string, unknown>) => string, total: number): string {
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)

  return t('server.timespan', { days, hours, minutes, seconds: total % 60 })
}
