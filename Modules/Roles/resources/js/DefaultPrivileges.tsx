import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { notifyError, notifySuccess } from '@/notify'
import { defaultPrivileges, defaultPrivilegesSql, updateDefaultPrivileges, type DefaultObjectType, type DefaultPrivilegeChange, type DefaultPrivileges as Defaults } from './api'
import { grantSummary, privilegeList } from './format'
import PrivilegesDialog from './PrivilegesDialog'

interface Editing {
  grantee: string | null
  role: string
  objtype: DefaultObjectType
}

/**
 * The privileges new objects get (ALTER DEFAULT PRIVILEGES), database-wide or in one schema:
 * pgAdmin's "Default Privileges" tab as a fieldset of the Privileges page, one row per role
 * whose objects they apply to, kind of object and grantee, with Edit and Revoke.
 */
export default function DefaultPrivileges({ db, scid, roles }: { db: string; scid?: number; roles: string[] }) {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const { data } = useRequest(() => defaultPrivileges(db, scid), [db, scid])
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [revoking, setRevoking] = useState<{ change: DefaultPrivilegeChange; sql: string } | null>(null)

  useEffect(() => setDefaults(null), [data])

  const current = defaults ?? data
  if (!current) return null

  const types = Object.keys(current.allowed) as DefaultObjectType[]

  async function save(change: DefaultPrivilegeChange) {
    try {
      setDefaults(await updateDefaultPrivileges(db, change))
      notifySuccess(t('privileges.updated', { grantee: change.grantee }))
      setEditing(null)
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function askRevoke(change: DefaultPrivilegeChange) {
    try {
      setRevoking({ change, sql: await defaultPrivilegesSql(db, change) })
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  return (
    <fieldset className="pma-fieldset" id="fieldset_default_privileges">
      <legend>{scid === undefined ? t('defaults.title') : t('defaults.title_schema')}</legend>
      <div className="table-responsive">
        <table className="table table-striped table-hover w-auto">
          <thead>
            <tr>
              <th scope="col">{t('defaults.for_role')}</th>
              <th scope="col">{t('defaults.objects')}</th>
              <th scope="col">{t('privileges.role')}</th>
              <th scope="col">{t('privileges.privileges')}</th>
              <th scope="col">{t('privileges.grant')}</th>
              <th scope="col" colSpan={2}>
                {t('columns.action')}
              </th>
            </tr>
          </thead>
          <tbody>
            {current.rows.length === 0 && (
              <tr>
                <td colSpan={7}>{t('defaults.none')}</td>
              </tr>
            )}
            {current.rows.map((row) => (
              <tr key={`${row.role}\u0000${row.objtype}\u0000${row.grantee}`}>
                <td>{row.role}</td>
                <td>{t(`defaults.type.${row.objtype}`)}</td>
                <td>{row.grantee === 'PUBLIC' ? <span className="text-danger">PUBLIC</span> : row.grantee}</td>
                <td>
                  <code>{privilegeList(row.privileges, current.allowed[row.objtype] ?? [])}</code>
                </td>
                <td>{grantSummary(row.privileges, tApp('yes'), tApp('no'))}</td>
                <td>
                  <a href="#edit" onClick={(e) => { e.preventDefault(); setEditing({ grantee: row.grantee, role: row.role, objtype: row.objtype }) }}>
                    <Icon name="b_usredit" /> {t('actions.edit')}
                  </a>
                </td>
                <td>
                  <a href="#revoke" onClick={(e) => { e.preventDefault(); void askRevoke({ scid, role: row.role, objtype: row.objtype, grantee: row.grantee, privileges: [] }) }}>
                    <Icon name="b_usrdrop" /> {t('privileges.revoke')}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <a href="#add-default" onClick={(e) => { e.preventDefault(); setEditing({ grantee: null, role: '', objtype: 'r' }) }}>
        <Icon name="b_usradd" /> {t('defaults.add')}
      </a>

      <PrivilegesDialog
        show={editing !== null}
        title={editing?.grantee ? t('defaults.edit_title', { grantee: editing.grantee, objects: t(`defaults.type.${editing.objtype}`) }) : t('defaults.add')}
        grantee={editing?.grantee ?? null}
        roles={roles}
        allowed={editing ? (current.allowed[editing.objtype] ?? []) : []}
        currentOf={(grantee) => current.rows.find((row) => row.grantee === grantee && row.objtype === editing?.objtype && (editing.role === '' || row.role === editing.role))?.privileges ?? []}
        onPreview={(change) => defaultPrivilegesSql(db, { ...change, scid, role: editing?.role, objtype: editing!.objtype })}
        onSave={(change) => save({ ...change, scid, role: editing?.role, objtype: editing!.objtype })}
        onClose={() => setEditing(null)}
      >
        {editing?.grantee === null && (
          <>
            <tr className="align-middle">
              <td>
                <label htmlFor="select_default_role">{t('defaults.for_role')}</label>
              </td>
              <td>
                <select id="select_default_role" value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  <option value="">{t('defaults.current_role')}</option>
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr className="align-middle">
              <td>
                <label htmlFor="select_default_objtype">{t('defaults.objects')}</label>
              </td>
              <td>
                <select id="select_default_objtype" value={editing.objtype} onChange={(e) => setEditing({ ...editing, objtype: e.target.value as DefaultObjectType })}>
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {t(`defaults.type.${type}`)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          </>
        )}
      </PrivilegesDialog>

      <ConfirmQuery
        show={revoking !== null}
        sql={revoking?.sql ?? ''}
        confirmClass="btn-danger"
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          const pending = revoking
          setRevoking(null)
          if (pending) void save(pending.change)
        }}
      />
    </fieldset>
  )
}
