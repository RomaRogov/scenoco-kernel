import { applyProp } from '../jsx.js';
import { givenOf } from '../provenance.js';
import { port } from '../port.js';

/**
 * Development only: an element's `args` changed on the live object, as if it had been built with
 * them. Nothing is listed anywhere: what each argument sets is found by building the class twice —
 * once as written, once with that one argument changed — and seeing which property differed.
 * three.js's `new HemisphereLight(sky, ground, intensity)` sets `color`, `groundColor` and `intensity`;
 * a geometry's arguments set nothing so plain, so it is built again and copied into itself, in place,
 * keeping every reference to it.
 */

type Ctor = new (...args: unknown[]) => Record<string, unknown>;

/** Each class's constructor: which property each argument sets, or null when no one property does. */
const found = new WeakMap<Function, Map<number, (string | null)[]>>();

/** Whether a change to argument `index` can be made on the live object. */
export function settableArgument(made: object, args: readonly unknown[], index: number): boolean {
  return remakeable(made) || argumentProperties(made.constructor as Ctor, args)[index] !== null;
}

/** Set `args` on the live object: through the properties they set, or by building it again in place. */
export function applyArguments(made: Record<string, unknown>, args: readonly unknown[]): void {
  const ctor = made.constructor as Ctor;
  const properties = argumentProperties(ctor, args);
  const tag = ctor.name;
  if (properties.some((p) => p === null) && remakeable(made)) {
    port().remake!(made, new ctor(...args));
    // What the element set besides its arguments, as it set it.
    for (const [name, value] of Object.entries(givenOf(made) ?? {})) if (!RESERVED.has(name)) applyProp(made, name, value, tag);
  } else {
    properties.forEach((property, i) => property !== null && i < args.length && applyProp(made, property, args[i], tag));
  }
  port().refresh?.(made);
}

const RESERVED = new Set(['args', 'attach', 'children', 'ref', 'key']);

/** One the renderer can make again in place, from a fresh one built with other arguments. */
function remakeable(made: object): boolean {
  return !port().isNode(made) && !!port().canRemake?.(made);
}

function argumentProperties(ctor: Ctor, args: readonly unknown[]): (string | null)[] {
  let byCount = found.get(ctor);
  if (!byCount) found.set(ctor, (byCount = new Map()));
  let properties = byCount.get(args.length);
  if (!properties) byCount.set(args.length, (properties = probe(ctor, args)));
  return properties;
}

function probe(ctor: Ctor, args: readonly unknown[]): (string | null)[] {
  const build = (list: readonly unknown[]) => {
    try {
      return new ctor(...list);
    } catch {
      return null;
    }
  };
  const base = build(args);
  const twin = build(args);
  if (!base || !twin) return args.map(() => null);
  // What differs between two built alike — an id, a uuid — tells nothing.
  const noise = new Set(Object.keys(base).filter((key) => differs(base[key], twin[key])));
  const out = args.map((value, i) => {
    const other = changed(value);
    if (other === undefined) return null;
    const variant = build(args.map((v, j) => (j === i ? other : v)));
    if (!variant) return null;
    const keys = Object.keys(base).filter((key) => !noise.has(key) && !derived(base[key]) && differs(base[key], variant[key]));
    dispose(variant);
    return keys.length === 1 && fits(value, base[keys[0]!]) ? keys[0]! : null;
  });
  dispose(base);
  dispose(twin);
  return out;
}

/** Another value of the same kind, to see what it changes. */
function changed(value: unknown): unknown {
  if (typeof value === 'number') return value === 0 ? 1 : value * 2 + 1;
  if (typeof value === 'boolean') return !value;
  if (typeof value === 'string') return /^#[0-9a-f]{6}$/i.test(value) ? (value.toLowerCase() === '#123456' ? '#654321' : '#123456') : `${value}_`;
  return undefined;
}

/** Whether the argument can be set straight onto the property: a number onto a number, a string onto a string or a value (a colour) that takes one. */
function fits(argument: unknown, property: unknown): boolean {
  if (typeof argument === 'number' || typeof argument === 'boolean') return typeof property === typeof argument;
  if (typeof argument === 'string') return typeof property === 'string' || (typeof property === 'object' && property !== null);
  return false;
}

/** Worked out from the others — a camera's projection matrix — so it changes along with them: the renderer says. */
function derived(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !!port().isDerived?.(value);
}

function differs(a: unknown, b: unknown): boolean {
  if (a === b) return false;
  if (typeof a === 'number' && typeof b === 'number') return !(Number.isNaN(a) && Number.isNaN(b));
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return typeof a !== 'function';
  const equals = (a as { equals?: (b: unknown) => boolean }).equals;
  if (typeof equals === 'function') return !equals.call(a, b);
  if (Array.isArray(a) || Object.getPrototypeOf(a) === Object.prototype) {
    try {
      return JSON.stringify(a) !== JSON.stringify(b);
    } catch {
      return false;
    }
  }
  // Anything else — buffers, children — cannot be compared as a value.
  return false;
}

function dispose(made: Record<string, unknown>): void {
  port().free?.(made);
}
