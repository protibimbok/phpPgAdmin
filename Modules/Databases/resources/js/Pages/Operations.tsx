import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { listSchemas } from '@schemas/js/api'
import MaintenanceCard from '@maintenance/js/MaintenanceCard'
import { quoteIdent } from '@sql/js/sql'
import { collationRemedy, createDatabase, databaseModifiedSql, databaseOptions, databaseProperties, dropDatabase, resolveDatabase, updateDatabase, type CollationRemedy, type DatabaseChanges, type NewDatabase } from '../api'
import CollationRefreshDialog from '../CollationRefreshDialog'

type Preview = { sql: string | null; error: string | null } | null

/**
 * The database's "Operations" page, laid out like phpMyAdmin's database/operations/index.twig:
 * one card per operation (comment, create table, rename, remove, copy), then the properties
 * ALTER DATABASE can change as a form card where phpMyAdmin has its Collation card, and the
 * encoding and collations, which PostgreSQL fixes at creation, as text. Each form runs its
 * statements through the database node and can show them first with Preview SQL.
 */
export default function Operations() {
  const { t } = useTranslation('databases')
  const { t: tApp } = useTranslation()
  const db = useParams().db ?? ''
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(() => resolveDatabase(db).then((did) => databaseProperties(did).then((properties) => ({ did, properties }))), [db])
  const { data: options } = useRequest(() => databaseOptions(), [])
  const { data: schemas } = useRequest(() => listSchemas(db), [db])
  const [preview, setPreview] = useState<Preview>(null)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const [force, setForce] = useState(false)
  /** A copy the server turned down for the source's collation version, waiting for the user's say. */
  const [refreshCopy, setRefreshCopy] = useState<{ data: NewDatabase; remedy: CollationRemedy } | null>(null)

  const [comment, setComment] = useState('')
  const [tableName, setTableName] = useState('')
  const [tableSchema, setTableSchema] = useState('public')
  const [tableColumns, setTableColumns] = useState(4)
  const [newName, setNewName] = useState(db)
  const [copyName, setCopyName] = useState(db)
  const [switchToCopy, setSwitchToCopy] = useState(false)
  const [props, setProps] = useState<{ datowner: string; spcname: string; datconnlimit: string; datallowconn: boolean; is_template: boolean } | null>(null)

  useEffect(() => {
    if (!data) return
    const p = data.properties
    setComment(p.comments ?? '')
    setNewName(db)
    setCopyName(db)
    setProps({ datowner: p.datowner, spcname: p.spcname ?? '', datconnlimit: String(p.datconnlimit), datallowconn: p.datallowconn, is_template: p.is_template })
  }, [data, db])

  useEffect(() => {
    if (schemas && !schemas.some((s) => s.name === tableSchema)) setTableSchema(schemas[0]?.name ?? 'public')
  }, [schemas, tableSchema])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data || !props) return null

  const { did, properties } = data

  function showPreview(changes: DatabaseChanges | NewDatabase, forDid?: number) {
    setPreview({ sql: null, error: null })
    databaseModifiedSql(changes, forDid).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  async function alter(changes: DatabaseChanges, message: string, after?: () => void) {
    try {
      await updateDatabase(did, changes)
      notifySuccess(message)
      treeState.refresh()
      if (after) after()
      else reload()
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  /** The property changes the form holds, against what the database has now. */
  function propertyChanges(): DatabaseChanges {
    const changes: DatabaseChanges = {}
    if (props!.datowner !== properties.datowner) changes.datowner = props!.datowner
    if (props!.spcname !== (properties.spcname ?? '') && props!.spcname !== '') changes.spcname = props!.spcname
    if (props!.datconnlimit !== String(properties.datconnlimit)) changes.datconnlimit = Number(props!.datconnlimit)
    if (props!.datallowconn !== properties.datallowconn) changes.datallowconn = props!.datallowconn
    if (props!.is_template !== properties.is_template) changes.is_template = props!.is_template

    return changes
  }

  function submitComment(e: FormEvent) {
    e.preventDefault()
    if (comment === (properties.comments ?? '')) {
      notify(tApp('nothing_to_change'))

      return
    }
    void alter({ comments: comment }, tApp('query_executed'))
  }

  function submitCreateTable(e: FormEvent) {
    e.preventDefault()
    navigate(`${urls.schema(db, tableSchema)}/create-table?${new URLSearchParams({ name: tableName, columns: String(tableColumns) })}`)
  }

  function submitRename(e: FormEvent) {
    e.preventDefault()
    if (newName === db) {
      notify(tApp('nothing_to_change'))

      return
    }
    void alter({ name: newName }, t('operations.renamed', { name: db, newName }), () => navigate(`${urls.database(newName)}/operations`))
  }

  async function copy(data: NewDatabase) {
    try {
      await createDatabase(data)
      notifySuccess(t('operations.copied', { name: db, newName: data.name }))
      treeState.refresh()
      if (switchToCopy) navigate(`${urls.database(data.name)}/operations`)
    } catch (err) {
      const remedy = collationRemedy(err)
      if (remedy) setRefreshCopy({ data, remedy })
      else notifyError(errorMessage(err))
    }
  }

  function submitCopy(e: FormEvent) {
    e.preventDefault()
    void copy({ name: copyName, template: db })
  }

  /** The source's stale collation version stopped the copy; run the refresh and copy again. */
  function refreshAndCopy() {
    const pending = refreshCopy
    setRefreshCopy(null)
    if (pending) void copy({ ...pending.data, refresh_collation: true })
  }

  function submitProperties(e: FormEvent) {
    e.preventDefault()
    const changes = propertyChanges()
    if (Object.keys(changes).length === 0) {
      notify(tApp('nothing_to_change'))

      return
    }
    void alter(changes, t('operations.saved'))
  }

  async function drop() {
    setConfirmDrop(false)
    try {
      await dropDatabase(did, force)
      notifySuccess(t('operations.dropped', { name: db }))
      treeState.refresh()
      navigate('/server/databases')
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  const previewButton = (changes: () => DatabaseChanges | NewDatabase, forDid?: number) => (
    <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={() => showPreview(changes(), forDid)} />
  )

  return (
    <div className="container-fluid">
      <form id="formDatabaseComment" onSubmit={submitComment}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_comment" /> {t('operations.comment')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="databaseCommentInput">
                  {t('operations.comment')}
                </label>
                <input className="form-control textfield" id="databaseCommentInput" type="text" name="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(() => ({ comments: comment }), did)}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <form id="createTableMinimalForm" className="card mb-2" onSubmit={submitCreateTable}>
        <div className="card-header">
          <Icon name="b_table_add" /> {t('operations.create_table')}
        </div>
        <div className="card-body row row-cols-lg-auto g-3">
          <div className="col-md-6">
            <label htmlFor="createTableSchemaSelect" className="form-label">
              {t('operations.schema')}
            </label>
            <select className="form-select" id="createTableSchemaSelect" value={tableSchema} onChange={(e) => setTableSchema(e.target.value)}>
              {(schemas ?? []).map((schema) => (
                <option key={schema.oid} value={schema.name}>
                  {schema.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-6">
            <label htmlFor="createTableNameInput" className="form-label">
              {t('operations.table_name')}
            </label>
            <input type="text" className="form-control" id="createTableNameInput" maxLength={63} value={tableName} onChange={(e) => setTableName(e.target.value)} required />
          </div>
          <div className="col-md-6">
            <label htmlFor="createTableNumFieldsInput" className="form-label">
              {t('operations.number_of_columns')}
            </label>
            <input type="number" className="form-control" id="createTableNumFieldsInput" min={1} value={tableColumns} onChange={(e) => setTableColumns(Math.max(1, Number(e.target.value) || 1))} required />
          </div>
        </div>
        <div className="card-footer text-end">
          <input className="btn btn-primary" type="submit" value={t('operations.create')} />
        </div>
      </form>

      <form id="rename_db_form" onSubmit={submitRename}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_edit" /> {t('operations.rename')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="new_db_name">
                  {t('operations.new_name')}
                </label>
                <input className="form-control textfield" id="new_db_name" type="text" name="newname" maxLength={63} value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(() => ({ name: newName }), did)}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <div className="card mb-2">
        <div className="card-header">
          <Icon name="b_deltbl" /> {t('operations.remove')}
        </div>
        <div className="card-body">
          <div className="card-text">
            <a
              id="drop_db_anchor"
              className="text-danger"
              href="#drop"
              onClick={(e) => {
                e.preventDefault()
                setForce(false)
                setConfirmDrop(true)
              }}
            >
              {t('operations.drop')}
            </a>
          </div>
        </div>
      </div>

      <form id="copy_db_form" onSubmit={submitCopy}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_edit" /> {t('operations.copy')}
          </div>
          <div className="card-body">
            <div className="mb-3 row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="copyDbNameInput">
                  {t('operations.copy_name')}
                </label>
                <input className="form-control textfield" id="copyDbNameInput" type="text" name="newname" maxLength={63} value={copyName} onChange={(e) => setCopyName(e.target.value)} required />
              </div>
            </div>

            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="checkbox_switch" checked={switchToCopy} onChange={(e) => setSwitchToCopy(e.target.checked)} />
              <label className="form-check-label" htmlFor="checkbox_switch">
                {t('operations.switch_to_new')}
              </label>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(() => ({ name: copyName, template: db }))}
            <input className="btn btn-primary" type="submit" name="submit_copy" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <form id="db_properties_form" onSubmit={submitProperties}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="s_db" /> {t('operations.properties')}
          </div>
          <div className="card-body">
            <div className="mb-3 row row-cols-lg-auto g-3">
              <div className="col-md-6">
                <label htmlFor="dbOwnerSelect" className="form-label">
                  {t('operations.fields.owner')}
                </label>
                <select className="form-select" id="dbOwnerSelect" value={props.datowner} onChange={(e) => setProps({ ...props, datowner: e.target.value })}>
                  {[...new Set([properties.datowner, ...(options?.roles ?? [])])].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-6">
                <label htmlFor="dbTablespaceSelect" className="form-label">
                  {t('operations.fields.tablespace')}
                </label>
                <select className="form-select" id="dbTablespaceSelect" value={props.spcname} onChange={(e) => setProps({ ...props, spcname: e.target.value })}>
                  {[...new Set([properties.spcname ?? '', ...(options?.tablespaces ?? [])])].map((space) => (
                    <option key={space} value={space}>
                      {space}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-md-6">
                <label htmlFor="dbConnLimitInput" className="form-label">
                  {t('operations.fields.connection_limit')}
                </label>
                <input type="number" className="form-control" id="dbConnLimitInput" min={-1} value={props.datconnlimit} onChange={(e) => setProps({ ...props, datconnlimit: e.target.value })} required />
              </div>
            </div>

            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="checkbox_allow_connections" checked={props.datallowconn} onChange={(e) => setProps({ ...props, datallowconn: e.target.checked })} />
              <label className="form-check-label" htmlFor="checkbox_allow_connections">
                {t('operations.fields.allow_connections')}
              </label>
            </div>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="checkbox_is_template" checked={props.is_template} onChange={(e) => setProps({ ...props, is_template: e.target.checked })} />
              <label className="form-check-label" htmlFor="checkbox_is_template">
                {t('operations.fields.template')}
              </label>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(() => propertyChanges(), did)}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <div className="card mb-2">
        <div className="card-header">
          <Icon name="s_asci" /> {t('operations.fields.collation')}
        </div>
        <div className="card-body">
          <div className="card-text">
            <div>
              {t('operations.fields.encoding')}: <span dir="ltr">{properties.encoding}</span>
            </div>
            <div>
              {t('operations.fields.collation')}: <span dir="ltr">{properties.datcollate}</span>
            </div>
            <div>
              {t('operations.fields.ctype')}: <span dir="ltr">{properties.datctype}</span>
            </div>
          </div>
        </div>
      </div>

      <MaintenanceCard target={{ database: db }} />

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />

      <CollationRefreshDialog remedy={refreshCopy?.remedy ?? null} onConfirm={refreshAndCopy} onClose={() => setRefreshCopy(null)} />

      <ConfirmQuery
        show={confirmDrop}
        warning={t('drop.warning')}
        sql={`DROP DATABASE ${quoteIdent(db)}${force ? ' WITH (FORCE)' : ''};`}
        confirmLabel={tApp('drop')}
        confirmClass="btn-danger"
        onClose={() => setConfirmDrop(false)}
        onConfirm={() => void drop()}
      >
        <div className="form-check mt-3">
          <input className="form-check-input" type="checkbox" id="dropDatabaseForce" checked={force} onChange={(e) => setForce(e.target.checked)} />
          <label className="form-check-label" htmlFor="dropDatabaseForce">
            {t('drop.force')}
          </label>
        </div>
      </ConfirmQuery>
    </div>
  )
}
