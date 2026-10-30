import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import LocaleSelect from '@/i18n/LocaleSelect'
import ServersModal from '@auth/js/ServersModal'
import { getServerInfo, type ServerInfo } from '../api'
import ChangePasswordModal from '../ChangePasswordModal'

const REPOSITORY = 'https://github.com/protibimbok/phpPgAdmin'
const DOCUMENTATION = 'https://protibimbok.github.io/phpPgAdmin/'
// composer.json declares MIT; the repository has no LICENSE file to link to.
const LICENSE = 'https://opensource.org/license/mit'

const LINKS = [
  { key: 'documentation', href: DOCUMENTATION },
  { key: 'official_homepage', href: REPOSITORY },
  { key: 'contribute', href: `${REPOSITORY}/pulls` },
  { key: 'get_support', href: `${REPOSITORY}/issues` },
  { key: 'list_of_changes', href: `${REPOSITORY}/commits/master` },
  { key: 'license', href: LICENSE },
] as const

/**
 * The home page, laid out like phpMyAdmin's: general settings (Change password, and the saved
 * servers of the login page with their import and export) and appearance
 * settings on the left; the database server, the web server and the application on the right,
 * each a card of facts.
 */
export default function Home() {
  const { t } = useTranslation('server')
  const { t: tApp } = useTranslation()
  const { t: tAuth } = useTranslation('auth')
  const [info, setInfo] = useState<ServerInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)
  const [managingServers, setManagingServers] = useState(false)

  useEffect(() => {
    getServerInfo().then(setInfo, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const languageLabel = tApp('language')

  return (
    <div id="maincontainer">
      <div className="container-fluid">
        <div className="row mb-3">
          <div className="col-lg-7 col-12">
            <div className="card mt-4">
              <div className="card-header">{t('home.general_settings')}</div>
              <ul className="list-group list-group-flush">
                <li id="li_change_password" className="list-group-item">
                  <a href="#change-password" id="change_password_anchor" className="ajax" onClick={(e) => { e.preventDefault(); setChangingPassword(true) }}>
                    <Icon name="s_passwd" /> {t('password.title')}
                  </a>
                </li>
                <li id="li_servers" className="list-group-item">
                  <a href="#servers" id="servers_anchor" onClick={(e) => { e.preventDefault(); setManagingServers(true) }}>
                    <Icon name="s_host" /> {tAuth('servers.manage')}
                  </a>
                </li>
              </ul>
            </div>

            <div className="card mt-4">
              <div className="card-header">{t('home.appearance_settings')}</div>
              <ul className="list-group list-group-flush">
                <li id="li_select_lang" className="list-group-item">
                  <form className="row row-cols-lg-auto align-items-center" onSubmit={(e) => e.preventDefault()}>
                    <div className="col-12">
                      <label htmlFor="languageSelect" className="col-form-label text-nowrap">
                        <Icon name="s_lang" /> {languageLabel}{' '}
                        {languageLabel !== 'Language' && (
                          <i lang="en" dir="ltr">
                            (Language)
                          </i>
                        )}
                      </label>
                    </div>
                    <div className="col-12">
                      <LocaleSelect id="languageSelect" className="w-auto" />
                    </div>
                  </form>
                </li>
              </ul>
            </div>
          </div>

          <div className="col-lg-5 col-12">
            {error && (
              <div className="alert alert-danger mt-4" role="alert">
                {error}
              </div>
            )}

            {info && (
              <>
                <div className="card mt-4">
                  <div className="card-header">{t('home.database_server')}</div>
                  <ul className="list-group list-group-flush">
                    <li className="list-group-item">
                      {t('home.server')} {info.server.host}
                      {info.server.socket ? '' : `:${info.server.port}`} {t(info.server.socket ? 'home.via_socket' : 'home.via_tcp')}
                    </li>
                    <li className="list-group-item">
                      {t('home.server_type')} {info.server.type}
                    </li>
                    {info.server.ssl !== null && (
                      <li className="list-group-item">
                        {t('home.server_connection')} {t(info.server.ssl ? 'home.ssl_used' : 'home.ssl_not_used')}
                      </li>
                    )}
                    <li className="list-group-item">
                      {t('home.server_version')} {info.server.version}
                    </li>
                    <li className="list-group-item">
                      {t('home.user')} <span dir="ltr">{info.server.user}</span>
                    </li>
                    <li className="list-group-item">
                      {t('home.server_charset')}{' '}
                      <span lang="en" dir="ltr">
                        {info.server.encoding}
                      </span>
                    </li>
                  </ul>
                </div>

                <div className="card mt-4">
                  <div className="card-header">{t('home.web_server')}</div>
                  <ul className="list-group list-group-flush">
                    {info.web.software && <li className="list-group-item">{info.web.software}</li>}
                    <li className="list-group-item">
                      {t('home.client_version')} {info.web.client}
                    </li>
                    <li className="list-group-item">
                      {t('home.php_extension')}{' '}
                      {info.web.extensions.map((extension) => (
                        <span key={extension} className="me-1">
                          {extension}{' '}
                          <a
                            href={`https://www.php.net/manual/en/book.${extension.replace('_', '-')}.php`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Icon name="b_help" title="Documentation" />
                          </a>
                        </span>
                      ))}
                    </li>
                    <li className="list-group-item">
                      {t('home.php_version')} {info.web.php}
                    </li>
                  </ul>
                </div>

                <div className="card mt-4">
                  <div className="card-header">phpPgAdmin</div>
                  <ul className="list-group list-group-flush">
                    <li id="li_pma_version" className="list-group-item">
                      {t('home.version_information')} <span className="version">{info.app.version}</span>
                    </li>
                    {LINKS.map((link) => (
                      <li key={link.key} className="list-group-item">
                        <a href={link.href} target="_blank" rel="noopener noreferrer">
                          {t(`home.${link.key}`)}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <ChangePasswordModal show={changingPassword} onClose={() => setChangingPassword(false)} />
      <ServersModal show={managingServers} onClose={() => setManagingServers(false)} />
    </div>
  )
}
