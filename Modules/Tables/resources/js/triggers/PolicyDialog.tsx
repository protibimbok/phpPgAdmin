import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import { notifyError, notifySuccess } from '@/notify'
import { policies as policiesOf, type Policy, type PolicyData, type TriggerOptions } from '../api'

export interface PolicyDialogProps {
  show: boolean
  db: string
  scid: number
  tid: number
  options: TriggerOptions | null
  policy: Policy | null
  onClose: () => void
  onSaved: () => void
}

const COMMANDS = ['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE']

/**
 * The row security policy editor, in the trigger editor's dialog layout: the name, the command
 * and kind (fixed once created, as PostgreSQL cannot alter them), the roles, the USING and
 * WITH CHECK expressions and the comment. Go saves through the policy node; Preview SQL shows
 * the statements.
 */
export default function PolicyDialog({ show, db, scid, tid, options, policy, onClose, onSaved }: PolicyDialogProps) {
  const { t } = useTranslation('tables')
  const { t: tApp } = useTranslation()
  const [name, setName] = useState('')
  const [command, setCommand] = useState('ALL')
  const [kind, setKind] = useState('PERMISSIVE')
  const [roles, setRoles] = useState<string[]>([])
  const [using, setUsing] = useState('')
  const [check, setCheck] = useState('')
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!show) return
    setName(policy?.name ?? '')
    setCommand(policy?.event ?? 'ALL')
    setKind(policy?.type ?? 'PERMISSIVE')
    setRoles(policy ? policy.policyowner.filter((r) => r !== 'public') : [])
    setUsing(policy?.using ?? '')
    setCheck(policy?.withcheck ?? '')
    setComment(policy?.description ?? '')
  }, [show, policy])

  const collection = () => policiesOf(db, scid, tid)
  const canUse = command !== 'INSERT'
  const canCheck = command !== 'SELECT' && command !== 'DELETE'

  function data(): PolicyData {
    return { name, event: command, type: kind, policyowner: roles, using: canUse ? using : '', withcheck: canCheck ? check : '', description: comment }
  }

  async function save() {
    if (busy) return
    setBusy(true)
    try {
      if (policy) await collection().update(policy.oid, data())
      else await collection().create(data())
      notifySuccess(policy ? t('triggers.policy_altered', { name }) : t('triggers.policy_created', { name }))
      onSaved()
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    collection()
      .modifiedSql(data(), policy?.oid)
      .then(
        (sql) => setPreview({ sql, error: null }),
        (e: unknown) => setPreview({ sql: null, error: errorMessage(e) }),
      )
  }

  return (
    <>
      <Modal
        show={show}
        onClose={onClose}
        id="policyDialogModal"
        size="lg"
        title={policy ? t('triggers.policy_edit_title', { name: policy.name }) : t('triggers.policy_create_title')}
        footer={
          <>
            <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
              {tApp('go')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={showPreview}>
              {tApp('preview_sql')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {tApp('close')}
            </button>
          </>
        }
      >
        <form className="rte_form" onSubmit={(e) => { e.preventDefault(); void save() }}>
          <table className="rte_table table table-borderless table-sm">
            <tbody>
              <tr>
                <td>{t('triggers.name')}</td>
                <td>
                  <input type="text" name="policy_name" maxLength={63} value={name} onChange={(e) => setName(e.target.value)} required />
                </td>
              </tr>
              <tr>
                <td>{t('triggers.command')}</td>
                <td>
                  <select name="policy_command" value={command} onChange={(e) => setCommand(e.target.value)} disabled={policy !== null}>
                    {COMMANDS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
              <tr>
                <td>{t('triggers.policy_type')}</td>
                <td>
                  <select name="policy_type" value={kind} onChange={(e) => setKind(e.target.value)} disabled={policy !== null}>
                    <option value="PERMISSIVE">PERMISSIVE</option>
                    <option value="RESTRICTIVE">RESTRICTIVE</option>
                  </select>
                  {policy && <div className="form-text">{t('triggers.policy_fixed_hint')}</div>}
                </td>
              </tr>
              <tr>
                <td>{t('triggers.roles')}</td>
                <td>
                  <select name="policy_roles" multiple size={Math.min(6, Math.max(3, options?.roles.length ?? 3))} value={roles} onChange={(e) => setRoles(Array.from(e.target.selectedOptions, (o) => o.value))}>
                    {(options?.roles ?? []).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <div className="form-text">{t('triggers.roles_hint')}</div>
                </td>
              </tr>
              {canUse && (
                <tr>
                  <td>{t('triggers.using')}</td>
                  <td>
                    <input type="text" name="policy_using" size={50} value={using} onChange={(e) => setUsing(e.target.value)} placeholder="owner = current_user" />
                  </td>
                </tr>
              )}
              {canCheck && (
                <tr>
                  <td>{t('triggers.with_check')}</td>
                  <td>
                    <input type="text" name="policy_check" size={50} value={check} onChange={(e) => setCheck(e.target.value)} placeholder="owner = current_user" />
                  </td>
                </tr>
              )}
              <tr>
                <td>{t('triggers.comment')}</td>
                <td>
                  <input type="text" name="policy_comment" value={comment} onChange={(e) => setComment(e.target.value)} />
                </td>
              </tr>
            </tbody>
          </table>
        </form>
      </Modal>
      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </>
  )
}
