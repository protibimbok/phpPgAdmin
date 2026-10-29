// Schema diff: screenshots for docs/database/schema-diff.md, comparing bookshop's inventory
// (source) with inventory_next (target), which the seed made with drift for this. Run with:
// node docs/scripts/captures/tools-schemadiff.mjs
// Nothing runs against bookshop. The script is applied to copies of both schemas in a scratch
// database, tools_diff (bookshop's structure, no data), dropped at the end.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { done, settle } from '../capture.mjs'
import { api, check, clearNotices, notice, open, psql, shot, summary, workdir } from './tools-lib.mjs'

const PG = ['-h', 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', 'postgres', '-X', '-q']
const dir = workdir('diff')

const { page, close } = await open('/db/bookshop/schema-diff')
await page.waitForSelector('#source_schema option', { state: 'attached' })
await page.selectOption('#source_schema', 'inventory')
await page.selectOption('#target_schema', 'inventory_next')
await settle(page)
await shot(page, 'database/schema-diff-form.png', { selector: '#schema_diff_form' })
await page.click('#schema_diff_form input[type=submit]')
await page.waitForSelector('#schema_diff_results')
await settle(page)
const rows = await page.locator('#schema_diff_results tbody tr:not(.table-secondary)').allInnerTexts()
const statuses = rows.map((r) => r.trim().replace(/\s+/g, ' '))
check('results: the drift the seed made', ['promotions_id_seq Source only', 'suppliers_id_seq Target only', 'promotions Source only', 'stock Different', 'suppliers Target only', 'warehouses Different'].every((r) => statuses.includes(r)), statuses.join(' | '))
check('identical objects are hidden at first', !statuses.some((r) => /Identical/.test(r)))
await page.check('#show_identical')
check('Identical shows them', (await page.locator('#schema_diff_results tbody tr', { hasText: 'Identical' }).count()) === 1)
await page.uncheck('#show_identical')
await shot(page, 'database/schema-diff-results.png', { selector: '#schema_diff_results' })

// One object's DDL on each side, and what changes the target.
await page.click('#schema_diff_results tbody tr:has-text("warehouses")')
await page.waitForSelector('#schema_diff_ddl .col-xl-4')
await settle(page, 800)
const ddl = await page.locator('#schema_diff_ddl').innerText()
check('the Difference of warehouses drops capacity and retypes code', /DROP COLUMN IF EXISTS capacity/.test(ddl) && /ALTER COLUMN code TYPE text/.test(ddl), ddl.slice(-300))

// The script, and Open in the SQL page (which does not run it).
await page.click('#generate_script')
await page.waitForFunction(() => /BEGIN;/.test(document.querySelector('.modal-body')?.textContent ?? ''), null, { timeout: 20000 })
await settle(page)
const script = await page.locator('.modal-body').innerText()
const order = ['DROP TABLE IF EXISTS inventory_next.suppliers', 'DROP SEQUENCE IF EXISTS inventory_next.suppliers_id_seq', 'CREATE SEQUENCE IF NOT EXISTS inventory_next.promotions_id_seq', 'CREATE TABLE IF NOT EXISTS inventory_next.promotions', 'ALTER TABLE IF EXISTS inventory_next.warehouses', 'ALTER TABLE IF EXISTS inventory_next.stock'].map((s) => script.indexOf(s))
check('the script drops first, then creates in dependency order, in one transaction', /^BEGIN;/m.test(script) && /^END;/m.test(script) && script.indexOf('BEGIN;') < order[0] && script.indexOf('END;') > order[5] && order.every((n, i) => n >= 0 && (i === 0 || n > order[i - 1])), order.join(','))
await shot(page, 'database/schema-diff-script.png', { selector: '.modal-content' })
await page.click('.modal-footer .btn-primary')
await settle(page, 1500)
const url = decodeURIComponent(page.url())
const box = await page.evaluate(() => [...document.querySelectorAll('textarea, .cm-content')].map((e) => e.value ?? e.textContent).join('\n'))
check('Open in the SQL page fills the query box without running it', /\/db\/bookshop\/sql/.test(url) && /DROP TABLE IF EXISTS inventory_next\.suppliers/.test(box) && !(await page.getByText('executed successfully').count()), url.slice(0, 120))
check('inventory_next is unchanged', psql("SELECT count(*) FROM pg_tables WHERE schemaname = 'inventory_next' AND tablename = 'suppliers'") === '1')
await close()

// The DDL panes stack below 1200 px; the Source and Difference panes of warehouses, full width.
{
  const { page: p, close: c } = await open('/db/bookshop/schema-diff', { viewport: { width: 1180, height: 900 } })
  await p.waitForSelector('#source_schema option', { state: 'attached' })
  await p.selectOption('#source_schema', 'inventory')
  await p.selectOption('#target_schema', 'inventory_next')
  await p.click('#schema_diff_form input[type=submit]')
  await p.waitForSelector('#schema_diff_results')
  await p.click('#schema_diff_results tbody tr:has-text("warehouses")')
  await p.waitForSelector('#schema_diff_ddl .col-xl-4')
  await settle(p, 800)
  await shot(p, 'database/schema-diff-ddl.png', { selector: '#schema_diff_ddl .col-xl-4:nth-child(3)' })
  await shot(p, 'database/schema-diff-source-ddl.png', { selector: '#schema_diff_ddl .col-xl-4:nth-child(1)' })
  await c()
}

// Refusals.
{
  const { page: p, close: c } = await open('/db/bookshop/schema-diff')
  await p.waitForSelector('#source_schema option', { state: 'attached' })
  await p.selectOption('#source_schema', 'inventory')
  await p.selectOption('#target_schema', 'inventory')
  await p.click('#schema_diff_form input[type=submit]')
  const m = await notice(p)
  check('the same schema on both sides is refused', /same schema/.test(m), m)
  await clearNotices(p)
  await c()
}

// Applying the script to copies: bookshop's structure in tools_diff.
psql('DROP DATABASE IF EXISTS tools_diff WITH (FORCE)', 'postgres')
psql('CREATE DATABASE tools_diff', 'postgres')
const schemaSql = path.join(dir, 'bookshop-schema.sql')
execFileSync('pg_dump', ['-h', 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', 'postgres', '-s', '-d', 'bookshop', `--file=${schemaSql}`])
execFileSync('psql', [...PG, '-d', 'tools_diff', '-o', '/dev/null', '-f', schemaSql], { stdio: 'ignore' })
{
  const { page: p, close: c } = await open('/db/tools_diff/schema-diff')
  const request = { source: { database: 'tools_diff', schema: 'inventory' }, target: { database: 'tools_diff', schema: 'inventory_next' } }
  const crossDb = await api(p, 'POST', '/api/schema-diff/compare', { source: { database: 'bookshop', schema: 'inventory' }, target: { database: 'tools_diff', schema: 'inventory' } })
  check('two databases of the server can be compared', crossDb.status === 200 && crossDb.json.results.every((r) => r.status === 'identical'), JSON.stringify(crossDb.json?.results?.filter((r) => r.status !== 'identical')))
  const results = (await api(p, 'POST', '/api/schema-diff/compare', request)).json.results
  const items = results.filter((r) => r.status !== 'identical')
  const generated = (await api(p, 'POST', '/api/schema-diff/script', { ...request, items })).json.script
  const file = path.join(dir, 'migration.sql')
  fs.writeFileSync(file, generated)
  let error = ''
  try {
    execFileSync('psql', [...PG, '-v', 'ON_ERROR_STOP=1', '-d', 'tools_diff', '-f', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    error = String(e.stderr)
  }
  // Known bug: the sequence of a table only in the source is created and OWNED BY the table before the table exists.
  check('the script stops at ALTER SEQUENCE … OWNED BY before its table exists (known bug)', /relation "inventory_next\.promotions" does not exist/.test(error), error.trim().split('\n').pop())

  // Whitespace: a routine that differs only in its layout.
  psql("CREATE FUNCTION inventory.tools_ws() RETURNS int LANGUAGE sql AS 'SELECT 1'; CREATE FUNCTION inventory_next.tools_ws() RETURNS int LANGUAGE sql AS 'SELECT   1'", 'tools_diff')
  const ws = async (ignore) => (await api(p, 'POST', '/api/schema-diff/compare', { ...request, ignore_whitespace: ignore })).json.results.find((r) => r.name.startsWith('tools_ws'))?.status
  check('Ignore whitespace makes a layout-only change identical', (await ws(false)) === 'different' && (await ws(true)) === 'identical', `${await ws(false)} / ${await ws(true)}`)
  // Owner: the same table owned by another role.
  psql('CREATE TABLE inventory.tools_own (id int); CREATE TABLE inventory_next.tools_own (id int); ALTER TABLE inventory_next.tools_own OWNER TO bookshop_staff', 'tools_diff')
  const own = async (ignore) => (await api(p, 'POST', '/api/schema-diff/compare', { ...request, ignore_owner: ignore })).json.results.find((r) => r.name === 'tools_own')?.status
  check('Ignore owner makes an owner-only change identical', (await own(false)) === 'different' && (await own(true)) === 'identical', `${await own(false)} / ${await own(true)}`)
  // Grants.
  psql('CREATE TABLE inventory.tools_gr (id int); CREATE TABLE inventory_next.tools_gr (id int); GRANT SELECT ON inventory_next.tools_gr TO bookshop_clerk', 'tools_diff')
  const gr = async (ignore) => (await api(p, 'POST', '/api/schema-diff/compare', { ...request, ignore_grants: ignore })).json.results.find((r) => r.name === 'tools_gr')?.status
  check('Ignore grants/revokes makes a grant-only change identical', (await gr(false)) === 'different' && (await gr(true)) === 'identical', `${await gr(false)} / ${await gr(true)}`)
  await c()
}
psql('DROP DATABASE IF EXISTS tools_diff WITH (FORCE)', 'postgres')
fs.rmSync(dir, { recursive: true, force: true })
summary()
await done()
