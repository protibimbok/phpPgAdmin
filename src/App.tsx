import { useEffect, useMemo, useState } from 'react'
import { useRoutes } from 'react-router'
import Login from '@auth/js/Pages/Login'
import { logout, me, type User } from '@auth/js/api'
import Layout from '@/layout/Layout'
import { getRoutes } from '@/modular'
import NotFound from '@/pages/NotFound'
import { SessionContext, type Session } from '@/session'

/**
 * Bootstraps the UI: asks the session who is signed in, shows the Auth module's login
 * page until someone is, then the layout with the pages the modules registered.
 */
export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    void me().then(setUser)
  }, [])

  if (user === undefined) {
    return null
  }

  if (user === null) {
    return <Login onLogin={setUser} />
  }

  return (
    <SessionContext.Provider value={{ user, logout: () => logout().then(() => setUser(null)) } satisfies Session}>
      <Pages />
    </SessionContext.Provider>
  )
}

function Pages() {
  const routes = useMemo(() => [{ element: <Layout />, children: [...getRoutes(), { path: '*', element: <NotFound /> }] }], [])

  return useRoutes(routes)
}
