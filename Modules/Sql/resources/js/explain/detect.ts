import type { StatementResult } from '../api'
import type { RawExplain } from './plan'

/**
 * The plan an EXPLAIN (FORMAT JSON) result holds: one row of one "QUERY PLAN" column whose
 * value is a JSON array with the plan. Anything else (a text EXPLAIN, any other result) is null.
 */
export function explainJson(result: StatementResult): RawExplain | null {
  if (result.kind !== 'rows' || result.columns.length !== 1 || result.rows.length !== 1) return null
  if (result.columns[0].name !== 'QUERY PLAN' || !/^\s*EXPLAIN\b/i.test(result.sql)) return null
  const text = result.rows[0][0]
  if (text === null || !/^\s*\[/.test(text)) return null
  try {
    const parsed = JSON.parse(text) as unknown
    const first = Array.isArray(parsed) ? (parsed[0] as unknown) : null
    if (first && typeof first === 'object' && 'Plan' in first && typeof (first as RawExplain).Plan === 'object') return first as RawExplain
  } catch {
    // Not JSON after all.
  }

  return null
}
