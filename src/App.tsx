import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Login from '@auth/js/Pages/Login'
import { logout, me, type User } from '@auth/js/api'
import LocaleSelect from '@/i18n/LocaleSelect'
import Databases from '@databases/js/Pages/Databases'

/**
 * Bootstraps the UI: asks the session who is signed in, shows the Auth module's login
 * page until someone is, then the application.
 */
export default function App() {
  const { t } = useTranslation()
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
      <p>{t('signed_in_as', { username: user.username })}</p>
      <p className="text-muted">{t('connected_to', { host: user.server.host, port: user.server.port, version: user.server.version ?? '?' })}</p>
      <div className="d-flex align-items-center gap-3 mb-4">
        <button type="button" className="btn btn-secondary" onClick={() => void logout().then(() => setUser(null))}>
          {t('log_out')}
        </button>
        <label className="d-flex align-items-center gap-2 mb-0">
          <span>{t('language')}</span>
          <LocaleSelect className="w-auto" />
        </label>
      </div>
      <Databases />
    </main>
  )
}
