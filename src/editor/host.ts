import { Behaviour } from '../kernel/Behaviour.js';
import { assignInit } from '../kernel/init.js';
import { behavioursOn } from '../kernel/registry.js';
import { destroy, flushDestroyed, wake } from '../kernel/lifecycle.js';
import { childrenOf, parentOf, traverse } from '../kernel/nodes.js';
import type { Node } from '../kernel/renderer.js';
import { addMarker, applyProp, instanceKeys, isPrefab, jsxDEV } from '../jsx.js';
import { givenOf, keepGiven, ownOf, prefabOf, remember, setGiven, sourceOf } from '../provenance.js';
import { isHeld, setHeld, setView } from '../host.js';
import type { Game } from '../play.js';
import { port, type EditorViewport, type Transform } from '../port.js';
import type { EditHost } from './EditHost.js';
import { openedScene, write, writeOpened } from './session.js';
import { applyArguments, settableArgument } from './arguments.js';

/**
 * The editor over the running game: what its interface — `@scenoco-three/editor`, served by the
 * project's `scenoco()` Vite plugin — works the game through. Paused, the renderer's viewport looks
 * through its own camera with a gizmo; every edit is made here, the same on every renderer.
 */

const EDITOR = '/__scenoco/editor.js';

const spawnedNodes = new WeakSet<Node>();
const spawnedFrom = new WeakMap<Node, Function>();

/** @internal `instantiate` marks what it made, and from which prefab, so the editor knows no scene file wrote it. */
export function markSpawned(node: Node, prefab?: Function): void {
  spawnedNodes.add(node);
  if (prefab) spawnedFrom.set(node, prefab);
}

/**
 * @internal A behaviour's field set from the editor, then its `onValidate` — Unity's, so what it
 * built from the field in `start` follows. Its errors are the game's: reported, not let loose.
 */
export function setField(behaviour: Behaviour, name: string, value: unknown): void {
  assignInit(behaviour, { [name]: value });
  validate(behaviour);
}

function validate(behaviour: Behaviour): void {
  try {
    behaviour.onValidate?.();
  } catch (error) {
    console.error(`${behaviour.constructor.name}.onValidate threw:`, error);
  }
}

/**
 * The behaviours a moved node concerns: its own, and every one a scene gave it to, or a node above it
 * — `knots={points}` follows a point moved under `points`. Only what the scene wrote counts, so what
 * a behaviour keeps for itself (the copies it placed) never makes it build again under the gizmo.
 */
function concerned(scene: Node, node: Node): Set<Behaviour> {
  const renderer = port();
  const found = new Set(behavioursOn(node));
  const holds = (value: unknown) => {
    if (!value || typeof value !== 'object' || !renderer.isNode(value)) return false;
    for (let n: Node | null = node; n; n = parentOf(n)) if (n === value) return true;
    return false;
  };
  traverse(scene, (n) => {
    for (const b of behavioursOn(n)) {
      const given = givenOf(b);
      if (given && Object.keys(given).some((key) => holds((b as unknown as Record<string, unknown>)[key]))) found.add(b);
    }
  });
  return found;
}

export interface Editor {
  /** The clock was held from outside: look through the editor's camera. */
  held(): void;
  /** After the game drew: the viewport's own things over it. */
  draw: EditorViewport['draw'];
}

/** @internal open the editor over `game`: its viewport from the renderer, its interface from the dev server. */
export async function startEditor(game: Game, frame: (dt: number) => void, closed: () => void): Promise<Editor> {
  const editorPort = port().editor;
  if (!editorPort) throw new Error('This renderer has no editor.');
  const { scene, runtime } = game;
  const listeners = { select: [] as ((n: Node | null) => void)[], moved: [] as ((n: Node, before: Transform) => void)[] };
  let selected: Node | null = null;
  /**
   * What an edit set going, finished now rather than on a frame that may not come while the clock is
   * held: what `onValidate` placed starts, and what it destroyed goes.
   */
  const settle = () => {
    runtime.startPending();
    flushDestroyed();
  };

  const [viewport, ui] = await Promise.all([
    editorPort.openViewport(game, {
      // A tap picks the nearest object an element wrote: up from what was hit to one with a source.
      picked(node) {
        while (node && !sourceOf(node)) node = parentOf(node);
        host.select(node);
      },
      // Every step of a drag, so what depends on the node follows it under the gizmo.
      dragged(node) {
        for (const b of concerned(scene, node)) validate(b);
        settle();
      },
      dropped(node, before) {
        for (const listener of listeners.moved) listener(node, before);
      },
    }),
    import(/* @vite-ignore */ EDITOR).catch(() => {
      throw new Error(`No editor at ${EDITOR}: the project's vite.config needs scenoco() from @scenoco-three/tools/vite, and @scenoco-three/editor installed.`);
    }) as Promise<{ mount(host: EditHost): () => void }>,
  ]);

  const lookThrough = (paused: boolean) => viewport.lookThrough(paused);

  const replaced = new WeakMap<object, object>();

  /**
   * A prefab or component called again with one prop changed, its node swapped in where the old one stood.
   * What its tag added — children, behaviours — is the scene's: carried over to the new copy.
   */
  const rebuild = (node: Node, props: Record<string, unknown>) => {
    const renderer = port();
    const made = prefabOf(node)!;
    const fresh = jsxDEV(made.prefab, props, undefined, false, sourceOf(node));
    if (!fresh || typeof fresh !== 'object' || !renderer.isNode(fresh)) return;
    const added = made.added;
    for (const child of added.nodes) renderer.add(fresh, child as Node);
    for (const b of added.behaviours) b.live = addMarker(fresh as never, b);
    remember(fresh, made.prefab, props, added);
    const parent = parentOf(node)!;
    renderer.add(parent, fresh);
    // In the old one's place among its siblings, as the file has it.
    const siblings = childrenOf(parent) as Node[];
    siblings.splice(siblings.indexOf(fresh), 1);
    siblings.splice(siblings.indexOf(node), 0, fresh);
    keepGiven(node, fresh);
    replaced.set(node, fresh);
    destroy(node);
    flushDestroyed();
    wake(fresh);
    if (selected === node) host.select(fresh);
  };

  const host: EditHost = {
    scene,
    get selected() {
      return selected;
    },
    select(node) {
      selected = node;
      viewport.select(node);
      for (const listener of listeners.select) listener(node);
    },
    get paused() {
      return isHeld(runtime);
    },
    pause() {
      setHeld(runtime, true);
      lookThrough(true);
    },
    play() {
      setHeld(runtime, false);
      lookThrough(false);
    },
    step() {
      host.pause();
      frame(1 / 60);
    },
    reset(reach = 'frame') {
      write(reach);
      location.reload();
    },
    openScene(opened, reach) {
      writeOpened(opened);
      host.reset(reach);
    },
    get openedScene() {
      return openedScene();
    },
    setMode: (mode) => viewport.setMode(mode),
    on: ((event: 'select' | 'moved', listener: never) => void listeners[event].push(listener)) as EditHost['on'],
    sourceOf,
    givenOf,
    madeBy(node) {
      const made = prefabOf(node);
      if (made) return { name: made.prefab.name, prefab: isPrefab(made.prefab), props: made.props, fn: made.prefab,
        added: { nodes: made.added.nodes as Node[], behaviours: made.added.behaviours.map((b) => b.live as Behaviour) } };
      const from = spawnedFrom.get(node);
      return from && { name: from.name, prefab: true, props: {}, fn: from, added: { nodes: [], behaviours: [] } };
    },
    own(node) {
      // A spawned copy has no tag: its root's own element is the one `sourceOf` already answers for.
      return ownOf(node) ?? (spawnedFrom.has(node) ? { source: sourceOf(node), given: givenOf(node) } : undefined);
    },
    isolate: (node) => viewport.isolate(node),
    spawned(node) {
      for (let n: Node | null = node; n; n = parentOf(n)) if (spawnedNodes.has(n)) return true;
      return false;
    },
    behavioursOn: (node) => behavioursOn(node),
    parameters(made) {
      const args = givenOf(made)?.args;
      if (!Array.isArray(args)) return [];
      return args.map((_, i) => ({ settable: settableArgument(made, args, i) }));
    },
    current(target) {
      while (replaced.has(target)) target = replaced.get(target)!;
      return target;
    },
    written(target, name, value) {
      setGiven(host.current(target), name, value);
    },
    apply(target, name, value, declared = false) {
      const renderer = port();
      target = host.current(target);
      const node = renderer.isNode(target) ? target : null;
      if (name === 'args' && !(target instanceof Behaviour)) {
        applyArguments(target as Record<string, unknown>, value as unknown[]);
        if (node) for (const b of concerned(scene, node)) validate(b);
        settle();
        return;
      }
      const made = node ? prefabOf(node) : undefined;
      // A prefab's tag places and names its root; every other attribute of a function's tag is a prop.
      const prop = made && !(isPrefab(made.prefab) && instanceKeys().includes(name));
      // A prop the element passed, or one the function declares, and not on a tag with children: they were built already.
      if (node && made && prop && (declared || name in made.props) && made.props.children === undefined) rebuild(node, { ...made.props, [name]: value });
      else if (target instanceof Behaviour) setField(target, name, value);
      else {
        applyProp(target as Record<string, unknown>, name, value, target.constructor.name);
        // The tag's transform and name, kept for when one of its props calls the prefab again.
        if (made && !prop) made.props = { ...made.props, [name]: value };
        renderer.refresh?.(target);
        if (node) for (const b of concerned(scene, node)) validate(b);
      }
      settle();
    },
    frame(node) {
      if (!host.paused) host.pause();
      viewport.frame(node);
    },
    close() {
      host.isolate(null);
      host.select(null);
      host.play();
      unmount();
      viewport.dispose();
      setView(runtime, null);
      closed();
    },
  };

  const unmount = ui.mount(host);
  lookThrough(host.paused);
  return { held: () => lookThrough(true), draw: (camera) => viewport.draw(camera) };
}
