import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { quoteIdent } from '@sql/js/sql'
import { createSchema, dropSchema, listSchemas, schemaOptions, type Schema } from '../api'

/**
 * A database's "Structure" page: its schemas, laid out like phpMyAdmin's list of a database's
 * tables (database/structure/index.twig): a checkbox column, the name linking to the schema,
 * action icons (Structure, Browse, Operations, Drop), then the details, a summary row at the
 * foot, the "With selected" bar and the create card. A drop asks first, with a CASCADE box.
 */
export default function Structure() {
  const { t } = useTranslation('schemas')
  const { t: tApp } = useTranslation()
  const db = useParams().db ?? ''
  const { data: schemas, error, reload } = useRequest(() => listSchemas(db), [db])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [dropping, setDropping] = useState<Schema[] | null>(null)
  const [cascade, setCascade] = useState(false)

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (schemas === undefined) {
    return null
  }

  const changed = () => {
    reload()
    treeState.refresh()
  }

  function toggle(oid: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(oid)
      else next.delete(oid)

      return next
    })
  }

  function askDrop(selected: Schema[]) {
    if (selected.length === 0) {
      notify(t('drop.none_selected'), 'error')

      return
    }
    setCascade(false)
    setDropping(selected)
  }

  async function drop(selected: Schema[]) {
    setDropping(null)
    let dropped = 0
    try {
      for (const schema of selected) {
        await dropSchema(db, schema.oid, cascade)
        dropped++
      }
      notifySuccess(selected.length === 1 ? t('drop.dropped', { name: selected[0].name }) : t('drop.dropped_count', { count: dropped }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setChecked(new Set())
      changed()
    }
  }

  const allChecked = schemas.length > 0 && schemas.every((schema) => checked.has(schema.oid))

  return (
    <>
      {schemas.length === 0 ? (
        <div className="alert alert-primary" role="alert">
          {t('none')}
        </div>
      ) : (
        <form name="schemasForm" id="schemasForm" onSubmit={(e) => e.preventDefault()}>
          <div id="tableslistcontainer">
            <div className="table-responsive">
              <table className="table table-striped table-hover table-sm w-auto data">
                <thead>
                  <tr>
                    <th className="d-print-none">
                      <input type="checkbox" className="checkall_box" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(schemas.map((s) => s.oid)) : new Set())} aria-label={tApp('check_all')} />
                    </th>
                    <th>{t('columns.schema')}</th>
                    <th colSpan={4} className="d-print-none">
                      {t('columns.action')}
                    </th>
                    <th>{t('columns.owner')}</th>
                    <th>{t('columns.comment')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schemas.map((schema) => {
                    const href = urls.schema(db, schema.name)

                    return (
                      <tr key={schema.oid}>
                        <td className="text-center d-print-none">
                          <input type="checkbox" className="checkall" name="selected_schema[]" value={schema.name} checked={checked.has(schema.oid)} onChange={(e) => toggle(schema.oid, e.target.checked)} />
                        </td>
                        <th>
                          <Link to={href}>{schema.name}</Link>
                          {schema.is_sys_obj && <span className="badge bg-secondary ms-2">{t('system')}</span>}
                        </th>
                        <td className="text-center d-print-none">
                          <Link to={href}>
                            <Icon name="b_props" title={t('actions.structure')} /> {t('actions.structure')}
                          </Link>
                        </td>
                        <td className="text-center d-print-none">
                          <Link to={href}>
                            <Icon name="b_browse" title={t('actions.browse')} /> {t('actions.browse')}
                          </Link>
                        </td>
                        <td className="text-center d-print-none">
                          <Link to={`${href}/operations`}>
                            <Icon name="b_tblops" title={t('actions.operations')} /> {t('actions.operations')}
                          </Link>
                        </td>
                        <td className="text-center d-print-none">
                          <a href="#drop" className="drop_schema_anchor" onClick={(e) => { e.preventDefault(); askDrop([schema]) }}>
                            <Icon name="b_drop" title={t('actions.drop')} /> {t('actions.drop')}
                          </a>
                        </td>
                        <td>{schema.namespaceowner}</td>
                        <td>{schema.description}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot id="tbl_summary_row">
                  <tr>
                    <th className="d-print-none" />
                    <th className="tbl_num text-nowrap">{t('total', { count: schemas.length })}</th>
                    <th colSpan={6} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="clearfloat d-print-none">
            <Icon name="select_all_arrow" title={tApp('with_selected')} />
            <input type="checkbox" id="schemasForm_checkall" className="checkall_box" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(schemas.map((s) => s.oid)) : new Set())} />{' '}
            <label htmlFor="schemasForm_checkall">{tApp('check_all')}</label>
            <select
              name="submit_mult"
              className="my-0"
              style={{ marginInline: '3em' }}
              aria-label={tApp('with_selected')}
              value=""
              onChange={(e) => {
                if (e.target.value === 'drop') askDrop(schemas.filter((s) => checked.has(s.oid)))
              }}
            >
              <option value="">{tApp('with_selected')}</option>
              <option value="drop">{tApp('drop')}</option>
            </select>
          </div>
        </form>
      )}

      <hr />
      <p className="d-print-none">
        <button type="button" className="btn btn-link p-0 jsPrintButton" onClick={() => window.print()}>
          <Icon name="b_print" /> {tApp('print')}
        </button>{' '}
        <Link to={`${urls.database(db)}/data-dictionary`} id="data_dictionary_link">
          <Icon name="b_tblanalyse" /> {t('data_dictionary.title')}
        </Link>
      </p>

      <CreateSchemaCard db={db} onCreated={changed} />

      <ConfirmQuery
        show={dropping !== null}
        sql={(dropping ?? []).map((schema) => `DROP SCHEMA ${quoteIdent(schema.name)}${cascade ? ' CASCADE' : ''};`)}
        confirmLabel={tApp('drop')}
        confirmClass="btn-danger"
        onClose={() => setDropping(null)}
        onConfirm={() => dropping && void drop(dropping)}
      >
        <div className="form-check mt-3">
          <input className="form-check-input" type="checkbox" id="dropSchemaCascade" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
          <label className="form-check-label" htmlFor="dropSchemaCascade">
            {t('drop.cascade')}
          </label>
        </div>
      </ConfirmQuery>
    </>
  )
}

/** A card like phpMyAdmin's "Create new table" (database/create_table.twig): the name, the owner, the comment (as the classic phpPgAdmin's form had) and Create in one row. */
function CreateSchemaCard({ db, onCreated }: { db: string; onCreated: () => void }) {
  const { t } = useTranslation('schemas')
  const { data: options } = useRequest(() => schemaOptions(db), [db])
  const [name, setName] = useState('')
  const [owner, setOwner] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await createSchema(db, { name, namespaceowner: owner || undefined, description: comment || undefined })
      notifySuccess(t('create.created', { name }))
      setName('')
      setComment('')
      onCreated()
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form id="createSchemaMinimalForm" className="card d-print-none" onSubmit={submit}>
      <div className="card-header">
        <Icon name="b_newdb" /> {t('create.title')}
      </div>
      <div className="card-body row row-cols-lg-auto g-3">
        <div className="col-12">
          <label htmlFor="createSchemaNameInput" className="form-label">
            {t('create.name')}
          </label>
          <input autoComplete="off" type="text" className="form-control" id="createSchemaNameInput" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="col-12">
          <label htmlFor="createSchemaOwnerSelect" className="form-label">
            {t('create.owner')}
          </label>
          <select className="form-select" id="createSchemaOwnerSelect" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="" />
            {(options?.roles ?? []).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        <div className="col-12">
          <label htmlFor="createSchemaCommentInput" className="form-label">
            {t('create.comment')}
          </label>
          <input autoComplete="off" type="text" className="form-control" id="createSchemaCommentInput" maxLength={2048} value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
        <div className="col-12 align-self-lg-end">
          <input className="btn btn-primary" type="submit" value={t('create.create')} disabled={busy} />
        </div>
      </div>
    </form>
  )
}
