import { useSyncExternalStore } from 'react'
import { getPreferences, updatePreferences, type Preferences } from '@auth/js/api'
import { ApiError, errorMessage } from '@/api/request'
import { notifyError } from '@/notify'

/**
 * The preferences a role keeps on a server, after phpMyAdmin's user preferences and pgAdmin's
 * preferences registry. A module registers the settings it reads, with their default, type and
 * the Settings page and group they are shown under; it reads one with usePreference() (or
 * preference() outside React). The values the role changed are stored by the Auth module
 * (GET/PATCH /api/preferences); a value equal to its default is not stored.
 */

export type PreferenceValue = boolean | number | string

export interface PreferenceDefinition {
  key: string
  type: 'boolean' | 'number' | 'select' | 'text'
  default: PreferenceValue
  /** The Settings page (features, sql, navigation, main-panel, export, import) and the group on it. */
  page: string
  group: string
  /** i18n keys of the label and the line under it. */
  label: string
  description?: string
  options?: { value: string; label: string }[]
  min?: number
  max?: number
}

export interface PreferenceGroup {
  page: string
  id: string
  /** i18n keys of the tab label and of the line the tab starts with. */
  label: string
  description?: string
}

const definitions = new Map<string, PreferenceDefinition>()
const groups: PreferenceGroup[] = []

/** Register settings, from a module's frontend script. */
export function registerPreferences(defs: PreferenceDefinition[]): void {
  for (const def of defs) definitions.set(def.key, def)
}

/** Register the groups (the tabs of a Settings page) settings are shown under, in order. */
export function registerPreferenceGroups(list: PreferenceGroup[]): void {
  groups.push(...list)
}

export function preferenceDefinitions(): PreferenceDefinition[] {
  return [...definitions.values()]
}

export function preferenceGroups(page: string): PreferenceGroup[] {
  return groups.filter((g) => g.page === page && preferenceDefinitions().some((d) => d.page === page && d.group === g.id))
}

let stored: Preferences = {}
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

/** Read the signed-in role's preferences; the application renders once they are in. */
export async function loadPreferences(): Promise<void> {
  try {
    stored = await getPreferences()
  } catch (err) {
    // The pages still open, on the defaults; a lost session is the login page's to say.
    stored = {}
    if (!(err instanceof ApiError && err.unauthorized)) notifyError(errorMessage(err))
  }
  emit()
}

export function clearPreferences(): void {
  stored = {}
  emit()
}

/** The stored values, the role's own, without the defaults. */
export function storedPreferences(): Preferences {
  return stored
}

/** A setting's value: the role's, or its default when the stored one is of the wrong type. */
export function preference<T extends PreferenceValue>(key: string): T {
  const def = definitions.get(key)
  const value = stored[key]
  if (def && value !== undefined && value !== null && typeof value === typeof def.default) return value as T

  return (def?.default ?? null) as T
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePreference<T extends PreferenceValue>(key: string): T {
  return useSyncExternalStore(subscribe, () => preference<T>(key))
}

/** The stored values, for a component that follows every change of them. */
export function useStoredPreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => stored)
}

/**
 * Store settings; a value equal to its default, or null, removes the stored one, so that a
 * later change of the default reaches the role.
 */
export async function savePreferences(values: Record<string, PreferenceValue | null>): Promise<void> {
  const changes: Preferences = {}
  for (const [key, value] of Object.entries(values)) {
    const def = definitions.get(key)
    changes[key] = value === null || (def && value === def.default) ? null : value
  }
  stored = await updatePreferences(changes)
  emit()
}
