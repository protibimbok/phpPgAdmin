import { useEffect, useState } from 'react'
import Login from '@auth/js/Pages/Login'
import { logout, me, type User } from '@auth/js/api'

/**
 * Bootstraps the UI: asks the session who is signed in, shows the Auth module's login
 * page until someone is, then the application.
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
    <main className="container-fluid py-3">
      <h2>phpPgAdmin</h2>
      <p>Signed in as {user.username}.</p>
      <button type="button" className="btn btn-secondary" onClick={() => void logout().then(() => setUser(null))}>
        Log out
      </button>
    </main>
  )
}
