import { useEffect, useRef, useState } from 'react'
import ConfirmQuery from '@/components/ConfirmQuery'
import { isReadStatement } from './editor/statements'

/**
 * The guard of a page that runs a statement it was handed (in its link or its navigation
 * state) as soon as it opens: the Chart and GIS pages. A statement that only reads runs on its
 * own; anything else is shown in phpMyAdmin's "Do you really want to execute …?" dialog and
 * runs only once it is confirmed, as the SQL page asks before a destructive one. A confirmed
 * statement runs again (another page of rows) without asking; a new statement asks again.
 */
export function useStatementGuard(sql: string) {
  const confirmed = useRef(false)
  const pending = useRef<(() => void) | null>(null)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    confirmed.current = false
    pending.current = null
    setAsking(false)
  }, [sql])

  function guard(run: () => void) {
    if (confirmed.current || isReadStatement(sql)) return run()
    pending.current = run
    setAsking(true)
  }

  const dialog = (
    <ConfirmQuery
      show={asking}
      sql={sql}
      onClose={() => {
        pending.current = null
        setAsking(false)
      }}
      onConfirm={() => {
        confirmed.current = true
        setAsking(false)
        const run = pending.current
        pending.current = null
        run?.()
      }}
    />
  )

  return { guard, dialog }
}
