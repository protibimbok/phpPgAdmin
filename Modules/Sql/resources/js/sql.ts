/** Helpers for composing SQL on the client, where the server's quoting is out of reach. */

/** A double-quoted identifier, always quoted. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

/** "schema"."name" */
export function qualifiedName(schema: string, name: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(name)}`
}

/** A single-quoted literal with its quotes doubled; backslashes stay literal (standard strings). */
export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

const NUMERIC_TYPES = new Set(['int2', 'int4', 'int8', 'float4', 'float8', 'numeric', 'oid', 'money', 'smallint', 'integer', 'bigint', 'real', 'double precision'])

/** Whether values of the type read as numbers, and so sit at the end of their cell. */
export function isNumericType(typeName: string): boolean {
  return NUMERIC_TYPES.has(typeName)
}

const BINARY_TYPES = new Set(['bytea'])

export function isBinaryType(typeName: string): boolean {
  return BINARY_TYPES.has(typeName)
}

/** The ORDER BY list as a URL parameter, "name:asc,other:desc", and back. */
export function serializeOrder(order: { name: string; desc?: boolean }[]): string {
  return order.map((o) => `${encodeURIComponent(o.name)}:${o.desc ? 'desc' : 'asc'}`).join(',')
}

export function parseOrder(value: string | null): { name: string; desc: boolean }[] {
  if (!value) return []

  return value
    .split(',')
    .filter(Boolean)
    .map((part) => {
      const at = part.lastIndexOf(':')
      const name = decodeURIComponent(at === -1 ? part : part.slice(0, at))
      const desc = at !== -1 && part.slice(at + 1) === 'desc'

      return { name, desc }
    })
}
