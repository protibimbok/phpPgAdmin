// Export: screenshots for docs/tools/export.md, and checks that the files the page downloads hold
// what was asked for. Run with: node docs/scripts/captures/tools-export.mjs
// Creates and deletes an export template named tools_export_tpl; changes nothing in the database.

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { done, settle } from '../capture.mjs'
import { api, check, open, shot, clearNotices, notice, summary, workdir } from './tools-lib.mjs'

const dir = workdir('export')

/** Clicks Export and saves the download; returns { name, file, bytes }. */
async function download(page) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }).catch(async (e) => {
      throw new Error(`no download: ${await notice(page, 1000)} (${e.message})`)
    }),
    page.click('#buttonGo'),
  ])
  const file = path.join(dir, dl.suggestedFilename())
  await dl.saveAs(file)
  return { name: dl.suggestedFilename(), file, bytes: fs.readFileSync(file) }
}

// Server: pg_dumpall, one database picked, structure only.
{
  const { page, close } = await open('/server/export')
  await page.click('#radio_custom_export')
  await page.click('#db_unselect_all')
  await page.selectOption('#db_select', ['bookshop'])
  await page.check('#radio_sql_structure_or_data_structure')
  await page.selectOption('#compression', 'none')
  await settle(page)
  await shot(page, 'tools/export-server-databases.png', { selector: '#databases_and_tables' })
  await shot(page, 'tools/export-server-options.png', { selector: '#format_specific_opts' })
  const formats = await page.locator('#plugins option').allTextContents()
  check('server offers SQL only', formats.length === 1 && formats[0] === 'SQL', formats.join(', '))
  const out = await download(page)
  const sql = out.bytes.toString()
  check('server export is a pg_dumpall cluster dump', sql.includes('PostgreSQL database cluster dump'), out.name)
  check('server export holds the roles', /CREATE ROLE bookshop_staff/.test(sql))
  check('server export creates bookshop only', /CREATE DATABASE bookshop /.test(sql) && !/CREATE DATABASE dbo_|CREATE DATABASE tools_/.test(sql))
  check('structure only: no COPY', !/^COPY /m.test(sql))
  await close()
}

// Database: Quick, the defaults.
{
  const { page, close } = await open('/db/bookshop/export')
  await shot(page, 'tools/export-quick.png')
  const out = await download(page)
  const sql = out.bytes.toString()
  check('quick database export is bookshop.sql', out.name === 'bookshop.sql', out.name)
  check('quick export has structure and data', /CREATE TABLE public\.books/.test(sql) && /^COPY public\.books /m.test(sql))
  await close()
}

// Database: custom archive, and a gzipped tar archive.
{
  const { page, close } = await open('/db/bookshop/export')
  await page.click('#radio_custom_export')
  await page.selectOption('#plugins', 'custom')
  await page.selectOption('#compression', 'none')
  await settle(page)
  let out = await download(page)
  check('custom archive starts with PGDMP', out.bytes.subarray(0, 5).toString() === 'PGDMP', out.name)
  await page.selectOption('#plugins', 'tar')
  await page.selectOption('#compression', 'gzip')
  out = await download(page)
  const tar = zlib.gunzipSync(out.bytes)
  check('gzipped tar is bookshop.tar.gz', out.name === 'bookshop.tar.gz', out.name)
  check('gzipped tar holds a tar archive', tar.subarray(257, 262).toString() === 'ustar')
  await page.selectOption('#plugins', 'plain')
  await settle(page)
  await shot(page, 'tools/export-output.png', { selector: '#output' })
  await page.selectOption('#compression', 'none')
  await close()
}

// Schema: the Tables card, data of one table left out, and the combination pg_dump refuses.
{
  const { page, close } = await open('/db/bookshop/schema/public/export')
  await page.click('#radio_custom_export')
  await page.selectOption('#compression', 'none')
  await page.uncheck('input[name="table_data[]"][value="books"]')
  await settle(page)
  await page.evaluate(() => (document.querySelector('#databases_and_tables .card-body').scrollTop = 0))
  await shot(page, 'tools/export-schema-tables.png', { selector: '#databases_and_tables' })
  const out = await download(page)
  const sql = out.bytes.toString()
  check('schema export keeps the books table', /CREATE TABLE public\.books /.test(sql), out.name)
  check('schema export leaves out the rows of books', !/^COPY public\.books /m.test(sql) && /^COPY public\.authors /m.test(sql))
  await page.uncheck('input[name="table_structure[]"][value="authors"]')
  const [none] = await Promise.all([page.waitForEvent('download', { timeout: 4000 }).catch(() => null), page.click('#buttonGo')])
  const message = await notice(page)
  check('data without structure next to structure is refused', none === null && /without its structure/.test(message), message)
  await page.evaluate(() => window.scrollTo(0, 0))
  await shot(page, 'tools/export-orphan-error.png', { selector: '.ajax_notification' })
  await close()
}

// Schema Structure's "With selected: Export" comes as ?table=…: Custom, those tables ticked.
{
  const { page, close } = await open('/db/bookshop/schema/public/export?table=authors&table=books')
  const ticked = await page.locator('input[name="table_structure[]"]:checked').evaluateAll((els) => els.map((e) => e.value))
  check('?table= preselects the tables and switches to Custom', (await page.isChecked('#radio_custom_export')) && ticked.join(',') === 'authors,books', ticked.join(','))
  await close()
}

// Table: INSERT statements shown as text.
{
  const { page, close } = await open('/db/bookshop/schema/inventory/table/warehouses/export')
  await page.click('#radio_custom_export')
  await page.check('#radio_view_as_text')
  await page.selectOption('#select_sql_type', 'insert')
  await page.check('#radio_sql_insert_syntax_columns')
  await page.click('#buttonGo')
  await page.waitForSelector('#textSQLDUMP')
  await settle(page)
  const text = await page.inputValue('#textSQLDUMP')
  check('view as text shows INSERT with column names', /INSERT INTO inventory\.warehouses \(id, code, city\) VALUES/.test(text))
  await page.evaluate(() => document.querySelector('#textSQLDUMP').scrollTop = 0)
  await shot(page, 'tools/export-as-text.png', { selector: '#textSQLDUMP' })
  await close()
}

// Table: CSV, and its options.
{
  const { page, close } = await open('/db/bookshop/schema/public/table/authors/export')
  await page.click('#radio_custom_export')
  await page.selectOption('#plugins', 'csv')
  await page.fill('#text_csv_separator', ';')
  await page.selectOption('#compression', 'none')
  await settle(page)
  await shot(page, 'tools/export-csv-options.png', { selector: '#format_specific_opts' })
  const out = await download(page)
  const lines = out.bytes.toString().split('\n')
  check('CSV has a header row', lines[0] === 'id;name;born;country;bio;created_at', lines[0])
  check('CSV separates with ;', lines[1].startsWith('1;Ursula K. Le Guin;'), lines[1])
  await page.selectOption('#plugins', 'excel')
  const excel = (await download(page)).bytes.toString()
  check('CSV for MS Excel quotes every value and ends lines with CRLF', excel.includes('\r\n"1";"Ursula K. Le Guin"'), excel.slice(0, 80))
  await close()
}

// Templates: create one at the table level, load it, delete it.
{
  const { page, close } = await open('/db/bookshop/schema/public/table/authors/export')
  await page.click('#radio_custom_export')
  await page.selectOption('#plugins', 'csv')
  await page.fill('#templateName', 'tools_export_tpl')
  await page.click('#createTemplate')
  check('template created', /created/.test(await notice(page)))
  await clearNotices(page)
  await page.goto(page.url())
  await settle(page)
  await page.selectOption('#template', { label: 'tools_export_tpl' })
  await settle(page)
  check('loading a template restores its format', (await page.inputValue('#plugins')) === 'csv')
  await shot(page, 'tools/export-templates.png', { selector: '.card:has(#templateName)' })
  await page.click('#deleteTemplate')
  check('template deleted', /deleted/.test(await notice(page)))
  const left = await api(page, 'GET', '/api/export/templates?type=table')
  check('no template left behind', !left.json.templates.some((t) => t.name === 'tools_export_tpl'))
  await close()
}

// The error path: a dump that fails before writing anything is an error, not a file.
{
  const { page, close } = await open('/db/bookshop/export')
  const r = await api(page, 'POST', '/api/export', { database: 'bookshop', format: 'plain', encoding: 'NO_SUCH' })
  check('a pg_dump error before any output answers 422', r.status === 422 && /invalid client encoding/.test(r.text), r.text)
  await close()
}

fs.rmSync(dir, { recursive: true, force: true })
summary()
await done()
