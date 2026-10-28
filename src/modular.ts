import type { ReactNode } from 'react'
import type { RouteObject } from 'react-router'
import { fillPath, type Level, type LevelName, type RelationKind } from './level'

/**
 * A tab in the menu bar under the breadcrumb, as phpMyAdmin lays out the pages of a server, a
 * database or a table; here also a schema. The label is an i18n key with its namespace,
 * "databases:tab", so it is translated when the bar renders and not when the module registers.
 */
export interface MenuItem {
  label: string
  /** The icon's name under src/img/icons, "s_db". */
  icon: string
  /**
   * Starts with "/". For a tab below the server level, a template with the level's names as
   * placeholders: "/db/:db/structure", "/db/:db/schema/:schema/table/:table/browse".
   */
  path: string
  /** The level whose bar the tab is in; the server's when left out. */
  level?: LevelName
  /** At the table level, the relation kinds the tab applies to; every kind when left out. */
  kinds?: RelationKind[]
}

/** Receives the menu the modules before it built and returns the one it wants. */
export type MenuFilter = (menu: MenuItem[]) => MenuItem[]

/** Names a tab by its label and level, for placing another next to it. */
export type MenuSlot = Pick<MenuItem, 'label' | 'level'>

const same = (a: MenuSlot, b: MenuItem) => a.label === b.label && (a.level ?? 'server') === (b.level ?? 'server')

/** The item placed after the one with that label at that level, or at the end when there is no such item. */
export function insertAfter(menu: MenuItem[], after: MenuSlot, item: MenuItem): MenuItem[] {
  const at = menu.findIndex((entry) => same(after, entry))

  return at === -1 ? [...menu, item] : [...menu.slice(0, at + 1), item, ...menu.slice(at + 1)]
}

/** The item placed before the one with that label at that level, or at the start when there is no such item. */
export function insertBefore(menu: MenuItem[], before: MenuSlot, item: MenuItem): MenuItem[] {
  const at = menu.findIndex((entry) => same(before, entry))

  return at === -1 ? [item, ...menu] : [...menu.slice(0, at), item, ...menu.slice(at)]
}

export interface ModuleRegistration {
  id: string
  /** Non-negative: from the start (0 = first). Negative: from the end (-1 = last). */
  order?: number
  menuFilter?: MenuFilter
  /** React Router route objects, rendered inside the layout. Paths do not start with "/". */
  routes?: RouteObject[]
  /**
   * Rendered for as long as the application is, whatever page is shown: the fills of the
   * slots that are not on a page of the module itself, <NavigationTree.Fill> for example.
   */
  fills?: ReactNode
}

const modules: ModuleRegistration[] = []

let orderedCache: ModuleRegistration[] | null = null

let sealed = false

/**
 * Called at the top level of a module's frontend script, which the HTML shell loads before
 * the application's own entry. One registration per module.
 */
export function registerModule(registration: ModuleRegistration): void {
  if (sealed) {
    throw new Error(
      `[modular] module "${registration.id}" was registered after the application started: call registerModule() at the top level of a frontend script`,
    )
  }

  if (modules.some((module) => module.id === registration.id)) {
    throw new Error(`[modular] module "${registration.id}" is already registered`)
  }

  modules.push(registration)
  orderedCache = null
}

/**
 * Closes the registry. The entry calls it before it renders: frontend scripts run before
 * it, so a registration that comes later would silently never show up.
 */
export function seal(): void {
  sealed = true
}

export function getModules(): readonly ModuleRegistration[] {
  if (orderedCache) return orderedCache

  const indexed = modules.map((module, registrationIndex) => ({ module, order: module.order ?? 0, registrationIndex }))
  const byOrder = (a: (typeof indexed)[number], b: (typeof indexed)[number]) =>
    a.order - b.order || a.registrationIndex - b.registrationIndex

  orderedCache = [
    ...indexed.filter((entry) => entry.order >= 0).sort(byOrder),
    ...indexed.filter((entry) => entry.order < 0).sort(byOrder),
  ].map((entry) => entry.module)

  return orderedCache
}

/** Every tab of every level, in module order. */
export function getMenu(): MenuItem[] {
  let menu: MenuItem[] = []

  for (const module of getModules()) {
    if (module.menuFilter) {
      menu = module.menuFilter(menu)
    }
  }

  return menu
}

/** The tabs of the level the page is at, their paths filled with the level's names. */
export function getMenuFor(level: Level): MenuItem[] {
  return getMenu()
    .filter((item) => (item.level ?? 'server') === level.name && (!item.kinds || item.kinds.includes(level.kind ?? 'table')))
    .map((item) => ({ ...item, path: fillPath(item.path, level) }))
}

export function getRoutes(): RouteObject[] {
  return getModules().flatMap((module) => module.routes ?? [])
}

export function isUnder(pathname: string, path: string): boolean {
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}

/** The one tab a page belongs to: the deepest that covers it, so a child page does not light up its parent too. */
export function activeMenuPath(pathname: string, menu: MenuItem[]): string | null {
  let match: string | null = null

  for (const item of menu) {
    if (isUnder(pathname, item.path) && (!match || item.path.length > match.length)) {
      match = item.path
    }
  }

  return match
}
