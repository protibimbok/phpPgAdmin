// Screenshots and a clip for docs/tools/console.md and docs/tools/history-bookmarks.md: the console
// and its cards, the bookmark cards of the SQL page, the Macros menu and dialog.
// Bookmarks, macros and preferences are shared state: everything made here is removed at the end,
// and the console height is put back to what it was.
// Run: node docs/scripts/captures/sql-console.mjs   (SKIP_CLIPS=1 leaves the clip alone)
import { done, settle } from '../capture.mjs'
import { api, go, openRetry, recordClip, setSql, snap } from './sql-common.mjs'

const made = { bookmarks: [], macros: [] }
let heightBefore = null

const { page, close } = await openRetry('/db/bookshop/sql')
try {
  heightBefore = (await api(page, 'GET', '/api/preferences'))?.preferences?.['console.height'] ?? null
  await api(page, 'PATCH', '/api/preferences', { 'console.height': 300 })

  // A few statements so the newest history entries are these.
  await page.check('#retain_query_box')
  for (const sql of ['SELECT count(*) FROM books', "SELECT title FROM books WHERE title ILIKE '%guards%'", 'SELECT nope FROM authors', 'UPDATE sql_none SET x = 1']) {
    await setSql(page, sql)
    await go(page)
  }

  made.bookmarks.push((await api(page, 'POST', '/api/query/bookmarks', { database: 'bookshop', label: 'Books under 15', sql: 'SELECT title, price FROM books WHERE price < 15 ORDER BY price', shared: false })).bookmark.id)
  made.bookmarks.push((await api(page, 'POST', '/api/query/bookmarks', { database: 'bookshop', label: 'Stock by warehouse', sql: 'SELECT warehouse_id, sum(quantity) FROM inventory.stock GROUP BY 1', shared: true })).bookmark.id)
  made.macros.push((await api(page, 'POST', '/api/query/macros', { name: 'Active sessions', sql: 'SELECT pid, usename, state, query FROM pg_stat_activity', key: 'Alt+F1' })).macro.id)
  made.macros.push((await api(page, 'POST', '/api/query/macros', { name: 'Table sizes', sql: "SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relkind = 'r' ORDER BY pg_total_relation_size(oid) DESC LIMIT 10", key: null })).macro.id)

  await page.reload()
  await settle(page, 800)

  // The SQL page's bookmark card and the Macros menu and dialog.
  await page.selectOption('#id_bookmark', { label: 'Stock by warehouse (shared)' })
  await snap(page, 'sql/bookmarked-card.png', 'form:has(#id_bookmark)')
  await page.fill('#bkm_label', 'Top prices')
  await snap(page, 'sql/bookmark-label.png', '#sqlqueryform .card-body > .row:last-child')
  await page.fill('#bkm_label', '')
  await page.click('#macros')
  await snap(page, 'sql/macros-menu.png', '#macros + .dropdown-menu')
  await page.click('#macros + .dropdown-menu a:has-text("Manage macros")')
  await page.waitForSelector('#macrosDialogModal')
  await settle(page)
  await snap(page, 'sql/macros-dialog.png', '#macrosDialogModal .modal-content')
  await page.click('#macrosDialogModal button:has-text("Close")')

  // The console with its history, the Options card and the Bookmarks card.
  if (!(await page.locator('#pma_console .content').count())) await page.click('.console_switch')
  await page.click('#pma_console .toolbar .button.history')
  await settle(page, 800)
  await page.locator('#pma_console .message.history').last().hover()
  await snap(page, 'sql/console.png', '#pma_console', { keepConsole: true })
  await page.click('#pma_console .toolbar .button.options')
  await settle(page)
  await snap(page, 'sql/console-options.png', '#pma_console', { keepConsole: true })
  await page.click('#pma_console_options .switch_button')
  await page.click('#pma_console .toolbar .button.bookmarks')
  await settle(page, 800)
  await snap(page, 'sql/console-bookmarks.png', '#pma_console', { keepConsole: true })
  await page.click('#pma_bookmarks .toolbar .button.add')
  await settle(page)
  await snap(page, 'sql/console-add-bookmark.png', '#pma_console', { keepConsole: true })
  await page.click('#pma_bookmarks .card.add .switch_button')
  await page.click('#pma_bookmarks > .toolbar .switch_button')
  await api(page, 'PATCH', '/api/preferences', { 'console.height': null })

  // Dragging the console's toolbar.
  if (!process.env.SKIP_CLIPS) {
    await recordClip('sql/console-resize.mp4', '/db/bookshop/schema/public/table/authors', async (p) => {
      if (!(await p.locator('#pma_console .content').count())) await p.click('.console_switch')
      await p.waitForTimeout(800)
      const bar = await p.locator('#pma_console > .toolbar').boundingBox()
      const x = bar.x + bar.width / 2
      const y = bar.y + 8
      await p.mouse.move(x, y)
      await p.mouse.down()
      for (let i = 1; i <= 20; i++) await p.mouse.move(x, y - i * 15, { steps: 2 })
      await p.mouse.up()
      await p.waitForTimeout(1000)
      await p.click('#pma_console .toolbar .button.history')
      await p.waitForTimeout(1200)
      const top = await p.locator('#pma_console > .toolbar').boundingBox()
      await p.mouse.move(x, top.y + 8)
      await p.mouse.down()
      for (let i = 1; i <= 10; i++) await p.mouse.move(x, top.y + 8 + i * 15, { steps: 2 })
      await p.mouse.up()
      await p.waitForTimeout(1200)
    })
  }
} finally {
  for (const id of made.bookmarks) await api(page, 'DELETE', `/api/query/bookmarks/${id}`)
  for (const id of made.macros) await api(page, 'DELETE', `/api/query/macros/${id}`)
  await api(page, 'PATCH', '/api/preferences', { 'console.height': heightBefore })
  await close()
  await done()
}
