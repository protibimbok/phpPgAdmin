import type { TreeNode } from './client'

/** Where a tree node of some type leads; the module owning the type registers it. */
export type NodeLink = (node: TreeNode, context: NodeLinkContext) => string

export interface NodeLinkContext {
  /** The database the node is in; null for a server-level node. */
  db: string | null
  /** The ancestors above the node, outermost first. */
  ancestors: TreeNode[]
}

const links = new Map<string, NodeLink>()

/**
 * Register the page a node type opens: registerNodeLink('schema', (node, { db }) =>
 * urls.schema(db, node.label)). Called from a module's frontend script.
 */
export function registerNodeLink(type: string, link: NodeLink): void {
  links.set(type, link)
}

/** The page for a node, or "#" when no module claims its type yet. */
export function nodeLink(node: TreeNode, context: NodeLinkContext): string {
  return links.get(node.type)?.(node, context) ?? '#'
}
