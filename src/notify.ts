/**
 * Messages shown at the top of the page the way phpMyAdmin's ajaxShowMessage() shows them:
 * one at a time, in a floating box, gone after a few seconds unless they report an error.
 */
export type NotificationType = 'notice' | 'success' | 'warning' | 'error'

export interface Notification {
  id: number
  message: string
  type: NotificationType
  /** Milliseconds before it disappears; null keeps it until dismissed or replaced. */
  timeout: number | null
}

type Listener = (notification: Notification | null) => void

const listeners = new Set<Listener>()
let current: Notification | null = null
let count = 0

function emit(notification: Notification | null): void {
  current = notification
  for (const listener of listeners) listener(notification)
}

/** Show a message. Errors stay until dismissed; everything else goes after five seconds. */
export function notify(message: string, type: NotificationType = 'notice', timeout?: number | null): Notification {
  const notification: Notification = {
    id: ++count,
    message,
    type,
    timeout: timeout === undefined ? (type === 'error' ? null : 5000) : timeout,
  }
  emit(notification)

  return notification
}

export function notifySuccess(message: string): Notification {
  return notify(message, 'success')
}

export function notifyError(message: string): Notification {
  return notify(message, 'error')
}

/** Remove the message, if it is still the one shown. */
export function dismiss(notification?: Notification): void {
  if (!notification || current?.id === notification.id) emit(null)
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  listener(current)

  return () => {
    listeners.delete(listener)
  }
}
