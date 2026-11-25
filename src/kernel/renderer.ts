import { givenName } from './nodes.js';

/**
 * The renderer a game draws with, as its package tells the kernel — by declaration merging, so the
 * kernel imports no renderer and `this.node` is still that renderer's own class:
 *
 * ```ts
 * declare module '@scenoco/kernel' {
 *   interface Renderer { node: Object3D; camera: PerspectiveCamera | OrthographicCamera }
 * }
 * ```
 *
 * A game draws with one renderer, so one package says it. Unsaid, a node is a {@link BaseNode}.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Renderer {}

/** All the kernel reads of a node: what it hangs from, what hangs from it, and leaving. */
export interface BaseNode {
  readonly parent: BaseNode | null;
  readonly children: readonly BaseNode[];
  removeFromParent(): unknown;
}

/** A node of the scene graph: the renderer's own class — three.js's `Object3D`, pixi's `Container3D`. */
export type Node = Renderer extends { node: infer N extends BaseNode } ? N : BaseNode;

/** The camera a scene is drawn with, as the renderer types it. */
export type RenderCamera = Renderer extends { camera: infer C } ? C : object;

/** A node's name for a message: the one it was given, else its class. */
export function nodeName(node: object): string {
  const given = givenName(node);
  return given ? `"${given}"` : `a ${node.constructor.name}`;
}
