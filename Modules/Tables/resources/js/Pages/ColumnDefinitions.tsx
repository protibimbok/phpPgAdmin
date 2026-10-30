import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { columns as columnsOf, createTable, resolveSchema, resolveTable, tableModifiedSql, tableOptions, tables, updateTable, type ColumnData, type NewTable, type TableChanges, type TableOptions } from '../api'
import { DEFAULT_TYPES, emptyDefinition, fromColumn, fromTypeColumn, hasTypeOptions, indexesOf, takesLength, toColumnChanges, toColumnData, typeChanged, typeGroups, type ColumnDefinition } from '../columns/definitions'

type Mode = 'create' | 'add' | 'change'

type LikeOption = 'like_default_value' | 'like_constraints' | 'like_indexes' | 'like_storage' | 'like_comments' | 'like_compression' | 'like_generated' | 'like_identity' | 'like_statistics'

/** LIKE's INCLUDING options, by pgAdmin's field names, with the keyword each adds and the server version it needs. */
const LIKE_OPTIONS: { key: LikeOption; keyword: string; version?: number }[] = [
  { key: 'like_default_value', keyword: 'DEFAULTS' },
  { key: 'like_constraints', keyword: 'CONSTRAINTS' },
  { key: 'like_indexes', keyword: 'INDEXES' },
  { key: 'like_storage', keyword: 'STORAGE' },
  { key: 'like_comments', keyword: 'COMMENTS' },
  { key: 'like_compression', keyword: 'COMPRESSION', version: 140000 },
  { key: 'like_generated', keyword: 'GENERATED' },
  { key: 'like_identity', keyword: 'IDENTITY' },
  { key: 'like_statistics', keyword: 'STATISTICS' },
]

/** The table's primary key as its properties carry it, with the column names. */
interface PrimaryKey {
  oid: number
  name: string
  columns: { column: string }[]
}

/**
 * phpMyAdmin's column definition form (columns_definitions/column_definitions_form.twig and
 * table_fields_definitions.twig), for three pages: creating a table (/table/create), adding
 * columns to one (/table/add-field) and changing columns (/table/structure/change). One row
 * per column with Name, Type, Length/Values, Default, Collation, Attributes, Null, Index,
 * A_I and Comments; the create page adds the table's comment, owner, tablespace, parents,
 * LIKE source, OF type, access method and UNLOGGED (the table options rows). Preview
 * SQL shows the statements; Save runs them through the table node.
 */
export default function ColumnDefinitions({ mode }: { mode: Mode }) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()

  const { data, error } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)
    const options = await tableOptions(db, scid)
    if (mode === 'create') return { scid, tid: null, options, existing: [] as ColumnDefinition[], primaryKey: null as PrimaryKey | null }
    const { tid } = await resolveTable(db, schema, table)
    const [cols, properties] = await Promise.all([columnsOf(db, scid, tid).list(), tables(db, scid).properties(tid) as Promise<{ primary_key?: PrimaryKey[] }>])
    const primaryColumns = new Set((cols[0]?.indkey ?? '').split(' ').filter(Boolean).map(Number))
    const wanted = (search.get('attnums') ?? '').split(',').filter(Boolean).map(Number)
    const existing = mode === 'change' ? cols.filter((c) => wanted.includes(c.attnum)).map((c) => fromColumn(c, primaryColumns.has(c.attnum))) : []

    return { scid, tid, options, existing, primaryKey: properties.primary_key?.[0] ?? null }
  }, [db, schema, table, mode, search.get('attnums')])

  const initialCount = Math.max(1, Number(search.get(mode === 'create' ? 'columns' : 'count') ?? (mode === 'create' ? 4 : 1)) || 1)
  const [name, setName] = useState(search.get('name') ?? '')
  const [rows, setRows] = useState<ColumnDefinition[]>([])
  const [addCount, setAddCount] = useState(1)
  const [comment, setComment] = useState('')
  const [owner, setOwner] = useState('')
  const [tablespace, setTablespace] = useState('')
  const [inherits, setInherits] = useState<string[]>([])
  const [partitionBy, setPartitionBy] = useState('')
  const [partitionExpr, setPartitionExpr] = useState('')
  const [ofType, setOfType] = useState('')
  const [like, setLike] = useState('')
  const [likeOptions, setLikeOptions] = useState<Partial<Record<LikeOption, boolean>>>({})
  const [amname, setAmname] = useState('')
  const [unlogged, setUnlogged] = useState(false)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!data) return
    setRows(mode === 'change' ? data.existing : Array.from({ length: initialCount }, emptyDefinition))
  }, [data, mode, initialCount])

  const groups = useMemo(() => typeGroups(data?.options), [data])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, tid, options } = data
  const tableHref = mode === 'create' ? urls.relation(db, schema, name, 'table') : urls.relation(db, schema, table, 'table')

  function update(index: number, patch: Partial<ColumnDefinition>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  /** OF type: the rows become the type's attributes; a typed table takes no LIKE and no INHERITS. */
  function chooseOfType(typname: string) {
    setOfType(typname)
    const type = options.of_types.find((candidate) => candidate.typname === typname)
    if (type) {
      setRows(type.columns.map(fromTypeColumn))
      setLike('')
      setInherits([])
    } else {
      setRows((current) => (current.some((row) => row.ofType) ? Array.from({ length: initialCount }, emptyDefinition) : current))
    }
  }

  function chooseLike(relation: string) {
    setLike(relation)
    if (relation !== '' && ofType !== '') chooseOfType('')
  }

  const likeShown = LIKE_OPTIONS.filter((option) => !option.version || options.version >= option.version)
  const likeAll = likeShown.every((option) => likeOptions[option.key])

  function addRows() {
    setRows((current) => [...current, ...Array.from({ length: Math.max(1, addCount) }, emptyDefinition)])
  }

  /** What the save sends: CREATE TABLE data, or the ALTER TABLE changes. */
  function payload(): NewTable | TableChanges | null {
    const filled = rows.filter((row) => row.name.trim() !== '')
    const keys = indexesOf(filled)

    if (mode === 'create') {
      // A typed table's columns are the type's; only those with options of their own are written (WITH OPTIONS).
      const columns = ofType ? filled.filter((row) => !row.ofType || hasTypeOptions(row)) : filled
      const created: NewTable = { name, columns: columns.map(toColumnData), description: comment || undefined, relowner: owner || undefined, spcname: tablespace || undefined, coll_inherits: inherits.length > 0 ? inherits : undefined }
      if (ofType) created.typname = ofType
      if (like) Object.assign(created, { like_relation: like }, likeOptions)
      if (amname) created.amname = amname
      if (unlogged) created.relpersistence = true
      if (partitionBy && partitionExpr.trim() !== '') created.partition_scheme = `${partitionBy} (${partitionExpr.trim()})`
      if (keys.primary) created.primary_key = [keys.primary]
      if (keys.unique.length > 0) created.unique_constraint = keys.unique
      if (keys.indexes.length > 0) created.indexes = keys.indexes

      return created
    }

    const changes: TableChanges = {}
    if (mode === 'add') {
      changes.columns = { added: filled.map(toColumnData) }
    } else {
      const changed = filled.map(toColumnChanges).filter((c): c is ColumnData => c !== null)
      if (changed.length > 0) changes.columns = { changed }
      // Keys and indexes are added below; a column that already was in the primary key stays as it is.
      keys.primary = (() => {
        const added = filled.filter((row) => row.index === 'primary' && row.original?.index !== 'primary')
        if (added.length === 0) return null
        const all = [...(data!.primaryKey?.columns ?? []), ...added.map((row) => ({ column: row.name }))]

        return { columns: all }
      })()
    }
    if (keys.primary) {
      changes.primary_key = data!.primaryKey ? { deleted: [{ name: data!.primaryKey.name, oid: data!.primaryKey.oid }], added: [keys.primary] } : { added: [keys.primary] }
    }
    if (keys.unique.length > 0) changes.unique_constraint = { added: keys.unique }
    if (keys.indexes.length > 0) changes.indexes = { added: keys.indexes }

    return Object.keys(changes).length === 0 ? null : changes
  }

  function showPreview() {
    const body = payload()
    if (!body) {
      notify(tApp('nothing_to_change'))

      return
    }
    setPreview({ sql: null, error: null })
    tableModifiedSql(db, scid, body, tid ?? undefined).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const body = payload()
    if (!body) {
      notify(tApp('nothing_to_change'))

      return
    }
    setBusy(true)
    try {
      if (mode === 'create') {
        await createTable(db, scid, body as NewTable)
        notifySuccess(t('definitions.created', { table: name }))
      } else {
        await updateTable(db, scid, tid!, body as TableChanges)
        notifySuccess(tApp('query_executed'))
      }
      treeState.refresh()
      navigate(tableHref)
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={`${mode === 'create' ? 'create_table' : 'append_fields'}_form`} onSubmit={save}>
      {mode === 'create' && (
        <div id="table_name_col_no_outer">
          <table id="table_name_col_no" className="table table-borderless tdblock">
            <tbody>
              <tr className="align-middle float-start">
                <td>
                  {t('definitions.table_name')}:{' '}
                  <input type="text" name="table" size={40} maxLength={63} value={name} onChange={(e) => setName(e.target.value)} className="textfield" autoFocus required />
                </td>
                <td>
                  {t('definitions.add')}{' '}
                  <input type="number" id="added_fields" name="added_fields" size={2} value={addCount} min={1} onChange={(e) => setAddCount(Number(e.target.value) || 1)} onFocus={(e) => e.target.select()} />{' '}
                  {t('definitions.columns')} <input className="btn btn-secondary" type="button" name="submit_num_fields" value={tApp('go')} onClick={addRows} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {mode !== 'create' && (
        <table className="table table-borderless tdblock w-auto">
          <tbody>
            <tr className="align-middle">
              <td>
                {t('definitions.add')}{' '}
                <input type="number" id="added_fields" name="added_fields" size={2} value={addCount} min={1} onChange={(e) => setAddCount(Number(e.target.value) || 1)} onFocus={(e) => e.target.select()} />{' '}
                {t('definitions.columns')} <input className="btn btn-secondary" type="button" name="submit_num_fields" value={tApp('go')} onClick={addRows} />
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="responsivetable">
        <table id="table_columns" className="table table-striped caption-top align-middle mb-0 noclick">
          <caption className="tblHeaders">{t('definitions.structure')}</caption>
          <thead>
            <tr>
              <th>{t('definitions.name')}</th>
              <th>{t('definitions.type')}</th>
              <th>
                {t('definitions.length')} <abbr title={t('definitions.length_hint')}>?</abbr>
              </th>
              <th>
                {t('definitions.default')} <abbr title={t('definitions.default_hint')}>?</abbr>
              </th>
              <th>{t('definitions.collation')}</th>
              <th>{t('definitions.attributes')}</th>
              <th>{t('definitions.null')}</th>
              <th>{t('definitions.index')}</th>
              <th>
                <abbr title={t('definitions.identity_hint')}>A_I</abbr>
              </th>
              <th>{t('definitions.comments')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <ColumnRow key={i} index={i} row={row} groups={groups} options={options} onChange={(patch) => update(i, patch)} />
            ))}
          </tbody>
        </table>
      </div>

      {mode === 'create' && (
        <div className="responsivetable">
          <table className="table table-borderless w-auto align-middle mb-0">
            <tbody>
              <tr className="align-top">
                <th>{t('definitions.table_comments')}</th>
                <td width={25}>&nbsp;</td>
                <th>{t('definitions.owner')}</th>
                <td width={25}>&nbsp;</td>
                <th>{t('definitions.tablespace')}</th>
                <td width={25}>&nbsp;</td>
                <th>{t('definitions.inherits')}</th>
              </tr>
              <tr>
                <td>
                  <input type="text" name="comment" size={40} maxLength={60} value={comment} onChange={(e) => setComment(e.target.value)} className="textfield" />
                </td>
                <td width={25}>&nbsp;</td>
                <td>
                  <select name="relowner" value={owner} onChange={(e) => setOwner(e.target.value)} aria-label={t('definitions.owner')}>
                    <option value="" />
                    {options.roles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
                <td width={25}>&nbsp;</td>
                <td>
                  <select name="spcname" value={tablespace} onChange={(e) => setTablespace(e.target.value)} aria-label={t('definitions.tablespace')}>
                    <option value="" />
                    {options.tablespaces.map((space) => (
                      <option key={space} value={space}>
                        {space}
                      </option>
                    ))}
                  </select>
                </td>
                <td width={25}>&nbsp;</td>
                <td>
                  {/* INHERITS (parent, …): the parents' columns are added to the table by PostgreSQL. */}
                  <select name="coll_inherits" multiple size={3} value={inherits} onChange={(e) => setInherits(Array.from(e.target.selectedOptions, (o) => o.value))} aria-label={t('definitions.inherits')}>
                    {options.inherits.map((parent) => (
                      <option key={parent.oid} value={parent.inherits}>
                        {parent.schema}.{parent.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr className="align-top">
                <th>{t('definitions.like')}</th>
                <td width={25}>&nbsp;</td>
                <th>{t('definitions.of_type')}</th>
                <td width={25}>&nbsp;</td>
                <th>{t('definitions.access_method')}</th>
                <td width={25}>&nbsp;</td>
                <th>{t('definitions.persistence')}</th>
              </tr>
              <tr className="align-top">
                <td className="align-top">
                  {/* LIKE source INCLUDING …: the source's columns come first, with what is ticked. */}
                  <select name="like_relation" value={like} onChange={(e) => chooseLike(e.target.value)} aria-label={t('definitions.like')}>
                    <option value="" />
                    {options.like_relations.map((relation) => (
                      <option key={relation} value={relation}>
                        {relation}
                      </option>
                    ))}
                  </select>
                  {like !== '' && (
                    <div id="like_options" className="mt-1">
                      <div>
                        <input
                          type="checkbox"
                          id="like_all"
                          checked={likeAll}
                          onChange={(e) => setLikeOptions(Object.fromEntries(likeShown.map((option) => [option.key, e.target.checked])))}
                        />
                        {' '}
                        <label htmlFor="like_all">
                          INCLUDING ALL
                        </label>
                      </div>
                      {likeShown.map((option) => (
                        <div key={option.key}>
                          <input type="checkbox" name={option.key} id={option.key} checked={Boolean(likeOptions[option.key])} onChange={(e) => setLikeOptions({ ...likeOptions, [option.key]: e.target.checked })} />
                          {' '}
                          <label htmlFor={option.key}>
                            INCLUDING {option.keyword}
                          </label>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td width={25}>&nbsp;</td>
                <td className="align-top">
                  <select name="typname" value={ofType} onChange={(e) => chooseOfType(e.target.value)} aria-label={t('definitions.of_type')}>
                    <option value="" />
                    {options.of_types.map((type) => (
                      <option key={type.oid} value={type.typname}>
                        {type.typname}
                      </option>
                    ))}
                  </select>
                </td>
                <td width={25}>&nbsp;</td>
                <td className="align-top">
                  <select name="amname" value={amname} onChange={(e) => setAmname(e.target.value)} aria-label={t('definitions.access_method')}>
                    <option value="">{t('definitions.access_method_default', { method: options.default_amname })}</option>
                    {options.access_methods.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </td>
                <td width={25}>&nbsp;</td>
                <td className="align-top">
                  <div>
                    <input type="checkbox" name="relpersistence" id="relpersistence" checked={unlogged} onChange={(e) => setUnlogged(e.target.checked)} />
                    {' '}
                    <label htmlFor="relpersistence">
                      UNLOGGED
                    </label>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {mode === 'create' && (
        /* columns_definitions/partitions.twig: "Partition by: [strategy] (expression or column list)". Partitions are added from the structure page. */
        <table className="table table-borderless w-auto align-middle mb-0" id="partition_table">
          <tbody>
            <tr className="align-middle">
              <td>
                <label htmlFor="partition_by">{t('partitions.partition_by')}</label>
              </td>
              <td>
                <select name="partition_by" id="partition_by" value={partitionBy} onChange={(e) => setPartitionBy(e.target.value)}>
                  {['', 'RANGE', 'LIST', 'HASH'].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                (<input name="partition_expr" type="text" placeholder={t('partitions.expression_hint')} value={partitionExpr} onChange={(e) => setPartitionExpr(e.target.value)} />)
              </td>
            </tr>
          </tbody>
        </table>
      )}

      <fieldset className="pma-fieldset tblFooters">
        <input className="btn btn-secondary preview_sql" type="button" value={tApp('preview_sql')} onClick={showPreview} />{' '}
        <input className="btn btn-primary" type="submit" name="do_save_data" value={tApp('save')} disabled={busy} />
      </fieldset>
      <div id="properties_message" />

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </form>
  )
}

/** One row of the structure table: phpMyAdmin's column_attributes.twig. */
function ColumnRow({ index, row, groups, options, onChange }: { index: number; row: ColumnDefinition; groups: { key: string; types: string[] }[]; options: TableOptions; onChange: (patch: Partial<ColumnDefinition>) => void }) {
  const { t } = useTranslation('tables')
  const id = (n: number) => `field_${index}_${n}`

  return (
    <tr>
      {row.ofType ? (
        <>
          <td className="text-center" title={t('definitions.of_type_column')}>
            {row.name}
          </td>
          <td className="text-center" colSpan={2} title={t('definitions.of_type_column')}>
            <bdo dir="ltr" lang="en">
              {row.type}
              {row.length !== '' && `(${row.length})`}
              {row.attribute}
            </bdo>
          </td>
        </>
      ) : (
        <>
          <td className="text-center">
            <input id={id(1)} type="text" name={`field_name[${index}]`} maxLength={63} className="textfield" title={t('definitions.column')} size={10} value={row.name} onChange={(e) => onChange({ name: e.target.value })} />
          </td>
          <td className="text-center">
            <select className="column_type" name={`field_type[${index}]`} id={id(2)} value={row.type} onChange={(e) => onChange({ type: e.target.value })}>
              {groups.map((group) => (
                <optgroup key={group.key} label={t(`definitions.type_groups.${group.key}`)}>
                  {group.types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {typeChanged(row) && (
              // A type the old one has no automatic cast to (text to integer) needs USING, as the server's hint says.
              <input
                type="text"
                name={`field_using[${index}]`}
                className="textfield d-block mt-1"
                size={16}
                title={t('definitions.using_hint')}
                placeholder={t('definitions.using_placeholder', { expression: `${row.original!.name}::${row.type}${row.attribute}` })}
                value={row.using ?? ''}
                onChange={(e) => onChange({ using: e.target.value })}
              />
            )}
          </td>
          <td className="text-center">
            <input id={id(3)} type="text" name={`field_length[${index}]`} size={8} value={row.length} className="textfield" placeholder={takesLength(row.type) ? '' : undefined} onChange={(e) => onChange({ length: e.target.value })} />
          </td>
        </>
      )}
      <td className="text-center">
        <select name={`field_default_type[${index}]`} id={id(4)} className="default_type" value={row.defaultType} onChange={(e) => onChange({ defaultType: e.target.value as ColumnDefinition['defaultType'] })}>
          {DEFAULT_TYPES.map((kind) => (
            <option key={kind} value={kind}>
              {t(`definitions.default_types.${kind}`)}
            </option>
          ))}
        </select>
        {row.defaultType === 'USER_DEFINED' && (
          <input type="text" name={`field_default_value[${index}]`} size={12} value={row.defaultValue} className="textfield default_value" onChange={(e) => onChange({ defaultValue: e.target.value })} />
        )}
      </td>
      {row.ofType ? (
        // The type fixes a typed table column's collation and array dimension.
        <td colSpan={2} />
      ) : (
        <>
          <td className="text-center">
            <select lang="en" dir="ltr" name={`field_collation[${index}]`} id={id(5)} value={row.collation} onChange={(e) => onChange({ collation: e.target.value })}>
              <option value="" />
              {options.collations.map((collation) => (
                <option key={collation} value={collation}>
                  {collation}
                </option>
              ))}
            </select>
          </td>
          <td className="text-center">
            <select name={`field_attribute[${index}]`} id={id(6)} value={row.attribute} onChange={(e) => onChange({ attribute: e.target.value as ColumnDefinition['attribute'] })}>
              <option value="" />
              <option value="[]">ARRAY</option>
            </select>
          </td>
        </>
      )}
      <td className="text-center">
        <input name={`field_null[${index}]`} id={id(7)} type="checkbox" value="YES" className="allow_null" checked={row.nullable} onChange={(e) => onChange({ nullable: e.target.checked })} />
      </td>
      <td className="text-center">
        <select name={`field_key[${index}]`} id={id(8)} value={row.index} onChange={(e) => onChange({ index: e.target.value as ColumnDefinition['index'] })}>
          <option value="">---</option>
          <option value="primary" title={t('structure.actions.primary')}>
            PRIMARY
          </option>
          <option value="unique" title={t('structure.actions.unique')}>
            UNIQUE
          </option>
          <option value="index" title={t('structure.actions.index')}>
            INDEX
          </option>
        </select>
      </td>
      <td className="text-center">
        <input name={`field_extra[${index}]`} id={id(9)} type="checkbox" value="IDENTITY" checked={row.identity} onChange={(e) => onChange({ identity: e.target.checked })} />
      </td>
      <td className="text-center">
        <textarea id={id(10)} rows={1} name={`field_comments[${index}]`} value={row.comment} onChange={(e) => onChange({ comment: e.target.value })} />
      </td>
    </tr>
  )
}
