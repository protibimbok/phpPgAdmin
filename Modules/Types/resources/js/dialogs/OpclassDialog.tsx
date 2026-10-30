import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { createOpclass, opclassCreateSql, opclassOptions, typeOptions, type OpclassData, type OpclassKind, type OpclassMember, type OpclassOptions } from '../api'

export interface OpclassDialogProps {
  show: boolean
  db: string
  scid: number
  onClose: () => void
  onSaved: () => void
}

const KINDS: OpclassKind[] = ['opclass', 'opfamily', 'conversion']

const member = (type: OpclassMember['type'], number: number): OpclassMember => ({ type, number: String(number), name: '', lefttype: '', righttype: '', order_by: '' })

/** B-tree's five strategies and its comparison function, the members most classes start from. */
const BTREE: OpclassMember[] = [...[1, 2, 3, 4, 5].map((n) => member('operator', n)), member('function', 1)]

/**
 * The create form of an operator class, operator family or conversion, in the collation
 * dialog's layout: the kind, the name and comment, and the kind's fields. An operator class
 * has its access method, data type, DEFAULT, family and STORAGE, and a list of members, each an
 * operator by strategy number or a support function by support number, with optional operand
 * types and, for an ordering operator, FOR ORDER BY. A family has only its access method; a
 * conversion its encodings, function and DEFAULT. Preview SQL shows the statement.
 */
export default function OpclassDialog({ show, db, scid, onClose, onSaved }: OpclassDialogProps) {
  const { t } = useTranslation('types')
  const { t: tApp } = useTranslation()
  const [options, setOptions] = useState<OpclassOptions | null>(null)
  const [types, setTypes] = useState<string[]>([])
  const [kind, setKind] = useState<OpclassKind>('opclass')
  const [form, setForm] = useState<OpclassData>({ name: '', description: '' })
  const [members, setMembers] = useState<OpclassMember[]>(BTREE)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setKind('opclass')
    setForm({ name: '', description: '', amname: 'btree', is_default: false, source_encoding: '', target_encoding: '' })
    setMembers(BTREE)
  }, [show])

  useEffect(() => {
    if (!show || options) return
    opclassOptions(db, scid).then(setOptions, () => setOptions({ methods: [], encodings: [], families: [] }))
    typeOptions(db, scid).then((o) => setTypes(o.types.map((type) => type.name)), () => setTypes([]))
  }, [show, options, db, scid])

  const set = <K extends keyof OpclassData>(key: K, value: OpclassData[K]) => setForm((current) => ({ ...current, [key]: value }))
  const setMember = (i: number, patch: Partial<OpclassMember>) => setMembers((current) => current.map((m, j) => (j === i ? { ...m, ...patch } : m)))

  function data(): OpclassData {
    if (kind === 'opfamily') return { name: form.name, description: form.description, amname: form.amname }
    if (kind === 'conversion') return { name: form.name, description: form.description, source_encoding: form.source_encoding, target_encoding: form.target_encoding, function: form.function, is_default: form.is_default }

    return { ...form, members: members.filter((m) => m.name.trim() !== '') }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      await createOpclass(db, scid, kind, data())
      notifySuccess(t('opclasses.created', { name: form.name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    opclassCreateSql(db, scid, kind, data()).then(
      (sql) => setPreview({ sql, error: null }),
      (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
    )
  }

  const families = (options?.families ?? []).filter((f) => f.amname === form.amname)
  const text = (key: 'name' | 'for_type' | 'storage' | 'function' | 'description', label: string, props: { required?: boolean; list?: string; placeholder?: string; size?: number } = {}) => (
    <tr>
      <td>{label}</td>
      <td>
        <input type="text" name={`opc_${key}`} dir="ltr" size={props.size ?? 30} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} required={props.required} list={props.list} placeholder={props.placeholder} />
      </td>
    </tr>
  )
  const encoding = (key: 'source_encoding' | 'target_encoding', label: string) => (
    <tr>
      <td>{label}</td>
      <td>
        <select name={`opc_${key}`} value={form[key] ?? ''} onChange={(e) => set(key, e.target.value)} required>
          <option value="" />
          {(options?.encodings ?? []).map((enc) => (
            <option key={enc} value={enc}>
              {enc}
            </option>
          ))}
        </select>
      </td>
    </tr>
  )

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="opclassDialogModal"
        size="xl"
        title={t('opclasses.create_title')}
        footer={
          <>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {tApp('go')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={showPreview}>
              {tApp('preview_sql')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {tApp('close')}
            </button>
          </>
        }
      >
        <form
          className="rte_form"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <datalist id="opclassTypes">
            {types.map((type) => (
              <option key={type} value={type} />
            ))}
          </datalist>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <tr>
                <td>{t('columns.kind')}</td>
                <td>
                  <select name="opc_kind" value={kind} onChange={(e) => setKind(e.target.value as OpclassKind)}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`opclasses.kinds.${k}`)}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              {text('name', t('opclasses.name'), { required: true })}
              {kind !== 'conversion' && (
                <tr>
                  <td>{t('opclasses.method')}</td>
                  <td>
                    <select name="opc_amname" value={form.amname ?? ''} onChange={(e) => setForm((current) => ({ ...current, amname: e.target.value, family: '' }))}>
                      {(options?.methods ?? []).map((am) => (
                        <option key={am} value={am}>
                          {am}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}
              {kind === 'opclass' && (
                <>
                  {text('for_type', t('opclasses.for_type'), { required: true, list: 'opclassTypes', placeholder: 'integer' })}
                  <tr>
                    <td>{t('opclasses.family')}</td>
                    <td>
                      <select name="opc_family" value={form.family ?? ''} onChange={(e) => set('family', e.target.value)}>
                        <option value="">{t('opclasses.new_family')}</option>
                        {families.map((f) => (
                          <option key={f.name} value={f.name}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                  {text('storage', t('opclasses.storage'), { list: 'opclassTypes' })}
                </>
              )}
              {kind === 'conversion' && (
                <>
                  {encoding('source_encoding', t('opclasses.source_encoding'))}
                  {encoding('target_encoding', t('opclasses.target_encoding'))}
                  {text('function', t('opclasses.function'), { required: true, placeholder: 'iso8859_1_to_utf8' })}
                </>
              )}
              {kind !== 'opfamily' && (
                <tr>
                  <td>DEFAULT</td>
                  <td>
                    <input type="checkbox" name="opc_default" checked={Boolean(form.is_default)} onChange={(e) => set('is_default', e.target.checked)} />
                  </td>
                </tr>
              )}
              {text('description', t('columns.comment'), { size: 50 })}
            </tbody>
          </table>

          {kind === 'opclass' && (
            <fieldset>
              <legend>{t('opclasses.members')}</legend>
              <table className="table table-sm table-striped align-middle" id="opclassMembers">
                <thead>
                  <tr>
                    <th>{t('opclasses.member_type')}</th>
                    <th>{t('opclasses.number')}</th>
                    <th>{t('opclasses.member_name')}</th>
                    <th>{t('opclasses.left_type')}</th>
                    <th>{t('opclasses.right_type')}</th>
                    <th>FOR ORDER BY</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m, i) => (
                    <tr key={i}>
                      <td>
                        <select aria-label={t('opclasses.member_type')} value={m.type} onChange={(e) => setMember(i, { type: e.target.value as OpclassMember['type'], order_by: '' })}>
                          <option value="operator">OPERATOR</option>
                          <option value="function">FUNCTION</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" min={1} size={3} aria-label={t('opclasses.number')} value={m.number} onChange={(e) => setMember(i, { number: e.target.value })} />
                      </td>
                      <td>
                        <input type="text" dir="ltr" aria-label={t('opclasses.member_name')} placeholder={m.type === 'operator' ? '<' : 'btint4cmp(integer, integer)'} value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} />
                      </td>
                      <td>
                        <input type="text" dir="ltr" size={12} list="opclassTypes" aria-label={t('opclasses.left_type')} value={m.lefttype} onChange={(e) => setMember(i, { lefttype: e.target.value })} />
                      </td>
                      <td>
                        <input type="text" dir="ltr" size={12} list="opclassTypes" aria-label={t('opclasses.right_type')} value={m.righttype} onChange={(e) => setMember(i, { righttype: e.target.value })} />
                      </td>
                      <td>
                        {m.type === 'operator' && (
                          <select aria-label="FOR ORDER BY" value={m.order_by} onChange={(e) => setMember(i, { order_by: e.target.value })}>
                            <option value="" />
                            {(options?.families ?? []).filter((f) => f.amname === 'btree').map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td>
                        <a href="#remove" onClick={(e) => { e.preventDefault(); setMembers((current) => current.filter((_, j) => j !== i)) }}>
                          {t('opclasses.remove')}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <input type="button" className="btn btn-secondary me-2" value={t('opclasses.add_operator')} onClick={() => setMembers((current) => [...current, member('operator', current.filter((m) => m.type === 'operator').length + 1)])} />
              <input type="button" className="btn btn-secondary" value={t('opclasses.add_function')} onClick={() => setMembers((current) => [...current, member('function', current.filter((m) => m.type === 'function').length + 1)])} />
              <div className="form-text">{t('opclasses.members_hint')}</div>
            </fieldset>
          )}
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
