import { imageFor } from './images'

/** One node of EXPLAIN (FORMAT JSON) output, as the server writes it. */
export type RawNode = Record<string, unknown> & { 'Node Type': string; Plans?: RawNode[] }

/** The top object of EXPLAIN (FORMAT JSON): the plan and the run's own figures. */
export type RawExplain = Record<string, unknown> & { Plan: RawNode }

/** pgAdmin's severity of a share of the query: 1 (≤10%) … 4 (>90%), or of a row estimate's error. */
export type Flag = 1 | 2 | 3 | 4

/** A node laid out the way pgAdmin's Explain/index.jsx parsePlan places it, with its figures. */
export interface PlanNode {
  raw: RawNode
  /** Its number in pre-order, from 1. */
  serial: number
  /** Its path from the root, [1, 1, 2]; the key of its row in the Analysis table. */
  level: number[]
  parentKey: string
  xpos: number
  ypos: number
  width: number
  height: number
  image: string
  imageText: string
  /** The node's label under its icon: schema.text, or the text. */
  label: string
  /** The width of the arrow to its parent, 1 to 10. */
  arrowSize: number
  /** The node's share of the plan's total cost without its children (not timed), or of the time (ANALYZE). */
  shade?: Flag
  children: PlanNode[]
  inclusive?: number
  exclusive?: number
  inclusiveFlag?: Flag
  exclusiveFlag?: Flag
  rowsx?: number
  rowsxFlag?: Flag
  rowsxDirection?: 'positive' | 'negative'
  totalTime?: number
  loops?: number
}

export interface StatisticsRow {
  name: string
  count: number
  sumOfTimes: number
}

export interface PlanAnalysis {
  root: PlanNode
  /** The whole drawing's size. */
  width: number
  height: number
  /** Every node in pre-order. */
  nodes: PlanNode[]
  showTimings: boolean
  showRowsx: boolean
  showRows: boolean
  showPlanRows: boolean
  totalTime?: number
  nodeStats: Map<string, StatisticsRow>
  tableStats: Map<string, StatisticsRow & { nodes: Map<string, StatisticsRow> }>
  /** Planning Time, Execution Time, Settings, Triggers, JIT and the like: the run's own figures. */
  summary: [string, unknown][]
  source: RawExplain
}

// pgAdmin's layout constants (Explain/index.jsx and Graphical.jsx).
export const P_WIDTH = 100
export const P_HEIGHT = 100
const OFFSET_X = 200
const OFFSET_Y = 60
export const X_MARGIN = 25
export const Y_MARGIN = 25
const DEFAULT_ARROW_SIZE = 2

/** Math.ceil10 of pgAdmin's utils.js: rounded up at 10^exp. */
export function ceil10(value: number, exp: number): number {
  if (!Number.isFinite(value)) return value
  const shifted = Math.ceil(Number(`${value}e${-exp}`))

  return Number(`${shifted}e${exp}`)
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function flagOf(factor: number): Flag {
  if (factor <= 0.1) return 1
  if (factor < 0.5) return 2
  if (factor <= 0.9) return 3

  return 4
}

interface Ctx {
  total: number
  nodes: PlanNode[]
  /** The root's total cost, for the cost shading of a plan that was not timed. */
  rootCost: number
}

interface Place {
  xpos: number
  ypos: number
  level: number[]
  parentKey: string
  totalTime?: number
  loops?: number
}

/** pgAdmin's parsePlan: a node's position, size, icon, timings and row estimate, then its children's. */
function parsePlan(raw: RawNode, place: Place, ctx: Ctx): PlanNode {
  let xpos = place.xpos - P_WIDTH
  let ypos = place.ypos
  const node: PlanNode = {
    raw,
    serial: ++ctx.total,
    level: place.level,
    parentKey: place.parentKey,
    xpos,
    ypos,
    width: P_WIDTH,
    height: P_HEIGHT,
    image: '',
    imageText: '',
    label: '',
    arrowSize: DEFAULT_ARROW_SIZE,
    children: [],
    totalTime: place.totalTime,
    loops: place.loops,
  }
  ctx.nodes.push(node)

  // The arrow grows with the rows the node hands up: actual rows of every loop after ANALYZE,
  // the planned ones otherwise, on pgAdmin's logarithmic scale of 1 to 10.
  const actualRows = num(raw['Actual Rows'])
  const rows = actualRows !== undefined ? actualRows * (num(raw['Actual Loops']) ?? 1) : num(raw['Plan Rows'])
  if (rows !== undefined) node.arrowSize = Math.min(10, Math.max(1, Math.round(Math.log(rows))))

  if (raw['Parent Relationship'] === 'SubPlan') {
    node.width += X_MARGIN * 2 + X_MARGIN / 2
    node.height += Y_MARGIN * 2
    node.ypos += Y_MARGIN
    xpos -= X_MARGIN
    ypos += Y_MARGIN
  }

  const mapped = imageFor(raw)
  node.image = mapped.image
  node.imageText = mapped.text
  node.label = typeof raw.Schema === 'string' ? `${raw.Schema}.${mapped.text}` : mapped.text

  const actualTotal = num(raw['Actual Total Time'])
  const total = node.totalTime ?? actualTotal
  if (actualTotal !== undefined && 'Actual Loops' in raw) {
    node.inclusive = ceil10(actualTotal, -3)
    node.exclusive = node.inclusive
    node.inclusiveFlag = flagOf(node.inclusive / (total || 1))
  }

  const planRows = num(raw['Plan Rows'])
  if (actualRows !== undefined && planRows !== undefined) {
    let rowsx: number
    if (actualRows === 0 || actualRows > planRows) {
      rowsx = planRows === 0 ? 0 : actualRows / planRows
      node.rowsxDirection = 'negative'
    } else {
      rowsx = actualRows === 0 ? 0 : planRows / actualRows
      node.rowsxDirection = 'positive'
    }
    node.rowsxFlag = rowsx <= 10 ? 1 : rowsx <= 100 ? 2 : rowsx <= 1000 ? 3 : 4
    node.rowsx = node.loops !== undefined ? ceil10(rowsx / node.loops || 1, -2) : ceil10(rowsx, -2)
  }

  const plans = raw.Plans ?? []
  if (plans.length > 0) {
    node.width += OFFSET_X
    let maxChildWidth = 0
    plans.forEach((child, i) => {
      const idx = i + 1
      const plan = parsePlan(
        child,
        {
          xpos: xpos - OFFSET_X,
          ypos,
          level: [...node.level, idx],
          parentKey: node.level.join('_'),
          totalTime: node.totalTime ?? actualTotal,
          loops: num(raw['Actual Loops']),
        },
        ctx,
      )
      maxChildWidth = Math.max(maxChildWidth, plan.width)
      if (node.exclusive !== undefined && plan.inclusive !== undefined && plan.inclusive < node.exclusive) node.exclusive -= plan.inclusive
      if (idx !== 1) node.height += plan.height + OFFSET_Y
      else if (plan.height > node.height) node.height = plan.height
      ypos += plan.height + OFFSET_Y
      node.children.push(plan)
    })
    node.width += maxChildWidth
  } else if (node.loops !== undefined && node.exclusive !== undefined && actualTotal !== undefined) {
    node.inclusive = ceil10(actualTotal / node.loops || 1, -3)
    node.exclusive = node.inclusive
  }

  if (node.exclusive !== undefined) {
    node.exclusive = ceil10(node.exclusive, -3)
    node.exclusiveFlag = flagOf(node.exclusive / (total || 1))
  }

  // The icon's shading: the node's own share of the time, or (not timed) of the plan's cost.
  if (node.exclusiveFlag !== undefined) {
    node.shade = node.exclusiveFlag
  } else {
    const cost = num(raw['Total Cost'])
    if (cost !== undefined && ctx.rootCost > 0) {
      const own = cost - plans.reduce((sum, p) => sum + (num(p['Total Cost']) ?? 0), 0)
      node.shade = flagOf(Math.max(0, own) / ctx.rootCost)
    }
  }

  return node
}

/** The text a node gets in the Analysis table and the statistics, after pgAdmin's nodeExplainTableData. */
export function nodeName(node: PlanNode): string {
  return /Scan/.test(node.raw['Node Type']) ? node.raw['Node Type'] : node.imageText
}

/** "Seq Scan on public.books as b (cost=… rows=… width=…) (actual=…)": a node's line in the Analysis table. */
export function nodeDisplayText(node: PlanNode): string {
  const raw = node.raw
  const parts = [nodeName(node)]
  if (raw['Index Name'] !== undefined) parts.push(` using ${String(raw['Index Name'])}`)
  if (raw['Relation Name'] !== undefined) {
    parts.push(' on ')
    if (raw.Schema !== undefined) parts.push(`${String(raw.Schema)}.`)
    parts.push(String(raw['Relation Name']))
    if (raw.Alias !== undefined) parts.push(` as ${String(raw.Alias)}`)
  }
  if (raw['Plan Rows'] !== undefined && raw['Plan Width'] !== undefined) {
    parts.push(` (cost=${raw['Startup Cost'] ?? ''}..${raw['Total Cost'] ?? ''} rows=${raw['Plan Rows']} width=${raw['Plan Width']})`)
  }
  if (raw['Actual Startup Time'] !== undefined || raw['Actual Total Time'] !== undefined || raw['Actual Rows'] !== undefined) {
    parts.push(
      ` (${raw['Actual Startup Time'] !== undefined ? `actual=${raw['Actual Startup Time']}..` : ''}${raw['Actual Total Time'] !== undefined ? `${raw['Actual Total Time']} ` : ''}${raw['Actual Rows'] !== undefined ? `rows=${raw['Actual Rows']}` : ''}${raw['Actual Loops'] !== undefined ? ` loops=${raw['Actual Loops']}` : ''})`,
    )
  }

  return parts.join('')
}

/** The extra lines pgAdmin lists under a node in the Analysis table: its conditions and memory. */
export function nodeExtraInfo(raw: RawNode): [string, string][] {
  const info: [string, string][] = []
  for (const key of ['Join Filter', 'Filter', 'Index Cond', 'Hash Cond', 'Rows Removed by Filter']) {
    if (key in raw) info.push([key, String(raw[key])])
  }
  if ('Peak Memory Usage' in raw) info.push(['Buckets', `${raw['Hash Buckets']}  Batches: ${raw['Hash Batches']}  Memory Usage: ${raw['Peak Memory Usage']} kB`])
  if ('Recheck Cond' in raw) info.push(['Recheck Cond', String(raw['Recheck Cond'])])
  if ('Exact Heap Blocks' in raw) info.push(['Heap Blocks', `exact=${raw['Exact Heap Blocks']}`])

  return info
}

const SUMMARY_KEYS = ['Planning', 'Planning Time', 'Triggers', 'JIT', 'Serialization', 'Execution Time', 'Settings']

/** pgAdmin's parsePlanData: the laid-out plan, the Analysis table's columns and the statistics. */
export function analyse(source: RawExplain): PlanAnalysis {
  const ctx: Ctx = { total: 0, nodes: [], rootCost: num(source.Plan['Total Cost']) ?? 0 }
  const root = parsePlan(source.Plan, { xpos: 0, ypos: 0, level: [1], parentKey: '', loops: 1 }, ctx)

  const nodeStats = new Map<string, StatisticsRow>()
  const tableStats = new Map<string, StatisticsRow & { nodes: Map<string, StatisticsRow> }>()
  let showTimings = false
  let showRowsx = false
  let showRows = false
  let showPlanRows = false
  for (const node of ctx.nodes) {
    const raw = node.raw
    if (node.exclusiveFlag !== undefined) showTimings = true
    if (node.rowsxFlag !== undefined) showRowsx = true
    if (raw['Actual Loops'] !== undefined) showRows = true
    if (raw['Plan Rows'] !== undefined) showPlanRows = true

    const name = nodeName(node)
    const time = node.exclusive ?? 0
    if (raw['Relation Name'] !== undefined) {
      const relation = `${raw.Schema !== undefined ? `${String(raw.Schema)}.` : ''}${String(raw['Relation Name'])}`
      const table = tableStats.get(relation) ?? { name: relation, count: 0, sumOfTimes: 0, nodes: new Map<string, StatisticsRow>() }
      const tableNode = table.nodes.get(name) ?? { name, count: 0, sumOfTimes: 0 }
      table.count++
      table.sumOfTimes += time
      tableNode.count++
      tableNode.sumOfTimes += time
      table.nodes.set(name, tableNode)
      tableStats.set(relation, table)
    }
    const stat = nodeStats.get(name) ?? { name, count: 0, sumOfTimes: 0 }
    stat.count++
    stat.sumOfTimes += time
    nodeStats.set(name, stat)
  }

  return {
    root,
    width: root.width + X_MARGIN * 2,
    height: root.height + Y_MARGIN * 4,
    nodes: ctx.nodes,
    showTimings,
    showRowsx,
    showRows,
    showPlanRows,
    totalTime: num(source.Plan['Actual Total Time']),
    nodeStats,
    tableStats,
    summary: SUMMARY_KEYS.filter((key) => key in source && !(Array.isArray(source[key]) && (source[key] as unknown[]).length === 0)).map((key) => [key, compact(source[key])]),
    source,
  }
}

/** An object of counters with its zero ones left out: the Planning buffers of the summary. */
function compact(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value
  const entries = Object.entries(value).filter(([, v]) => v !== 0)

  return entries.length > 0 ? entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('\n') : '—'
}

/** A property's value as the details table and the tooltip show it: arrays a line each, objects as JSON. */
export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v))).join('\n')
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, null, 2)

  return value === undefined ? '' : String(value)
}

/** A node's own properties, without its children: what a click on it lists. */
export function nodeProperties(raw: RawNode): [string, unknown][] {
  return Object.entries(raw).filter(([key]) => key !== 'Plans')
}
