import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { dismiss, subscribe, type Notification } from '@/notify'

/**
 * The floating message box phpMyAdmin puts at the top of the page content (#loading_parent >
 * .ajax_notification): a plain yellow note, or a Bootstrap alert for successes, warnings and
 * errors. Clicking it dismisses it.
 */
export default function Notifications() {
  const { t } = useTranslation()
  const [notification, setNotification] = useState<Notification | null>(null)

  useEffect(() => subscribe(setNotification), [])

  useEffect(() => {
    if (!notification || notification.timeout === null) return
    const timer = window.setTimeout(() => dismiss(notification), notification.timeout)

    return () => window.clearTimeout(timer)
  }, [notification])

  if (!notification) return <div id="loading_parent" />

  const alert = { success: 'alert-success', warning: 'alert-warning', error: 'alert-danger' }[notification.type as 'success' | 'warning' | 'error']

  return (
    <div id="loading_parent">
      <span
        className={`ajax_notification${notification.type === 'notice' ? '' : ' ajax_notification_alert'}`}
        role="status"
        title={t('dismiss_notification')}
        onClick={() => dismiss(notification)}
      >
        {alert ? (
          <div className={`alert ${alert} mb-0`} role="alert">
            {notification.message}
          </div>
        ) : (
          notification.message
        )}
      </span>
    </div>
  )
}
