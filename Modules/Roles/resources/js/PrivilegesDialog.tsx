import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import Modal from '@/components/Modal'
import PreviewSql from '@/components/PreviewSql'
import type { Grant, PrivilegeChange } from './api'

export interface PrivilegesDialogProps {
  show: boolean
  title: ReactNode
  /** The grantee being edited; null offers a choice of roles. */
  grantee: string | null
  roles: string[]
  allowed: string[]
  /** What a grantee holds now, so choosing one that already has privileges starts from them. */
  currentOf: (grantee: string) => Grant[]
  /** Controls above the privileges: the default-privileges dialog's role and kind of object. */
  children?: ReactNode
  onPreview: (change: PrivilegeChange) => Promise<string>
  onSave: (change: PrivilegeChange) => Promise<void>
  onClose: () => void
}

/**
 * One grantee's privileges, laid out like phpMyAdmin's "Database-specific privileges"
 * fieldset: a Check all in the legend, then each privilege the object accepts as a checkbox
 * with its keyword in <code><dfn>, and beside it PostgreSQL's WITH GRANT OPTION.
 */
export default function PrivilegesDialog({ show, title, grantee, roles, allowed, currentOf, children, onPreview, onSave, onClose }: PrivilegesDialogProps) {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const [chosen, setChosen] = useState('')
  const [grants, setGrants] = useState<Record<string, boolean>>({})
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [saving, setSaving] = useState(false)

  const pick = (name: string) => {
    setChosen(name)
    setGrants(Object.fromEntries((name === '' ? [] : currentOf(name)).map((g) => [g.privilege, g.with_grant])))
  }

  useEffect(() => {
    if (show) pick(grantee ?? '')
    // Reloaded when the dialog opens or its object changes, not on every new currentOf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, grantee, allowed])

  const change = (): PrivilegeChange => ({ grantee: grantee ?? chosen, privileges: allowed.filter((p) => p in grants).map((p) => ({ privilege: p, with_grant: grants[p] })) })
  const toggle = (privilege: string, on: boolean, withGrant = false) =>
    setGrants((g) => {
      const next = { ...g }
      if (on) next[privilege] = withGrant || (next[privilege] ?? false)
      else delete next[privilege]

      return next
    })
  const all = allowed.length > 0 && allowed.every((p) => p in grants)

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      await onSave(change())
    } finally {
      setSaving(false)
    }
  }

  function showPreview() {
    setPreview({ sql: null, error: null })
    onPreview(change()).then(
      (sql) => setPreview({ sql: sql === '' ? t('nothing_to_change') : sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  return (
    <Modal
      show={show}
      title={title}
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary preview_sql" onClick={showPreview}>
            {tApp('preview_sql')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            {tApp('go')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {tApp('close')}
          </button>
        </>
      }
    >
      <form id="addUsersForm" onSubmit={(e) => { e.preventDefault(); void save() }}>
        {(grantee === null || children) && (
          <table className="table table-borderless table-sm w-auto">
            <tbody>
              {grantee === null && (
                <tr className="align-middle">
                  <td>
                    <label htmlFor="select_grantee">{t('privileges.grantee')}</label>
                  </td>
                  <td>
                    <select id="select_grantee" value={chosen} onChange={(e) => pick(e.target.value)} required>
                      <option value="" />
                      {['PUBLIC', ...roles].map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              )}
              {children}
            </tbody>
          </table>
        )}

        <fieldset className="pma-fieldset" id="fieldset_user_global_rights">
          <legend>
            {t('privileges.title')}{' '}
            <input type="checkbox" id="privileges_checkall" className="checkall_box" title={tApp('check_all')} checked={all} onChange={(e) => setGrants(e.target.checked ? Object.fromEntries(allowed.map((p) => [p, grants[p] ?? false])) : {})} />
            <label htmlFor="privileges_checkall">{tApp('check_all')}</label>
          </legend>
          <p>
            <small>
              <em>{t('privileges.note')}</em>
            </small>
          </p>
          <table className="table table-borderless table-sm w-auto mb-0">
            <tbody>
              {allowed.map((privilege) => (
                <tr key={privilege}>
                  <td>
                    <input type="checkbox" className="checkall" id={`checkbox_${privilege}_priv`} checked={privilege in grants} title={t(`privileges.hint.${privilege}`)} onChange={(e) => toggle(privilege, e.target.checked)} />
                    <label htmlFor={`checkbox_${privilege}_priv`}>
                      <code>
                        <dfn title={t(`privileges.hint.${privilege}`)}>{privilege}</dfn>
                      </code>
                    </label>
                  </td>
                  <td>
                    <input type="checkbox" id={`checkbox_${privilege}_grant`} checked={grants[privilege] ?? false} title={t('privileges.with_grant_hint')} onChange={(e) => (e.target.checked ? toggle(privilege, true, true) : setGrants((g) => (privilege in g ? { ...g, [privilege]: false } : g)))} />
                    <label htmlFor={`checkbox_${privilege}_grant`}>
                      <code>WITH GRANT OPTION</code>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      </form>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </Modal>
  )
}
