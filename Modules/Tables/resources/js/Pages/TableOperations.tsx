import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { qualifiedName, quoteIdent } from '@sql/js/sql'
import { constraints, copyTable, detachPartition, dropTable, indexes as indexesOf, partitions as partitionsOf, resolveTable, tableModifiedSql, tableOptions, tables, truncateTable, updateTable, type CopyTableOptions, type ForeignKeyRow, type Partition, type TableChanges } from '../api'

type Preview = { sql: string | null; error: string | null } | null

/**
 * A table's "Operations" page, laid out like phpMyAdmin's table/operations/index.twig: the
 * cards to move the table (schema.table), its options (rename, comment, owner and tablespace
 * where phpMyAdmin has the engine and collation), the copy (schema.table, structure and/or
 * data, DROP TABLE first, the foreign keys), the maintenance links (which run their statement
 * on the SQL page, as phpMyAdmin's do), "Delete data or table" (TRUNCATE, DELETE FROM, DROP)
 * and the referential integrity checks, one per foreign key.
 */
export default function TableOperations() {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', table = '' } = useParams()
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(async () => {
    const { scid, tid } = await resolveTable(db, schema, table)
    const [properties, options, keys, idx, primary, unique] = await Promise.all([
      tables(db, scid).properties(tid),
      tableOptions(db, scid),
      constraints(db, scid, tid, 'foreign_key').list() as Promise<ForeignKeyRow[]>,
      indexesOf(db, scid, tid).list(),
      // The index list leaves out the indexes of constraints, which the table may be clustered on too.
      constraints(db, scid, tid, 'primary_key').list(),
      constraints(db, scid, tid, 'unique_constraint').list(),
    ])
    const parts: Partition[] = properties.is_partitioned ? await partitionsOf(db, scid, tid).list() : []
    const clustered = [...idx, ...primary, ...unique].find((i) => i.indisclustered)?.name ?? null
    // CLUSTER takes a B-tree or GiST index; a primary key's and a unique constraint's are B-trees.
    const clusterable = [...primary.map((c) => c.name), ...unique.map((c) => c.name), ...idx.filter((i) => i.amname === 'btree' || i.amname === 'gist').map((i) => i.name)]

    return { scid, tid, properties, options, keys, clustered, clusterable, partitions: parts }
  }, [db, schema, table])
  const [preview, setPreview] = useState<Preview>(null)
  const [confirm, setConfirm] = useState<{ sql: string; warning?: string; run: () => Promise<void>; boxes?: { key: string; label: string }[] } | null>(null)
  const [boxes, setBoxes] = useState<Record<string, boolean>>({})

  const [clusterOn, setClusterOn] = useState('')
  const [moveSchema, setMoveSchema] = useState(schema)
  const [moveName, setMoveName] = useState(table)
  const [newName, setNewName] = useState(table)
  const [comment, setComment] = useState('')
  const [owner, setOwner] = useState('')
  const [tablespace, setTablespace] = useState('')
  const [inherits, setInherits] = useState<string[]>([])
  const [partitionNames, setPartitionNames] = useState<string[]>([])
  const [partitionOperation, setPartitionOperation] = useState<'ANALYZE' | 'VACUUM' | 'TRUNCATE' | 'DETACH' | 'DROP'>('ANALYZE')
  const [copy, setCopy] = useState<CopyTableOptions & { switch_to_new: boolean }>({ schema, name: table, what: 'data', drop_if_exists: false, add_constraints: true, switch_to_new: false })

  useEffect(() => {
    if (!data) return
    setMoveSchema(schema)
    setMoveName(table)
    setNewName(table)
    setComment(data.properties.description ?? '')
    setOwner(data.properties.relowner)
    setTablespace(data.properties.spcname ?? '')
    setInherits(data.properties.coll_inherits ?? [])
    setCopy((c) => ({ ...c, schema, name: table }))
  }, [data, schema, table])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, tid, properties, options, keys } = data
  const href = urls.relation(db, schema, table, 'table')
  const relation = qualifiedName(schema, table)
  const sqlPage = (sql: string) => `${href}/sql?${new URLSearchParams({ sql, run: '1' })}`

  function showPreview(changes: TableChanges) {
    setPreview({ sql: null, error: null })
    tableModifiedSql(db, scid, changes, tid).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  async function alter(changes: TableChanges, message: string, after?: () => void) {
    try {
      await updateTable(db, scid, tid, changes)
      notifySuccess(message)
      treeState.refresh()
      if (after) after()
      else reload()
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  function moveChanges(): TableChanges {
    const changes: TableChanges = {}
    if (moveSchema !== schema) changes.schema = moveSchema
    if (moveName !== table) changes.name = moveName

    return changes
  }

  function optionChanges(): TableChanges {
    const changes: TableChanges = {}
    if (newName !== table) changes.name = newName
    if (comment !== (properties.description ?? '')) changes.description = comment
    if (owner !== properties.relowner) changes.relowner = owner
    if (tablespace !== (properties.spcname ?? '') && tablespace !== '') changes.spcname = tablespace

    return changes
  }

  /** The parents as the INHERITS clause names them; the update INHERITs the new ones and NO INHERITs the dropped. */
  function inheritChanges(): TableChanges {
    const was = properties.coll_inherits ?? []
    const same = was.length === inherits.length && was.every((parent) => inherits.includes(parent))

    return same ? {} : { coll_inherits: inherits }
  }

  function submitInherits(e: FormEvent) {
    e.preventDefault()
    const changes = inheritChanges()
    if (Object.keys(changes).length === 0) return notify(tApp('nothing_to_change'))
    void alter(changes, tApp('query_executed'))
  }

  function submitMove(e: FormEvent) {
    e.preventDefault()
    const changes = moveChanges()
    if (Object.keys(changes).length === 0) return notify(tApp('nothing_to_change'))
    void alter(changes, t('operations.moved', { table: relation, target: qualifiedName(moveSchema, moveName) }), () => navigate(`${urls.relation(db, moveSchema, moveName, 'table')}/operations`))
  }

  function submitOptions(e: FormEvent) {
    e.preventDefault()
    const changes = optionChanges()
    if (Object.keys(changes).length === 0) return notify(tApp('nothing_to_change'))
    void alter(changes, tApp('query_executed'), changes.name ? () => navigate(`${urls.relation(db, schema, changes.name!, 'table')}/operations`) : undefined)
  }

  async function submitCopy(e: FormEvent) {
    e.preventDefault()
    try {
      await copyTable(db, scid, tid, copy)
      notifySuccess(t('operations.copied', { table: relation, target: qualifiedName(copy.schema ?? schema, copy.name) }))
      treeState.refresh()
      if (copy.switch_to_new) navigate(`${urls.relation(db, copy.schema ?? schema, copy.name, 'table')}/operations`)
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  function previewCopy() {
    setPreview({ sql: null, error: null })
    copyTable(db, scid, tid, copy, true).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  function askTruncate() {
    setBoxes({ identity: false, cascade: false })
    setConfirm({
      sql: `TRUNCATE TABLE ${relation}`,
      warning: t('operations.truncate_warning'),
      boxes: [
        { key: 'identity', label: t('operations.restart_identity') },
        { key: 'cascade', label: t('operations.cascade') },
      ],
      run: async () => {
        try {
          await truncateTable(db, scid, tid, { identity: boxesRef.current.identity, cascade: boxesRef.current.cascade })
          notifySuccess(t('operations.emptied', { table }))
          reload()
        } catch (e) {
          notifyError(errorMessage(e))
        }
      },
    })
  }

  function askDrop() {
    setBoxes({ cascade: false })
    setConfirm({
      sql: `DROP TABLE ${relation}`,
      warning: t('operations.drop_warning'),
      boxes: [{ key: 'cascade', label: t('operations.cascade') }],
      run: async () => {
        try {
          await dropTable(db, scid, tid, boxesRef.current.cascade)
          notifySuccess(t('operations.dropped', { table }))
          treeState.refresh()
          navigate(urls.schema(db, schema))
        } catch (e) {
          notifyError(errorMessage(e))
        }
      },
    })
  }

  /** phpMyAdmin's partition maintenance: the operation on the selected partitions (ANALYZE and VACUUM run on the SQL page). */
  function submitPartitions(e: FormEvent) {
    e.preventDefault()
    const targets = data!.partitions.filter((p) => partitionNames.includes(p.name))
    if (targets.length === 0) return notify(t('partitions.none_selected'), 'error')
    const names = targets.map((p) => qualifiedName(p.schema, p.name))
    if (partitionOperation === 'ANALYZE' || partitionOperation === 'VACUUM') {
      return navigate(sqlPage(names.map((n) => `${partitionOperation} ${n}`).join(';\n')))
    }
    const statement = (n: string) => (partitionOperation === 'TRUNCATE' ? `TRUNCATE TABLE ${n}` : partitionOperation === 'DETACH' ? `ALTER TABLE ${relation} DETACH PARTITION ${n}` : `DROP TABLE ${n}`)
    setBoxes({})
    setConfirm({
      sql: names.map(statement).join(';\n'),
      warning: partitionOperation === 'DROP' ? t('operations.drop_warning') : partitionOperation === 'TRUNCATE' ? t('operations.truncate_warning') : undefined,
      run: async () => {
        try {
          for (const p of targets) {
            if (partitionOperation === 'TRUNCATE') await truncateTable(db, scid, p.oid)
            else if (partitionOperation === 'DETACH') await detachPartition(db, scid, tid, p.oid)
            else await partitionsOf(db, scid, tid).remove(p.oid)
          }
          notifySuccess(tApp('query_executed'))
          treeState.refresh()
          setPartitionNames([])
          reload()
        } catch (err) {
          notifyError(errorMessage(err))
        }
      },
    })
  }

  // The dialog's boxes are read when it is confirmed; a ref sees the latest state.
  boxesRef.current = boxes

  const previewButton = (changes: () => TableChanges) => <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={() => showPreview(changes())} />

  /** phpMyAdmin's referential integrity check: the rows whose key points nowhere. */
  const integrityQuery = (key: ForeignKeyRow) => {
    const ref = qualifiedName(key.refnsp, key.reftab)
    const alias = key.reftab === table && key.refnsp === schema ? quoteIdent(`${table}1`) : ref
    const on = key.columns.map((c) => `${relation}.${quoteIdent(c.local_column)} = ${alias}.${quoteIdent(c.referenced)}`).join(' AND ')
    const where = key.columns.map((c) => `${alias}.${quoteIdent(c.referenced)} IS NULL AND ${relation}.${quoteIdent(c.local_column)} IS NOT NULL`).join(' AND ')

    return `SELECT ${relation}.* FROM ${relation} LEFT JOIN ${ref}${alias !== ref ? ` AS ${alias}` : ''} ON ${on} WHERE ${where}`
  }

  return (
    <div className="container-fluid">
      <form id="moveTableForm" onSubmit={submitMove}>
        <div className="card mb-2">
          <div className="card-header">{t('operations.move')}</div>
          <div className="card-body">
            <div className="mb-3 row g-3">
              <div className="col-auto">
                <div className="input-group">
                  <select id="moveTableDatabaseInput" className="form-select" name="target_db" aria-label={t('operations.schema')} value={moveSchema} onChange={(e) => setMoveSchema(e.target.value)}>
                    {options.schemas.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="input-group-text">.</span>
                  <input className="form-control" type="text" required name="new_name" maxLength={63} value={moveName} onChange={(e) => setMoveName(e.target.value)} aria-label={t('operations.table')} />
                </div>
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(moveChanges)}
            <input className="btn btn-primary" type="submit" name="submit_move" value={tApp('go')} />
          </div>
        </div>
      </form>

      <form id="tableOptionsForm" onSubmit={submitOptions}>
        <div className="card mb-2">
          <div className="card-header">{t('operations.options')}</div>
          <div className="card-body">
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label htmlFor="renameTableInput">{t('operations.rename')}</label>
              </div>
              <div className="col-6">
                <input className="form-control" id="renameTableInput" type="text" name="new_name" maxLength={63} value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </div>
            </div>
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label htmlFor="tableCommentsInput">{t('operations.comments')}</label>
              </div>
              <div className="col-6">
                <input className="form-control" id="tableCommentsInput" type="text" name="comment" maxLength={2048} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label className="text-nowrap" htmlFor="tableOwnerSelect">
                  {t('operations.owner')}
                </label>
              </div>
              <div className="col-6">
                <select className="form-select" name="relowner" id="tableOwnerSelect" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  {[...new Set([properties.relowner, ...options.roles])].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label htmlFor="tablespaceSelect">{t('operations.tablespace')}</label>
              </div>
              <div className="col-6">
                <select className="form-select" id="tablespaceSelect" lang="en" dir="ltr" name="spcname" value={tablespace} onChange={(e) => setTablespace(e.target.value)}>
                  {[...new Set([properties.spcname ?? '', ...options.tablespaces])].map((space) => (
                    <option key={space} value={space}>
                      {space}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(optionChanges)}
            <input className="btn btn-primary" type="submit" value={tApp('go')} />
          </div>
        </div>
      </form>

      {/* pgAdmin's "Inherited from table(s)"; phpMyAdmin has no counterpart, so the card follows the options card's layout. */}
      <form id="tableInheritsForm" onSubmit={submitInherits}>
        <div className="card mb-2">
          <div className="card-header">{t('operations.inherits')}</div>
          <div className="card-body">
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label htmlFor="tableInheritsSelect">{t('operations.inherits_from')}</label>
              </div>
              <div className="col-6">
                <select className="form-select" id="tableInheritsSelect" name="coll_inherits" multiple size={Math.min(6, Math.max(3, options.inherits.length))} value={inherits} onChange={(e) => setInherits(Array.from(e.target.selectedOptions, (o) => o.value))}>
                  {[...new Set([...(properties.coll_inherits ?? []), ...options.inherits.filter((parent) => parent.oid !== tid).map((parent) => parent.inherits)])].map((parent) => (
                    <option key={parent} value={parent}>
                      {options.inherits.find((candidate) => candidate.inherits === parent)?.schema ?? schema}.{options.inherits.find((candidate) => candidate.inherits === parent)?.name ?? parent}
                    </option>
                  ))}
                </select>
                <div className="form-text">{t('operations.inherits_hint')}</div>
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(inheritChanges)}
            <input className="btn btn-primary" type="submit" value={tApp('go')} />
          </div>
        </div>
      </form>

      <form name="copyTable" id="copyTable" onSubmit={submitCopy}>
        <div className="card mb-2">
          <div className="card-header">{t('operations.copy')}</div>
          <div className="card-body">
            <div className="mb-3 row g-3">
              <div className="col-auto">
                <div className="input-group">
                  <select className="form-select" name="target_db" aria-label={t('operations.schema')} value={copy.schema} onChange={(e) => setCopy({ ...copy, schema: e.target.value })}>
                    {options.schemas.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="input-group-text">.</span>
                  <input className="form-control" type="text" name="new_name" maxLength={63} value={copy.name} onChange={(e) => setCopy({ ...copy, name: e.target.value })} aria-label={t('operations.table')} required />
                </div>
              </div>
            </div>

            <div className="mb-3">
              {(['structure', 'data', 'dataonly'] as const).map((what, i) => (
                <div className="form-check" key={what}>
                  <input className="form-check-input" type="radio" name="what" id={`whatRadio${i + 1}`} value={what} checked={copy.what === what} onChange={() => setCopy({ ...copy, what })} />
                  <label className="form-check-label" htmlFor={`whatRadio${i + 1}`}>
                    {t(`operations.what.${what}`)}
                  </label>
                </div>
              ))}
            </div>

            <div className="mb-3">
              <div className="form-check">
                <input className="form-check-input" type="checkbox" name="drop_if_exists" id="checkbox_drop" checked={copy.drop_if_exists} onChange={(e) => setCopy({ ...copy, drop_if_exists: e.target.checked })} />
                <label className="form-check-label" htmlFor="checkbox_drop">
                  {t('operations.add_drop_table')}
                </label>
              </div>
              {keys.length > 0 && (
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" name="add_constraints" id="checkbox_constraints" checked={copy.add_constraints} onChange={(e) => setCopy({ ...copy, add_constraints: e.target.checked })} />
                  <label className="form-check-label" htmlFor="checkbox_constraints">
                    {t('operations.add_constraints')}
                  </label>
                </div>
              )}
              <div className="form-check">
                <input className="form-check-input" type="checkbox" name="switch_to_new" id="checkbox_switch" checked={copy.switch_to_new} onChange={(e) => setCopy({ ...copy, switch_to_new: e.target.checked })} />
                <label className="form-check-label" htmlFor="checkbox_switch">
                  {t('operations.switch_to_new')}
                </label>
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={previewCopy} />
            <input className="btn btn-primary" type="submit" name="submit_copy" value={tApp('go')} />
          </div>
        </div>
      </form>

      {properties.is_partitioned && (
        <form id="partitionsForm" onSubmit={submitPartitions}>
          <div className="card mb-2">
            <div className="card-header">{t('partitions.maintenance')}</div>
            <div className="card-body">
              <div className="mb-3">
                <label htmlFor="partition_name">{t('partitions.columns.partition')}</label>
                <select className="form-select resize-vertical" id="partition_name" name="partition_name[]" multiple size={Math.min(6, Math.max(2, data.partitions.length))} value={partitionNames} onChange={(e) => setPartitionNames(Array.from(e.target.selectedOptions, (o) => o.value))} required>
                  {data.partitions.map((p) => (
                    <option key={p.oid} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-3 form-check-inline">
                {(['ANALYZE', 'VACUUM', 'TRUNCATE', 'DETACH', 'DROP'] as const).map((value) => (
                  <div className="form-check" key={value}>
                    <input className="form-check-input" type="radio" name="partition_operation" id={`partitionOperationRadio${value}`} value={value} checked={partitionOperation === value} onChange={() => setPartitionOperation(value)} />
                    <label className="form-check-label" htmlFor={`partitionOperationRadio${value}`}>
                      {t(`partitions.operations.${value.toLowerCase()}`)}
                    </label>
                  </div>
                ))}
              </div>
            </div>
            <div className="card-footer text-end">
              <input className="btn btn-primary" type="submit" value={tApp('go')} />
            </div>
          </div>
        </form>
      )}

      <div className="card mb-2">
        <div className="card-header">{t('operations.maintenance')}</div>
        <ul className="list-group list-group-flush" id="tbl_maintenance">
          <li className="list-group-item">
            <Link to={sqlPage(`ANALYZE ${relation}`)}>{t('operations.analyze')}</Link>
          </li>
          <li className="list-group-item">
            <Link className="maintain_action" to={sqlPage(`VACUUM ${relation}`)}>
              {t('operations.vacuum')}
            </Link>
          </li>
          <li className="list-group-item">
            <Link className="maintain_action" to={sqlPage(`VACUUM (ANALYZE) ${relation}`)}>
              {t('operations.vacuum_analyze')}
            </Link>
          </li>
          <li className="list-group-item">
            <Link className="maintain_action" to={sqlPage(`REINDEX TABLE ${relation}`)}>
              {t('operations.reindex')}
            </Link>
          </li>
          {data.clustered && (
            <li className="list-group-item">
              <Link className="maintain_action" to={sqlPage(`CLUSTER ${relation}`)}>
                {t('operations.cluster', { index: data.clustered })}
              </Link>
            </li>
          )}
          {data.clusterable.length > 0 && (
            <li className="list-group-item">
              <div className="row g-2 align-items-center">
                <div className="col-auto">
                  <label htmlFor="cluster_index" className="col-form-label">
                    {t('operations.cluster_using')}
                  </label>
                </div>
                <div className="col-auto">
                  <select className="form-select" id="cluster_index" name="cluster_index" value={clusterOn || data.clusterable[0]} onChange={(e) => setClusterOn(e.target.value)}>
                    {data.clusterable.map((index) => (
                      <option key={index} value={index}>
                        {index}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-auto">
                  <Link className="maintain_action btn btn-secondary" to={sqlPage(`CLUSTER ${relation} USING ${quoteIdent(clusterOn || data.clusterable[0])}`)}>
                    {tApp('go')}
                  </Link>
                </div>
              </div>
            </li>
          )}
        </ul>
      </div>

      <div className="card mb-2">
        <div className="card-header">{t('operations.delete')}</div>
        <ul className="list-group list-group-flush">
          <li className="list-group-item">
            <a id="truncate_tbl_anchor" className="text-danger" href="#truncate" onClick={(e) => { e.preventDefault(); askTruncate() }}>
              {t('operations.truncate')}
            </a>
          </li>
          <li className="list-group-item">
            <a
              id="delete_tbl_anchor"
              className="text-danger"
              href="#delete"
              onClick={(e) => {
                e.preventDefault()
                setBoxes({})
                setConfirm({ sql: `DELETE FROM ${relation}`, warning: t('operations.delete_warning'), run: async () => navigate(sqlPage(`DELETE FROM ${relation}`), { state: { confirmed: true } }) })
              }}
            >
              {t('operations.delete_from')}
            </a>
          </li>
          <li className="list-group-item">
            <a id="drop_tbl_anchor" className="text-danger" href="#drop" onClick={(e) => { e.preventDefault(); askDrop() }}>
              {t('operations.drop')}
            </a>
          </li>
        </ul>
      </div>

      {keys.length > 0 && (
        <div className="card mb-2">
          <div className="card-header">{t('operations.referential')}</div>
          <ul className="list-group list-group-flush">
            {keys.map((key) => (
              <li className="list-group-item" key={key.oid}>
                <Link className="text-nowrap" to={sqlPage(integrityQuery(key))}>
                  {key.columns.map((c) => c.local_column).join(', ')} -&gt; {key.refnsp}.{key.reftab}.{key.columns.map((c) => c.referenced).join(', ')}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />

      <ConfirmQuery
        show={confirm !== null}
        sql={confirm ? `${confirm.sql}${boxes.identity ? ' RESTART IDENTITY' : ''}${boxes.cascade ? ' CASCADE' : ''};` : ''}
        warning={confirm?.warning}
        confirmLabel={tApp('ok')}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm
          setConfirm(null)
          if (pending) void pending.run()
        }}
      >
        {confirm?.boxes?.map((box) => (
          <div className="form-check mt-2" key={box.key}>
            <input className="form-check-input" type="checkbox" id={`confirm_${box.key}`} checked={Boolean(boxes[box.key])} onChange={(e) => setBoxes({ ...boxes, [box.key]: e.target.checked })} />
            <label className="form-check-label" htmlFor={`confirm_${box.key}`}>
              {box.label}
            </label>
          </div>
        ))}
      </ConfirmQuery>
    </div>
  )
}

/** The confirmation boxes as last rendered, for the pending action to read. */
const boxesRef: { current: Record<string, boolean> } = { current: {} }
