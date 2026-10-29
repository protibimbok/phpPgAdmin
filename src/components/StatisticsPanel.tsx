import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import { formatSize } from '@/format'
import type { Statistics } from '@/nodes/client'

export interface StatisticsPanelProps {
  /** The object's statistics: a node collection's statistics(oid). */
  load: () => Promise<Statistics>
  /** Reloads them when it changes: the object's identity. */
  reloadKey: string
  /** What to say when nothing has been gathered, if more than the general line helps. */
  empty?: string
}

/**
 * pgAdmin's Statistics tab for one object as a card: each statistic with its value, read from
 * the cumulative statistics views (pg_stat_*) through the node API. A size is shown in bytes'
 * units, a time as the browser writes it.
 */
export default function StatisticsPanel({ load, reloadKey, empty }: StatisticsPanelProps) {
  const { t } = useTranslation()
  const { data, error } = useRequest(load, [reloadKey])
  const row = data?.rows[0]

  return (
    <div className="card mb-3" id="object_statistics">
      <div className="card-header">{t('statistics.title')}</div>
      <div className="card-body">
        {error ? (
          <div className="alert alert-danger mb-0" role="alert">
            {error.message}
          </div>
        ) : data === undefined ? (
          t('loading')
        ) : !row ? (
          <div className="card-text">{empty ?? t('statistics.none')}</div>
        ) : (
          <table className="table table-striped table-hover w-auto mb-0">
            <thead>
              <tr>
                <th>{t('statistics.statistic')}</th>
                <th>{t('statistics.value')}</th>
              </tr>
            </thead>
            <tbody>
              {data.columns.map((column) => (
                <tr key={column.name}>
                  <th scope="row" className="fw-normal">
                    {column.name}
                  </th>
                  <td className="text-end">{formatStatistic(column, row[column.name])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/** A statistic as it reads best: sizes in units, timestamps in the browser's format, numbers grouped. */
export function formatStatistic(column: { name: string; type: string }, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (/size/i.test(column.name) && /^int/.test(column.type)) return formatSize(Number(value))
  if (column.type.startsWith('timestamp')) return new Date(String(value)).toLocaleString()
  if (typeof value === 'number') return value.toLocaleString()

  return String(value)
}
