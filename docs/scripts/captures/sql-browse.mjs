// Screenshots and clips for docs/table/browse.md, docs/table/insert.md, docs/table/search.md and
// docs/database/search.md. Edits only the scratch tables sql_books and sql_types.
// Run: node docs/scripts/captures/sql-browse.mjs   (SKIP_CLIPS=1 leaves the clips alone)
import { done, settle, shot } from '../capture.mjs'
import { createScratch, dropScratch, openRetry, recordClip, snap } from './sql-common.mjs'

const T = '/db/bookshop/schema/public/table'

createScratch()
try {
  // Browse: the page, the extra options, how types display, distinct values.
  {
    const { page, close } = await openRetry(`${T}/books/browse`)
    await shot(page, 'sql/browse.png')
    await page.locator('button[id^=extraOptionsButton]').first().click()
    await snap(page, 'sql/browse-extra-options.png', 'form[name=displayOptionsForm]')

    await page.goto(`http://phppgadmin.test${T}/sql_types/browse`)
    await settle(page)
    await snap(page, 'sql/browse-types.png', 'table.table_results')

    await page.goto(`http://phppgadmin.test${T}/books/browse?distinct=publisher_id`)
    await settle(page)
    await snap(page, 'sql/browse-distinct.png', '.sqlqueryresults')

    // With selected → Delete on the scratch copy: the Preview SQL modal (closed, nothing deleted).
    await page.goto(`http://phppgadmin.test${T}/sql_books/browse`)
    await settle(page)
    const rows = page.locator('table.table_results tbody tr')
    await rows.nth(1).locator('input.multi_checkbox').check()
    await rows.nth(2).locator('input.multi_checkbox').check()
    await page.locator('button.mult_submit[title=Delete]').click()
    await page.waitForSelector('.modal.show')
    await settle(page)
    await snap(page, 'sql/bulk-delete-preview.png', '.modal.show .modal-content')
    await page.click('.modal.show button:has-text("Close")')
    await close()
  }

  // Insert form and its actions on the many-types table; the edit form of a seed row (not saved).
  {
    const { page, close } = await openRetry(`${T}/sql_types/insert`)
    await snap(page, 'sql/insert-form.png', 'table.insertRowTable')
    await page.fill('[name="fields[0][note]"]', 'typed in the form')
    await page.selectOption('select[name="funcs[0][uid]"]', 'GEN_RANDOM_UUID')
    await snap(page, 'sql/insert-actions.png', '#actions_panel')
    await page.click('input.preview_sql')
    await page.waitForSelector('.modal.show')
    await settle(page)
    await snap(page, 'sql/insert-preview.png', '.modal.show .modal-content')
    await page.click('.modal.show button:has-text("Close")')

    await page.goto(`http://phppgadmin.test${T}/books/change?keys=${encodeURIComponent('[{"id":"1"}]')}`)
    await settle(page, 800)
    await snap(page, 'sql/edit-row.png', 'table.insertRowTable')
    await close()
  }

  // Table search: criteria, extra options, results.
  {
    const { page, close } = await openRetry(`${T}/books/search`)
    await page.selectOption('#ColumnOperator2', 'ILIKE %...%')
    await page.fill('#fieldID_2', 'guards')
    await page.selectOption('#ColumnOperator7', '<')
    await page.fill('#fieldID_7', '30')
    await page.click('button:has-text("Extra options")')
    await page.selectOption('#columnsToDisplaySelect', ['id', 'title', 'price'])
    await page.selectOption('#orderByColumnSelect', 'price')
    await page.check('#orderByDescRadio')
    await snap(page, 'sql/table-search.png', '#tbl_search_form')
    await page.click('#tbl_search_form input[type=submit]')
    await settle(page, 800)
    await snap(page, 'sql/table-search-results.png', '#sqlqueryresultsouter .sqlqueryresults')
    await close()
  }

  // Database search: the form, results (customers left out; see the page), object search.
  {
    const { page, close } = await openRetry('/db/bookshop/search')
    await page.fill('#criteriaSearchString', 'guards')
    await snap(page, 'sql/db-search.png', '#db_search_form')
    // The seed's relations only (other scratch objects may exist), without customers.
    const seed = ['audit_log', 'author_stats', 'authors', 'book_catalogue', 'books', 'ebooks', 'order_items', 'orders', 'publishers', 'reviews'].map((t) => `public.${t}`)
    const keep = await page.locator('#criteriaTables option').evaluateAll((os, seed) => os.map((o) => o.value).filter((v) => seed.includes(v) || /^inventory\.(warehouses|stock|promotions)$/.test(v)), seed)
    await page.selectOption('#criteriaTables', keep)
    await page.click('#buttonGo')
    await page.waitForSelector('#searchresults')
    await snap(page, 'sql/db-search-results.png', '#searchresults')
    await page.fill('#objectSearchString', 'book')
    await page.selectOption('#objectSearchType', 'column')
    await page.click('#object_search_form input[type=submit]')
    await page.waitForSelector('#objectresults')
    await snap(page, 'sql/object-search-results.png', '#objectresults')
    await close()
  }

  // Double-click editing in the grid of the scratch copy: a title, then a NULL.
  if (!process.env.SKIP_CLIPS) {
    await recordClip('sql/inline-edit.mp4', `${T}/sql_books/browse`, async (page) => {
      const row = (n) => page.locator('table.table_results tbody tr').nth(n)
      await row(1).locator('td.grid_edit').nth(1).dblclick()
      await page.waitForTimeout(700)
      await page.keyboard.press('End')
      await page.keyboard.type(' (signed copy)', { delay: 70 })
      await page.waitForTimeout(500)
      await page.keyboard.press('Enter')
      await settle(page, 1500)
      await row(2).locator('td.grid_edit').nth(3).dblclick()
      await page.waitForTimeout(900)
      await page.locator('.cEdit .null_div input').check()
      await page.waitForTimeout(700)
      await page.keyboard.press('Enter')
      await settle(page, 1800)
    })
  }
} finally {
  dropScratch()
  await done()
}
