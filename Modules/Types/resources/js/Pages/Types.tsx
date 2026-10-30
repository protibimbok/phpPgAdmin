import { useEffect, useMemo, useState } from 'react'
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
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { qualifiedName } from '@sql/js/sql'
import { PrivilegesLink } from '@roles/js/PrivilegesSection'
import { collations as collationsOf, refreshCollationVersion, dropOpclass, dropTypeRow, ftsSqlKind, listOpclasses, listTextSearch, listTypes, opclassDropSql, opclassSql, resolveSchema, textSearch, typeRowSql, type Collation, type FtsKind, type FtsRow, type OpclassRow, type TypeRow } from '../api'
import CollationDialog from '../dialogs/CollationDialog'
import OpclassDialog from '../dialogs/OpclassDialog'
import TextSearchDialog from '../dialogs/TextSearchDialog'

/** The kinds the editor can open; a multirange is made with its range and only shown and dropped. */
const EDITABLE = new Set(['c', 'e', 'r', 'd', 'b', 'p'])

/**
 * The schema's "Types" page, laid out like phpMyAdmin's Routines page (MySQL has no types):
 * the heading, the check-all / Export / Drop group, the filter and the "Create new type"
 * button, then every type and domain with its kind, definition, owner and comment, and the
 * Edit, Export and Drop links. Below it, the schema's collations and full text search objects
 * (configurations, dictionaries, parsers and templates) are listed the same way and edited in
 * dialogs; ?open=<node>:<name> opens one of those dialogs on arrival, which is how the tree
 * reaches them.
 */
export default function Types() {
  const { t } = useTranslation('types')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '' } = useParams()
  const { data, error, reload } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)
    const [rows, collations, textSearch, opclasses] = await Promise.all([listTypes(db, scid), collationsOf(db, scid).list(), listTextSearch(db, scid), listOpclasses(db, scid)])

    return { scid, rows, collations, textSearch, opclasses }
  }, [db, schema])
  const [search, setSearch] = useSearchParams()
  const [collationDialog, setCollationDialog] = useState<{ collation: Collation | null } | null>(null)
  const [ftsDialog, setFtsDialog] = useState<{ kind: FtsKind; object: FtsRow | null } | null>(null)
  const [opclassDialog, setOpclassDialog] = useState(false)
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // cascadable: the statements take CASCADE, offered as a box (the drops, not a refresh).
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void>; cascadable?: boolean } | null>(null)
  const [cascade, setCascade] = useState(false)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const rows = useMemo(() => {
    const needle = filter.trim().toUpperCase()

    return (data?.rows ?? []).filter((row) => needle === '' || row.name.toUpperCase().includes(needle))
  }, [data, filter])

  // The tree opens a collation or text search object by name: ?open=collation:german.
  const open = search.get('open')
  useEffect(() => {
    if (!data || !open) return
    const [node, ...rest] = open.split(':')
    const name = rest.join(':')
    if (node === 'collation') {
      const collation = data.collations.find((c) => c.name === name)
      if (collation) setCollationDialog({ collation })
    } else {
      const object = data.textSearch.find((o) => o.kind === node && o.name === name)
      if (object) setFtsDialog({ kind: object.kind, object })
    }
    setSearch((params) => { params.delete('open'); return params }, { replace: true })
  }, [data, open, setSearch])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { scid } = data
  const base = `${urls.schema(db, schema)}/types`
  const keyOf = (row: TypeRow) => `${row.node}_${row.oid}`
  const kindOf = (row: TypeRow) => (row.node === 'domain' ? 'd' : row.typtype)
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(keyOf(row)))
  const selected = () => rows.filter((row) => checked.has(keyOf(row)))

  /** What the Definition column shows: members, labels, the subtype or the base type. */
  function definition(row: TypeRow): string {
    if (row.node === 'domain') {
      return [row.fulltype, row.typnotnull ? 'NOT NULL' : '', row.typdefault ? `DEFAULT ${row.typdefault}` : '', ...row.constraints.map((c) => `CHECK (${c.consrc})`)].filter(Boolean).join(' ')
    }
    switch (row.typtype) {
      case 'c':
        return row.member_list ?? ''
      case 'e':
        return row.enum_list ?? ''
      case 'r':
        return `${t('kinds.range_of')} ${row.typname ?? ''}`
      default:
        return row.alias
    }
  }

  function toggle(key: string, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(key)
      else next.delete(key)

      return next
    })
  }

  function exportRows(targets: TypeRow[]) {
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    setExported({ title: targets.length === 1 ? t('export_title', { name: targets[0].name }) : t('export_title_many'), sql: null })
    Promise.all(targets.map((row) => typeRowSql(db, scid, row))).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function askDrop(targets: TypeRow[]) {
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    setCascade(false)
    setConfirm({
      cascadable: true,
      sql: targets.map((row) => `DROP ${row.node === 'domain' ? 'DOMAIN' : 'TYPE'} ${qualifiedName(schema, row.name)};`),
      run: async () => {
        let done = 0
        try {
          for (const row of targets) {
            await dropTypeRow(db, scid, row, cascadeRef.current)
            done++
          }
          notifySuccess(targets.length === 1 ? t('dropped', { name: targets[0].name }) : t('dropped_many', { count: done }))
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          setChecked(new Set())
          treeState.refresh()
          reload()
        }
      },
    })
  }

  cascadeRef.current = cascade

  const changed = () => {
    treeState.refresh()
    reload()
  }

  /** The Export of a collation or text search object: the CREATE statement(s) in a dialog. */
  function exportSql(title: string, loads: Promise<string>[]) {
    setExported({ title, sql: null })
    Promise.all(loads).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function askDropSql(statements: string[], remove: (oid: number) => Promise<unknown>, oids: number[], message: string) {
    setCascade(false)
    setConfirm({
      cascadable: true,
      sql: statements,
      run: async () => {
        try {
          for (const id of oids) await remove(id)
          notifySuccess(message)
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          changed()
        }
      },
    })
  }

  /** ALTER COLLATION … REFRESH VERSION, after the confirmation. */
  function askRefresh(row: Collation) {
    setConfirm({
      sql: [`ALTER COLLATION ${qualifiedName(schema, row.name)} REFRESH VERSION;`],
      run: async () => {
        try {
          await refreshCollationVersion(db, scid, row.oid)
          notifySuccess(t('collations.refreshed', { name: row.name }))
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          reload()
        }
      },
    })
  }

  const sectionLabels = { name: t('columns.name'), edit: t('actions.edit'), export: t('actions.export'), drop: t('actions.drop') }
  const exportTitle = (names: string[]) => (names.length === 1 ? t('export_title', { name: names[0] }) : t('export_title_many'))

  /** What the text search Definition column shows: the parser, the template and options, or the functions. */
  function ftsDefinition(row: FtsRow): string {
    switch (row.kind) {
      case 'fts_configuration':
        return `PARSER = ${row.prsname ?? ''}`
      case 'fts_dictionary':
        return [`TEMPLATE = ${row.template ?? ''}`, ...(row.options ?? []).map((o) => `${o.option} = '${o.value}'`)].join(', ')
      case 'fts_parser':
        return [`START = ${row.prsstart}`, `GETTOKEN = ${row.prstoken}`, `END = ${row.prsend}`, `LEXTYPES = ${row.prslextype}`, ...(row.prsheadline && row.prsheadline !== '-' ? [`HEADLINE = ${row.prsheadline}`] : [])].join(', ')
      case 'fts_template':
        return [...(row.tmplinit && row.tmplinit !== '-' ? [`INIT = ${row.tmplinit}`] : []), `LEXIZE = ${row.tmpllexize}`].join(', ')
    }
  }

  return (
    <>
      <div className="container-fluid my-3">
        <h2>
          <Icon name="b_plugin" /> {t('title')}
        </h2>

        <div className="d-flex flex-wrap my-3">
          {data.rows.length > 0 && (
            <>
              <div>
                <div className="input-group">
                  <div className="input-group-text">
                    <div className="form-check mb-0">
                      <input className="form-check-input checkall_box" type="checkbox" id="checkAllCheckbox" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map(keyOf)) : new Set())} />
                      <label className="form-check-label" htmlFor="checkAllCheckbox">
                        {tApp('check_all')}
                      </label>
                    </div>
                  </div>
                  <button className="btn btn-outline-secondary" id="bulkActionExportButton" type="button" title={t('actions.export')} onClick={() => exportRows(selected())}>
                    <Icon name="b_export" /> {t('actions.export')}
                  </button>
                  <button className="btn btn-outline-secondary" id="bulkActionDropButton" type="button" title={t('actions.drop')} onClick={() => askDrop(selected())}>
                    <Icon name="b_drop" /> {t('actions.drop')}
                  </button>
                </div>
              </div>

              <div className="ms-auto">
                <div className="input-group">
                  <span className="input-group-text">
                    <Icon name="b_search" title={tApp('search')} />
                  </span>
                  <input className="form-control" name="filterText" type="text" id="filterText" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tApp('search')} aria-label={tApp('search')} />
                </div>
              </div>
            </>
          )}

          <div className={data.rows.length > 0 ? 'ms-2' : undefined}>
            <Link className="ajax add_anchor btn btn-primary" to={`${base}/create`} role="button">
              <Icon name="b_plus" /> {t('create_new')}
            </Link>
          </div>
        </div>

        <form id="typesForm" onSubmit={(e) => e.preventDefault()}>
          {data.rows.length === 0 ? (
            <div id="nothing2display">
              <div className="alert alert-primary" role="alert">
                <Icon name="s_notice" /> {t('none')}
              </div>
            </div>
          ) : (
            <table id="typesTable" className="table table-striped table-hover data w-auto">
              <thead>
                <tr>
                  <th />
                  <th>{t('columns.name')}</th>
                  <th>{t('columns.kind')}</th>
                  <th>{t('columns.definition')}</th>
                  <th>{t('columns.owner')}</th>
                  <th>{t('columns.comment')}</th>
                  <th colSpan={4} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const kind = kindOf(row)

                  return (
                    <tr key={keyOf(row)}>
                      <td>
                        <input type="checkbox" className="checkall" checked={checked.has(keyOf(row))} onChange={(e) => toggle(keyOf(row), e.target.checked)} aria-label={row.name} />
                      </td>
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td className="text-nowrap">{t(`kinds.${kind}`, { defaultValue: kind })}</td>
                      <td dir="ltr">
                        <code>{definition(row)}</code>
                      </td>
                      <td>{row.node === 'domain' ? row.owner : row.typeowner}</td>
                      <td>{row.description}</td>
                      <td>
                        {EDITABLE.has(kind) && (
                          <Link className="ajax edit_anchor" to={`${base}/${row.node}/${encodeURIComponent(row.name)}/edit`}>
                            <Icon name="b_edit" /> {t('actions.edit')}
                          </Link>
                        )}
                      </td>
                      <td>{EDITABLE.has(kind) && <PrivilegesLink to={`${base}/${row.node}/${encodeURIComponent(row.name)}/edit`} />}</td>
                      <td>
                        <a className="ajax export_anchor" href="#export" onClick={(e) => { e.preventDefault(); exportRows([row]) }}>
                          <Icon name="b_export" /> {t('actions.export')}
                        </a>
                      </td>
                      <td>
                        <a className="ajax drop_anchor" href="#drop" onClick={(e) => { e.preventDefault(); askDrop([row]) }}>
                          <Icon name="b_drop" /> {t('actions.drop')}
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </form>

      </div>

      <ObjectSection<Collation>
        id="collations"
        icon="s_lang"
        title={t('collations.title')}
        rows={data.collations}
        empty={t('collations.none')}
        createLabel={t('collations.create_new')}
        createIcon="b_plus"
        onCreate={() => setCollationDialog({ collation: null })}
        columns={[
          { label: t('collations.columns.locale'), render: (row) => <code>{row.lc_collate === row.lc_type ? row.lc_collate : `${row.lc_collate} / ${row.lc_type}`}</code> },
          { label: t('collations.columns.provider'), render: (row) => row.provider },
          { label: t('collations.columns.deterministic'), render: (row) => (row.is_deterministic ? tApp('yes') : tApp('no')) },
          { label: t('collations.columns.version'), render: (row) => <CollationVersion row={row} onRefresh={() => askRefresh(row)} /> },
          { label: t('columns.owner'), render: (row) => row.owner },
          { label: t('columns.comment'), render: (row) => row.description },
        ]}
        onEdit={(row) => setCollationDialog({ collation: row })}
        onExport={(rows) => exportSql(exportTitle(rows.map((r) => r.name)), rows.map((row) => collationsOf(db, scid).sql(row.oid)))}
        onDrop={(rows) => askDropSql(rows.map((row) => `DROP COLLATION ${qualifiedName(schema, row.name)};`), (id) => collationsOf(db, scid).remove(id, cascadeRef.current), rows.map((r) => r.oid), rows.length === 1 ? t('collations.dropped', { name: rows[0].name }) : t('dropped_many_objects', { count: rows.length }))}
        noneSelected={t('none_selected_object')}
        labels={sectionLabels}
      />

      <ObjectSection<FtsRow>
        id="textSearch"
        icon="s_fulltext"
        title={t('fts.title')}
        rows={data.textSearch}
        empty={t('fts.none')}
        createLabel={t('fts.create_new')}
        createIcon="b_plus"
        onCreate={() => setFtsDialog({ kind: 'fts_configuration', object: null })}
        columns={[
          { label: t('columns.kind'), render: (row) => t(`fts.kinds.${row.kind}`) },
          { label: t('columns.definition'), render: (row) => <code dir="ltr">{ftsDefinition(row)}</code> },
          { label: t('columns.owner'), render: (row) => row.owner ?? '' },
          { label: t('columns.comment'), render: (row) => row.description },
        ]}
        onEdit={(row) => setFtsDialog({ kind: row.kind, object: row })}
        onExport={(rows) => exportSql(exportTitle(rows.map((r) => r.name)), rows.map((row) => textSearch(db, scid, row.kind).sql(row.oid)))}
        onDrop={(rows) => askDropSql(rows.map((row) => `DROP ${ftsSqlKind(row.kind)} ${qualifiedName(schema, row.name)};`), async (id) => { const row = rows.find((r) => r.oid === id); if (row) await textSearch(db, scid, row.kind).remove(id, cascadeRef.current) }, rows.map((r) => r.oid), rows.length === 1 ? t('fts.dropped', { name: rows[0].name }) : t('dropped_many_objects', { count: rows.length }))}
        noneSelected={t('none_selected_object')}
        labels={sectionLabels}
      />

      <ObjectSection<OpclassRow>
        id="opclasses"
        icon="b_index"
        title={t('opclasses.title')}
        rows={data.opclasses}
        empty={t('opclasses.none')}
        createLabel={t('opclasses.create_new')}
        createIcon="b_plus"
        onCreate={() => setOpclassDialog(true)}
        columns={[
          { label: t('columns.kind'), render: (row) => t(`opclasses.kinds.${row.kind}`) },
          {
            label: t('columns.definition'),
            render: (row) => (
              <code dir="ltr">
                {row.kind === 'conversion'
                  ? `${row.is_default ? 'DEFAULT ' : ''}FOR '${row.source_encoding}' TO '${row.target_encoding}' FROM ${row.function}`
                  : row.kind === 'opclass'
                    ? `${row.is_default ? 'DEFAULT ' : ''}FOR TYPE ${row.for_type} USING ${row.amname}${row.family ? ` FAMILY ${row.family}` : ''}`
                    : `USING ${row.amname}`}
              </code>
            ),
          },
          { label: t('columns.owner'), render: (row) => row.owner },
          { label: t('columns.comment'), render: (row) => row.description },
        ]}
        canEdit={() => false}
        onEdit={() => undefined}
        onExport={(rows) => exportSql(exportTitle(rows.map((r) => r.name)), rows.map((row) => opclassSql(db, scid, row)))}
        onDrop={(rows) => askDropSql(rows.map((row) => opclassDropSql(qualifiedName(schema, row.name), row)), async (id) => { const row = rows.find((r) => r.oid === id); if (row) await dropOpclass(db, scid, row, cascadeRef.current) }, rows.map((r) => r.oid), rows.length === 1 ? t('opclasses.dropped', { name: rows[0].name }) : t('dropped_many_objects', { count: rows.length }))}
        noneSelected={t('none_selected_object')}
        labels={sectionLabels}
      />

      <CollationDialog show={collationDialog !== null} db={db} scid={scid} collation={collationDialog?.collation ?? null} onClose={() => setCollationDialog(null)} onSaved={() => { setCollationDialog(null); changed() }} />
      <OpclassDialog show={opclassDialog} db={db} scid={scid} onClose={() => setOpclassDialog(false)} onSaved={() => { setOpclassDialog(false); changed() }} />
      <TextSearchDialog show={ftsDialog !== null} db={db} scid={scid} kind={ftsDialog?.kind ?? 'fts_configuration'} object={ftsDialog?.object ?? null} onClose={() => setFtsDialog(null)} onSaved={() => { setFtsDialog(null); changed() }} />

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>

      <ConfirmQuery
        show={confirm !== null}
        sql={(confirm?.sql ?? []).map((s) => (cascade && confirm?.cascadable ? s.replace(/;$/, ' CASCADE;') : s))}
        confirmLabel={tApp('ok')}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }}
      >
        {confirm?.cascadable && (
          <div className="form-check mt-2">
            <input className="form-check-input" type="checkbox" id="confirm_cascade" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
            <label className="form-check-label" htmlFor="confirm_cascade">
              {t('cascade')}
            </label>
          </div>
        )}
      </ConfirmQuery>
    </>
  )
}

/** The CASCADE box as last rendered, for the pending drop to read. */
const cascadeRef: { current: boolean } = { current: false }

/**
 * A collation's recorded version, and when the library now provides another (after an
 * operating system or ICU upgrade, which may change the sort order of indexes built with it)
 * that version with a Refresh version link.
 */
function CollationVersion({ row, onRefresh }: { row: Collation; onRefresh: () => void }) {
  const { t } = useTranslation('types')
  const stale = row.version !== null && row.actual_version !== null && row.version !== row.actual_version

  return (
    <>
      {row.version ?? ''}
      {stale && (
        <>
          {' '}
          <span className="text-warning" title={t('collations.mismatch_hint')}>
            <Icon name="s_attention" /> {t('collations.actual_version', { version: row.actual_version })}
          </span>{' '}
          <a
            href="#refresh"
            className="refresh_version"
            onClick={(e) => {
              e.preventDefault()
              onRefresh()
            }}
          >
            <Icon name="s_reload" /> {t('collations.refresh_version')}
          </a>
        </>
      )}
    </>
  )
}
