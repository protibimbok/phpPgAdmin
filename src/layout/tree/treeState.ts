import { useEffect, useState } from 'react'

/**
 * The navigation tree's state across pages, kept in sessionStorage the way phpMyAdmin's
 * navigation.ts keeps it (treeStateUpdate, navTreePaths): the open items as a list of their
 * paths, dropped when the tab is closed or the session is for another server or user, and
 * whether the tree follows the page shown ("Link with main panel").
 */

const PATHS_KEY = 'navTreePaths'
const LINKED_KEY = 'navTreeLinked'
const SERVER_KEY = 'navTreeServer'

/** How many items a list may hold before a fast filter appears (NavigationTreeDisplayItemFilterMinimum). */
export const FILTER_MINIMUM = 30

/** How many items a list shows per page (MaxNavigationItems). */
export const PAGE_SIZE = 50

/** How many databases the first level shows per page (FirstLevelNavigationItems). */
export const FIRST_LEVEL_PAGE_SIZE = 100

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
