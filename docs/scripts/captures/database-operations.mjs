// Database Operations tab: verifies each card on a scratch database and captures the screenshots
// for docs/database/operations.md. Creates dbo_scratch (and dbo_scratch_copy) and drops them at the end.
//   node docs/scripts/captures/database-operations.mjs
import { open, shot, done, settle } from '../capture.mjs'
import { psql, message, clearMessage, previewText, closeModal, check, openRetry, shotEl } from './database-lib.mjs'

const DB = 'dbo_scratch'
const COPY = 'dbo_scratch_copy'
const RENAMED = 'dbo_scratch_renamed'
for (const name of [COPY, RENAMED]) psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
if (psql(`SELECT count(*) FROM pg_database WHERE datname = '${DB}'`) === '0') psql(`CREATE DATABASE ${DB}`)
psql(`COMMENT ON DATABASE ${DB} IS NULL; ALTER DATABASE ${DB} WITH CONNECTION LIMIT -1 ALLOW_CONNECTIONS true IS_TEMPLATE false; ALTER DATABASE ${DB} OWNER TO postgres`)

const row = (sql) => psql(sql)
const { page, close } = await openRetry(open, `/db/${DB}/operations`)
const go = (form) => page.locator(`${form} input[type=submit]`).click()
const preview = (form) => page.locator(`${form} .preview_sql`).click()

await shot(page, 'database/operations-overview.png')

// Comment
await page.fill('#databaseCommentInput', 'Scratch database for the docs')
await preview('#formDatabaseComment')
const commentSql = await previewText(page)
await shotEl(page, 'database/operations-preview-sql.png', '.modal.show .modal-content')
await closeModal(page)
check('comment preview', commentSql.includes("COMMENT ON DATABASE dbo_scratch"), commentSql)
await go('#formDatabaseComment')
check('comment saved', (await message(page)) !== '' && row(`SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname='${DB}'`) === 'Scratch database for the docs')
await clearMessage(page)

// Unchanged form: "nothing to change"
await go('#formDatabaseComment')
check('unchanged comment says nothing to change', /nothing/i.test(await message(page)), await message(page))
await clearMessage(page)

// Properties: owner, connection limit, allow connections, template
await page.selectOption('#dbOwnerSelect', 'bookshop_staff')
await page.fill('#dbConnLimitInput', '0')
await page.uncheck('#checkbox_allow_connections')
await page.check('#checkbox_is_template')
await preview('#db_properties_form')
const propSql = await previewText(page)
await closeModal(page)
console.log(propSql)
check('properties preview has owner/limit 0/allow/template', /OWNER TO bookshop_staff/.test(propSql) && /CONNECTION LIMIT = 0/.test(propSql) && /ALLOW_CONNECTIONS = false/.test(propSql) && /IS_TEMPLATE = true/.test(propSql))
await shotEl(page, 'database/operations-properties.png', '#db_properties_form')
await go('#db_properties_form')
console.log('props message:', await message(page))
console.log('catalog:', row(`SELECT pg_get_userbyid(datdba), datconnlimit, datallowconn, datistemplate FROM pg_database WHERE datname='${DB}'`))
await clearMessage(page)

// Back to normal
await settle(page)
await page.selectOption('#dbOwnerSelect', 'postgres')
await page.fill('#dbConnLimitInput', '-1')
await page.check('#checkbox_allow_connections')
await page.uncheck('#checkbox_is_template')
await go('#db_properties_form')
console.log('props back:', await message(page), row(`SELECT pg_get_userbyid(datdba), datconnlimit, datallowconn, datistemplate FROM pg_database WHERE datname='${DB}'`))
await clearMessage(page)

// Tablespace pg_global
await settle(page)
await page.selectOption('#dbTablespaceSelect', 'pg_global')
await preview('#db_properties_form')
console.log('tablespace preview:', await previewText(page))
await closeModal(page)
await go('#db_properties_form')
console.log('tablespace pg_global:', await message(page))
await clearMessage(page)
await page.selectOption('#dbTablespaceSelect', 'pg_default')

// Create new table card
await page.fill('#createTableNameInput', 'dbo_new_table')
await page.fill('#createTableNumFieldsInput', '3')
await shotEl(page, 'database/operations-create-table.png', '#createTableMinimalForm')
await page.locator('#createTableMinimalForm input[type=submit]').click()
await settle(page)
check('create table card navigates', page.url().includes('/schema/public/create-table') && page.url().includes('dbo_new_table'), page.url())
await page.goto(`http://phppgadmin.test/db/${DB}/operations`)
await settle(page)

// Copy database
await page.fill('#copyDbNameInput', COPY)
await preview('#copy_db_form')
const copySql = await previewText(page)
await closeModal(page)
console.log('copy preview:', copySql)
await shotEl(page, 'database/operations-copy.png', '#copy_db_form')
await go('#copy_db_form')
console.log('copy:', await message(page, 15000), row(`SELECT count(*) FROM pg_database WHERE datname='${COPY}'`))
await clearMessage(page)

// Copy while another session is connected to the source
const blocker = (await import('node:child_process')).spawn('psql', ['-h', 'localhost', '-p', '5499', '-U', 'postgres', '-d', DB, '-c', 'SELECT pg_sleep(20)'])
await page.waitForTimeout(1000)
await page.fill('#copyDbNameInput', `${COPY}2`)
await go('#copy_db_form')
const busyCopy = await message(page, 15000)
console.log('copy with session:', busyCopy)
await shotEl(page, 'database/operations-copy-busy.png', '.ajax_notification')
await clearMessage(page)

// Rename while connected elsewhere, then without
await page.fill('#new_db_name', RENAMED)
await go('#rename_db_form')
console.log('rename with session:', await message(page, 15000))
await clearMessage(page)
blocker.kill()
await page.waitForTimeout(1500)
psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB}' AND pid <> pg_backend_pid()`)
await page.fill('#new_db_name', RENAMED)
await preview('#rename_db_form')
console.log('rename preview:', await previewText(page))
await closeModal(page)
await go('#rename_db_form')
console.log('rename:', await message(page, 15000), page.url())
await clearMessage(page)
await settle(page)
await page.fill('#new_db_name', DB)
await go('#rename_db_form')
console.log('rename back:', await message(page, 15000), page.url())
await clearMessage(page)

// Drop the copy: confirm dialog, with a session open (fails), then with Force
await page.goto(`http://phppgadmin.test/db/${COPY}/operations`)
await settle(page)
const blocker2 = (await import('node:child_process')).spawn('psql', ['-h', 'localhost', '-p', '5499', '-U', 'postgres', '-d', COPY, '-c', 'SELECT pg_sleep(20)'])
await page.waitForTimeout(1000)
await page.click('#drop_db_anchor')
await page.waitForSelector('#confirm_dialog')
await shotEl(page, 'database/operations-drop-confirm.png', '#confirm_dialog .modal-content')
await page.click('#confirm_dialog .submitOK')
console.log('drop with session:', await message(page, 15000))
await clearMessage(page)
await page.click('#drop_db_anchor')
await page.check('#dropDatabaseForce')
console.log('force sql:', await page.locator('#confirm_dialog').innerText())
await page.click('#confirm_dialog .submitOK')
console.log('drop force:', await message(page, 15000), page.url(), row(`SELECT count(*) FROM pg_database WHERE datname='${COPY}'`))
blocker2.kill()

// Drop the database the session is connected to? Only possible for the maintenance db; try postgres' Operations
await page.goto('http://phppgadmin.test/db/postgres/operations')
await settle(page)
await page.click('#drop_db_anchor')
const pgDropSql = await page.locator('#confirm_dialog').innerText()
console.log('postgres drop dialog:', pgDropSql.replace(/\n+/g, ' | '))
await page.click('#confirm_dialog .submitCancel')

await close()
await done()
psql(`COMMENT ON DATABASE ${DB} IS NULL`)
for (const name of [COPY, `${COPY}2`, RENAMED]) psql(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
psql('DROP DATABASE IF EXISTS dbo_scratch WITH (FORCE)')
