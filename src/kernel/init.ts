/**
 * How a behaviour takes what its TSX element or `addComponent` gave it: as an attribute takes a
 * value (`assign.ts`), and refs held until `start`, so one set later in the build is still picked up.
 */
import type { Behaviour } from './Behaviour.js';
import { assignValue } from './assign.js';

/** Apply settings as attributes are: shorthand through the field's own `set`, the rest the renderer's way. */
export function assignInit(b: Behaviour, init: object): void {
  const target = b as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(init)) {
    if (isRef(value)) {
      if (isRef(target[key])) {
        const name = b.constructor.name;
        throw new Error(`<${name} ${key}={…}>: a ref given to a field arrives as the object it points at, so the field holds the object, not a ref. In ${name}, declare it as ${key}: Mesh | null = null (the object's own class) and read this.${key} directly.`);
      }
      // Not set yet while the scene is still being built: read at `awake`, and again at `start`.
      (b._refs ??= new Map()).set(key, value);
      target[key] = value.current;
      continue;
    }
    assignValue(target, key, value);
  }
}

/** A React ref, or any `{ current }` holder: a link to something that may not exist yet. */
function isRef(value: unknown): value is { current: unknown } {
  if (!value || typeof value !== 'object' || !('current' in value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return (proto === Object.prototype || proto === null) && Object.keys(value).length === 1;
}

/** Read every linked field from its ref. Kept until `start`, so a ref set late is still picked up. */
export function resolveRefs(b: Behaviour): void {
  if (!b._refs) return;
  const target = b as unknown as Record<string, unknown>;
  for (const [key, ref] of b._refs) if (ref.current != null) target[key] = ref.current;
}
