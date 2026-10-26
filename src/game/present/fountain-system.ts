import * as THREE from "three";
import { GRAVITY } from "../kernel/constants.ts";
import { makeDotTexture, uploadRange } from "./engine-fx.ts";

/** Jets a `FountainSystem` runs at once: a race's finish line at its fullest (2 sides x 4 rows) with room to spare for a podium's. */
export const JET_SLOTS = 16;
/** Sparks a power-1 jet throws each second at density 1 (set by eye from shots at ultra: thick enough to read as a fountain at 50 m, not a sprinkler). */
export const JET_RATE = 120;
/** Launch speed (m/s, up) of a power-1 spark: apexes from 6.3 to 13.3 m at `GRAVITY`, above the stands and the gantry; a stronger jet scales it by the root of its power (height goes with the power). */
const JET_UP_MIN = 11;
export const JET_UP_MAX = 16;
/** A spark's sideways launch speed as a share of its upward speed (a cone of about 19 degrees: a fountain's bell, not a column). */
const JET_SPREAD = 0.35;
/** Radius (m) of a jet's nozzle: sparks start scattered over it. */
const JET_NOZZLE = 0.18;
/** Seconds a spark is at full brightness before it fades out to nothing as it lands. */
export const JET_FADE_S = 0.7;
/** The most sparks one jet spawns in a single update (a stalled frame's dt must not dump a second's worth at once). */
const JET_BURST_MAX = 24;
/**
 * Each spark's launch scatter is read from a table drawn once at construction (`Math.random` boxes a number on every call, a collection
 * every few thousand sparks): LOT_ENTRIES prime so the pattern of directions repeats only after that many sparks, LOT_STRIDE floats an
 * entry: a unit direction (x, z), two radii in the unit disc (square roots of uniforms: the nozzle's and the cone's), and a speed share.
 */
const LOT_ENTRIES = 4099;
const LOT_STRIDE = 5;
/** The pool: a full ultra race (2 jets at power 1.5, 6 at 1: about 600 and 340 live sparks each) holds about 3200; the ring overwrites its oldest past 3600 (a density near 1.1). */
const FOUNTAIN_DOTS = 3600;
const JET_GOLD = new THREE.Color(1, 0.86, 0.55);
/** Fountain seconds after which every spark's birth is moved back by the clock and the clock restarts at 0: the GPU's float32 time stays fine to a fraction of a millisecond. */
export const REBASE_S = 300;

/** A float for GLSL source: always with a decimal point, never an exponent. */
const glsl = (x: number): string => x.toFixed(6);

/**
 * Ground-mounted spark fountains: a scheduled jet (`jet`) throws bright sparks up in a bell-shaped arc from a nozzle point, they fall back
 * under gravity and fade, each one gone as it is back at the nozzle's height. A spark's whole flight is a formula of its launch (origin,
 * velocity, birth time and flight time, written once into static attributes at spawn): the vertex shader works out where it is and how bright
 * from one clock uniform, advanced by the FX time (`update`'s dt: the slow-mo holds it), and culls a slot that is not in flight. The CPU
 * only spawns. No world query: cosmetic, nothing reads it back.
 */
export class FountainSystem {
  /** Share of the full spray every jet throws: the FX tier and the density knob set it (0: nothing spawns; sparks in the air still finish). */
  density = 1;
  private readonly jx = new Float32Array(JET_SLOTS);
  private readonly jy = new Float32Array(JET_SLOTS);
  private readonly jz = new Float32Array(JET_SLOTS);
  /** Seconds until the jet starts; then seconds it still runs (a spent jet has `run` 0 and its slot is free). */
  private readonly wait = new Float32Array(JET_SLOTS);
  private readonly run = new Float32Array(JET_SLOTS);
  private readonly power = new Float32Array(JET_SLOTS);
  private readonly hue = new Float32Array(JET_SLOTS * 3);
  /** Fractional sparks owed to each jet: its rate is per second, a frame spawns whole sparks. */
  private readonly owed = new Float32Array(JET_SLOTS);
  /** The launch scatter (`LOT_ENTRIES` x `LOT_STRIDE`) and the entry the next spark reads. */
  private readonly lot = new Float32Array(LOT_ENTRIES * LOT_STRIDE);
  private lotAt = 0;
  /** Each jet's lift: the square root of its power, worked out when the jet is set. */
  private readonly lift = new Float32Array(JET_SLOTS);

  /** Per ring slot, what the GPU reads, written at spawn: the nozzle point, the launch velocity, (birth, flight) in fountain seconds, the spark's colour. */
  private readonly spawnPos: Float32Array;
  private readonly spawnVel: Float32Array;
  private readonly spawnSpan: Float32Array;
  private readonly spawnHue: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly velAttr: THREE.BufferAttribute;
  private readonly spanAttr: THREE.BufferAttribute;
  private readonly hueAttr: THREE.BufferAttribute;
  private readonly n: number;
  private cursor = 0;
  /** One past the last slot spawned since the last reset: the GPU draws that many (a slot not in flight is culled in the shader). */
  private drawn = 0;
  /** The fountain clock (s): the shader's `uFxTime`. */
  private readonly clock = { value: 0 };
  /** The fountain second the last spark lands. */
  private liveUntil = 0;
  private readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();

  constructor(scene: THREE.Scene, n = FOUNTAIN_DOTS) {
    this.n = n;
    this.spawnPos = new Float32Array(n * 3);
    this.spawnVel = new Float32Array(n * 3);
    this.spawnSpan = new Float32Array(n * 2);
    this.spawnHue = new Float32Array(n * 3);
    this.posAttr = new THREE.BufferAttribute(this.spawnPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.velAttr = new THREE.BufferAttribute(this.spawnVel, 3).setUsage(THREE.DynamicDrawUsage);
    this.spanAttr = new THREE.BufferAttribute(this.spawnSpan, 2).setUsage(THREE.DynamicDrawUsage);
    this.hueAttr = new THREE.BufferAttribute(this.spawnHue, 3).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute("position", this.posAttr);
    this.geo.setAttribute("aVel", this.velAttr);
    this.geo.setAttribute("aSpan", this.spanAttr);
    this.geo.setAttribute("color", this.hueAttr);
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.PointsMaterial({
      map: makeDotTexture("rgba(255,248,220,1)", "rgba(255,170,70,0.7)"),
      color: 0xffffff,
      vertexColors: true,
      size: 0.6,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFxTime = this.clock;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec3 aVel;\nattribute vec2 aSpan;\nuniform float uFxTime;")
        .replace("#include <color_vertex>", `#include <color_vertex>\nfloat fxAge = uFxTime - aSpan.x;\nvColor.rgb *= clamp((aSpan.y - fxAge) / ${glsl(JET_FADE_S)}, 0.0, 1.0);`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>\ntransformed += aVel * fxAge;\ntransformed.y -= ${glsl(GRAVITY / 2)} * fxAge * fxAge;`)
        .replace("#include <project_vertex>", "#include <project_vertex>\nif (fxAge < 0.0 || fxAge >= aSpan.y) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);");
    };
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    scene.add(this.points);
    for (let e = 0; e < LOT_ENTRIES; e++) {
      const around = Math.random() * Math.PI * 2;
      this.lot[e * LOT_STRIDE] = Math.cos(around);
      this.lot[e * LOT_STRIDE + 1] = Math.sin(around);
      this.lot[e * LOT_STRIDE + 2] = Math.sqrt(Math.random());
      this.lot[e * LOT_STRIDE + 3] = Math.sqrt(Math.random());
      this.lot[e * LOT_STRIDE + 4] = Math.random();
    }
  }

  /**
   * A jet at (x, y, z), the ground under it: it starts `startIn` s from now (0: at once), throws for `runFor` s, and its last sparks land
   * a flight time later. `power` 1 is the plain jet; a bigger one throws more and higher. `color` tints it (default hot gold).
   * A full table (`JET_SLOTS` running jets) drops the new jet.
   */
  jet(x: number, y: number, z: number, startIn: number, runFor: number, power = 1, color: THREE.Color = JET_GOLD): void {
    let s = 0;
    while (s < JET_SLOTS && this.run[s]! > 0) s++;
    if (s === JET_SLOTS || runFor <= 0) return;
    this.jx[s] = x;
    this.jy[s] = y;
    this.jz[s] = z;
    this.wait[s] = Math.max(0, startIn);
    this.run[s] = runFor;
    this.power[s] = power;
    this.lift[s] = Math.sqrt(power);
    this.hue[s * 3] = color.r;
    this.hue[s * 3 + 1] = color.g;
    this.hue[s * 3 + 2] = color.b;
    this.owed[s] = 0;
  }

  /** Jets scheduled or running (a spent jet is not counted; sparks still in the air are not jets). */
  get jets(): number {
    let count = 0;
    for (let s = 0; s < JET_SLOTS; s++) if (this.run[s]! > 0) count++;
    return count;
  }

  /** Runs the jets for `dt` seconds of FX time, spawns what they owe, and moves the clock the shader flies the sparks by. */
  update(dt: number): void {
    const first = this.cursor;
    let spawned = 0;
    for (let s = 0; s < JET_SLOTS; s++) {
      if (this.run[s]! <= 0) continue;
      if (this.wait[s]! > 0) {
        this.wait[s]! -= dt;
        continue;
      }
      const on = Math.min(dt, this.run[s]!);
      this.run[s]! -= dt;
      this.owed[s]! += on * JET_RATE * this.power[s]! * this.density;
      const count = Math.min(JET_BURST_MAX, Math.floor(this.owed[s]!));
      this.owed[s]! -= count;
      if (count > 0) {
        this.spray(s, count);
        spawned += count;
      }
    }
    if (spawned > 0) this.publishSpawned(first, spawned);
    this.points.visible = this.clock.value < this.liveUntil;
    this.clock.value += dt;
    if (this.clock.value > REBASE_S) this.rebase();
  }

  reset(): void {
    this.run.fill(0);
    this.wait.fill(0);
    this.spawnSpan.fill(0);
    this.cursor = 0;
    this.drawn = 0;
    this.liveUntil = 0;
    this.geo.setDrawRange(0, 0);
    this.points.visible = false;
  }

  private spray(s: number, count: number): void {
    const lift = this.lift[s]!;
    const x = this.jx[s]!;
    const y = this.jy[s]!;
    const z = this.jz[s]!;
    const born = this.clock.value;
    for (let i = 0; i < count; i++) {
      const k = this.cursor;
      this.cursor = k + 1 === this.n ? 0 : k + 1;
      const e = this.lotAt * LOT_STRIDE;
      this.lotAt = this.lotAt + 1 === LOT_ENTRIES ? 0 : this.lotAt + 1;
      const dirX = this.lot[e]!;
      const dirZ = this.lot[e + 1]!;
      const up = (JET_UP_MIN + this.lot[e + 4]! * (JET_UP_MAX - JET_UP_MIN)) * lift;
      const out = up * JET_SPREAD * this.lot[e + 2]!;
      const nozzle = JET_NOZZLE * this.lot[e + 3]!;
      const flight = (2 * up) / GRAVITY;
      this.spawnPos[k * 3] = x + dirX * nozzle;
      this.spawnPos[k * 3 + 1] = y;
      this.spawnPos[k * 3 + 2] = z + dirZ * nozzle;
      this.spawnVel[k * 3] = dirX * out;
      this.spawnVel[k * 3 + 1] = up;
      this.spawnVel[k * 3 + 2] = dirZ * out;
      this.spawnSpan[k * 2] = born;
      this.spawnSpan[k * 2 + 1] = flight;
      this.spawnHue[k * 3] = this.hue[s * 3]!;
      this.spawnHue[k * 3 + 1] = this.hue[s * 3 + 1]!;
      this.spawnHue[k * 3 + 2] = this.hue[s * 3 + 2]!;
      if (born + flight > this.liveUntil) this.liveUntil = born + flight;
    }
  }

  /** The `spawned` slots from ring slot `first` go to the GPU (a spawn that wrapped the ring sends it whole), and the draw reaches the last of them. */
  private publishSpawned(first: number, spawned: number): void {
    const wrapped = first + spawned > this.n;
    const start = wrapped ? 0 : first;
    const count = wrapped ? this.n : spawned;
    uploadRange(this.posAttr, start * 3, count * 3);
    uploadRange(this.velAttr, start * 3, count * 3);
    uploadRange(this.spanAttr, start * 2, count * 2);
    uploadRange(this.hueAttr, start * 3, count * 3);
    const reach = start + count;
    if (reach > this.drawn) {
      this.drawn = reach;
      this.geo.setDrawRange(0, reach);
    }
  }

  /** The clock restarts at 0 and every spark's birth moves back by what it was: only their difference is read. */
  private rebase(): void {
    const back = this.clock.value;
    for (let k = 0; k < this.n; k++) this.spawnSpan[k * 2]! -= back;
    this.liveUntil -= back;
    this.clock.value = 0;
    uploadRange(this.spanAttr, 0, this.n * 2);
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
