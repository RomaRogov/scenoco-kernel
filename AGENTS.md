# AGENTS.md — working on the SceNoCo kernel

> Orientation for an AI agent **modifying this repository**. For writing a renderer package, read
> [`README.md`](README.md). For why a piece of the design is the way it is, read the doc comment
> above it — that is where it lives.

## What this is

`@scenoco/kernel` is everything SceNoCo does, with no renderer: behaviours, the frame (`play`,
`simulate`), scenes, prefabs and TSX, tweens, `Input`, `Random`, `QualitySettings`, `UIDocument`, the
bridge and the editor's model side. A renderer's package — `@scenoco-three/core` for three.js
([scenoco-three](https://github.com/RomaRogov/scenoco-three)), scenoco-pixi next — implements one
interface, `RendererPort` (`src/port.ts`), binds it, names its classes by merging `interface Renderer`
(`src/kernel/renderer.ts`), and re-exports the kernel. Games import the renderer's package, never this.

## The rules

- **No renderer import, ever.** `npm run typecheck` checks the kernel with `Renderer` empty; code that
  needs more of a node than `BaseNode` asks the port.
- **The kernel never calls a method on a renderer value.** `port.values` (`clone`, `mix`, `sum`,
  `assign`) moves and writes them; the kernel keeps only the `set`/`setScalar` shorthand rule
  (`src/kernel/assign.ts`).
- **Nothing is registered and nothing is looked up by name.** A tag's attributes come from the class's
  declared properties and its constructor's options; there is no table to add to.
- **Annotate what a declaration file must keep generic.** A field typed from `Renderer` (`Node`,
  `SceneOf`, `Vector2Of`) needs an explicit type, or `tsc` freezes the fallback into the `.d.ts`.
- **A change to `RendererPort` is a change to every renderer.** Update the README's port table, the
  test port in `tests/renderer-neutral.test.ts`, and say what each renderer's package must now do.
- **Unity's names, the renderer's objects.** A SceNoCo-only concept is a cost a model pays in lookups.
- **A refusal is a message** naming where and the exact text to write instead.
- **Comments carry the *why*.** Keep them short and concrete.

## Map

| Where | What |
| --- | --- |
| `src/port.ts` | `RendererPort`, `bindRenderer`, `port()` |
| `src/kernel/` | `Behaviour`, the registry, lifecycle, `Runtime`, events, coroutines, `Time`, `System` |
| `src/jsx.ts` `src/provenance.ts` | TSX to the renderer's objects, `prefab`, `ref`, attribute types |
| `src/play.ts` `src/simulate.ts` `src/scenes.ts` | a game on the renderer's view, a stepped one for tests, `SceneManager`, `instantiate` |
| `src/tween/` | `Tween`, `Ease`, the `do…` node tweens over the port's transforms |
| `src/input/` | `Input`: keys, pointer, named axes |
| `src/host.ts` `src/bridge/` `src/editor/` | what the editor and `window.__scenoco` do to a running game |
| `src/index.ts` `src/internal.ts` | the public entry, and what a renderer's package reaches in with |

## Build, check, test

```bash
npm install
npm run build
npm run typecheck
npm test
```

Done means typecheck clean, tests green, build passes, and the renderer packages still pass theirs
against this build (`npm link` or a packed tarball) before a release.

A release is a tag: `git tag vX.Y.Z && git push origin vX.Y.Z` runs `.github/workflows/release.yml`.
The renderer packages pin the kernel's exact version; publish the kernel first.
