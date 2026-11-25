/**
 * Game state as plain data: a behaviour as its fields and getters, a vector as an array, a colour as
 * "#rrggbb" — what the bridge answers with, and the scene as an outline of text.
 */
import { Behaviour } from '../kernel/Behaviour.js';
import { Event } from '../kernel/Event.js';
import { behavioursOn } from '../kernel/registry.js';
import { childrenOf, givenName, kindOf, traverse } from '../kernel/nodes.js';
import type { Node } from '../kernel/renderer.js';
import { boundPort, port } from '../port.js';
import type { Scope } from './scope.js';

/** The scene as indented text, `depth` levels down, with every behaviour's fields. */
export function outline(scene: Node, depth: number): string[] {
  const lines: string[] = [];
  const visit = (node: Node, level: number) => {
    const own = behavioursOn(node).filter((b) => !b.isDestroyed);
    const kids = childrenOf(node);
    const plainKids = kids.filter((c) => !givenName(c) && behavioursOn(c).length === 0 && !hasNamedOrBehaviour(c));
    const label = `${'  '.repeat(level)}- ${describe(node)} at ${worldAt(node)}`;
    const parts = own.map((b) => `${b.constructor.name}${b.enabled ? '' : ' (disabled)'} ${compact(fields(b))}`);
    lines.push(parts.length ? `${label} — ${parts.join(' · ')}` : label);
    if (level + 1 >= depth) {
      if (kids.length) lines.push(`${'  '.repeat(level + 1)}(${kids.length} children below the depth)`);
      return;
    }
    for (const child of kids) if (!plainKids.includes(child)) visit(child, level + 1);
    if (plainKids.length) lines.push(`${'  '.repeat(level + 1)}(+${plainKids.length} unnamed ${plainKids.length === 1 ? 'object' : 'objects'} without behaviours)`);
  };
  visit(scene, 0);
  return lines;
}

/** `Player` — every live Player; `Player.lane` — that field of each; `#runner` — a node by name. */
export function telemetry(target: string, reading: Pick<Scope, 'nodeNamed' | 'byClass'>): unknown {
  const { nodeNamed, byClass } = reading;
  if (target.startsWith('#')) {
    const node = nodeNamed(target.slice(1));
    const own = node as unknown as Record<string, unknown>;
    return {
      type: kindOf(node),
      name: givenName(node),
      position: plain(own.position, 1),
      worldPosition: worldAt(node),
      rotation: plain(own.rotation, 1),
      scale: plain(own.scale, 1),
      visible: port().isVisible(node),
      children: childrenOf(node).length,
      behaviours: Object.fromEntries(behavioursOn(node).map((b) => [b.constructor.name, fields(b)])),
    };
  }
  const [type, ...path] = target.split('.');
  const list = byClass().get(type!);
  if (!list) {
    const known = [...byClass().keys()].sort().join(', ');
    throw new Error(`no live behaviour of class ${type}. Live classes: ${known || 'none'}`);
  }
  return list.map((b) => {
    const host = b.node;
    const where = givenName(host) || kindOf(host);
    if (path.length === 0) return { on: where, at: worldAt(host), ...fields(b) };
    let value: unknown = b;
    for (const key of path) value = (value as Record<string, unknown>)?.[key];
    return { on: where, [path.join('.')]: plain(value, 2) };
  });
}

/** A reading as one console line: a behaviour as its fields, as `eval` answers. */
export function readable(value: unknown): unknown {
  if (value instanceof Behaviour) return { class: value.constructor.name, ...fields(value) };
  if (Array.isArray(value) && value.some((v) => v instanceof Behaviour)) return value.map(readable);
  return plain(value, 3);
}

function hasNamedOrBehaviour(node: Node): boolean {
  let found = false;
  traverse(node, (n) => {
    if (n !== node && (givenName(n) || behavioursOn(n).length)) found = true;
  });
  return found;
}

/** A node as the outline names it: its kind, and its name if it has one. */
function describe(node: Node): string {
  const name = givenName(node);
  return `${kindOf(node)}${name ? ` "${name}"` : ''}`;
}

/** Where a node is in the world, rounded. */
function worldAt(node: Node): number[] {
  return port().getPosition(node, true, [0, 0, 0]).map(round);
}

/** A behaviour's state: its own fields, then its getters — what a person would look at in an inspector. */
export function fields(b: Behaviour): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(b)) {
    if (key.startsWith('_')) continue;
    const value = (b as unknown as Record<string, unknown>)[key];
    if (typeof value === 'function') continue;
    out[key] = plain(value, 1);
  }
  // Up to the framework's own base classes: `node`, `camera`, `enabled` are the same on every behaviour.
  for (let proto = Object.getPrototypeOf(b); proto && proto.constructor.name !== 'Behaviour'; proto = Object.getPrototypeOf(proto)) {
    for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(proto))) {
      if (!desc.get || key.startsWith('_') || key in out) continue;
      try {
        out[key] = plain(desc.get.call(b), 1);
      } catch {
        // a getter that needs something not there yet
      }
    }
  }
  return out;
}

/** A value as JSON in the renderer's own vocabulary: vectors as arrays, colours as "#rrggbb", nodes by name. */
export function plain(value: unknown, depth: number): unknown {
  // Spelled out, because JSON drops it: `{ score: undefined }` came back as `{}`, and read as "no such thing".
  if (value === undefined) return '<undefined>';
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return round(value);
  if (typeof value === 'function') return `<function ${(value as { name?: string }).name || 'anonymous'}>`;
  if (typeof value !== 'object') return String(value);
  const v = value as Record<string, unknown> & { constructor: { name: string } };
  const renderer = boundPort();
  const own = renderer?.describe?.(value, '');
  if (own) return own.kind === 'color' ? own.hex : own.items.map(round);
  const legacy = renderer?.plain?.(value);
  if (legacy !== undefined) return typeof legacy === 'number' ? round(legacy) : Array.isArray(legacy) ? legacy.map((x) => (typeof x === 'number' ? round(x) : x)) : legacy;
  if (renderer?.isNode(value)) return `<${describe(value)}>`;
  if (value instanceof Behaviour) return `<${value.constructor.name}${value.isDestroyed ? ' destroyed' : ''}>`;
  if (value instanceof Event) return `<Event, ${value.listenerCount} listener${value.listenerCount === 1 ? '' : 's'}>`;
  if (Array.isArray(value)) {
    if (depth <= 0) return `<${value.length} items>`;
    const items = value.slice(0, 12).map((item) => plain(item, depth - 1));
    return value.length > 12 ? [...items, `… ${value.length - 12} more`] : items;
  }
  if (value instanceof Map || value instanceof Set) return `<${v.constructor.name}, ${value.size}>`;
  const proto = Object.getPrototypeOf(value);
  // A class instance by its name — or as native, when the name is a minifier's (Rapier's are).
  if (proto !== Object.prototype && proto !== null) return v.constructor.name.length > 2 ? `<${v.constructor.name}>` : '<native>';
  if (depth <= 0) return '<object>';
  return Object.fromEntries(Object.entries(v).map(([k, item]) => [k, plain(item, depth - 1)]));
}

export function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

function compact(record: Record<string, unknown>): string {
  const text = JSON.stringify(record);
  return text.length > 220 ? `${text.slice(0, 217)}…}` : text;
}
