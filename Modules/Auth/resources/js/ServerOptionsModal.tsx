import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import { notifyError, notifySuccess } from '@/notify'
import { getServerOptions, serverLabel, setServerOptions, type SavedServer, type ServerOptions } from './api'

const SSL_FILES = ['sslcert', 'sslkey', 'sslrootcert', 'sslcrl'] as const

/**
 * pgAdmin's server dialog fields that phpPgAdmin keeps on a saved server: on its Connection tab
 * the role and the service, on its Parameters tab the application name and the SSL files, on
 * its Advanced tab the post-connection SQL. The SSL files are picked from the files of the SSL
 * directory the web server's configuration names; the role and the post-connection SQL are the
 * signed-in role's only.
 */
export default function ServerOptionsModal({ server, onClose }: { server: SavedServer; onClose: () => void }) {
  const { t } = useTranslation('auth')
  const { t: tApp } = useTranslation()
  const [options, setOptions] = useState<ServerOptions | null>(null)
  const [files, setFiles] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getServerOptions(server.id).then(
      (r) => {
        setOptions(r.options)
        setFiles(r.ssl_files)
      },
      (e: unknown) => {
        notifyError(errorMessage(e))
        onClose()
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id])

  const set = (key: keyof ServerOptions, value: string) => setOptions((o) => ({ ...o, [key]: value }))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!options) return
    setBusy(true)
    try {
      await setServerOptions(server.id, options)
      notifySuccess(t('server_options.saved'))
      onClose()
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const text = (key: keyof ServerOptions) => (
    <div className="row mb-2" key={key}>
      <label className="col-sm-4 col-form-label" htmlFor={`server_option_${key}`}>
        {t(`server_options.${key}`)}
      </label>
      <div className="col-sm-8">
        <input className="form-control" id={`server_option_${key}`} name={key} dir="ltr" value={options?.[key] ?? ''} onChange={(e) => set(key, e.target.value)} />
      </div>
    </div>
  )

  return (
    <Modal
      show
      onClose={onClose}
      title={t('server_options.title', { server: serverLabel(server) })}
      size="lg"
      id="serverOptionsModal"
      footer={
        <>
          <button type="submit" form="server_options_form" className="btn btn-primary" disabled={busy || options === null}>
            {tApp('go')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('cancel')}
          </button>
        </>
      }
    >
      {options === null ? (
        tApp('loading')
      ) : (
        <form id="server_options_form" onSubmit={(e) => void save(e)}>
          <fieldset className="mb-3">
            <legend>{t('server_options.server_legend')}</legend>
            {text('service')}
            {text('application_name')}
            {SSL_FILES.map((key) => (
              <div className="row mb-2" key={key}>
                <label className="col-sm-4 col-form-label" htmlFor={`server_option_${key}`}>
                  {t(`server_options.${key}`)}
                </label>
                <div className="col-sm-8">
                  <select className="form-select" id={`server_option_${key}`} name={key} dir="ltr" value={options[key] ?? ''} onChange={(e) => set(key, e.target.value)}>
                    <option value="" />
                    {[...new Set([...(files ?? []), ...(options[key] ? [options[key]] : [])])].map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <div className="form-text">{files === null ? t('server_options.no_ssl_directory') : t('server_options.ssl_help')}</div>
          </fieldset>
          <fieldset>
            <legend>{t('server_options.role_legend')}</legend>
            {text('role')}
            <div className="row mb-2">
              <label className="col-sm-4 col-form-label" htmlFor="server_option_post_connection_sql">
                {t('server_options.post_connection_sql')}
              </label>
              <div className="col-sm-8">
                <textarea className="form-control font-monospace" id="server_option_post_connection_sql" name="post_connection_sql" dir="ltr" rows={4} value={options.post_connection_sql ?? ''} onChange={(e) => set('post_connection_sql', e.target.value)} />
              </div>
            </div>
            <div className="form-text">{t('server_options.role_help')}</div>
          </fieldset>
        </form>
      )}
    </Modal>
  )
}
