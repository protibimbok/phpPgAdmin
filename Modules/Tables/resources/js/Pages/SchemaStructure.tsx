import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { isFavorite, toggleFavorite, useQuickWarp } from '@/layout/tree/recentFavorites'
import { NUM_FAVORITE_TABLES, treeState } from '@/layout/tree/treeState'
import { usePreference } from '@/preferences'
import { notify, notifyError, notifySuccess } from '@/notify'
import { notAvailable } from '@/unbuilt'
import { formatSize } from '@/format'
import { urls, type RelationKind } from '@/level'
import { qualifiedName } from '@sql/js/sql'
import { countRows, dropTable, materializedViews, resolveSchema, tables, truncateTable, views, type Table, type View } from '../api'

interface Row {
  oid: number
  name: string
  kind: RelationKind
  typeKey: 'table' | 'partitioned' | 'view' | 'mview'
  /** The estimated row count, or null when it is not known. */
  rows: number | null
  size: number
  comment: string | null
  system: boolean
}

function fromTable(table: Table): Row {
  return {
    oid: table.oid,
    name: table.name,
    kind: 'table',
    typeKey: table.is_partitioned ? 'partitioned' : 'table',
    rows: table.reltuples < 0 ? null : Math.round(table.reltuples),
    size: table.size,
    comment: table.description,
    system: table.is_sys_table,
  }
}

function fromView(view: View, kind: 'view' | 'mview'): Row {
  return { oid: view.oid, name: view.name, kind, typeKey: kind, rows: null, size: view.size, comment: view.comment, system: false }
}

/**
 * A schema's "Structure" page: its tables, views and materialized views, laid out like
 * phpMyAdmin's database structure (database/structure/table_header.twig and
 * structure_table_row.twig): checkbox, name, the action icons, the estimated row count (click
 * for the exact one), type, size and comment, with the sums at the foot.
 */
export default function SchemaStructure() {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const { db = '', schema = '' } = useParams()
  const navigate = useNavigate()
  // phpMyAdmin's favorite star column, shown while NumFavoriteTables is above 0.
  const quickWarp = useQuickWarp()
  const favorites = usePreference<number>(NUM_FAVORITE_TABLES) > 0
  const { data, error, reload } = useRequest(async () => {
    const scid = await resolveSchema(db, schema)
    const [tableRows, viewRows, mviewRows] = await Promise.all([tables(db, scid).list(), views(db, scid).list(), materializedViews(db, scid).list()])

    return {
      scid,
      rows: [...tableRows.map(fromTable), ...viewRows.map((v) => fromView(v, 'view')), ...mviewRows.map((v) => fromView(v, 'mview'))].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    }
  }, [db, schema])
  const [exact, setExact] = useState<Record<number, number>>({})
  const [filter, setFilter] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<{ sql: string[]; warning: string; run: () => Promise<void> } | null>(null)
  const [showCreate, setShowCreate] = useState<string | null>(null)
  const allRows = data?.rows ?? []
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()

    return needle === '' ? allRows : allRows.filter((row) => row.name.toLowerCase().includes(needle))
  }, [allRows, filter])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) {
    return null
  }

  const { scid } = data
  const rows = filtered

  if (allRows.length === 0) {
    return (
      <>
        <div className="alert alert-primary" role="alert">
          {t('none')}
        </div>
        <CreateTableCard />
      </>
    )
  }

  const sumRows = rows.reduce((sum, row) => sum + (exact[row.oid] ?? row.rows ?? 0), 0)
  const sumSize = rows.reduce((sum, row) => sum + row.size, 0)
  const keyOf = (row: Row) => `${row.kind}_${row.oid}`
  const allChecked = rows.length > 0 && rows.every((row) => checked.has(keyOf(row)))

  function count(row: Row) {
    void countRows(db, scid, row.oid).then((n) => setExact((current) => ({ ...current, [row.oid]: n })))
  }

  const changed = () => {
    setChecked(new Set())
    treeState.refresh()
    reload()
  }

  /** TRUNCATE the tables among the rows, after phpMyAdmin's warning. */
  function askEmpty(selected: Row[]) {
    const targets = selected.filter((row) => row.kind === 'table')
    if (targets.length === 0) return notify(t('schema_structure.none_selected'), 'error')
    setConfirm({
      warning: t('operations.truncate_warning'),
      sql: targets.map((row) => `TRUNCATE TABLE ${qualifiedName(schema, row.name)};`),
      run: async () => {
        let done = 0
        try {
          for (const row of targets) {
            await truncateTable(db, scid, row.oid)
            done++
          }
          notifySuccess(targets.length === 1 ? t('operations.emptied', { table: targets[0].name }) : t('schema_structure.emptied', { count: done }))
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          changed()
        }
      },
    })
  }

  /** DROP the tables and views among the rows, after phpMyAdmin's warning. */
  function askDrop(selected: Row[]) {
    if (selected.length === 0) return notify(t('schema_structure.none_selected'), 'error')
    const statement = (row: Row) => `DROP ${row.kind === 'table' ? 'TABLE' : row.kind === 'view' ? 'VIEW' : 'MATERIALIZED VIEW'} ${qualifiedName(schema, row.name)};`
    setConfirm({
      warning: t('operations.drop_warning'),
      sql: selected.map(statement),
      run: async () => {
        let done = 0
        try {
          for (const row of selected) {
            if (row.kind === 'table') await dropTable(db, scid, row.oid)
            else if (row.kind === 'view') await views(db, scid).remove(row.oid)
            else await materializedViews(db, scid).remove(row.oid)
            done++
          }
          notifySuccess(selected.length === 1 ? (selected[0].kind === 'table' ? t('operations.dropped', { table: selected[0].name }) : t('schema_structure.view_dropped', { name: selected[0].name })) : t('schema_structure.dropped', { count: done }))
        } catch (e) {
          notifyError(errorMessage(e))
        } finally {
          changed()
        }
      },
    })
  }

  /** phpMyAdmin's "Show create" of the selected tables: their CREATE statements in a modal. */
  function showCreateOf(selected: Row[]) {
    if (selected.length === 0) return notify(t('schema_structure.none_selected'), 'error')
    setShowCreate('')
    Promise.all(selected.map((row) => (row.kind === 'table' ? tables(db, scid).sql(row.oid) : row.kind === 'view' ? views(db, scid).sql(row.oid) : materializedViews(db, scid).sql(row.oid)))).then(
      (parts) => setShowCreate(parts.join('\n\n')),
      (e: unknown) => {
        setShowCreate(null)
        notifyError(errorMessage(e))
      },
    )
  }

  function withSelected(action: string) {
    const selected = rows.filter((row) => checked.has(keyOf(row)))
    const names = selected.filter((row) => row.kind === 'table').map((row) => qualifiedName(schema, row.name))
    switch (action) {
      case 'show_create':
        return showCreateOf(selected)
      case 'export':
        // phpMyAdmin's With selected → Export opens the Export page with those tables ticked.
        return selected.length === 0 ? notify(t('schema_structure.none_selected'), 'error') : navigate(`${urls.schema(db, schema)}/export?${new URLSearchParams(selected.map((row) => ['table', row.name]))}`)
      case 'print':
        return window.print()
      case 'empty_tbl':
        return askEmpty(selected)
      case 'drop_tbl':
        return askDrop(selected)
      case 'analyze_tbl':
        return names.length === 0 ? notify(t('schema_structure.none_selected'), 'error') : navigate(`${urls.schema(db, schema)}/sql?${new URLSearchParams({ sql: `ANALYZE ${names.join(', ')}`, run: '1' })}`)
      case 'vacuum_tbl':
        return names.length === 0 ? notify(t('schema_structure.none_selected'), 'error') : navigate(`${urls.schema(db, schema)}/sql?${new URLSearchParams({ sql: `VACUUM ${names.join(', ')}`, run: '1' })}`)
      default:
        return notAvailable()
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

  return (
    <>
      {/* phpMyAdmin's Filters card: narrows the list as you type. */}
      <div className="card">
        <div className="card-header">{tApp('filters')}</div>
        <div className="card-body">
          <div className="row row-cols-lg-auto g-3 align-items-center">
            <div className="col-12">
              <label className="col-form-label" htmlFor="filter_field">
                {tApp('containing_the_word')}
              </label>
            </div>
            <div className="col-12">
              <input type="text" className="form-control" id="filter_field" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

    <form name="tablesForm" id="tablesForm" onSubmit={(e) => e.preventDefault()}>
    <div id="tableslistcontainer">
      <div className="table-responsive">
        <table className="table table-striped table-hover table-sm w-auto data">
          <thead>
            <tr>
              <th className="d-print-none">
                <input type="checkbox" className="checkall_box" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map(keyOf)) : new Set())} aria-label={tApp('check_all')} />
              </th>
              <th>{t('columns.table')}</th>
              <th colSpan={favorites ? 7 : 6} className="d-print-none">
                {t('columns.action')}
              </th>
              <th>
                {t('columns.rows')} <Icon name="b_help" title={t('columns.rows_hint')} />
              </th>
              <th>{t('columns.type')}</th>
              <th>{t('columns.size')}</th>
              <th>{t('columns.comment')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = urls.relation(db, schema, row.name, row.kind)
              const isTable = row.kind === 'table'
              // phpMyAdmin greys the Browse, Search and Empty icons of a table known to be empty.
              const mayHaveRows = row.rows !== 0

              return (
                <tr key={`${row.kind}_${row.oid}`} className={isTable ? undefined : 'is_view'}>
                  <td className="text-center d-print-none">
                    <input type="checkbox" name="selected_tbl[]" className="checkall" value={row.name} checked={checked.has(keyOf(row))} onChange={(e) => toggle(keyOf(row), e.target.checked)} />
                  </td>
                  <th>
                    <Link to={`${href}/browse`}>{row.name}</Link>
                    {row.system && <span className="badge bg-secondary ms-2">{t('system')}</span>}
                  </th>
                  {favorites && <FavoriteCell favorite={isFavorite(quickWarp, db, schema, row.name)} database={db} schema={schema} table={row.name} />}
                  <td className="text-center d-print-none">
                    <Link to={`${href}/browse`}>
                      <Icon name={mayHaveRows ? 'b_browse' : 'bd_browse'} title={t('actions.browse')} /> {t('actions.browse')}
                    </Link>
                  </td>
                  <td className="text-center d-print-none">
                    <Link to={href}>
                      <Icon name="b_props" title={t('actions.structure')} /> {t('actions.structure')}
                    </Link>
                  </td>
                  <td className="text-center d-print-none">
                    <Link to={`${href}/search`}>
                      <Icon name={mayHaveRows ? 'b_select' : 'bd_select'} title={t('actions.search')} /> {t('actions.search')}
                    </Link>
                  </td>
                  <td className="text-center d-print-none">
                    {isTable && (
                      <Link to={`${href}/insert`}>
                        <Icon name="b_insrow" title={t('actions.insert')} /> {t('actions.insert')}
                      </Link>
                    )}
                  </td>
                  <td className="text-center d-print-none">
                    {isTable && (
                      <a href="#empty" className="truncate_table_anchor" onClick={(e) => { e.preventDefault(); askEmpty([row]) }}>
                        <Icon name={mayHaveRows ? 'b_empty' : 'bd_empty'} title={t('actions.empty')} /> {t('actions.empty')}
                      </a>
                    )}
                  </td>
                  <td className="text-center d-print-none">
                    <a href="#drop" className="drop_table_anchor" onClick={(e) => { e.preventDefault(); askDrop([row]) }}>
                      <Icon name="b_drop" title={t('actions.drop')} /> {t('actions.drop')}
                    </a>
                  </td>
                  <td className="value tbl_rows font-monospace text-end">
                    {exact[row.oid] !== undefined ? (
                      exact[row.oid].toLocaleString()
                    ) : row.rows === null ? (
                      isTable ? (
                        <a href="#count" className="real_row_count" onClick={(e) => { e.preventDefault(); count(row) }}>
                          ?
                        </a>
                      ) : null
                    ) : (
                      <a href="#count" className="real_row_count" onClick={(e) => { e.preventDefault(); count(row) }}>
                        <bdi>~{row.rows.toLocaleString()}</bdi>
                      </a>
                    )}
                  </td>
                  <td className="text-nowrap">{t(`types.${row.typeKey}`)}</td>
                  <td className="value tbl_size font-monospace text-end">{formatSize(row.size)}</td>
                  <td>{row.comment}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot id="tbl_summary_row">
            <tr>
              <th className="d-print-none" />
              <th className="tbl_num text-nowrap">{t('total', { count: rows.length })}</th>
              <th colSpan={favorites ? 7 : 6} className="d-print-none">
                {t('sum')}
              </th>
              <th className="value tbl_rows font-monospace text-end">{sumRows.toLocaleString()}</th>
              <th />
              <th className="value tbl_size font-monospace text-end">{formatSize(sumSize)}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    {/* phpMyAdmin's check_all_tables.twig: the curved arrow, "Check all", "With selected:". */}
    <div className="clearfloat d-print-none">
      <Icon name="select_all_arrow" title={tApp('with_selected')} />
      <input type="checkbox" id="tablesForm_checkall" className="checkall_box" checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map(keyOf)) : new Set())} />{' '}
      <label htmlFor="tablesForm_checkall">{tApp('check_all')}</label>
      <select name="submit_mult" className="my-0" style={{ marginInline: '3em' }} aria-label={tApp('with_selected')} value="" onChange={(e) => withSelected(e.target.value)}>
        <option value="">{tApp('with_selected')}</option>
        <option value="show_create">{t('schema_structure.with_selected.show_create')}</option>
        <option value="export">{t('schema_structure.with_selected.export')}</option>
        <option value="print">{t('schema_structure.with_selected.print')}</option>
        <option value="empty_tbl">{t('schema_structure.with_selected.empty')}</option>
        <option value="drop_tbl">{t('schema_structure.with_selected.drop')}</option>
        <option value="analyze_tbl">{t('schema_structure.with_selected.analyze')}</option>
        <option value="vacuum_tbl">{t('schema_structure.with_selected.vacuum')}</option>
      </select>
    </div>
    </form>

    <hr />
    <p className="d-print-none">
      <a href="#print" onClick={(e) => { e.preventDefault(); window.print() }}>
        <Icon name="b_print" /> {tApp('print')}
      </a>{' '}
      {/* phpMyAdmin's link under the table list: this schema's part of the data dictionary. */}
      <Link to={`${urls.database(db)}/data-dictionary?${new URLSearchParams({ schema })}`} id="data_dictionary_link">
        <Icon name="b_tblanalyse" /> {tApp('schemas:data_dictionary.title')}
      </Link>
    </p>

    <CreateTableCard />

    <ConfirmQuery show={confirm !== null} sql={confirm?.sql ?? ''} warning={confirm?.warning} onClose={() => setConfirm(null)} onConfirm={() => { const pending = confirm; setConfirm(null); if (pending) void pending.run() }} />
    <Modal show={showCreate !== null} title={t('schema_structure.show_create_title')} size="lg" onClose={() => setShowCreate(null)}>
      {showCreate === '' ? tApp('loading') : <SqlView sql={showCreate ?? ''} />}
    </Modal>
    </>
  )
}

/** phpMyAdmin's "Create new table" card (database/create_table.twig): the name and the number of columns open the create page. */
function CreateTableCard() {
  const { t } = useTranslation('tables')
  const { db = '', schema = '' } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [count, setCount] = useState(4)

  function submit(e: FormEvent) {
    e.preventDefault()
    navigate(`${urls.schema(db, schema)}/create-table?${new URLSearchParams({ name, columns: String(count) })}`)
  }

  return (
    <form id="createTableMinimalForm" className="card d-print-none" onSubmit={submit}>
      <div className="card-header">
        <Icon name="b_table_add" /> {t('create.title')}
      </div>
      <div className="card-body row row-cols-lg-auto g-3">
        <div className="col-12">
          <label htmlFor="createTableNameInput" className="form-label">
            {t('create.table_name')}
          </label>
          <input autoComplete="off" type="text" className="form-control" id="createTableNameInput" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="col-12">
          <label htmlFor="createTableNumFieldsInput" className="form-label">
            {t('create.number_of_columns')}
          </label>
          <input type="number" className="form-control" id="createTableNumFieldsInput" min={1} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} required />
        </div>
        <div className="col-12 align-self-lg-end">
          <input className="btn btn-primary" type="submit" value={t('create.create')} />
        </div>
      </div>
    </form>
  )
}

/**
 * phpMyAdmin's favorite_anchor.twig: the star that adds the table to the navigation panel's
 * Favorites, or removes it; a full list answers with phpMyAdmin's "Favorite List is full!".
 */
function FavoriteCell({ favorite, database, schema, table }: { favorite: boolean; database: string; schema: string; table: string }) {
  const { t } = useTranslation()

  return (
    <td className="text-center d-print-none">
      <a
        className="ajax favorite_table_anchor"
        href={favorite ? '#remove-favorite' : '#add-favorite'}
        title={favorite ? t('quick_warp.remove_favorite') : t('quick_warp.add_favorite')}
        onClick={(e) => {
          e.preventDefault()
          toggleFavorite({ database, schema, table }).catch((err: unknown) => notifyError(errorMessage(err)))
        }}
      >
        <span className="text-nowrap">
          <Icon name={favorite ? 'b_favorite' : 'b_no_favorite'} />
          {' '}
        </span>
      </a>
    </td>
  )
}
