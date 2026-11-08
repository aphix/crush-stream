import * as THREE from "three";
import { hypot2 } from "../kernel/physics-core.js";
import { MAT } from "../kernel/material-ids.ts";
import { PREFABS, type PrefabId } from "../world/catalog.ts";
import { PREFAB } from "../world/constants.ts";
import type { Placed } from "../world/placements.ts";
import { uploadRange } from "./engine-fx.ts";
import { painted } from "./prefab-pieces.ts";
import { foliageTint } from "./prefabs-foliage.ts";
import type { PropTumble } from "./prop-tumble.ts";

/**
 * The bushes and flower beds a car drives through go in a puff of leaves. Drawn only: nothing here reaches the sim, and which ones
 * go is a function of the cars' poses alone, so a replay's cars puff the same ones.
 */

/** The part of a car the poof reads. */
export interface FoliageCar {
  readonly group: Pick<THREE.Object3D, "visible" | "position" | "quaternion">;
  readonly velocity: THREE.Vector3;
  readonly frame: { readonly half: { readonly x: number }; readonly footHalfL: number };
}

/** Hash-grid cell (m): a car's footprint spans two or three of them a side. */
const CELL = 4;
/** A car slower than this (m/s) is parked or creeping, not driving through. */
const MIN_SPEED = 2;
/** A car this far (m) above or below a plant's base is on a deck or in the air, and passes over. */
const REACH_Y = 1.2;
/** Leaves in a puff: a bed throws more than a bush. */
export const PIECES: Partial<Record<PrefabId, number>> = { [PREFAB.bush]: 9, [PREFAB.flowers]: 14 };
/** Leaves in flight at once (a ring: the oldest go first). */
const POOL = 256;
/** A leaf's lifetime (s): this much plus up to `LIFE_SPREAD` more. */
const LIFE = 0.9;
const LIFE_SPREAD = 0.9;
/** A leaf shrinks away over its last this many seconds. */
const FADE = 0.3;
/** Leaf side (m) and the spread of it. */
const LEAF = 0.11;
const LEAF_SPREAD = 0.1;
/** Downward acceleration (m/s²) of a falling leaf (a leaf is light: well under gravity) and the share of its sideways speed it keeps each second. */
const LEAF_FALL = 5;
const LEAF_DRAG = 0.3;
/** How far a leaf rests above the ground it lands on (m). */
const LEAF_REST = 0.02;
/** A leaf takes this share of the car's own speed along, and throws sideways up to this (m/s), and up this much. */
const CARRY = 0.35;
const SCATTER = 3;
const LOFT = 1.5;
const LOFT_SPREAD = 2.5;
/** A leaf's colour is the plant's, shaded by up to this either way. */
const SHADE_SPREAD = 0.5;
/** How fast a leaf tumbles about x and y in the air (rad/s). */
const TUMBLE_X = 4;
const TUMBLE_Y = 2.5;
/** Floats per instance matrix. */
const FLOATS = 16;

const _col = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

function bucket(ix: number, iz: number, mask: number): number {
  return (Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663)) & mask;
}

export class FoliagePoof {
  /** The leaves in the air, to be added to the scene where the plants are drawn. */
  readonly leaves: THREE.InstancedMesh;
  private readonly placed: readonly Placed[];
  private readonly tumble: Pick<PropTumble, "hide" | "reset">;
  /** Per plant: its placement index, base position and hit radius (m). */
  private readonly ids: Int32Array;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly z: Float32Array;
  private readonly r: Float32Array;
  private readonly gone: Uint8Array;
  /** The plants by hashed grid cell: bucket b holds `items[start[b]..start[b + 1])`. A bucket may hold other cells' plants (the distance test settles it). */
  private readonly start: Int32Array;
  private readonly items: Int32Array;
  private readonly mask: number;
  /** The biggest plant's hit radius: how far past a car's footprint a plant can reach it. */
  private readonly reach: number;
  private hidden = 0;
  /** Plants the last frame measured a car against. */
  private tests = 0;
  private readonly life = new Float32Array(POOL);
  private readonly pos = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly rot = new Float32Array(POOL * 3);
  private readonly size = new Float32Array(POOL);
  private readonly floor = new Float32Array(POOL);
  private readonly dummy = new THREE.Object3D();
  private cursor = 0;
  /** One past the highest ring slot used since the leaves last emptied. */
  private top = 0;

  /** The plants among `placed` (bushes and flower beds), hidden in `tumble` (which draws `placed`) when a car drives through; the leaves draw in `material`. */
  constructor(placed: readonly Placed[], tumble: Pick<PropTumble, "hide" | "reset">, material: THREE.Material) {
    this.placed = placed;
    this.tumble = tumble;
    const plants: number[] = [];
    for (let i = 0; i < placed.length; i++) if (PIECES[placed[i]!.prefab] !== undefined) plants.push(i);
    const n = plants.length;
    this.ids = Int32Array.from(plants);
    this.x = new Float32Array(n);
    this.y = new Float32Array(n);
    this.z = new Float32Array(n);
    this.r = new Float32Array(n);
    this.gone = new Uint8Array(n);
    let reach = 0;
    for (let m = 0; m < n; m++) {
      const p = placed[plants[m]!]!;
      const [w, , d] = PREFABS[p.prefab].size;
      this.x[m] = p.x;
      this.y[m] = p.y;
      this.z[m] = p.z;
      // The mean half extent of its plan.
      this.r[m] = (w * p.sx + d * p.sz) / 4;
      reach = Math.max(reach, this.r[m]!);
    }
    this.reach = reach;
    let buckets = 16;
    while (buckets < 2 * n) buckets *= 2;
    this.mask = buckets - 1;
    this.start = new Int32Array(buckets + 1);
    this.items = new Int32Array(n);
    const home = new Int32Array(n);
    for (let m = 0; m < n; m++) {
      home[m] = bucket(Math.floor(this.x[m]! / CELL), Math.floor(this.z[m]! / CELL), this.mask);
      this.start[home[m]! + 1]!++;
    }
    for (let b = 0; b < buckets; b++) this.start[b + 1]! += this.start[b]!;
    const fill = this.start.slice(0, buckets);
    for (let m = 0; m < n; m++) this.items[fill[home[m]!]!++] = m;

    const quad = new THREE.PlaneGeometry(1, 1);
    this.leaves = new THREE.InstancedMesh(painted([[quad, 0xffffff, MAT.CONIFER_FOLIAGE], [quad.clone().rotateY(Math.PI), 0xffffff, MAT.CONIFER_FOLIAGE]]), material, POOL);
    this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leaves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.leaves.count = 0;
    // The leaves move every frame: a bounding sphere cached at count 0 would cull them all.
    this.leaves.frustumCulled = false;
  }

  /** Every plant back and every leaf gone (a restart). */
  reset(): void {
    this.tumble.reset();
    this.gone.fill(0);
    this.hidden = 0;
    this.life.fill(0);
    this.cursor = 0;
    this.top = 0;
    this.leaves.count = 0;
  }

  /** What stands and flies: plants puffed away, leaves alive, and plants the last frame tested a car against. */
  snapshot(): { hidden: number; leaves: number; tests: number } {
    let leaves = 0;
    for (let i = 0; i < this.top; i++) if (this.life[i]! > 0) leaves++;
    return { hidden: this.hidden, leaves, tests: this.tests };
  }

  /** Every car through a plant puffs it (`density` scales the leaves); the leaves in the air age by `dt` s. Once per frame, after the cars are posed. */
  frame(cars: readonly FoliageCar[], dt: number, density = 1): void {
    this.tests = 0;
    if (this.ids.length > 0) for (let c = 0; c < cars.length; c++) this.drive(cars[c]!, density);
    this.fly(dt);
  }

  /** Puffs every plant the footprint of `car` (a box in plan) is on. */
  private drive(car: FoliageCar, density: number): void {
    const v = car.velocity;
    if (!car.group.visible || v.x * v.x + v.z * v.z < MIN_SPEED * MIN_SPEED) return;
    const p = car.group.position;
    const q = car.group.quaternion;
    // The car's nose and its left, flat on the ground.
    let fx = 2 * (q.x * q.z + q.w * q.y);
    let fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const len = hypot2(fx, fz);
    if (len < 1e-3) return;
    fx /= len;
    fz /= len;
    const hl = car.frame.footHalfL;
    const hw = car.frame.half.x;
    const ex = Math.abs(fx) * hl + Math.abs(fz) * hw + this.reach;
    const ez = Math.abs(fz) * hl + Math.abs(fx) * hw + this.reach;
    const ix1 = Math.floor((p.x + ex) / CELL);
    const iz1 = Math.floor((p.z + ez) / CELL);
    for (let ix = Math.floor((p.x - ex) / CELL); ix <= ix1; ix++) {
      for (let iz = Math.floor((p.z - ez) / CELL); iz <= iz1; iz++) {
        const b = bucket(ix, iz, this.mask);
        for (let s = this.start[b]!; s < this.start[b + 1]!; s++) {
          const m = this.items[s]!;
          if (this.gone[m]) continue;
          this.tests++;
          const dx = this.x[m]! - p.x;
          const dz = this.z[m]! - p.z;
          const r = this.r[m]!;
          if (Math.abs(dx * fx + dz * fz) < hl + r && Math.abs(dx * fz - dz * fx) < hw + r && Math.abs(this.y[m]! - p.y) < REACH_Y) this.puff(m, v, density);
        }
      }
    }
  }

  /** Plant `m` hidden, and its leaves thrown in its colour, carried along `v`. */
  private puff(m: number, v: THREE.Vector3, density: number): void {
    this.gone[m] = 1;
    this.hidden++;
    const id = this.ids[m]!;
    const plant = this.placed[id]!;
    const prefab = plant.prefab;
    this.tumble.hide(id);
    foliageTint(prefab, id, _col);
    const height = PREFABS[prefab].size[1] * plant.sy;
    const n = Math.floor(PIECES[prefab]! * density);
    const colours = this.leaves.instanceColor!;
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (i + 1) % POOL;
      this.top = Math.max(this.top, i + 1);
      this.life[i] = LIFE + Math.random() * LIFE_SPREAD;
      this.pos[i * 3] = this.x[m]! + (Math.random() - 0.5) * this.r[m]! * 2;
      this.pos[i * 3 + 1] = this.y[m]! + Math.random() * height;
      this.pos[i * 3 + 2] = this.z[m]! + (Math.random() - 0.5) * this.r[m]! * 2;
      this.vel[i * 3] = v.x * CARRY + (Math.random() - 0.5) * SCATTER;
      this.vel[i * 3 + 1] = LOFT + Math.random() * LOFT_SPREAD;
      this.vel[i * 3 + 2] = v.z * CARRY + (Math.random() - 0.5) * SCATTER;
      this.rot[i * 3] = Math.random() * 3;
      this.rot[i * 3 + 1] = Math.random() * 3;
      this.rot[i * 3 + 2] = Math.random() * 3;
      this.size[i] = LEAF + Math.random() * LEAF_SPREAD;
      this.floor[i] = this.y[m]! + LEAF_REST;
      const shade = 1 + (Math.random() - 0.5) * SHADE_SPREAD;
      colours.setXYZ(i, _col.r * shade, _col.g * shade, _col.b * shade);
      this.place(i, 1);
    }
    colours.needsUpdate = true;
    this.leaves.count = this.top;
  }

  private place(i: number, fade: number): void {
    const d = this.dummy;
    d.position.fromArray(this.pos, i * 3);
    d.rotation.set(this.rot[i * 3]!, this.rot[i * 3 + 1]!, this.rot[i * 3 + 2]!);
    d.scale.setScalar(this.size[i]! * fade);
    d.updateMatrix();
    this.leaves.setMatrixAt(i, d.matrix);
  }

  private fly(dt: number): void {
    if (this.top === 0) return;
    const drag = Math.pow(LEAF_DRAG, dt);
    let any = false;
    for (let i = 0; i < this.top; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.leaves.setMatrixAt(i, ZERO);
        continue;
      }
      any = true;
      const o = i * 3;
      const landed = this.pos[o + 1]! <= this.floor[i]!;
      if (!landed) {
        this.vel[o]! *= drag;
        this.vel[o + 2]! *= drag;
        this.vel[o + 1]! -= LEAF_FALL * dt;
        this.pos[o]! += this.vel[o]! * dt;
        this.pos[o + 1]! += this.vel[o + 1]! * dt;
        this.pos[o + 2]! += this.vel[o + 2]! * dt;
        this.rot[o]! += dt * TUMBLE_X;
        this.rot[o + 1]! += dt * TUMBLE_Y;
        if (this.pos[o + 1]! <= this.floor[i]!) this.pos[o + 1] = this.floor[i]!;
      }
      this.place(i, Math.min(1, this.life[i]! / FADE));
    }
    uploadRange(this.leaves.instanceMatrix, 0, this.top * FLOATS);
    if (!any) {
      this.top = 0;
      this.cursor = 0;
      this.leaves.count = 0;
    }
  }
}
