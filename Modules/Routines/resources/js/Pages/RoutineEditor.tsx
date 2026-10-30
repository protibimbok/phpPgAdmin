import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import DependencyPanel from '@/components/DependencyPanel'
import PreviewSql from '@/components/PreviewSql'
import SecurityLabelsCard from '@/components/SecurityLabelsCard'
import StatisticsPanel from '@/components/StatisticsPanel'
import PrivilegesSection from '@roles/js/PrivilegesSection'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { debuggerStatus } from '@debugger/js/api'
import SqlEditor from '@sql/js/editor/SqlEditor'
import { createRoutine, KIND_LABELS, KINDS, resolveSchema, routineModifiedSql, routineOptions, routines, updateRoutine, type Argument, type Routine, type RoutineData, type RoutineKind, type Variable } from '../api'

const MODES = ['IN', 'OUT', 'INOUT', 'VARIADIC']
const VOLATILITY = [
  { value: 'v', label: 'VOLATILE' },
  { value: 's', label: 'STABLE' },
  { value: 'i', label: 'IMMUTABLE' },
]
const PARALLEL = [
  { value: 'u', label: 'UNSAFE' },
  { value: 'r', label: 'RESTRICTED' },
  { value: 's', label: 'SAFE' },
]

interface Form {
  name: string
  kind: RoutineKind
  arguments: Argument[]
  returnType: string
  returnsSet: boolean
  language: string
  definition: string
  /** A C function's object file (probin) and link symbol (prosrc). */
  objectFile: string
  linkSymbol: string
  volatility: string
  strict: boolean
  securityDefiner: boolean
  parallel: string
  cost: string
  rows: string
  leakproof: boolean
  /** WINDOW and SUPPORT: a function's window flag (fixed once created) and planner support function. */
  window: boolean
  support: string
  owner: string
  comment: string
  variables: Variable[]
}

const EMPTY: Form = { name: '', kind: 'function', arguments: [], returnType: 'integer', returnsSet: false, language: 'plpgsql', definition: '', objectFile: '', linkSymbol: '', volatility: 'v', strict: false, securityDefiner: false, parallel: 'u', cost: '', rows: '', leakproof: false, window: false, support: '', owner: '', comment: '', variables: [] }

/** The form as an existing routine fills it. */
function fromRoutine(routine: Routine, kind: RoutineKind): Form {
  const returnsSet = routine.proretset && !/^TABLE\s*\(/i.test(routine.prorettypename)

  return {
    name: routine.name,
    kind,
    arguments: routine.arguments.map((a) => ({ ...a })),
    returnType: returnsSet ? routine.prorettypename.replace(/^SETOF\s+/i, '') : routine.prorettypename,
    returnsSet,
    language: routine.lanname,
    definition: routine.lanname === 'c' ? '' : routine.prosrc.replace(/^\n/, '').replace(/\n$/, ''),
    objectFile: routine.probin ?? '',
    linkSymbol: routine.lanname === 'c' ? (routine.prosrc_c ?? '') : '',
    volatility: routine.provolatile ?? 'v',
    strict: routine.proisstrict,
    securityDefiner: routine.prosecdef,
    parallel: routine.proparallel ?? 'u',
    cost: routine.procost === null ? '' : String(routine.procost),
    rows: routine.prorows === null || Number(routine.prorows) === 0 ? '' : String(routine.prorows),
    leakproof: routine.proleakproof,
    window: routine.proiswindow,
    support: routine.prosupportfunc ?? '',
    owner: routine.funcowner,
    comment: routine.description ?? '',
    variables: routine.variables.map((v) => ({ name: v.name, value: v.value === false ? 'off' : String(v.value) })),
  }
}

/**
 * phpMyAdmin's routine editor (database/routines/editor_form.twig), with PostgreSQL's options
 * where MySQL's were: the name and type, the parameters (direction, name, type, default), the
 * return type (with SETOF) of a function, the definition, then the language, volatility,
 * strictness, security, parallel safety, cost and rows, leakproof, WINDOW and SUPPORT, owner, comment and the
 * configuration variables. Go creates or alters the routine; Preview SQL shows the statements.
 */
export default function RoutineEditor({ mode }: { mode: 'create' | 'edit' }) {
  const { t } = useTranslation('routines')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', kind: kindParam = '', oid: oidParam = '' } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const editKind = (KINDS.includes(kindParam as RoutineKind) ? kindParam : 'function') as RoutineKind
  const oid = Number(oidParam)
  const { data, error } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)
    const options = await routineOptions(db, scid)
    if (mode === 'create') return { scid, options, routine: null as Routine | null }

    return { scid, options, routine: await routines(db, scid, editKind).properties(oid) }
  }, [db, schema, mode, editKind, oid])
  const [form, setForm] = useState<Form>(EMPTY)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [saving, setSaving] = useState(false)
  // pgAdmin's Debug, offered where the database has the debugger.
  const { data: debugging } = useRequest(() => (mode === 'edit' ? debuggerStatus(db).catch(() => null) : Promise.resolve(null)), [db, mode])

  useEffect(() => {
    if (!data) return
    if (data.routine) {
      setForm(fromRoutine(data.routine, editKind))
    } else {
      const requested = search.get('type')
      setForm({ ...EMPTY, kind: KINDS.includes(requested as RoutineKind) ? (requested as RoutineKind) : 'function', language: data.options.languages.includes('plpgsql') ? 'plpgsql' : (data.options.languages[0] ?? 'sql') })
    }
  }, [data, editKind, search])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, options } = data
  const editing = data.routine !== null
  const isFunction = form.kind === 'function'
  const isTrigger = form.kind === 'trigger_function'
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))

  /** The data as the templates take it. */
  function payload(): RoutineData {
    const data: RoutineData = {
      name: form.name,
      arguments: isTrigger ? [] : form.arguments.filter((a) => a.argtype.trim() !== ''),
      lanname: form.language,
      // A C function is an object file and a link symbol (AS 'obj_file', 'link_symbol').
      ...(form.language === 'c' ? { probin: form.objectFile, prosrc_c: form.linkSymbol } : { prosrc: form.definition }),
      prosecdef: form.securityDefiner,
      funcowner: form.owner,
      description: form.comment,
      variables: form.variables.filter((v) => v.name.trim() !== ''),
    }
    if (isFunction) {
      Object.assign(data, {
        prorettypename: editing && form.returnsSet ? `SETOF ${form.returnType}` : form.returnType,
        proretset: form.returnsSet,
        provolatile: form.volatility,
        proisstrict: form.strict,
        proparallel: form.parallel,
        procost: form.cost,
        prorows: form.returnsSet ? form.rows : '',
        proleakproof: form.leakproof,
        prosupportfunc: form.support,
        ...(editing ? {} : { proiswindow: form.window }),
      })
    } else if (isTrigger) {
      Object.assign(data, { prorettypename: 'trigger', provolatile: form.volatility, proisstrict: form.strict, proleakproof: form.leakproof, procost: form.cost })
    }

    return data
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      if (editing) await updateRoutine(db, scid, form.kind, oid, payload())
      else await createRoutine(db, scid, form.kind, payload())
      notifySuccess(editing ? t('editor.altered', { name: form.name }) : t('editor.created', { name: form.name }))
      treeState.refresh()
      navigate(`${urls.schema(db, schema)}/routines`)
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    routineModifiedSql(db, scid, form.kind, payload(), editing ? oid : undefined).then(
      (sql) => setPreview({ sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  const updateArgument = (index: number, patch: Partial<Argument>) => set('arguments', form.arguments.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  const updateVariable = (index: number, patch: Partial<Variable>) => set('variables', form.variables.map((v, i) => (i === index ? { ...v, ...patch } : v)))

  return (
    <div className="container-fluid my-3">
      <h2>
        <Icon name="b_routines" /> {editing ? t('editor.edit_title', { name: data.routine!.signature }) : t('editor.create_title')}
      </h2>
      {editing && debugging?.available && form.language === 'plpgsql' && (editKind === 'function' || editKind === 'procedure') && (
        <p>
          <Link id="debug_routine" to={`${urls.schema(db, schema)}/routines/${editKind}/${oid}/debug`}>
            <Icon name="b_nextpage" /> {t('editor.debug')}
          </Link>
        </p>
      )}
      <form className="rte_form" onSubmit={save}>
        <div className="card">
          <div className="card-header">{t('editor.details')}</div>
          <div className="card-body">
            <table className="rte_table table table-borderless table-sm">
              <tbody>
                <tr>
                  <td>{t('editor.name')}</td>
                  <td>
                    <input type="text" name="item_name" maxLength={63} value={form.name} onChange={(e) => set('name', e.target.value)} required />
                  </td>
                </tr>
                <tr>
                  <td>{t('editor.type')}</td>
                  <td>
                    {editing ? (
                      <div className="fw-bold">{KIND_LABELS[form.kind]}</div>
                    ) : (
                      <select name="item_type" value={form.kind} onChange={(e) => set('kind', e.target.value as RoutineKind)}>
                        {KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {KIND_LABELS[kind]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
                {!isTrigger && (
                  <>
                    <tr>
                      <td>{t('editor.parameters')}</td>
                      <td>
                        <table className="routine_params_table table table-borderless table-sm">
                          <thead>
                            <tr>
                              <th className="routine_direction_cell">{t('editor.direction')}</th>
                              <th>{t('editor.param_name')}</th>
                              <th>{t('editor.param_type')}</th>
                              <th>{t('editor.default')}</th>
                              {!editing && <th className="routine_param_remove" />}
                            </tr>
                          </thead>
                          <tbody>
                            {form.arguments.map((arg, i) => (
                              <tr key={i}>
                                <td className="routine_direction_cell">
                                  <select name={`item_param_dir[${i}]`} value={arg.argmode || 'IN'} onChange={(e) => updateArgument(i, { argmode: e.target.value })}>
                                    {MODES.map((m) => (
                                      <option key={m} value={m}>
                                        {m}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input name={`item_param_name[${i}]`} type="text" value={arg.argname} onChange={(e) => updateArgument(i, { argname: e.target.value })} />
                                </td>
                                <td>
                                  <input name={`item_param_type[${i}]`} type="text" list="routine_types" value={arg.argtype} onChange={(e) => updateArgument(i, { argtype: e.target.value })} required />
                                </td>
                                <td>
                                  <input name={`item_param_default[${i}]`} type="text" value={arg.argdefval} onChange={(e) => updateArgument(i, { argdefval: e.target.value })} />
                                </td>
                                {!editing && (
                                  <td className="routine_param_remove">
                                    <a href="#remove" className="routine_param_remove_anchor" onClick={(e) => { e.preventDefault(); set('arguments', form.arguments.filter((_, j) => j !== i)) }}>
                                      <Icon name="b_drop" /> {t('editor.remove')}
                                    </a>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                    <tr>
                      <td />
                      <td>
                        {editing ? (
                          <div className="form-text">{t('editor.no_add_hint')}</div>
                        ) : (
                          <button type="button" className="btn btn-primary" id="addRoutineParameterButton" onClick={() => set('arguments', [...form.arguments, { argmode: 'IN', argname: '', argtype: 'integer', argdefval: '' }])}>
                            {t('editor.add_parameter')}
                          </button>
                        )}
                      </td>
                    </tr>
                  </>
                )}
                {isFunction && (
                  <tr className="routine_return_row">
                    <td>{t('editor.return_type')}</td>
                    <td>
                      <input type="text" name="item_returntype" list="routine_types" value={form.returnType} onChange={(e) => set('returnType', e.target.value)} required />{' '}
                      <label className="ms-2">
                        <input type="checkbox" name="item_returns_set" checked={form.returnsSet} onChange={(e) => set('returnsSet', e.target.checked)} /> {t('editor.returns_set')}
                      </label>
                    </td>
                  </tr>
                )}
                {form.language === 'c' ? (
                  <>
                    <tr>
                      <td>{t('editor.object_file')}</td>
                      <td>
                        <input type="text" name="item_probin" value={form.objectFile} onChange={(e) => set('objectFile', e.target.value)} placeholder="$libdir/…" required />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.link_symbol')}</td>
                      <td>
                        <input type="text" name="item_prosrc_c" value={form.linkSymbol} onChange={(e) => set('linkSymbol', e.target.value)} />
                      </td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td>{t('editor.definition')}</td>
                    <td>
                      <SqlEditor value={form.definition} onChange={(value) => set('definition', value)} ariaLabel={t('editor.definition')} className="routine-definition" />
                    </td>
                  </tr>
                )}
                <tr>
                  <td>{t('editor.language')}</td>
                  <td>
                    <select name="item_language" value={form.language} onChange={(e) => set('language', e.target.value)}>
                      {[...new Set([form.language, ...options.languages])].map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                {form.kind !== 'procedure' && (
                  <>
                    <tr>
                      <td>{t('editor.volatility')}</td>
                      <td>
                        <select name="item_volatility" value={form.volatility} onChange={(e) => set('volatility', e.target.value)}>
                          {VOLATILITY.map((v) => (
                            <option key={v.value} value={v.value}>
                              {v.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.strict')}</td>
                      <td>
                        <input type="checkbox" name="item_isstrict" checked={form.strict} onChange={(e) => set('strict', e.target.checked)} />
                      </td>
                    </tr>
                  </>
                )}
                <tr>
                  <td>{t('editor.security_type')}</td>
                  <td>
                    <select name="item_securitytype" value={form.securityDefiner ? 'DEFINER' : 'INVOKER'} onChange={(e) => set('securityDefiner', e.target.value === 'DEFINER')}>
                      <option value="INVOKER">INVOKER</option>
                      <option value="DEFINER">DEFINER</option>
                    </select>
                  </td>
                </tr>
                {isFunction && (
                  <>
                    <tr>
                      <td>{t('editor.parallel')}</td>
                      <td>
                        <select name="item_parallel" value={form.parallel} onChange={(e) => set('parallel', e.target.value)}>
                          {PARALLEL.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  </>
                )}
                {form.kind !== 'procedure' && (
                  <>
                    <tr>
                      <td>{t('editor.cost')}</td>
                      <td>
                        <input type="number" min={0} name="item_cost" value={form.cost} onChange={(e) => set('cost', e.target.value)} placeholder="100" />
                      </td>
                    </tr>
                    {isFunction && form.returnsSet && (
                      <tr>
                        <td>{t('editor.rows')}</td>
                        <td>
                          <input type="number" min={0} name="item_rows" value={form.rows} onChange={(e) => set('rows', e.target.value)} placeholder="1000" />
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td>{t('editor.leakproof')}</td>
                      <td>
                        <input type="checkbox" name="item_leakproof" checked={form.leakproof} onChange={(e) => set('leakproof', e.target.checked)} />
                      </td>
                    </tr>
                  </>
                )}
                {isFunction && (
                  <>
                    <tr>
                      <td>{t('editor.window')}</td>
                      <td>
                        <input type="checkbox" name="item_window" checked={form.window} onChange={(e) => set('window', e.target.checked)} disabled={editing} />
                        <div className="form-text">{t(editing ? 'editor.window_fixed' : 'editor.window_hint')}</div>
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.support')}</td>
                      <td>
                        <select name="item_support" value={form.support} onChange={(e) => set('support', e.target.value)}>
                          <option value="" />
                          {[...new Set([form.support, ...options.support_functions])].filter(Boolean).map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                        <div className="form-text">{t('editor.support_hint')}</div>
                      </td>
                    </tr>
                  </>
                )}
                <tr>
                  <td>{t('editor.owner')}</td>
                  <td>
                    <select name="item_definer" value={form.owner} onChange={(e) => set('owner', e.target.value)}>
                      <option value="">{t('editor.current_role')}</option>
                      {[...new Set([form.owner, ...options.roles])].filter(Boolean).map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                <tr>
                  <td>{t('editor.comment')}</td>
                  <td>
                    <input type="text" name="item_comment" value={form.comment} onChange={(e) => set('comment', e.target.value)} />
                  </td>
                </tr>
                <tr>
                  <td>{t('editor.variables')}</td>
                  <td>
                    <table className="routine_params_table table table-borderless table-sm">
                      <tbody>
                        {form.variables.map((variable, i) => (
                          <tr key={i}>
                            <td>
                              <input type="text" list="routine_variables" value={variable.name} onChange={(e) => updateVariable(i, { name: e.target.value })} aria-label={t('editor.variable_name')} placeholder={t('editor.variable_name')} />
                            </td>
                            <td>
                              <input type="text" value={String(variable.value)} onChange={(e) => updateVariable(i, { value: e.target.value })} aria-label={t('editor.variable_value')} placeholder={t('editor.variable_value')} />
                            </td>
                            <td>
                              <a href="#remove" onClick={(e) => { e.preventDefault(); set('variables', form.variables.filter((_, j) => j !== i)) }}>
                                <Icon name="b_drop" /> {t('editor.remove')}
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button type="button" className="btn btn-secondary" onClick={() => set('variables', [...form.variables, { name: '', value: '' }])}>
                      {t('editor.add_variable')}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
            <datalist id="routine_types">
              {options.types.map((type) => {
                const name = type.schema === 'pg_catalog' || type.schema === 'public' ? type.name : `${type.schema}.${type.name}`

                return <option key={name} value={name} />
              })}
            </datalist>
            <datalist id="routine_variables">
              {options.variables.map((v) => (
                <option key={v.name} value={v.name} />
              ))}
            </datalist>
          </div>
          <div className="card-footer">
            <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={showPreview} />
            <input className="btn btn-primary" type="submit" value={tApp('go')} disabled={saving} />
          </div>
        </div>
      </form>

      {editing && <PrivilegesSection db={db} kind="function" oid={oid} />}
      {editing && <StatisticsPanel load={() => routines(db, data.scid, editKind).statistics(oid)} reloadKey={`${db}/${editKind}/${oid}`} empty={t('editor.no_statistics')} />}
      {editing && <SecurityLabelsCard key={oid} db={db} catalog="pg_proc" oid={oid} />}
      {editing && <DependencyPanel dependencies={() => routines(db, data.scid, editKind).dependencies(oid)} dependents={() => routines(db, data.scid, editKind).dependents(oid)} reloadKey={`${db}/${editKind}/${oid}`} />}

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </div>
  )
}
