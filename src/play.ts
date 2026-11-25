import { Runtime } from './kernel/runtime.js';
import { runtimeOf } from './kernel/registry.js';
import { destroy, flushDestroyed, wake } from './kernel/lifecycle.js';
import { Event } from './kernel/Event.js';
import { childrenOf, parentOf } from './kernel/nodes.js';
import { provideCamera } from './kernel/camera.js';
import type { Node, RenderCamera } from './kernel/renderer.js';
import type { Prefab } from './kernel/types.js';
import { Input } from './input/Input.js';
import { setScreenSize } from './Screen.js';
import { installBridge } from './bridge/index.js';
import { isHeld, viewOf } from './host.js';
import { SceneManager, attachWorld, detachWorld, loadInto } from './scenes.js';
import { loadDeclared } from './assets/Asset.js';
import { applyProp, isPrefab, type ModelAsset, type PropsOf } from './jsx.js';
import { Asset } from './assets/Asset.js';
import { port, type SceneOf, type View, type ViewOf, type ViewOptionsOf } from './port.js';
import { installEditor, markSpawned, startOpenedScene } from './editor/index.js';

/** What `play` takes. The renderer's own options — three.js's `renderer` — come with these. */
export type PlayOptions = ViewOptionsOf & {
  /**
   * Where the canvas goes. `document.body` when left out: the game is the page. Another element —
   * a `<div>` in a React app — has the game fill it and follow its size; the editor's bar, which
   * lays out the whole page, stays off.
   */
  container?: HTMLElement;
  /** Seconds per `fixedUpdate`. Unity's default, 0.02. */
  fixedDelta?: number;
  /**
   * Whether `play` picks the camera and fits it to the screen — on by default: the scene's first
   * visible camera draws, its aspect kept to the canvas. `false` leaves cameras to the game: set
   * `game.camera`, size it as the canvas changes, or draw your own way through `game.render`.
   */
  autoCamera?: boolean;
};

export interface Game {
  /** The scene everything is in. `SceneManager.load` swaps what is in it, not the object. */
  readonly scene: SceneOf;
  /**
   * The camera drawing the scene — what `this.camera` is. Picked by `play` unless `autoCamera` is
   * false: then it is what the game sets here, and null draws nothing until `game.render` says otherwise.
   */
  camera: RenderCamera | null;
  /** The renderer's own object — three.js's `WebGLRenderer` — set up as the renderer documents. */
  readonly renderer: ViewOf;
  /** @internal what draws: the renderer's view, as the kernel drives it. */
  readonly view: View;
  readonly runtime: Runtime;
  /**
   * Draws one frame. Replace it to draw another way — an `EffectComposer` for post effects:
   * `game.render = () => composer.render()`.
   */
  render: () => void;
  /**
   * Stop the game and free what `play` made: the loop, its listeners, the canvas, and every
   * behaviour — `onDestroy` runs, as when a scene unloads. For a game that comes and goes with the
   * page around it, such as a React component's effect cleanup. One game runs at a time.
   */
  dispose: () => void;
}

/**
 * Build a scene and run it: `play(Main)`, where `Main` is a function returning `<Scene>…</Scene>`.
 * The scene's first camera draws it; behaviours start on the first frame. Returns the renderer's own
 * objects, to configure as the renderer documents.
 */
export function play(build: () => unknown, options: PlayOptions = {} as PlayOptions): Game {
  const renderer = port();
  const scene = renderer.createScene();
  const runtime = new Runtime(scene, { fixedDelta: options.fixedDelta });

  const view = renderer.createView(options, scene);
  const host = options.container ?? document.body;
  /** The game is the page, rather than one element of it: only then is the editor's bar put on it. */
  const page = host === document.body;
  const autoCamera = options.autoCamera ?? true;
  host.appendChild(view.element);
  const editorPort = import.meta.env?.DEV ? renderer.editor : undefined;

  let camera: RenderCamera | null = null;
  /**
   * Frames drawn without a camera since the last load. Said once, a second in: a scene that loads the
   * next one on its first frame — a bootstrap — never needs one, but an empty screen needs a reason.
   */
  let framesWithoutCamera = 0;
  const fit = () => {
    const [width, height] = view.size();
    if (camera && autoCamera) renderer.fitCamera(camera, width, height);
  };
  // Every load may bring its own camera: the newest scene's first visible camera draws, then a kept
  // one's. Hidden or taken out of the scene, it hands over to the next — Unity's `camera.enabled`.
  const findCamera = () => {
    if (!autoCamera) return;
    const found = sceneCamera(scene);
    if (found !== camera) framesWithoutCamera = 0;
    camera = found;
    fit();
  };
  /** Whether the drawing camera is still in the world and seen: otherwise another takes over. */
  const drawable = (node: RenderCamera | null) => {
    for (let at = node as Node | null; at; at = parentOf(at)) {
      if (!renderer.isVisible(at)) return false;
      if (at === scene) return true;
    }
    return false;
  };
  const noCamera = 'The scene has no camera, so nothing is drawn. Put one in it, as in Unity: <PerspectiveCamera position={[0, 2, 6]} />';
  const resize = () => {
    // In development the editor's bar or panel may take part of the page: it sizes the view then.
    if (!(page && editorPort?.sizeView?.(view, host))) {
      view.setSize(page ? innerWidth : host.clientWidth, page ? innerHeight : host.clientHeight);
    }
    setScreenSize(...view.size());
    fit();
  };
  resize();
  addEventListener('resize', resize);
  // An element can change size with the page around it, not only with the window.
  const watch = page ? null : new ResizeObserver(resize);
  watch?.observe(host);

  provideCamera(runtime, () => camera);
  attachWorld(scene, findCamera);
  let disposed = false;
  const game: Game = {
    scene,
    get camera() {
      return camera;
    },
    set camera(value) {
      camera = value;
      fit();
    },
    renderer: view.renderer,
    view,
    runtime,
    render: () => {
      if (camera || renderer.drawsWithoutCamera) view.render(scene, camera);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      liveGames.delete(game);
      view.setLoop(null);
      removeEventListener('resize', resize);
      watch?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      closeBridge?.();
      Input.detach(view.element);
      // As an unload: everything in the scene is destroyed, its behaviours' onDestroy run.
      for (const child of [...childrenOf(scene)]) destroy(child);
      flushDestroyed();
      runtime.dispose();
      detachWorld(scene);
      view.element.remove();
      view.dispose();
    },
  };
  // Before the scene is built: its behaviours may ask for the game from their first awake.
  games.set(runtime, game);
  liveGames.add(game);
  gameStarted.emit(game);
  // Before the scene is built too: a reset in the editor holds behaviours from their very first wake.
  const editor = import.meta.env?.DEV && editorPort ? installEditor(game, (dt) => frame(dt)) : null;
  // In development the editor may have opened another scene: the page starts in it instead.
  const begin = (): Promise<unknown> | null => {
    const opened = import.meta.env?.DEV && editorPort ? startOpenedScene(scene, build) : null;
    if (!opened) loadInto(scene, build, false);
    return opened;
  };
  // Every model and clip the game declared is loaded before the first scene is built, as Unity loads a
  // scene's assets with it: no frame runs until then.
  const declared = loadDeclared();
  let starting: Promise<unknown> | null = declared ? declared.then(begin) : begin();
  if (starting) void starting.finally(() => (starting = null));
  Input.attach(view.element);

  /** One frame of the game: input first, then every behaviour, then input's one-frame edges roll over. */
  const frame = (dt: number) => {
    editor?.beforeFrame();
    Input.advance(Math.min(Math.max(dt, 0), runtime.maxDelta));
    runtime.update(dt);
    Input.endFrame();
  };
  const closeBridge = import.meta.env?.DEV
    ? installBridge(runtime, () => {
        const [width, height] = view.size();
        return { scene, camera, size: { width, height } };
      }, frame, () => draw())
    : null;

  // Seconds between display frames; none counted across a page that was out of sight.
  let last = -1;
  const onVisibility = () => void (last = -1);
  document.addEventListener('visibilitychange', onVisibility);
  view.setLoop((now) => {
    const dt = last < 0 ? 0 : (now - last) / 1000;
    last = now;
    if (starting) return;
    if (!(import.meta.env?.DEV && isHeld(runtime))) {
      frame(dt);
      editor?.afterFrame();
    }
    draw();
  });
  return game;

  /** Draw the frame: from the bridge's viewpoint when it holds one, else the game's camera. */
  function draw(): void {
    if (autoCamera && !drawable(camera)) findCamera();
    const seen = import.meta.env?.DEV ? viewOf(runtime) : null;
    if (seen) view.render(scene, seen);
    else if (camera || !autoCamera || renderer.drawsWithoutCamera) game.render();
    else if (++framesWithoutCamera === 60) console.error(noCamera);
    if (seen ?? camera) editor?.draw((seen ?? camera)!);
  }
}

const games = new WeakMap<Runtime, Game>();
/** @internal the games running now, and each as it starts: for what applies to every game, as `QualitySettings`. */
export const liveGames = new Set<Game>();
/** @internal */
export const gameStarted = new Event<[Game]>();

/** The game `play` made that this node is running in: its renderer, camera and `render`. Null under `simulate`. */
export function gameOf(node: Node): Game | null {
  const runtime = runtimeOf(node);
  return runtime ? (games.get(runtime) ?? null) : null;
}

/** @internal the camera that draws: the newest loaded scene's first visible one, then a kept one's. */
export function sceneCamera(scene: SceneOf): RenderCamera | null {
  const renderer = port();
  const look = (root: Node): RenderCamera | null => {
    if (!renderer.isVisible(root)) return null;
    if (renderer.isCamera(root)) return root as unknown as RenderCamera;
    for (const child of childrenOf(root)) {
      const found = look(child);
      if (found) return found;
    }
    return null;
  };
  for (const loaded of SceneManager.loadedScenes) {
    const found = look(loaded);
    if (found) return found;
  }
  return look(scene);
}

/** Where `instantiate` puts a copy, and how: `parent`, and the root's transform as its tag would set it. */
export type InstantiateOptions = { parent?: Node } & Pick<PropsOf<Node>, Extract<'position' | 'rotation' | 'quaternion', keyof PropsOf<Node>>>;

/**
 * Unity's `Instantiate` for a prefab — what `prefab()` made — or a loaded model. It builds a
 * fresh copy, places it, and wakes it: `awake` and `onEnable` run before this returns, `start` next
 * frame, so fields set on its behaviours right after this call are in by `start`. Nothing is
 * cloned from a live node: every call makes its own objects.
 */
export function instantiate<T extends Node = Node>(prefab: Prefab<T> | ModelAsset, options: InstantiateOptions = {}): T {
  const renderer = port();
  const model = prefab instanceof Asset ? prefab : null;
  const name = model ? `"${model.url}"` : (prefab as Function).name || 'prefab';
  if (!model && !isPrefab(prefab)) {
    throw new Error(`instantiate(${name}): ${name} is a plain function, not a prefab — make it one where it is declared: export const ${(prefab as Function).name || 'Coin'} = prefab(() => …).`);
  }
  // With no props, as a tag with no attributes: a prefab may take them, `({ size = 1 }) => …`.
  const made = model ? model.instantiate() : (prefab as (props: object) => unknown)({});
  if (!made || typeof made !== 'object' || !renderer.isNode(made)) throw new Error(`instantiate(${name}): a prefab returns one element, such as <Group>…</Group>.`);
  // The root's transform as its tag would set it: `[x, y, z]` or the renderer's own value.
  const { parent: given, ...placed } = options as { parent?: Node } & Record<string, unknown>;
  for (const [key, value] of Object.entries(placed)) if (value !== undefined) applyProp(made as unknown as Record<string, unknown>, key, value, name);
  // As in Unity, into the active scene: the next scene load destroys it too. Only with no scene
  // loaded — a bare runtime — does it go to the root.
  const root = Runtime.current?.root as Node | undefined;
  const active = SceneManager.activeScene;
  const parent = given ?? (active && parentOf(active) === root ? active : root);
  if (!parent) throw new Error(`instantiate(${name}) has nowhere to go: no parent, and no scene is running.`);
  renderer.add(parent, made);
  if (import.meta.env?.DEV && renderer.editor) markSpawned(made, model ? undefined : (prefab as Function));
  wake(made);
  return made as T;
}
