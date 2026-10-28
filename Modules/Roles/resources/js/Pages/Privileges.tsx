import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessage } from '@/api/request'
import { useRequest } from '@/api/useRequest'
import ConfirmQuery from '@/components/ConfirmQuery'
import Icon from '@/components/Icon'
import { useLevel, type Level } from '@/level'
import { resolve } from '@/nodes/client'
import { notifyError, notifySuccess } from '@/notify'
import { objectPrivileges, privilegesSql, roleOptions, updatePrivileges, type Grantee, type ObjectPrivileges, type PrivilegeChange, type PrivilegeKind } from '../api'
import DefaultPrivileges from '../DefaultPrivileges'
import { grantSummary, privilegeList } from '../format'
import GrantWizard from '../GrantWizard'
import PrivilegesDialog from '../PrivilegesDialog'

/** The object a level's Privileges tab is about, by its OID. */
async function target(level: Level): Promise<{ kind: PrivilegeKind; oid: number; scid?: number }> {
  if (level.name === 'database') {
    return { kind: 'database', oid: (await resolve(null, 'database', { name: level.db! })).did }
  }
  if (level.name === 'schema') {
    const scid = (await resolve(level.db!, 'schema', { name: level.schema! })).scid

    return { kind: 'schema', oid: scid, scid }
  }
  const ids = await resolve(level.db!, level.kind ?? 'table', { schema: level.schema!, name: level.table! })

  return { kind: 'table', oid: ids.tid ?? ids.vid, scid: ids.scid }
}

interface Editing {
  grantee: string | null
  column?: string
}

/**
 * The Privileges tab of a database, schema, table or view, laid out like phpMyAdmin's
 * database/privileges/index.twig: "Roles having access to …" with each grantee's privileges,
 * whether it may grant them on, who granted them, and Edit privileges / Revoke; a table's
 * column privileges follow its own. Then the "New" fieldset, the default privileges (database
 * and schema) and the grant wizard (schema).
 */
export default function Privileges() {
  const { t } = useTranslation('roles')
  const { t: tApp } = useTranslation()
  const level = useLevel()
  const db = level.db ?? ''
  const { data, error } = useRequest(async () => {
    const object = await target(level)
    const [privileges, options] = await Promise.all([objectPrivileges(db, object.kind, object.oid), roleOptions()])

    return { object, privileges, roles: options.roles }
  }, [db, level.schema, level.table, level.kind])
  const [privileges, setPrivileges] = useState<ObjectPrivileges | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [revoking, setRevoking] = useState<{ change: PrivilegeChange; sql: string } | null>(null)

  useEffect(() => setPrivileges(null), [data])

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        {error.message}
      </div>
    )
  }

  if (!data) return null

  const { object, roles } = data
  const current = privileges ?? data.privileges
  const allowedFor = (column?: string) => (column === undefined ? current.allowed : (current.column_allowed ?? []))

  async function save(change: PrivilegeChange) {
    try {
      setPrivileges(await updatePrivileges(db, object.kind, object.oid, change))
      notifySuccess(t('privileges.updated', { grantee: change.grantee }))
      setEditing(null)
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  async function askRevoke(grantee: string, column?: string) {
    const change = { grantee, privileges: [], column }
    try {
      setRevoking({ change, sql: await privilegesSql(db, object.kind, object.oid, change) })
    } catch (err) {
      notifyError(errorMessage(err))
    }
  }

  const rows: { grantee: Grantee; column?: string }[] = [...current.acl.map((grantee) => ({ grantee })), ...(current.columns ?? []).flatMap((column) => column.acl.map((grantee) => ({ grantee, column: column.name })))]

  return (
    <div className="container-fluid my-3">
      <form id="usersForm" onSubmit={(e) => e.preventDefault()}>
        <div className="w-100">
          <fieldset className="pma-fieldset">
            <legend>
              <Icon name="b_usrcheck" /> {t('privileges.having_access', { name: current.object.name })}
            </legend>

            <div className="table-responsive jsresponsive">
              <table className="table table-striped table-hover w-auto">
                <thead>
                  <tr>
                    <th scope="col">{t('privileges.role')}</th>
                    <th scope="col">{t('privileges.type')}</th>
                    <th scope="col">{t('privileges.privileges')}</th>
                    <th scope="col">{t('privileges.grant')}</th>
                    <th scope="col">{t('privileges.grantor')}</th>
                    <th scope="col" colSpan={2}>
                      {t('columns.action')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7}>{t('privileges.none')}</td>
                    </tr>
                  )}
                  {rows.map(({ grantee, column }) => (
                    <tr key={`${column ?? ''}\u0000${grantee.grantee}`}>
                      <td>
                        {grantee.grantee === 'PUBLIC' ? <span className="text-danger">PUBLIC</span> : grantee.grantee}
                        {grantee.grantee === current.object.owner && column === undefined && <span className="text-muted"> ({t('privileges.owner')})</span>}
                      </td>
                      <td>{column === undefined ? t(`privileges.specific.${current.object.kind}`) : <>{t('privileges.column')}: <code>{column}</code></>}</td>
                      <td>
                        <code>{privilegeList(grantee.privileges, allowedFor(column))}</code>
                      </td>
                      <td>{grantSummary(grantee.privileges, tApp('yes'), tApp('no'))}</td>
                      <td>{grantee.grantors.join(', ')}</td>
                      <td>
                        <a className="edit_user_anchor" href="#edit" onClick={(e) => { e.preventDefault(); setEditing({ grantee: grantee.grantee, column }) }}>
                          <Icon name="b_usredit" /> {t('actions.edit')}
                        </a>
                      </td>
                      <td>
                        <a href="#revoke" onClick={(e) => { e.preventDefault(); void askRevoke(grantee.grantee, column) }}>
                          <Icon name="b_usrdrop" /> {t('privileges.revoke')}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        </div>
      </form>

      <div className="row">
        <div className="col-12">
          <fieldset className="pma-fieldset" id="fieldset_add_user">
            <legend>{t('new')}</legend>
            <a id="add_user_anchor" href="#add" onClick={(e) => { e.preventDefault(); setEditing({ grantee: null }) }}>
              <Icon name="b_usradd" /> {t('privileges.add')}
            </a>
            {current.columns && (
              <>
                {' '}
                <a href="#add-column" onClick={(e) => { e.preventDefault(); setEditing({ grantee: null, column: current.columns![0]?.name ?? '' }) }}>
                  <Icon name="b_usradd" /> {t('privileges.add_column')}
                </a>
              </>
            )}
          </fieldset>
        </div>
      </div>

      {object.kind !== 'table' && <DefaultPrivileges db={db} scid={object.kind === 'schema' ? object.scid : undefined} roles={roles} />}
      {object.kind === 'schema' && object.scid !== undefined && <GrantWizard db={db} scid={object.scid} roles={roles} />}

      <PrivilegesDialog
        key={editing?.column}
        show={editing !== null}
        title={editing?.grantee ? t('privileges.edit_title', { grantee: editing.grantee, name: editing.column ?? current.object.name }) : t('privileges.add')}
        grantee={editing?.grantee ?? null}
        roles={roles}
        allowed={allowedFor(editing?.column)}
        currentOf={(grantee) => (editing?.column === undefined ? current.acl : (current.columns?.find((c) => c.name === editing.column)?.acl ?? [])).find((g) => g.grantee === grantee)?.privileges ?? []}
        onPreview={(change) => privilegesSql(db, object.kind, object.oid, { ...change, column: editing?.column })}
        onSave={(change) => save({ ...change, column: editing?.column })}
        onClose={() => setEditing(null)}
      >
        {editing?.grantee === null && editing.column !== undefined && (
          <tr className="align-middle">
            <td>
              <label htmlFor="select_column">{t('privileges.column')}</label>
            </td>
            <td>
              <select id="select_column" value={editing.column} onChange={(e) => setEditing({ ...editing, column: e.target.value })}>
                {(current.columns ?? []).map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
            </td>
          </tr>
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
    </div>
  )
}
