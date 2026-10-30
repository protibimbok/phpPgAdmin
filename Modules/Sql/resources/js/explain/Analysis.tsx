import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { nodeDisplayText, nodeExtraInfo, type PlanAnalysis, type PlanNode } from './plan'

/**
 * pgAdmin's Analysis tab: a row per node in plan order, indented by depth, with its exclusive
 * and inclusive time, the row estimate's error (↑ over, ↓ under), the actual and planned rows
 * and the loops. The time and estimate cells are coloured by pgAdmin's severities. Hovering a
 * row marks its children; a click on a row with children folds them.
 */
export default function Analysis({ analysis }: { analysis: PlanAnalysis }) {
  const { t } = useTranslation('sql')
  const [active, setActive] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const { showTimings, showRowsx, showRows, showPlanRows } = analysis
  const anyRows = showRowsx || showRows || showPlanRows
  const keyOf = (node: PlanNode) => node.level.join('_')
  const toggle = (node: PlanNode) => {
    if (node.children.length === 0) return
    const key = keyOf(node)
    setCollapsed((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  return (
    <div className="table-responsive-md">
      <table className="table table-striped table-hover table-sm w-auto explain-analysis" id="explain_analysis">
        <thead>
          <tr>
            <th rowSpan={2} className="explain-marker" />
            <th rowSpan={2}>#</th>
            <th rowSpan={2}>{t('explain.node')}</th>
            {showTimings && <th colSpan={2}>{t('explain.timings')}</th>}
            {anyRows && <th colSpan={showRowsx ? 3 : (showRows ? 1 : 0) + (showPlanRows ? 1 : 0)}>{t('explain.rows')}</th>}
            {(showRowsx || showRows) && <th rowSpan={2}>{t('explain.loops')}</th>}
          </tr>
          <tr>
            {showTimings && (
              <>
                <th>{t('explain.exclusive')}</th>
                <th>{t('explain.inclusive')}</th>
              </>
            )}
            {showRowsx && <th>{t('explain.rows_x')}</th>}
            {(showRowsx || showRows) && <th>{t('explain.actual')}</th>}
            {(showRowsx || showPlanRows) && <th>{t('explain.plan')}</th>}
          </tr>
        </thead>
        <tbody>
          {analysis.nodes.map((node) => {
            const key = keyOf(node)
            const hidden = collapsed.some((c) => node.parentKey === c || node.parentKey.startsWith(`${c}_`))
            if (hidden) return null
            const extra = nodeExtraInfo(node.raw)

            return (
              <tr
                key={key}
                data-ex-id={key}
                className={[node.children.length > 0 ? 'explain-collapsible' : '', collapsed.includes(key) ? 'explain-collapsed' : ''].filter(Boolean).join(' ') || undefined}
                onMouseEnter={() => setActive(key)}
                onMouseLeave={() => setActive(null)}
                onClick={() => toggle(node)}
              >
                <td className="explain-marker">{active === node.parentKey ? '•' : ''}</td>
                <td className="text-end">{node.serial}.</td>
                <td style={{ paddingInlineStart: `${node.level.length * 30}px` }} title={nodeDisplayText(node)}>
                  <span className="explain-arrow-text">→</span> {nodeDisplayText(node)}
                  {extra.length > 0 && (
                    <ul className="explain-extra">
                      {extra.map(([label, value], i) => (
                        <li key={i}>
                          <strong>{label}</strong>: {value}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                {showTimings && (
                  <>
                    <td className={`text-end explain-sev${node.exclusiveFlag ?? 1}`}>{node.exclusive !== undefined && `${node.exclusive} ms`}</td>
                    <td className={`text-end explain-sev${node.inclusiveFlag ?? 1}`}>{node.inclusive !== undefined && `${node.inclusive} ms`}</td>
                  </>
                )}
                {showRowsx && (
                  <td className={`text-end explain-sev${node.rowsxFlag ?? 1}`}>
                    {node.rowsxFlag !== undefined && (node.rowsxDirection === 'positive' ? '↑' : '↓')} {node.rowsx}
                  </td>
                )}
                {(showRowsx || showRows) && <td className="text-end">{String(node.raw['Actual Rows'] ?? '')}</td>}
                {(showRowsx || showPlanRows) && <td className="text-end">{String(node.raw['Plan Rows'] ?? '')}</td>}
                {(showRowsx || showRows) && <td className="text-end">{String(node.raw['Actual Loops'] ?? '')}</td>}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
