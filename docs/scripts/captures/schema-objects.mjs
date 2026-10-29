// Screenshots and the clip for docs/schema/views.md, routines.md and sequences.md.
//
//   node docs/scripts/captures/schema-objects.mjs
//
// Seed objects (book_catalogue, author_stats, invoice_number, the routines) are only looked at.
// Everything this script changes is a scratch object named rtn_*, created here and dropped again
// at the end, so it can be rerun.
import { shot, record, type, settle, done, APP } from '../capture.mjs'
import { psql, openRetry } from './schema-objects-lib.mjs'

const DB = 'bookshop'
const SCHEMA = `/db/${DB}/schema/public`

async function go(page, route) {
  await page.goto(APP + route, { waitUntil: 'domcontentloaded' })
  await settle(page, 700)
}

const CLEANUP = `
DROP VIEW IF EXISTS public.rtn_cheap_books CASCADE;
DROP MATERIALIZED VIEW IF EXISTS public.rtn_author_books CASCADE;
DROP FUNCTION IF EXISTS public.rtn_price_band(numeric, numeric);
DROP FUNCTION IF EXISTS public.rtn_books_between(numeric, numeric);
DROP SEQUENCE IF EXISTS public.rtn_seq;
`

psql(CLEANUP)

// Views -------------------------------------------------------------------------------------

{
  const { page, close } = await openRetry(`${SCHEMA}/create-view`)
  await page.fill('#view_name', 'rtn_cheap_books')
  await page.fill('#view_column_names', 'book_id, title, price')
  await page.locator('.view-as .cm-content').first().click()
  await page.keyboard.type('select id, title, price from books where price < 20')
  await page.click('#format')
  await page.selectOption('select[name="view[with]"]', 'LOCAL')
  await page.check('#view_security_barrier')
  await page.waitForTimeout(300)
  await shot(page, 'schema/views-create-form.png', { selector: '#div_view_options' })
  await page.click('#view_form input[type=submit]')
  await settle(page, 1200)

  await go(page, `${SCHEMA}/view/book_catalogue`)
  await shot(page, 'schema/views-structure.png')

  await go(page, `${SCHEMA}/mview/author_stats`)
  await shot(page, 'schema/views-mview-information.png', { selector: '#tablestatistics' })

  await go(page, `${SCHEMA}/mview/author_stats/operations`)
  await shot(page, 'schema/views-mview-operations.png', { fullPage: true })

  // "Create view" under a query's results opens the form in a modal.
  await go(page, `/db/${DB}/sql`)
  await page.locator('.cm-content').first().click()
  await page.keyboard.type('SELECT id, title, price FROM public.books WHERE price > 30')
  await page.locator('input[type=submit][value=Go], button:has-text("Go")').first().click()
  await settle(page, 1500)
  await page.locator('a.create_view').first().click()
  await page.waitForTimeout(1200)
  await shot(page, 'schema/views-create-from-results.png', { selector: '#createViewModal .modal-content' })
  await close()
}

// Routines ----------------------------------------------------------------------------------

{
  const { page, close } = await openRetry(`${SCHEMA}/routines`)
  await page.fill('#filterText', 'b')
  await page.waitForTimeout(300)
  await shot(page, 'schema/routines-list.png')

  await go(page, `${SCHEMA}/routines/create`)
  await page.fill('input[name=item_name]', 'rtn_price_band')
  await page.click('#addRoutineParameterButton')
  await page.click('#addRoutineParameterButton')
  await page.fill('input[name="item_param_name[0]"]', 'lo')
  await page.fill('input[name="item_param_type[0]"]', 'numeric')
  await page.fill('input[name="item_param_name[1]"]', 'hi')
  await page.fill('input[name="item_param_type[1]"]', 'numeric')
  await page.fill('input[name="item_param_default[1]"]', '1000')
  await page.fill('input[name=item_returntype]', 'books')
  await page.check('input[name=item_returns_set]')
  await page.locator('.routine-definition .cm-content').click()
  await page.keyboard.type('BEGIN\n  RETURN QUERY SELECT * FROM books WHERE price BETWEEN lo AND hi;\nEND')
  await page.selectOption('select[name=item_volatility]', 's')
  await page.selectOption('select[name=item_securitytype]', 'DEFINER')
  await page.selectOption('select[name=item_parallel]', 's')
  await page.fill('input[name=item_rows]', '20')
  await page.fill('input[name=item_comment]', 'Books in a price band')
  await page.click('button:has-text("Add variable")')
  await page.locator('input[placeholder="Name"]').last().fill('search_path')
  await page.locator('input[placeholder="Value"]').last().fill('public, pg_temp')
  await shot(page, 'schema/routines-editor.png', { selector: 'form.rte_form' })
  await page.click('form.rte_form input[type=submit]')
  await settle(page, 1500)

  await page.fill('#filterText', 'rtn_price_band')
  await page.locator('tr:has-text("rtn_price_band") a.exec_anchor').first().click()
  await page.waitForTimeout(1200)
  await page.locator('.modal.show input[aria-label=lo]').fill('10')
  await page.locator('.modal.show input[aria-label=hi]').fill('12')
  await shot(page, 'schema/routines-execute.png', { selector: '.modal.show .modal-content' })
  await page.keyboard.press('Escape')

  const oid = psql("SELECT 'public.apply_discount'::regproc::oid")
  await go(page, `${SCHEMA}/routines/function/${oid}/edit`)
  await page.waitForTimeout(1200)
  await page.locator('h2:has-text("Statistics"), .card:has-text("Statistics")').first().scrollIntoViewIfNeeded().catch(() => {})
  await shot(page, 'schema/routines-panels.png', { selector: '#page_content', fullPage: true })
  await close()
}

await record('schema/routines-create-execute.mp4', `${SCHEMA}/routines/create`, async (page) => {
  await type(page, 'input[name=item_name]', 'rtn_books_between')
  await page.click('#addRoutineParameterButton')
  await page.fill('input[name="item_param_name[0]"]', 'lo')
  await page.fill('input[name="item_param_type[0]"]', 'numeric')
  await page.click('#addRoutineParameterButton')
  await page.fill('input[name="item_param_name[1]"]', 'hi')
  await page.fill('input[name="item_param_type[1]"]', 'numeric')
  await page.fill('input[name=item_returntype]', 'bigint')
  await page.locator('.routine-definition .cm-content').click()
  await page.keyboard.type('BEGIN\n  RETURN (SELECT count(*) FROM books WHERE price BETWEEN lo AND hi);\nEND', { delay: 15 })
  await page.selectOption('select[name=item_volatility]', 's')
  await page.waitForTimeout(600)
  await page.click('form.rte_form input[type=submit]')
  await settle(page, 1200)
  await type(page, '#filterText', 'rtn_books')
  await page.waitForTimeout(500)
  await page.locator('tr:has-text("rtn_books_between") a.exec_anchor').first().click()
  await page.waitForTimeout(1000)
  await type(page, '.modal.show input[aria-label=lo]', '10')
  await type(page, '.modal.show input[aria-label=hi]', '20')
  await page.waitForTimeout(400)
  await page.locator('.modal.show button:has-text("Go")').click()
  await settle(page, 1500)
})

// Sequences ---------------------------------------------------------------------------------

{
  psql('CREATE SEQUENCE public.rtn_seq INCREMENT 5 START 100 MINVALUE 100 MAXVALUE 200 CACHE 10 CYCLE')
  const { page, close } = await openRetry(`${SCHEMA}/sequences`)
  await shot(page, 'schema/sequences-list.png')
  await go(page, `${SCHEMA}/sequences/invoice_number/edit`)
  await page.waitForTimeout(1200)
  await shot(page, 'schema/sequences-editor.png', { fullPage: true })
  await close()
}

psql(CLEANUP)
await done()
