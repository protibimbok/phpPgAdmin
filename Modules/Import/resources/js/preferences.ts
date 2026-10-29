import { registerPreferenceGroups, registerPreferences } from '@/preferences'

/** The Import page's defaults, on the Import settings page: the file's character set and stopping at the first error. */
export const CHARSET = 'import.charset'
export const STOP_ON_ERROR = 'import.stop_on_error'

registerPreferenceGroups([{ page: 'import', id: 'defaults', label: 'settings:groups.import_defaults', description: 'settings:groups.import_defaults_help' }])

registerPreferences([
  { key: CHARSET, type: 'text', default: 'UTF8', page: 'import', group: 'defaults', label: 'settings:import.charset', description: 'settings:import.charset_help' },
  { key: STOP_ON_ERROR, type: 'boolean', default: true, page: 'import', group: 'defaults', label: 'settings:import.stop_on_error', description: 'settings:import.stop_on_error_help' },
])
