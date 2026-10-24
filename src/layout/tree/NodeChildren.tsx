import { useTranslation } from 'react-i18next'
import { useRequest } from '@/api/useRequest'
import { collection, collectionUrl, getNodeTypes, type NodeType, type TreeNode } from '@/nodes/client'
import { nodeLink } from '@/nodes/links'
import TreeItem from './TreeItem'

export interface NodeChildrenProps {
  /** The database the children are in. */
  db: string
  /** The node type whose children to show; the database's own when left out. */
  parentType?: string
  /** The collection path from the database down to the parent: ['schemas', 2200]. */
  path?: (string | number)[]
  ancestors?: TreeNode[]
}

/**
 * The children of a node in the tree, as phpMyAdmin groups a database's objects in containers
 * ("Tables", "Views"): one container per child type the server has, each loading its nodes
 * when opened. Everything comes from the node API, so a module only has to declare its node
 * type and where its page is (registerNodeLink) to appear here.
 */
export default function NodeChildren({ db, parentType = 'database', path = [], ancestors = [] }: NodeChildrenProps) {
  const parentPath = [db, ...path].join('/')
  const { t } = useTranslation()
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
        >
          <Nodes db={db} type={type} path={[...path, type.collection]} ancestors={ancestors} />
        </TreeItem>
      ))}
    </ul>
  )
}

function Nodes({ db, type, path, ancestors }: { db: string; type: NodeType; path: (string | number)[]; ancestors: TreeNode[] }) {
  const { t } = useTranslation()
  const url = collectionUrl(db, ...path)
  const { data: nodes, error } = useRequest(() => collection(url).nodes(), [url])

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
      {nodes.map((node, index) => (
        <TreeItem
          key={node.id}
          path={`${[db, ...path].join('/')}/${node.oid}`}
          label={node.label}
          href={nodeLink(node, { db, ancestors })}
          icon={node.icon || type.icon}
          className={type.type}
          expandable={node.inode}
          last={index === nodes.length - 1}
        >
          <NodeChildren db={db} parentType={type.type} path={[...path, node.oid]} ancestors={[...ancestors, node]} />
        </TreeItem>
      ))}
    </ul>
  )
}
