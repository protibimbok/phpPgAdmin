import type { SyntheticEvent } from 'react'
import i18next from 'i18next'
import { notify } from './notify'

/**
 * For a control whose feature is not built yet. phpMyAdmin never shows a disabled form, so the
 * control is rendered live and this answers its submit or click with a notice instead.
 */
export function notAvailable(event?: SyntheticEvent): void {
  event?.preventDefault()
  notify(i18next.t('not_available_yet'), 'notice')
}
