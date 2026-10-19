import * as THREE from "three";
import { TYRE_HALF_W } from "../deform/deform-contact.ts";
import { TYRE_R } from "../deform/deform-state.ts";
import { computeNormalsFast } from "../deform/fast-normals.ts";
import { hypot2, hypot3 } from "../kernel/physics-core.js";
import { WHEEL_POS } from "./car-mesh.ts";

/** How far (m) a held skin point stands over the tyre: the triangles between held points sag under their chords (edges up to 25 cm over a tyre). */
const TYRE_GAP = 0.05;
/** How steeply (m/m) the tyre's surface is carried on past the tread's edges and the arc's ends: a point near an edge is held a little, never with a step. */
const FALL = 1;
/** How far (m) over the tyre's surface a skin point may rest and still be held: the hood and fenders, not the roof. */
const REACH = 0.5;
/** Rounding of the rest frame (m), rebuilt from matrices. */
const REST_SLACK = 1e-3;
/** The elements of a wheel's matrix that place its tyre: the axle (first column) and the hub (last). */
const HELD_ELEMENTS = [0, 1, 2, 12, 13, 14] as const;

const _mesh = new THREE.Matrix4();
const _wheel = new THREE.Matrix4();
const _hub = new THREE.Vector3();

/** `obj`'s matrix in the frame of `root`, from the local matrices alone (the world matrices are a frame old until the render). */
function matrixIn(root: THREE.Object3D, obj: THREE.Object3D, out: THREE.Matrix4): THREE.Matrix4 {
  out.identity();
  for (let p: THREE.Object3D | null = obj; p && p !== root; p = p.parent) {
    p.updateMatrix();
    out.premultiply(p.matrix);
  }
  return out;
}

/** How far (m) point `i` of `pos` stands over the upper surface of the tyre of hub h, unit axle a and scale `scale`, less `gap`; the surface carried on past its edges at `FALL`. */
function clearOver(pos: ArrayLike<number>, i: number, h: ArrayLike<number>, a: ArrayLike<number>, scale: number, gap: number): number {
  const dx = pos[i]! - h[0]!;
  const dy = pos[i + 1]! - h[1]!;
  const dz = pos[i + 2]! - h[2]!;
  const flat = hypot2(a[0]!, a[2]!);
  const fx = -a[2]! / flat;
  const fz = a[0]! / flat;
  const up = -fz * a[1]! * dx + (fz * a[0]! - fx * a[2]!) * dy + fx * a[1]! * dz;
  const ahead = dx * fx + dz * fz;
  const along = dx * a[0]! + dy * a[1]! + dz * a[2]!;
  const r = TYRE_R * scale;
  const top = Math.sqrt(Math.max(0, r * r - ahead * ahead)) - FALL * (Math.max(0, Math.abs(ahead) - r) + Math.max(0, Math.abs(along) - TYRE_HALF_W * scale));
  return up - top - gap;
}

const _h = new Float64Array(3);
const _a = new Float64Array(3);

/**
 * A crushed hood or fender drawn over a standing tyre is held on it: every skin point that rests over the tyre's upper surface stands at least `TYRE_GAP` over it,
 * lifted along the tyre's up. Each hold starts from the skin as last written, so the hold is a function of that skin and the wheels: no history, and it moves smoothly with the tyre.
 */
export class TyreSkin {
  private readonly mesh: THREE.Mesh;
  private readonly rest: Float32Array;
  /** Per wheel and vertex, how far (m) it rests over the tyre's surface; NaN for one that does not rest over it. */
  private readonly over: Float32Array[] = [];
  /** The class lift, hub shift and wheel scale `over` was found for. */
  private readonly overFor = new Float64Array(3).fill(NaN);
  /** Per wheel, its axle and hub in the mesh's frame at the last hold. */
  private readonly heldAt = new Float64Array(4 * HELD_ELEMENTS.length).fill(NaN);
  /** The skin as last written, which every hold starts from. */
  private readonly written: Float32Array;
  private hasWritten = false;

  /** `rest`: the mesh's rest positions in its own frame. */
  constructor(mesh: THREE.Mesh, rest: Float32Array) {
    this.mesh = mesh;
    this.rest = rest;
    this.written = new Float32Array(rest.length);
  }

  /** The vertices resting over each tyre: the class's lift, hub shift and wheel scale change what that is. */
  private findOver(group: THREE.Object3D, wheels: readonly THREE.Object3D[], lift: number): void {
    const hubs = wheels[0]!.parent!;
    const hubShift = hubs === group ? 0 : hubs.position.y;
    const scale = wheels[0]!.scale.x;
    const f = this.overFor;
    if (f[0] === lift && f[1] === hubShift && f[2] === scale) return;
    f[0] = lift;
    f[1] = hubShift;
    f[2] = scale;
    this.mesh.updateMatrix();
    _mesh.makeTranslation(0, this.mesh.parent === group ? 0 : lift, 0).multiply(this.mesh.matrix).invert();
    _a[0] = 1;
    _a[1] = 0;
    _a[2] = 0;
    for (let w = 0; w < wheels.length; w++) {
      _hub.set(WHEEL_POS[w]![0], WHEEL_POS[w]![1] + hubShift, WHEEL_POS[w]![2]).applyMatrix4(_mesh);
      _h[0] = _hub.x;
      _h[1] = _hub.y;
      _h[2] = _hub.z;
      const over = (this.over[w] ??= new Float32Array(this.rest.length / 3));
      for (let i = 0; i < this.rest.length; i += 3) {
        const c = clearOver(this.rest, i, _h, _a, scale, 0);
        over[i / 3] = c >= -REST_SLACK && c < REACH ? c : NaN;
      }
    }
  }

  /** Holds the skin over each tyre of `wheels` not in `gone` (bit i: wheel i is the world's). `skinWritten`: the mesh's positions were just written from the cage. */
  hold(group: THREE.Object3D, wheels: readonly THREE.Object3D[], gone: number, lift: number, skinWritten: boolean): void {
    this.findOver(group, wheels, lift);
    matrixIn(group, this.mesh, _mesh).invert();
    let wheelMoved = false;
    for (let w = 0; w < wheels.length; w++) {
      _wheel.multiplyMatrices(_mesh, matrixIn(group, wheels[w]!, _wheel));
      if (this.noteWheel(w, (gone >> w) & 1 ? null : _wheel.elements)) wheelMoved = true;
    }
    if (!skinWritten && !wheelMoved && this.hasWritten) return;
    const attr = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const pos = attr.array as Float32Array;
    if (skinWritten || !this.hasWritten) {
      this.written.set(pos);
      this.hasWritten = true;
    } else pos.set(this.written);
    for (let w = 0; w < wheels.length; w++) {
      if ((gone >> w) & 1) continue;
      const e = this.heldAt.subarray(w * HELD_ELEMENTS.length, (w + 1) * HELD_ELEMENTS.length);
      const scale = hypot3(e[0]!, e[1]!, e[2]!);
      for (let k = 0; k < 3; k++) {
        _a[k] = e[k]! / scale;
        _h[k] = e[3 + k]!;
      }
      this.liftOver(pos, this.over[w]!, scale);
    }
    attr.needsUpdate = true;
    computeNormalsFast(this.mesh.geometry);
  }

  /** Records wheel `w`'s axle and hub (`e`, null for a wheel gone, NaN); true when they changed since the last hold. */
  private noteWheel(w: number, e: ArrayLike<number> | null): boolean {
    let moved = false;
    for (let k = 0; k < HELD_ELEMENTS.length; k++) {
      const v = e ? e[HELD_ELEMENTS[k]!]! : NaN;
      const at = w * HELD_ELEMENTS.length + k;
      if (!Object.is(this.heldAt[at], v)) moved = true;
      this.heldAt[at] = v;
    }
    return moved;
  }

  /** Lifts each vertex of `over` standing under the tyre's surface plus its gap (`TYRE_GAP`, or its rest clearance if less: the uncrushed skin never moves) up the tyre's up axis onto it. */
  private liftOver(pos: Float32Array, over: Float32Array, scale: number): void {
    const flat = hypot2(_a[0]!, _a[2]!);
    const fx = -_a[2]! / flat;
    const fz = _a[0]! / flat;
    const ux = -fz * _a[1]!;
    const uy = fz * _a[0]! - fx * _a[2]!;
    const uz = fx * _a[1]!;
    for (let v = 0; v < over.length; v++) {
      const rested = over[v]!;
      if (Number.isNaN(rested)) continue;
      const c = clearOver(pos, v * 3, _h, _a, scale, Math.min(TYRE_GAP, rested));
      if (c >= 0) continue;
      pos[v * 3] = pos[v * 3]! - c * ux;
      pos[v * 3 + 1] = pos[v * 3 + 1]! - c * uy;
      pos[v * 3 + 2] = pos[v * 3 + 2]! - c * uz;
    }
  }
}
