# @scenoco/kernel

SceNoCo with no renderer. A game never imports this package. It imports its renderer's package,
`@scenoco-three/core` for three.js, which binds the kernel to that renderer and re-exports it.
This README is for whoever writes a renderer package.

## What the kernel owns

The kernel holds everything SceNoCo does, the same on every renderer:

| Area | What |
| --- | --- |
| Behaviours | `Behaviour` and Unity's hooks, components on nodes, `getComponent` and its kin, `destroy`, events, messages, coroutines, `Time` |
| The frame | `play` (the loop, the camera that draws, resizing, disposal), `simulate` for tests, the held clock |
| Scenes | `SceneManager` (`load`, `loadAsync`, `loadAdditive`, `sceneLoaded`), `dontDestroyOnLoad`, `instantiate`, `gameOf` |
| TSX | the JSX runtime, `prefab`, `ref`, attributes R3F-style, typed from the class's properties and its constructor's options object |
| Motion | `Tween`, `Sequence`, `Ease`, `LoopType`; the node tweens (`doMove`, `doRotate`, `doPunchScale` and the rest) |
| Input and the rest | `Input`, `KeyCode`, the named axes, `Random`, `Mathf`, `Screen`, `PlayerPrefs`, `QualitySettings`, `UIDocument`, asset loading |
| Development | the bridge at `window.__scenoco`, and the editor's model side: selection as the TSX that made it, edits, prefabs rebuilt, reset |

## What the renderer owns

The renderer owns its scene graph, its drawing and its math. The kernel asks for these through one
interface, `RendererPort`, and never imports the renderer. The renderer also owns whatever is its
own kind of thing: model and texture loading, animation, freeing GPU resources, its
materials' tweens, and the Unity export, if it has one.

## Writing a renderer package

[`@scenoco-three/core`](https://github.com/RomaRogov/scenoco-three/tree/main/packages/core) is the full example: `src/renderer.ts`, `src/port.ts`, `src/jsx.ts`,
`src/augment.ts`, `src/tween/shortcuts.ts` and `src/index.ts`. The smallest complete port is in
[`tests/renderer-neutral.test.ts`](tests/renderer-neutral.test.ts): a renderer of plain objects running a scene through the
kernel. The port was also checked against pixi.js 8.23 and @pixi/3d 0.1.0. A prototype pixi port
typechecked against their declarations, and a scene in TSX ran through `simulate` with it: tweens,
attributes, colour fields, `instantiate` and `destroy`. Write a port in these seven steps.

### 1. Name your types

TypeScript learns the renderer's classes by declaration merging. Merge them into `Renderer` once, in
a module your entry imports:

```ts
declare module '@scenoco/kernel' {
  interface Renderer {
    node: Container3D;            // what `this.node` is, and `Behaviour<Mesh3D>` narrows
    camera: Camera3D;             // `this.camera`, `game.camera`
    scene: Scene3D;               // the root `play` makes, and what a `<Scene>` builds
    view: Application;            // `game.renderer`
    viewOptions: { app: Application };        // what `play(Main, options)` takes besides the kernel's own
    vector2: Vector2; vector3: Vector3; quaternion: Quaternion; color: Color; // the values the kernel makes
    colorInput: ColorSource;      // what a colour field or attribute takes besides a colour: '#ff8800'
    nameKey: 'label';             // where a node's given name is, and what a prefab's tag sets
    elementOptions: true;         // elements are built from their props (`construct`): options are attributes too
    values: Vector3 | Quaternion | Color; // what a tween moves besides a number
  }
}
```

Each key is optional. A key left out falls back to a plain shape, such as `{ x, y }` for `vector2`,
`BaseNode` for `node` or `'name'` for `nameKey`. The kernel never calls a method on a renderer
value. It asks the port to move one (`values`, step 2), so the renderer's own classes are used as they
are, with nothing to wrap.

### 2. Implement `RendererPort`

Each method is documented where it is declared, in `src/port.ts`. In groups:

| Group | Methods | three.js's answer |
| --- | --- | --- |
| Scene graph | `nodeKind`, `nameKey`, `isNode`, `add`, `reparent`, `isVisible`, `parentOf?`, `childrenOf?` | `'an Object3D'`, `'name'`, `instanceof Object3D`, `add`, `attach`, `visible`; left out, `parent` and `children` |
| TSX | `construct?`, `attachChild?`, `adopt?`, `freeBuilt?` | left out: `new Type(...args)`; a geometry or material child fills its slot; what a node's elements built is disposed with it |
| Scenes | `createScene`, `isScene`, `adoptSettings?` | `new Scene()`; a loaded scene's `background`, `fog` and `environment` move to the root |
| Cameras and drawing | `isCamera`, `drawsWithoutCamera?`, `fitCamera`, `project`, `createView`, `applyQuality?` | aspect or orthographic width to the screen; `WebGLRenderer` as the `View` |
| Transforms | `getPosition`, `setPosition`, `getRotation`, `setRotation`, `getScale`, `setScale`, `lookRotation` | numbers in and out: position and scale as `[x, y, z]`, rotation as a quaternion `[x, y, z, w]`, local or world. A tween calls these every frame: a getter writes into the array it is given and returns it, and a setter keeps nothing, so a running tween makes no garbage |
| Values made | `vector2`, `vector3`, `quaternion`, `color` | `new Vector2(x, y)` and so on; a colour from sRGB components |
| Values moved and written | `values.clone`, `values.mix`, `values.sum`, `values.assign`, `eulerOf?` | `lerpVectors`, `slerpQuaternions`, `lerpColors`; `add`, or `multiply` for a quaternion; `copy` into what a property holds unless it has a `uuid`; an `Euler` is radians in its order |
| Editor and bridge (development only) | `plain?`, `viewCamera?`, `bridgeScope?`, `refresh?`, `isDerived?`, `canRemake?`, `remake?`, `free?`, `editor?` | a vector as numbers and a colour as `#rrggbb`; a `PerspectiveCamera` for `view()`; `{ THREE }` in `eval`; `needsUpdate` and `updateProjectionMatrix`; a projection matrix; a geometry copied into itself; `dispose`; the editor's viewport |

A 2D renderer answers transforms in 3D terms: `z` 0, and a rotation about z as a quaternion.

**The kernel owns the shorthand; the port owns the rest.** An attribute or a behaviour's field
written as an array, a number or a string goes through the `set` (or `setScalar`) of the value the
property already holds, so `position={[0, 1, 0]}` and `scale={2}` work wherever the renderer's
vectors have a `set`. Everything else goes to `values.assign(owner, key, value)`. Copy into the value
the property holds, when it holds one of the same kind, so a node's `position` stays its own. Convert
what a colour is written as. Assign the rest: a shared geometry, a texture or a node goes by reference.
pixi's own setters already copy and convert. A plain field holding a `Color` or a `Vector3` is the
case `assign` handles itself.

**How an element is built is the renderer's convention.** With `args`, an element is always
`new Type(...args)`. Without them, the kernel builds `new Type()` and sets each prop, as R3F does,
unless the port has `construct(type, props)`. pixi's classes take one options object, and some need
it (`Mesh`, `NineSliceSprite`, `AnimatedSprite`). pixi-react builds them as `new Type(props)`, so a
pixi port does the same. Declare `elementOptions: true` in `Renderer`, so an option the constructor
alone takes type-checks as an attribute too. The kernel sets every prop afterwards all the same: array
shorthand lands through the property's own `set`. A child that is no node and names no `attach` goes
to `attachChild(parent, child)`. three.js fills a geometry's or material's slot; pixi pushes a filter
onto `filters`, as pixi-react does.

**Angles are degrees unless the port says otherwise.** `doRotate(new Vector3(0, 90, 0), 0.5)` turns 90
degrees, as DOTween does. `eulerOf` recognises the renderer's own Euler value, such as three.js's
`Euler`, and returns its radians and order. A renderer with no Euler class, like pixi (`rotation` is
a plain vector of radians), leaves `eulerOf` out.

`createView(options, scene)` gets the game's root along with the options, because some renderers
build their view around it (pixi's `View3D({ root })`). It returns a `View`. The view holds the
renderer's own object (`game.renderer`) and its element. Its other jobs are sizing,
`render(scene, camera)`, and `setLoop(frame)` for a function to call every display frame. **The
kernel owns the loop.** A renderer that draws on its own clock, like pixi's `Application` ticker,
keeps that clock stopped and draws in `render`. Render settings that live on the view rather than on
a scene node (pixi's `background`, `environment`, `fog`) are carried by your scene class.
`adoptSettings` moves them to the view when a scene loads.

### 3. Bind it before any scene is built

```ts
bindRenderer(port);
```

Call this at the top level of the module that defines the port. Both your package's entry and your
JSX runtime import that module first, so the port is bound before any TSX runs. Without a port, the
first scene throws an error saying so.

### 4. Make the JSX runtime entries

TypeScript and bundlers find the runtime by `jsxImportSource`, so your package exports
`./jsx-runtime` and `./jsx-dev-runtime`:

```ts
import './port.js';
export { jsx, jsxs, Fragment } from '@scenoco/kernel';   // jsx-dev-runtime: jsxDEV, Fragment
export type { SceneJSX as JSX } from '@scenoco/kernel';
```

A game's `tsconfig.json` and Vite config then say `"jsxImportSource": "<your package>"`.

### 5. Put Unity's methods on your node class

```ts
installNodeMethods(Container3D.prototype);   // addComponent, getComponent…, isDestroyed, scene
installNodeTweens(Container3D.prototype);    // doMove, doRotate, doScale, doPunch…, doShake…, doKill
```

Declare the same members on the class for TypeScript, with your own vector types. Core's
`augment.ts` and `tween/shortcuts.ts` show both declarations. Tweens on your other classes (a
material's fade, a light's intensity) are a line each with `tweenProperty(target, key, to, duration)`.

### 6. Re-export the kernel

Games import your package only, so re-export the kernel's public entry from yours, next to what
is your own (models, animation, textures). Never bundle a copy of the kernel. Depend on it at the
exact version, so a game has one `Behaviour` class and one registry.

### 7. Add your own kinds of thing

- **Models.** Subclass `Asset<T>`. To make `prefab(model)` and `instantiate(model)` work, give it a
  `url` and an `instantiate()` that returns a fresh root node (`ModelAsset`). `play` loads every
  declared asset before the first scene.
- **Animation, textures, physics, audio.** These are your package's behaviours and systems,
  written like any game code against the kernel's `Behaviour`, `System` and `service`.
- **The editor (optional).** Set `editor` on the port to an `EditorPort` whose `openViewport` returns
  an `EditorViewport`: the editor's own camera, a gizmo, picking, isolation and an overlay drawn after
  the game. It tells the kernel what the user did through `ViewportEvents`: `picked`, `dragged` and
  `dropped`. Everything the editor does to the game is the kernel's.

## 2D and 3D in one tree

A renderer with both 2D and 3D nodes, like pixi, keeps them in one scene tree, shaped the way
pixi-react already has it. The scene is the 2D stage. A 3D world is a node on it, `<View3D>`, holding
its 3D nodes as children. The 3D world's camera is a node inside it, as in Unity.

```tsx
<Scene>
  <Sprite texture={sky} />
  <View3D background="#88ccff">
    <Camera3D position={[0, 2, 8]} />
    <Mesh3D geometry={cube} material={wood}><Spinner /></Mesh3D>
  </View3D>
  <Text text="Score"><ScoreLabel /></Text>
</Scene>
```

Read the Unity way, `<View3D>` is a camera's viewport onto a 3D world drawn into the screen. Each
behaviour is on a node of either kind, and the kernel's lookups, events, tweens and destruction cross
between them. `findObjectOfType`, `getComponentInParent` and `this.node.scene` all work from a 3D node
up to the 2D scene. Destroying the `View3D` takes its whole world, behaviours included.

The port does three things for this:
- **`parentOf` and `childrenOf`.** The kernel walks the tree as the port says. pixi's `View3D` holds
  its world as `root`, outside its `children`, so the port returns `root`'s children as the view's,
  and the view as their parent. The root stays hidden, as pixi-react's `childHost` hides it.
- **`add` places nodes by kind.** A 3D child of a `View3D` goes into its world. A 3D node put on the
  2D stage, or a 2D node inside a 3D world, is refused, naming where it goes.
- **`drawsWithoutCamera`.** The 2D stage is the screen itself, so a 2D-only scene draws with no
  camera. `this.camera` is the main camera, the first visible one the scene put in. Each `View3D`
  draws from the first visible camera inside its own world, and the view's built-in camera is never
  counted as the scene's.

Transforms answer in 3D terms for a 2D node: `z` 0, its rotation a quaternion about z, in the
renderer's own axes (pixi's y points down). So `doMove`, `doRotate` and the rest work on both kinds.
A 2D value with no `z` is read as `z` 0.

## What a model already knows, and where SceNoCo differs

Models write three.js scenes the way React Three Fiber does, and pixi scenes the way pixi-react does.
SceNoCo keeps what those two agree on and departs where Unity's model calls for it, the same way on
both renderers:

| Habit | R3F / pixi-react | SceNoCo |
| --- | --- | --- |
| Tags | `<mesh>`, `<pixiSprite>` after `extend({ Sprite })` | `<Mesh>`, `<Sprite>`: the class itself, imported; nothing registered |
| Attributes | properties (R3F), constructor options (pixi-react) | both: the property, its `set` shorthand, or the constructor's option of that name |
| Dashed paths | `shadow-mapSize`, `anchor-x` | the same |
| Values | `position={[0, 1, 0]}`, `position={{ x, y }}` | both |
| Handlers | `onClick`, `onPointerDown`, `draw={g => …}` | refused with the fix: a scene only declares, and what reacts is a behaviour on the node; a `GraphicsContext` drawn once is a constant above the scene |
| Frame and app | `useFrame` / `useTick`, `useThree` / `useApplication`, `<Canvas>` / `<Application>` | behaviours' `update`, `this.camera`, `play(Main)` |
| Camera | `<Canvas camera>`, `<pixiView3D camera>` | a camera node in the scene, as in Unity: its first visible one draws |
| 2D and 3D | `<Html>` / `<Hud>` in R3F; `<pixiView3D>` in a 2D stage in pixi-react | pixi-react's shape: `<View3D>` on the 2D `<Scene>`; the page's HTML is the UI on both, as Unity's UI Toolkit |

## Rules

- **One renderer per game.** `Renderer` is merged once, and `bindRenderer` is called once.
- **`@scenoco/kernel/internal` is for renderer packages and their editors.** It holds the
  end-of-frame flush, the registry, the held clock, `liveGames`, `loadInto`, `setView` and
  provenance. Games use the public entry, through your package.
- **A production build keeps nothing of the bridge or the editor.** The kernel reaches both only when
  `import.meta.env.DEV` is set, so a bundler drops them. The port's own development members are
  yours to gate the same way: set them in one object behind `import.meta.env?.DEV`, as core's
  `port.ts` does. Left ungated, they stay in every game, along with all they reference:
  `bridgeScope: { THREE }` alone keeps every class three.js has. Build a game and read its source
  map to check.
- **The kernel never imports a renderer.** `npm run typecheck` checks the kernel alone. In that
  check `Renderer` is empty, so code that needs more than `BaseNode` (parent, children,
  `removeFromParent`) fails there.
- **Annotate what a declaration file must keep generic.** A field or constant typed from `Renderer`
  (`Vector2Of`, `SceneOf`, `Node`) needs an explicit annotation. Without one, `tsc` writes the
  kernel's fallback into the `.d.ts`, and every renderer sees that.
