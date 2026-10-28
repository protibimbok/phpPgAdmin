import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { publicationColumns, publicationOptions, publications, type Publication, type PublicationData, type PublicationOptions, type PublishedTable } from '../api'

export interface PublicationDialogProps {
  show: boolean
  db: string
  publication: Publication | null
  onClose: () => void
  onSaved: () => void
}

const EVENTS = ['insert', 'update', 'delete', 'truncate'] as const

/**
 * The publication editor after pgAdmin's publication dialog, in the trigger editor's dialog
 * layout: the name, owner and comment; FOR ALL TABLES or the tables (each, from PostgreSQL 15,
 * with a column list and a row filter) and the schemas whose tables it publishes; the events
 * it publishes and publish_via_partition_root. PostgreSQL cannot turn FOR ALL TABLES on or off
 * afterwards, so an existing publication shows it read-only.
 */
export default function PublicationDialog({ show, db, publication, onClose, onSaved }: PublicationDialogProps) {
  const { t } = useTranslation('replication')
  const { t: tApp } = useTranslation()
  const [options, setOptions] = useState<PublicationOptions | null>(null)
  const [columns, setColumns] = useState<Record<number, string[]>>({})
  const [form, setForm] = useState<PublicationData>(blank())
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setForm(
      publication
        ? {
            name: publication.name,
            pubowner: publication.pubowner,
            description: publication.description ?? '',
            all_table: publication.all_table,
            only_table: false,
            evnt_insert: publication.evnt_insert,
            evnt_update: publication.evnt_update,
            evnt_delete: publication.evnt_delete,
            evnt_truncate: publication.evnt_truncate,
            publish_via_partition_root: publication.publish_via_partition_root,
            pubtable: publication.pubtable.map((p) => ({ tid: p.tid, columns: p.columns, where: p.where ?? '' })),
            pubschema: publication.pubschema,
          }
        : blank(),
    )
    publicationOptions(db).then(setOptions, () => setOptions({ tables: [], schemas: [], roles: [], version: 0 }))
  }, [show, publication, db])

  const filters = (options?.version ?? 0) >= 150000
  const tables = form.pubtable ?? []

  // The column lists of the chosen tables, fetched once each.
  useEffect(() => {
    if (!show || !filters) return
    for (const table of tables) {
      if (table.tid > 0 && columns[table.tid] === undefined) {
        setColumns((c) => ({ ...c, [table.tid]: [] }))
        publicationColumns(db, table.tid).then((list) => setColumns((c) => ({ ...c, [table.tid]: list })), () => undefined)
      }
    }
  }, [show, filters, tables, columns, db])

  const set = (patch: Partial<PublicationData>) => setForm((f) => ({ ...f, ...patch }))
  const setTable = (index: number, patch: Partial<PublishedTable>) => set({ pubtable: tables.map((table, i) => (i === index ? { ...table, ...patch } : table)) })

  function data(): PublicationData {
    const pubtable = form.all_table ? [] : tables.filter((table) => table.tid > 0)

    return publication ? { ...form, all_table: undefined, pubtable, pubschema: form.all_table ? [] : form.pubschema } : { ...form, pubtable }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (publication) await publications(db).update(publication.oid, data())
      else await publications(db).create(data())
      notifySuccess(publication ? t('publications.altered', { name: form.name }) : t('publications.created', { name: form.name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    publications(db)
      .modifiedSql(data(), publication?.oid)
      .then(
        (sql) => setPreview({ sql: sql || tApp('nothing_to_change'), error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="publicationDialogModal"
        size="lg"
        title={publication ? t('publications.edit_title', { name: publication.name }) : t('publications.create_title')}
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
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <tr>
                <td>{t('columns.name')}</td>
                <td>
                  <input type="text" name="publication_name" maxLength={63} value={form.name} onChange={(e) => set({ name: e.target.value })} required />
                </td>
              </tr>
              <tr>
                <td>{t('columns.owner')}</td>
                <td>
                  <select name="publication_owner" value={form.pubowner} onChange={(e) => set({ pubowner: e.target.value })}>
                    <option value="">{t('current_role')}</option>
                    {(options?.roles ?? []).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <td>{t('publications.all_tables')}</td>
                <td>
                  {publication ? (
                    <input type="text" value={form.all_table ? tApp('yes') : tApp('no')} readOnly />
                  ) : (
                    <input type="checkbox" name="all_table" checked={form.all_table ?? false} onChange={(e) => set({ all_table: e.target.checked })} />
                  )}
                </td>
              </tr>
              {!form.all_table && (
                <>
                  <tr>
                    <td>{t('publications.tables')}</td>
                    <td>
                      <table className="table table-sm w-auto mb-1">
                        {filters && tables.length > 0 && (
                          <thead>
                            <tr>
                              <th>{t('publications.table')}</th>
                              <th>{t('publications.column_list')}</th>
                              <th>{t('publications.row_filter')}</th>
                              <th />
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {tables.map((table, index) => (
                            <tr key={index}>
                              <td>
                                <select name={`pubtable_${index}`} value={table.tid} onChange={(e) => setTable(index, { tid: Number(e.target.value), columns: [] })}>
                                  <option value={0} />
                                  {(options?.tables ?? []).map((o) => (
                                    <option key={o.tid} value={o.tid}>
                                      {o.table}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              {filters && (
                                <>
                                  <td>
                                    <select multiple size={3} name={`pubtable_columns_${index}`} value={table.columns} onChange={(e) => setTable(index, { columns: Array.from(e.target.selectedOptions, (o) => o.value) })} title={t('publications.all_columns_hint')}>
                                      {(columns[table.tid] ?? []).map((column) => (
                                        <option key={column} value={column}>
                                          {column}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    <input type="text" name={`pubtable_where_${index}`} dir="ltr" value={table.where ?? ''} onChange={(e) => setTable(index, { where: e.target.value })} placeholder="id > 0" />
                                  </td>
                                </>
                              )}
                              <td>
                                <a href="#remove" onClick={(e) => { e.preventDefault(); set({ pubtable: tables.filter((_, i) => i !== index) }) }}>
                                  <Icon name="b_drop" /> {t('publications.remove')}
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ pubtable: [...tables, { tid: 0, columns: [], where: '' }] })}>
                        {t('publications.add_table')}
                      </button>
                      {filters && <div className="form-text">{t('publications.all_columns_hint')}</div>}
                    </td>
                  </tr>
                  <tr>
                    <td>{t('publications.only')}</td>
                    <td>
                      <input type="checkbox" name="only_table" checked={form.only_table} onChange={(e) => set({ only_table: e.target.checked })} />
                    </td>
                  </tr>
                  {filters && (
                    <tr>
                      <td>{t('publications.schemas')}</td>
                      <td>
                        <select multiple size={4} name="pubschema" value={form.pubschema ?? []} onChange={(e) => set({ pubschema: Array.from(e.target.selectedOptions, (o) => o.value) })}>
                          {(options?.schemas ?? []).map((schema) => (
                            <option key={schema} value={schema}>
                              {schema}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )}
                </>
              )}
              <tr>
                <td>{t('publications.publish')}</td>
                <td>
                  {EVENTS.map((event) => (
                    <label key={event} className="me-3">
                      <input type="checkbox" name={`evnt_${event}`} checked={form[`evnt_${event}`]} onChange={(e) => set({ [`evnt_${event}`]: e.target.checked })} /> {event.toUpperCase()}
                    </label>
                  ))}
                </td>
              </tr>
              <tr>
                <td>{t('publications.via_root')}</td>
                <td>
                  <input type="checkbox" name="publish_via_partition_root" checked={form.publish_via_partition_root} onChange={(e) => set({ publish_via_partition_root: e.target.checked })} />
                </td>
              </tr>
              <tr>
                <td>{t('columns.comment')}</td>
                <td>
                  <input type="text" name="publication_comment" size={50} value={form.description} onChange={(e) => set({ description: e.target.value })} />
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}

function blank(): PublicationData {
  return {
    name: '',
    pubowner: '',
    description: '',
    all_table: false,
    only_table: false,
    evnt_insert: true,
    evnt_update: true,
    evnt_delete: true,
    evnt_truncate: true,
    publish_via_partition_root: false,
    pubtable: [],
    pubschema: [],
  }
}
