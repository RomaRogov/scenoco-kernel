/**
 * TSX that builds the renderer's own objects — no React. `<Mesh castShadow>` is `new Mesh()` with
 * `castShadow = true`, made the moment the expression runs; its children are added to it.
 *
 * The conventions are R3F's, so a model already knows them: `args` are the constructor's arguments,
 * a value goes through the property's own `set` or `copy` (`position={[0, 1, 2]}`, `color="#f80"`,
 * `scale={2}`), a dashed name reaches inside (`shadow-mapSize={[2048, 2048]}`), and a child that is
 * not a node is assigned to the property `attach` names — or the one the renderer gives its kind.
 * A node child is always added; with `attach` it fills that property too, as a light's `target` does.
 * A behaviour class is an element too: it becomes a component of its parent.
 *
 * What differs between renderers — what a node is, how one is added, which values are shared — the
 * bound {@link RendererPort} says.
 */
import { addDormant } from './kernel/attach.js';
import { handOver, record, remember, type Added, type Source } from './provenance.js';
import { Behaviour } from './kernel/Behaviour.js';
import type { Node, Renderer } from './kernel/renderer.js';
import type { BehaviourInit, ConstructableBehaviour, Prefab, PrefabMarkKey, RefLike, Shorthand } from './kernel/types.js';
import { Asset, loadsAs } from './assets/Asset.js';
import { port, type NameKeyOf } from './port.js';
import { assignValue } from './kernel/assign.js';

/** A model file, as `prefab(model)` takes it: an asset whose loaded copy is a fresh node each time. */
export interface ModelAsset extends Asset<unknown> {
  readonly url: string;
  instantiate(): Node;
}

/** A typed link to an element, set when the element is made: `const hero = ref<Mesh>()`, `<Mesh ref={hero}>`. */
export interface Ref<T> {
  current: T | null;
}

/** A typed link for `ref={…}` — and for a behaviour's field, which reads it once the scene is built. */
export function ref<T>(): Ref<T> {
  return { current: null };
}

export const Fragment = Symbol.for('scenoco.fragment');

const MARKER = Symbol.for('scenoco.marker');

/** What behaviour tag (e.g. `<Spinner speed={2} />`) evaluates to: a note for its parent, which adds the behaviour. */
interface BehaviourMarker {
  readonly [MARKER]: true;
  readonly type: ConstructableBehaviour;
  readonly init: Record<string, unknown>;
  readonly link: Ref<unknown> | undefined;
}

/** @internal A class that extends `Behaviour`: its tag makes a component, not a node. */
export function isBehaviourClass(type: unknown): type is ConstructableBehaviour {
  return typeof type === 'function' && type.prototype instanceof Behaviour;
}

function isMarker(value: unknown): value is BehaviourMarker {
  return typeof value === 'object' && value !== null && (value as BehaviourMarker)[MARKER] === true;
}

function marker(type: ConstructableBehaviour, props: Record<string, unknown>): BehaviourMarker {
  const { children, key: _key, ref: link, ...init } = props;
  if (children !== undefined) throw new Error(`<${type.name}> is a behaviour and takes no children.`);
  return { [MARKER]: true, type, init, link: link as Ref<unknown> | undefined };
}

/** The `attach` an element was made with, read when its parent adds it. */
const ATTACH = new WeakMap<object, string>();

type Props = Record<string, unknown> & { children?: unknown };

const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null && port().isNode(value);

/** The automatic JSX runtime's entry: build the element now and return it. */
export function jsx(type: unknown, props: Props | null, _key?: unknown): unknown {
  const all = props ?? {};
  if (type === Fragment) return flatten(all.children);
  if (isBehaviourClass(type)) return marker(type, all);
  if (typeof type !== 'function') throw new TypeError(`<${String(type)}> is not a class: a tag is a class you import — <Mesh>, not <mesh>.`);

  if (!isClass(type) && !prefabs.has(type)) {
    // A plain function returning TSX: a component, as anywhere TSX is written. Its tag is its props.
    const made = (type as (p: Props) => unknown)(all);
    remember(made, type, all);
    return made;
  }

  if (!isClass(type)) {
    // A prefab: one whole thing, whose tag places and names its root as a Unity instance's
    // Transform and name do. The rest of the tag is the function's props.
    const own: Props = {};
    const instance: [string, unknown][] = [];
    let link: unknown;
    let children: unknown;
    for (const [key, value] of Object.entries(all)) {
      if (instanceKeys().includes(key)) instance.push([key, value]);
      else if (key === 'ref') link = value;
      else if (key === 'children') children = value;
      else own[key] = value;
    }
    const name = type.name || 'prefab';
    const made = (type as (p: Props) => unknown)(own);
    if (Array.isArray(made)) {
      throw new Error(`<${name}> returns ${made.length} elements: a prefab is one whole thing — wrap them in one <Group>.`);
    }
    if (instance.length && !isNode(made)) {
      throw new Error(`<${name} ${instance[0]![0]}>: ${name} returns no node to place — only a prefab whose root is ${port().nodeKind} takes ${instanceKeys().join(', ')}.`);
    }
    if (link !== undefined && !isNode(made)) {
      throw new Error(`<${name} ref>: ${name} returns no node to link — only a prefab whose root is ${port().nodeKind} takes ref.`);
    }
    for (const [key, value] of instance) applyProp(made as Record<string, unknown>, key, value, name);
    if (link && typeof link === 'object' && 'current' in link) (link as Ref<unknown>).current = made;
    // Children on the tag go under the root, as objects and components added to a Unity prefab instance:
    // this copy's, not the prefab's.
    const added = addTo(made, flatten(children), name);
    // What the tag was written with, as the editor shows it: the link and the children are the scene's, not settings.
    remember(made, type, Object.fromEntries(Object.entries(all).filter(([k]) => k !== 'ref' && k !== 'children')), added);
    return made;
  }

  const { args, attach, ref: link, children, key: _k, ...rest } = all;
  const Type = type as new (...a: unknown[]) => Record<string, unknown>;
  // `args` are the constructor's, in order; without them the renderer may build it from its props.
  const made = args !== undefined ? new Type(...(args as unknown[])) : port().construct?.(Type as never, rest);
  const instance = (made ?? new Type()) as Record<string, unknown>;
  for (const [key, value] of Object.entries(rest)) applyProp(instance, key, value, type.name);
  for (const child of flatten(children)) addChild(instance, child, type.name);
  if (typeof attach === 'string') ATTACH.set(instance, attach);
  if (link && typeof link === 'object' && 'current' in link) (link as Ref<unknown>).current = instance;
  return instance;
}

/** Development's entry: the same as `jsx`, and it records where each element was written, and with what. */
export function jsxDEV(type: unknown, props: Props | null, key?: unknown, _static?: boolean, source?: Source): unknown {
  const made = jsx(type, props, key);
  record(made, props, source, typeof type === 'function' && !isClass(type));
  return made;
}

/** @internal `key` on `target`, R3F's way: a dashed name walks in, then the value is taken as every attribute is (`assignValue`). */
export function applyProp(target: Record<string, unknown>, key: string, value: unknown, tag: string): void {
  let owner = target;
  let name = key;
  if (key.includes('-') && !(key in target)) {
    const path = key.split('-');
    name = path.pop()!;
    for (const step of path) {
      const next = owner[step];
      if (!next || typeof next !== 'object') throw new Error(`<${tag} ${key}>: ${tag} has no "${step}" to reach into.`);
      owner = next as Record<string, unknown>;
    }
  }
  assignValue(owner, name, value);
}

/** A prefab tag's children, added under its root: what they were, so the editor can add them again to a rebuilt copy. */
function addTo(root: unknown, children: unknown[], name: string): Added {
  if (!children.length) return { nodes: [], behaviours: [] };
  if (!isNode(root)) {
    throw new Error(`<${name}> has children, but ${name} returns no node to add them to — only a prefab whose root is ${port().nodeKind} takes children.`);
  }
  const added: Added = { nodes: [], behaviours: [] };
  for (const child of children) {
    if (isMarker(child)) {
      const live = addMarker(root as unknown as Record<string, unknown>, child);
      added.behaviours.push({ tag: child, type: child.type, init: child.init, link: child.link, live });
      continue;
    }
    if (isNode(child)) added.nodes.push(child);
    addChild(root as unknown as Record<string, unknown>, child, name);
  }
  return added;
}

/** A child is added if it is a node, attached if `attach` or its kind names a property — both, for a node with `attach` — made a component if it is a behaviour. */
function addChild(parent: Record<string, unknown>, child: unknown, tag: string): void {
  if (isMarker(child)) return void addMarker(parent, child);
  if (!child || typeof child !== 'object') {
    throw new Error(`<${tag}> got ${JSON.stringify(child)} as a child: a scene's children are elements.`);
  }
  const value = child as Record<string, unknown>;
  const attach = ATTACH.get(value);
  if (attach) applyAttach(parent, attach, value, tag);
  // A node is always in the scene, attached or not: `<Object3D attach="target" />` under a light is
  // its target and its child, so it moves with the light — three.js wants a light's target in the scene.
  if (isNode(value) && isNode(parent)) return void port().add(parent, value);
  if (attach) return;
  if (port().attachChild?.(parent, value)) return;
  throw new Error(
    `<${(value.constructor as Function).name}> inside <${tag}> needs attach="…" — the property of ${tag} it fills.`,
  );
}

function applyAttach(parent: Record<string, unknown>, path: string, child: unknown, tag: string): void {
  const steps = path.split('-');
  const last = steps.pop()!;
  let owner = parent;
  for (const step of steps) owner = owner[step] as Record<string, unknown>;
  if (!owner) throw new Error(`<${tag}>: attach="${path}" — ${tag} has no "${steps.join('-')}".`);
  owner[last] = child;
  if (child && typeof child === 'object') port().adopt?.(child, parent);
}

export const jsxs = jsx;

/** Functions `prefab()` made prefabs. */
const prefabs = new WeakSet<Function>();

/**
 * Unity's prefab: one whole thing, built by a function returning TSX with one root. Its tag places
 * and names that root as an instance's Transform and name — `<Coin position={[2, 0, 0]} name="bonus" />`
 * — and it is what `instantiate` and a `Prefab` field take. The tag's children are that copy's own,
 * added under its root as objects and components are added to a Unity prefab instance. A function not
 * made one is a plain TSX component: its tag's attributes are its props, and nothing else.
 */
// `Function`, not a call signature: a signature would type the props from it, and `({ width = 1 })` then
// takes `never`; with none, TypeScript reads the props from the defaults written.
export function prefab(model: ModelAsset): Prefab;
export function prefab<F extends Function>(build: F): F & { readonly [K in PrefabMarkKey]: true };
export function prefab(build: Function | ModelAsset): Function {
  if (build instanceof Asset) return modelPrefab(build);
  prefabs.add(build);
  return build;
}

/**
 * A model's prefab, as Unity makes one of every model file: `export const Goblin = prefab(models.goblin)`,
 * placed as `<Goblin scale={0.4} />`. Each copy is the model's own root. `loadAssets(Goblin)` loads the model.
 */
function modelPrefab(model: ModelAsset): Prefab {
  const file = model.url.replace(/[?#].*$/, '').replace(/^.*\//, '');
  const build = () => {
    if (!model.isLoaded) {
      throw new Error(`<${file}>: its model is not loaded yet — play loads every declared model before its first scene; under simulate, or built before play, await loadAssets(…) with it first.`);
    }
    return model.instantiate();
  };
  Object.defineProperty(build, 'name', { value: file });
  prefabs.add(build);
  loadsAs(build, model);
  return build as unknown as Prefab;
}

/** Whether `prefab()` made this function a prefab. */
export function isPrefab(value: unknown): boolean {
  return typeof value === 'function' && prefabs.has(value);
}

// --- an element's properties and children -----------------------------------------------------

/** @internal A class rather than a plain function: only a class's source starts with `class`. */
export function isClass(fn: Function): boolean {
  return /^class[\s{]/.test(Function.prototype.toString.call(fn));
}

function flatten(children: unknown): unknown[] {
  if (children === undefined || children === null || children === false || children === true) return [];
  return Array.isArray(children) ? children.flatMap(flatten) : [children];
}

/** A behaviour's tag, made a component of its parent: dormant until the whole tree is built. */
export function addMarker(parent: Record<string, unknown>, child: BehaviourMarker | Added['behaviours'][number]): AnyBehaviour {
  const tag = 'tag' in child ? child.tag : child;
  const behaviour = addDormant(parent as never, child.type as ConstructableBehaviour, child.init);
  if (child.link) child.link.current = behaviour;
  // Where it was written and what it said, for the editor: `jsxDEV` records them, `jsx` does not.
  if (import.meta.env?.DEV) handOver(tag, behaviour, child.init);
  return behaviour as AnyBehaviour;
}

// --- types: a class is an element, its fields are attributes ------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBehaviour = Behaviour<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClass = abstract new (...args: any[]) => any;

/** A property's value, or its shorthand (`Shorthand`) — R3F's. */
export type Settable<V> = V | Shorthand<V>;

/**
 * Every data property of an instance, optional: its own value, its shorthand, or what the class's
 * options object `O` takes for it — a setter often takes more than its getter returns (pixi's
 * `style={{ fontSize: 24 }}`, `anchor={0.5}`), and the options say what. An option with no property
 * of its name is the constructor's alone (`ConstructorOnly`).
 */
export type PropsOf<I, O = {}> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof I as K extends string ? (I[K] extends (...args: any[]) => any ? never : K) : never]?:
    | Settable<I[K]>
    | OptionFor<O, K>;
};

/** What each options object of a union takes for `K` — overloads may each take their own. */
type OptionFor<O, K> = O extends unknown ? (K extends keyof O ? O[K] : never) : never;

/**
 * Every overload's parameters — `ConstructorParameters` sees only the last one, and three.js
 * overloads constructors: `new Color('#f80')` and `new Color(1, 0.5, 0)`.
 */
type CtorArgs<C> = C extends {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new (...a: infer A1): any; new (...a: infer A2): any; new (...a: infer A3): any; new (...a: infer A4): any;
}
  ? A1 | A2 | A3 | A4
  : C extends abstract new (...a: infer A) => unknown
    ? A
    : never;

/** A constructor's first argument, from every overload. */
type FirstArg<A> = A extends [] ? never : A extends [(infer F)?, ...unknown[]] ? NonNullable<F> : never;
/** The keys of `T` that are methods it must have — what a class instance has, and an options object does not. */
type RequiredMethods<T> = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [K in keyof T]-?: {} extends Pick<T, K> ? never : T[K] extends (...args: any[]) => any ? K : never;
}[keyof T];
/**
 * An options object: named fields, some required (pixi's `NineSliceSpriteOptions` needs its `texture`),
 * and no methods it must have — `SpriteOptions`, `MeshStandardMaterialParameters` — not a texture, a
 * geometry, an array or a string that an overload takes in its place.
 */
type Bag<T> = T extends object ? ([RequiredMethods<T>] extends [never] ? (string extends keyof T ? never : T) : never) : never;
/** The options object a class's constructor takes, if it takes one. */
export type OptionsOf<C> = Bag<FirstArg<CtorArgs<C>>>;

/** What every prefab's tag takes for its root, as a Unity instance has its own Transform and name. */
export function instanceKeys(): string[] {
  return ['position', 'rotation', 'scale', port().nameKey];
}
type InstanceKey = 'position' | 'rotation' | 'scale' | NameKeyOf;

/**
 * A prefab's tag: the function's props, and its root's transform and name. A prefab that declares
 * one of those itself is told where it belongs, at every tag that uses it.
 */
export type PrefabProps<P> = ('children' extends keyof P
  ? { children: "a prefab tag's children are added under its root, as objects added to a Unity prefab instance: take children out of the prefab's props" }
  : PrefabChildren) &
  ([Extract<keyof P, InstanceKey>] extends [never]
    ? P & Pick<PropsOf<Node>, Extract<InstanceKey, keyof PropsOf<Node>>> & PrefabRef
    : Omit<P, InstanceKey> & PrefabRef & {
        [K in Extract<keyof P, InstanceKey>]: `${K} belongs to the tag, as a Unity instance's Transform and name do: take it out of the prefab's props, and <Prefab ${K}={…} /> sets its root's.`;
      });

/** A prefab tag's children: nodes added under its root, behaviours added to it — this copy's, as in a Unity scene. */
type PrefabChildren = { children?: unknown };

/** A prefab tag's `ref` is its root, as a scene field in Unity takes the instance dragged into it. */
type PrefabRef = { ref?: Ref<Node> };

/**
 * A plain function's tag: its props, as anywhere TSX is written. Placing or naming it as an instance
 * is a prefab's, and is told so — unless the function takes that prop itself.
 */
export type PlainProps<P> = P & {
  [K in Exclude<InstanceKey, keyof P>]?: `${K} is a prefab tag's: this function is a plain component, whose attributes are its props — make it a prefab where it is declared, prefab(() => …), or give it a ${K} prop.`;
};

/** Names the element itself uses, never one of the instance's properties — `children` is three's own field too. */
type Reserved = 'children' | 'args' | 'attach' | 'ref' | 'key';

/**
 * Options the constructor alone takes, with no property of the same name: attributes too where the
 * renderer builds an element from its props (`Renderer['elementOptions']`, pixi's way), and otherwise
 * not — three.js's constructors take arguments in order, so such a value goes in `args`.
 */
type ConstructorOnly<C extends AnyClass> = Renderer extends { elementOptions: true }
  ? [OptionsOf<C>] extends [never]
    ? unknown
    : { [K in Exclude<keyof OptionsOf<C>, keyof InstanceType<C> | Reserved>]?: OptionFor<OptionsOf<C>, K> }
  : unknown;

/**
 * A handler on a tag — React's `onClick`, pixi-react's `onPointerDown` — is refused with the way that
 * works: a scene only declares, and what reacts to the player is a behaviour on the node.
 */
type Handlers = {
  [K in `on${Capitalize<string>}`]?: "a scene only declares: what reacts to the player is a behaviour on this node — read Input in its update(), as Unity's scripts do";
};

export type ClassProps<C extends AnyClass> = Omit<PropsOf<InstanceType<C>, OptionsOf<C>>, Reserved> & ConstructorOnly<C> & Handlers & {
  /** The constructor's arguments: `<BoxGeometry args={[1, 2, 3]} />` is `new BoxGeometry(1, 2, 3)`. */
  args?: CtorArgs<C>;
  /** The parent's property this fills — `attach="fog"`, `attach="material-0"`. Geometry and material need none. */
  attach?: string;
  ref?: Ref<InstanceType<C>>;
  children?: unknown;
  key?: string | number;
};

export declare namespace SceneJSX {
  type ElementType = AnyClass | ((props: never) => unknown);
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Element {}
  /** Open, so any class is an element. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ElementClass {}
  /** Empty, so a class's attributes come from `LibraryManagedAttributes`, not from a `props` field. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ElementAttributesProperty {}
  interface ElementChildrenAttribute {
    children: unknown;
  }
  type LibraryManagedAttributes<C, P> = C extends abstract new (...args: never) => infer I
    ? I extends AnyBehaviour
      ? BehaviourInit<I> & { key?: string | number; ref?: Ref<I> }
      : C extends AnyClass
        ? ClassProps<C>
        : P
    : C extends { readonly [K in PrefabMarkKey]: true }
      ? PrefabProps<P>
      : PlainProps<P>;
  interface IntrinsicAttributes {
    key?: string | number;
  }
  /** None: a tag is a class you import. `<mesh>` is an error; write `<Mesh>`. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntrinsicElements {}
}

export type { RefLike };
