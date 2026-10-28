import { api } from '@/api/request'
import { collection, collectionUrl, resolve } from '@/nodes/client'

/** A membership in either direction: the role granted, with the options it was granted with. */
export interface Membership {
  role: string
  admin: boolean
  /** Always true before PostgreSQL 16, where the member's INHERIT attribute decides. */
  inherit: boolean
  set: boolean
}

/** A configuration parameter set for the role, in every database or in one. */
export interface RoleVariable {
  name: string
  value: string
  database: string | null
}

/** The attributes ALTER ROLE ... WITH sets, by pg_roles' column names. */
export const ATTRIBUTES = ['rolcanlogin', 'rolinherit', 'rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls'] as const

export type Attribute = (typeof ATTRIBUTES)[number]

/** A role as pgAdmin's properties.sql describes it. */
export type Role = Record<Attribute, boolean> & {
  oid: number
  rolname: string
  rolconnlimit: number
  rolvaliduntil: string | null
  description: string | null
  rolmembership: Membership[]
  rolconfig: string[]
  /** Null when the session may not read pg_authid. */
  has_password: boolean | null
  is_sys_obj: boolean
}

export interface RoleProperties extends Role {
  rolmembers: Membership[]
  variables: RoleVariable[]
  has_admin_option: boolean
  /** The role the session is signed in as. */
  is_current: boolean
}

/** What a create or an update sends; an update changes what differs from the role. */
export type RoleData = Partial<Record<Attribute, boolean>> & {
  rolname?: string
  rolconnlimit?: number | string
  rolvaliduntil?: string | null
  /** '' keeps the password, null removes it. */
  rolpassword?: string | null
  description?: string
  rolmembership?: Membership[]
  rolmembers?: Membership[]
  variables?: RoleVariable[]
}

export interface RoleOptions {
  roles: string[]
  databases: string[]
  /** pg_settings rows a role may set. */
  variables: { name: string; vartype: string; enumvals: string | null; short_desc: string }[]
  /** PostgreSQL 16 and later grant a membership WITH INHERIT and SET of its own. */
  membership_options: boolean
}

export const roles = collection<Role>(collectionUrl(null, 'roles'))

const properties = collection<RoleProperties>(collectionUrl(null, 'roles'))

export function roleProperties(rid: number): Promise<RoleProperties> {
  return properties.properties(rid)
}

export function resolveRole(name: string): Promise<number> {
  return resolve(null, 'role', { name }).then((ids) => ids.rid)
}

export function roleOptions(): Promise<RoleOptions> {
  return api.get<RoleOptions>('/api/server/roles/options')
}

/** REASSIGN OWNED BY the role TO another, or DROP OWNED BY it, in one database. */
export interface Reassign {
  database: string
  operation: 'reassign' | 'drop'
  new_role?: string
  cascade?: boolean
}

export function reassignSql(rid: number, data: Reassign): Promise<string> {
  return api.post<{ sql: string }>(`/api/server/roles/${rid}/reassign/sql`, data).then((r) => r.sql)
}

export function reassign(rid: number, data: Reassign): Promise<string> {
  return api.post<{ sql: string }>(`/api/server/roles/${rid}/reassign`, data).then((r) => r.sql)
}

/** The databases the role holds privileges on (pg_database is shared, so one query answers). */
export function roleDatabases(rid: number): Promise<{ database: string; privileges: Grant[] }[]> {
  return api.get<{ databases: { database: string; privileges: Grant[] }[] }>(`/api/server/roles/${rid}/databases`).then((r) => r.databases)
}

/** One privilege by keyword (SELECT, USAGE…) and whether it may be granted on. */
export interface Grant {
  privilege: string
  with_grant: boolean
}

/** A grantee of an object, PUBLIC included, and who granted what it holds. */
export interface Grantee {
  grantee: string
  grantors: string[]
  privileges: Grant[]
}

export type PrivilegeKind = 'database' | 'tablespace' | 'schema' | 'table' | 'sequence' | 'function' | 'type'

export interface ObjectPrivileges {
  object: { kind: PrivilegeKind; name: string; owner: string }
  /** The privileges GRANT accepts on the object. */
  allowed: string[]
  acl: Grantee[]
  /** A relation's columns with their own grantees. */
  columns?: { name: string; acl: Grantee[] }[]
  column_allowed?: string[]
}

/** One grantee's privileges as they should be; an empty list revokes everything. */
export interface PrivilegeChange {
  grantee: string
  privileges: Grant[]
  column?: string
}

/** A tablespace is shared by the databases, so its privileges hang from the server (db null). */
const privilegesUrl = (db: string | null, kind: PrivilegeKind, oid: number) => `${db === null ? '/api/server' : `/api/databases/${encodeURIComponent(db)}`}/privileges/${kind}/${oid}`

export function objectPrivileges(db: string | null, kind: PrivilegeKind, oid: number): Promise<ObjectPrivileges> {
  return api.get<ObjectPrivileges>(privilegesUrl(db, kind, oid))
}

export function privilegesSql(db: string | null, kind: PrivilegeKind, oid: number, change: PrivilegeChange): Promise<string> {
  return api.post<{ sql: string }>(`${privilegesUrl(db, kind, oid)}/msql`, change).then((r) => r.sql)
}

export function updatePrivileges(db: string | null, kind: PrivilegeKind, oid: number, change: PrivilegeChange): Promise<ObjectPrivileges> {
  return api.post<ObjectPrivileges>(privilegesUrl(db, kind, oid), change)
}

/** pg_default_acl's kinds of object: tables, sequences, functions, types and (database-wide only) schemas. */
export type DefaultObjectType = 'r' | 'S' | 'f' | 'T' | 'n'

export interface DefaultPrivileges {
  /** One per role whose new objects the entry applies to, kind of object and grantee. */
  rows: (Grantee & { role: string; objtype: DefaultObjectType })[]
  allowed: Partial<Record<DefaultObjectType, string[]>>
}

export interface DefaultPrivilegeChange extends PrivilegeChange {
  /** The schema the defaults are limited to; none for the whole database. */
  scid?: number
  /** The role whose new objects get them; the session's own when left out. */
  role?: string
  objtype: DefaultObjectType
}

const defaultsUrl = (db: string) => `/api/databases/${encodeURIComponent(db)}/default-privileges`

export function defaultPrivileges(db: string, scid?: number): Promise<DefaultPrivileges> {
  return api.get<DefaultPrivileges>(scid === undefined ? defaultsUrl(db) : `${defaultsUrl(db)}?scid=${scid}`)
}

export function defaultPrivilegesSql(db: string, change: DefaultPrivilegeChange): Promise<string> {
  return api.post<{ sql: string }>(`${defaultsUrl(db)}/msql`, change).then((r) => r.sql)
}

export function updateDefaultPrivileges(db: string, change: DefaultPrivilegeChange): Promise<DefaultPrivileges> {
  return api.post<DefaultPrivileges>(defaultsUrl(db), change)
}

/** An object of a schema the grant wizard offers, with the privileges it accepts. */
export interface WizardObject {
  kind: PrivilegeKind
  oid: number
  name: string
  /** pg_class.relkind, or pg_proc.prokind for a routine. */
  type: string
  allowed: string[]
}

export interface WizardGrant {
  grantee: string
  objects: { kind: PrivilegeKind; oid: number }[]
  privileges: Grant[]
}

const wizardUrl = (db: string, scid: number) => `/api/databases/${encodeURIComponent(db)}/schemas/${scid}/grant-wizard`

export function wizardObjects(db: string, scid: number): Promise<WizardObject[]> {
  return api.get<{ objects: WizardObject[] }>(wizardUrl(db, scid)).then((r) => r.objects)
}

export function wizardSql(db: string, scid: number, grant: WizardGrant): Promise<string> {
  return api.post<{ sql: string }>(`${wizardUrl(db, scid)}/msql`, grant).then((r) => r.sql)
}

export function runWizard(db: string, scid: number, grant: WizardGrant): Promise<string> {
  return api.post<{ sql: string }>(wizardUrl(db, scid), grant).then((r) => r.sql)
}

/** A tablespace as pgAdmin's properties.sql describes it, with its size in bytes. */
export interface Tablespace {
  oid: number
  name: string
  spcuser: string
  /** '' for pg_default and pg_global, which live in the data directory. */
  spclocation: string
  spcoptions: { name: string; value: string }[]
  /** The ACL as text, null while it holds the built-in default. */
  acl: string | null
  description: string | null
  size: number | null
  is_sys_obj: boolean
}

/** What a create or an update sends; an update changes what differs from the tablespace. */
export interface TablespaceData {
  name?: string
  spcuser?: string
  spclocation?: string
  description?: string
  spcoptions?: { name: string; value: string }[]
}

export interface TablespaceOptions {
  roles: string[]
  /** The planner settings a tablespace may override (pgAdmin's vopts). */
  variables: { name: string; vartype: string; min_val: string | null; max_val: string | null }[]
  /** The databases the session may connect to, where objects may be moved. */
  databases: string[]
  tablespaces: string[]
}

export const tablespaces = collection<Tablespace>(collectionUrl(null, 'tablespaces'))

export function resolveTablespace(name: string): Promise<number> {
  return resolve(null, 'tablespace', { name }).then((ids) => ids.tsid)
}

export function tablespaceOptions(): Promise<TablespaceOptions> {
  return api.get<TablespaceOptions>('/api/server/tablespaces/options')
}

/** pgAdmin's "Move objects": ALTER … ALL IN TABLESPACE … SET TABLESPACE, in one database. */
export interface MoveObjects {
  database: string
  kinds: ('tables' | 'indexes' | 'materialized_views')[]
  tablespace: string
  owned_by: string[]
  nowait: boolean
}

export function moveObjectsSql(tsid: number, data: MoveObjects): Promise<string> {
  return api.post<{ sql: string }>(`/api/server/tablespaces/${tsid}/move/sql`, data).then((r) => r.sql)
}

export function moveObjects(tsid: number, data: MoveObjects): Promise<string> {
  return api.post<{ sql: string }>(`/api/server/tablespaces/${tsid}/move`, data).then((r) => r.sql)
}
