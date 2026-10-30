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
}

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
    entry = { id: null, starting: null, status: 'idle', listeners: new Set() }
    sessions.set(key, entry)
  }

  return entry
}

function setStatus(entry: Entry, status: TransactionStatus) {
  if (entry.status === status) return
  entry.status = status
  for (const listener of entry.listeners) listener(status)
}

/** The session is gone: what was open in it was rolled back when its connection closed. */
function forget(entry: Entry, warn: boolean) {
  const lost = entry.status === 'intrans' || entry.status === 'inerror'
  entry.id = null
  setStatus(entry, 'idle')
  if (warn && lost) notify(i18next.t('sql:session.ended'), 'warning')
}

function beat() {
  for (const entry of sessions.values()) {
    if (entry.id === null) continue
    const id = entry.id
    querySessionStatus(id).then(
      (state) => {
        if (entry.id === id) setStatus(entry, state.transaction)
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
      // A role that may not connect gets the usual error; a server that cannot keep sessions
      // runs each query on a connection of its own.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 503)) throw e
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
  if (id === null) return runQuery(db, request)
  try {
    const response = await runInSession(id, { ...request, autocommit })
    if (entry.id === id) setStatus(entry, response.transaction ?? 'idle')

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
