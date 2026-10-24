import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import Icon from '@/components/Icon'
import { useLocale } from '@/i18n/useLocale'
import logo from '@/img/logo-left.svg'
import { useSession } from '@/session'
import { NavigationTree } from './NavigationTree'
import { bindTreeState } from './tree/treeState'

const DEFAULT_WIDTH = 240
const DOCS_URL = 'https://github.com/protibimbok/phpPgAdmin#readme'
const POSTGRESQL_DOCS_URL = 'https://www.postgresql.org/docs/'

/**
 * The navigation panel, laid out like phpMyAdmin's: fixed to the start edge, the logo and
 * the panel links on top, the tree underneath, a handle to drag it wider and a tab to collapse
 * it. Its width is published as --pga-nav-width, which the stylesheet lays the page out from.
 */
export default function Navigation() {
  const { t } = useTranslation()
  const { user, logout } = useSession()
  // The remembered tree belongs to one server and user, as phpMyAdmin's does.
  bindTreeState(`${user.username}@${user.server.id ?? `${user.server.host}:${user.server.port}`}`)
  const { locale } = useLocale()
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const lastWidth = useRef(DEFAULT_WIDTH)
  const collapsed = width === 0

  useEffect(() => {
    document.documentElement.style.setProperty('--pga-nav-width', `${width}px`)

    return () => {
      document.documentElement.style.removeProperty('--pga-nav-width')
    }
  }, [width])

  function toggle() {
    if (collapsed) {
      setWidth(lastWidth.current)
    } else {
      lastWidth.current = width
      setWidth(0)
    }
  }

  function resize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    const origin = event.clientX
    const start = width
    const rtl = locale.dir === 'rtl'

    const move = (e: MouseEvent) => {
      const delta = rtl ? origin - e.clientX : e.clientX - origin
      setWidth(Math.max(0, Math.min(window.innerWidth - 50, start + delta)))
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  // The arrow points the way the panel will move, which depends on the edge it sits on.
  const arrow = (locale.dir === 'rtl') === collapsed ? '←' : '→'

  return (
    <div id="pma_navigation" className="d-print-none">
      <div id="pma_navigation_resizer" onMouseDown={resize} />
      <button
        type="button"
        id="pma_navigation_collapser"
        className={collapsed ? 'collapsed' : undefined}
        onClick={toggle}
        title={collapsed ? t('expand_navigation') : t('collapse_navigation')}
      >
        {arrow}
      </button>
      <div id="pma_navigation_content">
        <div id="pma_navigation_header">
          <div id="pmalogo">
            <Link to="/">
              <img id="imgpmalogo" src={logo} alt="phpPgAdmin" width={165} height={28} />
            </Link>
          </div>

          <div id="navipanellinks">
            <Link to="/" title={t('home')}>
              <Icon name="b_home" title={t('home')} />
            </Link>{' '}
            <a
              href="/"
              className="logout"
              title={t('log_out')}
              onClick={(e) => {
                e.preventDefault()
                void logout()
              }}
            >
              <Icon name="s_loggoff" title={t('log_out')} />
            </a>{' '}
            <a href={DOCS_URL} title={t('documentation')} target="_blank" rel="noopener noreferrer">
              <Icon name="b_docs" title={t('documentation')} />
            </a>{' '}
            <a href={POSTGRESQL_DOCS_URL} title={t('postgresql_documentation')} target="_blank" rel="noopener noreferrer">
              <Icon name="b_sqlhelp" title={t('postgresql_documentation')} />
            </a>
          </div>
        </div>

        <div id="pma_navigation_tree" className="list_container">
          <NavigationTree.Outlet id="pma_navigation_tree_content" />
        </div>
      </div>
    </div>
  )
}
