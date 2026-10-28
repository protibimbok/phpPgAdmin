import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import { treeState } from '@/layout/tree/treeState'
import { notifyError, notifySuccess } from '@/notify'
import { createDatabase } from '@databases/js/api'
import { quoteIdent } from '@sql/js/sql'
import { roleOptions, roles, type RoleData } from '../api'
import { AttributesFieldset, MembershipFieldset, NO_ATTRIBUTES, passwordValue, PasswordItems, VariablesFieldset, type PasswordChoice, type RoleForm } from '../RoleFields'
import { ROLES_PATH } from './Roles'

const EMPTY: RoleForm = { attributes: { ...NO_ATTRIBUTES, rolcanlogin: true }, connlimit: '', validUntil: '', memberOf: [], members: [], variables: [] }

/** The role's whole definition as CREATE ROLE takes it. */
export function roleData(form: RoleForm): RoleData {
  return {
    ...form.attributes,
    rolconnlimit: form.connlimit,
    rolvaliduntil: form.validUntil,
    rolmembership: form.memberOf,
    rolmembers: form.members,
    variables: form.variables.filter((v) => v.name !== ''),
  }
}

/**
 * phpMyAdmin's "Add user account" page (server/privileges/add_user.twig): the "Login
 * Information" fieldset, "Database for user account", the privileges (here the role
 * attributes, memberships and settings), then Go. CREATE ROLE runs first, then the database.
 */
export default function AddRole() {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const navigate = useNavigate()
  const { data: options, error } = useRequest(() => roleOptions(), [])
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [password, setPassword] = useState<{ choice: PasswordChoice; password: string; retype: string }>({ choice: 'userdefined', password: '', retype: '' })
  const [createDb, setCreateDb] = useState(false)
  const [search] = useSearchParams()
  // ?replication=1 is the Replication page's "Add replica replication user": a login role with REPLICATION.
  const [form, setForm] = useState<RoleForm>(() => (search.get('replication') === '1' ? { ...EMPTY, attributes: { ...EMPTY.attributes, rolreplication: true } } : EMPTY))
  const [preview, setPreview] = useState<{ sql: string | null; error: string | null } | null>(null)
  const [saving, setSaving] = useState(false)

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!options) return null

  function payload(): RoleData | null {
    const rolpassword = passwordValue(password.choice, password.password, password.retype)
    if (rolpassword === undefined) {
      notifyError(t('login.password_mismatch'))

      return null
    }

    return { rolname: name, description: comment, rolpassword, ...roleData(form) }
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    const data = payload()
    if (!data || saving) return
    setSaving(true)
    try {
      await roles.create(data)
      if (createDb) {
        await createDatabase({ name, datowner: name })
        treeState.refresh()
      }
      notifySuccess(t('created', { name }))
      navigate(ROLES_PATH)
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  function showPreview() {
    const data = payload()
    if (!data) return
    setPreview({ sql: null, error: null })
    roles.modifiedSql(data).then(
      (sql) => setPreview({ sql: createDb ? `${sql}\n\nCREATE DATABASE ${quoteIdent(name)} OWNER ${quoteIdent(name)};` : sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  return (
    <div className="container-fluid my-3">
      <h2>
        <Icon name="b_usradd" /> {t('add')}
      </h2>

      <form name="usersForm" id="addUsersForm" autoComplete="off" onSubmit={save}>
        <fieldset className="pma-fieldset" id="fieldset_add_user_login">
          <legend>{t('login.title')}</legend>
          <div className="item">
            <label htmlFor="pma_username">{t('login.name')}</label>
            <span className="options">&nbsp;</span>
            <input type="text" name="username" id="pma_username" className="autofocus" spellCheck={false} maxLength={63} title={t('login.name_title')} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <PasswordItems mode="create" {...password} onChange={(patch) => setPassword((p) => ({ ...p, ...patch }))} />
          <div className="item">
            <label htmlFor="text_comment">{t('login.comment')}</label>
            <span className="options">&nbsp;</span>
            <input type="text" name="comment" id="text_comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
        </fieldset>

        <fieldset className="pma-fieldset" id="fieldset_add_user_database">
          <legend>{t('database.title')}</legend>
          <input type="checkbox" name="createdb-1" id="createdb-1" checked={createDb} onChange={(e) => setCreateDb(e.target.checked)} />
          <label htmlFor="createdb-1">{t('database.create')}</label>
        </fieldset>

        <AttributesFieldset form={form} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        <MembershipFieldset form={form} options={options} self={name} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />
        <VariablesFieldset form={form} options={options} onChange={(patch) => setForm((f) => ({ ...f, ...patch }))} />

        <fieldset id="fieldset_add_user_footer" className="pma-fieldset tblFooters">
          <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={showPreview} />
          <input className="btn btn-primary" type="submit" id="adduser_submit" value={tApp('go')} disabled={saving} />
        </fieldset>
      </form>

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </div>
  )
}
