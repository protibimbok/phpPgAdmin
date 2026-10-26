import { registerModule, type MenuItem } from '@/modular'
import Browse from './Pages/Browse'
import SqlPage from './Pages/Sql'

const KINDS = ['table', 'view', 'mview'] as const

type Slot = Pick<MenuItem, 'label' | 'level'>

const same = (a: Slot, b: MenuItem) => a.label === b.label && (a.level ?? 'server') === (b.level ?? 'server')

/** The item placed after the one with that label at that level, or at the end when there is no such item. */
function insertAfter(menu: MenuItem[], after: Slot, item: MenuItem): MenuItem[] {
  const at = menu.findIndex((entry) => same(after, entry))

  return at === -1 ? [...menu, item] : [...menu.slice(0, at + 1), item, ...menu.slice(at + 1)]
}

function insertBefore(menu: MenuItem[], before: Slot, item: MenuItem): MenuItem[] {
  const at = menu.findIndex((entry) => same(before, entry))

  return at === -1 ? [item, ...menu] : [...menu.slice(0, at), item, ...menu.slice(at)]
}

// The SQL tab follows the first tab of every level, as it does in phpMyAdmin (Databases, then
// SQL on the server; Structure, then SQL below); Browse opens a table's bar. The module sorts after the ones whose tabs it slots in next to.
registerModule({
  id: 'sql',
  order: 20,
  menuFilter: (menu) => {
    const table = '/db/:db/schema/:schema/:kind/:table'
    let next = insertBefore(menu, { label: 'tables:structure.tab', level: 'table' }, { label: 'sql:browse_tab', icon: 'b_browse', path: `${table}/browse`, level: 'table' })
    next = insertAfter(next, { label: 'databases:tab' }, { label: 'sql:tab', icon: 'b_sql', path: '/server/sql' })
    next = insertAfter(next, { label: 'schemas:tab', level: 'database' }, { label: 'sql:tab', icon: 'b_sql', path: '/db/:db/sql', level: 'database' })
    next = insertAfter(next, { label: 'tables:tab', level: 'schema' }, { label: 'sql:tab', icon: 'b_sql', path: '/db/:db/schema/:schema/sql', level: 'schema' })
    next = insertAfter(next, { label: 'tables:structure.tab', level: 'table' }, { label: 'sql:tab', icon: 'b_sql', path: `${table}/sql`, level: 'table' })

    return next
  },
  routes: [
    { path: 'server/sql', element: <SqlPage /> },
    { path: 'db/:db/sql', element: <SqlPage /> },
    { path: 'db/:db/schema/:schema/sql', element: <SqlPage /> },
    ...KINDS.flatMap((kind) => [
      { path: `db/:db/schema/:schema/${kind}/:table/browse`, element: <Browse /> },
      { path: `db/:db/schema/:schema/${kind}/:table/sql`, element: <SqlPage /> },
    ]),
  ],
})
