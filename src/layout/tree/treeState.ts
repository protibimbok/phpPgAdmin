/**
 * Which tree items are open, kept across reloads the way phpMyAdmin's navigation.js keeps
 * its `navTreePaths` in sessionStorage: a list of the open items' paths, dropped when the
 * tab is closed or the session is for another server or user.
 */
const PATHS_KEY = 'navTreePaths'
const SERVER_KEY = 'navTreeServer'

let open: Set<string> | null = null

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
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

function load(): Set<string> {
  if (open) return open
  try {
    const raw = storage()?.getItem(PATHS_KEY)
    const paths: unknown = raw ? JSON.parse(raw) : []
    open = new Set(Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [])
  } catch {
    open = new Set()
  }
  return open
}

function save(): void {
  const store = storage()
  if (!store) return
  try {
    store.setItem(PATHS_KEY, JSON.stringify([...load()]))
  } catch {
    store.removeItem(PATHS_KEY)
  }
}

export function isTreeItemOpen(path: string): boolean {
  return load().has(path)
}

export function setTreeItemOpen(path: string, isOpen: boolean): void {
  const paths = load()
  if (isOpen) {
    paths.add(path)
  } else {
    // Closing an item also forgets what was open inside it, as phpMyAdmin stores only the
    // deepest open items and reopens their ancestors.
    for (const p of paths) {
      if (p === path || p.startsWith(`${path}/`)) paths.delete(p)
    }
  }
  save()
}
