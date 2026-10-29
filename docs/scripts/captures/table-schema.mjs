// Screenshots and the clip for docs/schema/structure.md and docs/schema/create-table.md.
// Run: node docs/scripts/captures/table-schema.mjs
import { shot, record, settle, type, done } from '../capture.mjs'
import { open, psql, closeModal, modalShot } from './table-lib.mjs'

const SCHEMA = '/db/bookshop/schema/public'
const WIDE = { width: 1680, height: 900 }
psql('DROP TABLE IF EXISTS public.tbl_cap_shelf, public.tbl_cap_clip')

// The schema's Structure page: the table list, the With selected bar and the create card.
{
  const { page, close } = await open(SCHEMA)
  await page.fill('#filter_field', '')
  await shot(page, 'schema/tables-structure.png')
  await shot(page, 'schema/tables-with-selected.png', { selector: '#tablesForm .clearfloat' })
  await shot(page, 'schema/tables-create-card.png', { selector: '#createTableMinimalForm' })
  // Row count: the estimate (~n) turns into the exact count on click.
  await page.locator('#tablesForm tbody tr', { has: page.locator('th a:text-is("customers")') }).locator('a.real_row_count').click()
  await settle(page, 800)
  // Empty asks first and shows the TRUNCATE statement.
  await page.locator('#tablesForm tbody tr', { has: page.locator('th a:text-is("authors")') }).locator('a.truncate_table_anchor').click()
  await settle(page)
  await modalShot(page, 'schema/tables-empty-confirm.png', '#confirm_dialog .modal-content')
  await page.click('#confirm_dialog .submitCancel')
  await close()
}

// The create form filled in, and its Preview SQL.
{
  // The form is wider than 1280 px, so these shots use a wider window.
  const { page, close } = await open(`${SCHEMA}/create-table?name=tbl_cap_shelf&columns=4`, { viewport: WIDE })
  await page.fill('input[name="field_name[0]"]', 'id')
  await page.selectOption('select[name="field_type[0]"]', 'bigint')
  await page.uncheck('input[name="field_null[0]"]')
  await page.selectOption('select[name="field_key[0]"]', 'primary')
  await page.check('input[name="field_extra[0]"]')
  await page.fill('input[name="field_name[1]"]', 'label')
  await page.selectOption('select[name="field_type[1]"]', 'character varying')
  await page.fill('input[name="field_length[1]"]', '80')
  await page.selectOption('select[name="field_key[1]"]', 'unique')
  await page.fill('textarea[name="field_comments[1]"]', 'Shown on the shelf')
  await page.fill('input[name="field_name[2]"]', 'price')
  await page.selectOption('select[name="field_type[2]"]', 'numeric')
  await page.fill('input[name="field_length[2]"]', '8,2')
  await page.selectOption('select[name="field_default_type[2]"]', 'USER_DEFINED')
  await page.fill('input[name="field_default_value[2]"]', '0')
  await page.fill('input[name="field_name[3]"]', 'tags')
  await page.selectOption('select[name="field_type[3]"]', 'text')
  await page.selectOption('select[name="field_attribute[3]"]', '[]')
  await page.selectOption('select[name="field_key[3]"]', 'index')
  await page.fill('input[name="comment"]', 'Scratch table for the docs')
  await shot(page, 'schema/tables-create-form.png')
  await page.click('input.preview_sql')
  await page.locator('.modal.show code:has-text("CREATE INDEX")').waitFor()
  await settle(page, 800)
  await modalShot(page, 'schema/tables-create-preview.png', '.modal.show .modal-content', 900)
  await closeModal(page)
  await close()
}

// A short clip: create a table with two columns from the Structure page's card.
await record('schema/tables-create-table.mp4', SCHEMA, async (page) => {
  await page.locator('#createTableMinimalForm').scrollIntoViewIfNeeded()
  await type(page, '#createTableNameInput', 'tbl_cap_clip')
  await page.fill('#createTableNumFieldsInput', '2')
  await page.waitForTimeout(500)
  await page.click('#createTableMinimalForm input[type=submit]')
  await settle(page, 800)
  await type(page, 'input[name="field_name[0]"]', 'id')
  await page.selectOption('select[name="field_type[0]"]', 'bigint')
  await page.selectOption('select[name="field_key[0]"]', 'primary')
  await page.check('input[name="field_extra[0]"]')
  await type(page, 'input[name="field_name[1]"]', 'title')
  await page.selectOption('select[name="field_type[1]"]', 'text')
  await page.uncheck('input[name="field_null[1]"]')
  await page.waitForTimeout(600)
  await page.click('input.preview_sql')
  await settle(page, 1500)
  await page.waitForTimeout(1500)
  await closeModal(page)
  await page.click('input[name=do_save_data]')
  await settle(page, 1500)
  await page.waitForTimeout(1500)
}, { viewport: WIDE })

psql('DROP TABLE IF EXISTS public.tbl_cap_shelf, public.tbl_cap_clip')
await done()
