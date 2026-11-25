import type { Behaviour } from './Behaviour.js';
import type { ColorInputOf, ColorOf } from '../port.js';
import type { Node } from './renderer.js';

export type { Node };

/** Any behaviour class, abstract ones included — what the lookups take. */
export type BehaviourType<T extends Behaviour = Behaviour> = abstract new () => T;

/** A behaviour class that can be constructed — what `addComponent` takes. No constructor arguments. */
export type ConstructableBehaviour<T extends Behaviour = Behaviour> = new () => T;

/** The node class a behaviour declares it drives: `Behaviour<Mesh>` → `Mesh`. */
export type NodeOf<T extends Behaviour> = T extends Behaviour<infer N> ? N : Node;

/** A behaviour class whose instances can be added to a node of class `N`, generic ones included. */
export type DrivesNode<N> = abstract new () => { readonly _drives?: (node: N) => void };

/**
 * Passes when a node of class `N` can carry behaviour `T`; otherwise a type whose one property names
 * the fix, which is what tsc prints — rather than `Property 'isGroup' is missing in type 'Object3D'`.
 */
export type FitsNode<N, T extends Behaviour> = N extends NodeOf<T>
  ? unknown
  : {
      'this behaviour drives a narrower node class than this node is typed as. Type the node: instantiate<Group>(Prefab), or (node as Mesh). Or extend plain Behaviour': true;
    };

/** Unity's message methods, camelCase. Every one is optional; a behaviour is called only for what it defines. */
export interface BehaviourHooks {
  /** Once, when the behaviour first lands in a running scene — before any `start`. */
  awake?(): void;
  /** Each time it becomes enabled and in a running scene. */
  onEnable?(): void;
  /** Once, before its first `fixedUpdate`/`update`. Fields set right after `instantiate` are in. */
  start?(): void;
  /** At a fixed rate (`Runtime.fixedDelta`, 50 Hz by default), for physics-like work. */
  fixedUpdate?(dt: number): void;
  /** Every frame. */
  update?(dt: number): void;
  /** Every frame, after every `update` — cameras that follow. */
  lateUpdate?(dt: number): void;
  /** Each time it stops being enabled or leaves the running scene. */
  onDisable?(): void;
  /** Once, at the end of the frame it was destroyed in. */
  onDestroy?(): void;
  /**
   * Unity's `OnValidate`: in the editor, after one of its fields was changed there — or a node it
   * was given moved, or its own did. Do again what `start` did from them, so the change shows:
   * `onValidate() { this.place(); }`.
   */
  onValidate?(): void;
}

// --- authorable fields ------------------------------------------------------------------------

type IsIdentical<X, Y, Then, Else> =
  (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y ? 1 : 2 ? Then : Else;

declare const prefab: unique symbol;

/**
 * What `prefab()` stamps on a function's type, worded as the fix: tsc prints it when a plain function
 * is given where a prefab belongs. Spelled out where it is used, never behind a name, so the
 * message is what tsc shows rather than the name.
 */
export type PrefabMarkKey = 'a prefab is made with prefab(): export const Coin = prefab(() => <Mesh>...</Mesh>)';

/**
 * A prefab as a field's type, Unity's `public GameObject prefab`: `projectile: Prefab | null = null`,
 * set in TSX as `<Tower projectile={Arrow} />`, built with `instantiate(this.projectile)`. What
 * `prefab()` makes, built with no props — so one whose props all have defaults, `({ size = 1 }) => …`,
 * is one too, and one that needs a prop is not. Typed this way, the field is a setting; typed
 * `() => Object3D`, tsc cannot tell it from a method, and it would not be.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Prefab<T extends Node = Node> = ((props: {}) => unknown) & { readonly [K in PrefabMarkKey]: true } & { readonly [prefab]?: T };

/** True for data, false for methods — a class (a behaviour type) and a `Prefab` count as data. */
type IsValue<V> = V extends Function
  ? V extends abstract new (...args: never[]) => unknown
    ? true
    : typeof prefab extends keyof V
      ? true
      : false
  : true;

/** Plain settable data fields: no methods, no readonly fields (and so no getters). */
type AuthorableKeys<T> = {
  [K in keyof T]-?: IsValue<T[K]> extends true
    ? IsIdentical<{ [Q in K]: T[K] }, { -readonly [Q in K]: T[K] }, K, never>
    : never;
}[keyof T];

/** A React ref, or anything else with `current`. */
export interface RefLike<T> {
  readonly current: T | null;
}

/** What `set(…)` takes, as one value when it takes one — `'#f80'` for a colour, `[0, 1, 2]` for a vector. */
type SetArgs<A> = A extends [infer Only] ? Only | A : A;

/**
 * What a value is written as besides itself, the same for an attribute and a field (`assign.ts`):
 * what its own `set` or `setScalar` takes — R3F's `position={[0, 1, 0]}`, `scale={2}` — and, for the
 * renderer's colour, what the renderer takes for one (`'#ff8800'`).
 */
export type Shorthand<V> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  | (V extends { set(...args: infer A): any } ? SetArgs<A> : never)
  | (V extends { setScalar(scalar: number): unknown } ? number : never)
  | ([V] extends [ColorOf] ? ColorInputOf : never);

/** What a field accepts besides itself: its shorthand, and for a link to an object a ref to it, read once the scene is built. */
export type InitValue<V> = V extends RefLike<unknown>
  ? 'a ref given to a field arrives as the object it points at: declare the field as the object — target: Mesh | null = null'
  : V extends object
    ? V | Shorthand<V> | RefLike<V>
    : V;

/** The settings a behaviour exposes: its public data fields, every one optional. */
export type BehaviourInit<T extends Behaviour> = {
  [K in Exclude<AuthorableKeys<T>, keyof Behaviour>]?: InitValue<T[K]>;
};
