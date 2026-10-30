import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import { notifyError, notifySuccess } from '@/notify'
import { exportServers, getServers, importServers, removeServer, renameServer, serverLabel, type SavedServer } from './api'

/**
 * The saved servers the login page offers, for the signed-in user to manage: each one renamed
 * (the pencil) or removed (the trash), and the whole list exported to or imported from
 * pgAdmin's import_export_servers JSON file.
 */
export default function ServersModal({ show, onClose }: { show: boolean; onClose: () => void }) {
  const { t } = useTranslation('auth')
  const { t: tApp } = useTranslation()
  const [servers, setServers] = useState<SavedServer[] | null>(null)
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null)
  const [removing, setRemoving] = useState<SavedServer | null>(null)
  const file = useRef<HTMLInputElement>(null)

  function load() {
    getServers().then(({ servers }) => setServers(servers), (e: unknown) => notifyError(errorMessage(e)))
  }

  useEffect(() => {
    if (show) load()
  }, [show])

  async function rename(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    try {
      await renameServer(editing.id, editing.name.trim())
      notifySuccess(t('servers.renamed'))
      setEditing(null)
      load()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function remove(server: SavedServer) {
    setRemoving(null)
    try {
      await removeServer(server.id)
      notifySuccess(t('servers.removed', { server: serverLabel(server) }))
      load()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function download() {
    try {
      const list = await exportServers()
      const url = URL.createObjectURL(new Blob([JSON.stringify(list, null, 4) + '\n'], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'servers.json'
      document.body.append(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function upload(chosen: File | undefined) {
    if (!chosen) return
    try {
      let list: unknown
      try {
        list = JSON.parse(await chosen.text())
      } catch {
        return notifyError(t('servers.not_json', { file: chosen.name }))
      }
      const { added, updated } = await importServers(list)
      notifySuccess(t('servers.imported', { added, updated }))
      load()
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      if (file.current) file.current.value = ''
    }
  }

  return (
    <>
      <Modal
        show={show && removing === null}
        onClose={onClose}
        title={t('servers.title')}
        size="lg"
        id="serversModal"
        footer={
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('close')}
          </button>
        }
      >
        {servers === null ? (
          tApp('loading')
        ) : servers.length === 0 ? (
          <p>{t('servers.none')}</p>
        ) : (
          <div className="table-responsive">
            <table className="table table-striped table-hover w-auto" id="savedServers">
              <thead>
                <tr>
                  <th>{t('servers.name')}</th>
                  <th>{t('servers.server')}</th>
                  <th>{t('login.sslmode')}</th>
                  <th>{t('servers.username')}</th>
                  <th colSpan={2}>{t('servers.action')}</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.id}>
                    <td>
                      {editing?.id === server.id ? (
                        <form className="d-flex gap-1" onSubmit={(e) => void rename(e)}>
                          <input className="form-control form-control-sm" type="text" name="server_name" aria-label={t('servers.name')} maxLength={128} autoFocus value={editing.name} onChange={(e) => setEditing({ id: server.id, name: e.target.value })} />
                          <input className="btn btn-primary btn-sm" type="submit" value={tApp('go')} />
                        </form>
                      ) : (
                        server.name ?? <em>{t('servers.unnamed')}</em>
                      )}
                    </td>
                    <td className="text-nowrap" dir="ltr">
                      {server.host}:{server.port}
                    </td>
                    <td dir="ltr">{server.sslmode}</td>
                    <td dir="ltr">{server.last_username}</td>
                    <td className="text-nowrap">
                      <a href="#rename" className="rename_server" onClick={(e) => { e.preventDefault(); setEditing({ id: server.id, name: server.name ?? '' }) }}>
                        <Icon name="b_edit" /> {t('servers.rename')}
                      </a>
                    </td>
                    <td className="text-nowrap">
                      <a href="#remove" className="remove_server" onClick={(e) => { e.preventDefault(); setRemoving(server) }}>
                        <Icon name="b_drop" /> {t('servers.remove')}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <fieldset className="mt-3">
          <legend>{t('servers.export_title')}</legend>
          <button type="button" className="btn btn-secondary" id="exportServers" onClick={() => void download()}>
            <Icon name="b_export" /> {t('servers.export')}
          </button>
          <div className="form-text">{t('servers.export_help')}</div>
        </fieldset>
        <fieldset className="mt-3">
          <legend>{t('servers.import_title')}</legend>
          <label htmlFor="importServersFile" className="form-label">
            {t('servers.import_file')}
          </label>
          <input className="form-control" type="file" id="importServersFile" accept=".json,application/json" ref={file} onChange={(e) => void upload(e.target.files?.[0])} />
          <div className="form-text">{t('servers.import_help')}</div>
        </fieldset>
      </Modal>
      <Modal
        show={removing !== null}
        onClose={() => setRemoving(null)}
        title={tApp('confirm')}
        id="confirm_dialog"
        footer={
          <>
            <button type="button" className="btn btn-danger submitOK" onClick={() => removing && void remove(removing)}>
              {t('servers.remove')}
            </button>
            <button type="button" className="btn btn-secondary submitCancel" onClick={() => setRemoving(null)}>
              {tApp('cancel')}
            </button>
          </>
        }
      >
        {removing && t('servers.remove_what', { server: serverLabel(removing) })}
      </Modal>
    </>
  )
}
