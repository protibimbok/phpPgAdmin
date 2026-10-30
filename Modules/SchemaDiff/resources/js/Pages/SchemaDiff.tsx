import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { urls } from '@/level'
import { notifyError } from '@/notify'
import { compareSchemas, connectServer, diffOptions, diffScript, objectDdl, type DiffOptions, type DiffResult, type DiffServer, type DiffStatus, type Side } from '../api'

const STATUSES: DiffStatus[] = ['identical', 'different', 'source_only', 'target_only']

/** pgAdmin's colours for a result, as Bootstrap's contextual rows. */
const ROW_CLASS: Record<DiffStatus, string> = { identical: '', different: 'table-warning', source_only: 'table-success', target_only: 'table-danger' }

const OPTION_KEYS: (keyof DiffOptions)[] = ['ignore_owner', 'ignore_whitespace', 'ignore_tablespace', 'ignore_grants']

/**
 * pgAdmin's Schema Diff on the database: a source and a target, each a server (the session's or
 * another saved one, signed in to here), a database and a schema, or no schema to compare the
 * whole databases; what to ignore, Compare; then every object of both, grouped by schema and type,
 * as identical, different, only in the source or only in the target, filtered by status. A row
 * shows the object's DDL on each side and the DDL that makes the target's like the source's;
 * the rows ticked make the script, which opens on the target database's SQL page.
 */
export default function SchemaDiff() {
  const db = useParams().db ?? ''
  const { t } = useTranslation('schemadiff')
  const navigate = useNavigate()
  const { data: servers, reload: reloadServers } = useRequest(() => diffOptions().then((o) => o.servers), [])
  const [source, setSource] = useState<Side>({ server: null, database: db, schema: '' })
  const [target, setTarget] = useState<Side>({ server: null, database: db, schema: '' })
  const [options, setOptions] = useState<DiffOptions>({ ignore_owner: false, ignore_whitespace: false, ignore_tablespace: false, ignore_grants: false })
  const [compared, setCompared] = useState<{ request: { source: Side; target: Side } & DiffOptions; results: DiffResult[] } | null>(null)
  const [shown, setShown] = useState<Set<DiffStatus>>(new Set(['different', 'source_only', 'target_only']))
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<{ key: string; ddl: { source_ddl: string; target_ddl: string; diff_ddl: string } | null } | null>(null)
  const [script, setScript] = useState<string | null>(null)

  const keyOf = (r: DiffResult) => `${r.schema ?? ''}:${r.type}:${r.name}`
  const visible = useMemo(() => (compared?.results ?? []).filter((r) => shown.has(r.status)), [compared, shown])
  const groups = useMemo(() => {
    const map = new Map<string, { schema: string | null | undefined; label: string; rows: DiffResult[] }>()
    for (const r of visible) {
      const key = `${r.schema ?? ''}\u0000${r.label}`
      const group = map.get(key) ?? { schema: r.schema, label: r.label, rows: [] }
      group.rows.push(r)
      map.set(key, group)
    }
    return [...map.values()]
  }, [visible])
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, (compared?.results ?? []).filter((r) => r.status === s).length])) as Record<DiffStatus, number>, [compared])

  async function compare(e: FormEvent) {
    e.preventDefault()
    if (!source.database || !target.database || !source.schema !== !target.schema) return notifyError(t('choose'))
    setBusy(true)
    setCurrent(null)
    try {
      const request = { source, target, ...options }
      const results = await compareSchemas(request)
      setCompared({ request, results })
      setChecked(new Set(results.filter((r) => r.status !== 'identical').map(keyOf)))
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function show(r: DiffResult) {
    if (!compared) return
    const key = keyOf(r)
    setCurrent({ key, ddl: null })
    objectDdl(compared.request, r).then(
      (ddl) => setCurrent((c) => (c?.key === key ? { key, ddl } : c)),
      (err: unknown) => {
        setCurrent(null)
        notifyError(errorMessage(err))
      },
    )
  }

  function generate() {
    if (!compared) return
    const items = compared.results.filter((r) => r.status !== 'identical' && checked.has(keyOf(r)))
    if (items.length === 0) return notifyError(t('none_selected'))
    setScript('')
    diffScript(compared.request, items).then(
      (sql) => setScript(sql === '' ? t('nothing_to_do') : sql),
      (err: unknown) => {
        setScript(null)
        notifyError(errorMessage(err))
      },
    )
  }

  const toggle = (key: string, value: boolean) =>
    setChecked((set) => {
      const next = new Set(set)
      if (value) next.add(key)
      else next.delete(key)
      return next
    })

  return (
    <div className="container-fluid my-3">
      <h2>
        <Icon name="b_relations" /> {t('title')}
      </h2>

      <form id="schema_diff_form" onSubmit={(e) => void compare(e)}>
        <div className="row">
          <SideCard id="source" title={t('source')} side={source} servers={servers ?? []} onChange={setSource} onConnected={reloadServers} />
          <SideCard id="target" title={t('target')} side={target} servers={servers ?? []} onChange={setTarget} onConnected={reloadServers} />
        </div>
        <div className="card mb-3">
          <div className="card-header">{t('options')}</div>
          <div className="card-body">
            {OPTION_KEYS.map((key) => (
              <div className="form-check form-check-inline" key={key}>
                <input className="form-check-input" type="checkbox" id={key} checked={options[key]} onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))} />
                <label className="form-check-label" htmlFor={key}>
                  {t(`ignore.${key}`)}
                </label>
              </div>
            ))}
          </div>
          <div className="card-footer text-end">
            <input className="btn btn-primary" type="submit" value={t('compare')} disabled={busy} />
          </div>
        </div>
      </form>

      {compared && (
        <div className="card mb-3" id="schema_diff_results">
          <div className="card-header">{t('results', { source: sideName(compared.request.source, servers), target: sideName(compared.request.target, servers) })}</div>
          <div className="card-body">
            <div className="mb-2">
              {STATUSES.map((status) => (
                <div className="form-check form-check-inline" key={status}>
                  <input
                    className="form-check-input"
                    type="checkbox"
                    id={`show_${status}`}
                    checked={shown.has(status)}
                    onChange={(e) =>
                      setShown((set) => {
                        const next = new Set(set)
                        if (e.target.checked) next.add(status)
                        else next.delete(status)
                        return next
                      })
                    }
                  />
                  <label className="form-check-label" htmlFor={`show_${status}`}>
                    {t(`status.${status}`)} ({counts[status]})
                  </label>
                </div>
              ))}
            </div>
            {groups.length === 0 ? (
              <div className="alert alert-primary" role="alert">
                <Icon name="s_notice" /> {t('nothing_shown')}
              </div>
            ) : (
              <table className="table table-hover w-auto">
                <thead>
                  <tr>
                    <th />
                    <th>{t('columns.object')}</th>
                    <th>{t('columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(({ schema, label, rows }, i) => [
                    schema !== undefined && (i === 0 || groups[i - 1].schema !== schema) && (
                      <tr key={`schema:${schema ?? ''}`} className="table-dark">
                        <th colSpan={3}>{schema === null ? t('database_objects') : t('schema_group', { schema })}</th>
                      </tr>
                    ),
                    <tr key={`group:${schema ?? ''}:${label}`} className="table-secondary">
                      <th colSpan={3}>
                        {label} ({rows.length})
                      </th>
                    </tr>,
                    ...rows.map((r) => (
                      <tr key={keyOf(r)} className={`${ROW_CLASS[r.status]}${current?.key === keyOf(r) ? ' marked' : ''}`} style={{ cursor: 'pointer' }} onClick={() => show(r)}>
                        <td onClick={(e) => e.stopPropagation()}>
                          {r.status !== 'identical' && <input type="checkbox" aria-label={r.name} checked={checked.has(keyOf(r))} onChange={(e) => toggle(keyOf(r), e.target.checked)} />}
                        </td>
                        <td>{r.name}</td>
                        <td>{t(`status.${r.status}`)}</td>
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            )}
          </div>
          <div className="card-footer text-end">
            <button type="button" className="btn btn-primary" id="generate_script" onClick={generate}>
              <Icon name="b_sql" /> {t('generate')}
            </button>
          </div>
        </div>
      )}

      {current && (
        <div className="row" id="schema_diff_ddl">
          {current.ddl === null ? (
            <div className="col-12">{t('loading')}</div>
          ) : (
            (['source_ddl', 'target_ddl', 'diff_ddl'] as const).map((key) => (
              <div className="col-12 col-xl-4" key={key}>
                <SqlView sql={current.ddl?.[key] || ' '} title={t(`ddl.${key}`)} />
              </div>
            ))
          )}
        </div>
      )}

      <Modal
        show={script !== null}
        title={t('script_title')}
        size="lg"
        onClose={() => setScript(null)}
        footer={
          script && compared && (compared.request.target.server === null || servers?.find((s) => s.id === compared.request.target.server)?.current) ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate(`${urls.database(compared.request.target.database)}/sql?${new URLSearchParams({ sql: script })}`)}
            >
              {t('open_in_sql', { database: compared.request.target.database })}
            </button>
          ) : undefined
        }
      >
        {script === '' ? t('loading') : <SqlView sql={script ?? ''} />}
      </Modal>
    </div>
  )
}

/** "server › database.schema", the server only when it is not the session's. */
function sideName(side: Side, servers: DiffServer[] | null | undefined): string {
  const server = servers?.find((s) => s.id === side.server && !s.current)
  return `${server ? `${server.name} › ` : ''}${side.database}${side.schema ? `.${side.schema}` : ''}`
}

/**
 * A side of the comparison: its server, one of the server's databases and one of the
 * database's schemas, or none for the whole database. Another saved server is signed in to
 * here, as pgAdmin connects a server picked in its Schema Diff.
 */
function SideCard({ id, title, side, servers, onChange, onConnected }: { id: string; title: string; side: Side; servers: DiffServer[]; onChange: (side: Side) => void; onConnected: () => void }) {
  const { t } = useTranslation('schemadiff')
  const { data: options, reload } = useRequest(() => diffOptions(side.server, side.database), [side.server, side.database])
  const databases = options?.databases ?? []
  const schemas = options?.schemas ?? []
  const [login, setLogin] = useState({ username: '', password: '' })
  const [connecting, setConnecting] = useState(false)
  // A side picks a schema for itself after its database changes, until one is chosen.
  const pick = useRef(true)

  // A side starts on its server's first database and on the public schema, or the first one.
  useEffect(() => {
    if (!options || options.needs_login) return
    if (!options.databases.includes(side.database)) {
      pick.current = true
      onChange({ ...side, database: options.databases[0] ?? '', schema: '' })
    } else if (options.schemas && pick.current) {
      pick.current = false
      onChange({ ...side, schema: options.schemas.includes('public') ? 'public' : (options.schemas[0] ?? '') })
    } else if (options.schemas && side.schema !== '' && !options.schemas.includes(side.schema)) onChange({ ...side, schema: '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options])

  async function connect() {
    if (side.server === null) return
    setConnecting(true)
    try {
      await connectServer(side.server, login.username, login.password)
      setLogin({ username: login.username, password: '' })
      onConnected()
      reload()
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div className="col-12 col-md-6">
      <div className="card mb-3" id={`${id}_side`}>
        <div className="card-header">{title}</div>
        <div className="card-body row g-3">
          <div className="col-auto">
            <label className="form-label" htmlFor={`${id}_server`}>
              {t('server')}
            </label>
            <select
              className="form-select"
              id={`${id}_server`}
              value={side.server === null ? '' : String(side.server)}
              onChange={(e) => {
                const picked = servers.find((s) => String(s.id) === e.target.value)
                pick.current = true
                onChange({ server: !picked || picked.current ? null : picked.id, database: '', schema: '' })
              }}
            >
              {servers.map((s) => (
                <option key={s.id ?? 'current'} value={s.current ? '' : String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {options?.needs_login ? (
            <>
              <div className="col-auto">
                <label className="form-label" htmlFor={`${id}_username`}>
                  {t('username')}
                </label>
                <input className="form-control" id={`${id}_username`} value={login.username} autoComplete="username" onChange={(e) => setLogin({ ...login, username: e.target.value })} />
              </div>
              <div className="col-auto">
                <label className="form-label" htmlFor={`${id}_password`}>
                  {t('password')}
                </label>
                <input className="form-control" id={`${id}_password`} type="password" value={login.password} autoComplete="current-password" onChange={(e) => setLogin({ ...login, password: e.target.value })} />
              </div>
              <div className="col-auto d-flex align-items-end">
                <button type="button" className="btn btn-secondary" id={`${id}_connect`} disabled={connecting} onClick={() => void connect()}>
                  {t('connect')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="col-auto">
                <label className="form-label" htmlFor={`${id}_database`}>
                  {t('database')}
                </label>
                <select className="form-select" id={`${id}_database`} value={side.database} onChange={(e) => {
                    pick.current = true
                    onChange({ ...side, database: e.target.value, schema: '' })
                  }}>
                  {databases.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-auto">
                <label className="form-label" htmlFor={`${id}_schema`}>
                  {t('schema')}
                </label>
                <select className="form-select" id={`${id}_schema`} value={side.schema} onChange={(e) => {
                    pick.current = false
                    onChange({ ...side, schema: e.target.value })
                  }}>
                  <option value="">{t('whole_database')}</option>
                  {schemas.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
