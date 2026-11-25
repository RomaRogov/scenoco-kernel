/**
 * `@scenoco/kernel/internal` — what a renderer's package and its editor reach the kernel with, and
 * games never touch: the end-of-frame flush, the registry, the held clock, the screen size, the asset
 * queue, where each element was written. The same modules as the public entry, so every class is the
 * one class.
 */
export * from './index.js';
export * from './kernel/lifecycle.js';
export * from './kernel/registry.js';
export * from './kernel/attach.js';
export * from './kernel/init.js';
export * from './kernel/types.js';
export * from './kernel/nodes.js';
export { nodeName } from './kernel/renderer.js';
export { port } from './port.js';
export { setScreenSize } from './Screen.js';
export * from './assets/Asset.js';
export * from './provenance.js';
export * from './host.js';
export { liveGames, gameStarted, sceneCamera } from './play.js';
export { loadInto, attachWorld, detachWorld, onBeforeWake, reloadActive } from './scenes.js';
export { installBridge, type ObservedState } from './bridge/index.js';
export { applyProp, isClass, isBehaviourClass, addMarker, instanceKeys, type PrefabProps, type PlainProps, type ClassProps, type PropsOf, type OptionsOf, type Settable } from './jsx.js';
export { setField } from './editor/index.js';
