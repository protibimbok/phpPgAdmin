import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import PreviewSql from '@/components/PreviewSql'
import SecurityLabelsCard from '@/components/SecurityLabelsCard'
import { urls } from '@/level'
import { notifyError, notifySuccess } from '@/notify'
import { reassign, reassignSql, resolveRole, roleDatabases, roleOptions, roleProperties, roles, type Reassign, type RoleData, type RoleProperties } from '../api'
import { grantSummary, privilegeList } from '../format'
import { AttributesFieldset, MembershipFieldset, passwordValue, VariablesFieldset, type RoleForm } from '../RoleFields'
import { roleData } from './AddRole'
import { roleUrl } from './Roles'

function fromRole(role: RoleProperties): RoleForm {
  return {
    attributes: { rolcanlogin: role.rolcanlogin, rolinherit: role.rolinherit, rolsuper: role.rolsuper, rolcreatedb: role.rolcreatedb, rolcreaterole: role.rolcreaterole, rolreplication: role.rolreplication, rolbypassrls: role.rolbypassrls },
    connlimit: role.rolconnlimit === -1 ? '' : String(role.rolconnlimit),
    validUntil: role.rolvaliduntil === null || role.rolvaliduntil === 'infinity' ? '' : role.rolvaliduntil,
    memberOf: role.rolmembership,
    members: role.rolmembers,
    variables: role.variables,
  }
}

type Preview = { sql: string | null; error: string | null }

/**
 * phpMyAdmin's "Edit privileges" page for a user account (server/privileges/user_properties.twig):
 * the heading with the role's name, then one form per part, each with its own Go: the role
 * attributes, memberships, configuration parameters, "Change password", "Change login
 * information" (rename and comment), and pgAdmin's reassign / drop owned objects.
 */
export default function EditRole() {
  const { t } = useTranslation('roles')
  const name = useParams().role ?? ''
  const navigate = useNavigate()
  const { data, error, reload } = useRequest(async () => {
    const rid = await resolveRole(name)
    const [role, options] = await Promise.all([roleProperties(rid), roleOptions()])

    return { rid, role, options }
  }, [name])
  const [form, setForm] = useState<RoleForm | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)

  useEffect(() => {
    if (data) setForm(fromRole(data.role))
  }, [data])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data || !form) return null

  const { rid, role, options } = data
  const change = (patch: Partial<RoleForm>) => setForm((f) => (f ? { ...f, ...patch } : f))

  async function save(changes: RoleData) {
    try {
      await roles.update(rid, changes)
      notifySuccess(t('altered', { name: changes.rolname ?? name }))
      if (changes.rolname && changes.rolname !== name) navigate(roleUrl(changes.rolname))
      else reload()
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  function showPreview(load: () => Promise<string>) {
    setPreview({ sql: null, error: null })
    load().then(
      (sql) => setPreview({ sql: sql === '' ? t('nothing_to_change') : sql, error: null }),
      (err: unknown) => setPreview({ sql: null, error: errorMessage(err) }),
    )
  }

  const full = roleData(form)
  const attributes: RoleData = { ...form.attributes, rolconnlimit: full.rolconnlimit, rolvaliduntil: full.rolvaliduntil }
  const membership: RoleData = { rolmembership: full.rolmembership, rolmembers: full.rolmembers }
  const variables: RoleData = { variables: full.variables }

  return (
    <div className="container-fluid my-3" id="edit_user_dialog">
      <h2>
        <Icon name="b_usredit" /> {t('edit.title')} <em>{role.rolname}</em>
      </h2>

      {role.is_current && (
        <div className="alert alert-primary" role="alert">
          <Icon name="s_notice" /> {t('edit.current_user')}
        </div>
      )}

      <PartForm id="fieldset_user_privtable_footer" onSubmit={() => save(attributes)} onPreview={() => showPreview(() => roles.modifiedSql(attributes, rid))}>
        <AttributesFieldset form={form} onChange={change} />
      </PartForm>

      <DatabasePrivileges rid={rid} />

      <PartForm id="fieldset_membership_footer" onSubmit={() => save(membership)} onPreview={() => showPreview(() => roles.modifiedSql(membership, rid))}>
        <MembershipFieldset form={form} options={options} self={role.rolname} onChange={change} />
      </PartForm>

      <PartForm id="fieldset_variables_footer" onSubmit={() => save(variables)} onPreview={() => showPreview(() => roles.modifiedSql(variables, rid))}>
        <VariablesFieldset form={form} options={options} onChange={change} />
      </PartForm>

      <ChangePassword hasPassword={role.has_password} onSave={save} onPreview={(data) => showPreview(() => roles.modifiedSql(data, rid))} />

      <ChangeLogin role={role} onSave={save} onPreview={(data) => showPreview(() => roles.modifiedSql(data, rid))} />

      <SecurityLabelsCard key={rid} db={null} catalog="pg_authid" oid={rid} />
      <ReassignOwned rid={rid} options={options} self={role.rolname} onPreview={(data) => showPreview(() => reassignSql(rid, data))} />

      <PreviewSql show={preview !== null} sql={preview?.sql ?? null} error={preview?.error} onClose={() => setPreview(null)} />
    </div>
  )
}

/** phpMyAdmin's "Database-specific privileges": the databases the role holds privileges on, each linking to its Privileges tab. */
function DatabasePrivileges({ rid }: { rid: number }) {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const { data: databases } = useRequest(() => roleDatabases(rid), [rid])

  if (!databases) return null

  return (
    <fieldset className="pma-fieldset" id="fieldset_database_privileges">
      <legend>{t('privileges.database_specific')}</legend>
      <table className="table table-striped table-hover w-auto">
        <thead>
          <tr>
            <th>{t('privileges.database')}</th>
            <th>{t('privileges.privileges')}</th>
            <th>{t('privileges.grant')}</th>
            <th>{t('columns.action')}</th>
          </tr>
        </thead>
        <tbody>
          {databases.length === 0 && (
            <tr>
              <td colSpan={4}>{t('privileges.no_databases')}</td>
            </tr>
          )}
          {databases.map((row) => (
            <tr key={row.database}>
              <td>{row.database}</td>
              <td>
                <code>{privilegeList(row.privileges, ['CREATE', 'CONNECT', 'TEMPORARY'])}</code>
              </td>
              <td>{grantSummary(row.privileges, tApp('yes'), tApp('no'))}</td>
              <td>
                <Link to={`${urls.database(row.database)}/privileges`}>
                  <Icon name="b_usredit" /> {t('actions.edit')}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  )
}

/** A form of the edit page: its fieldsets, then the footer with Preview SQL and Go. */
function PartForm({ id, children, onSubmit, onPreview }: { id: string; children: ReactNode; onSubmit: () => Promise<void>; onPreview: () => void }) {
  const { t: tApp } = useTranslation()
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    await onSubmit()
    setSaving(false)
  }

  return (
    <form className="submenu-item" autoComplete="off" onSubmit={submit}>
      {children}
      <fieldset id={id} className="pma-fieldset tblFooters">
        <input className="btn btn-secondary preview_sql me-2" type="button" value={tApp('preview_sql')} onClick={onPreview} />
        <input className="btn btn-primary" type="submit" value={tApp('go')} disabled={saving} />
      </fieldset>
    </form>
  )
}

/** phpMyAdmin's "Change password" fieldset: No Password, or the password typed twice. */
function ChangePassword({ hasPassword, onSave, onPreview }: { hasPassword: boolean | null; onSave: (data: RoleData) => Promise<void>; onPreview: (data: RoleData) => void }) {
  const { t } = useTranslation('roles')
  const [none, setNone] = useState(false)
  const [password, setPassword] = useState('')
  const [retype, setRetype] = useState('')

  function data(): RoleData | null {
    const rolpassword = passwordValue(none ? 'none' : 'userdefined', password, retype)
    if (rolpassword === undefined) {
      notifyError(t('login.password_mismatch'))

      return null
    }

    return { rolpassword }
  }

  return (
    <PartForm
      id="fieldset_change_password_footer"
      onSubmit={async () => {
        const changes = data()
        if (!changes) return
        await onSave(changes)
        setPassword('')
        setRetype('')
      }}
      onPreview={() => {
        const changes = data()
        if (changes) onPreview(changes)
      }}
    >
      <fieldset className="pma-fieldset" id="fieldset_change_password">
        <legend>{t('password.title')}</legend>
        <table className="table table-borderless w-auto">
          <tbody>
            <tr>
              <td colSpan={2}>
                <input type="radio" name="nopass" value="1" id="nopass_1" checked={none} onChange={() => setNone(true)} />
                <label htmlFor="nopass_1">{t('password.none')}</label>
                {hasPassword === false && <span className="text-muted"> ({t('password.has_none')})</span>}
              </td>
            </tr>
            <tr className="align-middle">
              <td>
                <input type="radio" name="nopass" value="0" id="nopass_0" checked={!none} onChange={() => setNone(false)} />
                <label htmlFor="nopass_0">{t('password.password')}&nbsp;</label>
              </td>
              <td>
                {t('password.enter')}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                <input type="password" spellCheck={false} name="pma_pw" id="text_pma_change_pw" size={10} className="textfield" autoComplete="new-password" value={password} required={!none} onChange={(e) => { setPassword(e.target.value); setNone(false) }} />
                <br />
                {t('password.retype')}&nbsp;
                <input type="password" spellCheck={false} name="pma_pw2" id="text_pma_change_pw2" size={10} className="textfield" autoComplete="new-password" value={retype} required={!none} onChange={(e) => { setRetype(e.target.value); setNone(false) }} />
              </td>
            </tr>
          </tbody>
        </table>
      </fieldset>
    </PartForm>
  )
}

/** phpMyAdmin's "Change login information" fieldset: here the role's name and comment. */
function ChangeLogin({ role, onSave, onPreview }: { role: RoleProperties; onSave: (data: RoleData) => Promise<void>; onPreview: (data: RoleData) => void }) {
  const { t } = useTranslation('roles')
  const [name, setName] = useState(role.rolname)
  const [comment, setComment] = useState(role.description ?? '')
  const data = (): RoleData => ({ rolname: name, description: comment })

  return (
    <PartForm id="fieldset_change_copy_user_footer" onSubmit={() => onSave(data())} onPreview={() => onPreview(data())}>
      <fieldset className="pma-fieldset" id="fieldset_add_user_login">
        <legend>{t('login.change_title')}</legend>
        <div className="item">
          <label htmlFor="pma_username">{t('login.name')}</label>
          <span className="options">&nbsp;</span>
          <input type="text" name="username" id="pma_username" spellCheck={false} maxLength={63} title={t('login.name_title')} value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="item">
          <label htmlFor="text_comment">{t('login.comment')}</label>
          <span className="options">&nbsp;</span>
          <input type="text" name="comment" id="text_comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        </div>
      </fieldset>
    </PartForm>
  )
}

/** pgAdmin's "Reassign/Drop Owned" dialog: in one database, REASSIGN OWNED BY the role TO another, or DROP OWNED BY it. */
function ReassignOwned({ rid, options, self, onPreview }: { rid: number; options: { roles: string[]; databases: string[] }; self: string; onPreview: (data: Reassign) => void }) {
  const { t } = useTranslation('roles')
  const [data, setData] = useState<Reassign>({ database: options.databases[0] ?? '', operation: 'reassign', new_role: 'CURRENT_USER', cascade: false })
  const [confirm, setConfirm] = useState<string | null>(null)
  const set = (patch: Partial<Reassign>) => setData((d) => ({ ...d, ...patch }))

  async function ask() {
    try {
      setConfirm(await reassignSql(rid, data))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function run() {
    setConfirm(null)
    try {
      await reassign(rid, data)
      notifySuccess(data.operation === 'reassign' ? t('reassign.reassigned') : t('reassign.dropped'))
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <PartForm id="fieldset_reassign_footer" onSubmit={ask} onPreview={() => onPreview(data)}>
      <fieldset className="pma-fieldset" id="fieldset_reassign_owned">
        <legend>{t('reassign.title')}</legend>
        <table className="table table-borderless w-auto mb-0">
          <tbody>
            <tr className="align-middle">
              <td>
                <label htmlFor="select_reassign_database">{t('reassign.database')}</label>
              </td>
              <td>
                <select id="select_reassign_database" value={data.database} onChange={(e) => set({ database: e.target.value })}>
                  {options.databases.map((database) => (
                    <option key={database} value={database}>
                      {database}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr className="align-middle">
              <td>
                <input type="radio" name="role_op" id="role_op_reassign" checked={data.operation === 'reassign'} onChange={() => set({ operation: 'reassign' })} />
                <label htmlFor="role_op_reassign">{t('reassign.reassign_to')}</label>
              </td>
              <td>
                <select value={data.new_role} aria-label={t('reassign.reassign_to')} onChange={(e) => set({ new_role: e.target.value, operation: 'reassign' })}>
                  {['CURRENT_USER', 'SESSION_USER', ...options.roles.filter((role) => role !== self)].map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr className="align-middle">
              <td>
                <input type="radio" name="role_op" id="role_op_drop" checked={data.operation === 'drop'} onChange={() => set({ operation: 'drop' })} />
                <label htmlFor="role_op_drop">{t('reassign.drop')}</label>
              </td>
              <td>
                <input type="checkbox" id="checkbox_reassign_cascade" checked={data.cascade} onChange={(e) => set({ cascade: e.target.checked, operation: 'drop' })} />
                <label htmlFor="checkbox_reassign_cascade">CASCADE</label>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mb-0">
          <small>
            <em>{t('reassign.note')}</em>
          </small>
        </p>
      </fieldset>
      <ConfirmQuery show={confirm !== null} sql={confirm ?? ''} confirmClass={data.operation === 'drop' ? 'btn-danger' : undefined} onClose={() => setConfirm(null)} onConfirm={() => void run()} />
    </PartForm>
  )
}
