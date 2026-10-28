import { useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { formatSize } from '@/format'
import { notify, notifyError, notifySuccess } from '@/notify'
import { quoteIdent } from '@sql/js/sql'
import { moveObjects, moveObjectsSql, objectPrivileges, resolveTablespace, tablespaceOptions, tablespaces, type MoveObjects, type TablespaceData, type TablespaceOptions } from '../api'
import { ObjectPrivilegesPanel } from './Privileges'
import { TABLESPACES_PATH, tablespaceUrl } from './Tablespaces'

type Preview = { sql: string | null; error: string | null }

/**
 * One tablespace's page, laid out like phpMyAdmin's operations pages, one card per form: the
 * name, owner and comment; the planner parameters it overrides; then its privileges as on the
 * other Privileges pages, pgAdmin's "Move objects", what is stored in it across the databases,
 * and the drop. Each form can show its statements first with Preview SQL.
 */
export default function EditTablespace() {
  const { t } = useTranslation('roles')
  const name = useParams().tablespace ?? ''
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(async () => {
    const tsid = await resolveTablespace(name)
    const [tablespace, options, privileges] = await Promise.all([tablespaces.properties(tsid), tablespaceOptions(), objectPrivileges(null, 'tablespace', tsid)])

    return { tsid, tablespace, options, privileges }
  }, [name])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmDrop, setConfirmDrop] = useState(false)

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { tsid, tablespace, options } = data

  async function save(changes: TablespaceData) {
    try {
      await tablespaces.update(tsid, changes)
      notifySuccess(t('tablespaces.altered', { name: changes.name ?? name }))
      if (changes.name && changes.name !== name) navigate(tablespaceUrl(changes.name))
      else reload()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  function showPreview(load: () => Promise<string>) {
    setPreview({ sql: null, error: null })
    load().then(
      (sql) => setPreview({ sql: sql === '' ? t('nothing_to_change') : sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  async function drop() {
    setConfirmDrop(false)
    try {
      await tablespaces.remove(tsid)
      notifySuccess(t('tablespaces.dropped', { count: 1 }))
      navigate(TABLESPACES_PATH)
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <div className="container-fluid my-3" id="edit_tablespace">
      <h2>
        <Icon name="b_tblops" /> {t('tablespaces.edit_title')} <em>{tablespace.name}</em>
      </h2>

      <PropertiesCard key={`properties-${tablespace.name}`} tablespace={tablespace} options={options} onSave={save} onPreview={(changes) => showPreview(() => tablespaces.modifiedSql(changes, tsid))} />

      <ParametersCard key={`parameters-${tablespace.spcoptions.map((o) => `${o.name}=${o.value}`).join()}`} initial={tablespace.spcoptions} options={options} onSave={(spcoptions) => save({ spcoptions })} onPreview={(spcoptions) => showPreview(() => tablespaces.modifiedSql({ spcoptions }, tsid))} />

      <ObjectPrivilegesPanel db={null} kind="tablespace" oid={tsid} initial={data.privileges} roles={options.roles} />

      <MoveObjectsCard tsid={tsid} name={tablespace.name} options={options} onPreview={(move) => showPreview(() => moveObjectsSql(tsid, move))} onMoved={reload} />

      <ContentsCard tsid={tsid} />

      {!tablespace.is_sys_obj && (
        <div className="card mb-2">
          <div className="card-header">
            <Icon name="b_deltbl" /> {t('tablespaces.remove')}
          </div>
          <div className="card-body">
            <div className="card-text">
              <a id="drop_tablespace_anchor" className="text-danger" href="#drop" onClick={(e) => { e.preventDefault(); setConfirmDrop(true) }}>
                {t('tablespaces.drop')}
              </a>
            </div>
          </div>
        </div>
      )}

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />

      <ConfirmQuery
        show={confirmDrop}
        warning={t('tablespaces.drop_warning')}
        sql={`DROP TABLESPACE ${quoteIdent(tablespace.name)};`}
        confirmLabel={t('tablespaces.drop')}
        confirmClass="btn-danger"
        onClose={() => setConfirmDrop(false)}
        onConfirm={() => void drop()}
      />
    </div>
  )
}

/** A card holding one form, its footer with Preview SQL and Go. */
function FormCard({ id, icon, title, children, onSubmit, onPreview }: { id: string; icon: string; title: string; children: ReactNode; onSubmit: () => Promise<void> | void; onPreview: () => void }) {
  const { t: tApp } = useTranslation()
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    await onSubmit()
    setSaving(false)
  }

  return (
    <form id={id} onSubmit={submit}>
      <div className="card mb-2">
        <div className="card-header">
          <Icon name={icon} /> {title}
        </div>
        <div className="card-body">{children}</div>
        <div className="card-footer text-end">
          <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={onPreview} />
          <input className="btn btn-primary" type="submit" value={tApp('go')} disabled={saving} />
        </div>
      </div>
    </form>
  )
}

/** The name, owner and comment; the location and size as text, since neither can be changed. */
function PropertiesCard({ tablespace, options, onSave, onPreview }: { tablespace: { name: string; spcuser: string; description: string | null; spclocation: string; size: number | null }; options: TablespaceOptions; onSave: (changes: TablespaceData) => Promise<void>; onPreview: (changes: TablespaceData) => void }) {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState(tablespace.name)
  const [owner, setOwner] = useState(tablespace.spcuser)
  const [comment, setComment] = useState(tablespace.description ?? '')
  const changes = (): TablespaceData => ({ name, spcuser: owner, description: comment })

  return (
    <FormCard
      id="tablespace_properties_form"
      icon="b_edit"
      title={t('tablespaces.properties')}
      onSubmit={() => {
        if (name !== tablespace.name || owner !== tablespace.spcuser || comment !== (tablespace.description ?? '')) return onSave(changes())
        notify(tApp('nothing_to_change'))
      }}
      onPreview={() => onPreview(changes())}
    >
      <div className="mb-3 row row-cols-lg-auto g-3">
        <div className="col-md-6">
          <label htmlFor="tablespaceNameInput" className="form-label">
            {t('tablespaces.columns.name')}
          </label>
          <input className="form-control" id="tablespaceNameInput" type="text" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="col-md-6">
          <label htmlFor="tablespaceOwnerSelect" className="form-label">
            {t('tablespaces.columns.owner')}
          </label>
          <select className="form-select" id="tablespaceOwnerSelect" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {[...new Set([tablespace.spcuser, ...options.roles])].map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label htmlFor="tablespaceCommentInput" className="form-label">
            {t('tablespaces.columns.comment')}
          </label>
          <input className="form-control" id="tablespaceCommentInput" type="text" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </div>
      <div>
        {t('tablespaces.columns.location')}:{' '}
        <span lang="en" dir="ltr">
          {tablespace.spclocation || <em className="text-muted">{t('tablespaces.data_directory')}</em>}
        </span>
      </div>
      <div>
        {t('tablespaces.columns.size')}: {tablespace.size === null ? '–' : formatSize(tablespace.size)}
      </div>
    </FormCard>
  )
}

/** pgAdmin's Parameters tab: the planner settings the tablespace overrides, name and value per row. */
function ParametersCard({ initial, options, onSave, onPreview }: { initial: { name: string; value: string }[]; options: TablespaceOptions; onSave: (spcoptions: { name: string; value: string }[]) => Promise<void>; onPreview: (spcoptions: { name: string; value: string }[]) => void }) {
  const { t } = useTranslation('roles')
  const [rows, setRows] = useState(initial)
  const update = (index: number, patch: Partial<{ name: string; value: string }>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const filled = () => rows.filter((row) => row.name !== '')
  const used = new Set(rows.map((row) => row.name))

  return (
    <FormCard id="tablespace_parameters_form" icon="s_vars" title={t('tablespaces.parameters')} onSubmit={() => onSave(filled())} onPreview={() => onPreview(filled())}>
      <table className="table table-borderless table-sm w-auto mb-0">
        <thead>
          <tr>
            <th>{t('variables.name')}</th>
            <th>{t('variables.value')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const variable = options.variables.find((v) => v.name === row.name)

            return (
              <tr key={index}>
                <td>
                  <select value={row.name} aria-label={t('variables.name')} onChange={(e) => update(index, { name: e.target.value })}>
                    <option value="" />
                    {options.variables.filter((v) => v.name === row.name || !used.has(v.name)).map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input type="number" step={variable?.vartype === 'integer' ? 1 : 'any'} min={variable?.min_val ?? undefined} max={variable?.vartype === 'integer' ? (variable.max_val ?? undefined) : undefined} value={row.value} aria-label={t('variables.value')} onChange={(e) => update(index, { value: e.target.value })} required={row.name !== ''} />
                </td>
                <td>
                  <a href="#" onClick={(e) => { e.preventDefault(); setRows((current) => current.filter((_, i) => i !== index)) }}>
                    <Icon name="b_drop" title={t('variables.remove')} />
                  </a>
                </td>
              </tr>
            )
          })}
          <tr>
            <td colSpan={3}>
              <input type="button" className="btn btn-secondary" value={t('variables.add')} disabled={used.size >= options.variables.length && !used.has('')} onClick={() => setRows((current) => [...current, { name: '', value: '' }])} />
            </td>
          </tr>
        </tbody>
      </table>
    </FormCard>
  )
}

const KINDS = ['tables', 'indexes', 'materialized_views'] as const

/**
 * pgAdmin's "Move objects": the tables, indexes and materialized views of one database that are
 * stored in this tablespace (optionally only those owned by some roles) move to another.
 */
function MoveObjectsCard({ tsid, name, options, onPreview, onMoved }: { tsid: number; name: string; options: TablespaceOptions; onPreview: (move: MoveObjects) => void; onMoved: () => void }) {
  const { t } = useTranslation('roles')
  const targets = options.tablespaces.filter((space) => space !== name && space !== 'pg_global')
  const [move, setMove] = useState<MoveObjects>({ database: options.databases[0] ?? '', kinds: [...KINDS], tablespace: targets[0] ?? '', owned_by: [], nowait: false })
  const [confirm, setConfirm] = useState<string | null>(null)
  const set = (patch: Partial<MoveObjects>) => setMove((m) => ({ ...m, ...patch }))

  async function ask() {
    try {
      setConfirm(await moveObjectsSql(tsid, move))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function run() {
    setConfirm(null)
    try {
      await moveObjects(tsid, move)
      notifySuccess(t('tablespaces.move.moved', { database: move.database }))
      onMoved()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <FormCard id="tablespace_move_form" icon="b_tblops" title={t('tablespaces.move.title')} onSubmit={ask} onPreview={() => onPreview(move)}>
      <div className="mb-3 row row-cols-lg-auto g-3">
        <div className="col-md-6">
          <label htmlFor="moveDatabaseSelect" className="form-label">
            {t('tablespaces.move.database')}
          </label>
          <select className="form-select" id="moveDatabaseSelect" value={move.database} onChange={(e) => set({ database: e.target.value })}>
            {options.databases.map((database) => (
              <option key={database} value={database}>
                {database}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label htmlFor="moveTablespaceSelect" className="form-label">
            {t('tablespaces.move.to')}
          </label>
          <select className="form-select" id="moveTablespaceSelect" value={move.tablespace} onChange={(e) => set({ tablespace: e.target.value })}>
            {targets.map((space) => (
              <option key={space} value={space}>
                {space}
              </option>
            ))}
          </select>
        </div>
        <div className="col-md-6">
          <label htmlFor="moveOwnedBySelect" className="form-label">
            {t('tablespaces.move.owned_by')}
          </label>
          <select className="form-select" id="moveOwnedBySelect" multiple size={Math.min(4, options.roles.length)} value={move.owned_by} title={t('tablespaces.move.owned_by_hint')} onChange={(e) => set({ owned_by: [...e.target.selectedOptions].map((option) => option.value) })}>
            {options.roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </div>
      {KINDS.map((kind) => (
        <div className="form-check form-check-inline" key={kind}>
          <input className="form-check-input" type="checkbox" id={`move_${kind}`} checked={move.kinds.includes(kind)} onChange={(e) => set({ kinds: e.target.checked ? KINDS.filter((k) => k === kind || move.kinds.includes(k)) : move.kinds.filter((k) => k !== kind) })} />
          <label className="form-check-label" htmlFor={`move_${kind}`}>
            {t(`tablespaces.move.kinds.${kind}`)}
          </label>
        </div>
      ))}
      <div className="form-check">
        <input className="form-check-input" type="checkbox" id="move_nowait" checked={move.nowait} onChange={(e) => set({ nowait: e.target.checked })} />
        <label className="form-check-label" htmlFor="move_nowait">
          {t('tablespaces.move.nowait')}
        </label>
      </div>
      <ConfirmQuery show={confirm !== null} sql={confirm ?? ''} onClose={() => setConfirm(null)} onConfirm={() => void run()} />
    </FormCard>
  )
}

/** pgAdmin's Dependents tab for a tablespace: the databases it is the default of and the relations stored in it. */
function ContentsCard({ tsid }: { tsid: number }) {
  const { t } = useTranslation('roles')
  const [shown, setShown] = useState(false)
  const { data: dependents, error } = useRequest(() => (shown ? tablespaces.dependents(tsid) : Promise.resolve(null)), [tsid, shown])

  return (
    <div className="card mb-2" id="tablespace_contents">
      <div className="card-header">
        <Icon name="s_db" /> {t('tablespaces.contents.title')}
      </div>
      <div className="card-body">
        {!shown && (
          <a href="#contents" onClick={(e) => { e.preventDefault(); setShown(true) }}>
            {t('tablespaces.contents.show')}
          </a>
        )}
        {error && <div className="alert alert-danger mb-0">{error.message}</div>}
        {shown && dependents === null && t('tablespaces.contents.loading')}
        {dependents && dependents.length === 0 && <div className="card-text">{t('tablespaces.contents.empty')}</div>}
        {dependents && dependents.length > 0 && (
          <table className="table table-striped table-hover w-auto mb-0">
            <thead>
              <tr>
                <th>{t('tablespaces.contents.type')}</th>
                <th>{t('tablespaces.contents.name')}</th>
                <th>{t('tablespaces.contents.database')}</th>
              </tr>
            </thead>
            <tbody>
              {dependents.map((dependent) => (
                <tr key={`${dependent.field}\u0000${dependent.type}\u0000${dependent.name}`}>
                  <td>{t(`tablespaces.contents.kinds.${dependent.type}`, { defaultValue: dependent.type })}</td>
                  <td>{dependent.type === 'database' ? '' : dependent.name}</td>
                  <td>{dependent.field}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
