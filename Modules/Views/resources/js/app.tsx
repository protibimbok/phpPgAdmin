import { urls } from '@/level'
import { registerNodeLink } from '@/nodes/links'

// Views and materialized views in the tree open their pages under the schema.
for (const kind of ['view', 'mview'] as const) {
  registerNodeLink(kind, (node, { db, ancestors }) => {
    const schema = ancestors.find((a) => a.type === 'schema')

    return db === null || !schema ? '#' : urls.relation(db, schema.label, node.label, kind)
  })
}
