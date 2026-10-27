import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls, useLevel } from '@/level'
import { qualifiedName } from '@sql/js/sql'
import { dropView, refreshMaterializedView, resolveView, updateView, viewModifiedSql, viewOptions, viewsOf, type AnyViewData, type MaterializedView, type MaterializedViewData, type View, type ViewData, type ViewKind } from '../api'

type Preview = { sql: string | null; error: string | null } | null

const CHECK_OPTIONS = ['', 'CASCADED', 'LOCAL'] as const

/**
 * A view's "Operations" page, after phpMyAdmin's table/operations/view.twig (rename, drop) laid
 * out like the table's: the cards to move the view (schema.name), its options (rename, comment,
 * owner, and the WITH CHECK OPTION and security barrier of a view, the tablespace and
 * fillfactor of a materialized one), a materialized view's refresh and maintenance, and
 * "Delete the view (DROP)".
 */
export default function ViewOperations() {
  const { t } = useTranslation('views')
  const { t: tTables } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', view: name = '' } = useParams()
  const kind: ViewKind = useLevel().kind === 'mview' ? 'mview' : 'view'
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(async () => {
    const { scid, vid } = await resolveView(db, schema, name, kind)
    const [properties, options] = await Promise.all([viewsOf(db, scid, kind).properties(vid), viewOptions(db, scid)])

    return { scid, vid, properties, options }
  }, [db, schema, name, kind])
  const [preview, setPreview] = useState<Preview>(null)
  const [confirm, setConfirm] = useState<{ sql: string; warning?: string; run: () => Promise<void>; cascadeBox?: boolean } | null>(null)
  const [cascade, setCascade] = useState(false)

  const [moveSchema, setMoveSchema] = useState(schema)
  const [moveName, setMoveName] = useState(name)
  const [newName, setNewName] = useState(name)
  const [comment, setComment] = useState('')
  const [owner, setOwner] = useState('')
  const [checkOption, setCheckOption] = useState('')
  const [securityBarrier, setSecurityBarrier] = useState(false)
  const [tablespace, setTablespace] = useState('')
  const [fillfactor, setFillfactor] = useState('')
  const [refresh, setRefresh] = useState({ concurrent: false, with_data: true })

  useEffect(() => {
    if (!data) return
    const p = data.properties
    setMoveSchema(schema)
    setMoveName(name)
    setNewName(name)
    setComment(p.comment ?? '')
    setOwner(p.owner)
    if (kind === 'view') {
      setCheckOption(((p as View).check_option ?? '').toUpperCase())
      setSecurityBarrier(Boolean((p as View).security_barrier))
    } else {
      setTablespace((p as MaterializedView).spcname ?? '')
      setFillfactor((p as MaterializedView).fillfactor ?? '')
    }
  }, [data, schema, name, kind])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, vid, properties, options } = data
  const href = urls.relation(db, schema, name, kind)
  const relation = qualifiedName(schema, name)
  const keyword = kind === 'mview' ? 'MATERIALIZED VIEW' : 'VIEW'
  const sqlPage = (sql: string) => `${href}/sql?${new URLSearchParams({ sql, run: '1' })}`

  function showPreview(changes: AnyViewData) {
    setPreview({ sql: null, error: null })
    viewModifiedSql(db, scid, kind, changes, vid).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  async function alter(changes: AnyViewData, message: string, after?: () => void) {
    try {
      await updateView(db, scid, vid, kind, changes)
      notifySuccess(message)
      treeState.refresh()
      if (after) after()
      else reload()
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  function moveChanges(): AnyViewData {
    const changes: AnyViewData = {}
    if (moveSchema !== schema) changes.schema = moveSchema
    if (moveName !== name) changes.name = moveName

    return changes
  }

  function optionChanges(): AnyViewData {
    const changes: ViewData & MaterializedViewData = {}
    if (newName !== name) changes.name = newName
    if (comment !== (properties.comment ?? '')) changes.comment = comment
    if (owner !== properties.owner) changes.owner = owner
    if (kind === 'view') {
      const p = properties as View
      if (checkOption !== (p.check_option ?? '').toUpperCase()) changes.check_option = checkOption === '' ? 'no' : checkOption.toLowerCase()
      if (securityBarrier !== Boolean(p.security_barrier)) changes.security_barrier = securityBarrier
    } else {
      const p = properties as MaterializedView
      if (tablespace !== (p.spcname ?? '') && tablespace !== '') changes.spcname = tablespace
      if (fillfactor !== (p.fillfactor ?? '')) changes.fillfactor = fillfactor
    }

    return changes
  }

  function submitMove(e: FormEvent) {
    e.preventDefault()
    const changes = moveChanges()
    if (Object.keys(changes).length === 0) return notify(tApp('nothing_to_change'))
    void alter(changes, t('operations.moved', { view: relation, target: qualifiedName(moveSchema, moveName) }), () => navigate(`${urls.relation(db, moveSchema, moveName, kind)}/operations`))
  }

  function submitOptions(e: FormEvent) {
    e.preventDefault()
    const changes = optionChanges()
    if (Object.keys(changes).length === 0) return notify(tApp('nothing_to_change'))
    void alter(changes, tApp('query_executed'), changes.name ? () => navigate(`${urls.relation(db, schema, changes.name!, kind)}/operations`) : undefined)
  }

  async function submitRefresh(e: FormEvent) {
    e.preventDefault()
    try {
      const sql = await refreshMaterializedView(db, scid, vid, refresh)
      notifySuccess(t('operations.refreshed', { sql }))
      reload()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  function askDrop() {
    setCascade(false)
    setConfirm({
      sql: `DROP ${keyword} ${relation}`,
      warning: t('operations.drop_warning'),
      cascadeBox: true,
      run: async () => {
        try {
          await dropView(db, scid, vid, kind, cascadeRef.current)
          notifySuccess(t('operations.dropped', { view: name }))
          treeState.refresh()
          navigate(urls.schema(db, schema))
        } catch (e) {
          notifyError(errorMessage(e))
        }
      },
    })
  }

  cascadeRef.current = cascade

  const previewButton = (changes: () => AnyViewData) => <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={() => showPreview(changes())} />

  return (
    <div className="container-fluid">
      <form id="moveTableForm" onSubmit={submitMove}>
        <div className="card mb-2">
          <div className="card-header">{t('operations.move')}</div>
          <div className="card-body">
            <div className="mb-3 row g-3">
              <div className="col-auto">
                <div className="input-group">
                  <select id="moveTableDatabaseInput" className="form-select" name="target_db" aria-label={tTables('operations.schema')} value={moveSchema} onChange={(e) => setMoveSchema(e.target.value)}>
                    {[...new Set([schema, ...options.schemas])].map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <span className="input-group-text">.</span>
                  <input className="form-control" type="text" required name="new_name" maxLength={63} value={moveName} onChange={(e) => setMoveName(e.target.value)} aria-label={t('operations.view')} />
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
          <div className="card-header">{t('operations.title')}</div>
          <div className="card-body">
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label htmlFor="newNameInput">{t('operations.rename')}</label>
              </div>
              <div className="col-6">
                <input id="newNameInput" className="form-control" type="text" name="new_name" maxLength={63} value={newName} onChange={(e) => setNewName(e.target.value)} onFocus={(e) => e.target.select()} required />
              </div>
            </div>
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label htmlFor="viewCommentsInput">{t('operations.comment')}</label>
              </div>
              <div className="col-6">
                <input className="form-control" id="viewCommentsInput" type="text" name="comment" maxLength={2048} value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
            </div>
            <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
              <div className="col-6">
                <label className="text-nowrap" htmlFor="viewOwnerSelect">
                  {tTables('operations.owner')}
                </label>
              </div>
              <div className="col-6">
                <select className="form-select" name="owner" id="viewOwnerSelect" value={owner} onChange={(e) => setOwner(e.target.value)}>
                  {[...new Set([properties.owner, ...options.roles])].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {kind === 'view' && (
              <>
                <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
                  <div className="col-6">
                    <label htmlFor="viewCheckOption">WITH CHECK OPTION</label>
                  </div>
                  <div className="col-6">
                    <select className="form-select" id="viewCheckOption" name="check_option" value={checkOption} onChange={(e) => setCheckOption(e.target.value)}>
                      {CHECK_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
                  <div className="col-6">
                    <div className="form-check">
                      <input className="form-check-input" type="checkbox" id="viewSecurityBarrier" checked={securityBarrier} onChange={(e) => setSecurityBarrier(e.target.checked)} />
                      <label className="form-check-label" htmlFor="viewSecurityBarrier">
                        {t('form.security_barrier')}
                      </label>
                    </div>
                  </div>
                </div>
              </>
            )}
            {kind === 'mview' && (
              <>
                <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
                  <div className="col-6">
                    <label htmlFor="tablespaceSelect">{tTables('operations.tablespace')}</label>
                  </div>
                  <div className="col-6">
                    <select className="form-select" id="tablespaceSelect" lang="en" dir="ltr" name="spcname" value={tablespace} onChange={(e) => setTablespace(e.target.value)}>
                      {[...new Set([(properties as MaterializedView).spcname ?? '', ...options.tablespaces])].map((space) => (
                        <option key={space} value={space}>
                          {space}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mb-3 row row-cols-lg-auto g-3 align-items-center">
                  <div className="col-6">
                    <label htmlFor="fillfactorInput">{t('operations.fillfactor')}</label>
                  </div>
                  <div className="col-6">
                    <input className="form-control" id="fillfactorInput" type="number" min={10} max={100} name="fillfactor" value={fillfactor} onChange={(e) => setFillfactor(e.target.value)} />
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="card-footer text-end">
            {previewButton(optionChanges)}
            <input className="btn btn-primary" type="submit" value={tApp('go')} />
          </div>
        </div>
      </form>

      {kind === 'mview' && (
        <>
          <form id="refreshForm" onSubmit={submitRefresh}>
            <div className="card mb-2">
              <div className="card-header">{t('operations.refresh')}</div>
              <div className="card-body">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="refreshConcurrently" checked={refresh.concurrent} onChange={(e) => setRefresh({ ...refresh, concurrent: e.target.checked })} />
                  <label className="form-check-label" htmlFor="refreshConcurrently">
                    {t('operations.concurrently')}
                  </label>
                </div>
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="refreshWithData" checked={refresh.with_data} onChange={(e) => setRefresh({ ...refresh, with_data: e.target.checked })} />
                  <label className="form-check-label" htmlFor="refreshWithData">
                    {t('operations.with_data')}
                  </label>
                </div>
              </div>
              <div className="card-footer text-end">
                <input className="btn btn-primary" type="submit" value={tApp('go')} />
              </div>
            </div>
          </form>

          <div className="card mb-2">
            <div className="card-header">{tTables('operations.maintenance')}</div>
            <ul className="list-group list-group-flush" id="tbl_maintenance">
              <li className="list-group-item">
                <Link to={sqlPage(`ANALYZE ${relation}`)}>{tTables('operations.analyze')}</Link>
              </li>
              <li className="list-group-item">
                <Link className="maintain_action" to={sqlPage(`VACUUM ${relation}`)}>
                  {tTables('operations.vacuum')}
                </Link>
              </li>
              <li className="list-group-item">
                <Link className="maintain_action" to={sqlPage(`VACUUM (ANALYZE) ${relation}`)}>
                  {tTables('operations.vacuum_analyze')}
                </Link>
              </li>
              <li className="list-group-item">
                <Link className="maintain_action" to={sqlPage(`REINDEX TABLE ${relation}`)}>
                  {tTables('operations.reindex')}
                </Link>
              </li>
            </ul>
          </div>
        </>
      )}

      <div className="card mb-2">
        <div className="card-header">{tTables('operations.delete')}</div>
        <div className="card-body">
          <div className="card-text">
            <a id="drop_view_anchor" className="text-danger" href="#drop" onClick={(e) => { e.preventDefault(); askDrop() }}>
              {kind === 'mview' ? t('operations.drop_mview') : t('operations.drop')}
            </a>
          </div>
        </div>
      </div>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />

      <ConfirmQuery
        show={confirm !== null}
        sql={confirm ? `${confirm.sql}${cascade ? ' CASCADE' : ''};` : ''}
        warning={confirm?.warning}
        confirmLabel={tApp('ok')}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm
          setConfirm(null)
          if (pending) void pending.run()
        }}
      >
        {confirm?.cascadeBox && (
          <div className="form-check mt-2">
            <input className="form-check-input" type="checkbox" id="confirm_cascade" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
            <label className="form-check-label" htmlFor="confirm_cascade">
              {t('operations.cascade')}
            </label>
          </div>
        )}
      </ConfirmQuery>
    </div>
  )
}

/** The CASCADE box as last rendered, for the pending drop to read. */
const cascadeRef: { current: boolean } = { current: false }
