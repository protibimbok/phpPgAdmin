import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import { useRequest } from '@/api/useRequest'
import Icon from '@/components/Icon'
import Modal from '@/components/Modal'
import { objectPrivileges, roleOptions, type PrivilegeKind } from './api'
import { ObjectPrivilegesPanel } from './Pages/Privileges'

/** The anchor an object's Privileges link points at: its editor's privileges, scrolled to. */
export const PRIVILEGES_HASH = '#privileges'

/**
 * The privileges of one object (a sequence, routine, type, language, foreign data wrapper,
 * foreign server or foreign table), loaded by its OID and shown as on the Privileges tabs:
 * the grantees with Edit privileges / Revoke, then Add privileges for a role. Arriving with
 * #privileges in the address scrolls to it, which is where a list's Privileges link leads.
 */
export default function PrivilegesSection({ db, kind, oid }: { db: string; kind: PrivilegeKind; oid: number }) {
  const { hash } = useLocation()
  const root = useRef<HTMLDivElement>(null)
  const { data, error } = useRequest(() => Promise.all([objectPrivileges(db, kind, oid), roleOptions()]), [db, kind, oid])

  useEffect(() => {
    if (data && hash === PRIVILEGES_HASH) root.current?.scrollIntoView()
  }, [data, hash])

  return (
    <div id="privileges" className="mt-3" ref={root}>
      {error && (
        <div className="alert alert-danger" role="alert">
          {error.message}
        </div>
      )}
      {data && <ObjectPrivilegesPanel db={db} kind={kind} oid={oid} initial={data[0]} roles={data[1].roles} />}
    </div>
  )
}

/** A list row's "Privileges" action, phpMyAdmin's s_rights link, to the object's editor. */
export function PrivilegesLink({ to }: { to: string }) {
  const { t } = useTranslation('roles')

  return (
    <Link className="privileges_anchor" to={`${to}${PRIVILEGES_HASH}`}>
      <Icon name="s_rights" /> {t('privileges.tab')}
    </Link>
  )
}

/** A list row's "Privileges" action for an object with no editor page of its own: opens them in a dialog. */
export function PrivilegesAction({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation('roles')

  return (
    <a className="ajax privileges_anchor" href={PRIVILEGES_HASH} onClick={(e) => { e.preventDefault(); onClick() }}>
      <Icon name="s_rights" /> {t('privileges.tab')}
    </a>
  )
}

/** The privileges of an object that has no page of its own, in a dialog over its list. */
export function PrivilegesModal({ db, target, onClose }: { db: string; target: { kind: PrivilegeKind; oid: number; name: string } | null; onClose: () => void }) {
  const { t } = useTranslation('roles')

  return (
    <Modal show={target !== null} title={target ? t('privileges.of', { name: target.name }) : ''} size="xl" onClose={onClose} id="privilegesModal">
      {target && <PrivilegesSection key={`${target.kind}:${target.oid}`} db={db} kind={target.kind} oid={target.oid} />}
    </Modal>
  )
}
