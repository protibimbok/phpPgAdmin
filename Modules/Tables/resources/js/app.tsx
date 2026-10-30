import { urls } from '@/level'
import { registerModule } from '@/modular'
import { registerContainerLink, registerNewLink, registerNodeLink, relationOf, schemaOf, type NodeLinkContext } from '@/nodes/links'
import ColumnDefinitions from './Pages/ColumnDefinitions'
import RelationView from './Pages/RelationView'
import TableOperations from './Pages/TableOperations'
import SchemaStructure from './Pages/SchemaStructure'
import TableDdl from './Pages/TableDdl'
import TableStructure from './Pages/TableStructure'
import TableSecurityLabels from './TableSecurityLabels'
import Triggers from './Pages/Triggers'

// A table in the tree opens its Browse page, as phpMyAdmin's tree does; the ancestors tell
// which schema it is in.
registerNodeLink('table', (node, { db, ancestors }) => {
  const schema = ancestors.find((a) => a.type === 'schema')

  return db === null || !schema ? '#' : `${urls.relation(db, schema.label, node.label, 'table')}/browse`
})

// A partition in the tree opens its own structure page: it is a table in its schema.
// A statistics object opens the structure page of the table it describes.
registerNodeLink('statistic', (node, { db }) => {
  const meta = node.meta as { table?: string; table_schema?: string }

  return db === null || !meta.table || !meta.table_schema ? '#' : `${urls.relation(db, meta.table_schema, meta.table, 'table')}#statistics`
})

registerNodeLink('partition', (node, { db }) => {
  const meta = node.meta as { schema_name?: string }

  return db === null || !meta.schema_name ? '#' : urls.relation(db, meta.schema_name, node.label, 'table')
})

// The tables and statistics containers open the schema's table list, as phpMyAdmin's "Tables"
// container opens the database structure.
for (const type of ['table', 'statistic']) {
  registerContainerLink(type, ({ db, ancestors }) => {
    const schema = schemaOf(ancestors)

    return db === null || schema === undefined ? '#' : urls.schema(db, schema)
  })
}

/** A page of the relation the node hangs under: its structure (''), or "/triggers". */
function relationPage(page: string) {
  return ({ db, ancestors }: NodeLinkContext) => {
    const schema = schemaOf(ancestors)
    const relation = relationOf(ancestors)

    return db === null || schema === undefined || relation === undefined ? '#' : `${urls.relation(db, schema, relation.name, relation.kind)}${page}`
  }
}

// What a table holds is shown on its pages: columns, indexes, constraints and partitions on
// Structure, triggers, rules and policies on Triggers; a view's rules and triggers likewise.
for (const type of ['column', 'index', 'primary_key', 'unique_constraint', 'foreign_key', 'check_constraint', 'exclusion_constraint', 'partition']) {
  registerContainerLink(type, relationPage(''))
}
for (const type of ['trigger', 'rule', 'row_security_policy', 'view_trigger', 'view_rule']) {
  registerContainerLink(type, relationPage('/triggers'))
}

// The schema's "Structure" tab, first in the schema's bar, where /db/:db/schema/:schema lands;
// the relation's "Structure", "Operations" and "Show create" tabs, where a table's own URL lands.
// phpMyAdmin gives a view the same bar as a table, so the tabs name the kind in their path and
// the Views module supplies the pages behind them for views and materialized views.
// phpMyAdmin's "New" under Tables: the schema's create-table page.
registerNewLink('table', {
  icon: 'b_table_add',
  link: ({ db, ancestors }) => {
    const schema = schemaOf(ancestors)

    return db === null || schema === undefined ? '#' : `${urls.schema(db, schema)}/create-table`
  },
})

registerModule({
  id: 'tables',
  menuFilter: (menu) => [
    ...menu,
    { label: 'tables:tab', icon: 'b_props', path: '/db/:db/schema/:schema', level: 'schema' },
    { label: 'tables:structure.tab', icon: 'b_props', path: '/db/:db/schema/:schema/:kind/:table', level: 'table' },
    { label: 'tables:operations.tab', icon: 'b_tblops', path: '/db/:db/schema/:schema/:kind/:table/operations', level: 'table' },
    { label: 'tables:ddl.tab', icon: 'b_sql', path: '/db/:db/schema/:schema/:kind/:table/ddl', level: 'table' },
    // phpMyAdmin's Triggers tab; a materialized view has neither triggers nor rules.
    { label: 'tables:triggers.tab', icon: 'b_triggers', path: '/db/:db/schema/:schema/:kind/:table/triggers', level: 'table', kinds: ['table', 'view'] },
  ],
  routes: [
    { path: 'db/:db/schema/:schema', element: <SchemaStructure /> },
    { path: 'db/:db/schema/:schema/table/:table', element: <TableStructure /> },
    { path: 'db/:db/schema/:schema/table/:table/ddl', element: <TableDdl /> },
    { path: 'db/:db/schema/:schema/create-table', element: <ColumnDefinitions mode="create" /> },
    { path: 'db/:db/schema/:schema/table/:table/add-columns', element: <ColumnDefinitions mode="add" /> },
    { path: 'db/:db/schema/:schema/table/:table/columns/change', element: <ColumnDefinitions mode="change" /> },
    { path: 'db/:db/schema/:schema/table/:table/relation', element: <RelationView /> },
    { path: 'db/:db/schema/:schema/table/:table/operations', element: <><TableOperations /><TableSecurityLabels /></> },
    { path: 'db/:db/schema/:schema/table/:table/triggers', element: <Triggers /> },
    { path: 'db/:db/schema/:schema/view/:table/triggers', element: <Triggers /> },
  ],
})
