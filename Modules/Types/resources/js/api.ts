import { api } from '@/api/request'
import { collection, collectionUrl, resolve, type TreeNode } from '@/nodes/client'

/** What the editor creates: pgAdmin's typtype codes plus the domain node. */
export type TypeKind = 'c' | 'e' | 'r' | 'd' | 'b' | 'p'

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
  /** A base type's settings, as pgAdmin's properties.sql names them. */
  typreceive?: string | null
  typsend?: string | null
  typmodin?: string | null
  typmodout?: string | null
  typanalyze?: string | null
  typsubscript?: string | null
  typlen?: number
  typbyval?: boolean
  /** 'c', 's', 'i' or 'd' */
  typalign?: string
  /** 'p', 'e', 'm' or 'x' */
  typstorage?: string
  typcategory?: string
  typispreferred?: boolean
  typdefault?: string | null
  element?: string | null
  typdelim?: string
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
  /** The functions a base type's input, output, receive, send and analyze may be (CREATE TYPE … INPUT = …). */
  functions: string[]
  typmodin: string[]
  typmodout: string[]
  /** server_version_num: SUBSCRIPT needs 14. */
  version: number
}

export function typeOptions(db: string, scid: number, subtype = ''): Promise<TypeOptions> {
  const query = subtype ? `?${new URLSearchParams({ subtype })}` : ''

  return api.get<TypeOptions>(`${collectionUrl(db, 'schemas', scid, 'types')}/options${query}`)
}

/** What CREATE TYPE and ALTER TYPE take, by pgAdmin's field names (types/create.sql, update.sql). */
export interface TypeData {
  name?: string
  typtype?: 'c' | 'e' | 'r' | 'b' | 'p'
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
  typinput?: string
  typoutput?: string
  typreceive?: string
  typsend?: string
  typmodin?: string
  typmodout?: string
  typanalyze?: string
  typsubscript?: string
  typlen?: string
  typbyval?: boolean
  typalign?: string
  typstorage?: string
  typlike?: string
  typcategory?: string
  typispreferred?: boolean
  typdefault?: string
  element?: string
  typdelim?: string
  is_collatable?: boolean
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
  /** pg_collation_actual_version: what the library provides now; differs from version after an upgrade. */
  actual_version: string | null;
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

/** ALTER COLLATION … REFRESH VERSION: records the version the library provides now. */
export function refreshCollationVersion(db: string, scid: number, coid: number): Promise<Collation> {
  return api.post<{ properties: Collation }>(`${collectionUrl(db, 'schemas', scid, 'collations', coid)}/refresh_version`).then((r) => r.properties)
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

export type OpclassKind = 'opclass' | 'opfamily' | 'conversion'

/** An operator class, operator family or conversion of the schema. */
export interface OpclassRow {
  oid: number
  name: string
  kind: OpclassKind
  schema: string
  amname: string | null
  for_type: string | null
  is_default: boolean | null
  family: string | null
  storage: string | null
  source_encoding: string | null
  target_encoding: string | null
  function: string | null
  owner: string
  description: string | null
}

const opclassUrl = (db: string, scid: number) => `${collectionUrl(db, 'schemas', scid, 'opclasses')}`

export function listOpclasses(db: string, scid: number): Promise<OpclassRow[]> {
  return api.get<{ rows: OpclassRow[] }>(opclassUrl(db, scid)).then((r) => r.rows)
}

export function opclassSql(db: string, scid: number, row: OpclassRow): Promise<string> {
  return api.get<{ sql: string }>(`${opclassUrl(db, scid)}/${row.kind}/${row.oid}/sql`).then((r) => r.sql)
}

export function dropOpclass(db: string, scid: number, row: OpclassRow, cascade = false): Promise<void> {
  return api.delete<{ ok: true }>(`${opclassUrl(db, scid)}/${row.kind}/${row.oid}${cascade ? '?cascade=1' : ''}`).then(() => undefined)
}

/** The DROP a row's kind takes. */
export function opclassDropSql(schemaIdent: string, row: OpclassRow): string {
  const kind = { opclass: 'OPERATOR CLASS', opfamily: 'OPERATOR FAMILY', conversion: 'CONVERSION' }[row.kind]

  return `DROP ${kind} ${schemaIdent}${row.amname ? ` USING ${row.amname}` : ''};`
}

/** What the operator class, family and conversion form offers. */
export interface OpclassOptions {
  methods: string[]
  encodings: string[]
  families: { name: string; amname: string }[]
}

/** An operator (by strategy number) or a support function (by support number) of a new operator class. */
export interface OpclassMember {
  type: 'operator' | 'function'
  number: string
  /** An operator name, or a function with its argument types: "btint4cmp(integer, integer)". */
  name: string
  lefttype: string
  righttype: string
  /** An ordering operator's sort family: FOR ORDER BY. */
  order_by: string
}

/** What CREATE OPERATOR CLASS, OPERATOR FAMILY or CONVERSION takes; each kind reads its own fields. */
export interface OpclassData {
  name: string
  description: string
  amname?: string
  for_type?: string
  is_default?: boolean
  family?: string
  storage?: string
  members?: OpclassMember[]
  source_encoding?: string
  target_encoding?: string
  function?: string
}

export function opclassOptions(db: string, scid: number): Promise<OpclassOptions> {
  return api.get<OpclassOptions>(`${opclassUrl(db, scid)}/options`)
}

export function createOpclass(db: string, scid: number, kind: OpclassKind, data: OpclassData): Promise<void> {
  return api.post<{ ok: true }>(`${opclassUrl(db, scid)}/${kind}`, data).then(() => undefined)
}

export function opclassCreateSql(db: string, scid: number, kind: OpclassKind, data: OpclassData): Promise<string> {
  return api.post<{ sql: string }>(`${opclassUrl(db, scid)}/${kind}/msql`, data).then((r) => r.sql)
}
