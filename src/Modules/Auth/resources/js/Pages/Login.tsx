import { useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import LocaleSelect from '@/i18n/LocaleSelect'
import logo from '../../img/logo.svg'
import { login, type User } from '../api'
import '../../scss/login.scss'

interface LoginProps {
  /** Called with the user once the credentials were accepted. */
  onLogin: (user: User) => void
}

/**
 * The login page, laid out like phpMyAdmin's: logo and welcome line on top, a card to pick the
 * language, then a card with a floating "Log in" header, the credentials and the submit button
 * in its footer. Its strings come from the module's resources/lang/<locale>.json.
 */
export default function Login({ onLogin }: LoginProps) {
  const { t } = useTranslation('auth')
  const { t: tApp } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    try {
      onLogin(await login(username, password))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('login.failed'))
      setPending(false)
    }
  }

  const languageLabel = tApp('language')

  return (
    <div id="loginform">
      <div className="container">
        <a href="/" className="logo" tabIndex={-1}>
          <img src={logo} id="imLogo" alt="phpPgAdmin" width={220} height={72} />
        </a>
        <h1>
          {/* The product name stays left-to-right, in English, whichever way the page runs. */}
          <Trans t={t} i18nKey="welcome" components={{ app: <bdo dir="ltr" lang="en" /> }} />
        </h1>

        <noscript>
          <div className="alert alert-danger">{t('noscript')}</div>
        </noscript>

        {error && (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        )}

        <div className="card mb-4">
          <div className="card-header">
            <span id="languageSelectLabel">
              {languageLabel}
              {/* Like phpMyAdmin: when "Language" is translated, repeat it in English so the
                  dialog is recognisable to someone who landed in the wrong language. */}
              {languageLabel !== 'Language' && (
                <>
                  {' '}
                  <i lang="en" dir="ltr">
                    (Language)
                  </i>
                </>
              )}
            </span>
          </div>
          <div className="card-body">
            <LocaleSelect id="languageSelect" aria-labelledby="languageSelectLabel" />
          </div>
        </div>

        <form id="login_form" name="login_form" onSubmit={submit} autoComplete="on">
          <div className="card mb-4">
            <div className="card-header">{t('login.title')}</div>
            <div className="card-body">
              <div className="row mb-3">
                <label htmlFor="input_username" className="col-sm-4 col-form-label">
                  {t('login.username')}
                </label>
                <div className="col-sm-8">
                  <input
                    type="text"
                    id="input_username"
                    name="username"
                    className="form-control"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    spellCheck={false}
                    autoFocus
                  />
                </div>
              </div>
              <div className="row">
                <label htmlFor="input_password" className="col-sm-4 col-form-label">
                  {t('login.password')}
                </label>
                <div className="col-sm-8">
                  <input
                    type="password"
                    id="input_password"
                    name="password"
                    className="form-control"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    spellCheck={false}
                  />
                </div>
              </div>
            </div>
            <div className="card-footer">
              <button type="submit" className="btn btn-primary" id="input_go" disabled={pending}>
                {t('login.submit')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
