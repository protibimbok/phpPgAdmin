import { api } from '@/api/request'
import { collection, collectionUrl, resolve } from '@/nodes/client'

/** A table as pgAdmin's properties.sql describes it (the columns the pages read), plus the size. */
export interface Table {
  oid: number
  name: string
  schema: string
  relowner: string
  relkind: string
  is_partitioned: boolean
  /** The PARTITION BY clause, "RANGE (logdate)", of a partitioned table (properties only). */
  partition_scheme?: string
  /** Whether the table is itself a partition of another. */
  relispartition: boolean
  relhassubclass: boolean
  /** The planner's estimate (pg_class.reltuples); -1 when the table was never analysed. */
  reltuples: number
  description: string | null
  triggercount: number
  spcname: string | null
  is_sys_table: boolean
  size: number
  /** The parents the table inherits from, as the INHERITS clause names them (properties only). */
  coll_inherits?: string[]
}

/** A view or materialized view, as their properties.sql describe them. */
export interface View {
  oid: number
  name: string
  schema: string
  owner: string
  comment: string | null
  definition: string
  size: number
}

export function tables(db: string, scid: number) {
  return collection<Table>(collectionUrl(db, 'schemas', scid, 'tables'))
}

export function views(db: string, scid: number) {
  return collection<View>(collectionUrl(db, 'schemas', scid, 'views'))
}

export function materializedViews(db: string, scid: number) {
  return collection<View>(collectionUrl(db, 'schemas', scid, 'mviews'))
}

/** The schema's OID, which the relation collections are addressed by. */
export function resolveSchema(db: string, schema: string): Promise<number> {
  return resolve(db, 'schema', { name: schema }).then((ids) => ids.scid)
}

/** The exact row count, counted now. */
export function countRows(db: string, scid: number, tid: number): Promise<number> {
  return api.get<{ count: number }>(`${collectionUrl(db, 'schemas', scid, 'tables')}/${tid}/count`).then((r) => r.count)
}

/** A column as pgAdmin's columns/properties.sql describes it (the fields the structure page reads). */
export interface Column {
  name: string
  attnum: number
  typname: string
  /** The type with its modifiers, "character varying(20)". */
  displaytypname: string
  cltype: string
  attnotnull: boolean
  defval: string | null
  description: string | null
  collspcname: string
  /** 'i' identity, 'g' generated, 'n' neither. */
  colconstype: 'i' | 'g' | 'n'
  attidentity: string
  genexpr: string | null
  is_fk: boolean
  is_sys_column: boolean
  inheritedfrom: string | null
  attstorage: string
  attcompression: string | null
  /** The primary key's column numbers, as "1 2", when the table has one. */
  indkey: string | null
}

export interface Index {
  oid: number
  name: string
  amname: string
  indisunique: boolean
  indisprimary: boolean
  indisclustered: boolean
  indisvalid: boolean
  indkey: string
  indnatts: number
  conname: string | null
  contype: string | null
  description: string | null
  indconstraint: string | null
  definition: string
  spcname: string
}

export interface Constraint {
  oid: number
  name: string
  comment: string | null
  definition: string
  condeferrable?: boolean
  condeferred?: boolean
  convalidated?: boolean
  consrc?: string
  /** A primary key's or unique constraint's index is the one the table is clustered on. */
  indisclustered?: boolean
}

export type ConstraintType = 'primary_key' | 'unique_constraint' | 'foreign_key' | 'check_constraint' | 'exclusion_constraint'

export const CONSTRAINT_COLLECTIONS: Record<ConstraintType, string> = {
  primary_key: 'primary-keys',
  unique_constraint: 'unique-constraints',
  foreign_key: 'foreign-keys',
  check_constraint: 'check-constraints',
  exclusion_constraint: 'exclusion-constraints',
}

export function columns(db: string, scid: number, tid: number) {
  return collection<Column>(collectionUrl(db, 'schemas', scid, 'tables', tid, 'columns'))
}

export function indexes(db: string, scid: number, tid: number) {
  return collection<Index>(collectionUrl(db, 'schemas', scid, 'tables', tid, 'indexes'))
}

export function constraints(db: string, scid: number, tid: number, type: ConstraintType) {
  return collection<Constraint>(collectionUrl(db, 'schemas', scid, 'tables', tid, CONSTRAINT_COLLECTIONS[type]))
}

/** The table's OIDs: resolve by schema and name → { scid, tid }. */
export function resolveTable(db: string, schema: string, name: string): Promise<{ scid: number; tid: number }> {
  return resolve(db, 'table', { schema, name }).then((ids) => ({ scid: ids.scid, tid: ids.tid }))
}

/** What the create and alter forms offer (GET …/tables/options). */
export interface TableOptions {
  types: { name: string; schema: string; kind: string }[]
  collations: string[]
  roles: string[]
  tablespaces: string[]
  schemas: string[]
  access_methods: string[]
  index_methods: string[]
  /** The index methods that can back an exclusion constraint. */
  exclusion_methods: string[]
  /** The tables one may inherit from; "inherits" is the name as the INHERITS clause takes it. */
  inherits: { oid: number; schema: string; name: string; inherits: string }[]
}

export function tableOptions(db: string, scid: number): Promise<TableOptions> {
  return api.get<TableOptions>(`${collectionUrl(db, 'schemas', scid, 'tables')}/options`)
}

/** What the exclusion constraint form offers: the method's operator classes and the operators per column type. */
export interface ExclusionOptions {
  oper_classes: string[]
  operators: Record<string, string[]>
}

export function exclusionOptions(db: string, scid: number, tid: number, am: string, types: string[]): Promise<ExclusionOptions> {
  const params = new URLSearchParams({ am })
  for (const type of types) params.append('types[]', type)

  return api.get<ExclusionOptions>(`${collectionUrl(db, 'schemas', scid, 'tables')}/${tid}/exclusion-options?${params}`)
}

/**
 * A column as pgAdmin's templates take it (columns/create.sql, update.sql): the type as the
 * type list names it with "[]" for an array, the length and precision apart, the default as
 * an SQL expression. An update carries attnum and only the fields that change.
 */
export interface ColumnData {
  attnum?: number
  name?: string
  cltype?: string
  attlen?: string | null
  attprecision?: string | null
  attnotnull?: boolean
  defval?: string
  collspcname?: string
  description?: string
  /** 'n' plain, 'i' identity, 'g' generated. */
  colconstype?: 'n' | 'i' | 'g'
  /** 'a' ALWAYS, 'd' BY DEFAULT, for an identity column. */
  attidentity?: 'a' | 'd' | ''
  genexpr?: string
  /** USING expression for a type change (ALTER COLUMN … TYPE … USING). */
  using?: string
}

/** A primary key or unique constraint as the templates take it. */
export interface KeyConstraintData {
  oid?: number
  name?: string
  columns?: { column: string }[]
  include?: string[]
  condeferrable?: boolean
  condeferred?: boolean
  fillfactor?: string
  spcname?: string
  indnullsnotdistinct?: boolean
  comment?: string
}

export interface ForeignKeyData {
  oid?: number
  name?: string
  columns?: { local_column: string; referenced: string }[]
  remote_schema?: string
  remote_table?: string
  /** 'a' NO ACTION, 'r' RESTRICT, 'c' CASCADE, 'n' SET NULL, 'd' SET DEFAULT. */
  confupdtype?: string
  confdeltype?: string
  /** True for MATCH FULL. */
  confmatchtype?: boolean
  condeferrable?: boolean
  condeferred?: boolean
  /** False adds NOT VALID. */
  convalidated?: boolean
  autoindex?: boolean
  coveringindex?: string
  comment?: string
}

export interface CheckConstraintData {
  oid?: number
  name?: string
  consrc?: string
  /** True adds NOT VALID (pgAdmin reads the flag inverted). */
  convalidated?: boolean
  connoinherit?: boolean
  comment?: string
}

export interface ExclusionConstraintData {
  oid?: number
  name?: string
  amname?: string
  columns?: { column: string; is_exp?: boolean; oper_class?: string; order?: boolean; nulls_order?: boolean; operator: string }[]
  include?: string[]
  indconstraint?: string
  fillfactor?: string
  spcname?: string
  condeferrable?: boolean
  condeferred?: boolean
  comment?: string
}

export type ConstraintData = KeyConstraintData | ForeignKeyData | CheckConstraintData | ExclusionConstraintData

/** An index as the templates take it (indexes/create.sql). */
export interface IndexData {
  name?: string
  amname?: string
  indisunique?: boolean
  isconcurrent?: boolean
  indnullsnotdistinct?: boolean
  columns?: IndexColumnData[]
  include?: string[]
  /** The WHERE of a partial index. */
  indconstraint?: string
  fillfactor?: string
  spcname?: string
  description?: string
  indisclustered?: boolean
}

export interface IndexColumnData {
  colname: string
  is_exp?: boolean
  /** True for DESC. */
  sort_order?: boolean
  /** True for NULLS FIRST. */
  nulls?: boolean
  collspcname?: string | null
  op_class?: string | null
}

/** The index's properties with its columns, as the dialog edits them. */
export interface IndexProperties extends Index {
  columns: IndexColumnData[]
  include: string[]
  fillfactor: number | null
  isconcurrent?: boolean
}

/** The lists an update of a table sends for its children. */
export interface Changes<T> {
  added?: T[]
  changed?: T[]
  deleted?: T[]
}

/** What CREATE TABLE takes, by pgAdmin's field names (tables/create.sql). */
export interface NewTable {
  name: string
  description?: string
  relowner?: string
  spcname?: string
  /** True for UNLOGGED. */
  relpersistence?: boolean
  coll_inherits?: string[]
  columns?: ColumnData[]
  primary_key?: KeyConstraintData[]
  unique_constraint?: KeyConstraintData[]
  foreign_key?: ForeignKeyData[]
  check_constraint?: CheckConstraintData[]
  exclude_constraint?: ExclusionConstraintData[]
  indexes?: IndexData[]
  /** "RANGE (col)", "LIST (col)" or "HASH (col)": the table is created PARTITION BY it. */
  partition_scheme?: string
  partitions?: PartitionData[]
}

/** What ALTER TABLE may change; only the fields given are changed. */
export interface TableChanges {
  name?: string
  schema?: string
  description?: string
  relowner?: string
  spcname?: string
  relpersistence?: boolean
  fillfactor?: string
  coll_inherits?: string[]
  columns?: Changes<ColumnData>
  primary_key?: Changes<KeyConstraintData>
  unique_constraint?: Changes<KeyConstraintData>
  foreign_key?: Changes<ForeignKeyData>
  check_constraint?: Changes<CheckConstraintData>
  exclusion_constraint?: Changes<ExclusionConstraintData>
  indexes?: Changes<IndexData | { name: string }>
  /** Partitions to create or attach, and to detach (by oid). */
  partitions?: { added?: PartitionData[]; deleted?: { oid: number; mode?: string }[] }
}

export function createTable(db: string, scid: number, data: NewTable) {
  return tables(db, scid).create(data)
}

export function updateTable(db: string, scid: number, tid: number, data: TableChanges) {
  return tables(db, scid).update(tid, data)
}

export function dropTable(db: string, scid: number, tid: number, cascade = false): Promise<void> {
  return tables(db, scid).remove(tid, cascade).then(() => undefined)
}

export function tableModifiedSql(db: string, scid: number, data: NewTable | TableChanges, tid?: number): Promise<string> {
  return tables(db, scid).modifiedSql(data, tid)
}

/** TRUNCATE the table; the statement run comes back. */
export function truncateTable(db: string, scid: number, tid: number, options: { cascade?: boolean; identity?: boolean } = {}): Promise<string> {
  return api.post<{ sql: string }>(`${collectionUrl(db, 'schemas', scid, 'tables')}/${tid}/truncate`, options).then((r) => r.sql)
}

export interface CopyTableOptions {
  schema?: string
  name: string
  /** 'structure', 'data' (structure and data) or 'dataonly'. */
  what: 'structure' | 'data' | 'dataonly'
  drop_if_exists?: boolean
  add_constraints?: boolean
}

/** Copy the table; with preview, only the statements come back. */
export function copyTable(db: string, scid: number, tid: number, options: CopyTableOptions, preview = false): Promise<string> {
  return api.post<{ sql: string }>(`${collectionUrl(db, 'schemas', scid, 'tables')}/${tid}/copy${preview ? '?preview=1' : ''}`, options).then((r) => r.sql)
}

/** The structure page's constraint rows with the properties the editors need. */
export interface ForeignKeyRow extends Constraint {
  confupdtype: string
  confdeltype: string
  confmatchtype: boolean
  refnsp: string
  reftab: string
  columns: { local_column: string; referenced: string; references: number }[]
}

/** A trigger as pgAdmin's triggers/properties.sql describes it, with the firing definition decoded. */
export interface Trigger {
  oid: number
  name: string
  /** 'O' enabled, 'D' disabled, 'R' replica, 'A' always. */
  is_enable_trigger: 'O' | 'D' | 'R' | 'A'
  description: string | null
  /** 'BEFORE', 'AFTER' or 'INSTEAD OF'. */
  fires: string
  is_row_trigger: boolean
  is_constraint_trigger: boolean
  tgdeferrable: boolean
  tginitdeferred: boolean
  evnt_insert: boolean
  evnt_update: boolean
  evnt_delete: boolean
  evnt_truncate: boolean
  /** The UPDATE OF columns. */
  columns: string[]
  /** "schema.function". */
  tfunction: string
  /** The arguments as literals, "'a', 'b'", or null. */
  tgargs: string | null
  whenclause: string | null
  tgoldtable: string | null
  tgnewtable: string | null
  is_sys_trigger: boolean
}

/** What CREATE TRIGGER and its ALTERs take (triggers/create.sql, update.sql); an update may send the whole form. */
export interface TriggerData {
  name?: string
  fires?: string
  evnt_insert?: boolean
  evnt_update?: boolean
  evnt_delete?: boolean
  evnt_truncate?: boolean
  columns?: string[]
  is_row_trigger?: boolean
  is_constraint_trigger?: boolean
  tgdeferrable?: boolean
  tginitdeferred?: boolean
  tfunction?: string
  tgargs?: string
  whenclause?: string
  tgoldtable?: string
  tgnewtable?: string
  description?: string
  is_enable_trigger?: 'O' | 'D' | 'R' | 'A'
}

/** A rewrite rule as rules/properties.sql describes it, with the definition parsed. */
export interface Rule {
  oid: number
  name: string
  /** 'SELECT', 'INSERT', 'UPDATE' or 'DELETE'. */
  event: string
  do_instead: boolean
  condition: string
  statements: string
  comment: string | null
  enabled: boolean
  is_enable_rule: 'O' | 'D' | 'R' | 'A'
  system_rule: boolean
  definition: string
}

export interface RuleData {
  name?: string
  event?: string
  do_instead?: boolean
  condition?: string
  statements?: string
  comment?: string
  is_enable_rule?: 'O' | 'D' | 'R' | 'A'
}

/** A row security policy as row_security_policies/properties.sql describes it. */
export interface Policy {
  oid: number
  name: string
  /** 'ALL', 'SELECT', 'INSERT', 'UPDATE' or 'DELETE'. */
  event: string
  /** 'PERMISSIVE' or 'RESTRICTIVE'. */
  type: string
  policyowner: string[]
  using: string | null
  withcheck: string | null
  description: string | null
}

export interface PolicyData {
  name?: string
  event?: string
  type?: string
  policyowner?: string[]
  using?: string
  withcheck?: string
  description?: string
}

/** The relation kinds that carry triggers and rules, by the collection their nodes hang from. */
export type TriggerParent = 'table' | 'view'

const PARENT_COLLECTIONS: Record<TriggerParent, string> = { table: 'tables', view: 'views' }

export function triggers(db: string, scid: number, parent: TriggerParent, relOid: number) {
  return collection<Trigger>(collectionUrl(db, 'schemas', scid, PARENT_COLLECTIONS[parent], relOid, 'triggers'))
}

export function rules(db: string, scid: number, parent: TriggerParent, relOid: number) {
  return collection<Rule>(collectionUrl(db, 'schemas', scid, PARENT_COLLECTIONS[parent], relOid, 'rules'))
}

/** Row security policies; tables only. */
export function policies(db: string, scid: number, tid: number) {
  return collection<Policy>(collectionUrl(db, 'schemas', scid, 'tables', tid, 'policies'))
}

/** What the trigger and policy editors offer: the trigger functions and the roles. */
export interface TriggerOptions {
  functions: string[]
  roles: string[]
}

export function triggerOptions(db: string, scid: number, parent: TriggerParent, relOid: number): Promise<TriggerOptions> {
  return api.get<TriggerOptions>(`${collectionUrl(db, 'schemas', scid, PARENT_COLLECTIONS[parent], relOid, 'triggers')}/options`)
}

/** The relation's OIDs by kind: a table's or a view's. */
export function resolveRelation(db: string, schema: string, name: string, parent: TriggerParent): Promise<{ scid: number; oid: number }> {
  return resolve(db, parent, { schema, name }).then((ids) => ({ scid: ids.scid, oid: parent === 'table' ? ids.tid : ids.vid }))
}

/** A partition as pgAdmin's partitions/properties.sql describes it. */
export interface Partition {
  oid: number
  name: string
  schema: string
  /** "FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')", "FOR VALUES IN (…)", "FOR VALUES WITH (MODULUS …)" or "DEFAULT". */
  partition_value: string
  reltuples: number
  description: string | null
  relowner: string
  spcname: string
  is_partitioned: boolean
  partition_scheme: string
  relpersistence: boolean
}

/**
 * What a new partition takes (pgAdmin's partition grid): a name and the bounds for the
 * parent's strategy, or an existing table to attach with its bounds.
 */
export interface PartitionData {
  name?: string
  /** The table to attach, "schema.table", with is_attach. */
  partition_name?: string
  is_attach?: boolean
  is_default?: boolean
  values_from?: string
  values_to?: string
  values_in?: string
  values_modulus?: string
  values_remainder?: string
  description?: string
}

export function partitions(db: string, scid: number, tid: number) {
  return collection<Partition>(collectionUrl(db, 'schemas', scid, 'tables', tid, 'partitions'))
}

/** The tables whose columns match the parent's, which may be attached as partitions. */
export function attachCandidates(db: string, scid: number, tid: number): Promise<{ oid: number; table_name: string }[]> {
  return api.get<{ tables: { oid: number; table_name: string }[] }>(`${collectionUrl(db, 'schemas', scid, 'tables', tid, 'partitions')}/attach-candidates`).then((r) => r.tables)
}

/** ALTER TABLE … DETACH PARTITION; the statement run comes back. */
export function detachPartition(db: string, scid: number, tid: number, ptid: number, mode: '' | 'concurrently' | 'finalize' = ''): Promise<string> {
  return api.post<{ sql: string }>(`${collectionUrl(db, 'schemas', scid, 'tables', tid, 'partitions')}/${ptid}/detach`, { mode }).then((r) => r.sql)
}

/** The partitioning strategy of a scheme, "RANGE (col)" → "range". */
export function partitionType(scheme: string | undefined): 'range' | 'list' | 'hash' | '' {
  const word = (scheme ?? '').trim().split(/[\s(]/)[0].toLowerCase()

  return word === 'range' || word === 'list' || word === 'hash' ? word : ''
}

/** An extended statistics object as pgAdmin's statistics/properties.sql describes it. */
export interface ExtendedStatistics {
  oid: number
  name: string
  schema: string
  table: string
  table_schema: string
  owner: string
  columns: string[]
  /** The expressions, each parenthesised, comma-separated; null when there are none. */
  expression_list: string | null
  /** 'ndistinct', 'dependencies' and/or 'mcv'; none means every kind. */
  stat_types: string[]
  /** -1 for the default. */
  stattarget: number
  ndistinct_values: string | null
  dependencies_values: string | null
  has_mcv_values: boolean
  has_ext_data_access: boolean
  comment: string | null
  is_sys_obj: boolean
}

/** What CREATE STATISTICS and ALTER STATISTICS take (statistics/create.sql, update.sql). */
export interface StatisticsData {
  /** Optional on PostgreSQL 16+, where the server names the object. */
  name?: string
  owner?: string
  table?: string
  table_schema?: string
  columns?: string[]
  expression_list?: string
  stat_types?: string[]
  /** A number, or '' / 'DEFAULT' for the default. */
  stattarget?: string
  comment?: string
}

/** The schema's statistics objects (pgAdmin's node lives under the schema). */
export function extendedStatistics(db: string, scid: number) {
  return collection<ExtendedStatistics>(collectionUrl(db, 'schemas', scid, 'statistics'))
}

/** The statistics objects defined on a table, whichever schema holds them. */
export function tableExtendedStatistics(db: string, scid: number, tid: number): Promise<ExtendedStatistics[]> {
  return api.get<{ rows: ExtendedStatistics[] }>(`${collectionUrl(db, 'schemas', scid, 'tables', tid)}/extended-statistics`).then((r) => r.rows)
}
