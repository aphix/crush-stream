import * as THREE from "three";
import { hypot3, round4, snapshotPoints } from "../deform/physics-util.ts";
import { GRAVITY } from "../kernel/constants.ts";
import { store3f } from "../kernel/store.ts";
import { BASIS_SIZE, cameraBasis, float32Of, writeBillboard } from "./fx-matrix.ts";
import { landOn } from "../vehicle/loose-step.ts";
import { MATERIAL, tagMaterial } from "../vehicle/material-class.ts";

const _pv = new THREE.Vector3();
const STILL = new THREE.Vector3();
/** Pale blue-white: powdered glass. */
const GLASS_DUST = new THREE.Color(0.86, 0.93, 1);

/** Sliding friction of metal and glass bits on asphalt. */
const FX_GROUND_MU = 0.6;

/** FX particles rest no lower than this (m) above what they land on. */
const FX_FLOOR = 0.04;

/** An FX bit of radius `r` meets the world (`landOn`: the ground, the scene's prisms and the cars' tops, no car's own: -1). */
function landBit(pos: THREE.Vector3, vel: THREE.Vector3, r: number, dt: number): void {
  landOn(pos, vel, Math.max(r, FX_FLOOR), FX_GROUND_MU, dt, -1);
}

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Floats per instance matrix (a 4x4). */
const MATRIX_FLOATS = 16;

/** Each attribute's one reused update range: `addUpdateRange` builds a new one per call, so a running pool would allocate every frame. */
const UPLOAD_RANGES = new WeakMap<THREE.BufferAttribute, { start: number; count: number }>();

/**
 * Upload `floats` floats of `attr` from float `start` at its next draw. A range still waiting (the pool was not drawn since: three clears
 * a range once it sends it) grows to cover both, so a frame that is never drawn loses none of its writes.
 */
export function uploadRange(attr: THREE.BufferAttribute, start: number, floats: number): void {
  let range = UPLOAD_RANGES.get(attr);
  if (!range) UPLOAD_RANGES.set(attr, (range = { start: 0, count: 0 }));
  if (attr.updateRanges.length === 1 && attr.updateRanges[0] === range) {
    const end = Math.max(range.start + range.count, start + floats);
    range.start = Math.min(range.start, start);
    range.count = end - range.start;
  } else {
    attr.clearUpdateRanges();
    range.start = start;
    range.count = floats;
    attr.updateRanges[0] = range;
  }
  attr.needsUpdate = true;
}

/** Upload only the first `floats` floats of `attr` this frame: a pool packs what it draws at the front. */
function uploadFront(attr: THREE.BufferAttribute, floats: number): void {
  uploadRange(attr, 0, floats);
}

/** Instanced metal bits. Slots come from a ring; each piece owns its position, spin and size; a spent slot draws at scale 0. */
export class DebrisSystem {
  private mesh: THREE.InstancedMesh;
  private life: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  /** xyz per piece. */
  private pos: Float32Array;
  /** Euler xyz per piece. */
  private rot: Float32Array;
  private size: Float32Array;
  private dummy = new THREE.Object3D();
  private vel = new THREE.Vector3();
  private n: number;
  private cursor = 0;

  constructor(scene: THREE.Scene, n = 180) {
    this.n = n;
    const geo = new THREE.BoxGeometry(0.038, 0.016, 0.026);
    const mat = tagMaterial(new THREE.MeshStandardMaterial({
      color: 0x6a6e74,
      metalness: 0.72,
      roughness: 0.4,
    }), MATERIAL.PAINTED_METAL);
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    // three caches an InstancedMesh's bounding sphere the first time it culls (here: count 0, radius −1), so
    // camera culling hid every piece; the pieces move every frame, a sphere would need recomputing each one.
    this.mesh.frustumCulled = false;
    // Its own shadow depth material: on three's shared one, every instanced ↔ plain caster switch reselects the program.
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial();
    this.mesh.count = 0;
    this.life = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.pos = new Float32Array(n * 3);
    this.rot = new Float32Array(n * 3);
    this.size = new Float32Array(n);
    scene.add(this.mesh);
  }

  reset(): void {
    this.mesh.count = 0;
    this.cursor = 0;
    this.life.fill(0);
  }

  snapshot() {
    const items: { x: number; y: number; z: number; life: number }[] = [];
    for (let i = 0; i < this.mesh.count && items.length < 16; i++) {
      if (this.life[i]! <= 0) continue;
      items.push({
        x: round4(this.pos[i * 3]!),
        y: round4(this.pos[i * 3 + 1]!),
        z: round4(this.pos[i * 3 + 2]!),
        life: round4(this.life[i]!),
      });
    }
    return { count: items.length, items };
  }

  burst(origin: THREE.Vector3, normal: THREE.Vector3, count: number): void {
    const n = Math.min(this.n, Math.floor(count));
    for (let k = 0; k < n; k++) {
      // Oldest slot first: a new burst never cuts or moves pieces still in the air unless the ring is full.
      const i = this.cursor;
      this.cursor = (i + 1) % this.n;
      this.mesh.count = Math.max(this.mesh.count, i + 1);
      this.life[i] = 0.9 + Math.random() * 1.5;
      const side = Math.random() - 0.5;
      this.vx[i] = -normal.x * (2 + Math.random() * 6) + (Math.random() - 0.5) * 5 + normal.z * side * 4;
      this.vy[i] = 1.4 + Math.random() * 4.2;
      this.vz[i] = -normal.z * (2 + Math.random() * 6) + (Math.random() - 0.5) * 5 - normal.x * side * 4;
      this.pos[i * 3] = origin.x;
      this.pos[i * 3 + 1] = origin.y + 0.08;
      this.pos[i * 3 + 2] = origin.z;
      this.rot[i * 3] = Math.random() * 3;
      this.rot[i * 3 + 1] = Math.random() * 3;
      this.rot[i * 3 + 2] = Math.random() * 3;
      this.size[i] = 0.45 + Math.random() * 0.7;
      this.place(i);
    }
    uploadFront(this.mesh.instanceMatrix, this.mesh.count * MATRIX_FLOATS);
  }

  private place(i: number): void {
    const d = this.dummy;
    d.position.fromArray(this.pos, i * 3);
    d.rotation.set(this.rot[i * 3]!, this.rot[i * 3 + 1]!, this.rot[i * 3 + 2]!);
    d.scale.setScalar(this.size[i]!);
    d.updateMatrix();
    this.mesh.setMatrixAt(i, d.matrix);
  }

  update(dt: number): void {
    if (this.mesh.count === 0) return;
    let any = false;
    const p = this.dummy.position;
    for (let i = 0; i < this.mesh.count; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        this.mesh.setMatrixAt(i, HIDDEN);
        continue;
      }
      any = true;
      this.vy[i]! -= GRAVITY * dt;
      p.fromArray(this.pos, i * 3);
      p.x += this.vx[i]! * dt;
      p.y += this.vy[i]! * dt;
      p.z += this.vz[i]! * dt;
      this.vel.set(this.vx[i]!, this.vy[i]!, this.vz[i]!);
      landBit(p, this.vel, 0.03, dt);
      store3f(this.pos, i * 3, p);
      this.vx[i] = this.vel.x;
      this.vy[i] = this.vel.y;
      this.vz[i] = this.vel.z;
      this.rot[i * 3]! += dt * 5;
      this.rot[i * 3 + 1]! += dt * 3.2;
      this.place(i);
    }
    uploadFront(this.mesh.instanceMatrix, this.mesh.count * MATRIX_FLOATS);
    if (!any) this.reset();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.dispose();
  }
}

export function makeDotTexture(color: string, glow: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, color);
  g.addColorStop(0.35, glow);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

type DotLook = {
  core: string;
  glow: string;
  size: number;
  opacity: number;
  /** Downward accel (m/s²). */
  gravity: number;
  /** Collision radius the bit meets the world with (`landBit`). */
  radius: number;
  /** True: `packExtra` runs for each packed dot. Default false. */
  hooked?: boolean;
};

/** Ring buffer of additive billboard dots that fall and land on the world (`landBit`). The GPU draws only the live ones, packed from slot 0 by `step`: a dead dot is no pixel, a point sprite never draws smaller than one. */
class DotPoints {
  protected readonly pos: Float32Array;
  protected readonly vx: Float32Array;
  protected readonly vy: Float32Array;
  protected readonly vz: Float32Array;
  protected readonly life: Float32Array;
  protected readonly n: number;
  protected readonly points: THREE.Points;
  protected readonly geo: THREE.BufferGeometry;
  /** What the GPU reads: the live dots' positions packed from the front by `step`. */
  protected readonly drawPos: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  /** Dots the last `step` packed. */
  protected liveCount = 0;
  /** Whether `step` calls `packExtra` for each packed dot. */
  private readonly hooked: boolean;
  private tmp = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private cursor = 0;
  protected anyAlive = false;
  private gravity: number;
  private radius: number;

  constructor(scene: THREE.Scene, n: number, look: DotLook) {
    this.n = n;
    this.gravity = look.gravity;
    this.radius = look.radius;
    this.pos = new Float32Array(n * 3);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.geo = new THREE.BufferGeometry();
    this.drawPos = new Float32Array(n * 3);
    this.posAttr = new THREE.BufferAttribute(this.drawPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posAttr);
    this.hooked = look.hooked ?? false;
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      map: makeDotTexture(look.core, look.glow),
      color: 0xffffff,
      size: look.size,
      transparent: true,
      opacity: look.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  reset(): void {
    this.life.fill(0);
    this.cursor = 0;
    this.anyAlive = false;
    this.liveCount = 0;
    this.geo.setDrawRange(0, 0);
  }

  /** Oldest ring slot; the caller fills pos/vel/life for it. */
  protected claim(): number {
    const k = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    return k;
  }

  /** `spawned` freshly claimed slots join the next `update`'s pass. */
  protected commit(spawned: number): void {
    if (spawned > 0) this.anyAlive = true;
  }

  update(dt: number): void {
    if (!this.anyAlive) return;
    this.step(dt);
  }

  /** A subclass's per-dot row (`hooked`): called with the ring slot `i` of a surviving dot and the packed row `live` it was just written to. */
  protected packExtra(_i: number, _live: number): void {}

  /**
   * Age every live dot by `dt`, move it and pack the survivors (positions, tints, `packExtra`'s rows) from the front in ring order, as the GPU
   * draws them: the one pass over the ring a frame. `anyAlive` says whether any dot was alive going in.
   */
  protected step(dt: number): void {
    let any = false;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) continue;
      this.tmp.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
      this.vel.set(this.vx[i]!, this.vy[i]!, this.vz[i]!);
      this.tmp.addScaledVector(this.vel, dt);
      this.vel.y -= this.gravity * dt;
      landBit(this.tmp, this.vel, this.radius, dt);
      this.pos[i * 3] = this.tmp.x;
      this.pos[i * 3 + 1] = this.tmp.y;
      this.pos[i * 3 + 2] = this.tmp.z;
      this.vx[i] = this.vel.x;
      this.vy[i] = this.vel.y;
      this.vz[i] = this.vel.z;
      this.drawPos[live * 3] = this.pos[i * 3]!;
      this.drawPos[live * 3 + 1] = this.pos[i * 3 + 1]!;
      this.drawPos[live * 3 + 2] = this.pos[i * 3 + 2]!;
      if (this.hooked) this.packExtra(i, live);
      live++;
    }
    this.anyAlive = any;
    this.liveCount = live;
    this.geo.setDrawRange(0, live);
    if (live === 0) return;
    uploadFront(this.posAttr, live * 3);
  }

  /** HDR colour multiplier: above 1 the dots feed the bloom pass (cinematic tiers); 1 is the plain look. */
  glow(k: number): void {
    (this.points.material as THREE.PointsMaterial).color.setScalar(k);
  }

  dispose(): void {
    this.geo.dispose();
    const mat = this.points.material as THREE.PointsMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

/** Spark streak length: this many seconds of travel behind each spark. */
const STREAK_S = 0.045;

export class SparkSystem extends DotPoints {
  private readonly streakPos: Float32Array;
  private readonly streakCol: Float32Array;
  private readonly streakPosAttr: THREE.BufferAttribute;
  private readonly streakColAttr: THREE.BufferAttribute;
  private readonly streakGeo = new THREE.BufferGeometry();
  private readonly streaks: THREE.LineSegments;

  constructor(scene: THREE.Scene, n = 480) {
    super(scene, n, {
      core: "rgba(255,248,220,1)",
      glow: "rgba(255,170,70,0.7)",
      size: 0.12,
      opacity: 0.95,
      gravity: 6.5,
      radius: 0.025,
      hooked: true,
    });
    this.streakPos = new Float32Array(n * 6);
    this.streakCol = new Float32Array(n * 6);
    this.streakPosAttr = new THREE.BufferAttribute(this.streakPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.streakColAttr = new THREE.BufferAttribute(this.streakCol, 3).setUsage(THREE.DynamicDrawUsage);
    this.streakGeo.setAttribute("position", this.streakPosAttr);
    this.streakGeo.setAttribute("color", this.streakColAttr);
    this.streaks = new THREE.LineSegments(
      this.streakGeo,
      new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    );
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    scene.add(this.streaks);
  }

  /** Motion streaks: a hot line from each spark back along its velocity, fading to nothing (cinematic tiers). */
  set streaked(on: boolean) {
    this.streaks.visible = on;
  }

  override update(dt: number): void {
    super.update(dt);
    if (!this.streaks.visible) return;
    this.streakGeo.setDrawRange(0, this.liveCount * 2);
    if (this.liveCount === 0) return;
    uploadFront(this.streakPosAttr, this.liveCount * 6);
    uploadFront(this.streakColAttr, this.liveCount * 6);
  }

  protected override packExtra(i: number, live: number): void {
    if (!this.streaks.visible) return;
    const p = this.streakPos;
    const c = this.streakCol;
    const o = live * 6;
    const x = this.pos[i * 3]!;
    const y = this.pos[i * 3 + 1]!;
    const z = this.pos[i * 3 + 2]!;
    p[o] = x;
    p[o + 1] = y;
    p[o + 2] = z;
    p[o + 3] = x - this.vx[i]! * STREAK_S;
    p[o + 4] = Math.max(0.02, y - this.vy[i]! * STREAK_S);
    p[o + 5] = z - this.vz[i]! * STREAK_S;
    const hot = Math.min(1, this.life[i]! * 4) * 3.2;
    c[o] = hot;
    c[o + 1] = hot * 0.62;
    c[o + 2] = hot * 0.24;
    c[o + 3] = 0;
    c[o + 4] = 0;
    c[o + 5] = 0;
  }

  override reset(): void {
    super.reset();
    this.streakGeo.setDrawRange(0, 0);
  }

  override dispose(): void {
    super.dispose();
    this.streakGeo.dispose();
    (this.streaks.material as THREE.Material).dispose();
  }

  poof(origin: THREE.Vector3, normal: THREE.Vector3, count: number): void {
    const n = Math.min(this.n, Math.max(0, Math.floor(count)));
    for (let i = 0; i < n; i++) {
      const k = this.claim();
      const ox = (Math.random() - 0.5) * 2;
      const oy = Math.random();
      const oz = (Math.random() - 0.5) * 2;
      const mag = hypot3(ox, oy, oz) || 1;
      this.pos[k * 3] = origin.x + (Math.random() - 0.5) * 0.22;
      this.pos[k * 3 + 1] = Math.max(0.08, origin.y) + Math.random() * 0.12;
      this.pos[k * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.22;
      const speed = 1.4 + Math.random() * 3.2;
      this.vx[k] = (ox / mag) * speed - normal.x * 0.6;
      this.vy[k] = (oy / mag) * speed * 0.85 + 1.1;
      this.vz[k] = (oz / mag) * speed - normal.z * 0.6;
      this.life[k] = 0.28 + Math.random() * 0.35;
    }
    this.commit(n);
  }

  snapshot() {
    return snapshotPoints(this.pos, null, null, this.life, true);
  }
}

export class GlassDotSystem extends DotPoints {
  /** 640: a head-on's two `shatter`s (2 × 260 at full density) on top of its panes' bursts. */
  constructor(scene: THREE.Scene, n = 640) {
    super(scene, n, {
      core: "rgba(255,255,255,1)",
      glow: "rgba(210,230,245,0.55)",
      size: 0.042,
      opacity: 0.9,
      gravity: GRAVITY,
      radius: 0.02,
    });
  }

  burst(origin: THREE.Vector3, inherit: THREE.Vector3, count: number): void {
    const n = Math.min(this.n, Math.floor(count));
    for (let i = 0; i < n; i++) {
      const k = this.claim();
      this.pos[k * 3] = origin.x + (Math.random() - 0.5) * 0.55;
      this.pos[k * 3 + 1] = Math.max(0.12, origin.y) + (Math.random() - 0.2) * 0.28;
      this.pos[k * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.4;
      this.vx[k] = inherit.x * 0.85 + (Math.random() - 0.5) * 5.5;
      this.vy[k] = inherit.y * 0.55 + 1.4 + Math.random() * 3.6;
      this.vz[k] = inherit.z * 0.85 + (Math.random() - 0.5) * 5.5;
      this.life[k] = 1.1 + Math.random() * 1.1;
    }
    this.commit(n);
  }

  /**
   * A thrown driver's cover (owner: heavy and very short): `count` shards packed through the box `half` (m, in frame
   * `q`) round `origin`, flung out of it on top of `inherit`, gone in 0.15–0.3 s of FX time. FX time runs at least at
   * 0.6 × wall, so the slow-mo holds them half a second at most.
   */
  shatter(origin: THREE.Vector3, q: THREE.Quaternion, half: THREE.Vector3, inherit: THREE.Vector3, count: number): void {
    const n = Math.min(this.n, Math.floor(count));
    for (let i = 0; i < n; i++) {
      const k = this.claim();
      _pv.set((Math.random() * 2 - 1) * half.x, (Math.random() * 2 - 1) * half.y, (Math.random() * 2 - 1) * half.z).applyQuaternion(q);
      this.pos[k * 3] = origin.x + _pv.x;
      this.pos[k * 3 + 1] = Math.max(0.12, origin.y + _pv.y);
      this.pos[k * 3 + 2] = origin.z + _pv.z;
      this.vx[k] = inherit.x + _pv.x * 3;
      this.vy[k] = inherit.y + _pv.y * 3 + 1.5;
      this.vz[k] = inherit.z + _pv.z * 3;
      this.life[k] = 0.15 + Math.random() * 0.15;
    }
    this.commit(n);
  }
}

export class TireSmokeSystem {
  private mesh: THREE.InstancedMesh;
  private px: Float32Array;
  private py: Float32Array;
  private pz: Float32Array;
  private vx: Float32Array;
  private vy: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  /** The camera's rotation, read once a frame (`cameraBasis`). */
  private readonly basis = new Float64Array(BASIS_SIZE);
  private readonly matrices: Float32Array;
  private n: number;
  private cursor = 0;
  private anyAlive = false;
  private readonly tint: Float32Array;
  /** Scene light on the (unlit) smoke: 1 by day, low at night. */
  shade = 1;
  /** How much a puff swells over its life (× its size at birth): crash plumes billow, tyre smoke stays a wisp. */
  private readonly grow: number;

  /** `soft`: a thin, wide puff for tyre smoke (cinematic tiers) instead of the dense crash plume. */
  constructor(scene: THREE.Scene, n = 420, soft = false) {
    this.n = n;
    this.grow = soft ? 0.7 : 1.8;
    this.px = new Float32Array(n);
    this.py = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.vz = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size = new Float32Array(n);
    this.tint = new Float32Array(n * 3).fill(1);
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: soft
        ? makeDotTexture("rgba(232,232,228,0.42)", "rgba(160,160,156,0.14)")
        : makeDotTexture("rgba(210,210,206,0.95)", "rgba(70,70,68,0.25)"),
      transparent: true,
      opacity: soft ? 0.25 : 0.85,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.matrices = float32Of(this.mesh.instanceMatrix);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.reset();
  }

  reset(): void {
    this.life.fill(0);
    this.cursor = 0;
    this.anyAlive = this.mesh.visible = false;
    this.mesh.count = 0;
  }

  /** Tyre smoke: thin, low-rising, short-lived wisps; `tint` colours it (dust on dirt, turf on grass), white when omitted. */
  emitAt(origin: THREE.Vector3, inherit: THREE.Vector3, count: number, tint?: THREE.Color): void {
    this.spawn(origin, inherit, count, 0.7, 1.13, 0.3, tint, 0.08, 0.73);
  }

  plume(origin: THREE.Vector3, inherit: THREE.Vector3, count: number): void {
    this.spawn(origin, inherit, count, 0.55, 2.2, 1.4);
  }

  /** Light, steady thread after the block is dead. Not a crash burst. */
  wisp(origin: THREE.Vector3, inherit: THREE.Vector3): void {
    this.spawn(origin, inherit, 1, 0.22, 1.5, 0.65);
  }

  /** A car vaporizing below the fleet disc: a big, slow, long puff wherever it is (no ground clamp). */
  vapour(origin: THREE.Vector3, inherit: THREE.Vector3, count: number): void {
    this.spawn(origin, inherit, count, 2, 2.6, 0.8, undefined, -Infinity);
  }

  /**
   * A thrown driver's glass dust over his way out, round `GlassDotSystem.shatter`'s shards: `count` big pale puffs
   * through the box `half` (m, in frame `q`) round `origin`, gone in 0.2–0.35 s of FX time.
   */
  glassDust(origin: THREE.Vector3, q: THREE.Quaternion, half: THREE.Vector3, count: number): void {
    for (let i = 0; i < count; i++) {
      _pv.set((Math.random() * 2 - 1) * half.x, (Math.random() * 2 - 1) * half.y, (Math.random() * 2 - 1) * half.z).applyQuaternion(q).add(origin);
      this.spawn(_pv, STILL, 1, 0.5, 0.2, 0.3, GLASS_DUST, 0.08, 0.15);
    }
  }

  private spawn(
    origin: THREE.Vector3,
    inherit: THREE.Vector3,
    count: number,
    size: number,
    life: number,
    rise: number,
    tint?: THREE.Color,
    floor = 0.08,
    lifeSpread = 1.1,
  ): void {
    const n = Math.min(this.n, Math.max(0, Math.floor(count)));
    for (let i = 0; i < n; i++) {
      const k = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      this.px[k] = origin.x + (Math.random() - 0.5) * 0.35;
      this.py[k] = Math.max(floor, origin.y);
      this.pz[k] = origin.z + (Math.random() - 0.5) * 0.35;
      this.vx[k] = inherit.x * 0.04 + (Math.random() - 0.5) * 0.22;
      this.vy[k] = rise + Math.random() * 0.7;
      this.vz[k] = inherit.z * 0.04 + (Math.random() - 0.5) * 0.22;
      const L = life + Math.random() * lifeSpread;
      this.life[k] = L;
      this.maxLife[k] = L;
      this.size[k] = size + Math.random() * 0.4;
      this.tint[k * 3] = tint ? tint.r : 1;
      this.tint[k * 3 + 1] = tint ? tint.g : 1;
      this.tint[k * 3 + 2] = tint ? tint.b : 1;
    }
    if (n > 0) this.anyAlive = this.mesh.visible = true;
  }

  snapshot() {
    return snapshotPoints(this.px, this.py, this.pz, this.life, false);
  }

  update(dt: number, camera: THREE.Camera): void {
    if (!this.anyAlive) return;
    const damp = Math.exp(-0.7 * dt);
    const basis = this.basis;
    cameraBasis(camera.quaternion, basis);
    const matrices = this.matrices;
    let live = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const fade = Math.max(0, this.life[i]! / Math.max(this.maxLife[i]!, 1e-4));
      if (fade <= 0) {
        this.life[i] = 0;
        continue;
      }
      this.px[i]! += this.vx[i]! * dt;
      this.py[i]! += this.vy[i]! * dt;
      this.pz[i]! += this.vz[i]! * dt;
      this.vy[i]! += 0.55 * dt;
      this.vx[i]! *= damp;
      this.vz[i]! *= damp;
      // Packed in slot order, the order the ring drew them in: the alpha-blended puffs composite as before.
      writeBillboard(matrices, live * MATRIX_FLOATS, basis, this.size[i]! * (0.7 + (1 - fade) * this.grow), this.px[i]!, this.py[i]!, this.pz[i]!);
      const g = (0.55 + fade * 0.4) * this.shade;
      this.mesh.setColorAt(live, _smokeColor.setRGB(g * this.tint[i * 3]!, g * this.tint[i * 3 + 1]!, g * 0.96 * this.tint[i * 3 + 2]!));
      live++;
    }
    this.mesh.count = live;
    this.anyAlive = this.mesh.visible = live > 0;
    if (live === 0) return;
    uploadFront(this.mesh.instanceMatrix, live * MATRIX_FLOATS);
    uploadFront(this.mesh.instanceColor!, live * 3);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const mat = this.mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}

const _smokeColor = new THREE.Color();
