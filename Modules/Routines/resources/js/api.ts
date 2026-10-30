import { api } from '@/api/request'
import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'

/** The routine kinds, by node type. */
export type RoutineKind = 'function' | 'procedure' | 'trigger_function'

export const KINDS: RoutineKind[] = ['function', 'procedure', 'trigger_function']

export const COLLECTIONS: Record<RoutineKind, string> = { function: 'functions', procedure: 'procedures', trigger_function: 'trigger-functions' }

/** The word phpMyAdmin's Routines page shows in its Type column. */
export const KIND_LABELS: Record<RoutineKind, string> = { function: 'FUNCTION', procedure: 'PROCEDURE', trigger_function: 'TRIGGER FUNCTION' }

/** An argument as pgAdmin's dialog lists it. */
export interface Argument {
  argid?: number
  /** 'IN', 'OUT', 'INOUT', 'VARIADIC' or ''. */
  argmode: string
  argname: string
  argtype: string
  argdefval: string
}

export interface Variable {
  name: string
  value: string | number | boolean
}

/** A routine as pgAdmin's properties.sql describes it, with what the controller adds. */
export interface Routine {
  oid: number
  name: string
  /** "name(integer, text)". */
  signature: string
  /** The schema's OID (pronamespace). */
  pronamespace: number
  proargtypenames: string
  /** The arguments as text, "IN a integer, OUT b text". */
  proargs: string
  arguments: Argument[]
  prorettypename: string
  proretset: boolean
  lanname: string
  prosrc: string
  probin: string | null
  prosrc_c: string | null
  /** 'i', 's', 'v' or null (a procedure). */
  provolatile: string | null
  proisstrict: boolean
  prosecdef: boolean
  proleakproof: boolean
  proiswindow: boolean
  /** 'u', 's', 'r' or null. */
  proparallel: string | null
  procost: number | null
  prorows: number | null
  prosupportfunc: string | null
  funcowner: string
  description: string | null
  variables: Variable[]
  acl: unknown[]
  is_pure_sql: boolean
  sysfunc: boolean
}

export function routines(db: string, scid: number, kind: RoutineKind) {
  return collection<Routine>(collectionUrl(db, 'schemas', scid, COLLECTIONS[kind]))
}

/** The schema's OID, which the routine collections are addressed by. */
export function resolveSchema(db: string, schema: string): Promise<number> {
  return resolve(db, 'schema', { name: schema }).then((ids) => ids.scid)
}

/** Every routine of the schema, of every kind, each tagged with its kind. */
export function listRoutines(db: string, scid: number): Promise<(Routine & { kind: RoutineKind })[]> {
  return Promise.all(KINDS.map((kind) => routines(db, scid, kind).list().then((rows) => rows.map((row) => ({ ...row, kind }))))).then((lists) => lists.flat().sort((a, b) => a.signature.localeCompare(b.signature)))
}

/** What the editor offers (GET …/functions/options). */
export interface RoutineOptions {
  types: { name: string; schema: string }[]
  languages: string[]
  variables: { name: string; vartype: string; min_val: string | null; max_val: string | null; enumvals: string[] | null }[]
  support_functions: string[]
  roles: string[]
  schemas: string[]
}

export function routineOptions(db: string, scid: number): Promise<RoutineOptions> {
  return api.get<RoutineOptions>(`${collectionUrl(db, 'schemas', scid, 'functions')}/options`)
}

/** The SELECT or CALL that runs the routine, with a placeholder per argument. */
export function callSql(db: string, scid: number, kind: RoutineKind, fnid: number): Promise<string> {
  return api.get<{ sql: string }>(`${collectionUrl(db, 'schemas', scid, COLLECTIONS[kind])}/${fnid}/call-sql`).then((r) => r.sql)
}

/**
 * What CREATE and ALTER take, by pgAdmin's field names (create.sql, update.sql). An update
 * may send the whole form: the server keeps only what differs from the routine as it stands.
 */
export interface RoutineData {
  name?: string
  pronamespace?: string
  arguments?: Argument[]
  prorettypename?: string
  proretset?: boolean
  lanname?: string
  prosrc?: string
  probin?: string
  prosrc_c?: string
  provolatile?: string
  proisstrict?: boolean
  prosecdef?: boolean
  proleakproof?: boolean
  proparallel?: string
  procost?: string
  prorows?: string
  prosupportfunc?: string
  /** WINDOW, set when the function is created. */
  proiswindow?: boolean
  funcowner?: string
  description?: string
  variables?: Variable[]
}

export function createRoutine(db: string, scid: number, kind: RoutineKind, data: RoutineData): Promise<TreeNode> {
  return routines(db, scid, kind).create(data)
}

export function updateRoutine(db: string, scid: number, kind: RoutineKind, fnid: number, data: RoutineData): Promise<TreeNode> {
  return routines(db, scid, kind).update(fnid, data)
}

export function dropRoutine(db: string, scid: number, kind: RoutineKind, fnid: number, cascade = false): Promise<void> {
  return routines(db, scid, kind).remove(fnid, cascade).then(() => undefined)
}

export function routineModifiedSql(db: string, scid: number, kind: RoutineKind, data: RoutineData, fnid?: number): Promise<string> {
  return routines(db, scid, kind).modifiedSql(data, fnid)
}

/** An aggregate as pgAdmin's aggregates/properties.sql describes it: its functions and settings. */
export interface Aggregate {
  oid: number
  name: string
  /** "name(numeric)". */
  signature: string
  schema: string
  owner: string
  input_types: string
  /** 'normal', 'ordered-set' or 'hypothetical-set'. */
  kind: string
  state_func: string | null
  state_type: string
  state_data_size: number | null
  final_func: string | null
  final_type: string
  final_extra_param: boolean
  final_func_modify: string | null
  combine_func: string | null
  serialization_func: string | null
  deserialization_func: string | null
  initial_val: string | null
  moving_state_func: string | null
  moving_inverse_func: string | null
  moving_state_type: string | null
  moving_state_data_size: number | null
  moving_final_func: string | null
  moving_final_extra_param: boolean
  moving_final_func_modify: string | null
  moving_initial_val: string | null
  sort_oper: string | null
  /** 'SAFE', 'RESTRICTED' or null (UNSAFE). */
  parallel: string | null
  description: string | null
  is_sys_obj: boolean
}

/** What CREATE AGGREGATE and its ALTERs take; a blank field is an absent clause. */
export interface AggregateData {
  name: string
  schema?: string
  owner: string
  description: string
  kind: string
  input_types: string
  state_func: string
  state_type: string
  state_data_size: string
  final_func: string
  final_extra_param: boolean
  final_func_modify: string
  combine_func: string
  serialization_func: string
  deserialization_func: string
  initial_val: string
  moving_state_func: string
  moving_inverse_func: string
  moving_state_type: string
  moving_state_data_size: string
  moving_final_func: string
  moving_final_extra_param: boolean
  moving_final_func_modify: string
  moving_initial_val: string
  sort_oper: string
  parallel: string
}

/** What CREATE OPERATOR and its ALTERs take; a blank operand type is NONE. */
export interface OperatorData {
  name: string
  schema?: string
  owner: string
  description: string
  operproc: string
  lefttype: string
  righttype: string
  commutator: string
  negator: string
  restrproc: string
  joinproc: string
  support_hash: boolean
  support_merge: boolean
}

/** An operator as pgAdmin's operators/properties.sql describes it. */
export interface Operator {
  oid: number
  name: string
  /** "^^ (integer, integer)". */
  signature: string
  schema: string
  owner: string
  /** 'infix', 'prefix' or 'postfix'. */
  oprkind: string
  lefttype: string | null
  righttype: string | null
  resulttype: string
  operproc: string
  commutator: string | null
  negator: string | null
  restrproc: string | null
  joinproc: string | null
  support_hash: boolean
  support_merge: boolean
  description: string | null
  is_sys_obj: boolean
}

export function aggregates(db: string, scid: number) {
  return collection<Aggregate>(collectionUrl(db, 'schemas', scid, 'aggregates'))
}

export function operators(db: string, scid: number) {
  return collection<Operator>(collectionUrl(db, 'schemas', scid, 'operators'))
}

/** A row of the Routines page: a routine, an aggregate or an operator, tagged with its kind. */
export type RoutineRow = (Routine & { kind: RoutineKind }) | (Aggregate & { kind: 'aggregate' }) | (Operator & { kind: 'operator' })

export const ROW_LABELS: Record<RoutineRow['kind'], string> = { ...KIND_LABELS, aggregate: 'AGGREGATE', operator: 'OPERATOR' }

/** Every routine, aggregate and operator of the schema, by signature. */
export function listRoutineRows(db: string, scid: number): Promise<RoutineRow[]> {
  return Promise.all([
    listRoutines(db, scid),
    aggregates(db, scid).list().then((rows) => rows.map((row): RoutineRow => ({ ...row, kind: 'aggregate' }))),
    operators(db, scid).list().then((rows) => rows.map((row): RoutineRow => ({ ...row, kind: 'operator' }))),
  ]).then(([routines, aggs, ops]) => [...routines, ...aggs, ...ops].sort((a, b) => a.signature.localeCompare(b.signature)))
}

/** The CREATE statement of a row, whatever its kind. */
export function routineRowSql(db: string, scid: number, row: RoutineRow): Promise<string> {
  if (row.kind === 'aggregate') return aggregates(db, scid).sql(row.oid)
  if (row.kind === 'operator') return operators(db, scid).sql(row.oid)

  return routines(db, scid, row.kind).sql(row.oid)
}

export function dropRoutineRow(db: string, scid: number, row: RoutineRow, cascade = false): Promise<void> {
  if (row.kind === 'aggregate') return aggregates(db, scid).remove(row.oid, cascade).then(() => undefined)
  if (row.kind === 'operator') return operators(db, scid).remove(row.oid, cascade).then(() => undefined)

  return dropRoutine(db, scid, row.kind, row.oid, cascade)
}
