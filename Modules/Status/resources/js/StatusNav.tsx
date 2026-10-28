import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router'
import { notAvailable } from '@/unbuilt'

const PAGES = [
  { key: 'server', path: '/server/status' },
  { key: 'processes', path: '/server/status/processes' },
  { key: 'locks', path: null },
  { key: 'prepared', path: null },
  { key: 'monitor', path: '/server/status/monitor' },
] as const

/** The pills above every Status page, as phpMyAdmin's server/status/base.twig lays them out. */
export default function StatusNav() {
  const { t } = useTranslation('status')

  return (
    <div className="row">
      <ul className="nav nav-pills p-2">
        {PAGES.map((page) => (
          <li className="nav-item" key={page.key}>
            {page.path === null ? (
              <a href={`#${page.key}`} className="nav-link disableAjax" onClick={notAvailable}>
                {t(`nav.${page.key}`)}
              </a>
            ) : (
              <NavLink to={page.path} end className={({ isActive }) => `nav-link${isActive ? ' active' : ''} disableAjax`}>
                {t(`nav.${page.key}`)}
              </NavLink>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** phpMyAdmin's refresh-rate option text: "5 seconds", "1 minute", "20 minutes". */
export function rateLabel(t: (key: string, options?: Record<string, unknown>) => string, seconds: number): string {
  return seconds < 60 ? t('rate.seconds', { count: seconds }) : t('rate.minutes', { count: seconds / 60 })
}
