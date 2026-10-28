import { api } from '@/api/request'
import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'

/** What the editor creates: pgAdmin's typtype codes plus the domain node. */
export type TypeKind = 'c' | 'e' | 'r' | 'd'

/** A composite member as pgAdmin's dialog lists it. */
export interface Member {
  attnum?: number
  member_name: string
  /** The type as the type list names it, with "[]" for an array. */
  type: string
  tlength: string | null
  precision: string | null
  collation: string
  fulltype?: string
}

export interface EnumLabel {
  label: string
  old_label?: string
}

/** A type as pgAdmin's types/properties.sql describes it, with the kind-specific additions. */
export interface PgType {
  oid: number
  name: string
  schema: string
  /** 'c' composite, 'e' enum, 'r' range, 'b' base, 'p' shell, 'm' multirange. */
  typtype: string
  typeowner: string
  description: string | null
  alias: string
  is_sys_type: boolean
  is_collatable: boolean
  member_list?: string
  composite?: Member[]
  enum_list?: string
  enum?: EnumLabel[]
  /** A range's subtype and settings. */
  typname?: string
  opcname?: string | null
  collname?: string | null
  rngcanonical?: string | null
  rngsubdiff?: string | null
  rngmultirangetype?: string | null
  typinput?: string
  typoutput?: string
  typacl?: unknown[]
  seclabels?: { provider: string; label: string }[]
}

export interface DomainConstraint {
  conoid?: number
  conname: string
  consrc: string
  convalidated: boolean
  description?: string | null
}

/** A domain as pgAdmin's domains/properties.sql describes it, with the constraints. */
export interface Domain {
  oid: number
  name: string
  basensp: string
  basetype: string
  fulltype: string
  typlen: string
  precision: string
  typnotnull: boolean
  typdefault: string | null
  collname: string
  owner: string
  description: string | null
  sysdomain: boolean
  constraints: DomainConstraint[]
  seclabels?: { provider: string; label: string }[]
}

export function types(db: string, scid: number) {
  return collection<PgType>(collectionUrl(db, 'schemas', scid, 'types'))
}

export function domains(db: string, scid: number) {
  return collection<Domain>(collectionUrl(db, 'schemas', scid, 'domains'))
}

/** The schema's OID, which the collections are addressed by. */
export function resolveSchema(db: string, schema: string): Promise<number> {
  return resolve(db, 'schema', { name: schema }).then((ids) => ids.scid)
}

export function resolveType(db: string, schema: string, name: string): Promise<{ scid: number; tid: number }> {
  return resolve(db, 'type', { schema, name }).then((ids) => ({ scid: ids.scid, tid: ids.tid }))
}

export function resolveDomain(db: string, schema: string, name: string): Promise<{ scid: number; doid: number }> {
  return resolve(db, 'domain', { schema, name }).then((ids) => ({ scid: ids.scid, doid: ids.doid }))
}

/** A row of the Types page: a type or a domain, tagged. */
export type TypeRow = ({ node: 'type' } & PgType) | ({ node: 'domain' } & Domain)

/** Every type and domain of the schema, sorted by name. */
export function listTypes(db: string, scid: number): Promise<TypeRow[]> {
  return Promise.all([types(db, scid).list(), domains(db, scid).list()]).then(([typeRows, domainRows]) =>
    [...typeRows.map((row): TypeRow => ({ node: 'type', ...row })), ...domainRows.map((row): TypeRow => ({ node: 'domain', ...row }))].sort((a, b) => a.name.localeCompare(b.name)),
  )
}

/** What the type editor offers (GET …/types/options[?subtype=]). */
export interface TypeOptions {
  types: { name: string; schema: string; is_collatable: boolean }[]
  collations: string[]
  subtypes: { name: string; is_collatable: boolean }[]
  opclasses: string[]
  roles: string[]
  schemas: string[]
}

export function typeOptions(db: string, scid: number, subtype = ''): Promise<TypeOptions> {
  const query = subtype ? `?${new URLSearchParams({ subtype })}` : ''

  return api.get<TypeOptions>(`${collectionUrl(db, 'schemas', scid, 'types')}/options${query}`)
}

/** What CREATE TYPE and ALTER TYPE take, by pgAdmin's field names (types/create.sql, update.sql). */
export interface TypeData {
  name?: string
  typtype?: 'c' | 'e' | 'r'
  typeowner?: string
  description?: string
  composite?: Member[]
  enum?: EnumLabel[]
  typname?: string
  opcname?: string
  collname?: string
  rngcanonical?: string
  rngsubdiff?: string
  rngmultirangetype?: string
}

/** What CREATE DOMAIN and ALTER DOMAIN take (domains/create.sql, update.sql). */
export interface DomainData {
  name?: string
  basetype?: string
  typlen?: string
  precision?: string
  typdefault?: string
  typnotnull?: boolean
  collname?: string
  owner?: string
  description?: string
  constraints?: DomainConstraint[]
}

export function createType(db: string, scid: number, data: TypeData): Promise<TreeNode> {
  return types(db, scid).create(data)
}

export function updateType(db: string, scid: number, tid: number, data: TypeData): Promise<TreeNode> {
  return types(db, scid).update(tid, data)
}

export function createDomain(db: string, scid: number, data: DomainData): Promise<TreeNode> {
  return domains(db, scid).create(data)
}

export function updateDomain(db: string, scid: number, doid: number, data: DomainData): Promise<TreeNode> {
  return domains(db, scid).update(doid, data)
}

export function dropTypeRow(db: string, scid: number, row: TypeRow, cascade = false): Promise<void> {
  return (row.node === 'domain' ? domains(db, scid).remove(row.oid, cascade) : types(db, scid).remove(row.oid, cascade)).then(() => undefined)
}

export function typeRowSql(db: string, scid: number, row: TypeRow): Promise<string> {
  return row.node === 'domain' ? domains(db, scid).sql(row.oid) : types(db, scid).sql(row.oid)
}

/** A collation as pgAdmin's collations/properties.sql describes it. */
export interface Collation {
  oid: number;
  name: string;
  schema: string;
  lc_collate: string | null;
  lc_type: string | null;
  /** 'libc', 'icu' or, on PostgreSQL 17+, 'builtin'. */
  provider: string;
  is_deterministic: boolean;
  version: string | null;
  rules: string | null;
  owner: string;
  description: string | null;
  is_sys_obj: boolean;
}

/** What CREATE COLLATION and ALTER COLLATION take (collations/create.sql, update.sql). */
export interface CollationData {
  name?: string;
  owner?: string;
  description?: string;
  copy_collation?: string;
  locale?: string;
  lc_collate?: string;
  lc_type?: string;
  provider?: string;
  is_deterministic?: boolean;
  rules?: string;
  version?: string;
}

export interface CollationOptions {
  collations: string[];
  roles: string[];
  /** The server version number, which decides the providers and whether RULES is offered. */
  version: number;
}

export function collations(db: string, scid: number) {
  return collection<Collation>(
    collectionUrl(db, "schemas", scid, "collations"),
  );
}

export function collationOptions(
  db: string,
  scid: number,
): Promise<CollationOptions> {
  return api.get<CollationOptions>(
    `${collectionUrl(db, "schemas", scid, "collations")}/options`,
  );
}

/** pgAdmin's four full text search nodes. */
export type FtsKind =
  "fts_configuration" | "fts_dictionary" | "fts_parser" | "fts_template";

export const FTS_KINDS: FtsKind[] = [
  "fts_configuration",
  "fts_dictionary",
  "fts_parser",
  "fts_template",
];

const FTS_COLLECTIONS: Record<FtsKind, string> = {
  fts_configuration: "fts_configurations",
  fts_dictionary: "fts_dictionaries",
  fts_parser: "fts_parsers",
  fts_template: "fts_templates",
};

/** A token type with the dictionaries it maps to, as a configuration's properties list them. */
export interface TokenMapping {
  token: string;
  dictname: string[];
}

export interface DictionaryOption {
  option: string;
  value: string;
}

/** A text search object as its properties.sql describes it, with each kind's own fields. */
export interface FtsObject {
  oid: number;
  name: string;
  schema: string;
  description: string | null;
  is_sys_obj: boolean;
  owner?: string;
  /** A configuration: the parser's OID and name, and the mappings (properties only). */
  parser?: number;
  prsname?: string;
  tokens?: TokenMapping[];
  /** A dictionary: its template and options. */
  template?: string;
  options?: DictionaryOption[];
  /** A parser: its functions. */
  prsstart?: string;
  prstoken?: string;
  prsend?: string;
  prslextype?: string;
  prsheadline?: string;
  /** A template: its functions. */
  tmplinit?: string;
  tmpllexize?: string;
}

/** A row of the text search list: an object tagged with its kind. */
export type FtsRow = FtsObject & { kind: FtsKind };

/** What the CREATE and ALTER TEXT SEARCH statements take, by pgAdmin's field names. */
export interface FtsData {
  name?: string;
  owner?: string;
  description?: string;
  prsname?: string;
  copy_config?: string;
  tokens?: TokenMapping[];
  template?: string;
  options?: DictionaryOption[];
  prsstart?: string;
  prstoken?: string;
  prsend?: string;
  prslextype?: string;
  prsheadline?: string;
  tmplinit?: string;
  tmpllexize?: string;
}

/** What the text search editor offers, by kind (GET …/<collection>/options). */
export interface FtsOptions {
  roles?: string[];
  parsers?: { oid: number; name: string }[];
  configurations?: string[];
  dictionaries?: string[];
  templates?: string[];
  start?: string[];
  token?: string[];
  end?: string[];
  lextype?: string[];
  headline?: string[];
  init?: string[];
  lexize?: string[];
}

export function textSearch(db: string, scid: number, kind: FtsKind) {
  return collection<FtsObject>(
    collectionUrl(db, "schemas", scid, FTS_COLLECTIONS[kind]),
  );
}

export function ftsOptions(
  db: string,
  scid: number,
  kind: FtsKind,
): Promise<FtsOptions> {
  return api.get<FtsOptions>(
    `${collectionUrl(db, "schemas", scid, FTS_COLLECTIONS[kind])}/options`,
  );
}

/** The token types a parser produces, which a configuration maps. */
export function ftsTokens(
  db: string,
  scid: number,
  parser: number,
): Promise<string[]> {
  return api.get<string[]>(
    `${collectionUrl(db, "schemas", scid, "fts_configurations")}/tokens?${new URLSearchParams({ parser: String(parser) })}`,
  );
}

/** Every text search object of the schema: configurations, dictionaries, parsers then templates, each by name. */
export function listTextSearch(db: string, scid: number): Promise<FtsRow[]> {
  return Promise.all(
    FTS_KINDS.map((kind) =>
      textSearch(db, scid, kind)
        .list()
        .then((rows) => rows.map((row): FtsRow => ({ ...row, kind }))),
    ),
  ).then((lists) =>
    lists
      .flat()
      .sort(
        (a, b) =>
          FTS_KINDS.indexOf(a.kind) - FTS_KINDS.indexOf(b.kind) ||
          a.name.localeCompare(b.name),
      ),
  );
}

/** The object kind as the SQL names it: TEXT SEARCH CONFIGURATION… */
export function ftsSqlKind(kind: FtsKind): string {
  return `TEXT SEARCH ${kind.slice(4).toUpperCase()}`;
}
