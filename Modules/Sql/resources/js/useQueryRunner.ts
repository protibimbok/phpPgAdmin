import { useCallback, useRef, useState } from 'react'
import { cancelQuery, runQuery, type QueryRequest, type QueryResponse } from './api'

export interface QueryRunner {
  response: QueryResponse | null
  error: Error | null
  running: boolean
  /** Whether a run is on its way, right now: unlike running, it is set before the next render. */
  busy: () => boolean
  /** The request as it was last run, to run it again with another page or order. */
  last: QueryRequest | null
  run: (request: QueryRequest) => Promise<QueryResponse | null>
  /** Ask the server to cancel the request in flight. */
  cancel: () => void
  clear: () => void
}

/** An id for a run; randomUUID() only exists in secure contexts, and plain http is not one. */
function requestId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Runs queries against one database and keeps the latest answer. Every run gets an id of its
 * own, so a cancel reaches the right backend and an answer that arrives after a newer run
 * started is dropped. "execute" sends the request; the SQL page sends it through its query
 * tool session.
 */
export function useQueryRunner(db: string | null, execute: (db: string | null, request: QueryRequest) => Promise<QueryResponse> = runQuery): QueryRunner {
  const [response, setResponse] = useState<QueryResponse | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [running, setRunning] = useState(false)
  const [last, setLast] = useState<QueryRequest | null>(null)
  const current = useRef<string | null>(null)
  const inFlight = useRef(false)
  const executeRef = useRef(execute)
  executeRef.current = execute

  const run = useCallback(
    async (request: QueryRequest) => {
      const id = requestId()
      current.current = id
      inFlight.current = true
      setRunning(true)
      setError(null)
      setLast(request)

      try {
        const result = await executeRef.current(db, { ...request, request_id: id })
        if (current.current !== id) return null
        setResponse(result)

        return result
      } catch (e) {
        if (current.current !== id) return null
        setResponse(null)
        setError(e instanceof Error ? e : new Error(String(e)))

        return null
      } finally {
        if (current.current === id) {
          inFlight.current = false
          setRunning(false)
        }
      }
    },
    [db],
  )

  const cancel = useCallback(() => {
    if (current.current) void cancelQuery(current.current).catch(() => undefined)
  }, [])

  const clear = useCallback(() => {
    current.current = null
    inFlight.current = false
    setResponse(null)
    setError(null)
    setRunning(false)
  }, [])

  const busy = useCallback(() => inFlight.current, [])

  return { response, error, running, busy, last, run, cancel, clear }
}
