import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { createSequence, resolveSchema, resolveSequence, sequenceModifiedSql, sequenceOptions, sequences, updateSequence, type Sequence, type SequenceData } from '../api'

interface Form {
  name: string
  owner: string
  comment: string
  currentValue: string
  increment: string
  start: string
  minimum: string
  maximum: string
  cache: string
  cycled: boolean
  unlogged: boolean
  ownedTable: string
  ownedColumn: string
}

const EMPTY: Form = { name: '', owner: '', comment: '', currentValue: '', increment: '', start: '', minimum: '', maximum: '', cache: '', cycled: false, unlogged: false, ownedTable: '', ownedColumn: '' }

function fromSequence(s: Sequence): Form {
  return {
    name: s.name,
    owner: s.seqowner,
    comment: s.comment ?? '',
    currentValue: String(s.current_value),
    increment: String(s.increment),
    start: String(s.start),
    minimum: String(s.minimum),
    maximum: String(s.maximum),
    cache: String(s.cache),
    cycled: s.cycled,
    unlogged: s.relpersistence,
    ownedTable: s.owned_table ?? '',
    ownedColumn: s.owned_column ?? '',
  }
}

/**
 * The sequence editor, laid out like phpMyAdmin's routine editor: the name, owner and comment,
 * then pgAdmin's definition fields (current value, increment, start, minimum, maximum, cache,
 * cycled, unlogged) and the owning table column. Go creates or alters the sequence; Preview SQL
 * shows the statements.
 */
export default function SequenceEditor({ mode }: { mode: 'create' | 'edit' }) {
  const { t } = useTranslation('sequences')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '', sequence: name = '' } = useParams()
  const navigate = useNavigate()
  const { data, error } = useRequest(async () => {
    if (mode === 'create') {
      const scid = await resolveSchema(db, schema)

      return { scid, seid: 0, options: await sequenceOptions(db, scid), sequence: null as Sequence | null }
    }
    const { scid, seid } = await resolveSequence(db, schema, name)
    const [options, sequence] = await Promise.all([sequenceOptions(db, scid), sequences(db, scid).properties(seid)])

    return { scid, seid, options, sequence }
  }, [db, schema, name, mode])
  const [form, setForm] = useState<Form>(EMPTY)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (data) setForm(data.sequence ? fromSequence(data.sequence) : EMPTY)
  }, [data])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid, seid, options } = data
  const editing = data.sequence !== null
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const columns = options.tables.find((table) => table.name === form.ownedTable)?.columns ?? []

  function payload(): SequenceData {
    return {
      name: form.name,
      seqowner: form.owner,
      comment: form.comment,
      ...(editing ? { current_value: form.currentValue } : {}),
      increment: form.increment,
      start: form.start,
      minimum: form.minimum,
      maximum: form.maximum,
      cache: form.cache,
      cycled: form.cycled,
      relpersistence: form.unlogged,
      owned_table: form.ownedTable || null,
      owned_column: form.ownedTable ? form.ownedColumn || null : null,
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      if (editing) await updateSequence(db, scid, seid, payload())
      else await createSequence(db, scid, payload())
      notifySuccess(editing ? t('editor.altered', { name: form.name }) : t('editor.created', { name: form.name }))
      treeState.refresh()
      navigate(`${urls.schema(db, schema)}/sequences`)
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    sequenceModifiedSql(db, scid, payload(), editing ? seid : undefined).then(
      (sql) => setPreview({ sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  const numberRow = (key: 'currentValue' | 'increment' | 'start' | 'minimum' | 'maximum' | 'cache', label: string, placeholder = '') => (
    <tr>
      <td>{label}</td>
      <td>
        <input type="number" name={`item_${key}`} value={form[key]} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
      </td>
    </tr>
  )

  return (
    <div className="container-fluid my-3">
      <h2>
        <Icon name="b_events" /> {editing ? t('editor.edit_title', { name }) : t('editor.create_title')}
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
                {editing && numberRow('currentValue', t('editor.current_value'))}
                {numberRow('increment', t('editor.increment'), '1')}
                {!editing && numberRow('start', t('editor.start'))}
                {numberRow('minimum', t('editor.minimum'))}
                {numberRow('maximum', t('editor.maximum'))}
                {numberRow('cache', t('editor.cache'), '1')}
                <tr>
                  <td>{t('editor.cycled')}</td>
                  <td>
                    <input type="checkbox" name="item_cycled" checked={form.cycled} onChange={(e) => set('cycled', e.target.checked)} />
                  </td>
                </tr>
                <tr>
                  <td>{t('editor.unlogged')}</td>
                  <td>
                    <input type="checkbox" name="item_unlogged" checked={form.unlogged} onChange={(e) => set('unlogged', e.target.checked)} />
                  </td>
                </tr>
                <tr>
                  <td>{t('editor.owned_by')}</td>
                  <td>
                    <select name="item_owned_table" value={form.ownedTable} onChange={(e) => setForm((f) => ({ ...f, ownedTable: e.target.value, ownedColumn: '' }))} aria-label={t('editor.owned_table')}>
                      <option value="">{t('editor.none')}</option>
                      {options.tables.map((table) => (
                        <option key={table.name} value={table.name}>
                          {table.name}
                        </option>
                      ))}
                    </select>{' '}
                    {form.ownedTable && (
                      <select name="item_owned_column" value={form.ownedColumn} onChange={(e) => set('ownedColumn', e.target.value)} aria-label={t('editor.owned_column')} required>
                        <option value="">{t('editor.owned_column')}</option>
                        {columns.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="form-text">{t('editor.owned_by_hint')}</div>
                  </td>
                </tr>
              </tbody>
            </table>
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
