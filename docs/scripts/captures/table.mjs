// Screenshots and the clip for the docs/table/*.md pages (structure, indexes and constraints,
// partitions, triggers, operations). Seed objects are only looked at; dialogs opened on them are
// closed without saving. The clip works on a scratch table that is dropped at the end.
// Run: node docs/scripts/captures/table.mjs
import { shot, record, settle, type, done } from '../capture.mjs'
import { open, psql, closeModal, dismiss, modalShot } from './table-lib.mjs'

const PUB = '/db/bookshop/schema/public'
const T = (name, tab = '') => `${PUB}/table/${name}${tab}`
const WIDE = { width: 1680, height: 900 }
const card = (page, title) => page.locator('.card', { has: page.locator(`.card-header:text-is("${title}")`) })

// Structure tab of books: the columns, the More menu, the cards.
{
  const { page, close } = await open(T('books'))
  await shot(page, 'table/structure.png')
  const row = page.locator('#tablestructure tbody tr').nth(2)
  await row.locator('button:has-text("More")').click()
  await shot(page, 'table/structure-more.png', { selector: '#tablestructure', pad: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.click(5, 795)
  await shot(page, 'table/indexes-card.png', { selector: '.card.index_info' })
  await shot(page, 'table/statistics-card.png', { selector: '#statistics' })
  await shot(page, 'table/constraints-card.png', { selector: '#constraints' })
  await shot(page, 'table/information.png', { selector: '#tablestatistics' })

  // Index dialog with the advanced options open.
  await page.fill('.card.index_info .card-footer input[type=number]', '2')
  await page.click('input.add_index')
  await settle(page, 800)
  const d = page.locator('#indexDialogModal')
  await d.locator('#input_index_name').fill('books_published_idx')
  await d.locator('select[name="index[columns][names][]"]').nth(0).selectOption('published')
  await d.locator('select[name="index[columns][order][]"]').nth(0).selectOption('DESC')
  await d.locator('select[name="index[columns][names][]"]').nth(1).selectOption('title')
  await d.locator('button:has-text("Advanced options")').click()
  await d.locator('#input_where').fill('published IS NOT NULL')
  await settle(page, 300)
  await modalShot(page, 'table/index-dialog.png', '#indexDialogModal .modal-content')
  await closeModal(page)

  // Extended statistics dialog.
  await page.locator('#statistics .card-footer input[type=submit]').click()
  await settle(page, 600)
  const s = page.locator('#statisticsDialogModal')
  await s.locator('select[name=statistics_columns]').selectOption(['published', 'pages'])
  await s.locator('input[value=dependencies]').check()
  await modalShot(page, 'table/statistics-dialog.png', '#statisticsDialogModal .modal-content')
  await closeModal(page)

  // Check constraint dialog.
  await page.locator('#constraints .card-footer select').selectOption('check_constraint')
  await page.locator('#constraints .card-footer input[type=submit]').click()
  await settle(page, 600)
  await page.fill('#input_constraint_expression', 'pages < 5000')
  await modalShot(page, 'table/check-dialog.png', '#constraintDialogModal .modal-content')
  await closeModal(page)
  await close()
}

// The Change page for two columns, and the add-columns notice.
{
  const { page, close } = await open(T('books', '/columns/change?attnums=7,8'), { viewport: WIDE })
  await shot(page, 'table/change-columns.png')
  await close()
}

// Exclusion constraint dialog on inventory.promotions (the seed has one like it).
{
  const { page, close } = await open('/db/bookshop/schema/inventory/table/promotions')
  await page.locator('#constraints .card-footer select').selectOption('exclusion_constraint')
  await page.locator('#constraints .card-footer input[type=submit]').click()
  await settle(page, 800)
  const d = page.locator('#constraintDialogModal')
  const rows = d.locator('#index_columns tbody tr')
  await d.locator('#input_constraint_name').fill('promotions_no_overlap2')
  await rows.nth(0).locator('select').first().selectOption('book_id')
  await rows.nth(0).locator('input[type=text]').fill('=')
  await d.locator('input[type=button][value^="Add"]').click()
  await rows.nth(1).locator('select').first().selectOption('during')
  await rows.nth(1).locator('input[type=text]').fill('&&')
  await d.locator('button:has-text("Advanced options")').click()
  await settle(page, 800)
  await modalShot(page, 'table/exclusion-dialog.png', '#constraintDialogModal .modal-content')
  await closeModal(page)
  await close()
}

// Relation view of books.
{
  const { page, close } = await open(T('books', '/relation'), { viewport: WIDE })
  await shot(page, 'table/relation-view.png', { selector: 'form fieldset.pma-fieldset' })
  await close()
}

// Partitions of orders, the add-partition dialog and the partition maintenance card.
{
  const { page, close } = await open(T('orders'))
  await shot(page, 'table/partitions-card.png', { selector: '#partitions' })
  await page.locator('#partitions .card-footer input[type=submit]').click()
  await settle(page, 800)
  const d = page.locator('#partitionDialogModal')
  await d.locator('input[name=partition_name]').fill('orders_2027')
  await d.locator('input[name=values_from]').fill("'2027-01-01'")
  await d.locator('input[name=values_to]').fill("'2028-01-01'")
  await modalShot(page, 'table/partition-dialog.png', '#partitionDialogModal .modal-content')
  await closeModal(page)
  await page.goto(page.url() + '/operations')
  await settle(page, 1000)
  await shot(page, 'table/partition-maintenance.png', { selector: '#partitionsForm' })
  await close()
}

// Inheritance card of ebooks (INHERITS books).
{
  const { page, close } = await open(T('ebooks', '/operations'))
  await shot(page, 'table/inheritance-card.png', { selector: '#tableInheritsForm' })
  await close()
}

// Triggers tab: books (trigger), audit_log (rule), reviews (policy), and the three dialogs.
{
  const { page, close } = await open(T('books', '/triggers'))
  await shot(page, 'table/triggers.png', { selector: '#triggers_section' })
  await page.locator('#triggers_section button.add_anchor').click()
  await settle(page, 800)
  const d = page.locator('#triggerDialogModal')
  await d.locator('input[name=item_name]').fill('books_price_check')
  await d.locator('input[name=item_event_insert]').uncheck()
  await d.locator('input[name=item_event_update]').check()
  await d.locator('#trigger_update_columns').selectOption(['price'])
  await d.locator('input[name=item_function]').fill('public.log_change')
  await d.locator('input[name=item_when]').fill('NEW.price IS DISTINCT FROM OLD.price')
  await modalShot(page, 'table/trigger-dialog.png', '#triggerDialogModal .modal-content')
  await closeModal(page)
  await page.goto(page.url().replace('/books/', '/audit_log/'))
  await settle(page, 1000)
  await shot(page, 'table/rules.png', { selector: '#rules_section' })
  await page.locator('#rules_section button.add_anchor').click()
  await settle(page, 800)
  const r = page.locator('#ruleDialogModal')
  await r.locator('input[name=rule_name]').fill('audit_log_no_update')
  await r.locator('select[name=rule_event]').selectOption('UPDATE')
  await r.locator('input[name=rule_instead]').check()
  await modalShot(page, 'table/rule-dialog.png', '#ruleDialogModal .modal-content')
  await closeModal(page)
  await page.goto(page.url().replace('/audit_log/', '/reviews/'))
  await settle(page, 1000)
  await shot(page, 'table/policies.png', { selector: '#policies_section' })
  await page.locator('#policies_section button.add_anchor').click()
  await settle(page, 800)
  const p = page.locator('#policyDialogModal')
  await p.locator('input[name=policy_name]').fill('reviews_own')
  await p.locator('select[name=policy_command]').selectOption('UPDATE')
  await p.locator('select[name=policy_roles]').selectOption(['bookshop_staff'])
  await p.locator('input[name=policy_using]').fill('NOT hidden')
  await p.locator('input[name=policy_check]').fill('rating BETWEEN 1 AND 5')
  await modalShot(page, 'table/policy-dialog.png', '#policyDialogModal .modal-content')
  await closeModal(page)
  await close()
}

// Operations tab of books, the TRUNCATE confirmation, and the Show create page.
{
  const { page, close } = await open(T('books', '/operations'))
  await shot(page, 'table/operations.png', { fullPage: true })
  await page.click('#truncate_tbl_anchor')
  await settle(page)
  await modalShot(page, 'table/truncate-confirm.png', '#confirm_dialog .modal-content')
  await page.click('#confirm_dialog .submitCancel')
  await page.goto(page.url().replace('/operations', '/ddl'))
  await settle(page, 1200)
  await shot(page, 'table/ddl.png')
  await shot(page, 'table/ddl-dependencies.png', { selector: '#dependency_panel' })
  await close()
}

// Clip: add a partial index from the Indexes card of a scratch table.
psql('DROP TABLE IF EXISTS public.tbl_cap_idx; CREATE TABLE public.tbl_cap_idx (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, title text NOT NULL, published date, pages integer)')
await record('table/index-create.mp4', T('tbl_cap_idx'), async (page) => {
  await page.locator('.card.index_info').scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await page.fill('.card.index_info .card-footer input[type=number]', '2')
  await page.click('input.add_index')
  await settle(page, 800)
  const d = page.locator('#indexDialogModal')
  await type(page, '#input_index_name', 'tbl_cap_idx_recent')
  await d.locator('select[name="index[columns][names][]"]').nth(0).selectOption('published')
  await page.waitForTimeout(400)
  await d.locator('select[name="index[columns][order][]"]').nth(0).selectOption('DESC')
  await d.locator('select[name="index[columns][names][]"]').nth(1).selectOption('title')
  await page.waitForTimeout(400)
  await d.locator('button:has-text("Advanced options")').click()
  await type(page, '#input_where', "published > '2020-01-01'")
  await page.waitForTimeout(400)
  await d.locator('.modal-footer button:has-text("Preview SQL")').click()
  await settle(page, 1800)
  await closeModal(page)
  await page.click('#indexDialogModalGoButton')
  await settle(page, 1000)
  await page.locator('.card.index_info').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1500)
})
psql('DROP TABLE IF EXISTS public.tbl_cap_idx')
await done()
