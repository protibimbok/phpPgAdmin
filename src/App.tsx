import { useEffect, useMemo, useState } from 'react'
import { useRoutes } from 'react-router'
import Login from '@auth/js/Pages/Login'
import { onUnauthorized } from '@/api/request'
import { logout, me, type User } from '@auth/js/api'
import Layout from '@/layout/Layout'
import { getRoutes } from '@/modular'
import NotFound from '@/pages/NotFound'
import { clearPreferences, loadPreferences } from '@/preferences'
import { SessionContext, type Session } from '@/session'

/**
 * Bootstraps the UI: asks the session who is signed in, shows the Auth module's login
 * page until someone is, then, with the role's preferences read, the layout with the pages
 * the modules registered.
 */
export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [ready, setReady] = useState(false)
  // Set when the session ran out under a signed-in page, for the login page to say so.
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    void me().then(setUser)
  }, [])

  // A 401 while signed in means the session is gone: show the login page at the same address,
  // so signing in again opens the page that was showing, as a fresh visit to a deep link does.
  useEffect(() => {
    if (!user) return
    onUnauthorized(() => {
      onUnauthorized(null)
      clearPreferences()
      setExpired(true)
      setUser(null)
    })

    return () => onUnauthorized(null)
  }, [user])

  useEffect(() => {
    if (!user) return
    let current = true
    setReady(false)
    void loadPreferences().then(() => current && setReady(true))

    return () => {
      current = false
    }
  }, [user])

  if (user === undefined) {
    return null
  }

  if (user === null) {
    return (
      <Login
        expired={expired}
        onLogin={(user) => {
          setExpired(false)
          setUser(user)
        }}
      />
    )
  }

  if (!ready) {
    return null
  }

  return (
    <SessionContext.Provider
      value={
        {
          user,
          logout: () =>
            logout().then(() => {
              onUnauthorized(null)
              clearPreferences()
              setUser(null)
            }),
        } satisfies Session
      }
    >
      <Pages />
    </SessionContext.Provider>
  )
}

function Pages() {
  const routes = useMemo(() => [{ element: <Layout />, children: [...getRoutes(), { path: '*', element: <NotFound /> }] }], [])

  return useRoutes(routes)
}
