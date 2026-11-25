import type { BehaviourType, ConstructableBehaviour } from './kernel/types.js';
import { addComponent } from './kernel/attach.js';
import {
  getComponent,
  getComponentInChildren,
  getComponentInParent,
  getComponents,
  getComponentsInChildren,
} from './kernel/registry.js';
import { isNodeDestroyed } from './kernel/lifecycle.js';
import type { Node } from './kernel/renderer.js';
import { parentOf } from './kernel/nodes.js';
import { port } from './port.js';

/**
 * Unity's GameObject methods on the renderer's node class: `addComponent`, `getComponent` and its kin,
 * `isDestroyed`, and `scene` — the nearest scene above. Additions only: nothing the renderer defines
 * is replaced. The renderer's package calls this once with its node class's prototype — three.js's
 * `Object3D.prototype` — and declares the same members on that class for TypeScript.
 */
export function installNodeMethods(prototype: object): void {
  const methods: Record<string, (this: Node, ...args: never[]) => unknown> = {
    addComponent(this: Node, type: ConstructableBehaviour, init?: object) {
      return addComponent(this, type as never, init as never);
    },
    getComponent(this: Node, type: BehaviourType) {
      return getComponent(this, type);
    },
    getComponents(this: Node, type: BehaviourType) {
      return getComponents(this, type);
    },
    getComponentInChildren(this: Node, type: BehaviourType) {
      return getComponentInChildren(this, type);
    },
    getComponentsInChildren(this: Node, type: BehaviourType) {
      return getComponentsInChildren(this, type);
    },
    getComponentInParent(this: Node, type: BehaviourType) {
      return getComponentInParent(this, type);
    },
  };
  for (const [name, value] of Object.entries(methods)) {
    // `configurable` so a dev server evaluating this module twice replaces rather than throws.
    Object.defineProperty(prototype, name, { value, configurable: true, writable: true });
  }
  Object.defineProperty(prototype, 'isDestroyed', {
    get(this: Node) {
      return isNodeDestroyed(this);
    },
    configurable: true,
  });
  Object.defineProperty(prototype, 'scene', {
    get(this: Node) {
      const renderer = port();
      for (let node: Node | null = this; node; node = parentOf(node)) if (renderer.isScene(node)) return node;
      return null;
    },
    // Code that keeps a `scene` of its own on an object still can: the value is that object's alone.
    set(this: Node, value: unknown) {
      Object.defineProperty(this, 'scene', { value, configurable: true, writable: true, enumerable: true });
    },
    configurable: true,
  });
}
