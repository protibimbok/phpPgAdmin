import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'

/**
 * A database as pgAdmin's properties.sql describes it (plus the size), for the list page.
 * Catalog columns keep pgAdmin's names so the forms and templates read the same.
 */
export interface Database {
  did: number
  oid: number
  name: string
  datowner: string
  encoding: string
  datcollate: string
  datctype: string
  spcname: string | null
  datconnlimit: number
  datallowconn: boolean
  is_template: boolean
  comments: string | null
  /** Bytes, or null when the role may not connect to the database and so cannot measure it. */
  size: number | null
  /** Below pgAdmin's last system OID: a system database. */
  is_sys_obj: boolean
  /** False for the database the session is connected to. */
  can_drop: boolean
}

/** What the tree node of a database carries besides its name. */
export interface DatabaseMeta {
  did: number
  spcname: string | null
  datallowconn: boolean
  is_template: boolean
  cancreate: boolean
  owner: number
  description: string | null
  is_sys_obj: boolean
}

/** The database collection: server-level, so no database in the URL. */
export const databases = collection<Database, DatabaseMeta>(collectionUrl(null, 'databases'))

export function listDatabases(): Promise<Database[]> {
  return databases.list()
}

export function databaseNodes(): Promise<TreeNode<DatabaseMeta>[]> {
  return databases.nodes()
}

/** The privileges on a database as the properties carry them. */
export interface DatabaseAcl {
  grantor: string | null
  grantee: string
  privileges: { privilege_type: string; privilege: boolean; with_grant: boolean }[]
}

/** The properties pgAdmin's database dialog reads, on top of the list's columns. */
export interface DatabaseProperties extends Omit<Database, 'can_drop'> {
  datacl: DatabaseAcl[]
  deftblacl: DatabaseAcl[]
  defseqacl: DatabaseAcl[]
  deffuncacl: DatabaseAcl[]
  deftypeacl: DatabaseAcl[]
  variables: { name: string; value: unknown; role?: string | null; database?: string | null }[]
  seclabels: { provider: string; label: string }[]
}

export function resolveDatabase(name: string): Promise<number> {
  return resolve(null, 'database', { name }).then((ids) => ids.did)
}

export function databaseProperties(did: number): Promise<DatabaseProperties> {
  return collection<DatabaseProperties>(collectionUrl(null, 'databases')).properties(did)
}

export function databaseSql(did: number): Promise<string> {
  return databases.sql(did)
}
