import * as THREE from "three";

/** How long (s) a muzzle flash and a shot's tracer show (a frame or three at 60 Hz); the most tracers in the air at once. */
const FLASH_S = 0.05;
const TRACER_S = 0.07;
const TRACERS = 24;
/** A muzzle flash's radius (m) and its colour; a tracer's colour (sRGB). */
const FLASH_R = 0.14;
const FLASH_RGB = 0xfff1b8;
const TRACER_RGB = 0xffcf6a;

const _m = new THREE.Matrix4();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** Muzzle flashes and tracers: one flash a slot, lit for `FLASH_S` at that slot's muzzle; `TRACERS` tracer lines, each drawn for `TRACER_S` from the muzzle to where the shot went. The lawn guards' and the player's. */
export class ShotFx {
  readonly group = new THREE.Group();
  /** Each slot's muzzle (x, y, z), written by whoever poses the gun. */
  readonly muzzles: Float32Array;
  private readonly flashes: THREE.InstancedMesh;
  private readonly tracers: THREE.LineSegments;
  private readonly tracerAt = new Float32Array(TRACERS * 6);
  private readonly tracerAge = new Float32Array(TRACERS).fill(Infinity);
  private readonly flashAge: Float32Array;
  private tracerNext = 0;
  /** Whether a flash or a tracer is still showing: only then are their buffers aged and re-sent. */
  private showing = false;

  constructor(slots: number) {
    this.flashes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(FLASH_R), new THREE.MeshBasicMaterial({ color: FLASH_RGB, toneMapped: false }), slots);
    this.flashes.frustumCulled = false;
    for (let i = 0; i < slots; i++) this.flashes.setMatrixAt(i, HIDDEN);
    this.flashAge = new Float32Array(slots).fill(Infinity);
    this.muzzles = new Float32Array(slots * 3);
    const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(this.tracerAt, 3));
    this.tracers = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: TRACER_RGB, toneMapped: false, transparent: true, opacity: 0.85 }));
    this.tracers.frustumCulled = false;
    this.group.add(this.flashes, this.tracers);
    this.flashes.visible = false;
    this.tracers.visible = false;
  }

  setMuzzle(slot: number, x: number, y: number, z: number): void {
    this.muzzles[slot * 3] = x;
    this.muzzles[slot * 3 + 1] = y;
    this.muzzles[slot * 3 + 2] = z;
  }

  /** Slot `slot` fires at (x, y, z): its flash lights and a tracer runs from its muzzle. */
  fire(slot: number, x: number, y: number, z: number): void {
    this.showing = true;
    this.flashAge[slot] = 0;
    const k = this.tracerNext;
    this.tracerNext = (k + 1) % TRACERS;
    this.tracerAge[k] = 0;
    for (let i = 0; i < 3; i++) this.tracerAt[k * 6 + i] = this.muzzles[slot * 3 + i]!;
    this.tracerAt[k * 6 + 3] = x;
    this.tracerAt[k * 6 + 4] = y;
    this.tracerAt[k * 6 + 5] = z;
  }

  /** Ages the flashes and tracers by `dt` s. */
  update(dt: number): void {
    if (!this.showing) return;
    let flashing = false;
    for (let s = 0; s < this.flashAge.length; s++) {
      this.flashAge[s] = this.flashAge[s]! + dt;
      const on = this.flashAge[s]! <= FLASH_S;
      flashing ||= on;
      this.flashes.setMatrixAt(s, on ? _m.makeTranslation(this.muzzles[s * 3]!, this.muzzles[s * 3 + 1]!, this.muzzles[s * 3 + 2]!) : HIDDEN);
    }
    this.flashes.instanceMatrix.needsUpdate = true;
    let tracing = false;
    for (let k = 0; k < TRACERS; k++) {
      this.tracerAge[k] = this.tracerAge[k]! + dt;
      if (this.tracerAge[k]! > TRACER_S) this.tracerAt.fill(0, k * 6, k * 6 + 6);
      else tracing = true;
    }
    this.tracers.geometry.getAttribute("position").needsUpdate = true;
    this.flashes.visible = flashing;
    this.tracers.visible = tracing;
    this.showing = flashing || tracing;
  }

  /** Whether any flash or tracer is drawn. */
  get firing(): boolean {
    return this.showing;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.flashes.geometry.dispose();
    (this.flashes.material as THREE.Material).dispose();
    this.flashes.dispose();
    this.tracers.geometry.dispose();
    (this.tracers.material as THREE.Material).dispose();
  }
}
