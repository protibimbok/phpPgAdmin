// Screenshots and clips for docs/tools/sql.md: the SQL tab at its levels, completions, results,
// batches, EXPLAIN, bind parameters, cancelling, confirmation and "Create view".
// Run: node docs/scripts/captures/sql.mjs
import { done, settle, shot } from '../capture.mjs'
import { createScratch, dropScratch, go, openRetry, recordClip, setSql, snap } from './sql-common.mjs'

createScratch()
try {
  // The SQL tab of a table: quick buttons and the column list.
  {
    const { page, close } = await openRetry('/db/bookshop/schema/public/table/books/sql')
    await shot(page, 'sql/sql-tab-table.png')
    await close()
  }

  {
    const { page, close } = await openRetry('/db/bookshop/sql')
    await page.check('#retain_query_box')
    await page.check('#checkbox_show_query')

    // One SELECT: message, statement, links, navigation bar.
    await setSql(page, 'SELECT id, title, price FROM books WHERE price > 36')
    await go(page)
    await snap(page, 'sql/select-result.png', '#sqlqueryresultsouter .sqlqueryresults')

    // A batch: rows, a NOTICE, and an error that stops the batch.
    await setSql(page, "SELECT count(*) AS books FROM books;\nDO $$BEGIN RAISE NOTICE 'checked % books', 65; END$$;\nSELECT nope FROM books;\nSELECT 'never runs'")
    await go(page)
    await snap(page, 'sql/batch-result.png', '#sqlqueryresultsouter')

    // EXPLAIN of a SELECT, from the "Explain SQL" link.
    await setSql(page, 'SELECT * FROM books WHERE author_id = 3')
    await go(page)
    await page.click('a:has-text("Explain SQL")')
    await settle(page, 700)
    await page.locator('button[id^=extraOptionsButton]').first().click()
    await page.locator('input[name=pftext][value=F]').first().check()
    await page.locator('.collapse.show input[type=submit]').first().click()
    await snap(page, 'sql/explain.png', '#sqlqueryresultsouter .sqlqueryresults')

    // Bind parameters.
    await setSql(page, 'SELECT id, title FROM books WHERE author_id = :author AND price > :min_price')
    await page.check('#parameterized')
    await page.fill('#parameter_author', '3')
    await page.fill('#parameter_min_price', '20')
    await snap(page, 'sql/bind-parameters.png', '#queryfieldscontainer')
    await page.uncheck('#parameterized')

    // A long statement in a batch, with its Cancel link.
    await setSql(page, 'SELECT 1 AS warm_up;\nSELECT pg_sleep(4)')
    await page.click('#button_submit_query')
    await page.waitForTimeout(900)
    await snap(page, 'sql/running.png', '#sqlqueryform .card-body')
    await page.click('#querymessage a')
    await settle(page, 700)

    // The confirmation a DELETE asks for.
    await setSql(page, 'DELETE FROM sql_books WHERE id = 1')
    await page.click('#button_submit_query')
    await page.waitForSelector('.modal.show')
    await snap(page, 'sql/confirm-delete.png', '.modal.show .modal-content')
    await page.click('.modal.show button:has-text("Cancel")')

    // "Create view" under a result.
    await setSql(page, 'SELECT id, title, price FROM books WHERE price > 36')
    await go(page)
    await page.click('a.create_view')
    await settle(page, 700)
    await snap(page, 'sql/create-view.png', '#createViewModal .modal-content')
    await close()
  }

  // Completions: keywords, schema-qualified tables, then a table's columns.
  // SKIP_CLIPS=1 leaves the clips as they are.
  if (!process.env.SKIP_CLIPS) await recordClip('sql/autocomplete.mp4', '/db/bookshop/sql', async (page) => {
    await page.click('#sqlqueryform .cm-content')
    await page.keyboard.type('SELECT ', { delay: 70 })
    await page.waitForTimeout(300)
    await page.keyboard.type('* FROM inventory.', { delay: 70 })
    await page.waitForTimeout(1200)
    await page.keyboard.type('st', { delay: 120 })
    await page.waitForTimeout(900)
    await page.keyboard.press('Enter')
    await page.keyboard.type(' s WHERE s.', { delay: 70 })
    await page.waitForTimeout(1300)
    await page.keyboard.type('qu', { delay: 120 })
    await page.waitForTimeout(800)
    await page.keyboard.press('Enter')
    await page.keyboard.type(' < 5', { delay: 70 })
    await page.waitForTimeout(500)
    await page.keyboard.press('Control+Enter')
    await settle(page, 1200)
  })
} finally {
  dropScratch()
  await done()
}

