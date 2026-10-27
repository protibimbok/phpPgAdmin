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
