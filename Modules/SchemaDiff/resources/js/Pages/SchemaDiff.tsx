import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { urls } from '@/level'
import { notifyError } from '@/notify'
import { compareSchemas, diffOptions, diffScript, objectDdl, type DiffOptions, type DiffResult, type DiffStatus, type Side } from '../api'

const STATUSES: DiffStatus[] = ['identical', 'different', 'source_only', 'target_only']

/** pgAdmin's colours for a result, as Bootstrap's contextual rows. */
const ROW_CLASS: Record<DiffStatus, string> = { identical: '', different: 'table-warning', source_only: 'table-success', target_only: 'table-danger' }

const OPTION_KEYS: (keyof DiffOptions)[] = ['ignore_owner', 'ignore_whitespace', 'ignore_tablespace', 'ignore_grants']

/**
 * pgAdmin's Schema Diff on the database: a source and a target schema (of this database or
 * another on the server), what to ignore, Compare; then every object of both, grouped by type,
 * as identical, different, only in the source or only in the target, filtered by status. A row
 * shows the object's DDL on each side and the DDL that makes the target's like the source's;
 * the rows ticked make the script, which opens on the target database's SQL page.
 */
export default function SchemaDiff() {
  const db = useParams().db ?? ''
  const { t } = useTranslation('schemadiff')
  const navigate = useNavigate()
  const { data: databases } = useRequest(() => diffOptions().then((o) => o.databases), [])
  const [source, setSource] = useState<Side>({ database: db, schema: '' })
  const [target, setTarget] = useState<Side>({ database: db, schema: '' })
  const [options, setOptions] = useState<DiffOptions>({ ignore_owner: false, ignore_whitespace: false, ignore_tablespace: false, ignore_grants: false })
  const [compared, setCompared] = useState<{ request: { source: Side; target: Side } & DiffOptions; results: DiffResult[] } | null>(null)
  const [shown, setShown] = useState<Set<DiffStatus>>(new Set(['different', 'source_only', 'target_only']))
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [current, setCurrent] = useState<{ key: string; ddl: { source_ddl: string; target_ddl: string; diff_ddl: string } | null } | null>(null)
  const [script, setScript] = useState<string | null>(null)

  const keyOf = (r: DiffResult) => `${r.type}:${r.name}`
  const visible = useMemo(() => (compared?.results ?? []).filter((r) => shown.has(r.status)), [compared, shown])
  const groups = useMemo(() => {
    const map = new Map<string, DiffResult[]>()
    for (const r of visible) map.set(r.label, [...(map.get(r.label) ?? []), r])
    return [...map.entries()]
  }, [visible])
  const counts = useMemo(() => Object.fromEntries(STATUSES.map((s) => [s, (compared?.results ?? []).filter((r) => r.status === s).length])) as Record<DiffStatus, number>, [compared])

  async function compare(e: FormEvent) {
    e.preventDefault()
    if (!source.schema || !target.schema) return notifyError(t('choose'))
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
          <SideCard id="source" title={t('source')} side={source} databases={databases ?? []} onChange={setSource} />
          <SideCard id="target" title={t('target')} side={target} databases={databases ?? []} onChange={setTarget} />
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
          <div className="card-header">{t('results', { source: `${compared.request.source.database}.${compared.request.source.schema}`, target: `${compared.request.target.database}.${compared.request.target.schema}` })}</div>
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
                  {groups.map(([label, rows]) => [
                    <tr key={`group:${label}`} className="table-secondary">
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
          script && compared ? (
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

/** A side of the comparison: its database and one of the database's schemas. */
function SideCard({ id, title, side, databases, onChange }: { id: string; title: string; side: Side; databases: string[]; onChange: (side: Side) => void }) {
  const { t } = useTranslation('schemadiff')
  const { data: schemas } = useRequest(() => (side.database ? diffOptions(side.database).then((o) => o.schemas ?? []) : Promise.resolve([])), [side.database])

  // A side starts on the first schema of its database.
  useEffect(() => {
    if (schemas && !schemas.includes(side.schema)) onChange({ ...side, schema: schemas.includes('public') ? 'public' : (schemas[0] ?? '') })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemas])

  return (
    <div className="col-12 col-md-6">
      <div className="card mb-3" id={`${id}_side`}>
        <div className="card-header">{title}</div>
        <div className="card-body row g-3">
          <div className="col-auto">
            <label className="form-label" htmlFor={`${id}_database`}>
              {t('database')}
            </label>
            <select className="form-select" id={`${id}_database`} value={side.database} onChange={(e) => onChange({ database: e.target.value, schema: '' })}>
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
            <select className="form-select" id={`${id}_schema`} value={side.schema} onChange={(e) => onChange({ ...side, schema: e.target.value })}>
              {(schemas ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
