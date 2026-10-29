import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'
import { createRelation, deletePage, diagram, dropRelation, listPages, relationSql, savePage, tablesSql, type DesignerColumn, type DesignerPage, type DesignerTable, type Layout, type NewRelation } from '../api'
import angDirect from '../../img/ang_direct.png'
import downarrow1 from '../../img/downarrow1.png'
import downarrow2 from '../../img/downarrow2_m.png'
import execSmall from '../../img/exec_small.png'
import exitFullscreen from '../../img/exitFullscreen.png'
import exportIcon from '../../img/export.png'
import fieldChar from '../../img/Field_small_char.png'
import fieldDate from '../../img/Field_small_date.png'
import fieldInt from '../../img/Field_small_int.png'
import fieldKey from '../../img/FieldKey_small.png'
import field from '../../img/Field_small.png'
import grid from '../../img/grid.png'
import help from '../../img/help.png'
import leftArrow from '../../img/2leftarrow_m.png'
import pageAdd from '../../img/page_add.png'
import pageDelete from '../../img/page_delete.png'
import pageEdit from '../../img/page_edit.png'
import relationIcon from '../../img/relation.png'
import reload from '../../img/reload.png'
import rightArrow from '../../img/2rightarrow_m.png'
import save from '../../img/save.png'
import saveAsIcon from '../../img/save_as.png'
import tableIcon from '../../img/table.png'
import toggleLines from '../../img/toggle_lines.png'
import viewInFullscreen from '../../img/viewInFullscreen.png'

/** Where a new diagram puts its tables, and how far the grid snaps them. */
const ORIGIN = { x: 60, y: 20 }
const STEP = { x: 280, y: 40 }
const SNAP = 10
/** pgAdmin's ERD palette for the relation lines, one colour per relation in turn. */
const COLORS = ['#3366cc', '#dc3912', '#ff9900', '#109618', '#990099', '#0099c6', '#dd4477', '#66aa00', '#b82e2e', '#316395']
const ACTIONS = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']

const keyOf = (t: { schema: string; name: string }) => `${t.schema}.${t.name}`

/** A box's measures, read from the page: its width and height, and where each column's row is. */
interface Geometry {
  width: number
  height: number
  header: number
  rows: Record<string, { top: number; height: number }>
}

/** A relation as drawn: the foreign key's table and column, the referenced ones, its colour. */
interface Line {
  id: string
  from: DesignerTable
  column: string
  to: DesignerTable
  refColumn: string
  name: string
  color: string
}

/** A first layout: the tables in columns, each column as tall as its tables, in name order. */
function autoLayout(tables: DesignerTable[]): Layout['tables'] {
  const result: Layout['tables'] = {}
  const perColumn = Math.max(1, Math.ceil(Math.sqrt(tables.length)))
  const heights = new Array<number>(perColumn).fill(ORIGIN.y)
  tables.forEach((t, i) => {
    const col = i % perColumn
    result[keyOf(t)] = { x: ORIGIN.x + col * STEP.x, y: heights[col], small: false }
    heights[col] += 26 + 22 * t.columns.length + STEP.y
  })

  return result
}

function columnIcon(c: DesignerColumn): string {
  if (c.pk) return fieldKey
  if (c.category === 'N') return fieldInt
  if (c.category === 'S') return fieldChar
  if (c.category === 'D') return fieldDate

  return field
}

/**
 * The database's Designer, phpMyAdmin's database/designer with pgAdmin's ERD: the tables,
 * views and foreign tables of every schema as boxes on a canvas, dragged by their headers, with
 * a line for each foreign key from its column to the referenced one. The side menu has
 * phpMyAdmin's tools: the tables list (which are shown), fullscreen, new / open / save / save as
 * / delete page (layouts kept per role), create table, create relationship (click the referenced
 * column, then the foreign key's), reload, help, angular or direct links, snap to grid,
 * small/big all, the relation lines on or off, export (SVG, PNG, or the tables' CREATE
 * statements) and the menu on either side. A relation's line, clicked, offers to drop it.
 */
export default function Designer() {
  const db = useParams().db ?? ''
  const { t } = useTranslation('designer')
  const { t: tApp } = useTranslation()
  const navigate = useNavigate()
  const { data, error, reload: reloadDiagram } = useRequest(() => diagram(db), [db])
  const [layout, setLayout] = useState<Layout | null>(null)
  const [page, setPage] = useState<{ id: number | null; name: string }>({ id: null, name: '' })
  const [dirty, setDirty] = useState(false)
  const [menuRight, setMenuRight] = useState(false)
  const [listShown, setListShown] = useState(false)
  const [geometry, setGeometry] = useState<Record<string, Geometry>>({})
  const [dialog, setDialog] = useState<null | 'open' | 'save_as' | 'delete' | 'export' | 'help'>(null)
  const [relating, setRelating] = useState<null | { step: 'ref' } | { step: 'fk'; ref: { table: DesignerTable; column: string } }>(null)
  const [newRelation, setNewRelation] = useState<NewRelation | null>(null)
  const [dropping, setDropping] = useState<Line | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const outer = useRef<HTMLDivElement>(null)
  const boxes = useRef<Record<string, HTMLTableElement | null>>({})

  const tables = useMemo(() => data?.tables ?? [], [data])
  const byOid = useMemo(() => new Map(tables.map((tb) => [tb.oid, tb])), [tables])

  // A new diagram shows every table, laid out in columns; a reload keeps where they are.
  useEffect(() => {
    if (!data) return
    setLayout((current) => {
      if (current) {
        const kept = Object.fromEntries(Object.entries(current.tables).filter(([key]) => tables.some((tb) => keyOf(tb) === key)))
        return { ...current, tables: kept }
      }
      return { tables: autoLayout(tables), angular: true, grid: false, lines: true }
    })
  }, [data, tables])

  const shown = useMemo(() => tables.filter((tb) => layout?.tables[keyOf(tb)]), [tables, layout])

  // The boxes' measures, for the lines, after each change of what they show.
  useLayoutEffect(() => {
    const next: Record<string, Geometry> = {}
    for (const tb of shown) {
      const el = boxes.current[keyOf(tb)]
      if (!el) continue
      const head = el.tHead?.rows[0]
      const rows: Geometry['rows'] = {}
      el.querySelectorAll<HTMLTableRowElement>('tbody tr[data-column]').forEach((tr) => {
        rows[tr.dataset.column ?? ''] = { top: tr.offsetTop, height: tr.offsetHeight }
      })
      next[keyOf(tb)] = { width: el.offsetWidth, height: el.offsetHeight, header: head?.offsetHeight ?? 24, rows }
    }
    setGeometry(next)
  }, [shown, layout?.tables])

  const lines = useMemo<Line[]>(() => {
    const result: Line[] = []
    let i = 0
    for (const tb of shown) {
      for (const fk of tb.foreign_keys) {
        const to = byOid.get(fk.ref_oid)
        if (!to || !layout?.tables[keyOf(to)]) continue
        fk.columns.forEach((column, n) => {
          result.push({ id: `${keyOf(tb)}.${fk.name}.${n}`, from: tb, column, to, refColumn: fk.ref_columns[n], name: fk.name, color: COLORS[i % COLORS.length] })
        })
        i++
      }
    }
    return result
  }, [shown, byOid, layout])

  const change = useCallback((update: (current: Layout) => Layout) => {
    setLayout((current) => (current ? update(current) : current))
    setDirty(true)
  }, [])

  // Dragging a box by its header, snapped to the grid when it is on.
  function startDrag(e: ReactMouseEvent, key: string) {
    if (e.button !== 0 || !layout) return
    e.preventDefault()
    const origin = { x: layout.tables[key].x, y: layout.tables[key].y, mouseX: e.clientX, mouseY: e.clientY }
    const snap = layout.grid
    const move = (ev: MouseEvent) => {
      let x = Math.max(0, origin.x + ev.clientX - origin.mouseX)
      let y = Math.max(0, origin.y + ev.clientY - origin.mouseY)
      if (snap) {
        x = Math.round(x / SNAP) * SNAP
        y = Math.round(y / SNAP) * SNAP
      }
      change((l) => ({ ...l, tables: { ...l.tables, [key]: { ...l.tables[key], x, y } } }))
    }
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  /** A column clicked while a relation is being made: first the referenced key, then the foreign key. */
  function pickColumn(table: DesignerTable, column: string) {
    if (!relating) return
    if (relating.step === 'ref') {
      setRelating({ step: 'fk', ref: { table, column } })
      return
    }
    setRelating(null)
    setNewRelation({ schema: table.schema, table: table.name, column, ref_schema: relating.ref.table.schema, ref_table: relating.ref.table.name, ref_column: relating.ref.column, on_delete: 'NO ACTION', on_update: 'NO ACTION' })
  }

  async function saveAs(name: string) {
    if (!layout) return
    try {
      const saved = await savePage(db, name, layout)
      setPage({ id: saved.id, name: saved.name })
      setDirty(false)
      setDialog(null)
      notifySuccess(t('page_saved', { name: saved.name }))
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void outer.current?.requestFullscreen()
  }
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])

  if (error) {
    return (
      <div className="alert alert-danger m-3" role="alert">
        {error.message}
      </div>
    )
  }
  if (!data || !layout) return null

  const allSmall = shown.length > 0 && shown.every((tb) => layout.tables[keyOf(tb)].small)
  const width = Math.max(1200, ...shown.map((tb) => layout.tables[keyOf(tb)].x + (geometry[keyOf(tb)]?.width ?? 250) + 100))
  const height = Math.max(700, ...shown.map((tb) => layout.tables[keyOf(tb)].y + (geometry[keyOf(tb)]?.height ?? 300) + 100))
  const schemaForCreate = data.schemas.includes('public') ? 'public' : (data.schemas[0] ?? 'public')

  const menu: { id: string; icon: string; title: string; onClick: () => void; active?: boolean }[] = [
    { id: 'showdesignerpanel', icon: downarrow2, title: t('menu.tables_list'), onClick: () => setListShown((v) => !v), active: listShown },
    { id: 'toggleFullscreen', icon: fullscreen ? exitFullscreen : viewInFullscreen, title: fullscreen ? t('menu.exit_fullscreen') : t('menu.fullscreen'), onClick: toggleFullscreen },
    {
      id: 'newPage',
      icon: pageAdd,
      title: t('menu.new_page'),
      onClick: () => {
        setLayout({ tables: autoLayout(tables), angular: layout.angular, grid: layout.grid, lines: layout.lines })
        setPage({ id: null, name: '' })
        setDirty(false)
      },
    },
    { id: 'editPage', icon: pageEdit, title: t('menu.open_page'), onClick: () => setDialog('open') },
    { id: 'savePos', icon: save, title: t('menu.save_page'), onClick: () => (page.id === null ? setDialog('save_as') : void saveAs(page.name)) },
    { id: 'SaveAs', icon: saveAsIcon, title: t('menu.save_page_as'), onClick: () => setDialog('save_as') },
    { id: 'delPages', icon: pageDelete, title: t('menu.delete_pages'), onClick: () => setDialog('delete') },
    { id: 'StartTableNew', icon: tableIcon, title: t('menu.create_table'), onClick: () => navigate(`${urls.schema(db, schemaForCreate)}/create-table`) },
    { id: 'rel_button', icon: relationIcon, title: t('menu.create_relation'), onClick: () => setRelating((r) => (r ? null : { step: 'ref' })), active: relating !== null },
    { id: 'reloadPage', icon: reload, title: t('menu.reload'), onClick: () => reloadDiagram() },
    { id: 'help', icon: help, title: t('menu.help'), onClick: () => setDialog('help') },
    { id: 'angular_direct_button', icon: angDirect, title: t('menu.angular_direct'), onClick: () => change((l) => ({ ...l, angular: !l.angular })), active: !layout.angular },
    { id: 'grid_button', icon: grid, title: t('menu.grid'), onClick: () => change((l) => ({ ...l, grid: !l.grid })), active: layout.grid },
    {
      id: 'key_SB_all',
      icon: downarrow1,
      title: t('menu.small_big_all'),
      onClick: () => change((l) => ({ ...l, tables: Object.fromEntries(Object.entries(l.tables).map(([k, v]) => [k, { ...v, small: !allSmall }])) })),
      active: allSmall,
    },
    { id: 'toggle_lines', icon: toggleLines, title: t('menu.toggle_lines'), onClick: () => change((l) => ({ ...l, lines: !l.lines })), active: !layout.lines },
    { id: 'exportPages', icon: exportIcon, title: t('menu.export'), onClick: () => setDialog('export') },
    { id: 'key_Left_Right', icon: menuRight ? leftArrow : rightArrow, title: t('menu.move_menu'), onClick: () => setMenuRight((v) => !v) },
  ]

  /** Where a relation's line leaves a box: the column's row, on the side facing the other box. */
  const anchor = (tb: DesignerTable, column: string, toward: number) => {
    const pos = layout.tables[keyOf(tb)]
    const g = geometry[keyOf(tb)]
    if (!pos || !g) return null
    const row = pos.small ? undefined : g.rows[column]
    const y = pos.y + (row ? row.top + row.height / 2 : g.header / 2)
    const right = toward > pos.x + g.width / 2

    return { x: right ? pos.x + g.width : pos.x, y, right }
  }

  return (
    <div id="designer" ref={outer} className="content_fullscreen bg-white" style={{ height: fullscreen ? '100vh' : undefined }}>
      <div id="name-panel">
        <span id="page_name">{page.name || t('untitled')}</span>
        {dirty && <span id="saved_state"> *</span>}
      </div>

      <div className={`side-menu${menuRight ? ' right' : ''}`} id="side_menu" style={{ position: 'absolute', top: 40, [menuRight ? 'right' : 'left']: 0 }}>
        {menu.map((m) => (
          <a
            key={m.id}
            id={m.id}
            href="#"
            className={`M_butt${m.active ? ' M_butt_Selected_down' : ''}`}
            title={m.title}
            onClick={(e) => {
              e.preventDefault()
              m.onClick()
            }}
          >
            <img src={m.icon} title={m.title} alt={m.title} />
          </a>
        ))}
      </div>

      {relating && (
        <div id="designer_hint" className="alert alert-success py-1 px-2" style={{ display: 'block', position: 'absolute', top: 40, left: 60, zIndex: 60 }}>
          {relating.step === 'ref' ? t('hint.pick_ref') : t('hint.pick_fk', { column: `${relating.ref.table.name}.${relating.ref.column}` })}
        </div>
      )}

      {listShown && (
        <TablesList
          tables={tables}
          shown={layout.tables}
          onToggle={(tb, on) =>
            change((l) => {
              const next = { ...l.tables }
              if (on) next[keyOf(tb)] = { x: ORIGIN.x, y: ORIGIN.y, small: false }
              else delete next[keyOf(tb)]
              return { ...l, tables: next }
            })
          }
          onAll={(on) => change((l) => ({ ...l, tables: on ? { ...autoLayout(tables.filter((tb) => !l.tables[keyOf(tb)])), ...l.tables } : {} }))}
        />
      )}

      <div id="canvas_outer" style={{ overflow: 'auto', height: fullscreen ? 'calc(100vh - 40px)' : 'calc(100vh - 160px)' }}>
        <div id="canvas" style={{ position: 'relative', width, height, backgroundImage: layout.grid ? 'radial-gradient(#ccc 1px, transparent 1px)' : undefined, backgroundSize: `${SNAP * 2}px ${SNAP * 2}px` }}>
          {layout.lines && (
            <svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }} id="relations">
              {lines.map((line) => {
                const toPos = layout.tables[keyOf(line.to)]
                const fromPos = layout.tables[keyOf(line.from)]
                if (!toPos || !fromPos) return null
                const a = anchor(line.from, line.column, toPos.x + (geometry[keyOf(line.to)]?.width ?? 0) / 2)
                const b = anchor(line.to, line.refColumn, fromPos.x + (geometry[keyOf(line.from)]?.width ?? 0) / 2)
                if (!a || !b) return null
                const ax = a.x + (a.right ? 8 : -8)
                const bx = b.x + (b.right ? 8 : -8)
                const mid = a.right === b.right ? (a.right ? Math.max(ax, bx) + 20 : Math.min(ax, bx) - 20) : (ax + bx) / 2
                const d = layout.angular ? `M ${a.x} ${a.y} H ${ax} H ${mid} V ${b.y} H ${bx} H ${b.x}` : `M ${a.x} ${a.y} L ${ax} ${a.y} L ${bx} ${b.y} L ${b.x} ${b.y}`
                return (
                  <g key={line.id} className="relation" style={{ cursor: 'pointer' }} onClick={() => setDropping(line)}>
                    <title>{`${line.name}: ${line.from.name}.${line.column} → ${line.to.name}.${line.refColumn}`}</title>
                    <path d={d} stroke="transparent" strokeWidth={9} fill="none" />
                    <path d={d} stroke={line.color} strokeWidth={1.5} fill="none" />
                    <circle cx={ax} cy={a.y} r={3} fill={line.color} />
                    <rect x={bx - 3} y={b.y - 3} width={6} height={6} fill={line.color} />
                  </g>
                )
              })}
            </svg>
          )}

          {shown.map((tb) => {
            const key = keyOf(tb)
            const pos = layout.tables[key]
            return (
              <table
                key={key}
                id={key}
                ref={(el) => {
                  boxes.current[key] = el
                }}
                className="table table-sm table-striped table-hover w-auto designer_tab"
                style={{ position: 'absolute', left: pos.x, top: pos.y, display: 'block', zIndex: 1 }}
              >
                <thead>
                  <tr className="header">
                    <td
                      className="small_tab"
                      title={t('box.toggle')}
                      onClick={() => change((l) => ({ ...l, tables: { ...l.tables, [key]: { ...l.tables[key], small: !l.tables[key].small } } }))}
                    >
                      {pos.small ? '>' : 'v'}
                    </td>
                    <td className="small_tab_pref">
                      <Link to={`${urls.relation(db, tb.schema, tb.name, tb.kind === 'v' ? 'view' : tb.kind === 'm' ? 'mview' : 'table')}/structure`}>
                        <img src={execSmall} title={t('box.structure')} alt={t('box.structure')} />
                      </Link>
                    </td>
                    <td className="tab_zag text-nowrap tab_zag_noquery" onMouseDown={(e) => startDrag(e, key)} title={tb.comment ?? undefined}>
                      <span className="owner">{tb.schema}</span> {tb.name}
                    </td>
                  </tr>
                </thead>
                {!pos.small && (
                  <tbody>
                    {tb.columns.map((c) => (
                      <tr
                        key={c.name}
                        data-column={c.name}
                        className={c.not_null && !c.pk ? 'tab_field_3' : 'tab_field'}
                        onClick={() => pickColumn(tb, c.name)}
                        style={relating ? { cursor: 'crosshair' } : undefined}
                      >
                        <td colSpan={3}>
                          <div className="text-nowrap">
                            <img src={columnIcon(c)} alt="*" /> {c.name} : {c.type}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            )
          })}
        </div>
      </div>

      <PagesDialog
        mode={dialog === 'open' || dialog === 'delete' ? dialog : null}
        db={db}
        onClose={() => setDialog(null)}
        onOpen={(p) => {
          setLayout({ angular: p.layout.angular ?? true, grid: p.layout.grid ?? false, lines: p.layout.lines ?? true, tables: p.layout.tables ?? {} })
          setPage({ id: p.id, name: p.name })
          setDirty(false)
          setDialog(null)
        }}
        onDeleted={(ids) => {
          if (page.id !== null && ids.includes(page.id)) {
            setPage({ id: null, name: '' })
            setDirty(true)
          }
        }}
      />
      <SaveAsDialog show={dialog === 'save_as'} initial={page.name} onClose={() => setDialog(null)} onSave={(name) => void saveAs(name)} />
      <ExportDialog show={dialog === 'export'} db={db} tables={shown} layout={layout} geometry={geometry} title={page.name || t('untitled')} onClose={() => setDialog(null)} />
      <Modal show={dialog === 'help'} title={t('menu.help')} onClose={() => setDialog(null)}>
        <p>{t('help.intro')}</p>
        <ul>
          <li>{t('help.drag')}</li>
          <li>{t('help.relation')}</li>
          <li>{t('help.drop')}</li>
          <li>{t('help.pages')}</li>
        </ul>
      </Modal>

      <RelationDialog
        db={db}
        relation={newRelation}
        onChange={setNewRelation}
        onClose={() => setNewRelation(null)}
        onCreated={() => {
          setNewRelation(null)
          treeState.refresh()
          reloadDiagram()
        }}
      />

      <ConfirmQuery
        show={dropping !== null}
        sql={dropping ? `ALTER TABLE ${dropping.from.schema}.${dropping.from.name} DROP CONSTRAINT ${dropping.name};` : ''}
        warning={dropping ? t('drop_relation', { name: dropping.name }) : undefined}
        confirmLabel={tApp('drop')}
        confirmClass="btn-danger"
        onClose={() => setDropping(null)}
        onConfirm={() => {
          const line = dropping
          setDropping(null)
          if (!line) return
          dropRelation(db, { schema: line.from.schema, table: line.from.name, name: line.name }).then(
            () => {
              notifySuccess(t('relation_dropped', { name: line.name }))
              treeState.refresh()
              reloadDiagram()
            },
            (e: unknown) => notifyError(errorMessage(e)),
          )
        }}
      />
    </div>
  )
}

/** phpMyAdmin's tables list (#layer_menu): each relation with a box to show it on the canvas or not. */
function TablesList({ tables, shown, onToggle, onAll }: { tables: DesignerTable[]; shown: Layout['tables']; onToggle: (tb: DesignerTable, on: boolean) => void; onAll: (on: boolean) => void }) {
  const { t } = useTranslation('designer')
  const [filter, setFilter] = useState('')
  const visible = tables.filter((tb) => keyOf(tb).toLowerCase().includes(filter.toLowerCase()))
  const all = tables.every((tb) => shown[keyOf(tb)])

  return (
    <div id="layer_menu" className="p-2" style={{ position: 'absolute', right: 0, top: 40, zIndex: 98, maxHeight: '70vh', overflow: 'auto' }}>
      <input type="text" className="form-control form-control-sm mb-2" placeholder={t('list.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="form-check">
        <input className="form-check-input" type="checkbox" id="designer_all" checked={all} onChange={(e) => onAll(e.target.checked)} />
        <label className="form-check-label fw-bold" htmlFor="designer_all">
          {t('list.all')}
        </label>
      </div>
      {visible.map((tb) => (
        <div className="form-check" key={keyOf(tb)}>
          <input className="form-check-input" type="checkbox" id={`designer_show_${keyOf(tb)}`} checked={Boolean(shown[keyOf(tb)])} onChange={(e) => onToggle(tb, e.target.checked)} />
          <label className="form-check-label text-nowrap" htmlFor={`designer_show_${keyOf(tb)}`}>
            <span className="owner">{tb.schema}</span> {tb.name}
          </label>
        </div>
      ))}
    </div>
  )
}

/** Open page and Delete pages: the role's pages of this database. */
function PagesDialog({ mode, db, onClose, onOpen, onDeleted }: { mode: 'open' | 'delete' | null; db: string; onClose: () => void; onOpen: (page: DesignerPage) => void; onDeleted: (ids: number[]) => void }) {
  const { t } = useTranslation('designer')
  const { t: tApp } = useTranslation()
  const { data: pages, reload } = useRequest(() => (mode ? listPages(db) : Promise.resolve([] as DesignerPage[])), [mode, db])
  const [chosen, setChosen] = useState<Set<number>>(new Set())

  async function remove() {
    try {
      for (const id of chosen) await deletePage(db, id)
      onDeleted([...chosen])
      notifySuccess(t('pages_deleted', { count: chosen.size }))
      setChosen(new Set())
      reload()
    } catch (e) {
      notifyError(errorMessage(e))
    }
  }

  return (
    <Modal
      show={mode !== null}
      title={mode === 'delete' ? t('menu.delete_pages') : t('menu.open_page')}
      onClose={onClose}
      footer={
        mode === 'delete' ? (
          <button type="button" className="btn btn-danger" disabled={chosen.size === 0} onClick={() => void remove()}>
            {tApp('drop')}
          </button>
        ) : undefined
      }
    >
      {!pages ? (
        tApp('loading')
      ) : pages.length === 0 ? (
        <div className="alert alert-primary mb-0" role="alert">
          {t('no_pages')}
        </div>
      ) : (
        <table className="table table-striped table-hover w-auto mb-0">
          <tbody>
            {pages.map((p) => (
              <tr key={p.id}>
                {mode === 'delete' && (
                  <td>
                    <input
                      type="checkbox"
                      aria-label={p.name}
                      checked={chosen.has(p.id)}
                      onChange={(e) =>
                        setChosen((s) => {
                          const next = new Set(s)
                          if (e.target.checked) next.add(p.id)
                          else next.delete(p.id)
                          return next
                        })
                      }
                    />
                  </td>
                )}
                <td>
                  {mode === 'open' ? (
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        onOpen(p)
                      }}
                    >
                      {p.name}
                    </a>
                  ) : (
                    p.name
                  )}
                </td>
                <td className="text-muted">{new Date(p.updated_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  )
}

function SaveAsDialog({ show, initial, onClose, onSave }: { show: boolean; initial: string; onClose: () => void; onSave: (name: string) => void }) {
  const { t } = useTranslation('designer')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState(initial)
  useEffect(() => {
    if (show) setName(initial)
  }, [show, initial])

  return (
    <Modal
      show={show}
      title={t('menu.save_page_as')}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" disabled={name.trim() === ''} onClick={() => onSave(name.trim())}>
          {tApp('go')}
        </button>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim() !== '') onSave(name.trim())
        }}
      >
        <label className="form-label" htmlFor="selected_value">
          {t('page_name')}
        </label>
        <input className="form-control" id="selected_value" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </form>
    </Modal>
  )
}

/** phpMyAdmin's "Create relationship" layer: the two columns, ON DELETE and ON UPDATE, OK. */
function RelationDialog({ db, relation, onChange, onClose, onCreated }: { db: string; relation: NewRelation | null; onChange: (r: NewRelation) => void; onClose: () => void; onCreated: () => void }) {
  const { t } = useTranslation('designer')
  const { t: tApp } = useTranslation()
  const [sql, setSql] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!relation) return
    setBusy(true)
    try {
      await createRelation(db, relation)
      notifySuccess(t('relation_created'))
      onCreated()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal
        show={relation !== null}
        title={t('menu.create_relation')}
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
              {tApp('ok')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => relation && relationSql(db, relation).then(setSql, (e: unknown) => notifyError(errorMessage(e)))}>
              {tApp('preview_sql')}
            </button>
          </>
        }
      >
        {relation && (
          <table className="table table-borderless table-sm w-auto mb-0" id="layer_new_relation_table">
            <tbody>
              <tr>
                <th>{t('relation.foreign_key')}</th>
                <td>
                  {relation.schema}.{relation.table}.{relation.column}
                </td>
              </tr>
              <tr>
                <th>{t('relation.references')}</th>
                <td>
                  {relation.ref_schema}.{relation.ref_table}.{relation.ref_column}
                </td>
              </tr>
              {(['on_delete', 'on_update'] as const).map((key) => (
                <tr key={key}>
                  <th>
                    <label htmlFor={key}>{t(`relation.${key}`)}</label>
                  </th>
                  <td>
                    <select id={key} value={relation[key]} onChange={(e) => onChange({ ...relation, [key]: e.target.value })}>
                      {ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>
      <Modal show={sql !== null} title={tApp('preview_sql')} onClose={() => setSql(null)}>
        <SqlView sql={sql ?? ''} />
      </Modal>
    </>
  )
}

/** The diagram as phpMyAdmin's schema export makes it: an SVG or PNG picture, or (pgAdmin's ERD) the tables' SQL. */
function ExportDialog({ show, db, tables, layout, geometry, title, onClose }: { show: boolean; db: string; tables: DesignerTable[]; layout: Layout; geometry: Record<string, Geometry>; title: string; onClose: () => void }) {
  const { t } = useTranslation('designer')
  const { t: tApp } = useTranslation()
  const [format, setFormat] = useState<'svg' | 'png' | 'sql'>('svg')
  const [busy, setBusy] = useState(false)

  const download = (blob: Blob, ext: string) => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${db}-${title.replace(/[^\w.-]+/g, '_')}.${ext}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function go() {
    setBusy(true)
    try {
      if (format === 'sql') {
        download(new Blob([await tablesSql(db, tables.map((tb) => tb.oid))], { type: 'text/plain' }), 'sql')
      } else {
        const svg = toSvg(tables, layout, geometry)
        if (format === 'svg') download(new Blob([svg.markup], { type: 'image/svg+xml' }), 'svg')
        else download(await toPng(svg), 'png')
      }
      onClose()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      show={show}
      title={t('menu.export')}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-primary" disabled={busy || tables.length === 0} onClick={() => void go()}>
          {tApp('go')}
        </button>
      }
    >
      <label className="form-label" htmlFor="plugins">
        {t('export.format')}
      </label>
      <select className="form-select" id="plugins" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
        <option value="svg">{t('export.svg')}</option>
        <option value="png">{t('export.png')}</option>
        <option value="sql">{t('export.sql')}</option>
      </select>
    </Modal>
  )
}

/** The diagram drawn again as a standalone SVG: the boxes with their headers and columns, and the lines. */
function toSvg(tables: DesignerTable[], layout: Layout, geometry: Record<string, Geometry>): { markup: string; width: number; height: number } {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const width = Math.max(...tables.map((tb) => layout.tables[keyOf(tb)].x + (geometry[keyOf(tb)]?.width ?? 200))) + 40
  const height = Math.max(...tables.map((tb) => layout.tables[keyOf(tb)].y + (geometry[keyOf(tb)]?.height ?? 100))) + 40
  const parts: string[] = []
  const svgLines = document.getElementById('relations')
  if (layout.lines && svgLines) parts.push(svgLines.innerHTML.replace(/<title>.*?<\/title>/g, ''))
  for (const tb of tables) {
    const pos = layout.tables[keyOf(tb)]
    const g = geometry[keyOf(tb)]
    if (!g) continue
    parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${g.width}" height="${g.height}" fill="#fff" stroke="#aaa"/>`)
    parts.push(`<rect x="${pos.x}" y="${pos.y}" width="${g.width}" height="${g.header}" fill="#9bd2f6"/>`)
    parts.push(`<text x="${pos.x + g.width / 2}" y="${pos.y + g.header / 2 + 4}" text-anchor="middle" font-weight="bold"><tspan fill="#888" font-weight="normal">${esc(tb.schema)}</tspan> ${esc(tb.name)}</text>`)
    if (!pos.small) {
      for (const c of tb.columns) {
        const row = g.rows[c.name]
        if (!row) continue
        parts.push(`<text x="${pos.x + 6}" y="${pos.y + row.top + row.height / 2 + 4}">${c.pk ? '🔑 ' : ''}${esc(c.name)} : ${esc(c.type)}</text>`)
      }
    }
  }

  return {
    markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="sans-serif" font-size="12"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`,
    width,
    height,
  }
}

function toPng(svg: { markup: string; width: number; height: number }): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = svg.width
      canvas.height = svg.height
      canvas.getContext('2d')?.drawImage(img, 0, 0)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The picture could not be made.'))), 'image/png')
    }
    img.onerror = () => reject(new Error('The picture could not be made.'))
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.markup)}`
  })
}
