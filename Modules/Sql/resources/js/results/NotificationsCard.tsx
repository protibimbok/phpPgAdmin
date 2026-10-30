import { useTranslation } from 'react-i18next'
import Icon from '@/components/Icon'
import { useNotifications } from '../querySession'

/**
 * pgAdmin's Notifications tab of the query tool: what NOTIFY sent to the channels the page's
 * session LISTENs on (recorded time, event, process ID, payload), newest first, while it
 * listens or has received any. The session is asked every two seconds while it listens.
 */
export default function NotificationsCard({ db }: { db: string | null }) {
  const { t } = useTranslation('sql')
  const { notifications, channels, clear } = useNotifications(db)
  if (channels.length === 0 && notifications.length === 0) return null

  return (
    <div className="card mb-3" id="sql_notifications">
      <div className="card-header d-flex align-items-center">
        <span className="me-auto">
          <Icon name="s_notice" /> {t('notifications.title')}
        </span>
        {notifications.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" id="clear_notifications" onClick={clear}>
            {t('notifications.clear')}
          </button>
        )}
      </div>
      <div className="card-body">
        <p className="card-text">{channels.length > 0 ? t('notifications.listening', { channels: channels.join(', ') }) : t('notifications.not_listening')}</p>
        {notifications.length === 0 ? (
          <p className="card-text text-muted mb-0">{t('notifications.none')}</p>
        ) : (
          <table className="table table-striped table-sm w-auto mb-0">
            <thead>
              <tr>
                <th>{t('notifications.recorded')}</th>
                <th>{t('notifications.event')}</th>
                <th>{t('notifications.pid')}</th>
                <th>{t('notifications.payload')}</th>
              </tr>
            </thead>
            <tbody>
              {[...notifications].reverse().map((n, i) => (
                <tr key={notifications.length - i}>
                  <td className="text-nowrap">{new Date(n.received_at).toLocaleString()}</td>
                  <td>{n.channel}</td>
                  <td>{n.pid}</td>
                  <td style={{ whiteSpace: 'pre-wrap' }}>{n.payload}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
