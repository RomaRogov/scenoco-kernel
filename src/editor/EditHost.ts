import type { Behaviour } from '../kernel/Behaviour.js';
import type { Reach } from '../kernel/lifecycle.js';
import type { Node } from '../kernel/renderer.js';
import type { Source } from '../provenance.js';
import type { SceneOf, Transform, ValueView } from '../port.js';

export type { Transform, ValueView };

/** What the editor's interface works the game through. */
export interface EditHost {
  /** The scene the game draws: every loaded scene is in it. */
  readonly scene: SceneOf;
  readonly selected: Node | null;
  select(node: Node | null): void;
  readonly paused: boolean;
  pause(): void;
  play(): void;
  /** One frame, then held. */
  step(): void;
  /**
   * Load the page again and hold it with the editor open: after its first frame, with behaviours
   * gone only as far as `reach` — `'none'` to see the scene as written, `'frame'` (the default) for
   * `awake`, `onEnable`, `start` and one frame. Play or step from there goes on from where they stopped.
   */
  reset(reach?: Reach): void;
  /**
   * Start the page in this scene — `{ file, name }`: the exported scene `name` of `file`, as the dev
   * server serves it — or, with null, the way the game itself starts. Then as `reset`: the page is
   * loaded again and held, and every reset after it starts there too, until another is opened.
   */
  openScene(scene: OpenedScene | null, reach?: Reach): void;
  /** The scene opened with `openScene`, or null while the game starts its own way. */
  readonly openedScene: OpenedScene | null;
  /** What the gizmo does. */
  setMode(mode: 'translate' | 'rotate' | 'scale'): void;
  /** The selection changed. */
  on(event: 'select', listener: (node: Node | null) => void): void;
  /** The gizmo let go of the node it moved; `before` is its transform when the drag began. */
  on(event: 'moved', listener: (node: Node, before: Transform) => void): void;
  /** Where the element that made this object was written. */
  sourceOf(made: object): Source | undefined;
  /** The attributes that element was written with. */
  givenOf(made: object): Readonly<Record<string, unknown>> | undefined;
  /**
   * The function that made this node — a prefab or a plain component — and the props its tag gave:
   * none for a prefab `instantiate` made. Its name is often empty: `prefab(() => …)`. `added` is what the
   * tag put under the copy's root — child nodes, behaviours — the scene's own, as on a Unity prefab instance.
   */
  madeBy(node: Node): {
    name: string; prefab: boolean; props: Readonly<Record<string, unknown>>; fn: object;
    added: { nodes: readonly Node[]; behaviours: readonly Behaviour[] };
  } | undefined;
  /**
   * A prefab root's own element, inside the prefab — not its tag, which `sourceOf` answers for:
   * where it is written and with what. Undefined for a node no prefab made.
   */
  own(node: Node): { source?: Source; given?: Readonly<Record<string, unknown>> } | undefined;
  /** Show only `node` and what is under it — Unity's isolation — or everything again, with null. */
  isolate(node: Node | null): void;
  /** Made by `instantiate` since the scene loaded, or inside something that was: nothing in a scene file wrote it. */
  spawned(node: Node): boolean;
  behavioursOn(node: Node): readonly Behaviour[];
  /**
   * Set `name` on a live object the way an element does — a behaviour's field, R3F's rules for the
   * rest. A prop of a function's tag calls the function again with it, and the new node takes the
   * old one's place: `current` follows it there. `args` is the constructor's arguments, set as if it
   * had been built with them (see `parameters`). `prop`: the name is a prop of the function's tag
   * the target's element did not write, called again with it all the same.
   */
  apply(target: object, name: string, value: unknown, prop?: boolean): void;
  /**
   * For what an element built with `args`, whether a change to each argument can be made on the live
   * object — through the property it sets, or, for what is not a node (a geometry, a material), by
   * building it again in place.
   */
  parameters(made: object): { settable: boolean }[];
  /** What a target became after the edits that made it again: itself, if none did. */
  current(target: object): object;
  /** The file now says `name` is `value`: what `givenOf` answers from here on. */
  written(target: object, name: string, value: unknown): void;
  /** Point the editor's camera at a node. */
  frame(node: Node): void;
  /** A node's parent as the renderer's tree has it — a pixi 3D world hangs from its `View3D` — or null at the top. */
  parentOf(node: Node): Node | null;
  /** Its children as the renderer's tree has them: the live list. */
  childrenOf(node: Node): readonly Node[];
  /** Its given name — three.js's `name`, pixi's `label` — or '' with none. */
  nameOf(node: Node): string;
  /** Its kind as the renderer names it: three.js's `type`, else its class. */
  kindOf(node: Node): string;
  /** A number for the node, the same for its whole life: a key for a list of them. */
  idOf(node: Node): number;
  /** Whether a value is one of the renderer's nodes. */
  isNode(value: unknown): value is Node;
  /**
   * A live value as the inspector shows and edits it — a vector's numbers, a rotation's angles in
   * radians, a colour's `#rrggbb` — as the renderer describes it; undefined for one shown as it is.
   * `name` is the property it was read from.
   */
  describe(value: unknown, name: string): ValueView | undefined;
  close(): void;
}

/** A scene the editor opened: the exported function `name` of the module the dev server serves at `file`. */
export interface OpenedScene {
  file: string;
  name: string;
}
