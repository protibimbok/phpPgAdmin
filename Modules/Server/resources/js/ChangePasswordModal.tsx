import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { changePassword, getAccount } from '@auth/js/api'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import { notifyError, notifySuccess } from '@/notify'

const GENERATED_LENGTH = 16
const ALPHABET = 'abcdefhjkmnprstuvwxyzABCDEFGHJKLMNPQRSTUVWYXZ234567892345678923456789'

/** phpMyAdmin's suggestPassword: random characters from an alphabet without look-alikes. */
function generate(): string {
  const bytes = new Uint32Array(GENERATED_LENGTH)
  crypto.getRandomValues(bytes)

  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/**
 * phpMyAdmin's "Change password" modal (server/privileges/change_password.twig) for the role
 * signed in: No Password or a password entered twice, the hashing method (SCRAM-SHA-256 or
 * MD5, the server's password_encryption first) and "Generate password". The session goes on
 * with the new password.
 */
export default function ChangePasswordModal({ show, onClose }: { show: boolean; onClose: () => void }) {
  const { t } = useTranslation('server')
  const { t: tApp } = useTranslation()
  const [noPassword, setNoPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [retype, setRetype] = useState('')
  const [hashing, setHashing] = useState('scram-sha-256')
  const [generated, setGenerated] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setNoPassword(false)
    setPassword('')
    setRetype('')
    setGenerated('')
    getAccount().then(
      (account) => setHashing(account.password_encryption === 'md5' ? 'md5' : 'scram-sha-256'),
      () => setHashing('scram-sha-256'),
    )
  }, [show])

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (busy) return
    if (!noPassword && password === '') return notifyError(t('password.empty'))
    if (!noPassword && password !== retype) return notifyError(t('password.mismatch'))
    setBusy(true)
    try {
      await changePassword(noPassword ? null : password, hashing)
      notifySuccess(t('password.changed'))
      onClose()
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      show={show}
      onClose={onClose}
      id="changePasswordModal"
      size="lg"
      title={t('password.title')}
      footer={
        <>
          <button type="button" className="btn btn-secondary" id="changePasswordGoButton" onClick={() => void submit()} disabled={busy}>
            {tApp('go')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('cancel')}
          </button>
        </>
      }
    >
      <form id="change_password_form" autoComplete="off" onSubmit={(e) => void submit(e)}>
        <div className="card mb-3" id="fieldset_change_password">
          <div className="card-header">{t('password.title')}</div>
          <div className="card-body">
            <table className="table-borderless" style={{ background: 'transparent' }}>
              <tbody>
                <tr className="mb-4">
                  <td colSpan={2}>
                    <input type="radio" name="nopass" value="1" id="nopass_1" checked={noPassword} onChange={() => setNoPassword(true)} /> <label htmlFor="nopass_1">{t('password.no_password')}</label>
                  </td>
                </tr>
                <tr className="align-middle mb-4">
                  <td>
                    <input type="radio" name="nopass" value="0" id="nopass_0" checked={!noPassword} onChange={() => setNoPassword(false)} /> <label htmlFor="nopass_0">{t('password.password')}&nbsp;</label>
                  </td>
                  <td>
                    <div className="row">
                      <span className="d-flex align-items-center col-4">{t('password.enter')}</span>
                      <input type="password" name="pma_pw" id="text_pma_change_pw" size={10} className="textfield col-6" spellCheck={false} autoComplete="new-password" value={password} onChange={(e) => { setNoPassword(false); setPassword(e.target.value) }} />
                    </div>
                    <div className="row mt-2">
                      <span className="d-flex align-items-center col-4">{t('password.retype')}</span>
                      <input type="password" name="pma_pw2" id="text_pma_change_pw2" size={10} className="textfield col-6" spellCheck={false} autoComplete="new-password" value={retype} onChange={(e) => { setNoPassword(false); setRetype(e.target.value) }} />
                    </div>
                  </td>
                </tr>
                <tr className="align-middle mb-4">
                  <td>
                    <label htmlFor="select_authentication_plugin_cp">{t('password.hashing')}</label>
                  </td>
                  <td>
                    <select name="authentication_plugin" id="select_authentication_plugin_cp" className="col-8" value={hashing} onChange={(e) => setHashing(e.target.value)}>
                      <option value="scram-sha-256">SCRAM-SHA-256</option>
                      <option value="md5">MD5</option>
                    </select>
                  </td>
                </tr>
                <tr className="align-middle">
                  <td>{t('password.generate_label')}</td>
                  <td>
                    <input
                      type="button"
                      className="btn btn-secondary button"
                      id="button_generate_password"
                      value={t('password.generate')}
                      onClick={() => {
                        const value = generate()
                        setGenerated(value)
                        setNoPassword(false)
                        setPassword(value)
                        setRetype(value)
                      }}
                    />{' '}
                    <input type="text" name="generated_pw" id="generated_pw" readOnly value={generated} dir="ltr" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </form>
    </Modal>
  )
}
