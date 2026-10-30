import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import { notifyError, notifySuccess } from '@/notify'
import { useSession } from '@/session'
import { reconnect, useConnection, useTransactionStatus } from '../querySession'

/**
 * pgAdmin's query tool connection: which role the page's session runs as, and its "New
 * connection" dialog, which starts the session again as another role of the server (with its
 * password) and/or with a role to SET ROLE to. A transaction open in the old session is rolled
 * back, after asking.
 */
export default function ConnectionControl({ db }: { db: string | null }) {
  const { t } = useTranslation('sql')
  const { t: tApp } = useTranslation()
  const { user } = useSession()
  const connection = useConnection(db)
  const status = useTransactionStatus(db)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', role: '' })
  const [busy, setBusy] = useState(false)
  const username = connection?.username ?? user.username

  async function submit(e: FormEvent) {
    e.preventDefault()
    if ((status === 'intrans' || status === 'inerror') && !window.confirm(t('connection.rollback_first'))) return
    setBusy(true)
    try {
      await reconnect(db, { username: form.username.trim() || undefined, password: form.password, role: form.role.trim() || undefined })
      notifySuccess(t('connection.connected', { username: form.username.trim() || user.username }))
      setOpen(false)
      setForm((f) => ({ ...f, password: '' }))
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <span id="sql_connection">
        {t('connection.label')} <strong>{username}</strong>
        {connection?.role && <> ({t('connection.role', { role: connection.role })})</>}{' '}
        <a href="#new-connection" id="new_connection" onClick={(e) => { e.preventDefault(); setForm({ username: connection?.username ?? '', password: '', role: connection?.role ?? '' }); setOpen(true) }}>
          {t('connection.new')}
        </a>
        {connection && (
          <>
            {' · '}
            <a href="#own-connection" id="own_connection" onClick={(e) => { e.preventDefault(); void reconnect(db, {}).then(() => notifySuccess(t('connection.connected', { username: user.username })), (err: unknown) => notifyError(errorMessage(err))) }}>
              {t('connection.own', { username: user.username })}
            </a>
          </>
        )}
      </span>
      <Modal
        show={open}
        onClose={() => setOpen(false)}
        title={t('connection.title')}
        id="newConnectionModal"
        footer={
          <>
            <button type="submit" form="new_connection_form" className="btn btn-primary" disabled={busy}>
              {tApp('go')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              {tApp('cancel')}
            </button>
          </>
        }
      >
        <form id="new_connection_form" onSubmit={(e) => void submit(e)}>
          <div className="mb-2">
            <label className="form-label" htmlFor="new_connection_username">
              {t('connection.username')}
            </label>
            <input className="form-control" id="new_connection_username" autoComplete="username" placeholder={user.username} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="form-label" htmlFor="new_connection_password">
              {t('connection.password')}
            </label>
            <input className="form-control" id="new_connection_password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="mb-2">
            <label className="form-label" htmlFor="new_connection_role">
              {t('connection.role_field')}
            </label>
            <input className="form-control" id="new_connection_role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </div>
          <div className="form-text">{t('connection.help')}</div>
        </form>
      </Modal>
    </>
  )
}
