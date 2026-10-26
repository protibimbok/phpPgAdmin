import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import { useLevel, type Level } from '@/level'
import { collection, collectionUrl, getNodeTypes, type NodeType, type TreeNode } from '@/nodes/client'
import { nodeLink } from '@/nodes/links'
import TreeItem from './TreeItem'
import TreeList from './TreeList'
import { useTreeState } from './treeState'

export interface NodeChildrenProps {
  /** The database the children are in. */
  db: string
  /** The node type whose children to show; the database's own when left out. */
  parentType?: string
  /** The collection path from the database down to the parent: ['schemas', 2200]. */
  path?: (string | number)[]
  ancestors?: TreeNode[]
}

/** The node types the page levels address, by the kind in the URL. */
const LEVEL_TYPES: Record<string, string> = { table: 'table', view: 'view', mview: 'mview' }

/**
 * Whether a node is what the page shown is about, and whether the page is inside it, from the
 * page's level: a schema when the URL names it, a table when the URL names it in that schema.
 */
function matches(node: TreeNode, type: NodeType, db: string, ancestors: TreeNode[], level: Level): { selected: boolean; inside: boolean } {
  if (level.db !== db) return { selected: false, inside: false }

  if (type.type === 'schema') {
    const selected = level.schema === node.label
    return { selected: selected && level.table === undefined, inside: selected && level.table !== undefined }
  }

  const schema = ancestors.find((a) => a.type === 'schema')
  if (schema && level.schema === schema.label && level.table === node.label && LEVEL_TYPES[level.kind ?? 'table'] === type.type) {
    return { selected: true, inside: false }
  }

  return { selected: false, inside: false }
}

/**
 * The children of a node in the tree, as phpMyAdmin groups a database's objects in containers
 * ("Tables", "Views"): one container per child type the server has, each loading its nodes
 * when opened. Everything comes from the node API, so a module only has to declare its node
 * type and where its page is (registerNodeLink) to appear here. With the tree linked to the
 * main panel, the containers and items on the way to the page shown open by themselves.
 */
export default function NodeChildren({ db, parentType = 'database', path = [], ancestors = [] }: NodeChildrenProps) {
  const parentPath = [db, ...path].join('/')
  const { t } = useTranslation()
  const level = useLevel()
  const state = useTreeState()
  const { data: types, error } = useRequest(() => getNodeTypes(db).then((all) => all.filter((type) => type.parent === parentType)), [db, parentType])

  if (error) {
    return (
      <ul>
        <li className="first last">
          <span className="text-danger">{error.message}</span>
        </li>
      </ul>
    )
  }

  if (!types) {
    return (
      <ul>
        <li className="first last italics">{t('loading')}</li>
      </ul>
    )
  }

  const linked = state.isLinked() && level.db === db
  // The container on the way to the page: schemas when a schema is shown, the relation kind's when a table is.
  const openContainer = !linked
    ? null
    : parentType === 'database' && level.schema !== undefined
      ? 'schema'
      : parentType === 'schema' && level.table !== undefined && ancestors.some((a) => a.type === 'schema' && a.label === level.schema)
        ? LEVEL_TYPES[level.kind ?? 'table']
        : null

  return (
    <ul>
      {types.map((type, index) => (
        <TreeItem
          key={type.type}
          path={`${parentPath}/${type.collection}`}
          label={type.label || type.collection}
          href="#"
          icon={type.icon}
          className={`${type.collection}Container subContainer`}
          expandable
          last={index === types.length - 1}
          autoOpen={openContainer === type.type}
        >
          <Nodes db={db} type={type} path={[...path, type.collection]} ancestors={ancestors} level={level} linked={linked} />
        </TreeItem>
      ))}
    </ul>
  )
}

function Nodes({ db, type, path, ancestors, level, linked }: { db: string; type: NodeType; path: (string | number)[]; ancestors: TreeNode[]; level: Level; linked: boolean }) {
  const parentPath = [db, ...path].join('/')
  const { t } = useTranslation()
  const url = collectionUrl(db, ...path)
  const state = useTreeState()
  const { data: nodes, error } = useRequest(() => collection(url).nodes(), [url, state.version()])

  if (error) {
    return (
      <ul>
        <li className="first last">
          <span className="text-danger">{error.message}</span>
        </li>
      </ul>
    )
  }

  if (!nodes) {
    return (
      <ul>
        <li className="first last italics">{t('loading')}</li>
      </ul>
    )
  }

  return (
    <ul>
      <TreeList
        items={nodes}
        label={(node) => node.label}
        render={(node, index, visible) => {
          const { selected, inside } = linked ? matches(node, type, db, ancestors, level) : { selected: false, inside: false }

          return (
            <TreeItem
              key={node.id}
              path={`${parentPath}/${node.oid}`}
              label={node.label}
              href={nodeLink(node, { db, ancestors })}
              icon={node.icon || type.icon}
              className={type.type}
              expandable={node.inode}
              last={index === visible.length - 1}
              selected={selected}
              autoOpen={inside}
            >
              <NodeChildren db={db} parentType={type.type} path={[...path, node.oid]} ancestors={[...ancestors, node]} />
            </TreeItem>
          )
        }}
      />
    </ul>
  )
}
