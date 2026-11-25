import type { Node } from '../kernel/renderer.js';
import { Random } from '../Random.js';
import { port, type Quat, type Vec3 } from '../port.js';
import { Ease } from './Ease.js';
import { Tween } from './Tween.js';
import { Q4, V3, type EulerOrder } from './values.js';

/** How a rotation given as angles turns. */
export const RotateMode = {
  /** The short way round. */
  Fast: 0,
  /** By the angles as written, so 720° is two whole turns. */
  FastBeyond360: 1,
} as const;
export type RotateMode = (typeof RotateMode)[keyof typeof RotateMode];

const DEGREE = Math.PI / 180;

/** A position, a scale or angles: a 2D renderer's vectors have no `z`, which is 0 then. */
type XYZ = { x: number; y: number; z?: number };
type XYZW = { x: number; y: number; z: number; w: number };
/** A rotation as angles: degrees, as DOTween's are — or the renderer's own Euler, in radians (`RendererPort.eulerOf`). */
type Angles = XYZ;

/**
 * A moving part of a node, read and written through the renderer. Each keeps one array and one value
 * of its own for every frame it is read and written, so a running tween makes nothing per frame:
 * `get` returns that value read afresh — clone it to keep it.
 */
type Part<T> = { get(): T; set(value: T): void };

const position = (n: Node, world: boolean): Part<V3> => {
  const at: Vec3 = [0, 0, 0];
  const value = new V3();
  return {
    get() {
      const r = port().getPosition(n, world, at);
      return value.set(r[0], r[1], r[2]);
    },
    set: (v) => port().setPosition(n, v.toArray(at), world),
  };
};
const rotation = (n: Node, world: boolean): Part<Q4> => {
  const at: Quat = [0, 0, 0, 1];
  const value = new Q4();
  return {
    get() {
      const r = port().getRotation(n, world, at);
      return value.set(r[0], r[1], r[2], r[3]);
    },
    set: (q) => port().setRotation(n, q.toArray(at), world),
  };
};
const scale = (n: Node): Part<V3> => {
  const at: Vec3 = [1, 1, 1];
  const value = new V3();
  return {
    get() {
      const r = port().getScale(n, at);
      return value.set(r[0], r[1], r[2]);
    },
    set: (v) => port().setScale(n, v.toArray(at)),
  };
};

const onNode = (node: Node, tween: Tween) => tween.setTarget(node).setLink(node);

/** A node that turns about z alone — a 2D one (`RendererPort.isPlanar`): its x and y angles are dropped. */
const planar = (node: Node): boolean => port().isPlanar?.(node) ?? false;
const UP: Readonly<Vec3> = [0, 1, 0];
/** Which way is up for a node, where a jump hops (`RendererPort.upOf`): +y unless its renderer says. */
const up = (node: Node): Readonly<Vec3> => port().upOf?.(node) ?? UP;

function move(node: Node, part: Part<V3>, to: V3, duration: number): Tween {
  return onNode(node, Tween.to(part.get as () => never, part.set, to as never, duration));
}

function axis(node: Node, part: Part<V3>, i: 0 | 1 | 2, to: number, duration: number): Tween {
  return onNode(node, Tween.to(() => part.get().getComponent(i), (v) => part.set(part.get().setComponent(i, v)), to, duration));
}

/**
 * Angles as their type says: the renderer's own Euler is radians in its order, any other value
 * degrees. A planar node turns about z alone.
 */
function radians(angles: Angles, flat: boolean): { x: number; y: number; z: number; order: EulerOrder } {
  const own = port().eulerOf?.(angles);
  const turn = own ?? { x: angles.x * DEGREE, y: angles.y * DEGREE, z: (angles.z ?? 0) * DEGREE, order: 'XYZ' as const };
  return flat ? { x: 0, y: 0, z: turn.z, order: turn.order } : turn;
}

function rotate(node: Node, part: Part<Q4>, angles: Angles, duration: number, mode: RotateMode): Tween {
  const to = radians(angles, planar(node));
  if (mode === RotateMode.Fast) return onNode(node, Tween.to(part.get as () => never, part.set, new Q4().setFromEuler(to.x, to.y, to.z, to.order) as never, duration));
  const q = new Q4();
  return onNode(
    node,
    new Tween(duration, (self) => {
      const [fx, fy, fz] = part.get().toEuler(to.order);
      const k = self.relative ? 1 : 0;
      const [x, y, z] = [to.x + fx * k, to.y + fy * k, to.z + fz * k];
      return (e) => part.set(q.setFromEuler(fx + (x - fx) * e, fy + (y - fy) * e, fz + (z - fz) * e, to.order));
    }),
  );
}

function jump(node: Node, part: Part<V3>, to: V3, power: number, jumps: number, duration: number): Tween {
  const value = new V3();
  const [ux, uy, uz] = up(node);
  return onNode(
    node,
    new Tween(duration, () => {
      const from = part.get().clone();
      return (e) => {
        value.lerpVectors(from, to, e);
        const hop = (e * jumps) % 1;
        const height = power * 4 * hop * (1 - hop);
        value.set(value.x + ux * height, value.y + uy * height, value.z + uz * height);
        part.set(value);
      };
    }),
  );
}

/** An offset that comes and goes, added to where the part was when it began. */
function wobble(node: Node, duration: number, begin: () => (offset: V3) => void, offsetAt: (e: number, out: V3) => void): Tween {
  const offset = new V3();
  return onNode(
    node,
    new Tween(duration, () => {
      const apply = begin();
      return (e) => {
        offsetAt(e, offset);
        apply(offset);
      };
    }).setEase(Ease.Linear),
  );
}

const added = (part: Part<V3>) => () => {
  const base = part.get().clone();
  const value = new V3();
  return (offset: V3) => part.set(value.copy(base).add(offset));
};
const turned = (part: Part<Q4>, flat: boolean) => () => {
  const base = part.get().clone();
  const value = new Q4();
  const by = new Q4();
  const k = flat ? 0 : DEGREE;
  return (offset: V3) => part.set(value.copy(base).multiply(by.setFromEuler(offset.x * k, offset.y * k, offset.z * DEGREE)));
};

function punch(node: Node, begin: () => (offset: V3) => void, amount: XYZ, duration: number, vibrato: number, elasticity: number): Tween {
  const size = V3.of(amount);
  return wobble(node, duration, begin, (e, out) => {
    const swing = Math.sin(e * Math.PI * vibrato * 0.5) * (1 - e);
    out.copy(size).multiplyScalar(swing < 0 ? swing * elasticity : swing);
  });
}

function shake(node: Node, begin: () => (offset: V3) => void, strength: number | XYZ, duration: number, vibrato: number): Tween {
  const size = typeof strength === 'number' ? new V3(strength, strength, strength) : V3.of(strength);
  const last = new V3();
  const next = new V3();
  let segment = -1;
  const pick = () => next.set((Random.value * 2 - 1) * size.x, (Random.value * 2 - 1) * size.y, (Random.value * 2 - 1) * size.z);
  return wobble(node, duration, begin, (e, out) => {
    const at = e * Math.max(1, vibrato * duration);
    if (Math.floor(at) !== segment) {
      segment = Math.floor(at);
      last.copy(next);
      pick();
    }
    out.lerpVectors(last, next, at - segment).multiplyScalar(1 - e);
  });
}

/**
 * DOTween's shortcuts on the renderer's node class — `doMove`, `doRotate`, `doPunchScale` and the rest —
 * reading and writing the node through the renderer's port. The renderer's package calls this once
 * with its node class's prototype and declares the methods on that class for TypeScript, with its own
 * vector types: `doMove(to: Vector3, duration: number): Tween`.
 */
export function installNodeTweens(prototype: object): void {
  const methods: Record<string, (this: Node, ...args: never[]) => unknown> = {
    doMove(this: Node, to: XYZ, d: number) {
      return move(this, position(this, true), V3.of(to), d);
    },
    doLocalMove(this: Node, to: XYZ, d: number) {
      return move(this, position(this, false), V3.of(to), d);
    },
    doScale(this: Node, to: number | XYZ, d: number) {
      return move(this, scale(this), typeof to === 'number' ? new V3(to, to, to) : V3.of(to), d);
    },
    doRotate(this: Node, to: Angles, d: number, mode: RotateMode = RotateMode.Fast) {
      return rotate(this, rotation(this, true), to, d, mode);
    },
    doLocalRotate(this: Node, to: Angles, d: number, mode: RotateMode = RotateMode.Fast) {
      return rotate(this, rotation(this, false), to, d, mode);
    },
    doRotateQuaternion(this: Node, to: XYZW, d: number) {
      const part = rotation(this, true);
      return onNode(this, Tween.to(part.get as () => never, part.set, Q4.of(to) as never, d));
    },
    doLocalRotateQuaternion(this: Node, to: XYZW, d: number) {
      const part = rotation(this, false);
      return onNode(this, Tween.to(part.get as () => never, part.set, Q4.of(to) as never, d));
    },
    doLookAt(this: Node, point: XYZ, d: number) {
      const part = rotation(this, false);
      const end = Q4.of(port().lookRotation(this, [point.x, point.y, point.z ?? 0]));
      return onNode(this, Tween.to(part.get as () => never, part.set, end as never, d));
    },
    doJump(this: Node, to: XYZ, power: number, jumps: number, d: number) {
      return jump(this, position(this, true), V3.of(to), power, jumps, d);
    },
    doLocalJump(this: Node, to: XYZ, power: number, jumps: number, d: number) {
      return jump(this, position(this, false), V3.of(to), power, jumps, d);
    },
    doPunchPosition(this: Node, amount: XYZ, d: number, vibrato = 10, elasticity = 1) {
      return punch(this, added(position(this, false)), amount, d, vibrato, elasticity);
    },
    doPunchRotation(this: Node, amount: XYZ, d: number, vibrato = 10, elasticity = 1) {
      return punch(this, turned(rotation(this, false), planar(this)), amount, d, vibrato, elasticity);
    },
    doPunchScale(this: Node, amount: XYZ, d: number, vibrato = 10, elasticity = 1) {
      return punch(this, added(scale(this)), amount, d, vibrato, elasticity);
    },
    doShakePosition(this: Node, d: number, strength: number | XYZ = 1, vibrato = 10) {
      return shake(this, added(position(this, false)), strength, d, vibrato);
    },
    doShakeRotation(this: Node, d: number, strength: number | XYZ = 90, vibrato = 10) {
      return shake(this, turned(rotation(this, false), planar(this)), strength, d, vibrato);
    },
    doShakeScale(this: Node, d: number, strength: number | XYZ = 1, vibrato = 10) {
      return shake(this, added(scale(this)), strength, d, vibrato);
    },
    doKill(this: Node, complete = false) {
      Tween.kill(this, complete);
    },
    doComplete(this: Node) {
      Tween.kill(this, true);
    },
  };
  (['X', 'Y', 'Z'] as const).forEach((name, i) => {
    const at = i as 0 | 1 | 2;
    methods[`doMove${name}`] = function (this: Node, to: number, d: number) {
      return axis(this, position(this, true), at, to, d);
    };
    methods[`doLocalMove${name}`] = function (this: Node, to: number, d: number) {
      return axis(this, position(this, false), at, to, d);
    };
    methods[`doScale${name}`] = function (this: Node, to: number, d: number) {
      return axis(this, scale(this), at, to, d);
    };
  });
  for (const [name, value] of Object.entries(methods)) Object.defineProperty(prototype, name, { value, configurable: true, writable: true });
}

/**
 * A property of any object tweened to `to` — a number, or a value the renderer names, written the
 * renderer's way (`values.assign`): `tweenProperty(material, 'opacity', 0, 0.3)`. `Tween.kill(target)`
 * finds it. What a renderer's own shortcuts — a material's `doFade`, a light's `doIntensity` — are made of.
 */
export function tweenProperty(target: object, key: string, to: unknown, duration: number): Tween {
  const own = target as Record<string, unknown>;
  return Tween.to(
    () => own[key] as never,
    (v) => {
      if (typeof v === 'number') own[key] = v;
      else port().values.assign(own, key, v);
    },
    to as never,
    duration,
  ).setTarget(target);
}
