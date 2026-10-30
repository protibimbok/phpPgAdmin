/**
 * The EXPLAIN options of pgAdmin's Explain Settings menu, and the statement they make. They are
 * kept per browser, like pgAdmin keeps them per user, so the links under every result use the
 * ones last chosen.
 */
export interface ExplainOptions {
  verbose: boolean
  costs: boolean
  /** ANALYZE only, as pgAdmin sends them. */
  buffers: boolean
  timing: boolean
  wal: boolean
  summary: boolean
  settings: boolean
  /** PostgreSQL 16 and later; never with ANALYZE. */
  generic_plan: boolean
  /** PostgreSQL 17 and later. */
  memory: boolean
  /** PostgreSQL 17 and later, ANALYZE only. */
  serialize: 'none' | 'text' | 'binary'
}

export const DEFAULT_OPTIONS: ExplainOptions = {
  verbose: true,
  costs: true,
  buffers: true,
  timing: true,
  wal: false,
  summary: true,
  settings: false,
  generic_plan: false,
  memory: false,
  serialize: 'none',
}

const STORAGE_KEY = 'explainOptions'

export function loadOptions(): ExplainOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ExplainOptions> | null
    if (stored && typeof stored === 'object') return { ...DEFAULT_OPTIONS, ...stored }
  } catch {
    // Storage may be unavailable or hold something else; the defaults apply.
  }

  return { ...DEFAULT_OPTIONS }
}

export function saveOptions(options: ExplainOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // Nothing kept; the options still apply to this run.
  }
}

/** The server's major version from the session's "18.6" or "16.4 (Debian …)"; 0 when unknown. */
export function majorVersion(version: string | null | undefined): number {
  const major = parseInt(version ?? '', 10)

  return Number.isFinite(major) ? major : 0
}

/** The options a server accepts, as pgAdmin's 16_plus and 17_plus templates add them. */
export function supported(major: number): { generic_plan: boolean; memory: boolean; serialize: boolean } {
  // An unknown version shows them all; the server says so if it does not know one.
  const known = major > 0

  return { generic_plan: !known || major >= 16, memory: !known || major >= 17, serialize: !known || major >= 17 }
}

/**
 * The statement pgAdmin's explain_plan.sql makes, in FORMAT JSON: VERBOSE, COSTS, SUMMARY,
 * SETTINGS and MEMORY always; BUFFERS, TIMING, WAL and SERIALIZE only with ANALYZE;
 * GENERIC_PLAN only without it. An option that is on by default in PostgreSQL (COSTS, and
 * TIMING, SUMMARY and from 18 BUFFERS under ANALYZE) is written out when it is turned off.
 */
export function explainSql(sql: string, options: ExplainOptions, analyze: boolean, major = 0): string {
  const can = supported(major)
  const parts = ['FORMAT JSON']
  if (analyze) parts.push('ANALYZE')
  if (options.verbose) parts.push('VERBOSE')
  if (!options.costs) parts.push('COSTS false')
  if (analyze) {
    // PostgreSQL 18 reports buffers under ANALYZE by default.
    if (options.buffers) parts.push('BUFFERS')
    else if (major === 0 || major >= 18) parts.push('BUFFERS false')
    if (!options.timing) parts.push('TIMING false')
    if (options.wal) parts.push('WAL')
    if (!options.summary) parts.push('SUMMARY false')
  } else if (options.summary) {
    parts.push('SUMMARY')
  }
  if (options.settings) parts.push('SETTINGS')
  if (!analyze && options.generic_plan && can.generic_plan) parts.push('GENERIC_PLAN')
  if (options.memory && can.memory) parts.push('MEMORY')
  if (analyze && options.serialize !== 'none' && can.serialize) parts.push(`SERIALIZE ${options.serialize.toUpperCase()}`)

  return `EXPLAIN (${parts.join(', ')}) ${sql}`
}

/** The statement an EXPLAIN was run on: what "Skip Explain SQL" runs. */
export function stripExplain(sql: string): string {
  return sql.replace(/^\s*EXPLAIN\s+(\([^)]*\)\s*)?(ANALYZE\s+)?(VERBOSE\s+)?/i, '')
}

/** ANALYZE runs the statement, so it is offered for one that only reads: no INSERT, UPDATE, DELETE or MERGE in a WITH. */
export function mayAnalyze(sql: string): boolean {
  return !/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql)
}
