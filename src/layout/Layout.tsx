import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router'
import Icon from '@/components/Icon'
import { getModules } from '@/modular'
import MenuBar from './MenuBar'
import Navigation from './Navigation'
import { NavigationTree } from './NavigationTree'
import Notifications from './Notifications'
import UserMenu from './UserMenu'

/**
 * phpMyAdmin's page frame: the navigation panel on the start edge, the breadcrumb and the
 * menu bar across the top, the page in between, the "open in a new window" link below.
 */
export default function Layout() {
  const { t } = useTranslation()
  const { pathname, search } = useLocation()

  return (
    <NavigationTree.Provider>
      <Navigation />
      <MenuBar />

      {/* phpMyAdmin's top end corner (#page_nav_icons): the user menu and the "scroll to top"
          link, inline inside the breadcrumb bar's height. */}
      <div id="page_nav_icons" className="d-print-none">
        <UserMenu />{' '}
        <a
            id="goto_pagetop"
            href="#top"
            title={t('go_to_top')}
            onClick={(e) => {
              e.preventDefault()
              window.scrollTo({ top: 0 })
            }}
          >
          <Icon name="s_top" title={t('go_to_top')} />
        </a>
      </div>

      <div id="page_content">
        <Notifications />
        <Outlet />
      </div>

      <div id="selflink" className="d-print-none">
        <a href={pathname + search} title={t('open_new_window')} target="_blank" rel="noopener noreferrer">
          <Icon name="window-new" title={t('open_new_window')} />
        </a>
      </div>

      {/* Inside the slot providers and always mounted, so a module can fill a spot no page of its own owns. */}
      {getModules().map((module) => (
        <Fragment key={module.id}>{module.fills}</Fragment>
      ))}
    </NavigationTree.Provider>
  )
}
