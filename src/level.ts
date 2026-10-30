import { matchPath, useLocation } from 'react-router'

/** The object kinds a level below the schema may address. */
export type RelationKind = 'table' | 'view' | 'mview'

/**
 * Where in the server a page is, read from the URL: the server itself, a database, a schema in
 * it, or a table (view, materialized view) in that schema. phpMyAdmin has server, database and
 * table; PostgreSQL adds the schema in between.
 *
 *     /                                   server
 *     /db/:db                             database
 *     /db/:db/schema/:schema              schema
 *     /db/:db/schema/:schema/table/:table table (or view/:view, mview/:mview)
 */
export interface Level {
  name: 'server' | 'database' | 'schema' | 'table'
  db?: string
  schema?: string
  table?: string
  kind?: RelationKind
}

export type LevelName = Level['name']

const KINDS: readonly RelationKind[] = ['table', 'view', 'mview']

/** A path segment as the name it encodes; matchPath leaves location.pathname's escapes in. */
function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

export function parseLevel(pathname: string): Level {
  for (const kind of KINDS) {
    const match = matchPath({ path: `/db/:db/schema/:schema/${kind}/:table`, end: false }, pathname)
    if (match?.params.db && match.params.schema && match.params.table) {
      return { name: 'table', db: decode(match.params.db), schema: decode(match.params.schema), table: decode(match.params.table), kind }
    }
  }

  const schema = matchPath({ path: '/db/:db/schema/:schema', end: false }, pathname)
  if (schema?.params.db && schema.params.schema) {
    return { name: 'schema', db: decode(schema.params.db), schema: decode(schema.params.schema) }
  }

  const db = matchPath({ path: '/db/:db', end: false }, pathname)
  if (db?.params.db) {
    return { name: 'database', db: decode(db.params.db) }
  }

  return { name: 'server' }
}

export function useLevel(): Level {
  return parseLevel(useLocation().pathname)
}

const encode = encodeURIComponent

/** The URLs of the levels, for links and the breadcrumb. */
export const urls = {
  server: () => '/',
  database: (db: string) => `/db/${encode(db)}`,
  schema: (db: string, schema: string) => `/db/${encode(db)}/schema/${encode(schema)}`,
  relation: (db: string, schema: string, name: string, kind: RelationKind = 'table') => `/db/${encode(db)}/schema/${encode(schema)}/${kind}/${encode(name)}`,
}

/**
 * Fill a path template with the level's names: "/db/:db/structure" for the database "app" is
 * "/db/app/structure". A placeholder the level cannot fill is left as it is.
 */
export function fillPath(template: string, level: Level): string {
  return template
    .replace(':db', level.db !== undefined ? encode(level.db) : ':db')
    .replace(':schema', level.schema !== undefined ? encode(level.schema) : ':schema')
    .replace(':kind', level.kind ?? ':kind')
    .replace(':table', level.table !== undefined ? encode(level.table) : ':table')
}
