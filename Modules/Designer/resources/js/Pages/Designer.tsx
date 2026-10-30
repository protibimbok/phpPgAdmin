import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'
import { createRelation, deletePage, diagram, dropRelation, listPages, relationSql, savePage, tablesSql, type DesignerColumn, type DesignerPage, type DesignerTable, type Layout, type NewRelation, type View } from '../api'
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
/** How far the canvas zooms out and in, and by how much a step goes. */
const ZOOM = { min: 0.1, max: 3, step: 1.2 }
/** How far the pointer goes before a press on a box or the canvas becomes a drag. */
const THRESHOLD = 3
const MINIMAP = { width: 180, height: 120 }

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

const clampZoom = (zoom: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, zoom))

/** The view zoomed by a factor around a point of the viewport, which stays where it is. */
function zoomView(v: View, factor: number, cx: number, cy: number): View {
  const zoom = clampZoom(v.zoom * factor)
  const k = zoom / v.zoom

  return { zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
}

/** The view that shows a rectangle of the canvas whole and centred, no larger than life. */
function fitView(b: Rect, size: { width: number; height: number }): View {
  const pad = 50
  const zoom = clampZoom(Math.min(1, (size.width - 2 * pad) / Math.max(1, b.width), (size.height - 2 * pad) / Math.max(1, b.height)))

  return { zoom, x: (size.width - b.width * zoom) / 2 - b.x * zoom, y: (size.height - b.height * zoom) / 2 - b.y * zoom }
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The rectangle the given boxes take on the canvas, or null when there are none. */
function boxBounds(keys: string[], layout: Layout, geometry: Record<string, Geometry>): Rect | null {
  const rects = keys.filter((k) => layout.tables[k]).map((k) => ({ x: layout.tables[k].x, y: layout.tables[k].y, width: geometry[k]?.width ?? 250, height: geometry[k]?.height ?? 100 }))
  if (rects.length === 0) return null
  const x = Math.min(...rects.map((r) => r.x))
  const y = Math.min(...rects.map((r) => r.y))

  return { x, y, width: Math.max(...rects.map((r) => r.x + r.width)) - x, height: Math.max(...rects.map((r) => r.y + r.height)) - y }
}

/** Swallows the click a drag ends with, so dropping a box on its link or a column does not follow them. */
function swallowClick() {
  const stop = (e: Event) => {
    e.stopPropagation()
    e.preventDefault()
  }
  window.addEventListener('click', stop, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0)
}

/** Follows the pointer from a press until it is released, telling how far it went. */
function track(e: ReactMouseEvent, onMove: (dx: number, dy: number, ev: MouseEvent) => void, onUp: (moved: boolean, ev: MouseEvent) => void) {
  const start = { x: e.clientX, y: e.clientY }
  let moved = false
  const move = (ev: MouseEvent) => {
    if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < THRESHOLD) return
    moved = true
    onMove(ev.clientX - start.x, ev.clientY - start.y, ev)
  }
  const up = (ev: MouseEvent) => {
    document.removeEventListener('mousemove', move)
    document.removeEventListener('mouseup', up)
    if (moved) swallowClick()
    onUp(moved, ev)
  }
  document.addEventListener('mousemove', move)
  document.addEventListener('mouseup', up)
}

const editable = (target: EventTarget) => target instanceof HTMLElement && target.closest('input, select, textarea') !== null

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
 *
 * The canvas has no edges: dragging its background (or anywhere with Space held, or with the
 * middle button) pans it, the wheel scrolls it and Ctrl+wheel or a pinch zooms around the
 * pointer, with zoom buttons, fit and a minimap in the corner. A box is dragged from anywhere on
 * it; Shift or Ctrl adds boxes to the selection, Shift+drag on the background selects by
 * rectangle, and the selected boxes move together, with the arrow keys too.
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
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [order, setOrder] = useState<string[]>([])
  const [band, setBand] = useState<null | { x0: number; y0: number; x1: number; y1: number }>(null)
  const [panning, setPanning] = useState(false)
  const [minimap, setMinimap] = useState(true)
  const outer = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const boxes = useRef<Record<string, HTMLTableElement | null>>({})
  const spaceDown = useRef(false)
  /** Set when the next measured layout should be fitted to the viewport: a new diagram or page. */
  const fitPending = useRef(true)

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

  // What is shown and folded, as strings, so that moving a box does not measure them all again.
  const shownKey = tables.filter((tb) => layout?.tables[keyOf(tb)]).map(keyOf).join('\n')
  const smallKey = tables.map((tb) => (layout?.tables[keyOf(tb)]?.small ? '1' : '0')).join('')
  const shown = useMemo(() => {
    const keys = new Set(shownKey.split('\n'))
    return tables.filter((tb) => keys.has(keyOf(tb)))
  }, [tables, shownKey])

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
  }, [shown, smallKey])

  const ready = data !== null && data !== undefined && layout !== null

  // The viewport's size, and the wheel: scrolling pans, Ctrl or a pinch zooms around the pointer.
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const resize = new ResizeObserver(() => setSize({ width: el.clientWidth, height: el.clientHeight }))
    resize.observe(el)
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        setView((v) => zoomView(v, Math.exp(-e.deltaY * unit * 0.002), e.clientX - rect.left, e.clientY - rect.top))
        return
      }
      const sideways = e.shiftKey && e.deltaX === 0
      setView((v) => ({ ...v, x: v.x - (sideways ? e.deltaY : e.deltaX) * unit, y: v.y - (sideways ? 0 : e.deltaY) * unit }))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      resize.disconnect()
      el.removeEventListener('wheel', wheel)
    }
  }, [ready])

  // A new diagram or a page saved without a view opens fitted to the viewport, once its boxes are measured.
  useEffect(() => {
    if (!fitPending.current || !layout || size.width === 0 || shown.some((tb) => !geometry[keyOf(tb)])) return
    fitPending.current = false
    const b = boxBounds(shown.map(keyOf), layout, geometry)
    setView(b ? fitView(b, size) : { x: 0, y: 0, zoom: 1 })
  }, [geometry, size, layout, shown])

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

  /** Moves boxes by an offset from where they were, snapping the first to the grid when it is on. */
  const moveBoxes = useCallback(
    (starts: Record<string, { x: number; y: number }>, lead: string, dx: number, dy: number, snap: boolean) => {
      let ox = dx
      let oy = dy
      if (snap) {
        ox = Math.round((starts[lead].x + dx) / SNAP) * SNAP - starts[lead].x
        oy = Math.round((starts[lead].y + dy) / SNAP) * SNAP - starts[lead].y
      }
      change((l) => {
        const next = { ...l.tables }
        for (const [k, start] of Object.entries(starts)) if (next[k]) next[k] = { ...next[k], x: start.x + ox, y: start.y + oy }
        return { ...l, tables: next }
      })
    },
    [change],
  )

  const raise = (key: string) => setOrder((o) => (o[o.length - 1] === key ? o : [...o.filter((k) => k !== key), key]))

  /**
   * A press on a box: it is selected (Shift or Ctrl adds it to the selection or takes it out) and
   * brought to the front, and dragging moves it with the rest of the selection, snapped to the
   * grid when it is on. A press that does not move leaves clicks on the box to work as before.
   */
  function startBoxDrag(e: ReactMouseEvent, key: string) {
    if (e.button !== 0 || spaceDown.current || !layout) return
    e.stopPropagation()
    if (editable(e.target)) return
    e.preventDefault()
    outer.current?.focus({ preventScroll: true })
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    const group = new Set(additive || selected.has(key) ? selected : [])
    if (additive && group.has(key)) group.delete(key)
    else group.add(key)
    setSelected(group)
    raise(key)
    if (!group.has(key)) return
    const starts = Object.fromEntries([...group].filter((k) => layout.tables[k]).map((k) => [k, { x: layout.tables[k].x, y: layout.tables[k].y }]))
    const zoom = view.zoom
    const snap = layout.grid
    track(
      e,
      (dx, dy) => moveBoxes(starts, key, dx / zoom, dy / zoom, snap),
      (moved) => {
        if (!moved && !additive && group.size > 1) setSelected(new Set([key]))
      },
    )
  }

  /**
   * A press on the canvas: on the background it pans, or with Shift draws a rectangle that selects
   * the boxes it touches; the middle button, or Space held, pans from anywhere. A click on the
   * background clears the selection.
   */
  function startCanvas(e: ReactMouseEvent) {
    const el = viewport.current
    if (!el || !layout) return
    outer.current?.focus({ preventScroll: true })
    const background = e.target === el || e.target === canvas.current
    const rect = el.getBoundingClientRect()
    if (e.button === 1 || (e.button === 0 && (spaceDown.current || (background && !e.shiftKey)))) {
      e.preventDefault()
      const from = { x: view.x, y: view.y }
      setPanning(true)
      track(
        e,
        (dx, dy) => setView((v) => ({ ...v, x: from.x + dx, y: from.y + dy })),
        (moved) => {
          setPanning(false)
          if (!moved && e.button === 0 && background) setSelected(new Set())
        },
      )
      return
    }
    if (e.button !== 0 || !background) return
    e.preventDefault()
    const x0 = e.clientX - rect.left
    const y0 = e.clientY - rect.top
    setBand({ x0, y0, x1: x0, y1: y0 })
    const v = view
    const base = new Set(selected)
    track(
      e,
      (_dx, _dy, ev) => setBand({ x0, y0, x1: ev.clientX - rect.left, y1: ev.clientY - rect.top }),
      (_moved, ev) => {
        setBand(null)
        const x1 = ev.clientX - rect.left
        const y1 = ev.clientY - rect.top
        const area = { left: (Math.min(x0, x1) - v.x) / v.zoom, top: (Math.min(y0, y1) - v.y) / v.zoom, right: (Math.max(x0, x1) - v.x) / v.zoom, bottom: (Math.max(y0, y1) - v.y) / v.zoom }
        const next = new Set(base)
        for (const tb of shown) {
          const k = keyOf(tb)
          const pos = layout.tables[k]
          const g = geometry[k]
          if (pos && g && pos.x < area.right && pos.x + g.width > area.left && pos.y < area.bottom && pos.y + g.height > area.top) next.add(k)
        }
        setSelected(next)
      },
    )
  }

  const zoomBy = (factor: number) => setView((v) => zoomView(v, factor, size.width / 2, size.height / 2))
  const fit = (keys: string[]) => {
    const b = layout ? boxBounds(keys, layout, geometry) : null
    if (b && size.width > 0) setView(fitView(b, size))
  }

  /** The keyboard, while the Designer has the focus: Space to pan, arrows to move, zoom, select all, Escape. */
  function onKeyDown(e: ReactKeyboardEvent) {
    if (editable(e.target) || dialog !== null || newRelation !== null || dropping !== null || !layout) return
    if (e.key === ' ') {
      if (e.target instanceof HTMLElement && e.target.closest('button, a')) return
      spaceDown.current = true
      e.preventDefault()
      return
    }
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (arrows[e.key] && selected.size > 0) {
      e.preventDefault()
      const step = e.shiftKey ? SNAP * 5 : layout.grid ? SNAP : 1
      const keys = [...selected].filter((k) => layout.tables[k])
      if (keys.length === 0) return
      const starts = Object.fromEntries(keys.map((k) => [k, { x: layout.tables[k].x, y: layout.tables[k].y }]))
      moveBoxes(starts, keys[0], arrows[e.key][0] * step, arrows[e.key][1] * step, false)
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelected(new Set(shown.map(keyOf)))
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') {
      setRelating(null)
      setSelected(new Set())
    } else if (e.key === '+' || e.key === '=') zoomBy(ZOOM.step)
    else if (e.key === '-') zoomBy(1 / ZOOM.step)
    else if (e.key === '0') zoomBy(1 / view.zoom)
    else if (e.key === '1') fit(selected.size > 0 ? [...selected] : shown.map(keyOf))
    else return
    e.preventDefault()
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
      const saved = await savePage(db, name, { ...layout, view })
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
  // The lines' picture covers the boxes and the room their lines take around them.
  const content = boxBounds(shown.map(keyOf), layout, geometry)
  const area = content ? { x: content.x - 100, y: content.y - 100, width: content.width + 200, height: content.height + 200 } : { x: 0, y: 0, width: 1, height: 1 }
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
        fitPending.current = true
        setSelected(new Set())
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
    <div
      id="designer"
      ref={outer}
      tabIndex={-1}
      className="content_fullscreen bg-white"
      style={{ height: fullscreen ? '100vh' : undefined }}
      onKeyDown={onKeyDown}
      onKeyUp={(e) => {
        if (e.key === ' ') spaceDown.current = false
      }}
      onBlur={() => {
        spaceDown.current = false
      }}
    >
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
              // A table shown again lands in the middle of what is on screen.
              if (on) next[keyOf(tb)] = { x: Math.round((size.width / 2 - view.x) / view.zoom - 100), y: Math.round((size.height / 3 - view.y) / view.zoom), small: false }
              else delete next[keyOf(tb)]
              return { ...l, tables: next }
            })
          }
          onAll={(on) => change((l) => ({ ...l, tables: on ? { ...autoLayout(tables.filter((tb) => !l.tables[keyOf(tb)])), ...l.tables } : {} }))}
        />
      )}

      <div
        id="canvas_outer"
        ref={viewport}
        className={panning ? 'panning' : undefined}
        style={{ height: fullscreen ? 'calc(100vh - 40px)' : 'calc(100vh - 160px)', backgroundImage: layout.grid ? 'radial-gradient(#ccc 1px, transparent 1px)' : undefined, backgroundSize: `${SNAP * 2 * view.zoom}px ${SNAP * 2 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onMouseDown={startCanvas}
        onAuxClick={(e) => e.preventDefault()}
        onScroll={(e) => {
          // The browser scrolls the viewport to bring a focused link into sight; that becomes a pan.
          const el = e.currentTarget
          const dx = el.scrollLeft
          const dy = el.scrollTop
          if (dx === 0 && dy === 0) return
          el.scrollLeft = 0
          el.scrollTop = 0
          setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy }))
        }}
      >
        <div id="canvas" ref={canvas} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          {layout.lines && (
            <svg width={area.width} height={area.height} viewBox={`${area.x} ${area.y} ${area.width} ${area.height}`} style={{ position: 'absolute', left: area.x, top: area.y }} id="relations">
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
                const lit = selected.has(keyOf(line.from)) || selected.has(keyOf(line.to))
                return (
                  <g key={line.id} className="relation" onClick={() => setDropping(line)}>
                    <title>{`${line.name}: ${line.from.name}.${line.column} → ${line.to.name}.${line.refColumn}`}</title>
                    <path d={d} stroke="transparent" strokeWidth={9 / view.zoom} fill="none" />
                    <path d={d} stroke={line.color} strokeWidth={lit ? 3 : 1.5} fill="none" />
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
                className={`table table-sm table-striped table-hover w-auto designer_tab${selected.has(key) ? ' selected' : ''}`}
                style={{ position: 'absolute', left: pos.x, top: pos.y, display: 'block', zIndex: 2 + order.indexOf(key) }}
                onMouseDown={(e) => startBoxDrag(e, key)}
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
                      <Link to={`${urls.relation(db, tb.schema, tb.name, tb.kind === 'v' ? 'view' : tb.kind === 'm' ? 'mview' : 'table')}`} draggable={false}>
                        <img src={execSmall} title={t('box.structure')} alt={t('box.structure')} draggable={false} />
                      </Link>
                    </td>
                    <td className="tab_zag text-nowrap tab_zag_noquery" title={tb.comment ?? undefined}>
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
                            <img src={columnIcon(c)} alt="*" draggable={false} /> {c.name} : {c.type}
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

        {band && <div id="designer_band" style={{ left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }} />}

        <div id="designer_view" className={menuRight ? 'left' : undefined} onMouseDown={(e) => e.stopPropagation()}>
          {minimap && <Minimap tables={shown} layout={layout} geometry={geometry} view={view} size={size} selected={selected} onCenter={(x, y) => setView((v) => ({ ...v, x: size.width / 2 - x * v.zoom, y: size.height / 2 - y * v.zoom }))} />}
          <div className="zoom-bar">
            <button type="button" className="btn btn-sm" title={t('view.zoom_out')} onClick={() => zoomBy(1 / ZOOM.step)} disabled={view.zoom <= ZOOM.min}>
              <Icon name="b_minus" title={t('view.zoom_out')} />
            </button>
            <button type="button" className="btn btn-sm zoom-level" title={t('view.actual_size')} onClick={() => zoomBy(1 / view.zoom)}>
              {Math.round(view.zoom * 100)}%
            </button>
            <button type="button" className="btn btn-sm" title={t('view.zoom_in')} onClick={() => zoomBy(ZOOM.step)} disabled={view.zoom >= ZOOM.max}>
              <Icon name="b_plus" title={t('view.zoom_in')} />
            </button>
            <button type="button" className="btn btn-sm" title={t('view.fit')} onClick={() => fit(shown.map(keyOf))}>
              {t('view.fit_short')}
            </button>
            <button type="button" className={`btn btn-sm${minimap ? ' active' : ''}`} title={t('view.minimap')} aria-pressed={minimap} onClick={() => setMinimap((m) => !m)}>
              {t('view.minimap_short')}
            </button>
          </div>
        </div>
      </div>

      <PagesDialog
        mode={dialog === 'open' || dialog === 'delete' ? dialog : null}
        db={db}
        onClose={() => setDialog(null)}
        onOpen={(p) => {
          setLayout({ angular: p.layout.angular ?? true, grid: p.layout.grid ?? false, lines: p.layout.lines ?? true, tables: p.layout.tables ?? {} })
          setSelected(new Set())
          if (p.layout.view) {
            fitPending.current = false
            setView({ x: p.layout.view.x, y: p.layout.view.y, zoom: clampZoom(p.layout.view.zoom) })
          } else fitPending.current = true
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
          <li>{t('help.select')}</li>
          <li>{t('help.pan')}</li>
          <li>{t('help.zoom')}</li>
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

/** The whole diagram small, with the part on screen framed; a press or drag on it moves the view there. */
function Minimap({ tables, layout, geometry, view, size, selected, onCenter }: { tables: DesignerTable[]; layout: Layout; geometry: Record<string, Geometry>; view: View; size: { width: number; height: number }; selected: Set<string>; onCenter: (x: number, y: number) => void }) {
  const { t } = useTranslation('designer')
  const screen = { x: -view.x / view.zoom, y: -view.y / view.zoom, width: size.width / view.zoom, height: size.height / view.zoom }
  const content = boxBounds(tables.map(keyOf), layout, geometry) ?? screen
  const x = Math.min(content.x, screen.x) - 20
  const y = Math.min(content.y, screen.y) - 20
  const width = Math.max(content.x + content.width, screen.x + screen.width) + 20 - x
  const height = Math.max(content.y + content.height, screen.y + screen.height) + 20 - y
  const scale = Math.min(MINIMAP.width / width, MINIMAP.height / height)

  const press = (e: ReactMouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const svg = e.currentTarget.getBoundingClientRect()
    // The frame is fixed while dragging, so the drag follows the pointer even as the view moves.
    const at = (cx: number, cy: number) => onCenter(x + (cx - svg.left) / scale, y + (cy - svg.top) / scale)
    at(e.clientX, e.clientY)
    const move = (ev: MouseEvent) => at(ev.clientX, ev.clientY)
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <svg className="minimap" width={MINIMAP.width} height={MINIMAP.height} onMouseDown={press} role="img" aria-label={t('view.minimap')}>
      <g transform={`scale(${scale}) translate(${-x} ${-y})`}>
        {tables.map((tb) => {
          const k = keyOf(tb)
          const pos = layout.tables[k]
          return pos ? <rect key={k} x={pos.x} y={pos.y} width={geometry[k]?.width ?? 250} height={geometry[k]?.height ?? 100} className={selected.has(k) ? 'selected' : undefined} /> : null
        })}
        <rect className="screen" x={screen.x} y={screen.y} width={screen.width} height={screen.height} strokeWidth={1.5 / scale} />
      </g>
    </svg>
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
  // Boxes may sit anywhere on the canvas, left of or above its origin too: the picture starts at the first.
  const b = boxBounds(tables.map(keyOf), layout, geometry) ?? { x: 0, y: 0, width: 0, height: 0 }
  const margin = 40
  const width = b.width + 2 * margin
  const height = b.height + 2 * margin
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
    markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="sans-serif" font-size="12"><rect width="100%" height="100%" fill="#fff"/><g transform="translate(${margin - b.x} ${margin - b.y})">${parts.join('')}</g></svg>`,
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
