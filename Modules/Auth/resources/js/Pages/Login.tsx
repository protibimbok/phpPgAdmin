import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import i18n from '@/i18n'
import LocaleSelect from '@/i18n/LocaleSelect'
import { notifyError } from '@/notify'
import logo from '../../img/logo.svg'
import { getServers, login, removeServer, renameServer, serverLabel, SSL_MODES, type SavedServer, type Server, type ServerChoice, type SslMode, type User } from '../api'
import '../../scss/login.scss'

interface LoginProps {
  /** Called with the user once the credentials were accepted. */
  onLogin: (user: User) => void
  /** The session ran out under a signed-in page, which the form then says, as phpMyAdmin does. */
  expired?: boolean
}

/** The "Server choice" option for a server entered by hand. */
const OTHER = 'other'

/** The fields of the "Advanced" section, as strings while they are edited. */
interface ServerFields {
  host: string
  port: string
  sslmode: SslMode
  maintenance_db: string
}

function fieldsOf(server: Server): ServerFields {
  return { host: server.host, port: String(server.port), sslmode: server.sslmode, maintenance_db: server.maintenance_db ?? '' }
}

function sameServer(fields: ServerFields, server: Server): boolean {
  const saved = fieldsOf(server)

  return fields.host === saved.host && fields.port === saved.port && fields.sslmode === saved.sslmode && fields.maintenance_db === saved.maintenance_db
}

/**
 * The login page, laid out like phpMyAdmin's: logo and welcome line on top, a card to pick the
 * language, then a card with a floating "Log in" header, the credentials and the submit button
 * in its footer. Below the credentials, the servers earlier logins succeeded against can be
 * picked, as phpMyAdmin offers its configured servers, and an "Advanced" section opens the
 * host, port, SSL mode and maintenance database for any other server.
 */
export default function Login({ onLogin, expired = false }: LoginProps) {
  const { t } = useTranslation('auth')
  const { t: tApp } = useTranslation()
  const [username, setUsername] = useState('')
  // Whether the username in the field was typed rather than filled in from a saved server.
  const typedUsername = useRef(false)
  const [password, setPassword] = useState('')
  const [servers, setServers] = useState<SavedServer[]>([])
  const [fallback, setFallback] = useState<Server | null>(null)
  const [choice, setChoice] = useState<string>(OTHER)
  const [fields, setFields] = useState<ServerFields | null>(null)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // The pencil or the trash next to the saved servers: managing the list needs a login.
  const [managing, setManaging] = useState<{ action: 'rename' | 'remove'; server: SavedServer; name: string; error: string | null } | null>(null)

  useEffect(() => {
    getServers().then(
      ({ servers, default: fallback }) => {
        setServers(servers)
        setFallback(fallback)
        // The server used last is the one to offer first, with the role that used it.
        const first = servers[0]
        setChoice(first ? String(first.id) : OTHER)
        setFields(fieldsOf(first ?? fallback))
        const lastUsername = first?.last_username
        if (lastUsername) setUsername((current) => current || lastUsername)
      },
      // Without the list the form still works against the configured server.
      () => setFields(null),
    )
  }, [])

  const chosen = useMemo(() => servers.find((server) => String(server.id) === choice) ?? null, [servers, choice])

  function choose(value: string) {
    setChoice(value)
    const saved = servers.find((candidate) => String(candidate.id) === value)
    const server = saved ?? fallback
    if (server) setFields(fieldsOf(server))
    // A saved server's role fills the field only while it holds no username of the user's own.
    if (saved?.last_username && !typedUsername.current) setUsername(saved.last_username)
  }

  function edit<K extends keyof ServerFields>(key: K, value: ServerFields[K]) {
    setFields((current) => (current ? { ...current, [key]: value } : current))
  }

  /** A saved server by id while its fields are untouched; otherwise what the fields describe. */
  function serverChoice(): ServerChoice | undefined {
    if (!fields) return undefined
    if (chosen && sameServer(fields, chosen)) return { id: chosen.id }

    return {
      host: fields.host.trim(),
      port: Number(fields.port) || 5432,
      sslmode: fields.sslmode,
      maintenance_db: fields.maintenance_db.trim() || null,
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setPending(true)

    try {
      await enter(await login(username, password, serverChoice()))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('login.failed'))
      setPending(false)
    }
  }

  /** Into the application as the user; the role's saved language, when it has one, takes over from the login page's. */
  async function enter({ user, locale }: { user: User; locale: string }) {
    if (locale !== i18n.language) {
      await i18n.changeLanguage(locale)
    }
    onLogin(user)
  }

  /**
   * The saved servers can only be changed by a signed-in user: log in to the server with the
   * form's credentials, rename or remove it, and go on into the application.
   */
  async function manage(event: FormEvent) {
    event.preventDefault()
    if (!managing) return
    if (username.trim() === '') return setManaging({ ...managing, error: t('servers.credentials_first') })
    setManaging({ ...managing, error: null })
    setPending(true)
    let session: Awaited<ReturnType<typeof login>>
    try {
      session = await login(username, password, { id: managing.server.id })
    } catch (e) {
      setManaging({ ...managing, error: e instanceof Error ? e.message : t('login.failed') })
      setPending(false)

      return
    }
    // Signed in by now: a failed rename or remove is reported in the application, not here.
    try {
      if (managing.action === 'rename') await renameServer(managing.server.id, managing.name.trim())
      else await removeServer(managing.server.id)
    } catch (e) {
      notifyError(errorMessage(e))
    }
    await enter(session)
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

        {error ? (
          <div className="alert alert-danger" role="alert">
            {error}
          </div>
        ) : (
          expired && (
            <div className="alert alert-danger" role="alert">
              {t('login.session_expired')}
            </div>
          )
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
                    onChange={(e) => {
                      typedUsername.current = e.target.value !== ''
                      setUsername(e.target.value)
                    }}
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

              {servers.length > 0 && (
                <div className="row mt-3">
                  <label htmlFor="select_server" className="col-sm-4 col-form-label">
                    {t('login.server_choice')}
                  </label>
                  <div className="col-sm-8">
                    <div className="input-group">
                      <select id="select_server" name="server" className="form-select" value={choice} onChange={(e) => choose(e.target.value)}>
                        {servers.map((server) => (
                          <option key={server.id} value={server.id}>
                            {serverLabel(server)}
                          </option>
                        ))}
                        <option value={OTHER}>{t('login.other_server')}</option>
                      </select>
                      {chosen && (
                        <>
                          <button type="button" className="btn btn-secondary" id="rename_server" title={t('servers.rename')} aria-label={t('servers.rename')} onClick={() => setManaging({ action: 'rename', server: chosen, name: chosen.name ?? '', error: null })}>
                            <Icon name="b_edit" />
                          </button>
                          <button type="button" className="btn btn-secondary" id="remove_server" title={t('servers.remove')} aria-label={t('servers.remove')} onClick={() => setManaging({ action: 'remove', server: chosen, name: '', error: null })}>
                            <Icon name="b_drop" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {fields && (
                <div className="mt-3" id="login_advanced">
                  <a
                    href="#login_advanced_fields"
                    aria-expanded={advanced}
                    aria-controls="login_advanced_fields"
                    onClick={(e) => {
                      e.preventDefault()
                      setAdvanced((open) => !open)
                    }}
                  >
                    {advanced ? '▾' : '▸'} {t('login.advanced')}
                  </a>

                  {advanced && (
                    <div id="login_advanced_fields" className="mt-3">
                      <div className="row mb-3">
                        <label htmlFor="input_host" className="col-sm-4 col-form-label" title={t('login.host_help')}>
                          {t('login.host')}
                        </label>
                        <div className="col-sm-8">
                          <input
                            type="text"
                            id="input_host"
                            className="form-control"
                            value={fields.host}
                            onChange={(e) => edit('host', e.target.value)}
                            title={t('login.host_help')}
                            spellCheck={false}
                            dir="ltr"
                          />
                        </div>
                      </div>
                      <div className="row mb-3">
                        <label htmlFor="input_port" className="col-sm-4 col-form-label">
                          {t('login.port')}
                        </label>
                        <div className="col-sm-8">
                          <input
                            type="number"
                            id="input_port"
                            className="form-control"
                            min={1}
                            max={65535}
                            value={fields.port}
                            onChange={(e) => edit('port', e.target.value)}
                            dir="ltr"
                          />
                        </div>
                      </div>
                      <div className="row mb-3">
                        <label htmlFor="input_sslmode" className="col-sm-4 col-form-label">
                          {t('login.sslmode')}
                        </label>
                        <div className="col-sm-8">
                          <select
                            id="input_sslmode"
                            className="form-select"
                            value={fields.sslmode}
                            onChange={(e) => edit('sslmode', e.target.value as SslMode)}
                            lang="en"
                            dir="ltr"
                          >
                            {SSL_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {mode}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="row">
                        <label htmlFor="input_maintenance_db" className="col-sm-4 col-form-label" title={t('login.maintenance_db_help')}>
                          {t('login.maintenance_db')}
                        </label>
                        <div className="col-sm-8">
                          <input
                            type="text"
                            id="input_maintenance_db"
                            className="form-control"
                            value={fields.maintenance_db}
                            onChange={(e) => edit('maintenance_db', e.target.value)}
                            title={t('login.maintenance_db_help')}
                            placeholder="postgres"
                            spellCheck={false}
                            dir="ltr"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="card-footer">
              <button type="submit" className="btn btn-primary" id="input_go" disabled={pending}>
                {t('login.submit')}
              </button>
            </div>
          </div>
        </form>

        <Modal
          show={managing !== null}
          onClose={() => setManaging(null)}
          title={managing?.action === 'remove' ? t('servers.remove') : t('servers.rename')}
          id="manageServerModal"
          footer={
            <>
              <button type="submit" form="manage_server_form" className={`btn ${managing?.action === 'remove' ? 'btn-danger' : 'btn-primary'}`} disabled={pending}>
                {managing?.action === 'remove' ? t('servers.login_remove') : t('servers.login_rename')}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setManaging(null)}>
                {t('servers.cancel')}
              </button>
            </>
          }
        >
          {managing && (
            <form id="manage_server_form" onSubmit={(e) => void manage(e)}>
              {managing.error && (
                <div className="alert alert-danger" role="alert">
                  {managing.error}
                </div>
              )}
              <p>{t(managing.action === 'remove' ? 'servers.login_needed_remove' : 'servers.login_needed_rename', { server: serverLabel(managing.server), username: username || '…' })}</p>
              {managing.action === 'rename' && (
                <div className="row">
                  <label htmlFor="input_server_name" className="col-sm-4 col-form-label">
                    {t('servers.name_label')}
                  </label>
                  <div className="col-sm-8">
                    <input type="text" id="input_server_name" className="form-control" maxLength={128} autoFocus value={managing.name} onChange={(e) => setManaging({ ...managing, name: e.target.value })} />
                  </div>
                </div>
              )}
            </form>
          )}
        </Modal>
      </div>
    </div>
  )
}
