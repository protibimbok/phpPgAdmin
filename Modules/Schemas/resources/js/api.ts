import { collection, collectionUrl, type TreeNode } from '@/nodes/client'

/** A schema as pgAdmin's properties.sql describes it. */
export interface Schema {
  oid: number
  name: string
  /** 3 for a user schema, 0 for pg_*, 1 for a temporary one. */
  nsptyp: number
  namespaceowner: string
  description: string | null
  can_create: boolean
  acl: string | null
  is_sys_obj: boolean
}

export interface SchemaMeta {
  can_create: boolean
  has_usage: boolean
  description: string | null
}

export function schemas(db: string) {
  return collection<Schema, SchemaMeta>(collectionUrl(db, 'schemas'))
}

export function listSchemas(db: string): Promise<Schema[]> {
  return schemas(db).list()
}

export function schemaNodes(db: string): Promise<TreeNode<SchemaMeta>[]> {
  return schemas(db).nodes()
}
