import { useEffect, useState } from 'react'
import i18next from 'i18next'
import { ApiError } from '@/api/request'
import { notify } from '@/notify'
import {
  endSessionTransaction,
  querySessionStatus,
  runInSession,
  runQuery,
  startQuerySession,
  stopQuerySession,
  type QueryRequest,
  type QueryResponse,
  type SessionConnection,
  type SessionNotification,
  type TransactionStatus,
} from './api'

/**
 * The SQL page's query tool sessions, one per database for as long as the browser tab is open,
 * as pgAdmin keeps a connection per query tool tab: started by the first run, kept alive by a
 * heartbeat, and ended when the tab closes. Leaving the SQL page keeps the session, so an open
 * transaction, SET and temporary tables are still there on coming back. Where the server cannot
 * keep sessions (switched off, or no background processes), each run gets a connection of its
 * own, as before.
 */

interface Entry {
  id: string | null
  starting: Promise<string | null> | null
  status: TransactionStatus
  listeners: Set<(status: TransactionStatus) => void>
  /** pgAdmin's Notifications tab: what arrived on the channels listened on, oldest first. */
  notifications: SessionNotification[]
  channels: string[]
  notificationListeners: Set<() => void>
  /** The role the session connected as and the role it SET ROLE to, when not the sign-in's own. */
  connection: { username: string; role: string | null } | null
  connectionListeners: Set<() => void>
}

/** The notifications a page keeps, as the session keeps them. */
const NOTIFICATIONS_KEPT = 1000

/** How often a session that listens on a channel is asked for what arrived. */
const LISTEN_POLL_MS = 2_000
let listenPoll: number | null = null

/** pgAdmin's heartbeat interval; the session ends three minutes after the last one. */
const HEARTBEAT_MS = 30_000

const sessions = new Map<string, Entry>()
let unavailable = false
let heartbeat: number | null = null

const keyOf = (db: string | null) => db ?? ''

function entryFor(db: string | null): Entry {
  const key = keyOf(db)
  let entry = sessions.get(key)
  if (!entry) {
    entry = { id: null, starting: null, status: 'idle', listeners: new Set(), notifications: [], channels: [], notificationListeners: new Set(), connection: null, connectionListeners: new Set() }
    sessions.set(key, entry)
  }

  return entry
}

function setStatus(entry: Entry, status: TransactionStatus) {
  if (entry.status === status) return
  entry.status = status
  for (const listener of entry.listeners) listener(status)
}

/** A reply's notifications and channels; a session that listens is asked again soon. */
function absorb(entry: Entry, reply: { notifications?: SessionNotification[]; channels?: string[] }) {
  const arrived = reply.notifications ?? []
  const channels = reply.channels ?? entry.channels
  if (arrived.length === 0 && channels.join('\n') === entry.channels.join('\n')) return
  entry.notifications = [...entry.notifications, ...arrived].slice(-NOTIFICATIONS_KEPT)
  entry.channels = channels
  for (const listener of entry.notificationListeners) listener()
  watchListening()
}

/** While a session listens on a channel, it is asked every LISTEN_POLL_MS. */
function watchListening() {
  const listening = [...sessions.values()].some((entry) => entry.id !== null && entry.channels.length > 0)
  if (listening && listenPoll === null && typeof window !== 'undefined') listenPoll = window.setInterval(poll, LISTEN_POLL_MS)
  if (!listening && listenPoll !== null) {
    window.clearInterval(listenPoll)
    listenPoll = null
  }
}

function poll() {
  for (const entry of sessions.values()) {
    if (entry.id === null || entry.channels.length === 0) continue
    const id = entry.id
    querySessionStatus(id).then(
      (state) => {
        if (entry.id !== id) return
        setStatus(entry, state.transaction)
        absorb(entry, state)
      },
      () => undefined,
    )
  }
}

/** The session is gone: what was open in it was rolled back when its connection closed. */
function forget(entry: Entry, warn: boolean) {
  const lost = entry.status === 'intrans' || entry.status === 'inerror'
  entry.id = null
  setStatus(entry, 'idle')
  // Its LISTENs went with its connection.
  if (entry.channels.length > 0) absorb(entry, { channels: [] })
  // A new session connects as the sign-in's own role again.
  if (entry.connection !== null) {
    setConnection(entry, null)
    if (warn) notify(i18next.t('sql:connection.reverted'), 'warning')
  }
  if (warn && lost) notify(i18next.t('sql:session.ended'), 'warning')
}

function beat() {
  for (const entry of sessions.values()) {
    if (entry.id === null) continue
    const id = entry.id
    querySessionStatus(id).then(
      (state) => {
        if (entry.id !== id) return
        setStatus(entry, state.transaction)
        absorb(entry, state)
      },
      (e: unknown) => {
        if (entry.id === id && e instanceof ApiError && [401, 404, 410].includes(e.status)) forget(entry, true)
      },
    )
  }
}

function startHeartbeat() {
  if (heartbeat !== null || typeof window === 'undefined') return
  heartbeat = window.setInterval(beat, HEARTBEAT_MS)
  // Closing the tab would roll back an open transaction: the browser asks first, as pgAdmin
  // asks before closing a query tool with one.
  window.addEventListener('beforeunload', (e) => {
    if ([...sessions.values()].some((entry) => entry.id !== null && (entry.status === 'intrans' || entry.status === 'inerror'))) e.preventDefault()
  })
  // A closing tab ends its sessions; keepalive lets the requests outlive the page.
  window.addEventListener('pagehide', () => {
    for (const entry of sessions.values()) {
      if (entry.id !== null) void stopQuerySession(entry.id, true)
      entry.id = null
    }
  })
}

async function ensure(entry: Entry, db: string | null): Promise<string | null> {
  if (unavailable) return null
  if (entry.id !== null) return entry.id
  entry.starting ??= startQuerySession(db).then(
    (session) => {
      entry.id = session.id
      entry.starting = null
      setStatus(entry, session.transaction)
      startHeartbeat()

      return session.id
    },
    (e: unknown) => {
      entry.starting = null
      // Only a server that cannot keep sessions (switched off, or its background process does
      // not start) runs each query on a connection of its own from now on; any other failure
      // is reported, and the next run tries again.
      if (!(e instanceof ApiError && (e.status === 422 || e.status === 500))) throw e
      unavailable = true

      return null
    },
  )

  return entry.starting
}

/** Run a batch in the database's session, starting one when there is none. */
export async function runInQuerySession(db: string | null, request: QueryRequest, autocommit: boolean, retried = false): Promise<QueryResponse> {
  const entry = entryFor(db)
  const id = await ensure(entry, db)
  if (id === null) {
    // A connection of its own commits each run: "Auto commit" off cannot be honoured.
    if (!autocommit) throw new Error(i18next.t('sql:session.unavailable'))

    return runQuery(db, request)
  }
  try {
    const response = await runInSession(id, { ...request, autocommit })
    if (entry.id === id) {
      setStatus(entry, response.transaction ?? 'idle')
      absorb(entry, response)
    }

    return response
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 410) && entry.id === id) {
      const lost = entry.status !== 'idle'
      forget(entry, false)
      // Nothing was open in the session that ended: run in a new one, as pgAdmin reconnects.
      if (!lost && !retried) return runInQuerySession(db, request, autocommit, true)
    } else if (entry.id === id) {
      querySessionStatus(id).then((state) => entry.id === id && setStatus(entry, state.transaction), () => undefined)
    }
    throw e
  }
}

/** COMMIT or ROLLBACK the database's open transaction; the command tag says what happened. */
export async function endTransaction(db: string | null, command: 'commit' | 'rollback'): Promise<string> {
  const entry = entryFor(db)
  if (entry.id === null) return command.toUpperCase()
  const id = entry.id
  try {
    const reply = await endSessionTransaction(id, command)
    setStatus(entry, reply.transaction)
    absorb(entry, reply)

    return reply.command_tag
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 410)) forget(entry, false)
    throw e
  }
}

/** The transaction status of the database's session, following it as it changes. */
export function useTransactionStatus(db: string | null): TransactionStatus {
  const entry = entryFor(db)
  const [status, setState] = useState(entry.status)
  useEffect(() => {
    setState(entry.status)
    entry.listeners.add(setState)

    return () => {
      entry.listeners.delete(setState)
    }
  }, [entry])

  return status
}

/** The database's session's notifications and the channels it listens on, and Clear. */
export function useNotifications(db: string | null): { notifications: SessionNotification[]; channels: string[]; clear: () => void } {
  const entry = entryFor(db)
  const [, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1)
    entry.notificationListeners.add(listener)

    return () => {
      entry.notificationListeners.delete(listener)
    }
  }, [entry])

  return {
    notifications: entry.notifications,
    channels: entry.channels,
    clear: () => {
      entry.notifications = []
      for (const listener of entry.notificationListeners) listener()
    },
  }
}

function setConnection(entry: Entry, connection: Entry['connection']) {
  entry.connection = connection
  for (const listener of entry.connectionListeners) listener()
}

/**
 * pgAdmin's "New connection": the database's session is ended (rolling back what is open in it)
 * and a new one started as another role of the server, or with a role to SET ROLE to. An empty
 * connection goes back to the sign-in's own role.
 */
export async function reconnect(db: string | null, connection: SessionConnection): Promise<void> {
  const entry = entryFor(db)
  const started = await startQuerySession(db, connection)
  if (entry.id !== null) void stopQuerySession(entry.id)
  entry.id = started.id
  entry.starting = null
  setStatus(entry, started.transaction)
  if (entry.channels.length > 0 || entry.notifications.length > 0) absorb(entry, { channels: [] })
  const own = !connection.username && !connection.role
  setConnection(entry, own ? null : (started.connection ?? null))
  startHeartbeat()
}

/** The role the database's session connected as, when it is not the sign-in's own. */
export function useConnection(db: string | null): Entry['connection'] {
  const entry = entryFor(db)
  const [, setVersion] = useState(0)
  useEffect(() => {
    const listener = () => setVersion((v) => v + 1)
    entry.connectionListeners.add(listener)

    return () => {
      entry.connectionListeners.delete(listener)
    }
  }, [entry])

  return entry.connection
}
