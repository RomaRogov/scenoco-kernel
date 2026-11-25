/**
 * @internal The kernel's own vector and rotation for the node tweens: what a tween moves while it
 * reads and writes a node through the renderer's port, as numbers. The tween engine moves them with
 * their own methods, as it moves a renderer's values through the port, so `from()`, relative and
 * incremental loops work on them alike. The rotation math is three.js's, so a port to it turns
 * exactly as three does.
 */
import type { Quat, Vec3 } from '../port.js';

export class V3 {
  x: number;
  y: number;
  z: number;
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  /** From numbers or a vector — a 2D one too, its `z` 0. */
  static of(v: Vec3 | { x: number; y: number; z?: number }): V3 {
    return Array.isArray(v) ? new V3(v[0], v[1], v[2]) : new V3(v.x, v.y, v.z ?? 0);
  }
  /** Its numbers into `out`, returned. */
  toArray(out: Vec3): Vec3 {
    out[0] = this.x;
    out[1] = this.y;
    out[2] = this.z;
    return out;
  }
  clone(): V3 {
    return new V3(this.x, this.y, this.z);
  }
  copy(v: V3): this {
    return this.set(v.x, v.y, v.z);
  }
  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  add(v: V3): this {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  multiplyScalar(s: number): this {
    return this.set(this.x * s, this.y * s, this.z * s);
  }
  lerpVectors(a: V3, b: V3, t: number): this {
    return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
  getComponent(i: number): number {
    return i === 0 ? this.x : i === 1 ? this.y : this.z;
  }
  setComponent(i: number, value: number): this {
    if (i === 0) this.x = value;
    else if (i === 1) this.y = value;
    else this.z = value;
    return this;
  }
}

/** Euler angles' order, three.js's names: 'XYZ' is x first. */
export type EulerOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';

export class Q4 {
  readonly isQuaternion = true;
  x: number;
  y: number;
  z: number;
  w: number;
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }
  static of(q: Quat | { x: number; y: number; z: number; w: number }): Q4 {
    return Array.isArray(q) ? new Q4(q[0], q[1], q[2], q[3]) : new Q4(q.x, q.y, q.z, q.w);
  }
  /** Its numbers into `out`, returned. */
  toArray(out: Quat): Quat {
    out[0] = this.x;
    out[1] = this.y;
    out[2] = this.z;
    out[3] = this.w;
    return out;
  }
  clone(): Q4 {
    return new Q4(this.x, this.y, this.z, this.w);
  }
  copy(q: Q4): this {
    return this.set(q.x, q.y, q.z, q.w);
  }
  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }
  /** `this` then `q`, as three.js's `multiply`. */
  multiply(q: Q4): this {
    const { x: ax, y: ay, z: az, w: aw } = this;
    const { x: bx, y: by, z: bz, w: bw } = q;
    return this.set(
      ax * bw + aw * bx + ay * bz - az * by,
      ay * bw + aw * by + az * bx - ax * bz,
      az * bw + aw * bz + ax * by - ay * bx,
      aw * bw - ax * bx - ay * by - az * bz,
    );
  }
  /** three.js's `slerpQuaternions`: the short way round from `a` to `b`. */
  slerpQuaternions(a: Q4, b: Q4, t: number): this {
    this.copy(a);
    if (t === 0) return this;
    if (t === 1) return this.copy(b);
    const { x, y, z, w } = this;
    let cosHalf = w * b.w + x * b.x + y * b.y + z * b.z;
    if (cosHalf < 0) {
      this.set(-b.x, -b.y, -b.z, -b.w);
      cosHalf = -cosHalf;
    } else this.copy(b);
    if (cosHalf >= 1) return this.set(x, y, z, w);
    const sqrSin = 1 - cosHalf * cosHalf;
    if (sqrSin <= Number.EPSILON) {
      const s = 1 - t;
      this.set(s * x + t * this.x, s * y + t * this.y, s * z + t * this.z, s * w + t * this.w);
      return this.normalize();
    }
    const sinHalf = Math.sqrt(sqrSin);
    const half = Math.atan2(sinHalf, cosHalf);
    const ra = Math.sin((1 - t) * half) / sinHalf;
    const rb = Math.sin(t * half) / sinHalf;
    return this.set(x * ra + this.x * rb, y * ra + this.y * rb, z * ra + this.z * rb, w * ra + this.w * rb);
  }
  normalize(): this {
    const l = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    return this.set(this.x / l, this.y / l, this.z / l, this.w / l);
  }
  /** three.js's `setFromEuler`: angles in radians, applied in `order`. */
  setFromEuler(x: number, y: number, z: number, order: EulerOrder = 'XYZ'): this {
    const [c1, c2, c3] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
    const [s1, s2, s3] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
    switch (order) {
      case 'XYZ': return this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
      case 'YXZ': return this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
      case 'ZXY': return this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
      case 'ZYX': return this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
      case 'YZX': return this.set(s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 + s1 * c2 * s3, c1 * c2 * s3 - s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3);
      case 'XZY': return this.set(s1 * c2 * c3 - c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 + s1 * s2 * s3);
    }
  }
  /** Its angles in radians for `order`: three.js's `Euler.setFromQuaternion`. */
  toEuler(order: EulerOrder = 'XYZ'): Vec3 {
    const { x, y, z, w } = this;
    const [x2, y2, z2] = [x + x, y + y, z + z];
    const [xx, xy, xz, yy, yz, zz, wx, wy, wz] = [x * x2, x * y2, x * z2, y * y2, y * z2, z * z2, w * x2, w * y2, w * z2];
    // The rotation matrix, row by row.
    const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
    const m21 = xy + wz, m22 = 1 - (xx + zz), m23 = yz - wx;
    const m31 = xz - wy, m32 = yz + wx, m33 = 1 - (xx + yy);
    const clamp = (v: number) => Math.min(Math.max(v, -1), 1);
    const near = (v: number) => Math.abs(v) < 0.9999999;
    switch (order) {
      case 'XYZ': {
        const b = Math.asin(clamp(m13));
        return near(m13) ? [Math.atan2(-m23, m33), b, Math.atan2(-m12, m11)] : [Math.atan2(m32, m22), b, 0];
      }
      case 'YXZ': {
        const a = Math.asin(-clamp(m23));
        return near(m23) ? [a, Math.atan2(m13, m33), Math.atan2(m21, m22)] : [a, Math.atan2(-m31, m11), 0];
      }
      case 'ZXY': {
        const a = Math.asin(clamp(m32));
        return near(m32) ? [a, Math.atan2(-m31, m33), Math.atan2(-m12, m22)] : [a, 0, Math.atan2(m21, m11)];
      }
      case 'ZYX': {
        const b = Math.asin(-clamp(m31));
        return near(m31) ? [Math.atan2(m32, m33), b, Math.atan2(m21, m11)] : [0, b, Math.atan2(-m12, m22)];
      }
      case 'YZX': {
        const c = Math.asin(clamp(m21));
        return near(m21) ? [Math.atan2(-m23, m22), Math.atan2(-m31, m11), c] : [0, Math.atan2(m13, m33), c];
      }
      case 'XZY': {
        const c = Math.asin(-clamp(m12));
        return near(m12) ? [Math.atan2(m32, m22), Math.atan2(m13, m11), c] : [Math.atan2(-m23, m33), 0, c];
      }
    }
  }
}
