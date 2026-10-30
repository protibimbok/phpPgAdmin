import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { qualifiedName, quoteIdent } from '@sql/js/sql'
import { columns as columnsOf, constraints, resolveSchema, resolveTable, tableModifiedSql, tableOptions, tables, updateTable, type Column, type ForeignKeyData, type ForeignKeyRow, type TableChanges } from '../api'

/** One foreign key as the form holds it. */
interface KeyRow {
  /** The existing constraint, or null for a new row. */
  existing: ForeignKeyRow | null
  name: string
  onDelete: string
  onUpdate: string
  local: string[]
  schema: string
  table: string
  referenced: string[]
  /** MATCH FULL rather than MATCH SIMPLE. */
  matchFull: boolean
  deferrable: boolean
  deferred: boolean
  /** NOT VALID: a new key skips the check of the existing rows; an existing one was added so and not validated since. */
  notValid: boolean
  /** pgAdmin's "Auto FK index?": a new key also gets an index on its columns, named coveringIndex. */
  autoIndex: boolean
  coveringIndex: string
}

/** phpMyAdmin's referential actions, with PostgreSQL's confupdtype/confdeltype codes. */
const ACTIONS: { value: string; label: string }[] = [
  { value: 'a', label: 'NO ACTION' },
  { value: 'r', label: 'RESTRICT' },
  { value: 'c', label: 'CASCADE' },
  { value: 'n', label: 'SET NULL' },
  { value: 'd', label: 'SET DEFAULT' },
]

/**
 * phpMyAdmin's "Relation view" (table/relation/common_form.twig): the foreign key
 * constraints as rows of a table, each with its name, ON DELETE and ON UPDATE actions, the
 * columns of this table and the schema, table and columns it references, with "+ Add
 * column" and "+ Add constraint", Preview SQL and Save. A changed key is dropped and added
 * again (PostgreSQL cannot alter its columns or actions); the Drop icon drops one at once.
 */
export default function RelationView() {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const { data, error, reload } = useRequest(async () => {
    const { scid, tid } = await resolveTable(db, schema, table)
    const [cols, keys, options] = await Promise.all([columnsOf(db, scid, tid).list(), constraints(db, scid, tid, 'foreign_key').list() as Promise<ForeignKeyRow[]>, tableOptions(db, scid)])

    return { scid, tid, columns: cols, keys, schemas: options.schemas }
  }, [db, schema, table])
  const [rows, setRows] = useState<KeyRow[]>([])
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [dropping, setDropping] = useState<ForeignKeyRow | null>(null)
  const [validating, setValidating] = useState<ForeignKeyRow | null>(null)
  // The tables of each schema and the columns of each table, loaded as the selects need them.
  const [tableLists, setTableLists] = useState<Record<string, string[]>>({})
  const [columnLists, setColumnLists] = useState<Record<string, string[]>>({})

  const blank = (): KeyRow => ({ existing: null, name: '', onDelete: 'a', onUpdate: 'a', local: [''], schema, table: '', referenced: [''], matchFull: false, deferrable: false, deferred: false, notValid: false, autoIndex: false, coveringIndex: '' })

  useEffect(() => {
    if (!data) return
    setRows([
      ...data.keys.map((key): KeyRow => ({
        existing: key,
        name: key.name,
        onDelete: key.confdeltype,
        onUpdate: key.confupdtype,
        local: key.columns.map((c) => c.local_column),
        schema: key.refnsp,
        table: key.reftab,
        referenced: key.columns.map((c) => c.referenced),
        matchFull: Boolean(key.confmatchtype),
        deferrable: Boolean(key.condeferrable),
        deferred: Boolean(key.condeferred),
        notValid: key.convalidated === false,
        autoIndex: false,
        coveringIndex: '',
      })),
      blank(),
    ])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const wanted = useMemo(() => rows.map((row) => row.schema).filter(Boolean), [rows])
  useEffect(() => {
    for (const name of new Set(wanted)) {
      if (tableLists[name] !== undefined) continue
      setTableLists((current) => ({ ...current, [name]: [] }))
      void resolveSchema(db, name)
        .then((scid) => tables(db, scid).list())
        .then((list) => setTableLists((current) => ({ ...current, [name]: list.map((tbl) => tbl.name) })))
    }
  }, [wanted, tableLists, db])

  const wantedTables = useMemo(() => rows.filter((row) => row.schema && row.table).map((row) => `${row.schema}.${row.table}`), [rows])
  useEffect(() => {
    for (const key of new Set(wantedTables)) {
      if (columnLists[key] !== undefined) continue
      setColumnLists((current) => ({ ...current, [key]: [] }))
      const [s, tbl] = key.split(/\.(.*)/s)
      void resolveTable(db, s, tbl)
        .then(({ scid, tid }) => columnsOf(db, scid, tid).list())
        .then((list) => setColumnLists((current) => ({ ...current, [key]: list.map((c) => c.name) })))
    }
  }, [wantedTables, columnLists, db])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, tid } = data
  const href = urls.relation(db, schema, table, 'table')
  const relation = qualifiedName(schema, table)

  function update(index: number, patch: Partial<KeyRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const toData = (row: KeyRow): ForeignKeyData => {
    const pairs = row.local.map((local, i) => ({ local_column: local, referenced: row.referenced[i] ?? '' })).filter((p) => p.local_column && p.referenced)

    // The covering index is named after the key as pgAdmin names it (fki_<name>), or after the table and columns.
    const index = row.coveringIndex.trim() || `fki_${row.name || [table, ...pairs.map((p) => p.local_column)].join('_')}`

    return {
      name: row.name || undefined,
      columns: pairs,
      remote_schema: row.schema,
      remote_table: row.table,
      confupdtype: row.onUpdate,
      confdeltype: row.onDelete,
      confmatchtype: row.matchFull,
      condeferrable: row.deferrable,
      condeferred: row.deferrable && row.deferred,
      convalidated: !row.notValid,
      ...(!row.existing && row.autoIndex ? { autoindex: true, coveringindex: index } : {}),
    }
  }

  const same = (row: KeyRow) => {
    const was = row.existing!
    const pairs = toData(row).columns ?? []

    return (
      was.confdeltype === row.onDelete &&
      was.confupdtype === row.onUpdate &&
      Boolean(was.confmatchtype) === row.matchFull &&
      Boolean(was.condeferrable) === row.deferrable &&
      Boolean(was.condeferred) === (row.deferrable && row.deferred) &&
      was.refnsp === row.schema &&
      was.reftab === row.table &&
      pairs.length === was.columns.length &&
      pairs.every((p, i) => p.local_column === was.columns[i].local_column && p.referenced === was.columns[i].referenced)
    )
  }

  /** What Save sends: the keys added, remade and renamed. */
  function changes(): TableChanges | null {
    const added: ForeignKeyData[] = []
    const deleted: ForeignKeyData[] = []
    const changed: ForeignKeyData[] = []
    for (const row of rows) {
      const data = toData(row)
      if (!row.existing) {
        if ((data.columns?.length ?? 0) > 0 && row.table) added.push(data)
        continue
      }
      if (!same(row)) {
        deleted.push({ name: row.existing.name, oid: row.existing.oid })
        added.push(data)
      } else if (row.name !== row.existing.name && row.name !== '') {
        changed.push({ oid: row.existing.oid, name: row.name })
      }
    }
    if (added.length === 0 && deleted.length === 0 && changed.length === 0) return null

    return { foreign_key: { ...(deleted.length ? { deleted } : {}), ...(changed.length ? { changed } : {}), ...(added.length ? { added } : {}) } }
  }

  function showPreview() {
    const body = changes()
    if (!body) {
      notify(t('relation.nothing'))

      return
    }
    setPreview({ sql: null, error: null })
    tableModifiedSql(db, scid, body, tid).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const body = changes()
    if (!body) {
      notify(t('relation.nothing'))

      return
    }
    try {
      await updateTable(db, scid, tid, body)
      notifySuccess(t('relation.saved'))
      reload()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  /** ALTER TABLE … VALIDATE CONSTRAINT: the update template validates when convalidated turns true. */
  async function validate(key: ForeignKeyRow) {
    setValidating(null)
    try {
      await constraints(db, scid, tid, 'foreign_key').update(key.oid, { convalidated: true })
      notifySuccess(t('relation.validated', { name: key.name }))
      reload()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function drop(key: ForeignKeyRow) {
    setDropping(null)
    try {
      await constraints(db, scid, tid, 'foreign_key').remove(key.oid)
      notifySuccess(t('relation.dropped', { name: key.name }))
      reload()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <>
      <ul className="nav nav-pills m-2 d-print-none">
        <li className="nav-item">
          <Link to={href} id="table_structure_id" className="nav-link">
            <Icon name="b_props" /> {t('structure_bar.table_structure')}
          </Link>
        </li>
        <li className="nav-item">
          <Link to={`${href}/relation`} id="table_relation_id" className="nav-link active">
            <Icon name="b_relations" /> {t('structure_bar.relation_view')}
          </Link>
        </li>
      </ul>

      <form onSubmit={save}>
        <fieldset className="pma-fieldset mb-3">
          <legend>{t('relation.title')}</legend>
          <div className="table-responsive-md jsresponsive">
            <table className="relationalTable table table-striped w-auto">
              <thead>
                <tr>
                  <th>{t('relation.actions')}</th>
                  <th>{t('relation.properties')}</th>
                  <th>
                    {t('relation.column')} <abbr title={t('relation.column_hint')}>?</abbr>
                  </th>
                  <th colSpan={3}>{t('relation.foreign_key')}</th>
                </tr>
                <tr>
                  <th />
                  <th />
                  <th />
                  <th>{t('relation.schema')}</th>
                  <th>{t('relation.table')}</th>
                  <th>{t('relation.column')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const tableKey = `${row.schema}.${row.table}`
                  const refColumns = columnLists[tableKey] ?? []

                  return (
                    <tr key={i}>
                      <td>
                        {row.existing && (
                          <a className="drop_foreign_key_anchor text-nowrap" href="#drop" onClick={(e) => { e.preventDefault(); setDropping(row.existing) }}>
                            <Icon name="b_drop" title={tApp('drop')} /> {tApp('drop')}
                          </a>
                        )}
                      </td>
                      <td>
                        <span className="formelement clearfloat">
                          <input type="text" name={`constraint_name[${i}]`} value={row.name} placeholder={t('relation.constraint_name')} maxLength={63} onChange={(e) => update(i, { name: e.target.value })} />
                        </span>
                        <div className="float-start">
                          <span className="formelement">
                            {t('relation.on_delete')}
                            <select name={`on_delete[${i}]`} value={row.onDelete} onChange={(e) => update(i, { onDelete: e.target.value })}>
                              {ACTIONS.map((action) => (
                                <option key={action.value} value={action.value}>
                                  {action.label}
                                </option>
                              ))}
                            </select>
                          </span>
                          <span className="formelement">
                            {t('relation.on_update')}
                            <select name={`on_update[${i}]`} value={row.onUpdate} onChange={(e) => update(i, { onUpdate: e.target.value })}>
                              {ACTIONS.map((action) => (
                                <option key={action.value} value={action.value}>
                                  {action.label}
                                </option>
                              ))}
                            </select>
                          </span>
                        </div>
                        {/* PostgreSQL's own key properties (pgAdmin's Definition tab); phpMyAdmin's MySQL keys have none. */}
                        <div className="float-start clearfloat">
                          <span className="formelement">
                            MATCH
                            <select name={`match_type[${i}]`} value={row.matchFull ? 'f' : 's'} onChange={(e) => update(i, { matchFull: e.target.value === 'f' })}>
                              <option value="s">SIMPLE</option>
                              <option value="f">FULL</option>
                            </select>
                          </span>
                          <span className="formelement">
                            <input type="checkbox" name={`deferrable[${i}]`} id={`fk_deferrable_${i}`} checked={row.deferrable} onChange={(e) => update(i, { deferrable: e.target.checked, deferred: e.target.checked && row.deferred })} />{' '}
                            <label htmlFor={`fk_deferrable_${i}`}>DEFERRABLE</label>
                          </span>
                          <span className="formelement">
                            <input type="checkbox" name={`deferred[${i}]`} id={`fk_deferred_${i}`} checked={row.deferred} onChange={(e) => update(i, { deferred: e.target.checked, deferrable: e.target.checked || row.deferrable })} />{' '}
                            <label htmlFor={`fk_deferred_${i}`}>INITIALLY DEFERRED</label>
                          </span>
                        </div>
                        <div className="float-start clearfloat">
                          {row.existing ? (
                            row.existing.convalidated === false && (
                              <span className="formelement">
                                <strong>NOT VALID</strong>{' '}
                                <a className="validate_foreign_key_anchor" href="#validate" onClick={(e) => { e.preventDefault(); setValidating(row.existing) }}>
                                  {t('relation.validate')}
                                </a>
                              </span>
                            )
                          ) : (
                            <>
                              <span className="formelement">
                                <input type="checkbox" name={`not_valid[${i}]`} id={`fk_not_valid_${i}`} checked={row.notValid} onChange={(e) => update(i, { notValid: e.target.checked })} />{' '}
                                <label htmlFor={`fk_not_valid_${i}`} title={t('relation.not_valid_hint')}>
                                  NOT VALID
                                </label>
                              </span>
                              <span className="formelement">
                                <input type="checkbox" name={`auto_index[${i}]`} id={`fk_auto_index_${i}`} checked={row.autoIndex} onChange={(e) => update(i, { autoIndex: e.target.checked })} />{' '}
                                <label htmlFor={`fk_auto_index_${i}`} title={t('relation.auto_index_hint')}>
                                  {t('relation.auto_index')}
                                </label>
                              </span>
                              {row.autoIndex && (
                                <span className="formelement">
                                  <input type="text" name={`covering_index[${i}]`} value={row.coveringIndex} placeholder={t('relation.covering_index')} aria-label={t('relation.covering_index')} maxLength={63} onChange={(e) => update(i, { coveringIndex: e.target.value })} />
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        {row.local.map((local, j) => (
                          <span className="formelement clearfloat" key={j}>
                            <select name={`foreign_key_fields_name[${i}][]`} value={local} onChange={(e) => update(i, { local: row.local.map((v, k) => (k === j ? e.target.value : v)) })}>
                              <option value="" />
                              {data.columns.map((column: Column) => (
                                <option key={column.attnum} value={column.name}>
                                  {column.name}
                                </option>
                              ))}
                            </select>
                          </span>
                        ))}
                        <a className="formelement clearfloat add_foreign_key_field" href="#add-column" onClick={(e) => { e.preventDefault(); update(i, { local: [...row.local, ''], referenced: [...row.referenced, ''] }) }}>
                          {t('relation.add_column')}
                        </a>
                      </td>
                      <td>
                        <span className="formelement clearfloat">
                          <select name={`destination_foreign_db[${i}]`} title={t('relation.schema')} value={row.schema} onChange={(e) => update(i, { schema: e.target.value, table: '', referenced: row.referenced.map(() => '') })}>
                            <option value="" />
                            {data.schemas.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                      <td>
                        <span className="formelement clearfloat">
                          <select name={`destination_foreign_table[${i}]`} title={t('relation.table')} value={row.table} onChange={(e) => update(i, { table: e.target.value, referenced: row.referenced.map(() => '') })}>
                            <option value="" />
                            {[...new Set([...(tableLists[row.schema] ?? []), ...(row.table ? [row.table] : [])])].map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </span>
                      </td>
                      <td>
                        {row.referenced.map((ref, j) => (
                          <span className="formelement clearfloat" key={j}>
                            <select name={`destination_foreign_column[${i}][]`} title={t('relation.column')} value={ref} onChange={(e) => update(i, { referenced: row.referenced.map((v, k) => (k === j ? e.target.value : v)) })}>
                              <option value="" />
                              {[...new Set([...refColumns, ...(ref ? [ref] : [])])].map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </select>
                          </span>
                        ))}
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <th colSpan={6}>
                    <a className="formelement clearfloat add_foreign_key" href="#add-constraint" onClick={(e) => { e.preventDefault(); setRows((current) => [...current, blank()]) }}>
                      {t('relation.add_constraint')}
                    </a>
                  </th>
                </tr>
              </tbody>
            </table>
          </div>
        </fieldset>

        <fieldset className="pma-fieldset tblFooters">
          <input className="btn btn-secondary preview_sql" type="button" value={tApp('preview_sql')} onClick={showPreview} />{' '}
          <input className="btn btn-primary" type="submit" value={tApp('save')} />
        </fieldset>
      </form>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
      <ConfirmQuery show={validating !== null} sql={`ALTER TABLE IF EXISTS ${relation} VALIDATE CONSTRAINT ${quoteIdent(validating?.name ?? '')};`} onClose={() => setValidating(null)} onConfirm={() => validating && void validate(validating)} />
      <ConfirmQuery show={dropping !== null} sql={`ALTER TABLE ${relation} DROP CONSTRAINT ${quoteIdent(dropping?.name ?? '')};`} onClose={() => setDropping(null)} onConfirm={() => dropping && void drop(dropping)} />
    </>
  )
}
