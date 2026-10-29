// Import: screenshots for docs/tools/import.md, and checks of what each import did in the
// database. Run with: node docs/scripts/captures/tools-import.mjs
// Everything lands in scratch databases (tools_import, tools_import_arch), which are dropped at
// the end; bookshop is only read (an archive of its inventory schema is made with pg_dump).

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { done, settle } from '../capture.mjs'
import { check, clearNotices, notice, open, psql, shot, summary, workdir } from './tools-lib.mjs'

const dir = workdir('import')
const PG = ['-h', 'localhost', '-p', process.env.DOCS_PG_PORT ?? '5499', '-U', 'postgres']
const write = (name, text) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  return file
}

psql('DROP DATABASE IF EXISTS tools_import WITH (FORCE)', 'postgres')
psql('DROP DATABASE IF EXISTS tools_import_arch WITH (FORCE)', 'postgres')

/** Picks the file, sets the options, clicks Import and waits for the process card to end; returns the card. */
async function runImport(page, file, setup = async () => {}, { wait = true, fresh = true } = {}) {
  // The form keeps its options after an import; start each one from the page's defaults.
  if (fresh) {
    await page.goto(page.url())
    await settle(page)
  }
  const before = await page.locator('[id^=import_process_]').count()
  await page.setInputFiles('#input_import_file', file)
  await setup()
  await page.click('#buttonGo')
  const card = page.locator('[id^=import_process_]').first()
  await page.waitForFunction((n) => document.querySelectorAll('[id^=import_process_]').length > n, before, { timeout: 30000 }).catch(() => {})
  if (wait) await card.locator('.alert:not(.alert-primary)').waitFor({ timeout: 60000 })
  await page.waitForTimeout(1200)

  return card
}

async function dismissAll(page) {
  for (let i = 0; i < 20; i++) {
    const button = page.locator('[id^=import_process_] button', { hasText: 'Dismiss' }).first()
    if (!(await button.count())) break
    await button.click()
    await page.waitForTimeout(400)
  }
}

// Server: an SQL file run by psql in the maintenance database creates the scratch database.
{
  const { page, close } = await open('/server/import')
  await dismissAll(page)
  await shot(page, 'tools/import-server.png')
  const card = await runImport(page, write('create_db.sql', 'CREATE DATABASE tools_import;\n'))
  const text = await card.innerText()
  check('server SQL import ran CREATE DATABASE', psql("SELECT count(*) FROM pg_database WHERE datname = 'tools_import'") === '1', text)
  check('the card shows the psql command, the restrict key hidden', /psql --no-psqlrc --no-password --set=ON_ERROR_STOP=1 --command=\\restrict … --file=-/.test(text), text)
  await dismissAll(page)
  await close()
}

// Database: an SQL file (tables, rows, a meta-command), gzipped, and the restricted mode.
{
  const { page, close } = await open('/db/tools_import/import')
  const sql = [
    'CREATE TABLE public.tools_authors (id integer PRIMARY KEY, name text NOT NULL);',
    "INSERT INTO public.tools_authors VALUES (1, 'Le Guin'), (2, 'Pratchett');",
    'CREATE TABLE public.tools_books (id integer PRIMARY KEY, author_id integer REFERENCES public.tools_authors, title text NOT NULL, price numeric(6,2) DEFAULT 9.99, note text);',
    'CREATE SCHEMA tools_target;',
    'CREATE EXTENSION btree_gist;',
    '',
  ].join('\n')
  const gz = path.join(dir, 'setup.sql.gz')
  fs.writeFileSync(gz, zlib.gzipSync(sql))
  let card = await runImport(page, gz)
  check('gzipped SQL import ran', psql('SELECT count(*) FROM public.tools_authors', 'tools_import') === '2', await card.innerText())
  await dismissAll(page)

  // A meta-command stops the file: psql refuses it in restricted mode.
  card = await runImport(page, write('meta.sql', "SELECT 1 AS before;\n\\! touch /tmp/tools_import_pwned\nSELECT 2 AS after;\n"))
  let text = await card.innerText()
  check('\\! is refused in restricted mode', /backslash commands are restricted/.test(text) && !fs.existsSync('/tmp/tools_import_pwned'), text)
  check('ON_ERROR_STOP stops at the refused line', !/ after/.test(text.split('restricted')[1] ?? ''), text)
  await shot(page, 'tools/import-restricted.png', { selector: '[id^=import_process_]' })
  await dismissAll(page)

  // Errors without "Stop at the first error": psql goes on and counts them.
  card = await runImport(page, write('errors.sql', "INSERT INTO public.tools_authors VALUES (1, 'dup');\nINSERT INTO public.tools_authors VALUES (3, 'Butler');\n"), async () => {
    await page.uncheck('#checkbox_stop_on_error')
  })
  text = await card.innerText()
  check('without ON_ERROR_STOP psql runs on and the errors are counted', /Errors reported: 1/.test(text) && psql('SELECT count(*) FROM public.tools_authors', 'tools_import') === '3', text)
  await shot(page, 'tools/import-finished-errors.png', { selector: '[id^=import_process_]' })
  await dismissAll(page)

  // --single-transaction: an error rolls the whole file back.
  card = await runImport(page, write('tx.sql', "INSERT INTO public.tools_authors VALUES (4, 'Morrison');\nINSERT INTO public.tools_authors VALUES (1, 'dup');\n"), async () => {
    await page.check('#checkbox_sql_single_transaction')
  })
  check('single transaction rolls back the whole file', psql('SELECT count(*) FROM public.tools_authors WHERE id = 4', 'tools_import') === '0', await card.innerText())
  await dismissAll(page)

  // Foreign key checks off: session_replication_role = replica.
  card = await runImport(page, write('fk.sql', "INSERT INTO public.tools_books (id, author_id, title) VALUES (100, 999, 'Orphan');\n"), async () => {
    await page.uncheck('#fk_checks')
  })
  check('FK checks off lets an orphan row in', psql('SELECT count(*) FROM public.tools_books WHERE id = 100', 'tools_import') === '1', await card.innerText())
  psql('DELETE FROM public.tools_books WHERE id = 100', 'tools_import')
  await dismissAll(page)

  // A pg_dump archive chosen as SQL is refused before anything runs.
  execFileSync('pg_dump', [...PG, '-d', 'bookshop', '--schema=inventory', '--format=custom', '--no-owner', `--file=${path.join(dir, 'inventory.dump')}`])
  await page.setInputFiles('#input_import_file', path.join(dir, 'inventory.dump'))
  await page.selectOption('#plugins', 'sql')
  await page.click('#buttonGo')
  const message = await notice(page)
  check('an archive imported as SQL is refused', /archive, which pg_restore reads/.test(message), message)
  await clearNotices(page)

  // The archive restored with pg_restore into the database.
  await page.goto(page.url())
  await settle(page)
  await page.setInputFiles('#input_import_file', path.join(dir, 'inventory.dump'))
  await settle(page)
  check('a .dump file selects the archive format', (await page.inputValue('#plugins')) === 'archive')
  await page.check('#checkbox_verbose')
  await settle(page)
  await shot(page, 'tools/import-archive-options.png', { selector: '#format_specific_opts' })
  card = await runImport(page, path.join(dir, 'inventory.dump'), async () => {
    await page.selectOption('#plugins', 'archive')
    await page.check('#checkbox_verbose')
  })
  text = await card.innerText()
  check('pg_restore restored the inventory schema', psql('SELECT count(*) FROM inventory.stock', 'tools_import') === psql('SELECT count(*) FROM inventory.stock'), text.slice(0, 200))
  check('the foreign keys to public.books fail: exit code 1, 2 errors', /failed \(exit code 1\)\. Errors reported: 2/.test(text), text.slice(0, 200))
  check('pg_restore --verbose output is shown', /pg_restore: creating TABLE "inventory.stock"/.test(text))
  await shot(page, 'tools/import-archive-finished.png', { selector: '[id^=import_process_]' })
  await dismissAll(page)

  // Restoring the same archive again: the objects exist, pg_restore reports and goes on.
  card = await runImport(page, path.join(dir, 'inventory.dump'), async () => {
    await page.selectOption('#plugins', 'archive')
    await page.selectOption('#plugins', 'archive')
  })
  text = await card.innerText()
  check('a second restore reports errors and finishes', /Errors reported: \d+/.test(text), text.slice(0, 160))
  await dismissAll(page)

  // --clean --if-exists drops and recreates, data only reloads rows.
  card = await runImport(page, path.join(dir, 'inventory.dump'), async () => {
    await page.selectOption('#plugins', 'archive')
    await page.check('#checkbox_clean')
    await page.check('#checkbox_if_exists')
  })
  text = await card.innerText()
  check('--clean --if-exists drops and recreates: the rows are not doubled', /--clean --if-exists/.test(text) && /Errors reported: 2\./.test(text) && psql('SELECT count(*) FROM inventory.stock', 'tools_import') === psql('SELECT count(*) FROM inventory.stock'), text.slice(0, 300))
  await dismissAll(page)

  // --single-transaction: the FK errors roll the whole restore back.
  psql('DROP SCHEMA inventory CASCADE', 'tools_import')
  card = await runImport(page, path.join(dir, 'inventory.dump'), async () => {
    await page.selectOption('#plugins', 'archive')
    await page.check('#checkbox_single_transaction')
  })
  text = await card.innerText()
  check('--single-transaction rolls the restore back at the first error', /failed/.test(text) && psql("SELECT count(*) FROM pg_namespace WHERE nspname = 'inventory'", 'tools_import') === '0', text.slice(0, 300))
  await dismissAll(page)

  // Parallel jobs on a gzipped archive are refused.
  const gzDump = path.join(dir, 'inventory.dump.gz')
  fs.writeFileSync(gzDump, zlib.gzipSync(fs.readFileSync(path.join(dir, 'inventory.dump'))))
  await page.goto(page.url())
  await settle(page)
  await page.setInputFiles('#input_import_file', gzDump)
  await page.selectOption('#plugins', 'archive')
  await page.fill('#text_jobs', '2')
  await page.click('#buttonGo')
  const jobs = await notice(page)
  check('parallel jobs on a gzipped archive are refused', /parallel jobs/.test(jobs), jobs)
  await clearNotices(page)
  await close()
}

// Schema: the archive's tables of one schema only (--schema).
{
  const { page, close } = await open('/db/tools_import/schema/tools_target/import')
  // An archive of a scratch table in the tools_target schema of tools_import, restored after a drop.
  psql('CREATE TABLE tools_target.tools_t (id int); INSERT INTO tools_target.tools_t VALUES (1), (2)', 'tools_import')
  execFileSync('pg_dump', [...PG, '-d', 'tools_import', '--format=custom', `--file=${path.join(dir, 'whole.dump')}`])
  psql('DROP TABLE tools_target.tools_t', 'tools_import')
  const card = await runImport(page, path.join(dir, 'whole.dump'), async () => {
    await page.selectOption('#plugins', 'archive')
  })
  const text = await card.innerText()
  check('schema-level restore passes --schema', /--schema=tools_target/.test(text) && psql('SELECT count(*) FROM tools_target.tools_t', 'tools_import') === '2', text.slice(0, 300))
  await dismissAll(page)

  // An SQL file at the schema level runs with search_path set to the schema.
  await runImport(page, write('unqualified.sql', 'CREATE TABLE tools_unqualified (id int);\n'))
  check('schema-level SQL runs with the schema as search_path', psql("SELECT count(*) FROM pg_tables WHERE schemaname = 'tools_target' AND tablename = 'tools_unqualified'", 'tools_import') === '1')
  await dismissAll(page)
  await close()
}

// Server: an archive with --create recreates its database.
{
  psql('CREATE DATABASE tools_import_arch', 'postgres')
  psql('CREATE TABLE tools_a (id int); INSERT INTO tools_a VALUES (1), (2), (3)', 'tools_import_arch')
  execFileSync('pg_dump', [...PG, '-d', 'tools_import_arch', '--format=custom', `--file=${path.join(dir, 'arch.dump')}`])
  psql('DROP DATABASE tools_import_arch', 'postgres')
  const { page, close } = await open('/server/import')
  await page.setInputFiles('#input_import_file', path.join(dir, 'arch.dump'))
  await settle(page)
  await shot(page, 'tools/import-server-archive.png', { selector: '#archive_general_opts' })
  const card = await runImport(page, path.join(dir, 'arch.dump'))
  const text = await card.innerText()
  check('server-level archive restore recreates the database (--create)', /--create/.test(text) && psql('SELECT count(*) FROM tools_a', 'tools_import_arch') === '3', text.slice(0, 300))
  await dismissAll(page)
  await close()
  psql('DROP DATABASE tools_import_arch WITH (FORCE)', 'postgres')
}

// Table: CSV, COPY text and COPY binary, with their options.
{
  const route = '/db/tools_import/schema/public/table/tools_books/import'
  const { page, close } = await open(route)
  const count = () => psql('SELECT count(*) FROM public.tools_books', 'tools_import')

  await page.setInputFiles('#input_import_file', write('books.csv', 'id,author_id,title,price,note\n1,1,The Dispossessed,12.50,\n2,2,Mort,,quoted ""x""\n'))
  await settle(page)
  check('a .csv file selects CSV on a table', (await page.inputValue('#plugins')) === 'csv')
  await page.check('#checkbox_csv_col_names')
  await page.check('#checkbox_csv_header_match')
  await page.fill('#text_csv_default', '@default')
  await settle(page)
  await shot(page, 'tools/import-csv-options.png', { selector: '#format_specific_opts' })
  let card = await runImport(page, path.join(dir, 'books.csv'), async () => {
    await page.check('#checkbox_csv_col_names')
  })
  check('CSV with a header row imports', count() === '2', await card.innerText())
  check('an empty unquoted CSV value is NULL', psql('SELECT price IS NULL FROM public.tools_books WHERE id = 2', 'tools_import') === 't')
  await dismissAll(page)

  // HEADER MATCH refuses a header that names other columns.
  card = await runImport(page, write('wrong-header.csv', 'id,author,title,price,note\n3,1,X,1,\n'), async () => {
    await page.check('#checkbox_csv_col_names')
    await page.check('#checkbox_csv_header_match')
  })
  let text = await card.innerText()
  check('HEADER MATCH refuses a header with other names', /mismatch in header/.test(text) && count() === '2', text.slice(0, 400))
  await dismissAll(page)

  // DEFAULT and ON_ERROR ignore.
  card = await runImport(page, write('defaults.csv', '3,1,Small Gods,@default,\n4,1,Bad price,abc,\n5,2,Night Watch,7.25,\n'), async () => {
    await page.fill('#text_csv_default', '@default')
    await page.check('#checkbox_csv_ignore')
  })
  text = await card.innerText()
  check('DEFAULT text takes the column default', psql('SELECT price FROM public.tools_books WHERE id = 3', 'tools_import') === '9.99')
  check('ON_ERROR ignore skips the bad row and reports it', count() === '4' && /skipped|invalid input syntax/.test(text), text.slice(0, 500))
  await shot(page, 'tools/import-on-error.png', { selector: '[id^=import_process_]' })
  await dismissAll(page)

  // Upsert and row limit: staged through a temporary table.
  card = await runImport(page, write('upsert.csv', '1,1,The Dispossessed (2nd ed.),14.00,\n6,2,Guards! Guards!,8.00,\n7,2,Eric,6.00,\n'), async () => {
    await page.check('#checkbox_csv_replace')
    await page.fill('#number_csv_partial_import', '2')
  })
  text = await card.innerText()
  check('ON CONFLICT DO UPDATE updates the duplicate', psql('SELECT title FROM public.tools_books WHERE id = 1', 'tools_import') === 'The Dispossessed (2nd ed.)', text.slice(0, 300))
  check('the row limit stops after 2 rows', psql('SELECT count(*) FROM public.tools_books WHERE id IN (6, 7)', 'tools_import') === '1')
  await dismissAll(page)

  // A column list for a file in another order.
  card = await runImport(page, write('columns.csv', 'Thud!,2,8\n'), async () => {
    await page.fill('#text_csv_columns', 'title, author_id, id')
  })
  check('the column list maps the file columns', psql('SELECT title FROM public.tools_books WHERE id = 8', 'tools_import') === 'Thud!', await card.innerText())
  await dismissAll(page)

  // COPY text format with a header line and \N.
  card = await runImport(page, write('books.tsv', 'id\tauthor_id\ttitle\tprice\tnote\n9\t1\tLathe of Heaven\t\\N\t\\N\n'), async () => {
    await page.selectOption('#plugins', 'text')
    await page.check('#checkbox_text_col_names')
  })
  check('COPY text format imports', psql('SELECT count(*) FROM public.tools_books WHERE id = 9 AND price IS NULL', 'tools_import') === '1', await card.innerText())
  await dismissAll(page)

  // COPY binary format, written by COPY … TO (FORMAT binary).
  const bin = path.join(dir, 'books.bin')
  execFileSync('psql', [...PG, '-d', 'tools_import', '-c', `\\copy (SELECT 10, 2, 'Equal Rites'::text, 5.5::numeric(6,2), NULL::text) TO '${bin}' WITH (FORMAT binary)`])
  card = await runImport(page, bin, async () => {
    await page.selectOption('#plugins', 'binary')
  })
  check('COPY binary format imports', psql('SELECT title FROM public.tools_books WHERE id = 10', 'tools_import') === 'Equal Rites', await card.innerText())
  await dismissAll(page)

  // A text file declared as binary is refused.
  await page.goto(page.url())
  await settle(page)
  await page.setInputFiles('#input_import_file', path.join(dir, 'books.csv'))
  await page.selectOption('#plugins', 'binary')
  await page.click('#buttonGo')
  const binMsg = await notice(page)
  check('a text file imported as COPY binary is refused', /signature of COPY's binary format/.test(binMsg), binMsg)
  await clearNotices(page)
  await close()
}

// Upload limits: PHP's (2 MiB here) is checked in the browser; nginx's 1 MiB default answers 413.
{
  const { page, close } = await open('/db/tools_import/import')
  const label = await page.locator('label[for=input_import_file]').innerText()
  check('the page shows the PHP upload limit', /Max: 2,048KiB/.test(label), label)
  const big = write('big.sql', `-- ${'x'.repeat(3 * 1024 * 1024)}\n`)
  await page.setInputFiles('#input_import_file', big)
  await page.click('#buttonGo')
  let message = await notice(page)
  check('a file over upload_max_filesize is refused before upload', /larger than PHP accepts/.test(message), message)
  await clearNotices(page)
  const mid = write('mid.sql', `-- ${'x'.repeat(1536 * 1024)}\n`)
  await page.goto(page.url())
  await settle(page)
  page.on('response', (r) => r.url().endsWith('/api/import') && console.log('  import response', r.status()))
  await page.setInputFiles('#input_import_file', mid)
  await page.click('#buttonGo')
  message = await notice(page, 15000)
  check('a file over the web server limit gets its 413', /larger than the web server accepts/.test(message), message)
  await clearNotices(page)
  await close()
}

// A long import: it survives a reload of the page, and Stop cancels it.
{
  const { page, close } = await open('/db/tools_import/import')
  await runImport(page, write('slow.sql', "SELECT 'started';\nSELECT pg_sleep(60);\nSELECT 'never';\n"), async () => {}, { wait: false })
  await page.waitForTimeout(1500)
  await page.reload()
  await settle(page, 1500)
  const card = page.locator('[id^=import_process_]').first()
  check('a running import is shown again after a reload', /Importing slow\.sql/.test(await card.innerText()))
  await shot(page, 'tools/import-running.png', { selector: '[id^=import_process_]' })
  await card.locator('button', { hasText: 'Stop' }).click()
  await card.locator('.alert:not(.alert-primary)').waitFor({ timeout: 20000 })
  const text = await card.innerText()
  check('Stop cancels the import', /was stopped/.test(text) && psql("SELECT count(*) FROM pg_stat_activity WHERE query LIKE 'SELECT pg_sleep(60)%'") === '0', text)
  await dismissAll(page)
  await close()
}

psql('DROP DATABASE IF EXISTS tools_import WITH (FORCE)', 'postgres')
fs.rmSync(dir, { recursive: true, force: true })
summary()
await done()
