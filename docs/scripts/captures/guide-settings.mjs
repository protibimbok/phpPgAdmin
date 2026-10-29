// The server Settings tab: screenshots for docs/server/settings.md and a check that each setting
// changes what it says it changes. Runs as the scratch role guide_user (guide-common.mjs), whose
// preferences are its own, so the postgres role's settings are never touched.
//
//   node docs/scripts/captures/guide-settings.mjs

import fs from 'node:fs'
import { APP, done, settle, shot } from '../capture.mjs'
import { createGuideUser, dropGuideUser, openAs, sqlite, ROLE } from './guide-common.mjs'

const log = (...a) => console.log('[check]', ...a)
const prefs = () => sqlite(`SELECT key || '=' || value FROM preferences WHERE username = '${ROLE}' ORDER BY key`).split('\n').filter(Boolean)

dropGuideUser()
createGuideUser()
const { page, close } = await openAs('/server/settings')

/** Clicks `selector` and returns the notification it brings up. */
async function act(selector) {
  await page.locator('#loading_parent .ajax_notification').click({ timeout: 1000 }).catch(() => {})
  await page.click(selector)
  return notice()
}

async function notice() {
  await page.waitForSelector('#loading_parent .ajax_notification', { timeout: 5000 }).catch(() => {})
  return (await page.locator('#loading_parent').textContent()).trim()
}

/** Opens a Settings page and group tab, sets the fields and applies. */
async function apply(pageId, tab, fields) {
  await page.goto(`${APP}/server/settings/${pageId}`); await settle(page)
  if (tab) await page.click(`#${tab}-tab`)
  for (const [id, value] of Object.entries(fields)) {
    if (typeof value === 'boolean') await page.setChecked(`#${id}`, value)
    else if (await page.locator(`select#${id}`).count()) await page.selectOption(`#${id}`, value)
    else await page.fill(`#${id}`, String(value))
  }
  return act('.tab-pane.active input[name=submit_save]')
}

// Manage your settings
await shot(page, 'guide/settings-manage.png', { selector: '#page_content > .container-fluid' })

// Features page
await page.goto(`${APP}/server/settings/features`); await settle(page)
await shot(page, 'guide/settings-features.png', { selector: '.config-form' })

// --- Confirm DROP queries ------------------------------------------------------------------
async function runSql(sql) {
  await page.goto(`${APP}/db/postgres/sql`); await settle(page)
  await page.click('#sqlquery')
  await page.keyboard.press('Control+A'); await page.keyboard.press('Delete')
  await page.keyboard.type(sql)
  await page.keyboard.press('Control+Enter')
  await settle(page, 800)
}
await runSql('DROP TABLE IF EXISTS guide_nothing')
log('confirm on: dialog shown =', await page.locator('#confirm_dialog').isVisible().catch(() => false))
await shot(page, 'guide/confirm-dialog.png', { selector: '#confirm_dialog .modal-content' })
await page.click('#confirm_dialog .submitCancel')
log('apply confirm off:', await apply('features', 'general', { 'features_confirm': false }))
await runSql('DROP TABLE IF EXISTS guide_nothing')
log('confirm off: dialog shown =', await page.locator('#confirm_dialog').isVisible().catch(() => false), '| result:', (await page.locator('#page_content .alert, #page_content .result_query').first().textContent().catch(() => '')).slice(0, 120))
log('prefs:', prefs())

// --- Main panel: Number of rows -----------------------------------------------------------
log('invalid number:', await apply('main-panel', 'browse', { 'main_max_rows': 0 }))
log('empty number:', await apply('main-panel', 'browse', { 'main_max_rows': '' }))
log('apply max rows 5:', await apply('main-panel', 'browse', { 'main_max_rows': 5 }))
await runSql('SELECT generate_series(1, 40) AS n')
log('max rows 5: grid rows =', await page.locator('table.table_results tbody tr').count())

// --- SQL queries: Query history length ------------------------------------------------------
log('apply history 2:', await apply('sql', 'queries', { 'sql_query_history_max': 2 }))
for (const n of [1, 2, 3]) await runSql(`SELECT ${n}`)
log('history rows kept =', sqlite(`SELECT count(*) FROM query_history WHERE username = '${ROLE}'`))
log('invalid history 501:', await apply('sql', 'queries', { 'sql_query_history_max': 501 }))

// --- Navigation panel ----------------------------------------------------------------------
log('apply tree limits:', await apply('navigation', 'tree', { 'navigation_first_level_items': 1, 'navigation_max_items': 2, 'navigation_filter_minimum': 2 }))
await page.goto(`${APP}/db/bookshop`); await settle(page, 1200)
log('first level: page selector =', await page.locator('#pma_navigation_tree_content > ul > li .pageselector').count(), '| fast filter =', await page.locator('#pma_navigation_tree_content > ul > li.db_fast_filter').count())
await page.locator('#pma_navigation_tree_content li.database:has(> a.hover_show_full:text-is("bookshop")) > .block a.expander').click()
await settle(page, 1000)
await page.locator('li.schemasContainer > .block a.expander').first().click()
await settle(page, 1200)
log('schemas branch: page selector =', await page.locator('li.schemasContainer .pageselector').count(), '| fast filter =', await page.locator('li.schemasContainer .fast_filter').count())
await page.fill('#pma_navigation_tree_content > ul > li.db_fast_filter input', 'book')
await settle(page, 300)
log('filter "book": databases shown =', await page.$$eval('#pma_navigation_tree_content > ul > li.database > a.hover_show_full', (els) => els.map((e) => e.textContent)))
await page.fill('#pma_navigation_tree_content > ul > li.db_fast_filter input', '')
await settle(page, 300)
await shot(page, 'guide/tree-paging.png', { selector: '#pma_navigation_tree_content > ul', pad: 4 })

// The row's "Restore default value" link, then Apply.
await page.goto(`${APP}/server/settings/navigation`); await settle(page)
await shot(page, 'guide/settings-navigation.png', { selector: '.config-form' })
for (const id of ['navigation_first_level_items', 'navigation_max_items', 'navigation_filter_minimum']) await page.click(`a.restore-default[href="#${id}"]`)
log('restore defaults:', await act('.tab-pane.active input[name=submit_save]'))

// --- Features: Console ---------------------------------------------------------------------
log('apply console:', await apply('features', 'console', { 'console_start_history': true, 'console_enter_executes': true, 'console_height': 200 }))
await page.goto(`${APP}/db/postgres`); await settle(page)
await page.click('#pma_console .console_switch'); await settle(page, 800)
log('console: history active =', await page.locator('#pma_console .button.history.active').count(), '| content height =', await page.$eval('#pma_console .content', (e) => e.style.height), '| welcome =', await page.locator('#pma_console .console_message_container .message.welcome').textContent())
await page.click('#pma_console .console_query_input .cm-content')
await page.keyboard.type('SELECT 42')
await page.keyboard.press('Enter'); await settle(page, 1000)
log('console Enter: url =', decodeURIComponent(page.url()), '| last history entry =', sqlite(`SELECT sql FROM query_history WHERE username = '${ROLE}' ORDER BY id DESC LIMIT 1`))

log('apply always expand:', await apply('features', 'console', { 'console_always_expand': true }))
await page.goto(`${APP}/db/postgres`); await settle(page)
await page.click('#pma_console .console_switch'); await settle(page, 1000)
log('console messages: expanded =', await page.locator('#pma_console .message.history.expanded').count(), '| collapsed =', await page.locator('#pma_console .message.history.collapsed').count())

// --- Export and Import defaults ----------------------------------------------------------
log('apply export:', await apply('export', 'defaults', { 'export_method': 'custom', 'export_format': 'custom', 'export_compression': 'gzip' }))
await page.goto(`${APP}/db/postgres/export`); await settle(page, 1000)
log('export page: custom =', await page.isChecked('#radio_custom_export'), '| format =', await page.inputValue('#plugins'), '| compression =', await page.inputValue('#compression').catch(() => 'n/a'))
await page.goto(`${APP}/server/export`); await settle(page, 1000)
log('server export: format =', await page.inputValue('#plugins').catch(() => 'n/a'))
log('apply import:', await apply('import', 'defaults', { 'import_charset': 'latin1', 'import_stop_on_error': false }))
await page.goto(`${APP}/db/postgres/import`); await settle(page, 1000)
log('import page: charset =', await page.inputValue('#charset_of_file'), '| stop on error =', await page.isChecked('input[name=stop_on_error]').catch(() => 'n/a'))

// --- Manage: export, browser storage, import, merge, reset ----------------------------------
log('prefs before manage:', prefs())
await page.goto(`${APP}/server/settings`); await settle(page)
const [download] = await Promise.all([page.waitForEvent('download'), page.click('form[name=prefs_export] input[name=submit_export]')])
const exported = fs.readFileSync(await download.path(), 'utf8')
log('export file', download.suggestedFilename(), exported.replace(/\s+/g, ' '))
await page.check('#export_local_storage'); log('save to browser:', await act('form[name=prefs_export] input[name=submit_export]'))
log('browser storage:', await page.evaluate(() => localStorage.getItem('phppgadmin.settings')))
log('reset:', await act('form[name=prefs_reset] input[name=submit_clear]'), prefs())
await page.check('#import_local_storage'); log('import from browser:', await act('form[name=prefs_import] input[name=submit_import]'), page.url(), prefs())
// A file with one setting, merged: the others keep their values.
const one = `${process.env.TMPDIR ?? '/tmp'}/guide-settings-one.json`
fs.writeFileSync(one, JSON.stringify({ 'main.max_rows': 7, 'unknown.key': 1, 'navigation.max_items': 'x' }))
await page.goto(`${APP}/server/settings`); await settle(page)
await page.setInputFiles('#input_import_file', one); await page.check('#import_merge')
log('import merged:', await act('form[name=prefs_import] input[name=submit_import]'), prefs())
await page.goto(`${APP}/server/settings`); await settle(page)
await page.setInputFiles('#input_import_file', one)
log('import replace:', await act('form[name=prefs_import] input[name=submit_import]'), prefs())
fs.writeFileSync(one, '[1,2]')
await page.goto(`${APP}/server/settings`); await settle(page)
await page.setInputFiles('#input_import_file', one)
log('import invalid:', await act('form[name=prefs_import] input[name=submit_import]'))
await page.goto(`${APP}/server/settings`); await settle(page)
log('import without a file:', await act('form[name=prefs_import] input[name=submit_import]'))
fs.rmSync(one)
// Reset leaves the language alone.
await page.goto(`${APP}/`); await settle(page)
await page.selectOption('#languageSelect', 'ar'); await settle(page, 800)
await page.goto(`${APP}/server/settings`); await settle(page)
log('reset with language:', await act('form[name=prefs_reset] input[name=submit_clear]'), prefs())
await page.evaluate(() => fetch('/api/i18n/locale', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"locale":"en"}' }))

await close()
dropGuideUser()
await done()
