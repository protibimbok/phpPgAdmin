import { useEffect, useState } from 'react'
import { registerPreferenceGroups, registerPreferences } from '@/preferences'
import { SHOW_SYSTEM } from '@/nodes/client'

/**
 * The navigation tree's state across pages, kept in sessionStorage the way phpMyAdmin's
 * navigation.ts keeps it (treeStateUpdate, navTreePaths): the open items as a list of their
 * paths, dropped when the tab is closed or the session is for another server or user, and
 * whether the tree follows the page shown ("Link with main panel").
 */

const PATHS_KEY = 'navTreePaths'
const LINKED_KEY = 'navTreeLinked'
const SERVER_KEY = 'navTreeServer'

/**
 * The tree's settings, on the Navigation panel settings page: how many databases the first
 * level shows per page (FirstLevelNavigationItems), how many items another list shows per
 * page (MaxNavigationItems), and how many a list may hold before a fast filter appears
 * (NavigationTreeDisplayItemFilterMinimum).
 */
export const FIRST_LEVEL_PAGE_SIZE = 'navigation.first_level_items'
export const PAGE_SIZE = 'navigation.max_items'
export const FILTER_MINIMUM = 'navigation.filter_minimum'

/**
 * The Recent and Favorites lists above the tree (NumRecentTables, NumFavoriteTables): how many
 * tables each keeps, 0 to hide it, in phpMyAdmin's Navigation panel group. The server reads the
 * same keys when it trims the lists.
 */
export const NUM_RECENT_TABLES = 'navigation.num_recent_tables'
export const NUM_FAVORITE_TABLES = 'navigation.num_favorite_tables'

registerPreferenceGroups([
  { page: 'navigation', id: 'panel', label: 'settings:groups.navigation_panel', description: 'settings:groups.navigation_panel_help' },
  { page: 'navigation', id: 'tree', label: 'settings:groups.navigation_tree', description: 'settings:groups.navigation_tree_help' },
])
registerPreferences([
  { key: FIRST_LEVEL_PAGE_SIZE, type: 'number', default: 100, min: 1, page: 'navigation', group: 'tree', label: 'settings:navigation.first_level_items', description: 'settings:navigation.first_level_items_help' },
  { key: PAGE_SIZE, type: 'number', default: 50, min: 1, page: 'navigation', group: 'tree', label: 'settings:navigation.max_items', description: 'settings:navigation.max_items_help' },
  { key: FILTER_MINIMUM, type: 'number', default: 30, min: 1, page: 'navigation', group: 'tree', label: 'settings:navigation.filter_minimum', description: 'settings:navigation.filter_minimum_help' },
  { key: SHOW_SYSTEM, type: 'boolean', default: false, page: 'navigation', group: 'tree', label: 'settings:navigation.show_system', description: 'settings:navigation.show_system_help' },
  { key: NUM_RECENT_TABLES, type: 'number', default: 10, min: 0, page: 'navigation', group: 'panel', label: 'settings:navigation.num_recent_tables', description: 'settings:navigation.num_recent_tables_help' },
  { key: NUM_FAVORITE_TABLES, type: 'number', default: 10, min: 0, page: 'navigation', group: 'panel', label: 'settings:navigation.num_favorite_tables', description: 'settings:navigation.num_favorite_tables_help' },
])

type Listener = () => void

const listeners = new Set<Listener>()

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = storage()?.getItem(key)

    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(key, JSON.stringify(value))
  } catch {
    // Storage may be full or blocked; the tree then only keeps its state for this page.
  }
}

let open: Set<string> | null = null
let linked: boolean | null = null
let version = 0

function paths(): Set<string> {
  if (!open) {
    const stored = read<unknown>(PATHS_KEY, [])
    open = new Set(Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : [])
  }

  return open
}

function emit(): void {
  for (const listener of listeners) listener()
}

/** Forgets the stored state when it was made for another server or user. */
export function bindTreeState(server: string): void {
  const store = storage()
  if (!store) return
  if (store.getItem(SERVER_KEY) !== server) {
    store.removeItem(PATHS_KEY)
    store.setItem(SERVER_KEY, server)
    open = new Set()
  }
}

export const treeState = {
  isOpen: (path: string): boolean => paths().has(path),
  setOpen(path: string, value: boolean): void {
    const current = paths()
    if (value === current.has(path)) return
    if (value) {
      current.add(path)
    } else {
      // Closing an item also forgets what was open inside it, as phpMyAdmin stores only the
      // deepest open items and reopens their ancestors.
      for (const p of current) {
        if (p === path || p.startsWith(`${path}/`)) current.delete(p)
      }
    }
    write(PATHS_KEY, [...current])
    emit()
  },
  collapseAll(): void {
    open = new Set()
    write(PATHS_KEY, [])
    emit()
  },
  isLinked: (): boolean => {
    if (linked === null) linked = read<boolean>(LINKED_KEY, true)

    return linked
  },
  setLinked(value: boolean): void {
    linked = value
    write(LINKED_KEY, value)
    emit()
  },
  /** Bumped when objects were created, renamed or dropped, so the lists load again. */
  version: (): number => version,
  refresh(): void {
    version++
    emit()
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)

    return () => {
      listeners.delete(listener)
    }
  },
}

/** Re-render when the tree state changes. */
export function useTreeState(): typeof treeState {
  const [, setTick] = useState(0)

  useEffect(() => treeState.subscribe(() => setTick((n) => n + 1)), [])

  return treeState
}
