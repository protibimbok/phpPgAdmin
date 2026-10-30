import type { Column, ColumnData, IndexData, KeyConstraintData, TableOptions } from '../api'

/**
 * A column as phpMyAdmin's column definition form holds it (columns_definitions/
 * column_attributes.twig): one field per control, turned into pgAdmin's column data on save.
 */
export interface ColumnDefinition {
  /** The attribute number of an existing column; undefined for a new one. */
  attnum?: number
  name: string
  /** The type as the type list names it, without array brackets: "character varying". */
  type: string
  /** The length, or "length,precision" for numeric: "40", "10,2". */
  length: string
  defaultType: DefaultType
  defaultValue: string
  collation: string
  /** "[]" for an array column; phpMyAdmin's Attributes column. */
  attribute: '' | '[]'
  nullable: boolean
  index: '' | 'primary' | 'unique' | 'index'
  /** GENERATED … AS IDENTITY; phpMyAdmin's A_I. */
  identity: boolean
  /** 'd' BY DEFAULT or 'a' ALWAYS, for an identity column. */
  identityKind: 'd' | 'a'
  /** The identity sequence's options; empty for the default. */
  sequence: SequenceOptions
  comment: string
  /** GENERATED ALWAYS AS (expression) STORED, or VIRTUAL (PostgreSQL 18); phpMyAdmin's Virtuality. */
  virtuality: '' | 'STORED' | 'VIRTUAL'
  expression: string
  /** SET STORAGE: '' for the type's own, or 'p', 'm', 'e', 'x'. */
  storage: '' | 'p' | 'm' | 'e' | 'x'
  /** The type's own storage of an existing column, which '' goes back to. */
  defaultStorage?: string
  /** COMPRESSION: '' for the server's default_toast_compression, 'pglz' or 'lz4'. */
  compression: '' | 'pglz' | 'lz4'
  /** SET STATISTICS: '' for the default target. */
  statistics: string
  /** ALTER COLUMN … TYPE's USING expression, for a type change no automatic cast covers. */
  using?: string
  /** What the column was when loaded, to send only what changed. */
  original?: ColumnDefinition
  /** A column of the composite type a typed table (OF type) is made of: its name and type are the type's. */
  ofType?: boolean
}

export interface SequenceOptions {
  start: string
  increment: string
  min: string
  max: string
  cache: string
  cycle: boolean
}

/** The sequence fields by pgAdmin's names. */
export const SEQUENCE_FIELDS: { key: Exclude<keyof SequenceOptions, 'cycle'>; field: 'seqstart' | 'seqincrement' | 'seqmin' | 'seqmax' | 'seqcache' }[] = [
  { key: 'start', field: 'seqstart' },
  { key: 'increment', field: 'seqincrement' },
  { key: 'min', field: 'seqmin' },
  { key: 'max', field: 'seqmax' },
  { key: 'cache', field: 'seqcache' },
]

export const STORAGE_KINDS: { value: ColumnDefinition['storage']; label: string }[] = [
  { value: 'p', label: 'PLAIN' },
  { value: 'm', label: 'MAIN' },
  { value: 'e', label: 'EXTERNAL' },
  { value: 'x', label: 'EXTENDED' },
]

function emptySequence(): SequenceOptions {
  return { start: '', increment: '', min: '', max: '', cache: '', cycle: false }
}

export type DefaultType = 'NONE' | 'USER_DEFINED' | 'NULL' | 'CURRENT_TIMESTAMP' | 'UUID'

export const DEFAULT_TYPES: DefaultType[] = ['NONE', 'USER_DEFINED', 'NULL', 'CURRENT_TIMESTAMP', 'UUID']

/** The type groups the select offers, as phpMyAdmin groups MySQL's; the rest of the server's types follow under "Other". */
export const TYPE_GROUPS: { key: string; types: string[] }[] = [
  { key: 'numeric', types: ['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'smallserial', 'serial', 'bigserial', 'money'] },
  { key: 'character', types: ['character varying', 'character', 'text'] },
  { key: 'datetime', types: ['timestamp without time zone', 'timestamp with time zone', 'date', 'time without time zone', 'time with time zone', 'interval'] },
  { key: 'boolean', types: ['boolean'] },
  { key: 'binary', types: ['bytea'] },
  { key: 'json', types: ['json', 'jsonb'] },
  { key: 'uuid', types: ['uuid'] },
  { key: 'network', types: ['inet', 'cidr', 'macaddr', 'macaddr8'] },
  { key: 'geometric', types: ['point', 'line', 'lseg', 'box', 'path', 'polygon', 'circle'] },
]

const LENGTH_TYPES = new Set(['bit', 'bit varying', 'character', 'character varying', 'time without time zone', 'time with time zone', 'timestamp without time zone', 'timestamp with time zone', 'interval', 'vector'])

const NUMERIC_TYPES = new Set(['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'smallserial', 'serial', 'bigserial', 'money', 'boolean'])

/** The types that take a length (and numeric a precision too). */
export function takesLength(type: string): boolean {
  return type === 'numeric' || LENGTH_TYPES.has(type)
}

/** The server's types grouped for the select: the known groups, then every other named type. */
export function typeGroups(options: TableOptions | undefined, current?: string): { key: string; types: string[] }[] {
  const known = new Set(TYPE_GROUPS.flatMap((g) => g.types))
  const others = (options?.types ?? []).map((t) => t.name).filter((name) => !name.endsWith('[]') && !known.has(name))
  if (current && !known.has(current) && !others.includes(current)) others.push(current)

  return [...TYPE_GROUPS, { key: 'other', types: others.sort() }]
}

export function emptyDefinition(): ColumnDefinition {
  return { name: '', type: 'integer', length: '', defaultType: 'NONE', defaultValue: '', collation: '', attribute: '', nullable: true, index: '', identity: false, identityKind: 'd', sequence: emptySequence(), comment: '', virtuality: '', expression: '', storage: '', compression: '', statistics: '' }
}

/** The type name without length and precision: "character varying(20)" → "character varying". */
export function parseTypeName(fullType: string): string {
  let name = fullType.endsWith('[]') ? fullType.slice(0, -2) : fullType
  const open = name.indexOf('(')
  if (open !== -1 && name.endsWith(')')) name = name.slice(0, open)
  else if (open !== -1 && name.startsWith('time')) name = name.replace(/\(\d+\)/, '')
  else if (name.startsWith('interval')) name = 'interval'

  return name
}

/** "(10,2)" → "10,2"; "(3)" → "3". */
function parseLength(fullType: string): string {
  const match = /\((\d+)(?:,\s*(\d+))?\)/.exec(fullType)
  if (!match) return ''

  return match[2] !== undefined ? `${match[1]},${match[2]}` : match[1]
}

/** How the form shows an existing default: as phpMyAdmin's DefaultType and a plain value. */
function parseDefault(column: Column): { defaultType: DefaultType; defaultValue: string } {
  const defval = column.defval
  if (defval === null || defval === '') return { defaultType: column.attnotnull ? 'NONE' : 'NULL', defaultValue: '' }
  if (defval === 'NULL') return { defaultType: 'NULL', defaultValue: '' }
  if (/^(CURRENT_TIMESTAMP|now\(\))$/i.test(defval)) return { defaultType: 'CURRENT_TIMESTAMP', defaultValue: '' }
  if (/^gen_random_uuid\(\)$/i.test(defval)) return { defaultType: 'UUID', defaultValue: '' }
  const literal = /^'((?:[^']|'')*)'(?:::[\w ]+(?:\(\d+(?:,\d+)?\))?(?:\[\])?)?$/.exec(defval)
  if (literal) return { defaultType: 'USER_DEFINED', defaultValue: literal[1].replace(/''/g, "'") }

  return { defaultType: 'USER_DEFINED', defaultValue: defval }
}

/** An attribute of the composite type a typed table is made OF, as a row of the form. */
export function fromTypeColumn(column: { name: string; cltype: string }): ColumnDefinition {
  return { ...emptyDefinition(), name: column.name, type: parseTypeName(column.cltype), length: parseLength(column.cltype), attribute: column.cltype.endsWith('[]') ? '[]' : '', ofType: true }
}

/** Whether a typed table's column has anything of its own to say (WITH OPTIONS): NOT NULL, a default, identity or a comment. */
export function hasTypeOptions(definition: ColumnDefinition): boolean {
  return !definition.nullable || definition.defaultType !== 'NONE' || definition.comment !== '' || definition.identity
}

/** An existing column as the form holds it. */
export function fromColumn(column: Column, isPrimary: boolean): ColumnDefinition {
  const definition: ColumnDefinition = {
    attnum: column.attnum,
    name: column.name,
    type: parseTypeName(column.cltype),
    length: parseLength(column.cltype),
    // A generated column's expression is in pg_attrdef too; it is not a default.
    ...(column.colconstype === 'g' ? { defaultType: 'NONE' as const, defaultValue: '' } : parseDefault(column)),
    collation: column.collspcname ?? '',
    attribute: column.cltype.endsWith('[]') ? '[]' : '',
    nullable: !column.attnotnull,
    index: isPrimary ? 'primary' : '',
    identity: column.colconstype === 'i',
    identityKind: column.attidentity === 'a' ? 'a' : 'd',
    sequence:
      column.colconstype === 'i'
        ? { start: text(column.seqstart), increment: text(column.seqincrement), min: text(column.seqmin), max: text(column.seqmax), cache: text(column.seqcache), cycle: Boolean(column.seqcycle) }
        : emptySequence(),
    comment: column.description ?? '',
    virtuality: column.colconstype === 'g' ? (column.genvirtual ? 'VIRTUAL' : 'STORED') : '',
    expression: column.colconstype === 'g' ? (column.genexpr ?? '') : '',
    storage: column.attstorage === column.defaultstorage ? '' : (column.attstorage as ColumnDefinition['storage']),
    defaultStorage: column.defaultstorage,
    compression: (column.attcompression ?? '') as ColumnDefinition['compression'],
    statistics: column.attstattarget !== null && column.attstattarget >= 0 ? String(column.attstattarget) : '',
  }
  definition.original = { ...definition }

  return definition
}

function text(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

/** The identity sequence options the form has, as pgAdmin's fields. */
function sequenceData(definition: ColumnDefinition): Partial<ColumnData> {
  const data: Partial<ColumnData> = {}
  for (const { key, field } of SEQUENCE_FIELDS) {
    if (definition.sequence[key].trim() !== '') data[field] = definition.sequence[key].trim()
  }
  if (definition.sequence.cycle) data.seqcycle = true

  return data
}

/** Whether a user-defined default is written as an expression rather than a string literal. */
function isExpression(value: string, type: string): boolean {
  if (NUMERIC_TYPES.has(type)) return true
  if (/^[A-Za-z_][\w.]*\(.*\)$/s.test(value)) return true
  if (/^(true|false)$/i.test(value) && type === 'boolean') return true

  return false
}

/** The default as an SQL expression, quoted unless it is one already. */
export function defaultExpression(definition: ColumnDefinition): string {
  switch (definition.defaultType) {
    case 'NONE':
      return ''
    case 'NULL':
      return 'NULL'
    case 'CURRENT_TIMESTAMP':
      return 'CURRENT_TIMESTAMP'
    case 'UUID':
      return 'gen_random_uuid()'
    default:
      return isExpression(definition.defaultValue, definition.type) ? definition.defaultValue : `'${definition.defaultValue.replace(/'/g, "''")}'`
  }
}

/** The length and precision apart, as the templates take them. */
function lengthParts(definition: ColumnDefinition): { attlen: string | null; attprecision: string | null } {
  if (!takesLength(definition.type) || definition.length.trim() === '') return { attlen: null, attprecision: null }
  const [len, prec] = definition.length.split(',').map((p) => p.trim())

  return { attlen: len || null, attprecision: definition.type === 'numeric' && prec ? prec : null }
}

/** Whether an existing column's type, length or array brackets were changed in the form. */
export function typeChanged(definition: ColumnDefinition): boolean {
  const was = definition.original

  return !!was && (definition.type !== was.type || definition.length !== was.length || definition.attribute !== was.attribute)
}

/** A new column as pgAdmin's templates take it. */
export function toColumnData(definition: ColumnDefinition): ColumnData {
  const data: ColumnData = {
    name: definition.name,
    cltype: definition.type + definition.attribute,
    ...lengthParts(definition),
    attnotnull: !definition.nullable,
    collspcname: definition.collation,
    description: definition.comment,
  }
  const defval = defaultExpression(definition)
  if (definition.virtuality !== '' && definition.expression.trim() !== '') {
    data.colconstype = 'g'
    data.genexpr = definition.expression.trim()
    data.genvirtual = definition.virtuality === 'VIRTUAL'
  } else {
    if (defval !== '') data.defval = defval
    if (definition.identity) Object.assign(data, { colconstype: 'i', attidentity: definition.identityKind }, sequenceData(definition))
  }
  if (definition.storage !== '') data.attstorage = definition.storage
  if (definition.compression !== '') data.attcompression = definition.compression
  if (definition.statistics.trim() !== '') data.attstattarget = Number(definition.statistics)

  return data
}

/** The fields of an existing column that changed, as pgAdmin's update template compares them. */
export function toColumnChanges(definition: ColumnDefinition): ColumnData | null {
  const was = definition.original
  if (!was) return toColumnData(definition)
  const data: ColumnData = { attnum: definition.attnum }
  let changed = false
  if (definition.name !== was.name) {
    data.name = definition.name
    changed = true
  }
  if (typeChanged(definition)) {
    data.cltype = definition.type + definition.attribute
    Object.assign(data, lengthParts(definition))
    if (definition.using?.trim()) data.using = definition.using.trim()
    changed = true
  }
  if (definition.defaultType !== was.defaultType || definition.defaultValue !== was.defaultValue) {
    data.defval = defaultExpression(definition)
    changed = true
  }
  if (definition.nullable !== was.nullable) {
    data.attnotnull = !definition.nullable
    changed = true
  }
  if (definition.collation !== was.collation) {
    data.collspcname = definition.collation
    changed = true
  }
  if (definition.comment !== was.comment) {
    data.description = definition.comment
    changed = true
  }
  if (definition.identity !== was.identity || (definition.identity && definition.identityKind !== was.identityKind)) {
    data.colconstype = definition.identity ? 'i' : 'n'
    if (definition.identity) data.attidentity = definition.identityKind
    changed = true
  }
  if (definition.identity) {
    // The template compares each option with the sequence as it stands, so all of them can go.
    const sequence = definition.sequence
    if (JSON.stringify(sequence) !== JSON.stringify(was.sequence)) {
      Object.assign(data, sequenceData(definition))
      if (!sequence.cycle && was.sequence.cycle) data.seqcycle = false
      changed = true
    }
  }
  if (definition.virtuality !== was.virtuality || (definition.virtuality !== '' && definition.expression !== was.expression)) {
    data.colconstype = definition.virtuality !== '' ? 'g' : (data.colconstype ?? 'n')
    if (definition.virtuality !== '') {
      data.genexpr = definition.expression.trim()
      data.genvirtual = definition.virtuality === 'VIRTUAL'
    }
    changed = true
  }
  if (definition.storage !== was.storage) {
    data.attstorage = definition.storage || definition.defaultStorage
    changed = true
  }
  if (definition.compression !== was.compression) {
    data.attcompression = definition.compression || 'default'
    changed = true
  }
  if (definition.statistics !== was.statistics) {
    data.attstattarget = definition.statistics.trim() === '' ? -1 : Number(definition.statistics)
    changed = true
  }

  return changed ? data : null
}

/** The keys and indexes the Index column of the form asks for. */
export function indexesOf(definitions: ColumnDefinition[]): { primary: KeyConstraintData | null; unique: KeyConstraintData[]; indexes: IndexData[] } {
  const primaryColumns = definitions.filter((d) => d.index === 'primary' && d.name !== '').map((d) => ({ column: d.name }))

  return {
    primary: primaryColumns.length > 0 ? { columns: primaryColumns } : null,
    unique: definitions.filter((d) => d.index === 'unique' && d.name !== '').map((d) => ({ columns: [{ column: d.name }] })),
    indexes: definitions.filter((d) => d.index === 'index' && d.name !== '').map((d) => ({ columns: [{ colname: d.name }] })),
  }
}
