import type { RawNode } from './plan'

/**
 * pgAdmin's plan node icons (img/, under pgAdmin's licence), as data URIs so that a downloaded
 * SVG or PNG of the plan carries them.
 */
const sources = import.meta.glob<string>('./img/*.svg', { eager: true, query: '?raw', import: 'default' })

const uris = new Map<string, string>()
for (const [path, svg] of Object.entries(sources)) {
  uris.set(path.slice('./img/'.length), `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`)
}

/** The data URI of an icon by its file name, "ex_scan.svg"; the unknown-node icon for any other. */
export function imageUri(name: string): string {
  return uris.get(name) ?? uris.get('ex_unknown.svg') ?? ''
}

interface Mapped {
  image: string
  text: string
}

const str = (value: unknown): string => (value === undefined || value === null ? '' : String(value))

/** pgAdmin's ImageMapper.js: the icon a node is drawn with and the text under it. */
export function imageFor(data: RawNode): Mapped {
  let type = data['Node Type']
  if (type.startsWith('(slice')) type = type.substring(0, 7)
  const fixed = (image: string, text: string): Mapped => ({ image, text })

  switch (type) {
    case 'Aggregate':
      return fixed('ex_aggregate.svg', 'Aggregate')
    case 'Append':
      return fixed('ex_append.svg', 'Append')
    case 'Bitmap Index Scan':
      return fixed('ex_bmp_index.svg', str(data['Index Name']))
    case 'Bitmap Heap Scan':
      return fixed('ex_bmp_heap.svg', str(data['Relation Name']))
    case 'BitmapAnd':
      return fixed('ex_bmp_and.svg', 'Bitmap AND')
    case 'BitmapOr':
      return fixed('ex_bmp_or.svg', 'Bitmap OR')
    case 'CTE Scan':
      return fixed('ex_cte_scan.svg', 'CTE Scan')
    case 'Custom Scan':
      return fixed(data['Custom Plan Provider'] === 'Citus Adaptive' ? 'ex_citus.svg' : 'ex_unknown.svg', str(data['Custom Plan Provider']))
    case 'Function Scan':
      return fixed('ex_result.svg', 'Function Scan')
    case 'Foreign Scan':
      return fixed('ex_foreign_scan.svg', 'Foreign Scan')
    case 'Gather':
      return fixed('ex_gather_motion.svg', 'Gather')
    case 'Gather Merge':
      return fixed('ex_gather_merge.svg', 'Gather Merge')
    case 'Group':
      return fixed('ex_group.svg', 'Group')
    case 'GroupAggregate':
      return fixed('ex_aggregate.svg', 'Group Aggregate')
    case 'Hash':
      return fixed('ex_hash.svg', 'Hash')
    case 'Hash Join':
      if (!data['Join Type']) return fixed('ex_join.svg', 'Join')
      if (data['Join Type'] === 'Anti') return fixed('ex_hash_anti_join.svg', 'Hash Anti Join')
      if (data['Join Type'] === 'Semi') return fixed('ex_hash_semi_join.svg', 'Hash Semi Join')
      return fixed('ex_hash.svg', `Hash ${str(data['Join Type'])} Join`)
    case 'HashAggregate':
      return fixed('ex_aggregate.svg', 'Hash Aggregate')
    case 'Index Only Scan':
      return fixed('ex_index_only_scan.svg', str(data['Index Name']))
    case 'Index Scan':
      return fixed('ex_index_scan.svg', str(data['Index Name']))
    case 'Index Scan Backword':
      return fixed('ex_index_scan.svg', 'Index Backward Scan')
    case 'Limit':
      return fixed('ex_limit.svg', 'Limit')
    case 'LockRows':
      return fixed('ex_lock_rows.svg', 'Lock Rows')
    case 'Materialize':
      return fixed('ex_materialize.svg', 'Materialize')
    case 'Merge Append':
      return fixed('ex_merge_append.svg', 'Merge Append')
    case 'Merge Join':
      if (data['Join Type'] === 'Anti') return fixed('ex_merge_anti_join.svg', 'Merge Anti Join')
      if (data['Join Type'] === 'Semi') return fixed('ex_merge_semi_join.svg', 'Merge Semi Join')
      return fixed('ex_merge.svg', `Merge ${str(data['Join Type'])} Join`)
    case 'ModifyTable':
      switch (data.Operation) {
        case 'Insert':
          return fixed('ex_insert.svg', 'Insert')
        case 'Update':
          return fixed('ex_update.svg', 'Update')
        case 'Delete':
          return fixed('ex_delete.svg', 'Delete')
        case 'Merge':
          return fixed('ex_merge.svg', 'Merge')
      }
      break
    case 'Named Tuplestore Scan':
      return fixed('ex_named_tuplestore_scan.svg', 'Named Tuplestore Scan')
    case 'Nested Loop':
      if (data['Join Type'] === 'Anti') return fixed('ex_nested_loop_anti_join.svg', 'Nested Loop Anti Join')
      if (data['Join Type'] === 'Semi') return fixed('ex_nested_loop_semi_join.svg', 'Nested Loop Semi Join')
      return fixed('ex_nested.svg', `Nested Loop ${str(data['Join Type'])} Join`)
    case 'ProjectSet':
      return fixed('ex_projectset.svg', 'ProjectSet')
    case 'Recursive Union':
      return fixed('ex_recursive_union.svg', 'Recursive Union')
    case 'Result':
      return fixed('ex_result.svg', 'Result')
    case 'Sample Scan':
      return fixed('ex_scan.svg', 'Sample Scan')
    case 'Scan':
      return fixed('ex_scan.svg', 'Scan')
    case 'Seek':
      return fixed('ex_seek.svg', 'Seek')
    case 'SetOp': {
      const command = str(data.Command)
      if (data.Strategy === 'Hashed') {
        if (command.startsWith('Intersect')) return command === 'Intersect All' ? fixed('ex_hash_setop_intersect_all.svg', 'Hashed Intersect All') : fixed('ex_hash_setop_intersect.svg', 'Hashed Intersect')
        if (command.startsWith('Except')) return command === 'Except All' ? fixed('ex_hash_setop_except_all.svg', 'Hashed Except All') : fixed('ex_hash_setop_except.svg', 'Hash Except')
        return fixed('ex_hash_setop_unknown.svg', 'Hashed SetOp Unknown')
      }
      return fixed('ex_setop.svg', 'SetOp')
    }
    case 'Seq Scan':
      return fixed('ex_scan.svg', str(data['Relation Name']))
    case 'Subquery Scan':
      return fixed('ex_subplan.svg', 'SubQuery Scan')
    case 'Sort':
      return fixed('ex_sort.svg', 'Sort')
    case 'Tid Scan':
      return fixed('ex_tid_scan.svg', 'Tid Scan')
    case 'Table Function Scan':
      return fixed('ex_table_func_scan.svg', 'Table Function Scan')
    case 'Unique':
      return fixed('ex_unique.svg', 'Unique')
    case 'Values Scan':
      return fixed('ex_values_scan.svg', 'Values Scan')
    case 'WindowAgg':
      return fixed('ex_window_aggregate.svg', 'Window Aggregate')
    case 'WorkTable Scan':
      return fixed('ex_worktable_scan.svg', 'WorkTable Scan')
  }

  return fixed('ex_unknown.svg', type)
}
