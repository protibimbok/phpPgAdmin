import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { urls } from '@/level'
import { qualifiedName } from '@sql/js/sql'
import { dropTypeRow, listTypes, resolveSchema, typeRowSql, type TypeRow } from '../api'

/** The kinds the editor can open; the others (base, shell, multirange) are shown and dropped only. */
const EDITABLE = new Set(['c', 'e', 'r', 'd'])

/**
 * The schema's "Types" page, laid out like phpMyAdmin's Routines page (MySQL has no types):
 * the heading, the check-all / Export / Drop group, the filter and the "Create new type"
 * button, then every type and domain with its kind, definition, owner and comment, and the
 * Edit, Export and Drop links.
 */
export default function Types() {
  const { t } = useTranslation('types')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '' } = useParams()
  const { data, error, reload } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)

    return { scid, rows: await listTypes(db, scid) }
  }, [db, schema])
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ sql: string[]; run: () => Promise<void> } | null>(null)
  const [cascade, setCascade] = useState(false)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)
  const rows = useMemo(() => {
    const needle = filter.trim().toUpperCase()

    return (data?.rows ?? []).filter((row) => needle === '' || row.name.toUpperCase().includes(needle))
  }, [data, filter])

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

  return (
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
                <th colSpan={3} />
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

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>

      <ConfirmQuery
        show={confirm !== null}
        sql={(confirm?.sql ?? []).map((s) => (cascade ? s.replace(/;$/, ' CASCADE;') : s))}
        confirmLabel={tApp('ok')}
        onClose={() => setConfirm(null)}
        onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }}
      >
        <div className="form-check mt-2">
          <input className="form-check-input" type="checkbox" id="confirm_cascade" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
          <label className="form-check-label" htmlFor="confirm_cascade">
            {t('cascade')}
          </label>
        </div>
      </ConfirmQuery>
    </div>
  )
}

/** The CASCADE box as last rendered, for the pending drop to read. */
const cascadeRef: { current: boolean } = { current: false }
