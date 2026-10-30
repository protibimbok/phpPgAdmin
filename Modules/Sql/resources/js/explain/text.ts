import type { RawExplain, RawNode } from './plan'

/** The properties a node's first line already says, or that the text format leaves out. */
const IN_HEADER = new Set([
  'Node Type',
  'Plans',
  'Parent Relationship',
  'Subplan Name',
  'Parallel Aware',
  'Async Capable',
  'Disabled',
  'Inner Unique',
  'Join Type',
  'Strategy',
  'Partial Mode',
  'Operation',
  'Command',
  'Scan Direction',
  'Index Name',
  'Relation Name',
  'Schema',
  'Alias',
  'CTE Name',
  'Function Name',
  'Startup Cost',
  'Total Cost',
  'Plan Rows',
  'Plan Width',
  'Actual Startup Time',
  'Actual Total Time',
  'Actual Rows',
  'Actual Loops',
  'Sort Space Used',
  'Sort Space Type',
  'Hash Buckets',
  'Original Hash Buckets',
  'Hash Batches',
  'Original Hash Batches',
  'Peak Memory Usage',
  'Exact Heap Blocks',
  'Lossy Heap Blocks',
])

const BUFFERS: [string, string, string][] = [
  ['shared', 'hit', 'Shared Hit Blocks'],
  ['shared', 'read', 'Shared Read Blocks'],
  ['shared', 'dirtied', 'Shared Dirtied Blocks'],
  ['shared', 'written', 'Shared Written Blocks'],
  ['local', 'hit', 'Local Hit Blocks'],
  ['local', 'read', 'Local Read Blocks'],
  ['local', 'dirtied', 'Local Dirtied Blocks'],
  ['local', 'written', 'Local Written Blocks'],
  ['temp', 'read', 'Temp Read Blocks'],
  ['temp', 'written', 'Temp Written Blocks'],
]

const IO = ['Shared I/O Read Time', 'Shared I/O Write Time', 'Local I/O Read Time', 'Local I/O Write Time', 'Temp I/O Read Time', 'Temp I/O Write Time']

const WAL = [
  ['records', 'WAL Records'],
  ['fpi', 'WAL FPI'],
  ['bytes', 'WAL Bytes'],
  ['buffers full', 'WAL Buffers Full'],
] as const

const fixed2 = (value: unknown) => (typeof value === 'number' ? value.toFixed(2) : String(value))

const valueText = (value: unknown): string => {
  if (Array.isArray(value)) return value.map((v) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v))).join(', ')
  if (typeof value === 'object' && value !== null) return JSON.stringify(value)

  return String(value)
}

/** What PostgreSQL's text format calls a node: "Hash Left Join", "Parallel Seq Scan on public.books b". */
function title(node: RawNode): string {
  const join = typeof node['Join Type'] === 'string' && node['Join Type'] !== 'Inner' ? node['Join Type'] : null
  let name = node['Node Type']
  if (name === 'ModifyTable' && typeof node.Operation === 'string') name = node.Operation
  else if (name === 'Aggregate' && node.Strategy === 'Hashed') name = 'HashAggregate'
  else if (name === 'Aggregate' && node.Strategy === 'Sorted') name = 'GroupAggregate'
  else if (name === 'Aggregate' && node.Strategy === 'Mixed') name = 'MixedAggregate'
  else if (name === 'SetOp') name = `${node.Strategy === 'Hashed' ? 'HashSetOp' : 'SetOp'} ${String(node.Command ?? '')}`.trim()
  else if (join && name === 'Nested Loop') name = `Nested Loop ${join} Join`
  else if (join && name.endsWith(' Join')) name = `${name.slice(0, -' Join'.length)} ${join} Join`
  if (node['Scan Direction'] === 'Backward') name += ' Backward'
  if (node['Parallel Aware'] === true) name = `Parallel ${name}`
  if (node['Partial Mode'] === 'Partial') name = `Partial ${name}`
  else if (node['Partial Mode'] === 'Finalize') name = `Finalize ${name}`

  if (node['Index Name'] !== undefined) name += ` using ${String(node['Index Name'])}`
  if (node['Relation Name'] !== undefined) {
    name += ` on ${node.Schema !== undefined ? `${String(node.Schema)}.` : ''}${String(node['Relation Name'])}`
    if (node.Alias !== undefined && node.Alias !== node['Relation Name']) name += ` ${String(node.Alias)}`
  } else if (node['CTE Name'] !== undefined) {
    name += ` on ${String(node['CTE Name'])}`
    if (node.Alias !== undefined && node.Alias !== node['CTE Name']) name += ` ${String(node.Alias)}`
  } else if (node['Function Name'] !== undefined) {
    name += ` on ${node.Schema !== undefined ? `${String(node.Schema)}.` : ''}${String(node['Function Name'])}`
    if (node.Alias !== undefined && node.Alias !== node['Function Name']) name += ` ${String(node.Alias)}`
  }

  if (node['Startup Cost'] !== undefined) {
    name += `  (cost=${fixed2(node['Startup Cost'])}..${fixed2(node['Total Cost'])} rows=${node['Plan Rows']} width=${node['Plan Width']})`
  }
  if (node['Actual Loops'] === 0) {
    name += ' (never executed)'
  } else if (node['Actual Rows'] !== undefined) {
    const fixed3 = (value: unknown) => (typeof value === 'number' ? value.toFixed(3) : String(value))
    const time = node['Actual Total Time'] !== undefined ? `time=${fixed3(node['Actual Startup Time'])}..${fixed3(node['Actual Total Time'])} ` : ''
    name += ` (actual ${time}rows=${node['Actual Rows']} loops=${node['Actual Loops']})`
  }

  return name
}

/** The lines PostgreSQL prints under a node, from its remaining properties. */
function details(node: Record<string, unknown>, skip: Set<string>): string[] {
  const lines: string[] = []
  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value) && value.length === 0) continue
    if (skip.has(key) || BUFFERS.some(([, , k]) => k === key) || IO.includes(key) || WAL.some(([, k]) => k === key)) continue
    if (key === 'Sort Method') {
      lines.push(`Sort Method: ${String(value)}  ${node['Sort Space Type'] ?? ''}: ${node['Sort Space Used'] ?? ''}kB`)
      continue
    }
    if (key === 'Settings' && typeof value === 'object' && value !== null) {
      lines.push(`Settings: ${Object.entries(value).map(([k, v]) => `${k} = '${String(v)}'`).join(', ')}`)
      continue
    }
    if (key === 'Planning' && typeof value === 'object' && value !== null) {
      lines.push('Planning:', ...buffers(value as Record<string, unknown>).map((l) => `  ${l}`))
      continue
    }
    if (key.endsWith(' Time') && typeof value === 'number') {
      lines.push(`${key}: ${value.toFixed(3)} ms`)
      continue
    }
    lines.push(`${key}: ${valueText(value)}`)
  }
  if ('Hash Buckets' in node) {
    lines.push(`Buckets: ${node['Hash Buckets']}  Batches: ${node['Hash Batches']}  Memory Usage: ${node['Peak Memory Usage']}kB`)
  }
  if ('Exact Heap Blocks' in node && (node['Exact Heap Blocks'] !== 0 || node['Lossy Heap Blocks'] !== 0)) {
    lines.push(`Heap Blocks: exact=${node['Exact Heap Blocks']}${node['Lossy Heap Blocks'] ? ` lossy=${node['Lossy Heap Blocks']}` : ''}`)
  }

  return [...lines, ...buffers(node)]
}

/** "Buffers: shared hit=8 read=2, temp written=4", "I/O Timings: …" and "WAL: …", as the text format writes them. */
function buffers(node: Record<string, unknown>): string[] {
  const lines: string[] = []
  const groups = new Map<string, string[]>()
  for (const [group, label, key] of BUFFERS) {
    const value = node[key]
    if (typeof value === 'number' && value > 0) groups.set(group, [...(groups.get(group) ?? []), `${label}=${value}`])
  }
  if (groups.size > 0) lines.push(`Buffers: ${[...groups].map(([group, parts]) => `${group} ${parts.join(' ')}`).join(', ')}`)
  const io = IO.filter((key) => typeof node[key] === 'number' && (node[key] as number) > 0).map((key) => `${key.replace(' I/O', '').replace(' Time', '').toLowerCase()}=${(node[key] as number).toFixed(3)}`)
  if (io.length > 0) lines.push(`I/O Timings: ${io.join(' ')}`)
  const wal = WAL.filter(([, key]) => typeof node[key] === 'number' && (node[key] as number) > 0).map(([label, key]) => `${label}=${node[key]}`)
  if (wal.length > 0) lines.push(`WAL: ${wal.join(' ')}`)

  return lines
}

/**
 * The plan as PostgreSQL's text format lays it out, written from the JSON: each node's line
 * ("->" under its parent, six columns further in), its details two columns in, the planning and
 * execution figures at the end.
 */
export function planText(source: RawExplain): string {
  const out: string[] = []
  const walk = (node: RawNode, depth: number) => {
    const indent = depth === 0 ? '' : ' '.repeat(2 + 6 * (depth - 1))
    if (depth > 0 && (node['Parent Relationship'] === 'SubPlan' || node['Parent Relationship'] === 'InitPlan') && node['Subplan Name'] !== undefined) {
      out.push(`${' '.repeat(Math.max(0, indent.length - 2))}  ${String(node['Subplan Name'])}`)
    }
    out.push(`${indent}${depth === 0 ? '' : '->  '}${title(node)}`)
    const pad = ' '.repeat(2 + 6 * depth)
    for (const line of details(node, IN_HEADER)) out.push(pad + line)
    for (const child of node.Plans ?? []) walk(child, depth + 1)
  }
  walk(source.Plan, 0)
  const top = Object.fromEntries(Object.entries(source).filter(([key]) => key !== 'Plan'))
  out.push(...details(top, new Set()))

  return out.join('\n')
}
