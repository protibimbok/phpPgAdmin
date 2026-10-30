import { urls, type RelationKind } from '@/level'
import type { TreeNode } from './client'

/** Where a tree node of some type leads; the module owning the type registers it. */
export type NodeLink = (node: TreeNode, context: NodeLinkContext) => string

/** Where the container of a node type ("Tables", "Columns") leads, given where it hangs. */
export type ContainerLink = (context: NodeLinkContext) => string

export interface NodeLinkContext {
  /** The database the node is in; null for a server-level node. */
  db: string | null
  /** The ancestors above the node (for a container, above its nodes), outermost first. */
  ancestors: TreeNode[]
}

const links = new Map<string, NodeLink>()

const containers = new Map<string, ContainerLink>()

/**
 * Register the page a node type opens: registerNodeLink('schema', (node, { db }) =>
 * urls.schema(db, node.label)). Called from a module's frontend script.
 */
export function registerNodeLink(type: string, link: NodeLink): void {
  links.set(type, link)
}

/**
 * Register the page a node type's container opens, the list of those objects:
 * registerContainerLink('sequence', ({ db, ancestors }) => …/sequences). A node type without
 * a page of its own opens its container's page too.
 */
export function registerContainerLink(type: string, link: ContainerLink): void {
  containers.set(type, link)
}

/** The "New" entry a container starts with, as phpMyAdmin's tree has under Tables and Views. */
export interface NewLink {
  link: ContainerLink
  icon: string
}

const newLinks = new Map<string, NewLink>()

/** Register the "New" entry of a node type's container: the page that creates one. */
export function registerNewLink(type: string, link: NewLink): void {
  newLinks.set(type, link)
}

export function newLink(type: string): NewLink | undefined {
  return newLinks.get(type)
}

/** The page for a node: its own, else its container's. */
export function nodeLink(node: TreeNode, context: NodeLinkContext): string {
  return links.get(node.type)?.(node, context) ?? containerLink(node.type, context)
}

/** The page for a container: the one registered, else the page of the node it hangs under. */
export function containerLink(type: string, context: NodeLinkContext): string {
  const link = containers.get(type)
  if (link) return link(context)

  const parent = context.ancestors.at(-1)
  if (parent) return nodeLink(parent, { db: context.db, ancestors: context.ancestors.slice(0, -1) })

  return context.db === null ? urls.server() : urls.database(context.db)
}

/** The schema a node is in, from its ancestors. */
export function schemaOf(ancestors: TreeNode[]): string | undefined {
  return ancestors.find((a) => a.type === 'schema')?.label
}

/** The table, view or materialized view a node belongs to, from its ancestors. */
export function relationOf(ancestors: TreeNode[]): { name: string; kind: RelationKind } | undefined {
  const relation = [...ancestors].reverse().find((a) => a.type === 'table' || a.type === 'view' || a.type === 'mview')

  return relation && { name: relation.label, kind: relation.type as RelationKind }
}
