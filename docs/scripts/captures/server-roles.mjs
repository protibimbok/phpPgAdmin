// Server » Roles: the overview, Add role (every part), Edit role (each form), reassign / drop
// owned, export and drop. Scratch roles srv_role_app, srv_role_group, srv_role_member; scratch
// database srv_role_app; scratch tables public.srv_role_tbl / srv_role_tbl2 in bookshop.
//   node docs/scripts/captures/server-roles.mjs

import { shot, done, settle } from '../capture.mjs'
import { psql, psqlTry, notice, clearNotice, confirm, openRetry, shotEl, onlyRows } from './server-lib.mjs'

const DEMO = /^(postgres|bookshop_staff|bookshop_clerk|srv_role_.*)$/

function cleanup() {
  psqlTry('DROP DATABASE IF EXISTS srv_role_app WITH (FORCE)', 'postgres')
  for (const r of ['srv_role_app', 'srv_role_app2', 'srv_role_group', 'srv_role_member']) {
    psqlTry(`DROP OWNED BY ${r}`)
    psqlTry(`DROP OWNED BY ${r}`, 'postgres')
    psqlTry(`DROP ROLE IF EXISTS ${r}`)
  }
  psqlTry('DROP TABLE IF EXISTS public.srv_role_tbl, public.srv_role_tbl2')
}
cleanup()
psql("CREATE ROLE srv_role_group NOLOGIN; CREATE ROLE srv_role_member LOGIN; COMMENT ON ROLE srv_role_group IS 'Scratch group role'")

const preview = async (page, button) => {
  await page.click(button)
  const modal = page.locator('.modal-content').last()
  await modal.locator('pre, code, .cm-content').first().waitFor({ timeout: 8000 }).catch(() => {})
  await settle(page, 300)
  const text = (await modal.locator('.modal-body').innerText()).trim()
  return { modal, text }
}
const closeModal = async (page) => {
  await page.locator('.modal-content').last().locator('.btn-close').click()
  await settle(page, 200)
}

// ---- Overview
{
  const { page, close } = await openRetry('/server/roles')
  await page.locator('#userRightsTable').waitFor()
  const before = await page.locator('#userRightsTable tbody tr').count()
  await page.check('#showSystemRoles')
  console.log('rows / with pg_* roles:', before, await page.locator('#userRightsTable tbody tr').count())
  await page.uncheck('#showSystemRoles')
  await onlyRows(page, '#userRightsTable', DEMO)
  await shot(page, 'server/roles-overview.png', { selector: '#roles' })

  // Export one role.
  await page.locator('#userRightsTable tbody tr', { hasText: 'bookshop_clerk' }).locator('.export_user_anchor').click()
  const modal = page.locator('.modal-content').last()
  await modal.locator('.modal-body').getByText('CREATE ROLE').first().waitFor()
  console.log('export bookshop_clerk:\n', await modal.locator('.modal-body').innerText())
  await shot(page, 'server/roles-export.png', { selector: '.modal-content' })
  await closeModal(page)
  // Export with nothing selected.
  await page.click('button.mult_submit')
  console.log('export none:', await notice(page))
  await close()
}

// ---- Add role
{
  const { page, close } = await openRetry('/server/roles/create')
  await page.locator('#pma_username').waitFor()
  await page.fill('#pma_username', 'srv_role_app')
  await page.fill('#text_pma_pw', 'secret-1')
  await page.fill('#text_pma_pw2', 'secret-2')
  await page.fill('#text_comment', 'Application login for the docs')
  await page.check('#createdb-1')
  await page.check('#checkbox_rolcreatedb')
  await page.fill('#text_rolconnlimit', '5')
  await page.fill('#text_rolvaliduntil', '2030-01-01')
  await page.locator('#table_member_of select').selectOption('srv_role_group')
  await page.locator('#table_members select').selectOption('srv_role_member')
  await page.click('#fieldset_role_variables input[type=button]')
  const v = page.locator('#fieldset_role_variables tbody tr').first()
  await v.locator('select').first().selectOption('work_mem')
  await v.locator('input[type=text]').fill('16MB')
  await v.locator('select').nth(1).selectOption('bookshop')
  console.log('membership flags:', (await page.locator('#table_member_of thead th').allInnerTexts()).join(' | '))

  // Mismatched passwords.
  await page.click('input.preview_sql')
  console.log('mismatch:', await notice(page))
  await clearNotice(page)
  await page.fill('#text_pma_pw2', 'secret-1')
  await shotEl(page, 'server/roles-add.png', '#addUsersForm')
  const { text } = await preview(page, 'input.preview_sql')
  console.log('add preview:\n', text)
  await shot(page, 'server/roles-add-preview.png', { selector: '.modal-content' })
  await closeModal(page)
  await page.click('#adduser_submit')
  console.log('create:', await notice(page))
  await page.waitForURL(/\/server\/roles$/, { timeout: 10000 })
  console.log('catalog:', psql("SELECT rolname, rolcanlogin, rolinherit, rolcreatedb, rolconnlimit, rolvaliduntil, rolpassword IS NOT NULL FROM pg_authid WHERE rolname = 'srv_role_app'"))
  console.log('members:', psql("SELECT r.rolname || ' -> ' || m.rolname || ' admin=' || admin_option || ' inherit=' || inherit_option || ' set=' || set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member WHERE 'srv_role_app' IN (r.rolname, m.rolname)"))
  console.log('settings:', psql("SELECT coalesce(d.datname, '*') || ': ' || array_to_string(setconfig, ',') FROM pg_db_role_setting s LEFT JOIN pg_database d ON d.oid = s.setdatabase WHERE setrole = 'srv_role_app'::regrole"))
  console.log('comment / database:', psql("SELECT shobj_description('srv_role_app'::regrole, 'pg_authid'), (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'srv_role_app')"))
  await close()
}

// ---- Edit role
psql('CREATE TABLE public.srv_role_tbl (id int); ALTER TABLE public.srv_role_tbl OWNER TO srv_role_app; CREATE TABLE public.srv_role_tbl2 (id int); ALTER TABLE public.srv_role_tbl2 OWNER TO srv_role_app; GRANT CONNECT, TEMPORARY ON DATABASE bookshop TO srv_role_app')
{
  const { page, close } = await openRetry('/server/roles/srv_role_app/edit')
  await page.locator('#edit_user_dialog').waitFor()
  await settle(page, 500)
  await shotEl(page, 'server/roles-edit.png', '#edit_user_dialog')
  console.log('database privileges:', (await page.locator('#fieldset_database_privileges tbody').innerText()).replace(/\s+/g, ' '))

  // Attributes: CREATEROLE on, CREATEDB off, no limit, preview then Go.
  const attributes = page.locator('form', { has: page.locator('#fieldset_user_global_rights') })
  await page.check('#checkbox_rolcreaterole')
  await page.uncheck('#checkbox_rolcreatedb')
  await page.fill('#text_rolconnlimit', '')
  console.log('attributes preview:', (await preview(page, '#fieldset_user_privtable_footer input.preview_sql')).text)
  await closeModal(page)
  await attributes.locator('input[type=submit]').click()
  console.log('attributes save:', await notice(page))
  await clearNotice(page)
  console.log('catalog:', psql("SELECT rolcreaterole, rolcreatedb, rolconnlimit FROM pg_roles WHERE rolname = 'srv_role_app'"))

  // Membership: INHERIT off for srv_role_group, ADMIN on.
  const memberOf = page.locator('#table_member_of tbody tr', { hasText: 'srv_role_group' })
  await memberOf.locator('input[aria-label="srv_role_group INHERIT"]').uncheck()
  await memberOf.locator('input[aria-label="srv_role_group ADMIN"]').check()
  console.log('membership preview:', (await preview(page, '#fieldset_membership_footer input.preview_sql')).text)
  await closeModal(page)
  await page.click('#fieldset_membership_footer input[type=submit]')
  console.log('membership save:', await notice(page))
  await clearNotice(page)
  console.log('members:', psql("SELECT r.rolname || ' admin=' || admin_option || ' inherit=' || inherit_option || ' set=' || set_option FROM pg_auth_members a JOIN pg_roles r ON r.oid = a.roleid WHERE member = 'srv_role_app'::regrole"))

  // Variables: remove the one set at creation.
  await page.locator('#fieldset_role_variables tbody tr').first().locator('a').click()
  console.log('variables preview:', (await preview(page, '#fieldset_variables_footer input.preview_sql')).text)
  await closeModal(page)
  await page.click('#fieldset_variables_footer input[type=submit]')
  console.log('variables save:', await notice(page))
  await clearNotice(page)
  console.log('settings left:', psql("SELECT count(*) FROM pg_db_role_setting WHERE setrole = 'srv_role_app'::regrole"))

  // Change password, then No Password.
  await page.fill('#text_pma_change_pw', 'secret-3')
  await page.fill('#text_pma_change_pw2', 'secret-3')
  console.log('password preview:', (await preview(page, '#fieldset_change_password_footer input.preview_sql')).text)
  await closeModal(page)
  await page.click('#fieldset_change_password_footer input[type=submit]')
  console.log('password save:', await notice(page))
  await clearNotice(page)
  await page.check('#nopass_1')
  await page.click('#fieldset_change_password_footer input[type=submit]')
  console.log('no password:', await notice(page), '| has password:', psql("SELECT rolpassword IS NOT NULL FROM pg_authid WHERE rolname = 'srv_role_app'"))
  await clearNotice(page)

  // Reassign owned (one table moved to postgres), then drop owned.
  await page.selectOption('#select_reassign_database', 'bookshop')
  await page.check('#role_op_reassign')
  await page.locator('#fieldset_reassign_owned select[aria-label]').selectOption('postgres')
  console.log('reassign preview:', (await preview(page, '#fieldset_reassign_footer input.preview_sql')).text)
  await closeModal(page)
  await page.click('#fieldset_reassign_footer input[type=submit]')
  console.log('reassign confirm:', await confirm(page))
  console.log('reassign:', await notice(page))
  await clearNotice(page)
  console.log('owners:', psql("SELECT string_agg(relname || '=' || pg_get_userbyid(relowner), ', ') FROM pg_class WHERE relname IN ('srv_role_tbl', 'srv_role_tbl2')"))
  psql('ALTER TABLE public.srv_role_tbl2 OWNER TO srv_role_app')
  await page.check('#role_op_drop')
  await page.click('#fieldset_reassign_footer input[type=submit]')
  console.log('drop owned confirm:', await confirm(page))
  console.log('drop owned:', await notice(page))
  await clearNotice(page)
  console.log('tables left:', psql("SELECT string_agg(relname, ', ') FROM pg_class WHERE relname IN ('srv_role_tbl', 'srv_role_tbl2')"), '| bookshop ACL for role:', psql("SELECT count(*) FROM pg_database, aclexplode(datacl) a WHERE datname = 'bookshop' AND a.grantee = 'srv_role_app'::regrole"))

  // Rename and comment.
  const login = page.locator('form', { has: page.locator('#fieldset_change_copy_user_footer') })
  await login.locator('#pma_username').fill('srv_role_app2')
  await login.locator('#text_comment').fill('Renamed by the docs')
  console.log('rename preview:', (await preview(page, '#fieldset_change_copy_user_footer input.preview_sql')).text)
  await closeModal(page)
  await page.click('#fieldset_change_copy_user_footer input[type=submit]')
  console.log('rename:', await notice(page))
  await page.waitForURL(/srv_role_app2/, { timeout: 8000 }).catch(() => {})
  console.log('url after rename:', new URL(page.url()).pathname)
  await close()
}

// ---- Editing your own role, and a role that is not there
{
  const { page, close } = await openRetry('/server/roles/postgres/edit')
  await page.locator('#edit_user_dialog').waitFor()
  console.log('own role notice:', await page.locator('#edit_user_dialog .alert').innerText())
  await shotEl(page, 'server/roles-edit-self.png', '#edit_user_dialog .alert', { pad: 4 })
  await page.goto(page.url().replace('/postgres/edit', '/srv_no_such_role/edit'))
  await settle(page, 800)
  console.log('missing role:', await page.locator('.alert-danger').first().innerText().catch(() => '(none)'))
  await close()
}

// ---- Drop: a role that still owns something is refused; then the bulk drop with the database.
psql('CREATE TABLE public.srv_role_tbl3 (id int); ALTER TABLE public.srv_role_tbl3 OWNER TO srv_role_app2')
{
  const { page, close } = await openRetry('/server/roles')
  await page.locator('#userRightsTable').waitFor()
  await page.check('#userRightsTable input[value="srv_role_app2"]')
  await page.click('#deleteUserCard input[type=submit]')
  console.log('drop confirm:', await confirm(page))
  console.log('drop owning role:', await notice(page))
  await clearNotice(page)
  psql('DROP TABLE public.srv_role_tbl3')

  // With selected export of two roles.
  await page.check('#userRightsTable input[value="srv_role_app2"]')
  await page.check('#userRightsTable input[value="srv_role_group"]')
  await page.click('button.mult_submit')
  await page.locator('.modal-content').last().getByText('CREATE ROLE').first().waitFor()
  console.log('export two:', (await page.locator('.modal-content').last().innerText()).split('\n').filter((l) => l.startsWith('CREATE ROLE')).join(' / '))
  await closeModal(page)

  // The database named like the role goes too (the role was renamed, so rename the database to match).
  psql('ALTER DATABASE srv_role_app RENAME TO srv_role_app2', 'postgres')
  await page.check('#dropUsersDbCheckbox')
  await onlyRows(page, '#userRightsTable', DEMO)
  await shot(page, 'server/roles-remove.png', { selector: '#deleteUserCard' })
  await page.click('#deleteUserCard input[type=submit]')
  console.log('drop confirm:', await confirm(page))
  console.log('drop:', await notice(page))
  console.log('left:', psql("SELECT coalesce(string_agg(rolname, ', '), '(none)') FROM pg_roles WHERE rolname LIKE 'srv_role_%'"), '| db:', psql("SELECT count(*) FROM pg_database WHERE datname LIKE 'srv_role_%'"))
  await close()
}

cleanup()
psqlTry('DROP DATABASE IF EXISTS srv_role_app2 WITH (FORCE)', 'postgres')
await done()
