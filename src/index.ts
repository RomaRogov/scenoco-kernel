/**
 * `@scenoco/kernel` — SceNoCo with no renderer: Unity's behaviours and their lifecycle, the frame
 * (`play`, `simulate`), scenes and prefabs written in TSX, `SceneManager`, `instantiate`, tweens,
 * `Input`, `Random`, `QualitySettings`, `UIDocument` and the development bridge. A renderer's package
 * — `@scenoco-three/core` for three.js — implements `RendererPort`, binds it, and re-exports this;
 * a game imports that package, not this one. How to write one: the README.
 */
export * from './kernel/index.js';
export type { Renderer, BaseNode, Node, RenderCamera } from './kernel/renderer.js';

export {
  bindRenderer,
  type RendererPort,
  type EditorPort,
  type EditorViewport,
  type ViewportEvents,
  type Transform,
  type View,
  type QualityAsk,
  type Vec3,
  type Quat,
  type Vector2Of,
  type Vector3Of,
  type QuaternionOf,
  type ColorOf,
  type SceneOf,
  type ViewOf,
  type ViewOptionsOf,
} from './port.js';

export { play, instantiate, gameOf, type Game, type PlayOptions, type InstantiateOptions } from './play.js';
export { simulate, type Simulation, type SimulateOptions, type ScreenPoint } from './simulate.js';
export { SceneManager, dontDestroyOnLoad } from './scenes.js';

export { Tween, Sequence, LoopType, type Tweenable } from './tween/Tween.js';
export { Ease, type EaseFunction } from './tween/Ease.js';
export { RotateMode, installNodeTweens, tweenProperty } from './tween/nodeTweens.js';
export { installNodeMethods } from './nodeMethods.js';

export { Mathf } from './Mathf.js';
export { Random, type RandomState } from './Random.js';
export { PlayerPrefs } from './PlayerPrefs.js';
export { Screen } from './Screen.js';
export { QualitySettings, ShadowQuality, type QualityLevel } from './QualitySettings.js';
export { UIDocument } from './UIDocument.js';
export { Input, InputClass, type Point, type ButtonName } from './input/Input.js';
export { KeyCode, MouseButton } from './input/KeyCode.js';
export { AXES, AXIS_NAMES, type AxisName } from './input/axes.js';

export { Asset, loadAssets, type Loadable } from './assets/Asset.js';

export {
  jsx,
  jsxs,
  jsxDEV,
  prefab,
  isPrefab,
  ref,
  Fragment,
  type Ref,
  type ModelAsset,
  type SceneJSX,
} from './jsx.js';
export { sourceOf, type Source } from './provenance.js';
export type { EditHost, OpenedScene } from './editor/EditHost.js';
