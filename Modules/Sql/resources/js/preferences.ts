import { registerPreferenceGroups, registerPreferences } from '@/preferences'

/** The SQL module's settings: the rows a result shows, DROP confirmation, the history kept, and the console's options. */
export const MAX_ROWS = 'main.max_rows'
export const CONFIRM = 'features.confirm'
export const QUERY_HISTORY_MAX = 'sql.query_history_max'
export const CONSOLE_ALWAYS_EXPAND = 'console.always_expand'
export const CONSOLE_START_HISTORY = 'console.start_history'
export const CONSOLE_ENTER_EXECUTES = 'console.enter_executes'
export const CONSOLE_HEIGHT = 'console.height'
/** phpMyAdmin's LimitChars and ShowBrowseComments: how much of a long value a grid shows, and the column comments under the headers. */
export const LIMIT_CHARS = 'browse.limit_chars'
export const SHOW_BROWSE_COMMENTS = 'browse.show_comments'

registerPreferenceGroups([
  { page: 'features', id: 'general', label: 'settings:groups.general', description: 'settings:groups.general_help' },
  { page: 'features', id: 'console', label: 'settings:groups.console', description: 'settings:groups.console_help' },
  { page: 'sql', id: 'queries', label: 'settings:groups.sql_queries', description: 'settings:groups.sql_queries_help' },
  { page: 'main-panel', id: 'browse', label: 'settings:groups.browse', description: 'settings:groups.browse_help' },
])

registerPreferences([
  { key: CONFIRM, type: 'boolean', default: true, page: 'features', group: 'general', label: 'settings:features.confirm', description: 'settings:features.confirm_help' },
  { key: CONSOLE_ALWAYS_EXPAND, type: 'boolean', default: false, page: 'features', group: 'console', label: 'settings:console.always_expand', description: 'settings:console.always_expand_help' },
  { key: CONSOLE_START_HISTORY, type: 'boolean', default: false, page: 'features', group: 'console', label: 'settings:console.start_history', description: 'settings:console.start_history_help' },
  { key: CONSOLE_ENTER_EXECUTES, type: 'boolean', default: false, page: 'features', group: 'console', label: 'settings:console.enter_executes', description: 'settings:console.enter_executes_help' },
  { key: CONSOLE_HEIGHT, type: 'number', default: 92, min: 32, page: 'features', group: 'console', label: 'settings:console.height', description: 'settings:console.height_help' },
  { key: QUERY_HISTORY_MAX, type: 'number', default: 500, min: 1, max: 500, page: 'sql', group: 'queries', label: 'settings:sql.query_history_max', description: 'settings:sql.query_history_max_help' },
  { key: MAX_ROWS, type: 'number', default: 25, min: 1, page: 'main-panel', group: 'browse', label: 'settings:main.max_rows', description: 'settings:main.max_rows_help' },
  { key: LIMIT_CHARS, type: 'number', default: 50, min: 1, page: 'main-panel', group: 'browse', label: 'settings:main.limit_chars', description: 'settings:main.limit_chars_help' },
  { key: SHOW_BROWSE_COMMENTS, type: 'boolean', default: true, page: 'main-panel', group: 'browse', label: 'settings:main.show_comments', description: 'settings:main.show_comments_help' },
])

/**
 * Whether a statement asks to be confirmed before it runs, after phpMyAdmin's confirmQuery:
 * a DROP, an ALTER TABLE … DROP, a DELETE, a TRUNCATE, or an UPDATE without WHERE.
 */
export function isDestructive(sql: string): boolean {
  const text = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')

  return text.split(';').some((statement) => {
    const s = statement.trim()

    return (
      /^DROP\s/i.test(s) ||
      /^ALTER\s+TABLE\s+(IF\s+EXISTS\s+)?(ONLY\s+)?("[^"]+"|[\w$.]+)(\s*\.\s*("[^"]+"|[\w$]+))?\s+DROP\s/i.test(s) ||
      /^DELETE\s+FROM\s/i.test(s) ||
      /^TRUNCATE\s/i.test(s) ||
      (/^UPDATE\s/i.test(s) && !/\bWHERE\b/i.test(s))
    )
  })
}
