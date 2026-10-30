import { useTranslation } from 'react-i18next'

export interface StatRows {
  /** The view the rows come from, "pg_stat_io". */
  view: string
  columns: string[]
  rows: (string | null)[][]
}

/**
 * A statistics view's rows as they are, one column per view column, in phpMyAdmin's striped
 * table: what pg_stat_io and the pg_stat_progress_* views show.
 */
export default function StatTable({ data, id, empty }: { data: StatRows; id: string; empty?: string }) {
  const { t } = useTranslation('status')

  return (
    <div className="card mb-3" id={id}>
      <div className="card-header">
        <code>{data.view}</code>
      </div>
      {data.rows.length === 0 ? (
        <div className="card-body">{empty ?? t('stats.none')}</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-striped table-hover table-sm w-auto mb-0">
            <thead>
              <tr>
                {data.columns.map((column) => (
                  <th key={column} scope="col">
                    {column.replaceAll('_', ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((value, j) => (
                    <td key={j} className={value !== null && /^-?\d+(\.\d+)?$/.test(value) ? 'font-monospace text-end' : undefined}>
                      {value ?? <i>NULL</i>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
