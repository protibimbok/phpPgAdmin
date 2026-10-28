import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import SqlView from '@/components/SqlView'
import { formatSize } from '@/format'
import { notify, notifyError, notifySuccess } from '@/notify'
import { quoteIdent } from '@sql/js/sql'
import { tablespaceOptions, tablespaces as tablespacesApi, type Tablespace, type TablespaceData } from '../api'

export const TABLESPACES_PATH = '/server/tablespaces'

export const tablespaceUrl = (name: string) => `${TABLESPACES_PATH}/${encodeURIComponent(name)}/edit`

/**
 * The server's tablespaces, laid out like phpMyAdmin's "Databases" tab: the heading, the
 * "Create tablespace" card, the check-all and Drop bar with the search box, a striped table
 * with a checkbox per row (none for pg_default and pg_global) and the Edit / Export / Drop
 * links, the total underneath. A drop asks first and runs DROP TABLESPACE for each one checked.
 */
export default function Tablespaces() {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const { data: tablespaces, error, reload } = useRequest(() => tablespacesApi.list(), [])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [dropping, setDropping] = useState<Tablespace[] | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()

    return (tablespaces ?? []).filter((tablespace) => needle === '' || tablespace.name.toLowerCase().includes(needle))
  }, [tablespaces, filter])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!tablespaces) return null

  const droppable = visible.filter((tablespace) => !tablespace.is_sys_obj)
  const allChecked = droppable.length > 0 && droppable.every((tablespace) => checked.has(tablespace.oid))

  function toggle(oid: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(oid)
      else next.delete(oid)

      return next
    })
  }

  function askDrop(selected: Tablespace[] = tablespaces!.filter((tablespace) => checked.has(tablespace.oid))) {
    if (selected.length === 0) return notify(t('tablespaces.none_selected'), 'error')
    setDropping(selected)
  }

  async function drop(selected: Tablespace[]) {
    setDropping(null)
    notify(tApp('processing_request'), 'notice', null)
    let dropped = 0
    try {
      for (const tablespace of selected) {
        await tablespacesApi.remove(tablespace.oid)
        dropped++
      }
      notifySuccess(t('tablespaces.dropped', { count: dropped }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setChecked(new Set())
      reload()
    }
  }

  function exportTablespace(tablespace: Tablespace) {
    setExported({ title: t('tablespaces.export_title', { name: tablespace.name }), sql: null })
    tablespacesApi.sql(tablespace.oid).then(
      (sql) => setExported((current) => (current ? { ...current, sql } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  return (
    <div className="container-fluid my-3" id="tablespaces">
      <h2>
        <Icon name="b_tblops" /> {t('tablespaces.title')}
      </h2>

      <CreateTablespaceCard onCreated={reload} />

      <div className="d-flex flex-wrap my-3">
        <div>
          <div className="input-group">
            <div className="input-group-text">
              <div className="form-check mb-0">
                <input className="form-check-input checkall_box" type="checkbox" id="checkAllCheckbox" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(droppable.map((tablespace) => tablespace.oid)) : new Set())} />
                <label className="form-check-label" htmlFor="checkAllCheckbox">
                  {tApp('check_all')}
                </label>
              </div>
            </div>
            <button className="btn btn-outline-secondary" id="bulkActionDropButton" type="button" title={tApp('drop')} onClick={() => askDrop()}>
              <Icon name="b_drop" /> {tApp('drop')}
            </button>
          </div>
        </div>

        <div className="ms-auto">
          <div className="input-group">
            <span className="input-group-text">
              <Icon name="b_search" title={tApp('search')} />
            </span>
            <input className="form-control" type="text" id="filterText" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tApp('search')} aria-label={tApp('search')} />
          </div>
        </div>
      </div>

      <form id="tablespacesForm" onSubmit={(e) => e.preventDefault()}>
        <div className="table-responsive">
          <table className="table table-striped table-hover w-auto">
            <thead>
              <tr>
                <th />
                <th>{t('tablespaces.columns.name')}</th>
                <th>{t('tablespaces.columns.owner')}</th>
                <th>{t('tablespaces.columns.location')}</th>
                <th className="text-end">{t('tablespaces.columns.size')}</th>
                <th>{t('tablespaces.columns.options')}</th>
                <th>{t('tablespaces.columns.privileges')}</th>
                <th>{t('tablespaces.columns.comment')}</th>
                <th colSpan={3}>{t('columns.action')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((tablespace) => (
                <tr key={tablespace.oid}>
                  <td className="tool">
                    <input type="checkbox" name="selected_tablespaces[]" className="checkall" title={tablespace.name} value={tablespace.name} checked={checked.has(tablespace.oid)} disabled={tablespace.is_sys_obj} onChange={(e) => toggle(tablespace.oid, e.target.checked)} />
                  </td>
                  <td className="name">
                    <Link to={tablespaceUrl(tablespace.name)}>{tablespace.name}</Link>
                  </td>
                  <td>{tablespace.spcuser}</td>
                  <td>
                    <span lang="en" dir="ltr">
                      {tablespace.spclocation || <em className="text-muted">{t('tablespaces.data_directory')}</em>}
                    </span>
                  </td>
                  <td className="text-end text-nowrap">{tablespace.size === null ? '–' : formatSize(tablespace.size)}</td>
                  <td>
                    <code>{tablespace.spcoptions.map((option) => `${option.name}=${option.value}`).join(', ')}</code>
                  </td>
                  <td>
                    <code>{tablespace.acl}</code>
                  </td>
                  <td>{tablespace.description}</td>
                  <td className="tool text-nowrap">
                    <Link to={tablespaceUrl(tablespace.name)}>
                      <Icon name="b_edit" /> {t('tablespaces.edit')}
                    </Link>
                  </td>
                  <td className="tool text-nowrap">
                    <a href="#export" onClick={(e) => { e.preventDefault(); exportTablespace(tablespace) }}>
                      <Icon name="b_tblexport" /> {t('actions.export')}
                    </a>
                  </td>
                  <td className="tool text-nowrap">
                    {!tablespace.is_sys_obj && (
                      <a href="#drop" className="drop_tablespace_anchor" onClick={(e) => { e.preventDefault(); askDrop([tablespace]) }}>
                        <Icon name="b_drop" /> {tApp('drop')}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="fw-bold">{t('tablespaces.total', { count: visible.length })}</div>
      </form>

      <ConfirmQuery
        show={dropping !== null}
        warning={t('tablespaces.drop_warning')}
        sql={(dropping ?? []).map((tablespace) => `DROP TABLESPACE ${quoteIdent(tablespace.name)};`)}
        confirmLabel={tApp('drop')}
        confirmClass="btn-danger"
        onClose={() => setDropping(null)}
        onConfirm={() => dropping && void drop(dropping)}
      />

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>
    </div>
  )
}

/**
 * The "Create tablespace" card in the layout of phpMyAdmin's "Create database" one: the name,
 * the directory (which must exist, be empty and belong to the server's operating-system
 * user), the owner, Preview SQL and Create in one row.
 */
function CreateTablespaceCard({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const { data: options } = useRequest(() => tablespaceOptions(), [])
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [owner, setOwner] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)

  const data = (): TablespaceData => ({ name, spclocation: location, spcuser: owner || undefined })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await tablespacesApi.create(data())
      notifySuccess(t('tablespaces.created', { name }))
      setName('')
      setLocation('')
      onCreated()
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    tablespacesApi.modifiedSql(data()).then(
      (sql) => setPreview({ sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  return (
    <div className="card">
      <div className="card-header">
        <Icon name="b_newdb" /> {t('tablespaces.create.title')}
      </div>
      <div className="card-body">
        <form id="create_tablespace_form" className="row row-cols-md-auto g-3 align-items-center" onSubmit={submit}>
          <div className="col-12">
            <input autoComplete="off" type="text" name="name" maxLength={63} className="form-control" id="text_create_tablespace" placeholder={t('tablespaces.create.name')} aria-label={t('tablespaces.create.name')} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="col-12">
            <input autoComplete="off" type="text" name="spclocation" className="form-control" id="text_create_location" lang="en" dir="ltr" placeholder={t('tablespaces.create.location')} aria-label={t('tablespaces.create.location')} title={t('tablespaces.create.location_hint')} value={location} onChange={(e) => setLocation(e.target.value)} required />
          </div>
          <div className="col-12">
            <select name="spcuser" className="form-select" aria-label={t('tablespaces.columns.owner')} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t('tablespaces.columns.owner')}</option>
              <option value="" />
              {(options?.roles ?? []).map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={showPreview} />
            <input id="buttonGo" className="btn btn-primary" type="submit" value={t('tablespaces.create.create')} disabled={busy} />
          </div>
        </form>
      </div>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </div>
  )
}
