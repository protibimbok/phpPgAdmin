import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { useSession } from '@/session'

const DOCS_URL = 'https://protibimbok.github.io/phpPgAdmin/'
const POSTGRESQL_DOCS_URL = 'https://www.postgresql.org/docs/'

/**
 * phpMyAdmin's user account menu at the top end corner (base.twig #userAccountDropdown): a
 * small outlined button with the user icon opening the user@host, the documentation links and
 * "Log out". A Bootstrap dropdown driven by React state.
 */
export default function UserMenu() {
  const { t } = useTranslation()
  const { user, logout } = useSession()
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)

    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div id="userAccountDropdown" className="dropdown d-inline-block" ref={root}>
      <button className="btn btn-sm btn-outline-secondary dropdown-toggle py-0" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon name="user" title={t('user_menu.open')} />
      </button>
      {/* data-bs-popper=static: Bootstrap's own positioning, since Popper is not loaded. */}
      <ul className={`dropdown-menu dropdown-menu-end${open ? ' show' : ''}`} data-bs-popper="static">
        <li>
          <span className="dropdown-item-text text-nowrap">
            <Icon name="user" />{' '}
            <span dir="ltr">
              {user.username}@{user.server.host}
            </span>
          </span>
        </li>
        <li>
          <hr className="dropdown-divider" />
        </li>
        <li>
          <a className="dropdown-item" href={DOCS_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="b_docs" /> {t('documentation')}
          </a>
        </li>
        <li>
          <a className="dropdown-item" href={POSTGRESQL_DOCS_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="b_sqlhelp" /> {t('postgresql_documentation')}
          </a>
        </li>
        <li>
          <hr className="dropdown-divider" />
        </li>
        <li>
          <a
            className="dropdown-item logout"
            href="/"
            onClick={(e) => {
              e.preventDefault()
              void logout()
            }}
          >
            <Icon name="s_loggoff" /> {t('log_out')}
          </a>
        </li>
      </ul>
    </div>
  )
}
