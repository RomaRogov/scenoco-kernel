import { boundPort } from '../port.js';

/**
 * `owner[key] = value` as a TSX attribute and a behaviour's field take it — one rule for both. The
 * shorthand is the property's own: an array, a number or a string goes through the `set` (a number
 * through `setScalar` first) of the value the property holds — `position={[0, 1, 0]}`, `scale={2}`,
 * `color="#f80"`. Anything else is the renderer's to take (`RendererPort.values.assign`): copied into
 * what the property holds, converted, or assigned.
 */
export function assignValue(owner: Record<string, unknown>, key: string, value: unknown): void {
  const current = owner[key] as Record<string, unknown> | null | undefined;
  if (current && typeof current === 'object' && value !== null && value !== undefined && !isCollection(current)) {
    const set = current.set as ((...args: unknown[]) => void) | undefined;
    if (Array.isArray(value) && typeof set === 'function') return void set.apply(current, value);
    if (typeof value === 'number' && typeof current.setScalar === 'function') return void (current.setScalar as (n: number) => void)(value);
    if ((typeof value === 'string' || typeof value === 'number') && typeof set === 'function') return void set.call(current, value);
  }
  const values = boundPort()?.values;
  if (values) values.assign(owner, key, value);
  else owner[key] = value;
}

/** A collection's own `set` stores an item, it is no shorthand: a Map, a Set, an array, a typed array. */
function isCollection(value: object): boolean {
  return value instanceof Map || value instanceof Set || Array.isArray(value) || ArrayBuffer.isView(value);
}
