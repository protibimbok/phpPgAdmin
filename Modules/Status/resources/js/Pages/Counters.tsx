import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import { listDatabases } from '@databases/js/api'
import { counters, type Counter, type CounterGroup } from '../api'
import StatusNav from '../StatusNav'

/** The documentation of each view, which the help icon of its rows opens. */
const DOCS: Record<CounterGroup['id'], string> = {
  database: 'https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-DATABASE-VIEW',
  bgwriter: 'https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-BGWRITER-VIEW',
  checkpointer: 'https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-CHECKPOINTER-VIEW',
}

type Values = Record<string, number>

/**
 * The counters phpMyAdmin would mark, as its status variables' alerts: true when the value is a
 * warning sign, false when it is fine. A counter without a rule has no colour.
 */
const ALERTS: Record<string, (value: number, group: Values) => boolean> = {
  'database.deadlocks': (v) => v > 0,
  'database.conflicts': (v) => v > 0,
  'database.checksum_failures': (v) => v > 0,
  'database.sessions_abandoned': (v) => v > 0,
  'database.sessions_fatal': (v) => v > 0,
  // A buffer cache hit ratio under 90 %.
  'database.blks_read': (v, g) => v > 0 && v / (v + (g.blks_hit ?? 0)) > 0.1,
  'bgwriter.maxwritten_clean': (v) => v > 0,
  'bgwriter.buffers_backend_fsync': (v) => v > 0,
  // More checkpoints requested (WAL filling up) than started by checkpoint_timeout.
  'bgwriter.checkpoints_req': (v, g) => v > (g.checkpoints_timed ?? 0),
  'checkpointer.num_requested': (v, g) => v > (g.num_timed ?? 0),
}

const UNITS = ['k', 'M', 'G', 'T', 'P', 'E']
const fraction = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const whole = new Intl.NumberFormat()

/** phpMyAdmin's format_number(value, 3, 1): three digits before the point at most, with a unit. */
function formatValue(value: number): string {
  let scaled = value
  let unit = -1
  while (Math.abs(scaled) >= 1000 && unit < UNITS.length - 1) {
    scaled /= 1000
    unit++
  }

  return unit < 0 ? fraction.format(scaled) : `${fraction.format(scaled)} ${UNITS[unit]}`
}

interface Row extends Counter {
  group: CounterGroup['id']
  alert: boolean | null
}

/**
 * phpMyAdmin's Status » All status variables (server/status/variables) for PostgreSQL's
 * cumulative statistics: pg_stat_database for one database or every one summed, then
 * pg_stat_bgwriter and pg_stat_checkpointer (PostgreSQL 17 and later), with the Filters card
 * (containing the word, only alert values, a category, unformatted values) and Variable / Value /
 * Description rows; values of 1000 and over are shortened with the exact one on hover.
 */
export default function Counters() {
  const { t } = useTranslation('status')
  const [database, setDatabase] = useState('')
  const [filter, setFilter] = useState('')
  const [onlyAlerts, setOnlyAlerts] = useState(false)
  const [category, setCategory] = useState('')
  const [unformatted, setUnformatted] = useState(false)
  const { data, error, reload } = useRequest(() => counters(database || undefined), [database])
  const { data: databases } = useRequest(() => listDatabases(), [])

  const rows = useMemo<Row[]>(
    () =>
      (data?.groups ?? []).flatMap((group) => {
        const values: Values = Object.fromEntries(group.rows.filter((r) => r.numeric && r.value !== null).map((r) => [r.name, Number(r.value)]))
        const rule = (name: string) => ALERTS[`${group.id}.${name}`]

        return group.rows.map((row) => ({ ...row, group: group.id, alert: rule(row.name) && row.numeric ? rule(row.name)(Number(row.value), values) : null }))
      }),
    [data],
  )
  const word = filter.toLowerCase().replace(/ /g, '_')
  const shown = rows.filter((row) => (category === '' || row.group === category) && (!onlyAlerts || row.alert === true) && (word === '' || row.name.includes(word)))

  return (
    <div className="container-fluid">
      <StatusNav />

      <div className="card mb-3" id="tableFilter">
        <div className="card-header">{t('processes.filters')}</div>
        <div className="card-body">
          <form className="row row-cols-lg-auto g-3 align-items-center" onSubmit={(e) => { e.preventDefault(); reload() }}>
            <label className="col-12 col-form-label" htmlFor="filterText">
              {t('variables.containing')}
            </label>
            <div className="col-12">
              <input className="form-control" name="filterText" type="text" id="filterText" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>

            <div className="col-12">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" name="filterAlert" id="filterAlert" checked={onlyAlerts} onChange={(e) => setOnlyAlerts(e.target.checked)} />
                <label className="form-check-label" htmlFor="filterAlert">
                  {t('counters.only_alerts')}
                </label>
              </div>
            </div>

            <div className="col-12">
              <label className="visually-hidden" htmlFor="filterCategory">
                {t('counters.category')}
              </label>
              <select className="form-select" id="filterCategory" name="filterCategory" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">{t('counters.category')}</option>
                {(data?.groups ?? []).map((group) => (
                  <option key={group.id} value={group.id}>
                    {t(`counters.categories.${group.id}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-12">
              <label className="visually-hidden" htmlFor="filterDatabase">
                {t('processes.database')}
              </label>
              <select className="form-select" id="filterDatabase" value={database} onChange={(e) => setDatabase(e.target.value)}>
                <option value="">{t('processes.all_databases')}</option>
                {(databases ?? []).map((d) => (
                  <option key={d.did} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="col-12">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" name="dontFormat" id="dontFormat" checked={unformatted} onChange={(e) => setUnformatted(e.target.checked)} />
                <label className="form-check-label" htmlFor="dontFormat">
                  {t('counters.unformatted')}
                </label>
              </div>
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
        <table className="table table-striped table-hover table-sm" id="serverStatusVariables">
          <colgroup>
            <col className="namecol" />
            <col className="valuecol" />
            <col className="descrcol" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{t('variables.variable')}</th>
              <th scope="col">{t('variables.value')}</th>
              <th scope="col">{t('counters.description')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={`${row.group}.${row.name}`} className={`s_${row.group}`}>
                <th className="name">
                  {row.name.replaceAll('_', ' ')}{' '}
                  <a href={DOCS[row.group]} target="_blank" rel="noopener noreferrer">
                    <Icon name="b_help" title={t('counters.documentation')} />
                  </a>
                </th>
                <td className="value font-monospace text-end">
                  <Value row={row} unformatted={unformatted} />
                </td>
                <td className="w-50">{t(`counters.descriptions.${row.group}.${row.name}`, { defaultValue: '' })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Value({ row, unformatted }: { row: Row; unformatted: boolean }) {
  const value = row.value ?? ''
  const number = Number(row.value)
  const text = unformatted || !row.numeric ? (
    value
  ) : Math.abs(number) >= 1000 ? (
    <abbr title={whole.format(number)}>{formatValue(number)}</abbr>
  ) : (
    formatValue(number)
  )

  return <span className={unformatted ? 'original' : 'formatted'}>{row.alert === null ? text : <span className={row.alert ? 'text-danger' : 'text-success'}>{text}</span>}</span>
}
