import type { Node, RenderCamera, Renderer } from './kernel/renderer.js';
import type { Game } from './play.js';

/** Three numbers: a position, a scale, or angles. */
export type Vec3 = [x: number, y: number, z: number];
/** A rotation as a quaternion's four numbers. */
export type Quat = [x: number, y: number, z: number, w: number];

/** A renderer's vector, colour and rotation types, as its package names them in `Renderer`. */
type Named<K extends string, Else> = Renderer extends { [P in K]: infer T } ? T : Else;
export type Vector2Of = Named<'vector2', { x: number; y: number }>;
export type Vector3Of = Named<'vector3', { x: number; y: number; z: number }>;
export type QuaternionOf = Named<'quaternion', { x: number; y: number; z: number; w: number }>;
export type ColorOf = Named<'color', never>;
/** What a colour field or attribute takes besides a colour: three.js's `ColorRepresentation`, pixi's `ColorSource`. */
export type ColorInputOf = Named<'colorInput', never>;
/** The property a node's given name is in: three.js's `name`, pixi's `label`. */
export type NameKeyOf = Named<'nameKey', 'name'>;
/** Where the game is drawn: three.js's `WebGLRenderer`, pixi's `Application`. */
export type ViewOf = Named<'view', object>;
/** The root node a game runs and a scene is: three.js's `Scene`. */
export type SceneOf = Named<'scene', Node>;
/** What `play` takes besides the kernel's own options: `{ renderer?: WebGLRenderer }`. */
export type ViewOptionsOf = Named<'viewOptions', object>;

/**
 * What draws a game: the renderer's canvas and its loop. `play` makes one with `RendererPort.createView`,
 * sizes it, and calls `render` every frame after the behaviours ran. The kernel owns the loop: a
 * renderer that would draw on its own clock — pixi's `Application` ticker — leaves that clock stopped
 * and draws in `render`.
 */
export interface View {
  /** The renderer's own object, as `game.renderer`: three.js's `WebGLRenderer`. */
  readonly renderer: ViewOf;
  /** The element drawn into: what `Input` listens to and the page holds. */
  readonly element: HTMLElement;
  /** Its size now, in CSS pixels. */
  size(): [width: number, height: number];
  /** Resize to `width`×`height` CSS pixels. */
  setSize(width: number, height: number): void;
  /** Draw `scene` from `camera`, now — or with none, where the renderer draws without one (`drawsWithoutCamera`). */
  render(scene: SceneOf, camera: RenderCamera | null): void;
  /** Call `frame` once a display frame with the time now in milliseconds, or stop with null. */
  setLoop(frame: ((now: number) => void) | null): void;
  /** Free what the view made. Called when the game is disposed. */
  dispose(): void;
}

/**
 * How the renderer's own values — its vectors, rotations and colours — are moved and taken in. The
 * kernel never calls a method on one: a tween asks `mix` and `sum`, and an attribute, a behaviour's
 * field or a tweened property is written with `assign`. A number never comes here.
 */
export interface ValuePort {
  /** A copy of `value`, free of whatever it was read from. */
  clone<T>(value: T): T;
  /** `from` towards `to` by `t` (past 1 for an incremental loop), into `out`, returned: a vector or colour linearly, a rotation the short way round. */
  mix<T>(from: T, to: T, t: number, out: T): T;
  /** `a` and then `b`, new: a vector or colour added, a rotation turned on by `b`. For relative and incremental tweens. */
  sum<T>(a: T, b: T): T;
  /**
   * `owner[key] = value`, the renderer's way: copied into the value the property holds when it holds
   * one of the same kind — so a node's `position` stays its own — converted from what a colour or a
   * vector is written as, and assigned otherwise: a shared thing (a geometry, a texture, a node) by
   * reference. The kernel calls it for what `set(…)` shorthand did not take.
   */
  assign(owner: Record<string, unknown>, key: string, value: unknown): void;
}

/** Angles as a renderer's own rotation value holds them. */
export interface EulerAngles {
  x: number;
  y: number;
  z: number;
  /** Which axis turns first: three.js's names, `'XYZ'` x first. */
  order: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
}

/** What a quality level asks of a renderer: Unity's Quality settings, as `QualitySettings.levels` hold them. */
export interface QualityAsk {
  /** 0 none, 1 hard-edged only, 2 all — Unity's `ShadowQuality`. */
  shadows: number;
  /** The resolution drawn, times the screen's. */
  renderScale: number;
}

/**
 * Everything the kernel asks of a renderer: what its nodes are, how they hang together and move, how
 * a scene is drawn, and the few kinds of value the kernel makes for a game. A renderer's package
 * implements it once and hands it to {@link bindRenderer} before any scene is built — its
 * `jsx-runtime` entry is the place, as every scene imports that first.
 *
 * Everything else — behaviours, the frame, scenes and their loading, prefabs, TSX, tweens, input,
 * the development bridge — is the kernel's, the same on every renderer. Read the kernel's README.
 */
export interface RendererPort {
  /** A node as an error message names it: `'an Object3D'`. */
  readonly nodeKind: string;
  /** The property a node's given name is in — what a prefab's tag sets as `name` in Unity: three.js's `'name'`, pixi's `'label'`. */
  readonly nameKey: NameKeyOf;

  // --- the scene graph --------------------------------------------------------------------------

  /** Whether a value is a node: three.js's `isObject3D`. */
  isNode(value: object): value is Node;
  /** Puts `child` under `parent`, keeping its local transform: three.js's `add`, pixi's `addChild`. */
  add(parent: Node, child: Node): void;
  /** Puts `child` under `parent`, keeping where it is in the world: three.js's `attach`, pixi's `reparentChild`. */
  reparent(parent: Node, child: Node): void;
  /** Its own visibility flag: three.js's and pixi's `visible`. */
  isVisible(node: Node): boolean;
  /**
   * A node's parent and children as the tree has them, where that is not its `parent` and `children`:
   * a renderer whose nodes host another kind of tree. pixi's `View3D` is a 2D node holding a 3D world
   * as its `root`, so its 3D children are `root`'s, and `root`'s parent is the view. `childrenOf`
   * returns the live list. Left out: `node.parent`, `node.children`.
   */
  parentOf?(node: Node): Node | null;
  childrenOf?(node: Node): readonly Node[];

  // --- TSX --------------------------------------------------------------------------------------

  /**
   * Build an element given no `args`, from its props — every attribute it was written with but
   * `children`, `ref`, `key` and `attach`. pixi's classes take one options object, and some need it
   * (`Mesh`, `NineSliceSprite`), so pixi builds `new type(props)`, as pixi-react does. The kernel then
   * sets every prop as an attribute all the same. Left out: `new type()`, three.js's way, whose
   * constructors take arguments in order.
   */
  construct?(type: new (...args: never[]) => object, props: Readonly<Record<string, unknown>>): object;
  /**
   * Put a child that is no node, and names no `attach`, where its kind goes — three.js's geometry and
   * material into their slots, pixi's filters onto the list — and say whether it did. One it did not
   * is refused, naming `attach`.
   */
  attachChild?(parent: object, child: object): boolean;
  /** `child` was written inside `parent`: it is the parent's, to free with it. */
  adopt?(child: object, parent: object): void;
  /** A destroyed node has left its parent: free what its elements built. */
  freeBuilt?(node: Node): void;

  // --- scenes -----------------------------------------------------------------------------------

  /** A new, empty scene: the game's root, and what a scene's element is wrapped in when it is not one. */
  createScene(): SceneOf;
  /** Whether a node is a scene: three.js's `isScene`. */
  isScene(node: Node): boolean;
  /**
   * A loaded scene's settings — Unity's RenderSettings, three.js's `background`, `fog`, `environment` —
   * become the drawing scene's, replacing the last one's: those it leaves unset are unset.
   */
  adoptSettings?(scene: SceneOf, root: SceneOf): void;

  // --- cameras and drawing ----------------------------------------------------------------------

  /** Whether a node is a camera a scene can be drawn with. */
  isCamera(node: Node): boolean;
  /**
   * The scene draws with no camera: pixi's 2D stage is the screen itself. Then `render` is called with
   * the main camera when there is one — the first visible camera, what `this.camera` is — and with
   * null when there is none, never an error. Left out: a scene needs a camera, three.js's way.
   */
  readonly drawsWithoutCamera?: boolean;
  /** A camera to a screen's shape: Unity's, its height kept and its width following the screen. */
  fitCamera(camera: RenderCamera, width: number, height: number): void;
  /** Where a world position is seen by `camera`, from -1 to 1 each way, y up: normalized device coordinates. */
  project(camera: RenderCamera, position: Vec3): [x: number, y: number];
  /** The view `play` draws `scene` into — the game's root, for the whole game — from what `play` was given. */
  createView(options: ViewOptionsOf, scene: SceneOf): View;
  /** Apply a quality level to a running game: scaled and turned off from how the game set its view up, which the port keeps. */
  applyQuality?(renderer: ViewOf, scene: SceneOf, level: QualityAsk): void;

  // --- transforms, as numbers -------------------------------------------------------------------
  // A tween reads and writes these every frame: a getter writes into `out` and returns it, and a
  // setter reads its array and keeps nothing — so neither side makes anything per frame.

  /** Its position, into `out`: in its parent's space, or the world's. */
  getPosition(node: Node, world: boolean, out: Vec3): Vec3;
  setPosition(node: Node, value: Readonly<Vec3>, world: boolean): void;
  /** Its rotation as a quaternion, into `out`: in its parent's space, or the world's. */
  getRotation(node: Node, world: boolean, out: Quat): Quat;
  setRotation(node: Node, value: Readonly<Quat>, world: boolean): void;
  getScale(node: Node, out: Vec3): Vec3;
  setScale(node: Node, value: Readonly<Vec3>): void;
  /** The local rotation that turns it to face a world point. */
  lookRotation(node: Node, point: Vec3): Quat;

  // --- values the kernel makes for a game -------------------------------------------------------

  vector2(x: number, y: number): Vector2Of;
  vector3(x: number, y: number, z: number): Vector3Of;
  quaternion(x: number, y: number, z: number, w: number): QuaternionOf;
  /** A colour from sRGB components, 0..1, as a colour picker gives them. */
  color(r: number, g: number, b: number): ColorOf;
  /** How those values, and every other the renderer has, move and are written. */
  readonly values: ValuePort;
  /**
   * The angles a rotation value holds, in radians, when it is the renderer's own Euler — three.js's
   * `Euler`. Undefined for any other value: a tween's angles are degrees then, as DOTween's are.
   */
  eulerOf?(value: object): EulerAngles | undefined;

  // --- development only: the bridge and the editor --------------------------------------------
  // Only the bridge and the editor call these, and the kernel reaches both only in development. Set
  // them behind `import.meta.env.DEV`, or a production build keeps them and all they reference —
  // `bridgeScope: { THREE }` alone keeps every class three.js has.
  /** A value as plain data, for the bridge to print: a vector's numbers, a colour's `#rrggbb`. Undefined for what it does not know. */
  plain?(value: object): unknown;
  /** A camera the bridge draws from instead of the game's: `fov` degrees, at `from`, looking at `at`. */
  viewCamera?(fov: number, aspect: number, from: Vec3, at: Vec3): RenderCamera;
  /** Names the bridge's `eval` has besides the game's own: the renderer's namespace, `{ THREE }`. */
  readonly bridgeScope?: Readonly<Record<string, unknown>>;

  /** An object was changed in place from outside the game — the editor: refresh what is derived from it (a material's shader, a camera's projection). */
  refresh?(target: object): void;
  /** A value worked out from an object's others — a camera's projection matrix — which the editor's argument probe passes over. */
  isDerived?(value: object): boolean;
  /** Whether `remake` can make this object — not a node — again in place: three.js's geometries can. */
  canRemake?(target: object): boolean;
  /** Make `target` what `fresh` is, in place, so every reference to it sees the change — three.js copies a geometry into itself — and free what is left over. */
  remake?(target: object, fresh: object): void;
  /** Free an object the editor built only to look at, and its GPU resources: three.js's `dispose`. */
  free?(value: object): void;
  /** The editor over a running game in development, if the renderer has one. */
  readonly editor?: EditorPort;
}

/**
 * The renderer's half of the editor, in development: how it looks at the game — its own camera, a
 * gizmo, picking, an outline. Everything the editor does to the game — selection as the TSX that made
 * it, edits, prefabs called again, the held clock, reset — is the kernel's.
 */
export interface EditorPort {
  /** The editor's view of `game`, made when the editor opens: told what the user does through `events`. */
  openViewport(game: Game, events: ViewportEvents): Promise<EditorViewport>;
  /** Size the view to `host` while the editor lays the page out — its bar or its panel; false when neither does. */
  sizeView?(view: View, host: HTMLElement): boolean;
}

/** What a viewport tells the editor. */
export interface ViewportEvents {
  /** The user picked a node in the view, or nothing. The editor selects what an element wrote, above it. */
  picked(node: Node | null): void;
  /** A gizmo drag moved the selected node: one step of it. */
  dragged(node: Node): void;
  /** A gizmo drag ended; `before` is the node's transform when it began. */
  dropped(node: Node, before: Transform): void;
}

/** A node's transform as plain numbers: rotation as angles in radians. */
export interface Transform {
  position: number[];
  rotation: number[];
  scale: number[];
}

/** The renderer's view of a game under the editor. */
export interface EditorViewport {
  /** Paused: look through the editor's own camera, starting from where the game's stands. Not: the game's again. */
  lookThrough(paused: boolean): void;
  /** The gizmo and outline on `node`, or on nothing. */
  select(node: Node | null): void;
  setMode(mode: 'translate' | 'rotate' | 'scale'): void;
  /** Point the editor's camera at `node`. */
  frame(node: Node): void;
  /** Show only `node` and the way to it — Unity's isolation — or everything again with null. */
  isolate(node: Node | null): void;
  /** After the game drew from `camera`: the gizmo, the grid, the outline, over it. */
  draw(camera: RenderCamera): void;
  dispose(): void;
}

let bound: RendererPort | null = null;

/** Hand the kernel its renderer. Once, from the renderer package's entry; a second call replaces it (a dev server reloading). */
export function bindRenderer(port: RendererPort): void {
  bound = port;
}

/** @internal the bound renderer. */
export function port(): RendererPort {
  if (bound) return bound;
  throw new Error(
    "SceNoCo's kernel has no renderer: import the game's renderer package — `@scenoco-three/core` — before building a scene. Its JSX runtime binds it.",
  );
}

/** @internal the bound renderer, or null before one is bound — for what runs either way. */
export function boundPort(): RendererPort | null {
  return bound;
}
