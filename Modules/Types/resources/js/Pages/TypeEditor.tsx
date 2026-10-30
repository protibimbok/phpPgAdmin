import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import DependencyPanel from '@/components/DependencyPanel'
import PrivilegesSection from '@roles/js/PrivilegesSection'
import PreviewSql from '@/components/PreviewSql'
import SecurityLabelsCard from '@/components/SecurityLabelsCard'
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
  base: BaseForm
}

/** A base type's settings: CREATE TYPE name (INPUT = …, OUTPUT = …, …). */
interface BaseForm {
  input: string
  output: string
  receive: string
  send: string
  typmodIn: string
  typmodOut: string
  analyze: string
  subscript: string
  internalLength: string
  byValue: boolean
  alignment: string
  storage: string
  like: string
  category: string
  preferred: boolean
  defaultValue: string
  element: string
  delimiter: string
  collatable: boolean
}

const EMPTY_BASE: BaseForm = { input: '', output: '', receive: '', send: '', typmodIn: '', typmodOut: '', analyze: '', subscript: '', internalLength: '', byValue: false, alignment: '', storage: '', like: '', category: '', preferred: false, defaultValue: '', element: '', delimiter: '', collatable: false }

const EMPTY: Form = { kind: 'c', name: '', owner: '', comment: '', members: [{ member_name: '', type: 'text', tlength: null, precision: null, collation: '' }], labels: [{ label: '' }], subtype: '', opclass: '', rangeCollation: '', canonical: '', subdiff: '', multirange: '', baseType: 'text', length: '', precision: '', defaultValue: '', notNull: false, collation: '', constraints: [], base: EMPTY_BASE }

const KINDS = ['c', 'e', 'r', 'd', 'b', 'p'] as const

/** pgAdmin's alignment, storage and category choices for a base type. */
const ALIGNMENTS = [
  { value: 'c', label: 'char' },
  { value: 's', label: 'int2' },
  { value: 'i', label: 'int4' },
  { value: 'd', label: 'double' },
]
const STORAGES = [
  { value: 'p', label: 'PLAIN' },
  { value: 'e', label: 'EXTERNAL' },
  { value: 'm', label: 'MAIN' },
  { value: 'x', label: 'EXTENDED' },
]
const CATEGORIES = ['A', 'B', 'C', 'D', 'E', 'G', 'I', 'N', 'P', 'S', 'T', 'U', 'V', 'X'] as const

function fromBase(type: PgType): BaseForm {
  return {
    input: type.typinput ?? '',
    output: type.typoutput ?? '',
    receive: type.typreceive ?? '',
    send: type.typsend ?? '',
    typmodIn: type.typmodin ?? '',
    typmodOut: type.typmodout ?? '',
    analyze: type.typanalyze ?? '',
    subscript: type.typsubscript ?? '',
    internalLength: type.typlen === undefined || type.typlen === null ? '' : String(type.typlen),
    byValue: Boolean(type.typbyval),
    alignment: type.typalign ?? '',
    storage: type.typstorage ?? '',
    like: '',
    category: type.typcategory ?? '',
    preferred: Boolean(type.typispreferred),
    defaultValue: type.typdefault ?? '',
    element: type.element ?? '',
    delimiter: type.typdelim ?? '',
    collatable: type.is_collatable,
  }
}

function fromType(type: PgType): Form {
  return {
    ...EMPTY,
    kind: (['c', 'e', 'r', 'b', 'p'].includes(type.typtype) ? type.typtype : 'c') as TypeKind,
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
    base: type.typtype === 'b' ? fromBase(type) : EMPTY_BASE,
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
 * collation and check constraints, a base type's functions and storage settings (pgAdmin's
 * "External" kind; once created only the receive, send, typmod, analyze, subscript functions and
 * the storage change), and a shell type, the name alone. Go creates or alters the type; Preview
 * SQL shows the statements.
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
      setForm({ ...EMPTY, kind: ((KINDS as readonly string[]).includes(requested ?? '') ? requested : 'c') as TypeKind })
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
    if (form.kind === 'p') return { ...base, typtype: 'p' }
    if (form.kind === 'b') {
      const b = form.base
      // Once created, only what ALTER TYPE … SET (…) changes is sent.
      const alterable = { typreceive: b.receive, typsend: b.send, typmodin: b.typmodIn, typmodout: b.typmodOut, typanalyze: b.analyze, typstorage: b.storage, ...(options.version >= 140000 ? { typsubscript: b.subscript } : {}) }
      if (editing) return { ...base, typtype: 'b', ...alterable }

      return {
        ...base,
        typtype: 'b',
        typinput: b.input,
        typoutput: b.output,
        ...alterable,
        typlen: b.internalLength,
        typbyval: b.byValue,
        typalign: b.alignment,
        typlike: b.like,
        typcategory: b.category,
        typispreferred: b.preferred,
        typdefault: b.defaultValue,
        element: b.element,
        typdelim: b.delimiter,
        is_collatable: b.collatable,
      }
    }

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

  const setBase = <K extends keyof BaseForm>(key: K, value: BaseForm[K]) => setForm((f) => ({ ...f, base: { ...f.base, [key]: value } }))
  /** A base type's function field: typed or picked from the functions of the database. */
  const functionField = (key: 'input' | 'output' | 'receive' | 'send' | 'typmodIn' | 'typmodOut' | 'analyze' | 'subscript', label: string, list: string, required = false, locked = false) => (
    <tr key={key}>
      <td>{label}</td>
      <td>
        <input type="text" size={40} name={`item_base_${key}`} list={list} value={form.base[key]} onChange={(e) => setBase(key, e.target.value)} required={required} disabled={locked} />
      </td>
    </tr>
  )
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
                        {KINDS.map((kind) => (
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

                {form.kind === 'b' && (
                  <>
                    {functionField('input', t('editor.base.input'), 'type_functions', true, editing)}
                    {functionField('output', t('editor.base.output'), 'type_functions', true, editing)}
                    {functionField('receive', t('editor.base.receive'), 'type_functions')}
                    {functionField('send', t('editor.base.send'), 'type_functions')}
                    {functionField('typmodIn', t('editor.base.typmod_in'), 'type_typmodin')}
                    {functionField('typmodOut', t('editor.base.typmod_out'), 'type_typmodout')}
                    {functionField('analyze', t('editor.base.analyze'), 'type_functions')}
                    {options.version >= 140000 && functionField('subscript', t('editor.base.subscript'), 'type_functions')}
                    <tr>
                      <td>{t('editor.base.internal_length')}</td>
                      <td>
                        <input type="number" min={-2} name="item_base_internallength" value={form.base.internalLength} onChange={(e) => setBase('internalLength', e.target.value)} disabled={editing} placeholder="-1" />
                        <div className="form-text">{t('editor.base.internal_length_hint')}</div>
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.base.by_value')}</td>
                      <td>
                        <input type="checkbox" name="item_base_byvalue" checked={form.base.byValue} onChange={(e) => setBase('byValue', e.target.checked)} disabled={editing} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.base.alignment')}</td>
                      <td>
                        <select name="item_base_alignment" value={form.base.alignment} onChange={(e) => setBase('alignment', e.target.value)} disabled={editing}>
                          <option value="" />
                          {ALIGNMENTS.map((a) => (
                            <option key={a.value} value={a.value}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.base.storage')}</td>
                      <td>
                        <select name="item_base_storage" value={form.base.storage} onChange={(e) => setBase('storage', e.target.value)}>
                          <option value="" />
                          {STORAGES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    {!editing && (
                      <tr>
                        <td>{t('editor.base.like')}</td>
                        <td>
                          <input type="text" name="item_base_like" list="type_names" value={form.base.like} onChange={(e) => setBase('like', e.target.value)} />
                          <div className="form-text">{t('editor.base.like_hint')}</div>
                        </td>
                      </tr>
                    )}
                    <tr>
                      <td>{t('editor.base.category')}</td>
                      <td>
                        <select name="item_base_category" value={form.base.category} onChange={(e) => setBase('category', e.target.value)} disabled={editing}>
                          <option value="" />
                          {[...new Set([...CATEGORIES, form.base.category])].filter(Boolean).map((c) => (
                            <option key={c} value={c}>
                              {c} – {t(`editor.categories.${c}`, { defaultValue: c })}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.base.preferred')}</td>
                      <td>
                        <input type="checkbox" name="item_base_preferred" checked={form.base.preferred} onChange={(e) => setBase('preferred', e.target.checked)} disabled={editing} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.default')}</td>
                      <td>
                        <input type="text" name="item_base_default" value={form.base.defaultValue} onChange={(e) => setBase('defaultValue', e.target.value)} disabled={editing} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.base.element')}</td>
                      <td>
                        <input type="text" name="item_base_element" list="type_names" value={form.base.element} onChange={(e) => setBase('element', e.target.value)} disabled={editing} />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.base.delimiter')}</td>
                      <td>
                        <input type="text" name="item_base_delimiter" maxLength={1} size={2} value={form.base.delimiter} onChange={(e) => setBase('delimiter', e.target.value)} disabled={editing} placeholder="," />
                      </td>
                    </tr>
                    <tr>
                      <td>{t('editor.base.collatable')}</td>
                      <td>
                        <input type="checkbox" name="item_base_collatable" checked={form.base.collatable} onChange={(e) => setBase('collatable', e.target.checked)} disabled={editing} />
                      </td>
                    </tr>
                  </>
                )}

                {form.kind === 'p' && (
                  <tr>
                    <td />
                    <td>
                      <div className="form-text">{t('editor.shell_hint')}</div>
                    </td>
                  </tr>
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
            {form.kind === 'b' && (
              <>
                <datalist id="type_functions">
                  {options.functions.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
                <datalist id="type_typmodin">
                  {options.typmodin.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
                <datalist id="type_typmodout">
                  {options.typmodout.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </>
            )}
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

      {editing && <PrivilegesSection db={db} kind="type" oid={oid} />}
      {editing && <SecurityLabelsCard key={`${node}/${oid}`} db={db} catalog="pg_type" oid={oid} />}

      {editing && (
        <DependencyPanel
          dependencies={() => (data.domain ? domains(db, scid).dependencies(oid) : types(db, scid).dependencies(oid))}
          dependents={() => (data.domain ? domains(db, scid).dependents(oid) : types(db, scid).dependents(oid))}
          reloadKey={`${db}/${node}/${oid}`}
        />
      )}

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </div>
  )
}

