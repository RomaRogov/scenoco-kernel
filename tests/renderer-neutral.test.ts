import { afterEach, describe, expect, it } from 'vitest';
import {
  Behaviour,
  bindRenderer,
  destroy,
  findObjectOfType,
  installNodeMethods,
  installNodeTweens,
  instantiate,
  jsx,
  prefab,
  simulate,
  type RendererPort,
  type Simulation,
  type Tween,
} from '@scenoco/kernel';

/**
 * A renderer that is not three.js — shaped as pixi's `Container`: `addChild`, `label`, `x`/`y`/`z` —
 * and the port the kernel asks for, whole. No renderer merges its classes into `Renderer` here, so
 * values are cast where the kernel's signatures name a node.
 */
class Box {
  parent: Box | null = null;
  readonly children: Box[] = [];
  label = '';
  visible = true;
  x = 0;
  y = 0;
  z = 0;
  scale: [number, number, number] = [1, 1, 1];
  rotation: [number, number, number, number] = [0, 0, 0, 1];
  addChild(child: Box): void {
    child.removeFromParent();
    child.parent = this;
    this.children.push(child);
  }
  removeFromParent(): void {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  /** Where it is in the world: no rotation or scale in this renderer's world, only offsets. */
  world(): [number, number, number] {
    const up = this.parent?.world() ?? [0, 0, 0];
    return [up[0] + this.x, up[1] + this.y, up[2] + this.z];
  }
}
class Stage extends Box {}
class Eye extends Box {}
/** Built from one options object, as pixi's `Mesh` is: with none, it throws. */
class Plate extends Box {
  readonly size: number;
  constructor(options: { size: number }) {
    super();
    this.size = options.size;
  }
}
/** A node hosting a world of its own, outside its `children` — as pixi's `View3D` holds its 3D world as `root`. */
class Host extends Box {
  readonly root = new Box();
}
const hostOf = (node: Box) => (node.parent && hosts.get(node.parent)) || null;
const hosts = new WeakMap<Box, Host>();

/** What is no node and goes on a list, as pixi's filters do. */
class Tint {
  filters?: Tint[];
}

const box = (node: unknown) => node as Box;
const port: RendererPort = {
  nodeKind: 'a Box',
  nameKey: 'label' as never,
  isNode: (value): value is never => value instanceof Box,
  add(parent, child) {
    const into = parent instanceof Host ? (hosts.set(parent.root, parent), parent.root) : box(parent);
    into.addChild(box(child));
  },
  // The host's world is its children's parent, hidden: the tree reads host → its world's children.
  parentOf: (node) => (hostOf(box(node)) ?? box(node).parent) as never,
  childrenOf: (node) => (node instanceof Host ? node.root.children : box(node).children) as never,
  reparent: (parent, child) => box(parent).addChild(box(child)),
  isVisible: (node) => box(node).visible,
  // Built from its props, as pixi's classes are; and a `Tint` child goes on its parent's list.
  construct: (type, props) => new (type as new (options: object) => object)(props),
  attachChild(parent, child) {
    if (!(child instanceof Tint)) return false;
    const owner = parent as { tints?: Tint[] };
    (owner.tints ??= []).push(child);
    return true;
  },
  createScene: () => new Stage() as never,
  isScene: (node) => node instanceof Stage,
  isCamera: (node) => node instanceof Eye,
  fitCamera: () => {},
  project: (_camera, [x, y]) => [x / 10, y / 10],
  createView: () => {
    throw new Error('this renderer only simulates');
  },
  getPosition: (node, world, out) => Object.assign(out, world ? box(node).world() : [box(node).x, box(node).y, box(node).z]),
  setPosition(node, [x, y, z], world) {
    const up = world ? (box(node).parent?.world() ?? [0, 0, 0]) : [0, 0, 0];
    Object.assign(box(node), { x: x - up[0]!, y: y - up[1]!, z: z - up[2]! });
  },
  getRotation: (node, _world, out) => Object.assign(out, box(node).rotation),
  setRotation: (node, value) => void (box(node).rotation = [...value]),
  getScale: (node, out) => Object.assign(out, box(node).scale),
  setScale: (node, value) => void (box(node).scale = [...value]),
  lookRotation: () => [0, 0, 0, 1],
  vector2: (x, y) => ({ x, y, set() {} }) as never,
  vector3: (x, y, z) => ({ x, y, z }) as never,
  quaternion: (x, y, z, w) => ({ x, y, z, w }) as never,
  color: (r, g, b) => ({ r, g, b }) as never,
  // Its values are plain `{ x, y, z }`: moved number by number, written by assigning — its properties copy.
  values: {
    clone: (v) => ({ ...(v as object) }) as never,
    mix(from, to, t, out) {
      for (const k of Object.keys(out as object)) (out as Record<string, number>)[k] = (from as Record<string, number>)[k]! + ((to as Record<string, number>)[k]! - (from as Record<string, number>)[k]!) * t;
      return out;
    },
    sum: (a, b) => Object.fromEntries(Object.entries(a as object).map(([k, v]) => [k, v + (b as Record<string, number>)[k]!])) as never,
    assign: (owner, key, value) => void (owner[key] = value),
  },
};
bindRenderer(port);
installNodeMethods(Box.prototype);
installNodeTweens(Box.prototype);

class Spin extends Behaviour {
  speed = 1;
  turned = 0;
  gone = false;
  override update(dt: number) {
    this.turned += this.speed * dt;
  }
  override onDestroy() {
    this.gone = true;
  }
}

// Its props have defaults: `instantiate` calls it as a tag with no attributes does.
const Crate = prefab(({ speed = 2 }) => jsx(Box, { label: 'crate', children: jsx(Spin, { speed }) }));
const Main = () => jsx(Stage, { children: [jsx(Eye, { label: 'eye' }), jsx(Box, { label: 'floor', y: -1 })] });

let game: Simulation | null = null;
afterEach(() => game?.dispose());

describe('the kernel on a renderer that is not three.js', () => {
  it('runs a scene: TSX, prefabs, instantiate, behaviours, a node tween and destroy, all through its port', () => {
    game = simulate(Main);
    expect(game.camera).toBeInstanceOf(Eye);
    const crate = instantiate(Crate as never) as unknown as Box;
    expect(crate.parent).toBe(game.scene.children[0]);

    const tween = (crate as unknown as { doMove(to: object, d: number): Tween }).doMove({ x: 4, y: 2, z: 0 }, 0.5);
    game.step(60);
    expect(tween.isActive()).toBe(false);
    expect([crate.x, crate.y]).toEqual([4, 2]);
    const spin = findObjectOfType(Spin)!;
    expect(spin.turned).toBeGreaterThan(1.9);

    destroy(crate as never);
    game.step();
    expect(spin.gone).toBe(true);
    expect(crate.parent).toBeNull();
  });

  it('builds an element from its props, and puts a child that is no node where the renderer says', () => {
    const plate = jsx(Plate, { size: 3, children: [jsx(Tint, {}), jsx(Tint, {})] }) as Plate & { tints: Tint[] };
    expect(plate.size).toBe(3);
    expect(plate.tints).toHaveLength(2);
  });

  it('walks a tree whose nodes host another, as the port has it: lookups, the scene, destroy', () => {
    game = simulate(() => jsx(Stage, { children: jsx(Host, { label: 'view', children: jsx(Box, { label: 'inside', children: jsx(Spin, {}) }) }) }));
    game.step();
    const spin = findObjectOfType(Spin)!;
    expect(spin.turned).toBeGreaterThan(0);
    // Its node's parent, as the port has the tree: the host, not the hidden root.
    const host = hostOf(spin.node as unknown as Box)!;
    expect(host.label).toBe('view');
    expect((spin.node as unknown as { scene: unknown }).scene).toBe(game.scene.children[0]);
    destroy(host as never);
    game.step();
    expect(spin.gone).toBe(true);
  });

  it("names the renderer's node in a refusal", () => {
    const Label = prefab(() => 'text');
    expect(() => jsx(Label, { children: jsx(Box, {}) })).toThrow('only a prefab whose root is a Box takes children');
  });
});
