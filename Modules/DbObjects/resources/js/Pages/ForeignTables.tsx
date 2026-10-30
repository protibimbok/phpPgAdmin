import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import ObjectSection from '@/components/ObjectSection'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { urls } from '@/level'
import { resolve } from '@/nodes/client'
import { notifyError, notifySuccess } from '@/notify'
import { quoteIdent } from '@sql/js/sql'
import { PrivilegesAction, PrivilegesModal } from '@roles/js/PrivilegesSection'
import { foreignTableOptions, foreignTables, importForeignSchema, importForeignSchemaSql, type ForeignSchemaImport, type ForeignTable } from '../api'
import NodeDialog, { type Field, type Values } from '../dialogs/NodeDialog'

/**
 * A schema's Foreign tables page, after pgAdmin's foreign table node: the list with each
 * table's server, columns, options and comment, Browse (its rows on the schema's SQL page),
 * Edit, Export and Drop, and the dialog that creates or alters one: name, owner, server,
 * options, comment and the columns. ?open=<oid> opens a table's dialog on arrival, which is
 * how the navigation panel reaches it.
 */
export default function ForeignTables() {
  const { db = '', schema = '' } = useParams()
  const { t } = useTranslation('dbobjects')
  const { t: tApp } = useTranslation()
  const [search, setSearch] = useSearchParams()
  const { data, error, reload } = useRequest(async () => {
    const scid = (await resolve(db, 'schema', { name: schema })).scid
    const [rows, options] = await Promise.all([foreignTables(db, scid).list(), foreignTableOptions(db, scid)])

    return { scid, rows, options }
  }, [db, schema])
  const [editing, setEditing] = useState<{ row: ForeignTable | null } | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const [confirm, setConfirm] = useState<{ sql: string[]; rows: ForeignTable[] } | null>(null)
  const [cascade, setCascade] = useState(false)
  const [privileges, setPrivileges] = useState<ForeignTable | null>(null)
  const [importing, setImporting] = useState(false)

  const open = search.get('open')
  useEffect(() => {
    if (!data || !open) return
    const row = data.rows.find((r) => String(r.oid) === open)
    if (row) setEditing({ row })
    setSearch(
      (params) => {
        params.delete('open')
        return params
      },
      { replace: true },
    )
  }, [data, open, setSearch])

  if (error) {
    return (
      <div className="container-fluid">
        <div className="alert alert-danger my-3" role="alert">
          {error.message}
        </div>
      </div>
    )
  }
  if (!data) return null

  const collection = foreignTables(db, data.scid)
  const qualified = (name: string) => `${quoteIdent(schema)}.${quoteIdent(name)}`
  const changed = () => {
    treeState.refresh()
    reload()
  }

  function exportSql(rows: ForeignTable[]) {
    setExported({ title: rows.length === 1 ? t('export_title', { name: rows[0].name }) : t('export_title_many'), sql: null })
    Promise.all(rows.map((row) => collection.sql(row.oid))).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  async function drop(rows: ForeignTable[]) {
    try {
      for (const row of rows) await collection.remove(row.oid, cascade)
      notifySuccess(rows.length === 1 ? t('dropped', { name: rows[0].name }) : t('dropped_many', { count: rows.length }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      changed()
    }
  }

  const row = editing?.row ?? null
  const fields: Field[] = [
    { key: 'name', label: t('fields.name'), kind: 'text', required: true },
    { key: 'owner', label: t('fields.owner'), kind: 'select', options: data.options.roles.map((r) => ({ value: r, label: r })), empty: t('current_role') },
    { key: 'ftsrvname', label: t('fields.server'), kind: 'select', options: data.options.servers.map((s) => ({ value: s, label: s })), empty: '', readOnly: row !== null, required: true, hint: data.options.servers.length === 0 ? t('foreign_table.no_servers') : undefined },
    { key: 'ftoptions', label: t('fields.options'), kind: 'options', hint: t('foreign_table.options_hint') },
    { key: 'description', label: t('fields.comment'), kind: 'textarea' },
    { key: 'columns', label: t('fields.columns'), kind: 'columns' },
  ]
  const initial: Values = {
    name: row?.name ?? '',
    owner: row?.owner ?? '',
    ftsrvname: row?.ftsrvname ?? data.options.servers[0] ?? '',
    ftoptions: row?.ftoptions ?? [],
    description: row?.description ?? '',
    columns: (row?.columns ?? []).filter((c) => c.inheritedfrom === null).map(({ attnum, name, cltype, attnotnull, defval, coloptions }) => ({ attnum, name, cltype, attnotnull, defval, coloptions })),
  }

  // IMPORT FOREIGN SCHEMA: the foreign tables of a remote schema created in one statement.
  const importFields: Field[] = [
    { key: 'server', label: t('fields.server'), kind: 'select', options: data.options.servers.map((s) => ({ value: s, label: s })), empty: '', required: true, hint: data.options.servers.length === 0 ? t('foreign_table.no_servers') : undefined },
    { key: 'remote_schema', label: t('import_schema.remote_schema'), kind: 'text', required: true, placeholder: 'public' },
    {
      key: 'mode',
      label: t('import_schema.mode'),
      kind: 'select',
      options: [
        { value: 'all', label: t('import_schema.mode_all') },
        { value: 'limit', label: t('import_schema.mode_limit') },
        { value: 'except', label: t('import_schema.mode_except') },
      ],
    },
    { key: 'tables', label: t('import_schema.tables'), kind: 'textarea', visible: (v) => v.mode !== 'all', hint: t('import_schema.tables_hint') },
    { key: 'into', label: t('import_schema.into'), kind: 'select', options: [...new Set([schema, ...data.options.schemas])].map((s) => ({ value: s, label: s })), required: true },
    { key: 'options', label: t('fields.options'), kind: 'options', hint: t('import_schema.options_hint') },
  ]
  const importInitial: Values = { server: data.options.servers[0] ?? '', remote_schema: '', mode: 'all', tables: '', into: schema, options: [] }
  const importData = (values: Values) => values as unknown as ForeignSchemaImport

  return (
    <>
      <ObjectSection<ForeignTable>
        id="foreign_tables"
        icon="s_link"
        title={t('foreign_table.title')}
        rows={data.rows}
        empty={t('foreign_table.none')}
        createLabel={t('foreign_table.create')}
        createIcon="b_table_add"
        onCreate={() => setEditing({ row: null })}
        columns={[
          {
            label: t('columns.browse'),
            render: (r) => (
              <Link to={`${urls.schema(db, schema)}/sql?${new URLSearchParams({ sql: `SELECT * FROM ${qualified(r.name)};`, run: '1' })}`}>
                {t('actions.browse')}
              </Link>
            ),
          },
          { label: t('columns.server'), render: (r) => r.ftsrvname },
          { label: t('columns.columns'), render: (r) => r.columns.map((c) => `${c.name} ${c.cltype}`).join(', ') },
          { label: t('columns.options'), render: (r) => r.ftoptions.map((o) => `${o.option} '${o.value}'`).join(', ') },
          { label: t('columns.comment'), render: (r) => r.description },
          // Table privileges, and those of its columns, as on a table's Privileges tab.
          { label: '', render: (r) => <PrivilegesAction onClick={() => setPrivileges(r)} /> },
        ]}
        onEdit={(r) => setEditing({ row: r })}
        onExport={exportSql}
        onDrop={(rows) => {
          setCascade(false)
          setConfirm({ sql: rows.map((r) => `DROP FOREIGN TABLE ${qualified(r.name)};`), rows })
        }}
        noneSelected={t('none_selected')}
        labels={{ name: t('columns.name'), edit: t('actions.edit'), export: t('actions.export'), drop: t('actions.drop') }}
        actions={
          <button type="button" className="ajax btn btn-secondary ms-2" id="import_foreign_schema" onClick={() => setImporting(true)}>
            <Icon name="b_import" /> {t('import_schema.button')}
          </button>
        }
      />

      <NodeDialog
        show={importing}
        id="importForeignSchemaDialog"
        title={t('import_schema.title')}
        fields={importFields}
        initial={importInitial}
        save={(values) => importForeignSchema(db, data.scid, importData(values))}
        preview={(values) => importForeignSchemaSql(db, data.scid, importData(values))}
        savedMessage={(values) => t('import_schema.done', { schema: String(values.remote_schema), into: String(values.into) })}
        onClose={() => setImporting(false)}
        onSaved={() => {
          setImporting(false)
          changed()
        }}
      />

      <NodeDialog
        show={editing !== null}
        id="foreign_tableDialog"
        title={row ? t('foreign_table.edit_title', { name: row.name }) : t('foreign_table.create_title')}
        fields={fields}
        initial={initial}
        save={(values) => (row ? collection.update(row.oid, values) : collection.create(values))}
        preview={(values) => collection.modifiedSql(values, row?.oid)}
        savedMessage={(values) => (row ? t('altered', { name: values.name }) : t('created', { name: values.name }))}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          changed()
        }}
      />

      <PrivilegesModal db={db} target={privileges && { kind: 'table', oid: privileges.oid, name: `${schema}.${privileges.name}` }} onClose={() => setPrivileges(null)} />

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>

      <ConfirmQuery
        show={confirm !== null}
        sql={(confirm?.sql ?? []).map((s) => (cascade ? s.replace(/;$/, ' CASCADE;') : s))}
        confirmLabel={tApp('ok')}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm
          setConfirm(null)
          if (pending) void drop(pending.rows)
        }}
      >
        <div className="form-check mt-2">
          <input className="form-check-input" type="checkbox" id="confirm_cascade" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
          <label className="form-check-label" htmlFor="confirm_cascade">
            {t('cascade')}
          </label>
        </div>
      </ConfirmQuery>
    </>
  )
}
