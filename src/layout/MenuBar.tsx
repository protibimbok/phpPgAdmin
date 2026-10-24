import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router'
import Icon from '@/components/Icon'
import { activeMenuPath, getMenu } from '@/modular'
import { useSession } from '@/session'

/**
 * The bar above the page, as phpMyAdmin draws it: the breadcrumb naming the server, then
 * the tabs the modules registered, the one covering the current page lit up.
 */
export default function MenuBar() {
  const { user } = useSession()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const menu = useMemo(() => getMenu(), [])
  // Tab labels are "namespace:key"; load every namespace they name along with the app's own.
  const namespaces = useMemo(() => ['app', ...new Set(menu.map((item) => item.label.split(':')[0]))], [menu])
  const { t } = useTranslation(namespaces)
  const active = activeMenuPath(pathname, menu)

  return (
    <>
      <nav id="server-breadcrumb" aria-label="breadcrumb">
        <ol className="breadcrumb breadcrumb-navbar">
          <li className="breadcrumb-item">
            <Icon name="s_host" />{' '}
            <Link to="/" draggable={false}>
              {t('server')} {user.server.host}:{user.server.port}
            </Link>
          </li>
        </ol>
      </nav>

      <div id="topmenucontainer" className="menucontainer">
        <nav className="navbar navbar-expand-lg bg-light">
          <button
            className="navbar-toggler"
            type="button"
            aria-label={t('toggle_navigation')}
            aria-controls="navbarNav"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="navbar-toggler-icon" />
          </button>
          <div className={`collapse navbar-collapse${open ? ' show' : ''}`} id="navbarNav">
            <ul id="topmenu" className="navbar-nav">
              {menu.map((item) => (
                <li key={item.path} className={`nav-item${item.path === active ? ' active' : ''}`}>
                  <Link className="nav-link text-nowrap" to={item.path} onClick={() => setOpen(false)}>
                    <Icon name={item.icon} />
                    {t(item.label)}
                    {item.path === active && <span className="visually-hidden"> {t('current')}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </nav>
      </div>
    </>
  )
}
