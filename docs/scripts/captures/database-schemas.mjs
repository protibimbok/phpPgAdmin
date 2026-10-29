// Database Structure (schema list), Show create, and the schema Operations tab: verifies each
// action on scratch schemas (dbo_schema*) in bookshop and captures the screenshots for
// docs/database/schemas.md and docs/schema/operations.md. Drops the scratch schemas at the end.
//   node docs/scripts/captures/database-schemas.mjs
import { open, shot, done, settle, APP } from '../capture.mjs'
import { psql, message, clearMessage, previewText, closeModal, check, openRetry, shotEl } from './database-lib.mjs'

const DB = 'bookshop'
const scratch = ['dbo_schema', 'dbo_schema_a', 'dbo_schema_b', 'dbo_schema_full', 'dbo_schema_renamed', 'dbo_schema_drop']
const reset = () => psql(scratch.map((s) => `DROP SCHEMA IF EXISTS ${s} CASCADE;`).join(' '), DB)
reset()
const q = (sql) => psql(sql, DB)

const { page, close } = await openRetry(open, `/db/${DB}`)
const goto = async (route) => { await page.goto(APP + route); await settle(page) }

// --- The database's Structure page
await shot(page, 'database/structure.png')
await shotEl(page, 'database/create-schema.png', '#createSchemaMinimalForm')
q(`CREATE SCHEMA dbo_schema; COMMENT ON SCHEMA dbo_schema IS 'Scratch schema for the docs'; CREATE TABLE dbo_schema.notes (id int)`)

// Create with owner
await page.fill('#createSchemaNameInput', 'dbo_schema_a')
await page.selectOption('#createSchemaOwnerSelect', 'bookshop_staff')
await page.locator('#createSchemaMinimalForm input[type=submit]').click()
console.log('create a:', await message(page), q(`SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='dbo_schema_a'`))
await clearMessage(page)
// Create without owner (the current role)
await page.fill('#createSchemaNameInput', 'dbo_schema_b')
await page.selectOption('#createSchemaOwnerSelect', '')
await page.locator('#createSchemaMinimalForm input[type=submit]').click()
console.log('create b:', await message(page), q(`SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='dbo_schema_b'`))
await clearMessage(page)
// Duplicate name
await page.fill('#createSchemaNameInput', 'dbo_schema_b')
await page.locator('#createSchemaMinimalForm input[type=submit]').click()
console.log('create duplicate:', await message(page))
await clearMessage(page)
// pg_ prefix
await page.fill('#createSchemaNameInput', 'pg_dbo')
await page.locator('#createSchemaMinimalForm input[type=submit]').click()
console.log('create pg_:', await message(page))
await clearMessage(page)

// With selected: Drop two schemas
await settle(page)
for (const s of ['dbo_schema_a', 'dbo_schema_b']) await page.check(`input[name="selected_schema[]"][value="${s}"]`)
await page.selectOption('select[name=submit_mult]', 'drop')
await page.waitForSelector('#confirm_dialog')
await shotEl(page, 'database/drop-schemas-confirm.png', '#confirm_dialog .modal-content')
await page.click('#confirm_dialog .submitOK')
console.log('with selected drop:', await message(page), q(`SELECT count(*) FROM pg_namespace WHERE nspname IN ('dbo_schema_a','dbo_schema_b')`))
await clearMessage(page)
// With selected with nothing checked
await page.selectOption('select[name=submit_mult]', 'drop')
console.log('drop none selected:', await message(page))
await clearMessage(page)

// Drop a non-empty schema without CASCADE, then with
q(`CREATE SCHEMA dbo_schema_full; CREATE TABLE dbo_schema_full.t (id int)`)
await goto(`/db/${DB}`)
await page.locator('tr', { has: page.locator('a', { hasText: /^dbo_schema_full$/ }) }).locator('.drop_schema_anchor').click()
await page.click('#confirm_dialog .submitOK')
console.log('drop non-empty:', await message(page))
await clearMessage(page)
await page.locator('tr', { has: page.locator('a', { hasText: /^dbo_schema_full$/ }) }).locator('.drop_schema_anchor').click()
await page.check('#dropSchemaCascade')
console.log('cascade dialog:', (await page.locator('#confirm_dialog .modal-body').innerText()).replace(/\n+/g, ' | '))
await page.click('#confirm_dialog .submitOK')
console.log('drop cascade:', await message(page), q(`SELECT count(*) FROM pg_namespace WHERE nspname='dbo_schema_full'`))
await clearMessage(page)

// Browse link target
console.log('browse href:', await page.locator('tr', { has: page.locator('a', { hasText: /^inventory$/ }) }).locator('a', { hasText: 'Browse' }).getAttribute('href'))

// --- Show create
await goto(`/db/${DB}/ddl`)
await shot(page, 'database/show-create.png')

// --- Schema operations
await goto(`/db/${DB}/schema/dbo_schema/operations`)
await shot(page, 'database/schema-operations.png')
await page.fill('#schemaCommentInput', 'Renamed scratch schema')
await page.locator('#formSchemaComment .preview_sql').click()
console.log('comment preview:', await previewText(page))
await closeModal(page)
await page.locator('#formSchemaComment input[type=submit]').click()
console.log('comment:', await message(page), q(`SELECT obj_description('dbo_schema'::regnamespace, 'pg_namespace')`))
await clearMessage(page)

await page.selectOption('#schemaOwnerSelect', 'bookshop_staff')
await page.locator('#schema_properties_form .preview_sql').click()
console.log('owner preview:', await previewText(page))
await closeModal(page)
await page.locator('#schema_properties_form input[type=submit]').click()
console.log('owner:', await message(page), q(`SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='dbo_schema'`))
await clearMessage(page)

await page.fill('#new_schema_name', 'dbo_schema_renamed')
await page.locator('#rename_schema_form .preview_sql').click()
console.log('rename preview:', await previewText(page))
await closeModal(page)
await page.locator('#rename_schema_form input[type=submit]').click()
console.log('rename:', await message(page), page.url())
await clearMessage(page)
await settle(page)
await page.fill('#new_schema_name', 'dbo_schema')
await page.locator('#rename_schema_form input[type=submit]').click()
console.log('rename back:', await message(page), page.url())
await clearMessage(page)
await settle(page)

// Drop (no cascade) a schema with a table -> error; then DROP … CASCADE
await page.click('#drop_schema_anchor')
await page.click('#confirm_dialog .submitOK')
console.log('schema ops drop non-empty:', await message(page))
await clearMessage(page)
await page.click('#drop_schema_cascade_anchor')
await shotEl(page, 'database/schema-drop-cascade.png', '#confirm_dialog .modal-content')
await page.click('#confirm_dialog .submitOK')
console.log('schema ops drop cascade:', await message(page), page.url(), q(`SELECT count(*) FROM pg_namespace WHERE nspname='dbo_schema'`))
await clearMessage(page)

// The public schema's Operations (owned by pg_database_owner)
await goto(`/db/${DB}/schema/public/operations`)
console.log('public owner select:', await page.locator('#schemaOwnerSelect').inputValue())

await close()
await done()
reset()
