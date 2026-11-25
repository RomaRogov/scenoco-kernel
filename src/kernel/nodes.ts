import type { Node } from './renderer.js';
import { boundPort } from '../port.js';

/**
 * A node's parent, as the renderer's tree has it: its `parent`, unless the port says otherwise — pixi's
 * 3D world hangs from its `View3D`, which holds it as `root`, not among its children.
 */
export function parentOf(node: Node): Node | null {
  const port = boundPort();
  return (port?.parentOf ? port.parentOf(node) : node.parent) as Node | null;
}

/** A node's children, as the renderer's tree has them — the live list, not a copy. */
export function childrenOf(node: Node): readonly Node[] {
  const port = boundPort();
  return (port?.childrenOf ? port.childrenOf(node) : node.children) as readonly Node[];
}

/** Every node from `root` down, `root` first. */
export function traverse(root: Node, visit: (node: Node) => void): void {
  visit(root);
  for (const child of childrenOf(root)) traverse(child, visit);
}

/** The name a node was given — in the property the renderer keeps it in (`nameKey`) — or ''. */
export function givenName(node: object): string {
  const value = (node as Record<string, unknown>)[boundPort()?.nameKey ?? 'name'];
  return typeof value === 'string' ? value : '';
}

/** A node's kind, as its renderer names it: three.js's `type`, else its class. */
export function kindOf(node: object): string {
  const type = (node as { type?: unknown }).type;
  return typeof type === 'string' ? type : node.constructor.name;
}

/** The first node from `root` down given `name`, or null. */
export function findNamed(root: Node, name: string): Node | null {
  let found: Node | null = null;
  traverse(root, (node) => void (found ??= givenName(node) === name ? node : null));
  return found;
}
