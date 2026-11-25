import { Behaviour } from './kernel/Behaviour.js';
import { Event } from './kernel/Event.js';
import { destroy, flushDestroyed, wake } from './kernel/lifecycle.js';
import { runtimeOf } from './kernel/registry.js';
import { nodeName, type Node } from './kernel/renderer.js';
import { parentOf } from './kernel/nodes.js';
import { loadDeclared } from './assets/Asset.js';
import { port, type SceneOf } from './port.js';

/**
 * Scenes are functions returning `<Scene>…</Scene>`, and `SceneManager` swaps them, as Unity's does.
 *
 * There is one root scene for the whole game — the one `play` made, which is what draws and what the
 * runtime runs. A loaded scene is built and added under it; loading another destroys the last one,
 * except what was marked `dontDestroyOnLoad`, which waits directly under the root.
 */

let world: SceneOf | null = null;
let onLoaded: () => void = () => {};
/** The loaded scenes, oldest first. */
const loaded: SceneOf[] = [];
/** Loads asked for while another is under way, or until the frame ends. */
const pending: { build: () => unknown; additive: boolean }[] = [];
let loading = false;
/** What built each loaded scene, so the active one can be loaded again. */
const builders = new WeakMap<SceneOf, () => unknown>();
/** @internal a development tool's word on a scene built and not yet woken: written over what its file wrote. */
let beforeWake: (scene: SceneOf) => void = () => {};

/** @internal `play` hands over the scene it draws, and is told after every load. */
export function attachWorld(scene: SceneOf, changed: () => void): void {
  world = scene;
  onLoaded = changed;
  loaded.length = 0;
  pending.length = 0;
}

/** @internal the game `play` made is gone: loads have nowhere to go until the next one. */
export function detachWorld(scene: SceneOf): void {
  if (world !== scene) return;
  world = null;
  onLoaded = () => {};
  loaded.length = 0;
  pending.length = 0;
}

/**
 * @internal build a scene into the world, replacing what was loaded unless `additive`. It is built
 * first, so a scene that throws leaves the last one running; then the last one is destroyed, and only
 * then does the new one wake.
 */
export function loadInto(root: SceneOf, build: () => unknown, additive: boolean): SceneOf {
  const renderer = port();
  const outer = loading;
  loading = true;
  let scene: SceneOf;
  try {
    const built = build();
    if (!built || typeof built !== 'object' || !renderer.isNode(built)) {
      throw new Error(`${build.name || 'A scene'} must return an element — <Scene>…</Scene>.`);
    }
    if (renderer.isScene(built)) scene = built as SceneOf;
    else {
      scene = renderer.createScene();
      renderer.add(scene, built);
    }
    if (!additive) {
      for (const old of loaded.splice(0)) destroy(old);
      flushDestroyed();
      renderer.adoptSettings?.(scene, root);
    }
    loaded.push(scene);
    builders.set(scene, build);
    renderer.add(root, scene);
    onLoaded();
    beforeWake(scene);
    wake(scene);
    SceneManager.sceneLoaded.emit(scene);
  } finally {
    loading = outer;
  }
  if (!outer) drain(root);
  return scene;
}

function drain(root: SceneOf): void {
  const next = pending.shift();
  if (next) loadInto(root, next.build, next.additive);
}

/** A load from a frame waits for the frame to end, so what is running finishes it; from outside one it happens now. */
function request(build: () => unknown, additive: boolean): void {
  const root = running();
  pending.push({ build, additive });
  if (loading) return;
  const runtime = runtimeOf(root);
  if (!runtime?.updating) return drain(root);
  runtime.afterFrame = () => {
    try {
      drain(root);
    } catch (error) {
      pending.length = 0;
      console.error(error);
    }
  };
}

function running(): SceneOf {
  if (!world) throw new Error('No game is running: start one with play(MainScene) first.');
  return world;
}

/** Unity's `SceneManager`, for scenes that are functions returning `<Scene>…</Scene>`. */
export const SceneManager = {
  /**
   * Unity's `LoadScene`: from a frame, at the end of it. The scene that was loaded is destroyed, with
   * everything in it but what `dontDestroyOnLoad` kept, then `scene` wakes. Its render settings —
   * three.js's `background`, `environment` and `fog` — replace the last scene's, unset ones included.
   */
  load(scene: () => unknown): void {
    request(scene, false);
  },
  /**
   * Unity's `LoadSceneAsync`: fetch a scene's module, load the models and clips it declares, then
   * `load` it — `await SceneManager.loadAsync(() => import('./Level3').then((m) => m.Level3))`. A
   * module imported only this way is its own chunk, and its assets wait until it is asked for.
   */
  async loadAsync(scene: () => Promise<() => unknown>): Promise<void> {
    const build = await scene();
    await loadDeclared();
    request(build, false);
  },
  /** Unity's `LoadScene` with `LoadSceneMode.Additive`: `scene` beside what is loaded, at the same moment. */
  loadAdditive(scene: () => unknown): void {
    request(scene, true);
  },
  /** Unity's `sceneLoaded`: after a scene's `awake` and `onEnable`, before its `start`. */
  // Spelled out, so the declaration file keeps the renderer's scene type rather than the kernel's fallback.
  sceneLoaded: new Event<[scene: SceneOf]>() as Event<[scene: SceneOf]>,
  /** The scene loaded last. */
  get activeScene(): SceneOf | null {
    return loaded.at(-1) ?? null;
  },
  /** @internal newest first: where `play` looks for the camera to draw with. */
  get loadedScenes(): readonly SceneOf[] {
    return [...loaded].reverse();
  },
};

/**
 * Unity's `DontDestroyOnLoad`: this node — or a behaviour's node — and everything under it outlive
 * every later `SceneManager.load`. As in Unity, it is the topmost node that is kept: marking a child
 * keeps the whole tree it is part of. Call it from `awake`.
 */
export function dontDestroyOnLoad(target: Node | Behaviour): void {
  const root = running();
  let node: Node = target instanceof Behaviour ? target.node : target;
  // Up to the loaded scene it is in — or to the root, for a node already kept.
  const asked = node;
  for (let up = parentOf(node); up && up !== root && !loaded.includes(up as SceneOf); up = parentOf(node)) node = up;
  if (node !== asked) {
    const [whole, one] = [nodeName(node), nodeName(asked)];
    console.warn(`dontDestroyOnLoad: ${one} is under ${whole}, so all of ${whole} is kept. To keep only the one, move it to the scene's root first.`);
  }
  const i = loaded.indexOf(node as SceneOf);
  if (i !== -1) loaded.splice(i, 1); // a whole loaded scene: it stays where it is, and is no longer unloaded
  else if (parentOf(node) !== root) port().reparent(root, node);
}

/** @internal what runs on each scene built, before it wakes; returns the way to stop it. */
export function onBeforeWake(fn: (scene: SceneOf) => void): () => void {
  beforeWake = fn;
  return () => {
    if (beforeWake === fn) beforeWake = () => {};
  };
}

/** @internal Unity's `LoadScene` of the active scene: built again from its function. False with none. */
export function reloadActive(): boolean {
  const build = loaded.at(-1) && builders.get(loaded.at(-1)!);
  if (!build) return false;
  request(build, false);
  return true;
}
