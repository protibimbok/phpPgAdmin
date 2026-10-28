import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { createDomain, createType, domains, resolveDomain, resolveSchema, resolveType, typeOptions, types, updateDomain, updateType, type Domain, type DomainConstraint, type DomainData, type EnumLabel, type Member, type PgType, type TypeData, type TypeKind } from '../api'

interface Form {
  kind: TypeKind
  name: string
  owner: string
  comment: string
  members: Member[]
  labels: EnumLabel[]
  subtype: string
  opclass: string
  rangeCollation: string
  canonical: string
  subdiff: string
  multirange: string
  baseType: string
  length: string
  precision: string
  defaultValue: string
  notNull: boolean
  collation: string
  constraints: DomainConstraint[]
}

const EMPTY: Form = { kind: 'c', name: '', owner: '', comment: '', members: [{ member_name: '', type: 'text', tlength: null, precision: null, collation: '' }], labels: [{ label: '' }], subtype: '', opclass: '', rangeCollation: '', canonical: '', subdiff: '', multirange: '', baseType: 'text', length: '', precision: '', defaultValue: '', notNull: false, collation: '', constraints: [] }

function fromType(type: PgType): Form {
  return {
    ...EMPTY,
    kind: (['c', 'e', 'r'].includes(type.typtype) ? type.typtype : 'c') as TypeKind,
    name: type.name,
    owner: type.typeowner,
    comment: type.description ?? '',
    members: (type.composite ?? []).map((m) => ({ ...m, tlength: m.tlength ?? '', precision: m.precision ?? '' })),
    labels: (type.enum ?? []).map((l) => ({ label: l.label, old_label: l.old_label ?? l.label })),
    subtype: type.typname ?? '',
    opclass: type.opcname ?? '',
    rangeCollation: type.collname ?? '',
    canonical: type.rngcanonical ?? '',
    subdiff: type.rngsubdiff ?? '',
    multirange: type.rngmultirangetype ?? '',
  }
}

function fromDomain(domain: Domain): Form {
  return {
    ...EMPTY,
    kind: 'd',
    name: domain.name,
    owner: domain.owner,
    comment: domain.description ?? '',
    baseType: domain.basetype,
    length: domain.typlen,
    precision: domain.precision,
    defaultValue: domain.typdefault ?? '',
    notNull: domain.typnotnull,
    collation: domain.collname,
    constraints: domain.constraints.map((c) => ({ conoid: c.conoid, conname: c.conname, consrc: c.consrc, convalidated: c.convalidated })),
  }
}

/**
 * The type editor, laid out like phpMyAdmin's routine editor (MySQL has no types): the name,
 * kind (composite, enum, range or domain), owner and comment, then the kind's own fields from
 * pgAdmin's dialog: the members of a composite type (name, type, length, scale, collation),
 * the labels of an enum, a range's subtype, operator class, collation, canonical and subtype
 * diff functions and multirange name, a domain's base type, length, scale, default, NOT NULL,
 * collation and check constraints. Go creates or alters the type; Preview SQL shows the
 * statements.
 */
export default function TypeEditor({ mode }: { mode: 'create' | 'edit' }) {
  const { t } = useTranslation('types')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', node = 'type', name = '' } = useParams()
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const editingDomain = node === 'domain'
  const { data, error } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)
    const options = await typeOptions(db, scid)
    if (mode === 'create') return { scid, oid: 0, options, type: null as PgType | null, domain: null as Domain | null }
    if (editingDomain) {
      const { doid } = await resolveDomain(db, schema, name)

      return { scid, oid: doid, options, type: null, domain: await domains(db, scid).properties(doid) }
    }
    const { tid } = await resolveType(db, schema, name)

    return { scid, oid: tid, options, type: await types(db, scid).properties(tid), domain: null }
  }, [db, schema, name, mode, editingDomain])
  const [form, setForm] = useState<Form>(EMPTY)
  const [opclasses, setOpclasses] = useState<string[]>([])
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    if (data.type) setForm(fromType(data.type))
    else if (data.domain) setForm(fromDomain(data.domain))
    else {
      const requested = search.get('kind')
      setForm({ ...EMPTY, kind: (['c', 'e', 'r', 'd'].includes(requested ?? '') ? requested : 'c') as TypeKind })
    }
  }, [data, search])

  // The operator classes depend on the subtype picked.
  useEffect(() => {
    if (!data || form.kind !== 'r' || form.subtype === '') {
      setOpclasses([])

      return
    }
    typeOptions(db, data.scid, form.subtype).then((o) => setOpclasses(o.opclasses), () => setOpclasses([]))
  }, [db, data, form.kind, form.subtype])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, oid, options } = data
  const editing = data.type !== null || data.domain !== null
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))

  function typePayload(): TypeData {
    const base: TypeData = { name: form.name, typeowner: form.owner, description: form.comment }
    if (form.kind === 'c') return { ...base, typtype: 'c', composite: form.members.filter((m) => m.member_name.trim() !== '') }
    if (form.kind === 'e') return { ...base, typtype: 'e', enum: form.labels.filter((l) => l.label.trim() !== '') }

    return { ...base, typtype: 'r', typname: form.subtype, opcname: form.opclass, collname: form.rangeCollation, rngcanonical: form.canonical, rngsubdiff: form.subdiff, rngmultirangetype: form.multirange }
  }

  function domainPayload(): DomainData {
    return {
      name: form.name,
      basetype: form.baseType,
      typlen: form.length,
      precision: form.precision,
      typdefault: form.defaultValue,
      typnotnull: form.notNull,
      collname: form.collation,
      owner: form.owner,
      description: form.comment,
      constraints: form.constraints.filter((c) => c.consrc.trim() !== ''),
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      if (form.kind === 'd') {
        if (editing) await updateDomain(db, scid, oid, domainPayload())
        else await createDomain(db, scid, domainPayload())
      } else if (editing) await updateType(db, scid, oid, typePayload())
      else await createType(db, scid, typePayload())
      notifySuccess(editing ? t('editor.altered', { name: form.name }) : t('editor.created', { name: form.name }))
      treeState.refresh()
      navigate(`${urls.schema(db, schema)}/types`)
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    const request = form.kind === 'd' ? domains(db, scid).modifiedSql(domainPayload(), editing ? oid : undefined) : types(db, scid).modifiedSql(typePayload(), editing ? oid : undefined)
    request.then(
      (sql) => setPreview({ sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  const updateMember = (index: number, patch: Partial<Member>) => set('members', form.members.map((m, i) => (i === index ? { ...m, ...patch } : m)))
  const updateConstraint = (index: number, patch: Partial<DomainConstraint>) => set('constraints', form.constraints.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  const typeName = (type: { name: string; schema: string }) => (type.schema === 'pg_catalog' || type.schema === 'public' ? type.name : `${type.schema}.${type.name}`)

  return (
    <div className="container-fluid my-3">
      <h2>
        <Icon name="b_plugin" /> {editing ? t('editor.edit_title', { name }) : t('editor.create_title')}
      </h2>
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
                  <td>{t('editor.kind')}</td>
                  <td>
                    {editing ? (
                      <div className="fw-bold">{t(`kinds.${form.kind}`)}</div>
                    ) : (
                      <select name="item_kind" value={form.kind} onChange={(e) => set('kind', e.target.value as TypeKind)}>
                        {(['c', 'e', 'r', 'd'] as const).map((kind) => (
                          <option key={kind} value={kind}>
                            {t(`kinds.${kind}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>{t('editor.owner')}</td>
                  <td>
                    <select name="item_owner" value={form.owner} onChange={(e) => set('owner', e.target.value)}>
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

                {form.kind === 'c' && (
                  <tr>
                    <td>{t('editor.members')}</td>
                    <td>
                      <table className="routine_params_table table table-borderless table-sm">
                        <thead>
                          <tr>
                            <th>{t('editor.member_name')}</th>
                            <th>{t('editor.member_type')}</th>
                            <th>{t('editor.length')}</th>
                            <th>{t('editor.scale')}</th>
                            <th>{t('editor.collation')}</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {form.members.map((member, i) => (
                            <tr key={i}>
                              <td>
                                <input type="text" name={`item_member_name[${i}]`} value={member.member_name} onChange={(e) => updateMember(i, { member_name: e.target.value })} required />
                              </td>
                              <td>
                                <input type="text" name={`item_member_type[${i}]`} list="type_names" value={member.type} onChange={(e) => updateMember(i, { type: e.target.value })} required />
                              </td>
                              <td>
                                <input type="number" min={0} name={`item_member_length[${i}]`} value={member.tlength ?? ''} onChange={(e) => updateMember(i, { tlength: e.target.value })} size={5} />
                              </td>
                              <td>
                                <input type="number" min={0} name={`item_member_scale[${i}]`} value={member.precision ?? ''} onChange={(e) => updateMember(i, { precision: e.target.value })} size={5} />
                              </td>
                              <td>
                                <input type="text" list="collation_names" name={`item_member_collation[${i}]`} value={member.collation} onChange={(e) => updateMember(i, { collation: e.target.value })} />
                              </td>
                              <td>
                                <a href="#remove" onClick={(e) => { e.preventDefault(); set('members', form.members.filter((_, j) => j !== i)) }}>
                                  <Icon name="b_drop" /> {t('editor.remove')}
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button type="button" className="btn btn-primary" id="addMemberButton" onClick={() => set('members', [...form.members, { member_name: '', type: 'text', tlength: '', precision: '', collation: '' }])}>
                        {t('editor.add_member')}
                      </button>
                    </td>
                  </tr>
                )}

                {form.kind === 'e' && (
                  <tr>
                    <td>{t('editor.labels')}</td>
                    <td>
                      <table className="routine_params_table table table-borderless table-sm">
                        <tbody>
                          {form.labels.map((label, i) => (
                            <tr key={i}>
                              <td>
                                <input type="text" name={`item_label[${i}]`} value={label.label} onChange={(e) => set('labels', form.labels.map((l, j) => (j === i ? { ...l, label: e.target.value } : l)))} required />
                              </td>
                              <td>
                                {!label.old_label && (
                                  <a href="#remove" onClick={(e) => { e.preventDefault(); set('labels', form.labels.filter((_, j) => j !== i)) }}>
                                    <Icon name="b_drop" /> {t('editor.remove')}
                                  </a>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button type="button" className="btn btn-primary" id="addLabelButton" onClick={() => set('labels', [...form.labels, { label: '' }])}>
                        {t('editor.add_label')}
                      </button>
                      {editing && <div className="form-text">{t('editor.labels_hint')}</div>}
                    </td>
                  </tr>
                )}

                {form.kind === 'r' && (
                  <>
                    <tr>
                      <td>{t('editor.subtype')}</td>
                      <td>
                        <select name="item_subtype" value={form.subtype} onChange={(e) => setForm((f) => ({ ...f, subtype: e.target.value, opclass: '' }))} required disabled={editing}>
                          <option value="" />
                          {options.subtypes.map((s) => (
                            <option key={s.name} value={s.name}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                        {editing && <div className="form-text">{t('editor.range_hint')}</div>}
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.opclass')}</td>
                      <td>
                        <select name="item_opclass" value={form.opclass} onChange={(e) => set('opclass', e.target.value)} disabled={editing}>
                          <option value="" />
                          {[...new Set([form.opclass, ...opclasses])].filter(Boolean).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.collation')}</td>
                      <td>
                        <input type="text" list="collation_names" name="item_range_collation" value={form.rangeCollation} onChange={(e) => set('rangeCollation', e.target.value)} disabled={editing} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.canonical')}</td>
                      <td>
                        <input type="text" name="item_canonical" value={form.canonical} onChange={(e) => set('canonical', e.target.value)} disabled={editing} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.subdiff')}</td>
                      <td>
                        <input type="text" name="item_subdiff" value={form.subdiff} onChange={(e) => set('subdiff', e.target.value)} disabled={editing} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.multirange')}</td>
                      <td>
                        <input type="text" name="item_multirange" value={form.multirange} onChange={(e) => set('multirange', e.target.value)} disabled={editing} />
                      </td>
                    </tr>
                  </>
                )}

                {form.kind === 'd' && (
                  <>
                    <tr>
                      <td>{t('editor.base_type')}</td>
                      <td>
                        <input type="text" name="item_basetype" list="type_names" value={form.baseType} onChange={(e) => set('baseType', e.target.value)} required />
                        {editing && <div className="form-text">{t('editor.base_type_hint')}</div>}
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.length')}</td>
                      <td>
                        <input type="number" min={0} name="item_length" value={form.length} onChange={(e) => set('length', e.target.value)} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.scale')}</td>
                      <td>
                        <input type="number" min={0} name="item_precision" value={form.precision} onChange={(e) => set('precision', e.target.value)} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.default')}</td>
                      <td>
                        <input type="text" name="item_default" value={form.defaultValue} onChange={(e) => set('defaultValue', e.target.value)} placeholder={t('editor.default_hint')} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.not_null')}</td>
                      <td>
                        <input type="checkbox" name="item_notnull" checked={form.notNull} onChange={(e) => set('notNull', e.target.checked)} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.collation')}</td>
                      <td>
                        <input type="text" list="collation_names" name="item_collation" value={form.collation} onChange={(e) => set('collation', e.target.value)} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.constraints')}</td>
                      <td>
                        <table className="routine_params_table table table-borderless table-sm">
                          <thead>
                            <tr>
                              <th>{t('editor.constraint_name')}</th>
                              <th>{t('editor.check')}</th>
                              <th>{t('editor.validated')}</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {form.constraints.map((constraint, i) => (
                              <tr key={i}>
                                <td>
                                  <input type="text" name={`item_conname[${i}]`} value={constraint.conname} onChange={(e) => updateConstraint(i, { conname: e.target.value })} required />
                                </td>
                                <td>
                                  <input type="text" size={40} name={`item_consrc[${i}]`} value={constraint.consrc} onChange={(e) => updateConstraint(i, { consrc: e.target.value })} placeholder="VALUE > 0" required />
                                </td>
                                <td className="text-center">
                                  <input type="checkbox" checked={constraint.convalidated} onChange={(e) => updateConstraint(i, { convalidated: e.target.checked })} aria-label={t('editor.validated')} />
                                </td>
                                <td>
                                  <a href="#remove" onClick={(e) => { e.preventDefault(); set('constraints', form.constraints.filter((_, j) => j !== i)) }}>
                                    <Icon name="b_drop" /> {t('editor.remove')}
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <button type="button" className="btn btn-primary" id="addConstraintButton" onClick={() => set('constraints', [...form.constraints, { conname: '', consrc: '', convalidated: true }])}>
                          {t('editor.add_constraint')}
                        </button>
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
            <datalist id="type_names">
              {options.types.map((type) => (
                <option key={`${type.schema}.${type.name}`} value={typeName(type)} />
              ))}
            </datalist>
            <datalist id="collation_names">
              {options.collations.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="card-footer">
            <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={showPreview} />
            <input className="btn btn-primary" type="submit" value={tApp('go')} disabled={saving} />
          </div>
        </div>
      </form>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </div>
  )
}

