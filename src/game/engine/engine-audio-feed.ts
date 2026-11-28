import * as THREE from "three";
import { surfaceSoundMat, type HitEvent, type SoundMat } from "../present/hit-sound.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { GlassName } from "../vehicle/car-core.ts";
import { FLIPPED_UP_Y } from "../vehicle/constants.ts";
import { activeGround } from "../world/ground.ts";

/** A car's own material in every hit it takes part in. */
export const STEEL: SoundMat = "steel";
/** What the feed plays into: `GameAudio`. A `HitEvent` is only read during the call, so the feed reuses one. */
export interface HitSink {
  hit(e: HitEvent): void;
  scrape(id: number, speed: number, force: number, x: number, y: number, z: number, a: SoundMat, b: SoundMat): void;
}

/** What the feed reads of a car (a `DeformableCar` has all of it). */
export type FeedCar = {
  velocity: THREE.Vector3;
  stored: boolean;
  airborne: boolean;
  wheelsDown: number;
  group: { position: THREE.Vector3; visible: boolean; matrixWorld: THREE.Matrix4 };
  glassPanes: readonly { name: GlassName }[];
  glassBits(): number;
  glassWorld(name: GlassName, out: THREE.Vector3): THREE.Vector3;
};

/** A car pair's hit as `World.pairHit` reports it. */
export type PairContact = { impulse: number; contact: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } };

/** A contact under this closing speed (m/s) is a touch, not a hit: it may still scrape. */
const HIT_MIN_IMPULSE = 1.5;
/** The same contact hits again only after this long (s): a collision reports itself every slice. */
const HIT_GAP_S = 0.1;
/** Most hits queued between two frames, and most played in one frame (the loudest). */
const QUEUE = 24;
const PLAYED_PER_FRAME = 6;
/** Contacts tracked at once, and how many scrape at once. */
const CONTACTS = 32;
const SCRAPES_PER_FRAME = 3;
/** A contact slides under `SCRAPE_MIN_SPEED` m/s of slip not at all, and counts as touching for `SCRAPE_ACTIVE_S` s after it was last reported (a step is under a frame). */
const SCRAPE_MIN_SPEED = 1;
const SCRAPE_ACTIVE_S = 0.06;
/** Scrape force (0..1): a light touch, rising with the contact's closing speed to a hard press at `SCRAPE_PRESS_IMPULSE`. */
const SCRAPE_FORCE_FLOOR = 0.25;
const SCRAPE_PRESS_IMPULSE = 20;
/** A car that gains this much upward speed (m/s) in one frame hit the ground; a jump of more than `TELEPORT_M` m in a frame was a placement. */
const GROUND_HIT_DV = 3;
const TELEPORT_M = 2;
/** A pane that cracks or shatters on its own, as a hit (m/s). */
const PANE_CRACK_IMPULSE = 8;
const PANE_SHATTER_IMPULSE = 16;

const KIND_PAIR = 0;
const KIND_WALL = 1;
const KIND_GROUND = 2;

const _pane = new THREE.Vector3();

/**
 * Turns what the sim reports (car pairs, walls and props, the ground, panes breaking) into `HitEvent`s and `scrape` calls: hits queue as the steps report them and the loudest few play each
 * frame, a car pair that broke a pane sounds as glass; sliding contacts scrape every frame they last. Audio is presentation: this reads the sim and writes nothing to it.
 */
export class AudioFeed {
  private readonly sink: HitSink;
  private readonly cars: () => readonly FeedCar[];
  private readonly event: HitEvent = { impulse: 0, x: 0, y: 0, z: 0, a: STEEL, b: STEEL };
  private t = 0;

  private queued = 0;
  private readonly qImpulse = new Float64Array(QUEUE);
  private readonly qAt = new Float64Array(QUEUE * 3);
  private readonly qCarA: (FeedCar | null)[] = new Array<FeedCar | null>(QUEUE).fill(null);
  private readonly qCarB: (FeedCar | null)[] = new Array<FeedCar | null>(QUEUE).fill(null);
  private readonly qMatA: SoundMat[] = new Array<SoundMat>(QUEUE).fill(STEEL);
  private readonly qMatB: SoundMat[] = new Array<SoundMat>(QUEUE).fill(STEEL);

  private readonly cKind = new Uint8Array(CONTACTS).fill(255);
  private readonly cCarA: (FeedCar | null)[] = new Array<FeedCar | null>(CONTACTS).fill(null);
  private readonly cCarB: (FeedCar | null)[] = new Array<FeedCar | null>(CONTACTS).fill(null);
  private readonly cId = new Int32Array(CONTACTS);
  private readonly cSeen = new Float64Array(CONTACTS).fill(-Infinity);
  private readonly cHitAfter = new Float64Array(CONTACTS);
  private readonly cSpeed = new Float64Array(CONTACTS);
  private readonly cForce = new Float64Array(CONTACTS);
  private readonly cAt = new Float64Array(CONTACTS * 3);
  private readonly cMatA: SoundMat[] = new Array<SoundMat>(CONTACTS).fill(STEEL);
  private readonly cMatB: SoundMat[] = new Array<SoundMat>(CONTACTS).fill(STEEL);
  private readonly chosen = new Uint8Array(CONTACTS);
  private nextId = 1;

  private readonly prevGlass = new Int32Array(MAX_CARS).fill(-1);
  private readonly brokeNow = new Uint8Array(MAX_CARS);
  private readonly prevVy = new Float64Array(MAX_CARS);
  private readonly prevY = new Float64Array(MAX_CARS);
  private readonly primed = new Uint8Array(MAX_CARS);

  constructor(sink: HitSink, cars: () => readonly FeedCar[]) {
    this.sink = sink;
    this.cars = cars;
  }

  /** Two cars touched (`World.pairHit`, each slice they overlap). */
  pair(a: FeedCar, b: FeedCar, hit: PairContact): void {
    const rx = a.velocity.x - b.velocity.x;
    const ry = a.velocity.y - b.velocity.y;
    const rz = a.velocity.z - b.velocity.z;
    const along = rx * hit.normal.x + ry * hit.normal.y + rz * hit.normal.z;
    const sx = rx - along * hit.normal.x;
    const sy = ry - along * hit.normal.y;
    const sz = rz - along * hit.normal.z;
    this.touch(KIND_PAIR, a, b, hit.impulse, Math.sqrt(sx * sx + sy * sy + sz * sz), hit.contact.x, hit.contact.y, hit.contact.z, STEEL, STEEL);
  }

  /** A wall or prop of material `mat` met `car` (steel), closing at `closing` m/s at (x, y, z). */
  wall(car: FeedCar, closing: number, x: number, y: number, z: number, mat: SoundMat): void {
    this.touch(KIND_WALL, car, null, closing, Math.sqrt(car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z), x, y, z, STEEL, mat);
  }

  /** Forgets everything queued and tracked: audio is off, or the scene changed. */
  clear(): void {
    this.queued = 0;
    this.cSeen.fill(-Infinity);
    this.primed.fill(0);
    this.prevGlass.fill(-1);
  }

  /** Once a frame, `dt` s: reads the cars for panes, landings and slides, plays the loudest queued hits, and scrapes the contacts still sliding. */
  frame(dt: number): void {
    this.t += dt;
    this.scanCars();
    this.play();
    this.scrapeSliding();
  }

  private slot(kind: number, a: FeedCar, b: FeedCar | null): number {
    let oldest = 0;
    for (let s = 0; s < CONTACTS; s++) {
      if (this.cKind[s] === kind && this.cCarA[s] === a && this.cCarB[s] === b) return s;
      if (this.cSeen[s]! < this.cSeen[oldest]!) oldest = s;
    }
    this.cKind[oldest] = kind;
    this.cCarA[oldest] = a;
    this.cCarB[oldest] = b;
    this.cId[oldest] = this.nextId++;
    this.cSeen[oldest] = this.t;
    this.cHitAfter[oldest] = 0;
    return oldest;
  }

  private touch(kind: number, a: FeedCar, b: FeedCar | null, impulse: number, speed: number, x: number, y: number, z: number, matA: SoundMat, matB: SoundMat): void {
    const s = this.slot(kind, a, b);
    this.cSeen[s] = this.t;
    this.cSpeed[s] = speed;
    this.cForce[s] = SCRAPE_FORCE_FLOOR + (1 - SCRAPE_FORCE_FLOOR) * Math.min(1, impulse / SCRAPE_PRESS_IMPULSE);
    this.cAt[s * 3] = x;
    this.cAt[s * 3 + 1] = y;
    this.cAt[s * 3 + 2] = z;
    this.cMatA[s] = matA;
    this.cMatB[s] = matB;
    if (impulse < HIT_MIN_IMPULSE || this.t < this.cHitAfter[s]!) return;
    this.cHitAfter[s] = this.t + HIT_GAP_S;
    this.enqueue(impulse, x, y, z, a, b, matA, matB);
  }

  /** Queues a hit; with the queue full the weakest queued hit goes if this one is harder. */
  private enqueue(impulse: number, x: number, y: number, z: number, a: FeedCar | null, b: FeedCar | null, matA: SoundMat, matB: SoundMat): void {
    let at = this.queued;
    if (at === QUEUE) {
      at = 0;
      for (let q = 1; q < QUEUE; q++) if (this.qImpulse[q]! < this.qImpulse[at]!) at = q;
      if (this.qImpulse[at]! >= impulse) return;
    } else this.queued++;
    this.qImpulse[at] = impulse;
    this.qAt[at * 3] = x;
    this.qAt[at * 3 + 1] = y;
    this.qAt[at * 3 + 2] = z;
    this.qCarA[at] = a;
    this.qCarB[at] = b;
    this.qMatA[at] = matA;
    this.qMatB[at] = matB;
  }

  /** Per car: a pane that cracked or shattered since the last frame, a jump in upward speed (a landing or a slam), and a body lying on the ground sliding. */
  private scanCars(): void {
    const cars = this.cars();
    this.brokeNow.fill(0);
    for (let i = 0; i < cars.length && i < MAX_CARS; i++) {
      const car = cars[i]!;
      if (car.stored || !car.group.visible) {
        this.primed[i] = 0;
        this.prevGlass[i] = -1;
        continue;
      }
      this.scanPanes(car, i);
      const { x, y, z } = car.group.position;
      const dv = car.velocity.y - this.prevVy[i]!;
      const jumped = Math.abs(y - this.prevY[i]!) > TELEPORT_M;
      this.prevVy[i] = car.velocity.y;
      this.prevY[i] = y;
      if (this.primed[i] === 0 || jumped) {
        this.primed[i] = 1;
        continue;
      }
      const surface = surfaceSoundMat(activeGround().surfaceAt(x, z));
      const speed = Math.sqrt(car.velocity.x * car.velocity.x + car.velocity.z * car.velocity.z);
      const onWheels = (car.wheelsDown & 15) === 15;
      if (dv >= GROUND_HIT_DV) this.touch(KIND_GROUND, car, null, dv, speed, x, y, z, onWheels ? "rubber" : STEEL, surface);
      else if (car.group.matrixWorld.elements[5]! < FLIPPED_UP_Y && !car.airborne && speed >= SCRAPE_MIN_SPEED) this.touch(KIND_GROUND, car, null, 0, speed, x, y, z, STEEL, surface);
    }
  }

  private scanPanes(car: FeedCar, i: number): void {
    const bits = car.glassBits();
    const before = this.prevGlass[i]!;
    this.prevGlass[i] = bits;
    if (before < 0 || bits === before) return;
    for (let p = 0; p < car.glassPanes.length; p++) {
      const was = (before >> (p * 2)) & 3;
      const now = (bits >> (p * 2)) & 3;
      if (now <= was) continue;
      this.brokeNow[i] = 1;
      car.glassWorld(car.glassPanes[p]!.name, _pane);
      this.enqueue(now === 2 ? PANE_SHATTER_IMPULSE : PANE_CRACK_IMPULSE, _pane.x, _pane.y, _pane.z, car, null, "glass", "glass");
    }
  }

  private indexOf(car: FeedCar | null): number {
    const cars = this.cars();
    for (let i = 0; i < cars.length; i++) if (cars[i] === car) return i;
    return -1;
  }

  /** Plays the loudest `PLAYED_PER_FRAME` queued hits, each by its material: a hit on a car that broke a pane this frame sounds as glass on what it met. */
  private play(): void {
    for (let n = 0; n < PLAYED_PER_FRAME && this.queued > 0; n++) {
      let top = 0;
      for (let q = 1; q < this.queued; q++) if (this.qImpulse[q]! > this.qImpulse[top]!) top = q;
      const e = this.event;
      e.impulse = this.qImpulse[top]!;
      e.x = this.qAt[top * 3]!;
      e.y = this.qAt[top * 3 + 1]!;
      e.z = this.qAt[top * 3 + 2]!;
      e.a = this.qMatA[top]!;
      e.b = this.qMatB[top]!;
      const a = this.indexOf(this.qCarA[top]!);
      const b = this.indexOf(this.qCarB[top]!);
      if (e.a === STEEL && ((a >= 0 && this.brokeNow[a] === 1) || (b >= 0 && this.brokeNow[b] === 1))) e.a = "glass";
      this.sink.hit(e);
      const last = this.queued - 1;
      this.qImpulse[top] = this.qImpulse[last]!;
      this.qAt[top * 3] = this.qAt[last * 3]!;
      this.qAt[top * 3 + 1] = this.qAt[last * 3 + 1]!;
      this.qAt[top * 3 + 2] = this.qAt[last * 3 + 2]!;
      this.qCarA[top] = this.qCarA[last]!;
      this.qCarB[top] = this.qCarB[last]!;
      this.qMatA[top] = this.qMatA[last]!;
      this.qMatB[top] = this.qMatB[last]!;
      this.qCarA[last] = null;
      this.qCarB[last] = null;
      this.queued = last;
    }
    // What is left is older than a frame: a hit not played now is lost, not late.
    for (let q = 0; q < this.queued; q++) {
      this.qCarA[q] = null;
      this.qCarB[q] = null;
    }
    this.queued = 0;
  }

  /** The `SCRAPES_PER_FRAME` hardest-pressed contacts still touching and slipping, one `scrape` each; a contact left out stops being called, so its sound fades. */
  private scrapeSliding(): void {
    this.chosen.fill(0);
    for (let taken = 0; taken < SCRAPES_PER_FRAME; taken++) {
      let best = -1;
      for (let s = 0; s < CONTACTS; s++) {
        if (this.chosen[s] === 1 || this.t - this.cSeen[s]! > SCRAPE_ACTIVE_S || this.cSpeed[s]! < SCRAPE_MIN_SPEED) continue;
        if (best < 0 || this.cForce[s]! > this.cForce[best]!) best = s;
      }
      if (best < 0) return;
      this.chosen[best] = 1;
      this.sink.scrape(this.cId[best]!, this.cSpeed[best]!, this.cForce[best]!, this.cAt[best * 3]!, this.cAt[best * 3 + 1]!, this.cAt[best * 3 + 2]!, this.cMatA[best]!, this.cMatB[best]!);
    }
  }
}
