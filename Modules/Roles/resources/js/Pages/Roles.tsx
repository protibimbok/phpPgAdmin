import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import SqlView from '@/components/SqlView'
import { treeState } from '@/layout/tree/treeState'
import { notify, notifyError, notifySuccess } from '@/notify'
import { dropDatabase, listDatabases } from '@databases/js/api'
import { quoteIdent } from '@sql/js/sql'
import { roles as rolesApi, type Role } from '../api'
import { attributeKeywords } from '../RoleFields'

export const ROLES_PATH = '/server/roles'

export const roleUrl = (name: string) => `${ROLES_PATH}/${encodeURIComponent(name)}/edit`

/**
 * The server's roles, laid out like phpMyAdmin's "User accounts overview" (server/privileges/
 * users_overview.twig): a striped table with a checkbox per role, its name, whether it may log
 * in and has a password, its attributes in <code>, what it is a member of and the Edit / Export
 * actions; the "With selected" export, the "New" card and the "Remove selected" card. The
 * predefined pg_* roles are listed only on request.
 */
export default function Roles() {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const { data: roles, error, reload } = useRequest(() => rolesApi.list(), [])
  const [showSystem, setShowSystem] = useState(false)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [dropDatabases, setDropDatabases] = useState(false)
  const [dropping, setDropping] = useState<{ roles: Role[]; databases: { did: number; name: string }[] } | null>(null)
  const [exported, setExported] = useState<{ title: string; sql: string | null } | null>(null)

  // Only the predefined roles are named pg_* (CREATE ROLE refuses the prefix); the bootstrap
  // superuser shares their low OIDs but is always listed.
  const visible = useMemo(() => (roles ?? []).filter((role) => showSystem || !role.rolname.startsWith('pg_')), [roles, showSystem])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!roles) return null

  const allChecked = visible.length > 0 && visible.every((role) => checked.has(role.oid))
  const selected = () => visible.filter((role) => checked.has(role.oid))

  function toggle(oid: number, value: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (value) next.add(oid)
      else next.delete(oid)

      return next
    })
  }

  function exportRoles(targets: Role[]) {
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    setExported({ title: targets.length === 1 ? t('export_title', { name: targets[0].rolname }) : t('export_title_many'), sql: null })
    Promise.all(targets.map((role) => rolesApi.sql(role.oid))).then(
      (parts) => setExported((current) => (current ? { ...current, sql: parts.join('\n\n') } : null)),
      (e: unknown) => {
        setExported(null)
        notifyError(errorMessage(e))
      },
    )
  }

  async function askDrop() {
    const targets = selected()
    if (targets.length === 0) return notify(t('none_selected'), 'error')
    const names = new Set(targets.map((role) => role.rolname))
    const databases = dropDatabases ? (await listDatabases()).filter((database) => names.has(database.name)).map(({ did, name }) => ({ did, name })) : []
    setDropping({ roles: targets, databases })
  }

  async function drop({ roles: targets, databases }: NonNullable<typeof dropping>) {
    setDropping(null)
    notify(tApp('processing_request'), 'notice', null)
    try {
      for (const database of databases) await dropDatabase(database.did)
      for (const role of targets) await rolesApi.remove(role.oid)
      notifySuccess(t('dropped', { count: targets.length }))
    } catch (e) {
      notifyError(errorMessage(e))
    } finally {
      setChecked(new Set())
      reload()
      if (databases.length > 0) treeState.refresh()
    }
  }

  return (
    <div className="container-fluid my-3" id="roles">
      <h2>
        <Icon name="b_usrlist" /> {t('overview')}
      </h2>

      <div className="form-check mb-2">
        <input className="form-check-input" type="checkbox" id="showSystemRoles" checked={showSystem} onChange={(e) => setShowSystem(e.target.checked)} />
        <label className="form-check-label" htmlFor="showSystemRoles">
          {t('show_system')}
        </label>
      </div>

      <form name="usersForm" id="usersForm" onSubmit={(e) => e.preventDefault()}>
        <div className="table-responsive">
          <table id="userRightsTable" className="table table-striped table-hover w-auto">
            <thead>
              <tr>
                <th />
                <th scope="col">{t('columns.name')}</th>
                <th scope="col">{t('columns.login')}</th>
                <th scope="col">{t('columns.password')}</th>
                <th scope="col">{t('columns.attributes')}</th>
                <th scope="col">{t('columns.member_of')}</th>
                <th scope="col">{t('columns.comment')}</th>
                <th scope="col" colSpan={2}>
                  {t('columns.action')}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((role, index) => (
                <tr key={role.oid}>
                  <td>
                    <input type="checkbox" className="checkall" id={`checkbox_sel_users_${index + 1}`} value={role.rolname} name="selected_usr[]" checked={checked.has(role.oid)} onChange={(e) => toggle(role.oid, e.target.checked)} />
                  </td>
                  <td>
                    <label htmlFor={`checkbox_sel_users_${index + 1}`}>
                      <Link className="edit_user_anchor" to={roleUrl(role.rolname)}>
                        {role.rolname}
                      </Link>
                    </label>
                  </td>
                  <td>{role.rolcanlogin ? tApp('yes') : <span className="text-danger">{tApp('no')}</span>}</td>
                  <td>{role.has_password === null ? '–' : role.has_password ? tApp('yes') : <span className="text-danger">{tApp('no')}</span>}</td>
                  <td>
                    <code>{attributeKeywords(role).filter((keyword) => keyword !== 'LOGIN' && keyword !== 'INHERIT').join(', ') || 'USAGE'}</code>
                  </td>
                  <td>{role.rolmembership.map((membership) => membership.role).join(', ')}</td>
                  <td>{role.description}</td>
                  <td className="text-center">
                    <Link className="edit_user_anchor" to={roleUrl(role.rolname)}>
                      <Icon name="b_usredit" /> {t('actions.edit')}
                    </Link>
                  </td>
                  <td className="text-center">
                    <a className="export_user_anchor ajax" href="#export" onClick={(e) => { e.preventDefault(); exportRoles([role]) }}>
                      <Icon name="b_tblexport" /> {t('actions.export')}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="float-start row">
          <div className="col-12">
            <Icon name="select_all_arrow" title={tApp('with_selected')} />
            <input type="checkbox" id="usersForm_checkall" className="checkall_box" title={tApp('check_all')} checked={allChecked} onChange={(e) => setChecked(e.target.checked ? new Set(visible.map((role) => role.oid)) : new Set())} />
            <label htmlFor="usersForm_checkall">{tApp('check_all')}</label> <em className="with-selected">{tApp('with_selected')}</em>{' '}
            <button className="btn btn-link mult_submit" type="submit" name="submit_mult" value="export" title={t('actions.export')} onClick={(e) => { e.preventDefault(); exportRoles(selected()) }}>
              <Icon name="b_tblexport" /> {t('actions.export')}
            </button>
          </div>
        </div>

        <div className="clearfloat" />

        <div className="card mb-3">
          <div className="card-header">{t('new')}</div>
          <div className="card-body">
            <Link id="add_user_anchor" to={`${ROLES_PATH}/create`}>
              <Icon name="b_usradd" /> {t('add')}
            </Link>
          </div>
        </div>

        <div id="deleteUserCard" className="card mb-3">
          <div className="card-header">
            <Icon name="b_usrdrop" /> {t('remove.title')}
          </div>
          <div className="card-body">
            <p className="card-text">{t('remove.text')}</p>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="dropUsersDbCheckbox" name="drop_users_db" checked={dropDatabases} onChange={(e) => setDropDatabases(e.target.checked)} />
              <label className="form-check-label" htmlFor="dropUsersDbCheckbox">
                {t('remove.databases')}
              </label>
            </div>
          </div>
          <div className="card-footer text-end">
            <input id="buttonGo" className="btn btn-primary ajax" type="submit" name="delete" value={tApp('go')} onClick={(e) => { e.preventDefault(); void askDrop() }} />
          </div>
        </div>
      </form>

      <ConfirmQuery
        show={dropping !== null}
        sql={[...(dropping?.databases ?? []).map((database) => `DROP DATABASE ${quoteIdent(database.name)};`), ...(dropping?.roles ?? []).map((role) => `DROP ROLE ${quoteIdent(role.rolname)};`)]}
        confirmLabel={tApp('drop')}
        confirmClass="btn-danger"
        onClose={() => setDropping(null)}
        onConfirm={() => dropping && void drop(dropping)}
      />

      <Modal show={exported !== null} title={exported?.title ?? ''} size="lg" onClose={() => setExported(null)}>
        {exported?.sql === null ? tApp('loading') : <SqlView sql={exported?.sql ?? ''} />}
      </Modal>
    </div>
  )
}
