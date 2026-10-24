import { createContext, useContext } from 'react'
import type { User } from '@auth/js/api'

export interface Session {
  /** The signed-in user; the layout and its pages only render for one. */
  user: User
  logout: () => Promise<void>
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('[session] useSession() called outside the signed-in application')

  return session
}
