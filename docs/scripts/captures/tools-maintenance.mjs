// Maintenance: screenshots for docs/tools/maintenance.md, the statements the Maintenance card
// writes for each option, and runs of VACUUM, ANALYZE, REINDEX and CLUSTER as background
// processes. Run with: node docs/scripts/captures/tools-maintenance.mjs
// Runs go to a scratch database, tools_maint, dropped at the end; bookshop is only previewed.

import { done, settle } from '../capture.mjs'
import { api, check, open, psql, shot, summary } from './tools-lib.mjs'

psql('DROP DATABASE IF EXISTS tools_maint WITH (FORCE)', 'postgres')
psql('CREATE DATABASE tools_maint', 'postgres')
psql(`CREATE TABLE public.tools_m (id int PRIMARY KEY, v text);
INSERT INTO public.tools_m SELECT g, md5(g::text) FROM generate_series(1, 5000) g;
DELETE FROM public.tools_m WHERE id % 2 = 0;
CREATE INDEX tools_m_v ON public.tools_m (v);
CLUSTER public.tools_m USING tools_m_v;
CREATE SCHEMA tools_s;
CREATE TABLE tools_s.tools_a (id int PRIMARY KEY);
CREATE TABLE tools_s.tools_b (id int PRIMARY KEY);`, 'tools_maint')

const { page, close } = await open('/db/bookshop/operations')
const preview = async (target, operation, options) => {
  const r = await api(page, 'POST', '/api/maintenance', { ...target, operation, options, preview: true })
  return r.json?.sql ?? `ERROR ${r.status}: ${r.json?.reason_phrase ?? r.json?.message ?? r.text}`
}
const db = { database: 'bookshop' }
const schema = { database: 'bookshop', schema: 'inventory' }

// The statements, checked against what each option should write.
const cases = [
  [db, 'VACUUM', {}, 'VACUUM;'],
  [db, 'VACUUM', { verbose: true, full: true, freeze: true, analyze: true }, 'VACUUM (VERBOSE, FULL, FREEZE, ANALYZE);'],
  [db, 'VACUUM', { disable_page_skipping: true, skip_locked: true, truncate: false, process_toast: false, process_main: false, index_cleanup: 'off', parallel: '2', buffer_usage_limit: '16MB' }, "VACUUM (DISABLE_PAGE_SKIPPING, SKIP_LOCKED, TRUNCATE false, PROCESS_TOAST false, PROCESS_MAIN false, INDEX_CLEANUP OFF, PARALLEL 2, BUFFER_USAGE_LIMIT '16MB');"],
  [db, 'VACUUM', { skip_database_stats: true }, 'VACUUM (SKIP_DATABASE_STATS);'],
  [db, 'VACUUM', { only_database_stats: true }, 'VACUUM (ONLY_DATABASE_STATS);'],
  [schema, 'VACUUM', { analyze: true }, 'VACUUM (ANALYZE) inventory.promotions, inventory.stock, inventory.warehouses;'],
  [db, 'ANALYZE', { verbose: true, skip_locked: true, buffer_usage_limit: '256kB' }, "ANALYZE (VERBOSE, SKIP_LOCKED, BUFFER_USAGE_LIMIT '256kB');"],
  [schema, 'ANALYZE', {}, 'ANALYZE inventory.promotions, inventory.stock, inventory.warehouses;'],
  [db, 'REINDEX', {}, 'REINDEX DATABASE bookshop;'],
  [db, 'REINDEX', { concurrently: true, tablespace: 'pg_default', verbose: true }, 'REINDEX (VERBOSE, TABLESPACE pg_default) DATABASE CONCURRENTLY bookshop;'],
  [db, 'REINDEX', { system: true }, 'REINDEX SYSTEM bookshop;'],
  [schema, 'REINDEX', { concurrently: true }, 'REINDEX SCHEMA CONCURRENTLY inventory;'],
  [db, 'CLUSTER', { verbose: true }, 'CLUSTER VERBOSE;'],
]
for (const [target, op, options, expected] of cases) {
  const sql = await preview(target, op, options)
  check(`${op} ${JSON.stringify(options)} at ${target.schema ? 'schema' : 'database'}`, sql === expected, sql)
}
const refusals = [
  [db, 'VACUUM', { full: true, parallel: '2' }, /does not run parallel workers/],
  [db, 'VACUUM', { full: true, disable_page_skipping: true }, /DISABLE_PAGE_SKIPPING does not go with it/],
  [db, 'VACUUM', { buffer_usage_limit: 'lots' }, /BUFFER_USAGE_LIMIT is a size/],
  [db, 'REINDEX', { system: true, concurrently: true }, /REINDEX SYSTEM rebuilds the catalogs in place/],
  [schema, 'CLUSTER', {}, /not on a schema/],
]
for (const [target, op, options, expected] of refusals) {
  const sql = await preview(target, op, options)
  check(`${op} ${JSON.stringify(options)} is refused`, expected.test(sql), sql)
}

// The card on the database's Operations page, and its Preview SQL.
await page.locator('#maintenance_form').scrollIntoViewIfNeeded()
await page.check('#maintenance_analyze')
await page.check('#maintenance_verbose')
await settle(page)
await shot(page, 'tools/maintenance-card.png', { selector: '#maintenance_form' })
await page.click('#maintenance_form .preview_sql')
await page.waitForSelector('.modal .modal-body pre, .modal .modal-body code, .modal .modal-body .cm-editor', { timeout: 10000 }).catch(() => {})
await settle(page)
const shown = await page.locator('.modal .modal-body').innerText()
check('Preview SQL shows the statement', /VACUUM \(VERBOSE, ANALYZE\);/.test(shown), shown)
await shot(page, 'tools/maintenance-preview.png', { selector: '.modal-content' })
await page.click('.modal .btn-close')
await page.click('#maintenance_op_REINDEX')
await settle(page)
await shot(page, 'tools/maintenance-reindex.png', { selector: '#maintenance_form' })
await close()

/** Runs the card's operation at a target page and waits for its process card; returns its text. */
async function run(p, setup) {
  await setup()
  await p.click('#maintenance_form input[type=submit]')
  const card = p.locator('[id^=maintenance_process_]').first()
  await card.waitFor({ timeout: 20000 })
  await card.locator('.alert:not(.alert-primary)').waitFor({ timeout: 120000 })
  await p.waitForTimeout(1200)
  return card
}
async function dismissAll(p) {
  for (let i = 0; i < 20; i++) {
    const button = p.locator('[id^=maintenance_process_] button', { hasText: 'Dismiss' }).first()
    if (!(await button.count())) break
    await button.click()
    await p.waitForTimeout(400)
  }
}

// Runs on the scratch database.
{
  const { page: p, close: c } = await open('/db/tools_maint/operations')
  await dismissAll(p)
  let card = await run(p, async () => {
    await p.check('#maintenance_full')
    await p.check('#maintenance_verbose')
  })
  let text = await card.innerText()
  check('VACUUM (VERBOSE, FULL) runs and reports with INFO lines', /has finished/.test(text) && /INFO:\s+vacuuming "public\.tools_m"/.test(text), text.slice(0, 400))
  await shot(p, 'tools/maintenance-process.png', { selector: '[id^=maintenance_process_]' })
  await dismissAll(p)
  await p.goto(p.url())
  await settle(p)
  card = await run(p, async () => {
    await p.click('#maintenance_op_CLUSTER')
    await p.check('#maintenance_verbose')
  })
  text = await card.innerText()
  check('CLUSTER VERBOSE reclusters the clustered table', /clustering "public\.tools_m" using (index scan on|sequential scan and sort)/.test(text), text.slice(0, 400))
  await dismissAll(p)
  await p.goto(p.url())
  await settle(p)
  card = await run(p, async () => {
    await p.click('#maintenance_op_REINDEX')
    await p.check('#maintenance_concurrently')
  })
  text = await card.innerText()
  check('REINDEX DATABASE CONCURRENTLY runs', /has finished/.test(text) && /REINDEX/.test(text), text.slice(0, 300))
  await dismissAll(p)
  await c()
}
{
  const { page: p, close: c } = await open('/db/tools_maint/schema/tools_s/operations')
  await dismissAll(p)
  const ops = await p.locator('input[name=maintenance_operation]').evaluateAll((els) => els.map((e) => e.value))
  check('a schema offers VACUUM, ANALYZE and REINDEX (no CLUSTER)', ops.join(',') === 'VACUUM,ANALYZE,REINDEX', ops.join(','))
  const card = await run(p, async () => {
    await p.click('#maintenance_op_ANALYZE')
    await p.check('#maintenance_verbose')
  })
  const text = await card.innerText()
  check('schema ANALYZE names its tables', /ANALYZE \(VERBOSE\) tools_s\.tools_a, tools_s\.tools_b/.test(text) && /INFO:\s+analyzing "tools_s\.tools_a"/.test(text), text.slice(0, 400))
  await dismissAll(p)
  await c()
}

// The table's Operations links run their statement on the SQL page.
{
  const { page: p, close: c } = await open('/db/tools_maint/schema/public/table/tools_m/operations')
  await settle(p)
  await shot(p, 'tools/maintenance-table-links.png', { selector: '.card:has(#tbl_maintenance)' })
  const links = await p.locator('#tbl_maintenance a').allTextContents()
  check('table maintenance links', links.join('|') === 'Analyze table|Vacuum table|Vacuum and analyze table|Reindex table|Cluster the table on tools_m_v', links.join('|'))
  await p.click('#tbl_maintenance a:has-text("Vacuum table")')
  await settle(p, 2000)
  check('Vacuum table opens the SQL page', /\/sql/.test(p.url()), p.url())
  const vacuumed = psql("SELECT vacuum_count > 0 FROM pg_stat_user_tables WHERE relname = 'tools_m'", 'tools_maint')
  check('the table was vacuumed', vacuumed === 't', vacuumed)
  await c()
}

// VERBOSE typed on the SQL page: its INFO messages show with the result.
{
  const { page: p, close: c } = await open(`/db/tools_maint/schema/public/table/tools_m/sql?${new URLSearchParams({ sql: 'VACUUM (VERBOSE) public.tools_m', run: '1' })}`)
  await settle(p, 2500)
  const body = await p.locator('#page_content, main, body').first().innerText()
  check('VERBOSE INFO lines show on the SQL page', /vacuuming "tools_maint\.public\.tools_m"/.test(body), body.slice(0, 300))
  await shot(p, 'tools/maintenance-sql-verbose.png')
  await c()
}

psql('DROP DATABASE IF EXISTS tools_maint WITH (FORCE)', 'postgres')
summary()
await done()
