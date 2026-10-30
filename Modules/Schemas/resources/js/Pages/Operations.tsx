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
import MaintenanceCard from '@maintenance/js/MaintenanceCard'
import SecurityLabelsCard from '@/components/SecurityLabelsCard'
import { quoteIdent } from '@sql/js/sql'
import { dropSchema, resolveSchema, schemaModifiedSql, schemaOptions, schemaProperties, updateSchema, type SchemaData } from '../api'

type Preview = { sql: string | null; error: string | null } | null

/**
 * A schema's "Operations" page, laid out like phpMyAdmin's database operations: a card for the
 * comment, the rename, the removal (DROP, or DROP … CASCADE) and the properties ALTER SCHEMA
 * changes (the owner), each running its statements through the schema node, with Preview SQL.
 */
export default function Operations() {
  const { t } = useTranslation('schemas')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '' } = useParams()
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(() => resolveSchema(db, schema).then((scid) => schemaProperties(db, scid).then((properties) => ({ scid, properties }))), [db, schema])
  const { data: options } = useRequest(() => schemaOptions(db), [db])
  const [preview, setPreview] = useState<Preview>(null)
  const [confirm, setConfirm] = useState<{ cascade: boolean } | null>(null)
  const [comment, setComment] = useState('')
  const [newName, setNewName] = useState(schema)
  const [owner, setOwner] = useState('')

  useEffect(() => {
    if (!data) return
    setComment(data.properties.description ?? '')
    setNewName(schema)
    setOwner(data.properties.namespaceowner)
  }, [data, schema])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, properties } = data

  function showPreview(changes: SchemaData) {
    setPreview({ sql: null, error: null })
    schemaModifiedSql(db, changes, scid).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  async function alter(changes: SchemaData, message: string, after?: () => void) {
    try {
      await updateSchema(db, scid, changes)
      notifySuccess(message)
      treeState.refresh()
      if (after) after()
      else reload()
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  function submitComment(e: FormEvent) {
    e.preventDefault()
    if (comment === (properties.description ?? '')) {
      notify(tApp('nothing_to_change'))

      return
    }
    void alter({ description: comment }, tApp('query_executed'))
  }

  function submitRename(e: FormEvent) {
    e.preventDefault()
    if (newName === schema) {
      notify(tApp('nothing_to_change'))

      return
    }
    void alter({ name: newName }, t('operations.renamed', { name: schema, newName }), () => navigate(`${urls.schema(db, newName)}/operations`))
  }

  function submitProperties(e: FormEvent) {
    e.preventDefault()
    if (owner === properties.namespaceowner) {
      notify(tApp('nothing_to_change'))

      return
    }
    void alter({ namespaceowner: owner }, t('operations.saved'))
  }

  async function drop(cascade: boolean) {
    setConfirm(null)
    try {
      await dropSchema(db, scid, cascade)
      notifySuccess(t('drop.dropped', { name: schema }))
      treeState.refresh()
      navigate(urls.database(db))
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  const previewButton = (changes: () => SchemaData) => (
    <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={() => showPreview(changes())} />
  )

  return (
    <div className="container-fluid">
      <form id="formSchemaComment" onSubmit={submitComment}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_comment" /> {t('operations.comment')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="schemaCommentInput">
                  {t('operations.comment')}
                </label>
                <input className="form-control textfield" id="schemaCommentInput" type="text" name="comment" value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(() => ({ description: comment }))}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <form id="rename_schema_form" onSubmit={submitRename}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_edit" /> {t('operations.rename')}
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-auto">
                <label className="visually-hidden" htmlFor="new_schema_name">
                  {t('operations.new_name')}
                </label>
                <input className="form-control textfield" id="new_schema_name" type="text" name="newname" maxLength={63} value={newName} onChange={(e) => setNewName(e.target.value)} required />
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(() => ({ name: newName }))}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <div className="card mb-2">
        <div className="card-header">
          <Icon name="b_deltbl" /> {t('operations.remove')}
        </div>
        <ul className="list-group list-group-flush">
          <li className="list-group-item">
            <a id="drop_schema_anchor" className="text-danger" href="#drop" onClick={(e) => { e.preventDefault(); setConfirm({ cascade: false }) }}>
              {t('operations.drop')}
            </a>
          </li>
          <li className="list-group-item">
            <a id="drop_schema_cascade_anchor" className="text-danger" href="#drop-cascade" onClick={(e) => { e.preventDefault(); setConfirm({ cascade: true }) }}>
              {t('operations.drop_cascade')}
            </a>
          </li>
        </ul>
      </div>

      <form id="schema_properties_form" onSubmit={submitProperties}>
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_props" /> {t('operations.properties')}
          </div>
          <div className="card-body">
            <div className="row row-cols-lg-auto g-3">
              <div className="col-md-6">
                <label htmlFor="schemaOwnerSelect" className="form-label">
                  {t('operations.owner')}
                </label>
                <select className="form-select" id="schemaOwnerSelect" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  {[...new Set([properties.namespaceowner, ...(options?.roles ?? [])])].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="card-footer text-end">
            {previewButton(() => ({ namespaceowner: owner }))}
            <input className="btn btn-primary" type="submit" value={t('operations.go')} />
          </div>
        </div>
      </form>

      <MaintenanceCard target={{ database: db, schema }} />

      <SecurityLabelsCard key={data.scid} db={db} catalog="pg_namespace" oid={data.scid} />

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />

      <ConfirmQuery
        show={confirm !== null}
        sql={`DROP SCHEMA ${quoteIdent(schema)}${confirm?.cascade ? ' CASCADE' : ''};`}
        confirmLabel={tApp('drop')}
        confirmClass="btn-danger"
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && void drop(confirm.cascade)}
      />
    </div>
  )
}
