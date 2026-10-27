import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { format } from 'sql-formatter'
import { errorMessage } from '@/api/request'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import type { TreeNode } from '@/nodes/client'
import SqlEditor from '@sql/js/editor/SqlEditor'
import { createView, resolveSchema, updateView, viewModifiedSql, viewOptions, type AnyView, type AnyViewData, type MaterializedView, type ViewKind, type ViewOptions } from './api'

export interface ViewFormProps {
  db: string
  /** The schema the view is (to be) in; in create mode the form offers the others too. */
  schema: string
  /** Editing an existing view: its properties and kind; creating: null. */
  view?: { kind: ViewKind; properties: AnyView } | null
  /** The definition to start from when creating: the query the result came from. */
  initialSql?: string
  /** Called with the saved view's node, kind and schema. */
  onSaved: (node: TreeNode, kind: ViewKind, schema: string) => void
  /** Rendered inside a modal: the form's own Go button is left out and submitted from outside. */
  formId?: string
  inModal?: boolean
}

const CHECK_OPTIONS = ['', 'CASCADED', 'LOCAL'] as const

/**
 * phpMyAdmin's view_create.twig: the "Create view" / "Edit view" details table with OR REPLACE,
 * the name, the column names, the AS box with its Format button and WITH CHECK OPTION. The
 * MySQL rows (ALGORITHM, DEFINER, SQL SECURITY) give way to PostgreSQL's: the schema, a
 * materialized view (with its tablespace and WITH DATA) and the security barrier. Go creates or
 * alters the view through its node; Preview SQL shows what it would run.
 */
export default function ViewForm({ db, schema, view = null, initialSql = '', onSaved, formId = 'view_form', inModal = false }: ViewFormProps) {
  const { t } = useTranslation('views')
  const { t: tApp } = useTranslation()
  const editing = view !== null
  const [kind, setKind] = useState<ViewKind>(view?.kind ?? 'view')
  const [targetSchema, setTargetSchema] = useState(schema)
  const [orReplace, setOrReplace] = useState(false)
  const [name, setName] = useState(view?.properties.name ?? '')
  const [columnNames, setColumnNames] = useState('')
  // pg_get_viewdef ends the definition with a semicolon the form does not want.
  const [definition, setDefinition] = useState(view ? view.properties.definition.replace(/;\s*$/, '') : initialSql)
  const [checkOption, setCheckOption] = useState(view && view.kind === 'view' && 'check_option' in view.properties ? (view.properties.check_option ?? '').toUpperCase() : '')
  const [securityBarrier, setSecurityBarrier] = useState(view && view.kind === 'view' && 'security_barrier' in view.properties ? Boolean(view.properties.security_barrier) : false)
  const [withData, setWithData] = useState(view && view.kind === 'mview' ? (view.properties as MaterializedView).with_data : true)
  const [tablespace, setTablespace] = useState(view && view.kind === 'mview' ? ((view.properties as MaterializedView).spcname ?? '') : '')
  const [options, setOptions] = useState<ViewOptions | null>(null)
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setTargetSchema(schema)
  }, [schema])

  useEffect(() => {
    resolveSchema(db, schema)
      .then((scid) => viewOptions(db, scid))
      .then(setOptions, () => setOptions(null))
  }, [db, schema])

  /** The data the templates take, as pgAdmin names the fields. */
  function data(): AnyViewData {
    const base: AnyViewData = { definition }
    if (!editing) {
      base.name = name
      if (columnNames.trim() !== '') base.column_names = columnNames
    }
    if (kind === 'view') {
      return {
        ...base,
        ...(editing ? {} : { or_replace: orReplace }),
        check_option: checkOption === '' ? 'no' : checkOption.toLowerCase(),
        security_barrier: securityBarrier,
      }
    }

    return { ...base, with_data: withData, ...(tablespace !== '' ? { spcname: tablespace } : {}) }
  }

  async function save(e?: FormEvent) {
    e?.preventDefault()
    if (saving) return
    setSaving(true)
    setMessage(null)
    try {
      const scid = await resolveSchema(db, targetSchema)
      const node = editing ? await updateView(db, scid, view.properties.oid, kind, data()) : await createView(db, scid, kind, data())
      notifySuccess(editing ? t('form.altered', { name: node.label }) : t('form.created', { name: node.label }))
      treeState.refresh()
      onSaved(node, kind, targetSchema)
    } catch (err) {
      const text = errorMessage(err)
      setMessage(text)
      notifyError(text)
    } finally {
      setSaving(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    resolveSchema(db, targetSchema)
      .then((scid) => viewModifiedSql(db, scid, kind, data(), editing ? view.properties.oid : undefined))
      .then(
        (sql) => setPreview({ sql, error: null }),
        (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
      )
  }

  function formatDefinition() {
    try {
      setDefinition(format(definition, { language: 'postgresql', keywordCase: 'upper' }))
      setMessage(null)
    } catch (err) {
      setMessage(errorMessage(err))
    }
  }

  const legend = inModal ? t('form.details') : editing ? t('form.edit_title') : t('form.create_title')

  return (
    <div id="div_view_options">
      <form id={formId} onSubmit={save}>
        <fieldset className="pma-fieldset">
          <legend>{legend}</legend>
          <table className="table align-middle rte_table">
            <tbody>
              {!editing && (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="view_schema">{t('form.schema')}</label>
                  </td>
                  <td>
                    <select id="view_schema" name="view[schema]" value={targetSchema} onChange={(e) => setTargetSchema(e.target.value)}>
                      {[...new Set([schema, ...(options?.schemas ?? [])])].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}
              {!editing && (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="view_materialized">{t('form.materialized')}</label>
                  </td>
                  <td>
                    <input type="checkbox" id="view_materialized" name="view[materialized]" checked={kind === 'mview'} onChange={(e) => setKind(e.target.checked ? 'mview' : 'view')} value="1" />
                  </td>
                </tr>
              )}
              {!editing && kind === 'view' && (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="or_replace">OR REPLACE</label>
                  </td>
                  <td>
                    <input type="checkbox" name="view[or_replace]" id="or_replace" checked={orReplace} onChange={(e) => setOrReplace(e.target.checked)} value="1" />
                  </td>
                </tr>
              )}
              {!editing ? (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="view_name">{t('form.name')}</label>
                  </td>
                  <td>
                    <input type="text" size={20} id="view_name" name="view[name]" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} required />
                  </td>
                </tr>
              ) : (
                <tr>
                  <td className="text-nowrap">{t('form.name')}</td>
                  <td>
                    <input type="hidden" name="view[name]" value={name} />
                    <bdi>{schema}.{name}</bdi>
                  </td>
                </tr>
              )}
              {!editing && (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="view_column_names">{t('form.column_names')}</label>
                  </td>
                  <td>
                    <input type="text" maxLength={1000} size={50} id="view_column_names" name="view[column_names]" value={columnNames} onChange={(e) => setColumnNames(e.target.value)} onFocus={(e) => e.target.select()} placeholder={t('form.column_names_hint')} />
                  </td>
                </tr>
              )}
              <tr>
                <td className="text-nowrap">AS</td>
                <td>
                  <SqlEditor id="view_as" value={definition} onChange={setDefinition} onSubmit={() => void save()} ariaLabel="AS" className="view-as" />
                  <input type="button" value={t('form.format')} id="format" className="btn btn-secondary button sqlbutton mt-1" onClick={formatDefinition} />{' '}
                  <span id="querymessage" className="text-danger">
                    {message}
                  </span>
                </td>
              </tr>
              {kind === 'view' && (
                <tr>
                  <td className="text-nowrap">WITH CHECK OPTION</td>
                  <td>
                    <select name="view[with]" aria-label="WITH CHECK OPTION" value={checkOption} onChange={(e) => setCheckOption(e.target.value)}>
                      {CHECK_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}
              {kind === 'view' && (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="view_security_barrier">{t('form.security_barrier')}</label>
                  </td>
                  <td>
                    <input type="checkbox" id="view_security_barrier" name="view[security_barrier]" checked={securityBarrier} onChange={(e) => setSecurityBarrier(e.target.checked)} value="1" />
                  </td>
                </tr>
              )}
              {kind === 'mview' && (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="view_tablespace">{t('form.tablespace')}</label>
                  </td>
                  <td>
                    <select id="view_tablespace" name="view[spcname]" value={tablespace} onChange={(e) => setTablespace(e.target.value)}>
                      <option value="">{t('form.default_tablespace')}</option>
                      {(options?.tablespaces ?? []).map((space) => (
                        <option key={space} value={space}>
                          {space}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}
              {kind === 'mview' && (
                <tr>
                  <td className="text-nowrap">
                    <label htmlFor="view_with_data">WITH DATA</label>
                  </td>
                  <td>
                    <input type="checkbox" id="view_with_data" name="view[with_data]" checked={withData} onChange={(e) => setWithData(e.target.checked)} value="1" />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </fieldset>

        {!inModal && (
          <>
            <input type="button" className="btn btn-secondary preview_sql me-2" value={tApp('preview_sql')} onClick={showPreview} />
            <input type="submit" className="btn btn-primary" value={tApp('go')} disabled={saving} />
          </>
        )}
      </form>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </div>
  )
}
