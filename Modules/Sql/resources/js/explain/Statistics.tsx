import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { ceil10, propertyText, type PlanAnalysis } from './plan'

const byName = <T extends { name: string }>(rows: Iterable<T>): T[] => [...rows].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))

/**
 * pgAdmin's Statistics tab: per node type, how many and (after ANALYZE) the time they took and
 * their share of the query; per relation, its scans with the same figures and each node type
 * under it with its share of the relation. Below them, the run's own figures (planning and
 * execution time, triggers, JIT, settings) when the plan has them.
 */
export default function Statistics({ analysis }: { analysis: PlanAnalysis }) {
  const { t } = useTranslation('sql')
  const timed = analysis.showTimings
  const total = analysis.totalTime || 1
  const ms = (value: number) => `${ceil10(value, -3)} ms`
  const pct = (value: number, of: number) => `${ceil10(((value || 0) / (of || 1)) * 100, -2)}%`

  return (
    <div className="row">
      <div className="col-lg-6">
        <table className="table table-striped table-sm w-100" id="explain_node_stats">
          <caption className="caption-top fw-bold">{t('explain.per_node_type')}</caption>
          <thead>
            <tr>
              <th>{t('explain.node_type')}</th>
              <th>{t('explain.count')}</th>
              {timed && (
                <>
                  <th>{t('explain.time_spent')}</th>
                  <th>{t('explain.of_query')}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {byName(analysis.nodeStats.values()).map((node) => (
              <tr key={node.name}>
                <td>{node.name}</td>
                <td>{node.count}</td>
                {timed && (
                  <>
                    <td>{ms(node.sumOfTimes)}</td>
                    <td>{pct(node.sumOfTimes, total)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="col-lg-6">
        <table className="table table-sm w-100" id="explain_table_stats">
          <caption className="caption-top fw-bold">{t('explain.per_relation')}</caption>
          <thead>
            <tr>
              <th>{t('explain.relation_name')}</th>
              <th>{t('explain.scan_count')}</th>
              {timed && (
                <>
                  <th>{t('explain.total_time')}</th>
                  <th>{t('explain.of_query')}</th>
                </>
              )}
            </tr>
            <tr>
              <th>{t('explain.node_type')}</th>
              <th>{t('explain.count')}</th>
              {timed && (
                <>
                  <th>{t('explain.sum_of_times')}</th>
                  <th>{t('explain.of_relation')}</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {byName(analysis.tableStats.values()).map((table) => (
              <Fragment key={table.name}>
                <tr className="explain-relation">
                  <td className="fw-bold">{table.name}</td>
                  <td>{table.count}</td>
                  {timed && (
                    <>
                      <td>{ms(table.sumOfTimes)}</td>
                      <td>{pct(table.sumOfTimes, total)}</td>
                    </>
                  )}
                </tr>
                {byName(table.nodes.values()).map((node) => (
                  <tr key={node.name}>
                    <td className="ps-4">{node.name}</td>
                    <td>{node.count}</td>
                    {timed && (
                      <>
                        <td>{ms(node.sumOfTimes)}</td>
                        <td>{pct(node.sumOfTimes, table.sumOfTimes)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {analysis.summary.length > 0 && (
        <div className="col-12">
          <table className="table table-striped table-sm w-auto" id="explain_summary">
            <caption className="caption-top fw-bold">{t('explain.summary')}</caption>
            <tbody>
              {analysis.summary.map(([key, value]) => (
                <tr key={key}>
                  <th scope="row">{key}</th>
                  <td className="explain-pre">{typeof value === 'number' && key.endsWith('Time') ? `${value} ms` : propertyText(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
