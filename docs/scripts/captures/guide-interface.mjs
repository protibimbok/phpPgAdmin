// Screenshots and the tree clip for docs/guide/introduction.md and docs/guide/interface.md.
//
//   node docs/scripts/captures/guide-interface.mjs
//
// The Arabic screenshot runs as the scratch role guide_user (guide-common.mjs), so switching the
// language does not change the postgres role's saved language.

import { APP, MEDIA, done, open, record, settle, shot } from '../capture.mjs'
import { createGuideUser, dropGuideUser, openAs } from './guide-common.mjs'

/**
 * Draws numbered outlines over the parts of the page named in `parts`, for the annotated overview:
 * [selector, number, x, y], the badge centred at the fractions x and y of the part's box.
 */
async function annotate(page, parts) {
  await page.evaluate((parts) => {
    const layer = document.createElement('div')
    layer.id = 'docs-annotations'
    Object.assign(layer.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '100000' })
    for (const [selector, n, fx, fy] of parts) {
      const el = document.querySelector(selector)
      if (!el) continue
      const r = el.getBoundingClientRect()
      const box = document.createElement('div')
      Object.assign(box.style, { position: 'fixed', left: `${r.left + 1}px`, top: `${r.top + 1}px`, width: `${r.width - 2}px`, height: `${r.height - 2}px`, outline: '2px solid #d6336c', borderRadius: '3px' })
      const badge = document.createElement('div')
      badge.textContent = String(n)
      Object.assign(badge.style, { position: 'fixed', width: '22px', height: '22px', lineHeight: '22px', textAlign: 'center', borderRadius: '50%', background: '#d6336c', color: '#fff', font: 'bold 13px sans-serif', boxShadow: '0 0 0 2px #fff' })
      badge.style.left = `${Math.min(window.innerWidth - 24, Math.max(2, r.left + fx * r.width - 11))}px`
      badge.style.top = `${Math.min(window.innerHeight - 24, Math.max(2, r.top + fy * r.height - 11))}px`
      layer.append(box, badge)
    }
    document.body.append(layer)
  }, parts)
}

// --- Home page ---------------------------------------------------------------------------
{
  const { page, close } = await open('/')
  await page.evaluate(() => sessionStorage.removeItem('navTreePaths'))
  await page.reload(); await settle(page, 800)
  await shot(page, 'guide/home.png')

  // The user menu, open.
  await page.click('#userAccountDropdown button'); await settle(page, 200)
  await shot(page, 'guide/user-menu.png', { selector: '#userAccountDropdown .dropdown-menu', pad: 6 })
  await page.click('#page_content')
  await close()
}

// --- The annotated overview, at a table --------------------------------------------------
{
  const { page, close } = await open('/db/bookshop/schema/inventory/table/warehouses')
  await settle(page, 1500)
  await annotate(page, [
    ['#pma_navigation_header', 1, 0.1, 0.75],
    ['#navigation_controls', 2, 0, 0.5],
    ['#pma_navigation_tree_content', 3, 0.85, 0.06],
    ['#pma_navigation_collapser', 4, -1.1, 0.5],
    ['#server-breadcrumb', 5, 0.82, 0.5],
    ['#topmenucontainer', 6, 0.66, 1],
    ['#userAccountDropdown', 7, -0.6, 0.5],
    ['#page_content', 8, 0.97, 0.3],
    ['#pma_console .toolbar', 9, 1.15, 0.5],
  ])
  await shot(page, 'guide/overview.png')
  await page.evaluate(() => document.getElementById('docs-annotations')?.remove())

  // The breadcrumb and the table-level tab bar.
  const top = await page.locator('#topmenucontainer').boundingBox()
  const crumb = await page.locator('#server-breadcrumb').boundingBox()
  await page.screenshot({ path: `${MEDIA}/guide/menubar-table.png`, clip: { x: crumb.x, y: 0, width: 1280 - crumb.x, height: top.y + top.height + 4 } })
  console.log('saved docs/public/media/guide/menubar-table.png')
  await close()
}

// --- "Not available yet." ------------------------------------------------------------------
{
  const { page, close } = await open('/db/bookshop/schema/public/table/books/search')
  await page.click('a[href="#zoom"]'); await settle(page, 300)
  await shot(page, 'guide/not-available.png', { selector: '#loading_parent .ajax_notification', pad: 6 })
  await close()
}

// --- Preview SQL, from the sequence form (nothing is created) -------------------------------
{
  const { page, close } = await open('/db/bookshop/schema/public/sequences/create')
  await page.fill('input[name=item_name]', 'order_ref')
  await page.click('input.preview_sql'); await settle(page, 800)
  await shot(page, 'guide/preview-sql.png', { selector: '.modal.show .modal-content' })
  await close()
}

// --- Arabic, right to left ---------------------------------------------------------------
createGuideUser()
{
  const { page, close } = await openAs('/')
  await page.selectOption('#languageSelect', 'ar'); await settle(page, 800)
  await page.goto(`${APP}/db/bookshop/schema/inventory`); await settle(page, 1500)
  await shot(page, 'guide/rtl.png')
  await page.goto(`${APP}/`); await settle(page)
  await page.selectOption('#languageSelect', 'en'); await settle(page, 800)
  await close()
}
dropGuideUser()

// --- Clip: opening the tree down to a table ------------------------------------------------
await record('guide/tree-navigation.mp4', '/', async (page) => {
  await page.evaluate(() => sessionStorage.removeItem('navTreePaths'))
  await page.reload(); await settle(page, 800)
  const expand = async (scope, label) => {
    await page.locator(`${scope} li:has(> a.hover_show_full:text-is("${label}")) > .block a.expander`).first().click()
    await settle(page, 700)
  }
  await expand('#pma_navigation_tree_content', 'bookshop')
  await expand('#pma_navigation_tree_content', 'Schemas')
  await expand('#pma_navigation_tree_content', 'inventory')
  await expand('#pma_navigation_tree_content', 'Tables')
  await page.locator('#pma_navigation_tree_content a.hover_show_full:text-is("warehouses")').click()
  await settle(page, 1500)
  await page.locator('#topmenu a:has-text("Browse")').click(); await settle(page, 1500)
  await page.locator('#server-breadcrumb a:has-text("Schema:")').click(); await settle(page, 1500)
  await page.click('#pma_navigation_collapse'); await settle(page, 1200)
})

await done()
