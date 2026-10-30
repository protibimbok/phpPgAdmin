import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Modal from '@/components/Modal'
import ObjectSection from '@/components/ObjectSection'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { quoteIdent } from '@sql/js/sql'
import { PrivilegesAction, PrivilegesModal } from '@roles/js/PrivilegesSection'
import type { PrivilegeKind } from '@roles/js/api'
import {
  castOptions,
  casts,
  eventTriggerOptions,
  eventTriggers,
  extensionOptions,
  extensions,
  foreignDataWrapperOptions,
  foreignObjects,
  foreignServerOptions,
  languageOptions,
  languages,
  objectCollection,
  userMappingOptions,
  type Cast,
  type CastOptions,
  type EventTrigger,
  type EventTriggerOptions,
  type Extension,
  type ExtensionOptions,
  type ForeignDataWrapper,
  type ForeignDataWrapperOptions,
  type ForeignServer,
  type Language,
  type LanguageOptions,
  type ObjectKind,
  type UserMapping,
} from '../api'
import NodeDialog, { type Field, type OptionPair, type Values } from '../dialogs/NodeDialog'

/** A listed object, with the OIDs of the wrapper and server it is under. */
type Row = { oid: number; name: string; fid?: number; fsid?: number }

/** An open editor: the kind, and the object (null for a new one). */
type Editing =
  | { kind: 'extension'; row: Extension | null }
  | { kind: 'language'; row: Language | null }
  | { kind: 'cast'; row: Cast | null }
  | { kind: 'event_trigger'; row: EventTrigger | null }
  | { kind: 'foreign_data_wrapper'; row: ForeignDataWrapper | null }
  | { kind: 'foreign_server'; row: ForeignServer | null }
  | { kind: 'user_mapping'; row: UserMapping | null }

const STATES = ['O', 'D', 'R', 'A'] as const

/**
 * The database's Objects page: the objects that belong to no schema, after pgAdmin's database
 * nodes. Each kind (extensions, languages, casts, event triggers) is a list with Edit, Export
 * and Drop, as the Types page lists collations, and is edited in a dialog after pgAdmin's;
 * ?open=<kind>:<oid> opens one on arrival, which is how the navigation panel reaches it.
 */
export default function Objects() {
  const db = useParams().db ?? ''
  const { t } = useTranslation('dbobjects')
  const { t: tApp } = useTranslation()
  const [search, setSearch] = useSearchParams()
  const { data, error, reload } = useRequest(
    () => Promise.all([extensions(db).list(), languages(db).list(), casts(db).list(), eventTriggers(db).list(), foreignObjects(db)]).then(([e, l, c, et, f]) => ({ extensions: e, languages: l, casts: c, eventTriggers: et, ...f })),
    [db],
  )
  const [editing, setEditing] = useState<Editing | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void> } | null>(null)
  const [cascade, setCascade] = useState(false)
  const [privileges, setPrivileges] = useState<{ kind: PrivilegeKind; oid: number; name: string } | null>(null)

  // The navigation panel opens an object by OID: ?open=extension:16384.
  const open = search.get('open')
  useEffect(() => {
    if (!data || !open) return
    const [kind, oid] = open.split(':')
    const find = <R extends Row>(rows: R[]) => rows.find((r) => String(r.oid) === oid) ?? null
    if (kind === 'extension') setEditing({ kind, row: find(data.extensions) })
    else if (kind === 'language') setEditing({ kind, row: find(data.languages) })
    else if (kind === 'cast') setEditing({ kind, row: find(data.casts) })
    else if (kind === 'event_trigger') setEditing({ kind, row: find(data.eventTriggers) })
    else if (kind === 'foreign_data_wrapper') setEditing({ kind, row: find(data.wrappers) })
    else if (kind === 'foreign_server') setEditing({ kind, row: find(data.servers) })
    else if (kind === 'user_mapping') setEditing({ kind, row: find(data.mappings) })
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

  const changed = () => {
    treeState.refresh()
    reload()
  }

  function exportSql(kind: ObjectKind, rows: Row[]) {
    setExported({ title: rows.length === 1 ? t('export_title', { name: rows[0].name }) : t('export_title_many'), sql: null })
    Promise.all(rows.map((row) => objectCollection(db, kind, row).sql(row.oid))).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function askDrop(kind: ObjectKind, rows: Row[], statement: (row: Row) => string) {
    setCascade(false)
    setConfirm({
      sql: rows.map(statement),
      run: async () => {
        try {
          for (const row of rows) await objectCollection(db, kind, row).remove(row.oid, cascadeRef.current)
          notifySuccess(rows.length === 1 ? t('dropped', { name: rows[0].name }) : t('dropped_many', { count: rows.length }))
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          changed()
        }
      },
    })
  }
  cascadeRef.current = cascade

  const labels = { name: t('columns.name'), edit: t('actions.edit'), export: t('actions.export'), drop: t('actions.drop') }
  const section = (kind: ObjectKind) => ({
    empty: t(`${kind}.none`),
    createLabel: t(`${kind}.create`),
    noneSelected: t('none_selected'),
    labels,
    onExport: (rows: Row[]) => exportSql(kind, rows),
  })
  // pgAdmin's Security tab of a language, wrapper or server: USAGE, granted from a dialog.
  const privilegesColumn = (kind: PrivilegeKind) => ({ label: '', render: (row: Row) => <PrivilegesAction onClick={() => setPrivileges({ kind, oid: row.oid, name: row.name })} /> })
  const castName = (row: Cast) => `(${row.srctyp} AS ${row.trgtyp})`
  const options = (pairs: OptionPair[]) => pairs.map((p) => `${p.option} '${p.value}'`).join(', ')
  const mappingRole = (row: UserMapping) => (row.name === 'public' ? 'PUBLIC' : quoteIdent(row.name))

  return (
    <>
      <ObjectSection<Extension>
        id="extensions"
        icon="b_plugin"
        title={t('extension.title')}
        rows={data.extensions}
        createIcon="b_plugin"
        onCreate={() => setEditing({ kind: 'extension', row: null })}
        columns={[
          { label: t('columns.version'), render: (row) => row.version },
          { label: t('columns.schema'), render: (row) => row.schema },
          { label: t('columns.comment'), render: (row) => row.comment },
        ]}
        onEdit={(row) => setEditing({ kind: 'extension', row })}
        onDrop={(rows) => askDrop('extension', rows, (row) => `DROP EXTENSION ${quoteIdent(row.name)};`)}
        {...section('extension')}
      />
      <ObjectSection<Language>
        id="languages"
        icon="b_routines"
        title={t('language.title')}
        rows={data.languages}
        createIcon="b_routine_add"
        onCreate={() => setEditing({ kind: 'language', row: null })}
        columns={[
          { label: t('columns.trusted'), render: (row) => (row.trusted ? tApp('yes') : tApp('no')) },
          { label: t('columns.handler'), render: (row) => <code>{row.lanproc}</code> },
          { label: t('columns.owner'), render: (row) => row.lanowner },
          { label: t('columns.comment'), render: (row) => row.description },
          privilegesColumn('language'),
        ]}
        onEdit={(row) => setEditing({ kind: 'language', row })}
        onDrop={(rows) => askDrop('language', rows, (row) => `DROP LANGUAGE ${quoteIdent(row.name)};`)}
        {...section('language')}
      />
      <ObjectSection<Cast>
        id="casts"
        icon="b_relations"
        title={t('cast.title')}
        rows={data.casts.map((row) => ({ ...row, name: castName(row) }))}
        createIcon="b_relations"
        onCreate={() => setEditing({ kind: 'cast', row: null })}
        columns={[
          { label: t('columns.function'), render: (row) => <code>{row.proname}</code> },
          { label: t('columns.context'), render: (row) => row.castcontext },
          { label: t('columns.comment'), render: (row) => row.description },
        ]}
        onEdit={(row) => setEditing({ kind: 'cast', row })}
        onDrop={(rows) => askDrop('cast', rows, (row) => `DROP CAST ${row.name};`)}
        {...section('cast')}
      />
      <ObjectSection<EventTrigger>
        id="event_triggers"
        icon="b_triggers"
        title={t('event_trigger.title')}
        rows={data.eventTriggers}
        createIcon="b_trigger_add"
        onCreate={() => setEditing({ kind: 'event_trigger', row: null })}
        columns={[
          { label: t('columns.event'), render: (row) => row.eventname },
          { label: t('columns.function'), render: (row) => <code>{row.eventfunname}</code> },
          { label: t('columns.tags'), render: (row) => row.when },
          { label: t('columns.state'), render: (row) => t(`event_trigger.states.${row.enabled}`) },
        ]}
        onEdit={(row) => setEditing({ kind: 'event_trigger', row })}
        onDrop={(rows) => askDrop('event_trigger', rows, (row) => `DROP EVENT TRIGGER ${quoteIdent(row.name)};`)}
        {...section('event_trigger')}
      />

      <ObjectSection<ForeignDataWrapper>
        id="foreign_data_wrappers"
        icon="b_engine"
        title={t('foreign_data_wrapper.title')}
        rows={data.wrappers}
        createIcon="b_engine"
        onCreate={() => setEditing({ kind: 'foreign_data_wrapper', row: null })}
        columns={[
          { label: t('columns.handler'), render: (row) => <code>{row.fdwhan}</code> },
          { label: t('columns.validator'), render: (row) => <code>{row.fdwvalue}</code> },
          { label: t('columns.options'), render: (row) => options(row.fdwoptions) },
          { label: t('columns.owner'), render: (row) => row.fdwowner },
          privilegesColumn('foreign_data_wrapper'),
        ]}
        onEdit={(row) => setEditing({ kind: 'foreign_data_wrapper', row })}
        onDrop={(rows) => askDrop('foreign_data_wrapper', rows, (row) => `DROP FOREIGN DATA WRAPPER ${quoteIdent(row.name)};`)}
        {...section('foreign_data_wrapper')}
      />
      <ObjectSection<ForeignServer>
        id="foreign_servers"
        icon="s_host"
        title={t('foreign_server.title')}
        rows={data.servers}
        createIcon="s_host"
        onCreate={() => (data.wrappers.length === 0 ? notifyError(t('foreign_server.no_wrappers')) : setEditing({ kind: 'foreign_server', row: null }))}
        columns={[
          { label: t('columns.wrapper'), render: (row) => row.fdwname },
          { label: t('columns.type'), render: (row) => row.fsrvtype },
          { label: t('columns.version'), render: (row) => row.fsrvversion },
          { label: t('columns.options'), render: (row) => options(row.fsrvoptions) },
          { label: t('columns.owner'), render: (row) => row.fsrvowner },
          privilegesColumn('foreign_server'),
        ]}
        onEdit={(row) => setEditing({ kind: 'foreign_server', row })}
        onDrop={(rows) => askDrop('foreign_server', rows, (row) => `DROP SERVER ${quoteIdent(row.name)};`)}
        {...section('foreign_server')}
      />
      <ObjectSection<UserMapping & { role: string }>
        id="user_mappings"
        icon="user"
        title={t('user_mapping.title')}
        rows={data.mappings.map((row) => ({ ...row, role: row.name, name: `${row.name === 'public' ? 'PUBLIC' : row.name} @ ${row.srvname}` }))}
        createIcon="b_usradd"
        onCreate={() => (data.servers.length === 0 ? notifyError(t('user_mapping.no_servers')) : setEditing({ kind: 'user_mapping', row: null }))}
        columns={[{ label: t('columns.options'), render: (row) => options(row.umoptions.map((p) => (p.option === 'password' ? { ...p, value: '••••' } : p))) }]}
        onEdit={(row) => setEditing({ kind: 'user_mapping', row: { ...row, name: row.role } })}
        onDrop={(rows) => askDrop('user_mapping', rows, (row) => `DROP USER MAPPING FOR ${mappingRole({ ...(row as UserMapping), name: (row as UserMapping & { role: string }).role })} SERVER ${quoteIdent((row as UserMapping).srvname)};`)}
        {...section('user_mapping')}
      />

      <ObjectEditor
        db={db}
        wrappers={data.wrappers}
        servers={data.servers}
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          changed()
        }}
      />

      <PrivilegesModal db={db} target={privileges} onClose={() => setPrivileges(null)} />

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
          if (pending) void pending.run()
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

/** The CASCADE box as last rendered, for the pending drop to read. */
const cascadeRef: { current: boolean } = { current: false }

type AllOptions = {
  extension?: ExtensionOptions
  language?: LanguageOptions
  cast?: CastOptions
  event_trigger?: EventTriggerOptions
  foreign_data_wrapper?: ForeignDataWrapperOptions
  foreign_server?: { roles: string[] }
  user_mapping?: { roles: string[] }
}

const list = (values: string[]) => values.map((value) => ({ value, label: value }))

/** The dialog of the object being edited, its fields from pgAdmin's dialog for the kind. */
function ObjectEditor({ db, wrappers, servers, editing, onClose, onSaved }: { db: string; wrappers: ForeignDataWrapper[]; servers: ForeignServer[]; editing: Editing | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation('dbobjects')
  const [options, setOptions] = useState<AllOptions>({})
  const [castFunctions, setCastFunctions] = useState<string[]>([])
  const [extensionName, setExtensionName] = useState('')
  const kind = editing?.kind

  useEffect(() => {
    if (!kind || options[kind]) return
    const loaders: Record<ObjectKind, () => Promise<unknown>> = {
      extension: () => extensionOptions(db),
      language: () => languageOptions(db),
      cast: () => castOptions(db),
      event_trigger: () => eventTriggerOptions(db),
      foreign_data_wrapper: () => foreignDataWrapperOptions(db),
      foreign_server: () => foreignServerOptions(db),
      user_mapping: () => userMappingOptions(db),
    }
    const load = loaders[kind]()
    load.then(
      (value) => setOptions((current) => ({ ...current, [kind]: value })),
      (e: unknown) => notifyError(errorMessage(e)),
    )
  }, [db, kind, options])

  if (!editing) return <NodeDialog show={false} id="objectDialog" title="" fields={[]} initial={{}} save={async () => undefined} preview={async () => ''} savedMessage={() => ''} onClose={onClose} onSaved={onSaved} />

  const existing = editing.row !== null
  /** A new server is made under the wrapper chosen, a new mapping under the server chosen ("fid:fsid"). */
  const parents = (values: Values): { fid?: number; fsid?: number } => {
    if (editing.row && 'fid' in editing.row) return { fid: editing.row.fid, fsid: 'fsid' in editing.row ? editing.row.fsid : undefined }
    if (editing.kind === 'foreign_server') return { fid: Number(values.fid) }
    if (editing.kind === 'user_mapping') {
      const [fid, fsid] = String(values.server).split(':').map(Number)
      return { fid, fsid }
    }
    return {}
  }
  const save = (values: Values) => {
    const collection = objectCollection(db, editing.kind, parents(values))
    return existing ? collection.update(editing.row!.oid, values) : collection.create(values)
  }
  const preview = (values: Values) => objectCollection(db, editing.kind, parents(values)).modifiedSql(values, editing.row?.oid)
  let fields: Field[] = []
  let initial: Values = {}
  let onValuesChange: ((values: Values) => void) | undefined
  const name = (values: Values) => String(values.name || editing.row?.name || '')

  switch (editing.kind) {
    case 'extension': {
      const o = options.extension
      const row = editing.row
      const available = (o?.available ?? []).filter((e) => existing || e.installed_version === null)
      const chosen = o?.available.find((e) => e.name === (row?.name ?? extensionName))
      initial = { name: row?.name ?? '', schema: row?.schema ?? '', version: row?.version ?? '', cascade: false }
      fields = [
        { key: 'name', label: t('fields.name'), kind: 'select', options: list(available.map((e) => e.name)), empty: '', readOnly: existing, required: true },
        { key: 'schema', label: t('fields.schema'), kind: 'select', options: list(o?.schemas ?? []), empty: '', readOnly: existing && !row?.relocatable, hint: chosen?.schema ? t('extension.fixed_schema', { schema: chosen.schema }) : t('extension.schema_hint') },
        { key: 'version', label: t('fields.version'), kind: 'select', options: list(chosen?.versions ?? []), empty: existing ? undefined : t('extension.default_version') },
        { key: 'cascade', label: t('fields.cascade'), kind: 'checkbox', visible: () => !existing, hint: t('extension.cascade_hint') },
      ]
      onValuesChange = (values) => setExtensionName(String(values.name))
      break
    }
    case 'language': {
      const o = options.language
      const row = editing.row
      initial = { name: row?.name ?? '', lanowner: row?.lanowner ?? '', trusted: row?.trusted ?? false, lanproc: row?.lanproc ?? '', laninl: row?.laninl ?? '', lanval: row?.lanval ?? '', description: row?.description ?? '' }
      fields = [
        { key: 'name', label: t('fields.name'), kind: 'text', required: true },
        { key: 'lanowner', label: t('fields.owner'), kind: 'select', options: list(o?.roles ?? []), empty: t('current_role') },
        { key: 'trusted', label: t('fields.trusted'), kind: 'checkbox', hint: existing ? t('language.recreate_hint') : undefined },
        { key: 'lanproc', label: t('fields.handler'), kind: 'select', options: list(o?.handler ?? []), empty: '', required: true },
        { key: 'laninl', label: t('fields.inline'), kind: 'select', options: list(o?.inline ?? []), empty: '' },
        { key: 'lanval', label: t('fields.validator'), kind: 'select', options: list(o?.validator ?? []), empty: '' },
        { key: 'description', label: t('fields.comment'), kind: 'textarea' },
      ]
      break
    }
    case 'cast': {
      const o = options.cast
      const row = editing.row
      const fn = row && row.proname !== 'binary compatible' ? `${row.pronspname}.${row.proname}` : ''
      initial = { srctyp: row?.srctyp ?? '', trgtyp: row?.trgtyp ?? '', proname: fn, castcontext: row?.castcontext ?? 'EXPLICIT', description: row?.description ?? '' }
      fields = [
        { key: 'srctyp', label: t('fields.source'), kind: 'select', options: list(o?.types ?? []), empty: '', readOnly: existing, required: true },
        { key: 'trgtyp', label: t('fields.target'), kind: 'select', options: list(o?.types ?? []), empty: '', readOnly: existing, required: true },
        { key: 'proname', label: t('fields.function'), kind: 'select', options: list(existing ? [fn] : castFunctions), empty: t('cast.binary'), readOnly: existing },
        { key: 'castcontext', label: t('fields.context'), kind: 'select', options: (['EXPLICIT', 'ASSIGNMENT', 'IMPLICIT'] as const).map((value) => ({ value, label: t(`cast.contexts.${value}`) })), readOnly: existing },
        { key: 'description', label: t('fields.comment'), kind: 'textarea' },
      ]
      if (!existing) {
        onValuesChange = (values) => {
          const source = String(values.srctyp)
          const target = String(values.trgtyp)
          if (source === '' || target === '') return setCastFunctions([])
          castOptions(db, source, target).then(
            (r) => setCastFunctions(r.functions),
            () => setCastFunctions([]),
          )
        }
      }
      break
    }
    case 'event_trigger': {
      const o = options.event_trigger
      const row = editing.row
      initial = { name: row?.name ?? '', eventowner: row?.eventowner ?? '', eventname: row?.eventname ?? 'DDL_COMMAND_START', eventfunname: row?.eventfunname ?? '', when: row?.when ?? '', enabled: row?.enabled ?? 'O', comment: row?.comment ?? '' }
      fields = [
        { key: 'name', label: t('fields.name'), kind: 'text', required: true },
        { key: 'eventowner', label: t('fields.owner'), kind: 'select', options: list(o?.roles ?? []), empty: t('current_role') },
        { key: 'eventname', label: t('fields.event'), kind: 'select', options: list(o?.events ?? []), required: true },
        { key: 'eventfunname', label: t('fields.function'), kind: 'select', options: list([...new Set([...(row ? [row.eventfunname] : []), ...(o?.functions ?? [])])]), empty: '', required: true, hint: (o?.functions ?? []).length === 0 && !row ? t('event_trigger.no_functions') : undefined },
        { key: 'when', label: t('fields.tags'), kind: 'text', placeholder: 'CREATE TABLE, ALTER TABLE', hint: t('event_trigger.tags_hint') },
        { key: 'enabled', label: t('fields.state'), kind: 'select', options: STATES.map((value) => ({ value, label: t(`event_trigger.states.${value}`) })) },
        { key: 'comment', label: t('fields.comment'), kind: 'textarea' },
      ]
      break
    }
  }

  if (editing.kind === 'foreign_data_wrapper') {
    const o = options.foreign_data_wrapper
    const row = editing.row
    initial = { name: row?.name ?? '', fdwowner: row?.fdwowner ?? '', fdwhan: row?.fdwhan ?? '', fdwvalue: row?.fdwvalue ?? '', fdwoptions: row?.fdwoptions ?? [], description: row?.description ?? '' }
    fields = [
      { key: 'name', label: t('fields.name'), kind: 'text', required: true },
      { key: 'fdwowner', label: t('fields.owner'), kind: 'select', options: list(o?.roles ?? []), empty: t('current_role') },
      { key: 'fdwhan', label: t('fields.handler'), kind: 'select', options: list(o?.handlers ?? []), empty: t('foreign_data_wrapper.no_function') },
      { key: 'fdwvalue', label: t('fields.validator'), kind: 'select', options: list(o?.validators ?? []), empty: t('foreign_data_wrapper.no_function') },
      { key: 'fdwoptions', label: t('fields.options'), kind: 'options' },
      { key: 'description', label: t('fields.comment'), kind: 'textarea' },
    ]
  } else if (editing.kind === 'foreign_server') {
    const o = options.foreign_server
    const row = editing.row
    initial = { fid: String(row?.fid ?? wrappers[0]?.oid ?? ''), name: row?.name ?? '', fsrvowner: row?.fsrvowner ?? '', fsrvtype: row?.fsrvtype ?? '', fsrvversion: row?.fsrvversion ?? '', fsrvoptions: row?.fsrvoptions ?? [], description: row?.description ?? '' }
    fields = [
      { key: 'fid', label: t('fields.wrapper'), kind: 'select', options: wrappers.map((w) => ({ value: String(w.oid), label: w.name })), readOnly: existing, required: true },
      { key: 'name', label: t('fields.name'), kind: 'text', required: true },
      { key: 'fsrvowner', label: t('fields.owner'), kind: 'select', options: list(o?.roles ?? []), empty: t('current_role') },
      { key: 'fsrvtype', label: t('fields.type'), kind: 'text', hint: existing ? t('foreign_server.recreate_hint') : undefined },
      { key: 'fsrvversion', label: t('fields.version'), kind: 'text' },
      { key: 'fsrvoptions', label: t('fields.options'), kind: 'options', hint: t('foreign_server.options_hint') },
      { key: 'description', label: t('fields.comment'), kind: 'textarea' },
    ]
  } else if (editing.kind === 'user_mapping') {
    const o = options.user_mapping
    const row = editing.row
    const first = servers[0]
    initial = { server: row ? `${row.fid}:${row.fsid}` : first ? `${first.fid}:${first.oid}` : '', name: row ? (row.name === 'public' ? 'PUBLIC' : row.name) : 'CURRENT_USER', umoptions: row?.umoptions ?? [] }
    fields = [
      { key: 'server', label: t('fields.server'), kind: 'select', options: servers.map((s) => ({ value: `${s.fid}:${s.oid}`, label: `${s.name} (${s.fdwname})` })), readOnly: existing, required: true },
      { key: 'name', label: t('fields.user'), kind: 'select', options: list(o?.roles ?? ['CURRENT_USER', 'PUBLIC']), readOnly: existing, required: true },
      { key: 'umoptions', label: t('fields.options'), kind: 'options', hint: t('user_mapping.options_hint') },
    ]
  }

  const title = existing ? t(`${editing.kind}.edit_title`, { name: editing.row?.name }) : t(`${editing.kind}.create_title`)

  return (
    <NodeDialog
      show
      id={`${editing.kind}Dialog`}
      title={title}
      fields={fields}
      initial={initial}
      onValuesChange={onValuesChange}
      save={save}
      preview={preview}
      savedMessage={(values) => (existing ? t('altered', { name: name(values) }) : t('created', { name: editing.kind === 'cast' ? `(${values.srctyp} AS ${values.trgtyp})` : name(values) }))}
      onClose={onClose}
      onSaved={onSaved}
    />
  )
}
