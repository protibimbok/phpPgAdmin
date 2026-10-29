// Behaviour checks behind docs/guide/interface.md and docs/guide/signing-in.md; prints what it
// finds and writes no media.
//
//   node docs/scripts/captures/guide-checks.mjs

import { APP, done, open, settle } from '../capture.mjs'

const log = (...a) => console.log('[check]', ...a)
const { page, context, close } = await open('/')
const tree = '#pma_navigation_tree_content'
const expander = (label) => page.locator(`${tree} li:has(> a.hover_show_full:text-is("${label}")) > .block a.expander`).first()
const openItems = () => page.evaluate(() => sessionStorage.getItem('navTreePaths'))

// Tree state across a reload, and "Collapse all".
await page.evaluate(() => sessionStorage.removeItem('navTreePaths')); await page.reload(); await settle(page, 800)
await expander('bookshop').click(); await settle(page, 600)
await expander('Schemas').click(); await settle(page, 600)
log('open items stored:', await openItems())
await page.reload(); await settle(page, 1200)
log('after reload Schemas visible:', await page.locator(`${tree} a.hover_show_full:text-is("inventory")`).count())
await page.click('#pma_navigation_collapse'); await settle(page, 300)
log('after collapse all:', await openItems(), '| inventory visible:', await page.locator(`${tree} a.hover_show_full:text-is("inventory")`).count())

// Link with main panel: a page deep in the tree opens the way to it and highlights the item.
await page.goto(`${APP}/db/bookshop/schema/inventory/table/stock`); await settle(page, 1500)
log('linked: selected item =', await page.locator(`${tree} li.selected > a.hover_show_full`).allTextContents(), '| stored:', await openItems())
await page.click('#pma_navigation_collapse'); await page.click('#pma_navigation_sync'); await settle(page, 300)
log('sync title now:', await page.getAttribute('#pma_navigation_sync', 'title'))
await page.goto(`${APP}/db/bookshop/schema/inventory/table/stock`); await settle(page, 1500)
log('unlinked: selected =', await page.locator(`${tree} li.selected`).count(), '| stock visible =', await page.locator(`${tree} a.hover_show_full:text-is("stock")`).count())
await page.click('#pma_navigation_sync'); await settle(page, 200)

// The panel: resize by dragging, collapse and expand.
const width = () => page.$eval('#pma_navigation', (e) => Math.round(e.getBoundingClientRect().width))
log('panel width:', await width())
const r = await page.locator('#pma_navigation_resizer').boundingBox()
await page.mouse.move(r.x + r.width / 2, r.y + 200); await page.mouse.down(); await page.mouse.move(r.x + 120, r.y + 200, { steps: 5 }); await page.mouse.up()
log('after drag +120:', await width())
await page.click('#pma_navigation_collapser'); await settle(page, 200)
log('collapsed:', await width(), await page.getAttribute('#pma_navigation_collapser', 'title'))
await page.click('#pma_navigation_collapser'); await settle(page, 200)
log('expanded again:', await width())
await page.reload(); await settle(page, 800)
log('after reload width:', await width())

// Header links and the end corner.
log('panel links:', await page.$$eval('#navipanellinks a', (as) => as.map((a) => `${a.title} -> ${a.getAttribute('href')}`)))
log('new item ->', await page.getAttribute(`${tree} li.new_database a.hover_show_full`, 'href'))
log('self link ->', await page.getAttribute('#selflink a', 'href'), await page.getAttribute('#selflink a', 'target'))
log('top link title:', await page.getAttribute('#goto_pagetop', 'title'))

// Notifications: a notice goes after 5 s; a click dismisses it.
await page.goto(`${APP}/db/bookshop/schema/public/table/books/search`); await settle(page)
await page.click('a[href="#zoom"]')
log('notice shown:', await page.locator('#loading_parent .ajax_notification').count())
await page.waitForTimeout(5500)
log('after 5.5 s:', await page.locator('#loading_parent .ajax_notification').count())

// Modals close on Escape.
await page.goto(`${APP}/db/bookshop/schema/public/sequences/create`); await settle(page)
await page.fill('input[name=item_name]', 'x'); await page.click('input.preview_sql'); await settle(page, 500)
await page.keyboard.press('Escape'); await settle(page, 200)
log('modal after Escape:', await page.locator('.modal.show').count())

// Unknown address.
await page.goto(`${APP}/no/such/page`); await settle(page)
log('unknown page:', (await page.locator('#page_content').textContent()).trim())
await page.goto(`${APP}/db/no_such_db`); await settle(page, 1200)
log('unknown database:', (await page.locator('#page_content').textContent()).trim().slice(0, 200))

// Expired session: the session cookie goes, the page keeps running and its requests fail.
await page.goto(`${APP}/db/bookshop`); await settle(page)
await context.clearCookies({ name: 'PHPSESSID' })
await page.click('#topmenu a:has-text("Operations")'); await settle(page, 1200)
log('expired session page:', (await page.locator('#page_content').textContent()).trim().slice(0, 120))
await page.reload(); await settle(page)
log('after reload login form:', await page.locator('#login_form').count())

await close()
await done()
