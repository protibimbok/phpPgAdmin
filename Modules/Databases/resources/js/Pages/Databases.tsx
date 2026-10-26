import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { formatSize } from '@/format'
import { urls } from '@/level'
import { quoteIdent } from '@sql/js/sql'
import { collationRemedy, createDatabase, databaseOptions, dropDatabase, listDatabases, type CollationRemedy, type Database, type NewDatabase } from '../api'
import CollationRefreshDialog from '../CollationRefreshDialog'

/**
 * The server's databases, laid out like phpMyAdmin's "Databases" tab (server/databases/
 * index.twig): the heading, the "Create database" card, the check-all and Drop bar with the
 * search box, a striped table with a checkbox per row and the action links, the total
 * underneath. What is listed comes from pg_database, as in pgAdmin; a drop asks first, with
 * phpMyAdmin's warning, and runs DROP DATABASE for each checked database.
 */
export default function Databases() {
  const { t } = useTranslation('databases')
  const { t: tApp } = useTranslation()
  const { data: databases, error, reload } = useRequest(() => listDatabases(), [])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [dropping, setDropping] = useState<Database[] | null>(null)
  const [force, setForce] = useState(false)

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()

    return (databases ?? []).filter((database) => needle === '' || database.name.toLowerCase().includes(needle))
  }, [databases, filter])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (databases === undefined) {
    return null
  }

  const allChecked = visible.length > 0 && visible.every((database) => checked.has(database.did))

  function toggleAll(value: boolean) {
    setChecked(value ? new Set(visible.filter((database) => database.can_drop).map((database) => database.did)) : new Set())
  }

  function toggle(did: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(did)
      else next.delete(did)

      return next
    })
  }

  function askDrop(selected: Database[] = databases!.filter((database) => checked.has(database.did))) {
    if (selected.length === 0) {
      notify(t('drop.none_selected'), 'error')

      return
    }
    setForce(false)
    setDropping(selected)
  }

  async function drop(selected: Database[]) {
    setDropping(null)
    notify(tApp('processing_request'), 'notice', null)
    let dropped = 0
    try {
      for (const database of selected) {
        await dropDatabase(database.did, force)
        dropped++
      }
      notifySuccess(t('drop.dropped', { count: dropped }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setChecked(new Set())
      reload()
      treeState.refresh()
    }
  }

  return (
    <div className="container-fluid my-3" id="databases">
      <h2>
        <Icon name="s_db" /> {t('title')}
      </h2>

      <CreateDatabaseCard
        onCreated={() => {
          reload()
          treeState.refresh()
        }}
      />

      <div className="d-flex flex-wrap my-3">
        <div>
          <div className="input-group">
            <div className="input-group-text">
              <div className="form-check mb-0">
                <input className="form-check-input checkall_box" type="checkbox" id="checkAllCheckbox" checked={allChecked} onChange={(e) => toggleAll(e.target.checked)} />
                <label className="form-check-label" htmlFor="checkAllCheckbox">
                  {tApp('check_all')}
                </label>
              </div>
            </div>
            <button className="btn btn-outline-secondary" id="bulkActionDropButton" type="button" title={t('actions.drop')} onClick={() => askDrop()}>
              <Icon name="db_drop" /> {t('actions.drop')}
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

      <form id="dbStatsForm" onSubmit={(e) => e.preventDefault()}>
        <div className="table-responsive">
          <table className="table table-striped table-hover w-auto">
            <thead>
              <tr>
                <th />
                <th>{t('columns.database')}</th>
                <th>{t('columns.owner')}</th>
                <th>{t('columns.encoding')}</th>
                <th>{t('columns.collation')}</th>
                <th className="text-end">{t('columns.size')}</th>
                <th>{t('columns.comment')}</th>
                <th colSpan={1}>{t('columns.action')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((database) => (
                <tr key={database.did} className={database.datallowconn ? undefined : 'text-muted'}>
                  <td className="tool">
                    <input
                      type="checkbox"
                      name="selected_dbs[]"
                      className="checkall"
                      title={database.name}
                      value={database.name}
                      checked={checked.has(database.did)}
                      disabled={!database.can_drop}
                      onChange={(e) => toggle(database.did, e.target.checked)}
                    />
                  </td>
                  <td className="name">
                    {database.datallowconn ? <Link to={urls.database(database.name)}>{database.name}</Link> : database.name}
                    {database.is_template && <span className="badge bg-secondary ms-2">{t('template')}</span>}
                  </td>
                  <td>{database.datowner}</td>
                  <td>
                    <span lang="en" dir="ltr">
                      {database.encoding}
                    </span>
                  </td>
                  <td>
                    <span lang="en" dir="ltr">
                      {database.datcollate}
                    </span>
                  </td>
                  <td className="text-end text-nowrap">
                    {database.size === null ? (
                      <span title={t('no_connect')}>–</span>
                    ) : (
                      formatSize(database.size)
                    )}
                  </td>
                  <td>{database.comments}</td>
                  <td className="tool text-nowrap">
                    {database.datallowconn && (
                      <Link to={`${urls.database(database.name)}/ddl`}>
                        <Icon name="b_sql" title={t('actions.sql')} /> {t('actions.sql')}
                      </Link>
                    )}
                    {database.datallowconn && database.can_drop && ' '}
                    {database.can_drop && (
                      <a href="#" className="drop_db_anchor" onClick={(e) => {
                        e.preventDefault()
                        askDrop([database])
                      }}>
                        <Icon name="b_drop" title={t('actions.drop')} /> {t('actions.drop')}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="fw-bold">{t('total', { count: visible.length })}</div>
      </form>

      <ConfirmQuery
        show={dropping !== null}
        warning={t('drop.warning')}
        sql={(dropping ?? []).map((database) => `DROP DATABASE ${quoteIdent(database.name)}${force ? ' WITH (FORCE)' : ''};`)}
        confirmLabel={tApp('drop')}
        confirmClass="btn-danger"
        onClose={() => setDropping(null)}
        onConfirm={() => dropping && void drop(dropping)}
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

/**
 * phpMyAdmin's "Create database" card: the name, a select or two and Create in one row; here
 * the template, owner and encoding where phpMyAdmin has the collation.
 */
function CreateDatabaseCard({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation('databases')
  const { data: options } = useRequest(() => databaseOptions(), [])
  const [name, setName] = useState('')
  const [template, setTemplate] = useState('')
  const [owner, setOwner] = useState('')
  const [encoding, setEncoding] = useState('')
  const [busy, setBusy] = useState(false)
  /** A create the server turned down for the template's collation version, waiting for the user's say. */
  const [refresh, setRefresh] = useState<{ data: NewDatabase; remedy: CollationRemedy } | null>(null)

  async function create(data: NewDatabase) {
    setBusy(true)
    try {
      await createDatabase(data)
      notifySuccess(t('create.created', { name: data.name }))
      setName('')
      onCreated()
    } catch (err) {
      const remedy = collationRemedy(err)
      if (remedy) setRefresh({ data, remedy })
      else notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    void create({ name, template: template || undefined, datowner: owner || undefined, encoding: encoding || undefined })
  }

  function refreshAndCreate() {
    const pending = refresh
    setRefresh(null)
    if (pending) void create({ ...pending.data, refresh_collation: true })
  }

  return (
    <div className="card">
      <div className="card-header">
        <Icon name="b_newdb" /> {t('create.title')}
      </div>
      <div className="card-body">
        <form id="create_database_form" className="row row-cols-md-auto g-3 align-items-center" onSubmit={submit}>
          <div className="col-12">
            <input autoComplete="off" type="text" name="new_db" maxLength={63} className="form-control" id="text_create_db" placeholder={t('create.name')} aria-label={t('create.name')} value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="col-12">
            <select lang="en" dir="ltr" name="template" className="form-select" aria-label={t('create.template')} value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">{t('create.template')}</option>
              <option value="" />
              {(options?.templates ?? []).map((database) => (
                <option key={database} value={database}>
                  {database}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <select name="datowner" className="form-select" aria-label={t('create.owner')} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">{t('create.owner')}</option>
              <option value="" />
              {(options?.roles ?? []).map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <select lang="en" dir="ltr" name="encoding" className="form-select" aria-label={t('create.encoding')} value={encoding} onChange={(e) => setEncoding(e.target.value)}>
              <option value="">{t('create.encoding')}</option>
              <option value="" />
              {(options?.encodings ?? []).map((enc) => (
                <option key={enc} value={enc}>
                  {enc}
                </option>
              ))}
            </select>
          </div>
          <div className="col-12">
            <input id="buttonGo" className="btn btn-primary" type="submit" value={t('create.create')} disabled={busy} />
          </div>
        </form>
      </div>
      <CollationRefreshDialog remedy={refresh?.remedy ?? null} onConfirm={refreshAndCreate} onClose={() => setRefresh(null)} />
    </div>
  )
}
