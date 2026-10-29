// The login page, for docs/guide/signing-in.md: the form, its Advanced section, and the error a
// rejected login shows. Nothing is signed in to.
//
//   node docs/scripts/captures/guide-signin.mjs

import { done, open, settle, shot } from '../capture.mjs'

const TARGET = `${process.env.DOCS_PG_HOST ?? 'localhost'}:${process.env.DOCS_PG_PORT ?? '5499'}`
const { page, close } = await open('/', { login: false })
await page.waitForSelector('#select_server')
// The docs cluster in the server list, whatever was used last.
const value = await page.locator('#select_server option').evaluateAll((os, t) => os.find((o) => o.textContent.includes(t))?.value, TARGET)
if (value) await page.selectOption('#select_server', value)
await page.fill('#input_username', 'postgres')
await shot(page, 'guide/login.png', { selector: '#loginform .container', pad: 0 })

await page.click('#login_advanced a'); await settle(page, 200)
await shot(page, 'guide/login-advanced.png', { selector: '#login_form', pad: 14 })

// A role the server does not know: the server's own message, above the form.
await page.fill('#input_username', 'nobody_here')
await page.click('#input_go')
await page.waitForSelector('#loginform .alert-danger')
await shot(page, 'guide/login-error.png', { selector: '#loginform .alert-danger', pad: 4 })

await close()
await done()
