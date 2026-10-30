import { registerPreferenceGroups, registerPreferences } from '@/preferences'

/** The Export page's defaults, on the Export settings page: the method, the format and the compression it starts with. */
export const METHOD = 'export.method'
export const FORMAT = 'export.format'
export const COMPRESSION = 'export.compression'

registerPreferenceGroups([{ page: 'export', id: 'defaults', label: 'settings:groups.export_defaults', description: 'settings:groups.export_defaults_help' }])

registerPreferences([
  {
    key: METHOD,
    type: 'select',
    default: 'quick',
    page: 'export',
    group: 'defaults',
    label: 'settings:export.method',
    description: 'settings:export.method_help',
    options: [
      { value: 'quick', label: 'settings:export.method_quick' },
      { value: 'custom', label: 'settings:export.method_custom' },
    ],
  },
  {
    key: FORMAT,
    type: 'select',
    default: 'plain',
    page: 'export',
    group: 'defaults',
    label: 'settings:export.format',
    description: 'settings:export.format_help',
    options: [
      { value: 'plain', label: 'export:format.plain' },
      { value: 'custom', label: 'export:format.custom' },
      { value: 'tar', label: 'export:format.tar' },
      { value: 'csv', label: 'export:format.csv' },
      { value: 'excel', label: 'export:format.excel' },
      { value: 'tsv', label: 'export:format.tsv' },
      { value: 'html', label: 'export:format.html' },
      { value: 'xml', label: 'export:format.xml' },
    ],
  },
  {
    key: COMPRESSION,
    type: 'select',
    default: 'none',
    page: 'export',
    group: 'defaults',
    label: 'settings:export.compression',
    options: [
      { value: 'none', label: 'settings:export.compression_none' },
      { value: 'gzip', label: 'settings:export.compression_gzip' },
    ],
  },
])
