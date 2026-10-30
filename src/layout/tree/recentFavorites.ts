import { useSyncExternalStore } from 'react'
import { addFavoriteTable, getQuickWarpLists, recordRecentTable, removeFavoriteTable, type QuickWarpLists, type QuickWarpTable } from '@auth/js/api'

/**
 * The navigation panel's Recent and Favorites lists (phpMyAdmin's RecentFavoriteTable), kept
 * by the server per role and server; this is the copy the panel and the structure page's
 * favorite stars render from, replaced by every answer of the API.
 */

const EMPTY: QuickWarpLists = { recent: [], favorite: [] }

let lists: QuickWarpLists = EMPTY
const listeners = new Set<() => void>()

function set(next: QuickWarpLists): QuickWarpLists {
  lists = next
  for (const listener of listeners) listener()

  return next
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function useQuickWarp(): QuickWarpLists {
  return useSyncExternalStore(subscribe, () => lists)
}

export function loadQuickWarp(): Promise<QuickWarpLists> {
  return getQuickWarpLists().then(set)
}

export function recordRecent(table: Pick<QuickWarpTable, 'database' | 'schema' | 'table'>): Promise<QuickWarpLists> {
  return recordRecentTable(table).then(set)
}

export const isFavorite = (list: QuickWarpLists, database: string, schema: string, table: string): boolean =>
  list.favorite.some((entry) => entry.database === database && entry.schema === schema && entry.table === table)

/** Add the table to Favorites, or remove it when it is one; rejects when the list is full. */
export function toggleFavorite(table: Pick<QuickWarpTable, 'database' | 'schema' | 'table'>): Promise<QuickWarpLists> {
  const request = isFavorite(lists, table.database, table.schema, table.table) ? removeFavoriteTable : addFavoriteTable

  return request(table).then(set)
}

/** How phpMyAdmin names a table in the lists, `db`.`table`, here with PostgreSQL's quotes and the schema. */
export const quickWarpLabel = (entry: QuickWarpTable): string => [entry.database, entry.schema, entry.table].map((name) => `"${name.replaceAll('"', '""')}"`).join('.')

/** Forget the lists, when the panel goes away on signing out, so another role never sees them. */
export function clearQuickWarp(): void {
  set(EMPTY)
}
