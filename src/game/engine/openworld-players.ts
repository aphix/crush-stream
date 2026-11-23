import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { CrowdWalkers } from "../ai/civilians/crowd-walkers.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import { addBodyRecord, BODY_FLAG, BODY_KIND, BODY_POSTURE, type BodyFrame, type BodyMotion, type FootRecord } from "../net/body-codec.ts";
import { BODIES_SILENT_S, HALF_SEQUENCE } from "../net/net-constants.ts";
import type { SightPlayer } from "../present/openworld-sight.ts";
import { blankStrike, fell, runsDown } from "../scenes/figure-strike.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { BODY_EXTRAPOLATE_S, recordTarget } from "./body-follow.ts";
import { STRIKE_COOLDOWN } from "./onfoot-shared.ts";
import type { OpenWorldBodies } from "./openworld-bodies.ts";
import { personOf } from "./people-index.ts";

/** How long (s) a car or shot's strike stays on a player's record: long enough for his machine to hear it from a 15 Hz frame. */
const STRUCK_HOLD_S = 1;
/** After he is back in a car his machine tells the host so this many times. */
const LEFT_CALLS = 3;
/** Where a look word's epoch counter goes: a new walker's look word is one no other row has, so the art dresses the row again. */
const EPOCH_STEP = 64;

const _place: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _target: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _strike = blankStrike();

/** What a guest's own walker is told (`obey`): the engine's ports to knock it and to drag it. */
type OwnWalkerPorts = { knockWalker(vx: number, vy: number, vz: number): boolean; dragWalker(t: BodyMotion): void };

/**
 * The players on foot as the host has them, in a room of the open world: each guest's walker as his own machine sent it (`MSG.foot`), tested here against the host's cars and shots, written into the frame
 * every machine reads (`writeRecords`), and drawn from a pose table of its own. A guest's walker is his machine's; only what hits or holds him comes back to it (`obey`).
 */
export class OpenWorldPlayers {
  readonly poses = createCrowdPoses(MAX_CARS);
  private readonly present = new Uint8Array(MAX_CARS);
  private readonly motion: BodyMotion[] = Array.from({ length: MAX_CARS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 }));
  private readonly crowdTime = new Float64Array(MAX_CARS);
  private readonly seq = new Int32Array(MAX_CARS).fill(-1);
  private readonly heardAt = new Float64Array(MAX_CARS).fill(-Infinity);
  private readonly struckAt = new Float64Array(MAX_CARS).fill(-Infinity);
  private readonly struckUntil = new Float64Array(MAX_CARS).fill(-Infinity);
  private readonly launch = new Float32Array(3 * MAX_CARS);
  private readonly applied = new Uint8Array(MAX_CARS);
  private readonly epoch = new Uint16Array(MAX_CARS);
  /** The calls left in which this machine's player, back in a car, tells the host so. */
  private leftCalls = 0;
  /** One sight-field player a car: where its walker is drawn. */
  private readonly sights: { group: { position: { x: number; z: number } } }[] = Array.from({ length: MAX_CARS }, () => ({ group: { position: { x: 0, z: 0 } } }));
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
  }

  /** Every row is hidden and stood up: nobody is drawn from here until a record puts them in. */
  clearRows(): void {
    this.poses.shown.fill(0);
    this.poses.lying.fill(0);
  }

  /** Host: guest `car`'s walker as his machine sent it, heard at wall second `now`. */
  hearFoot(car: number, foot: FootRecord, now: number): void {
    if (car < 0 || car >= MAX_CARS) return;
    if (now - this.heardAt[car]! > BODIES_SILENT_S) this.seq[car] = -1;
    if (this.seq[car]! >= 0 && (((foot.seq - this.seq[car]!) & 0xffff) >= HALF_SEQUENCE || foot.seq === this.seq[car])) return;
    this.seq[car] = foot.seq;
    if (foot.left) {
      this.present[car] = 0;
      return;
    }
    const m = this.motion[car]!;
    m.x = foot.x;
    m.y = foot.y;
    m.z = foot.z;
    m.vx = foot.vx;
    m.vy = foot.vy;
    m.vz = foot.vz;
    m.heading = foot.heading;
    m.posture = foot.posture;
    this.crowdTime[car] = foot.crowdTime;
    this.heardAt[car] = now;
    if (this.present[car] === 1) return;
    this.present[car] = 1;
    this.epoch[car] = this.epoch[car]! + 1;
    this.poses.look[car] = (1 + car + EPOCH_STEP * this.epoch[car]!) >>> 0;
  }

  /** Player `car`'s walker moved by its velocity as far as the host's clock is from his (at most `BODY_EXTRAPOLATE_S` either way) into `_place`. */
  private movedTo(car: number, crowdSeconds: number): void {
    const m = this.motion[car]!;
    const age = crowdSeconds - this.crowdTime[car]!;
    const reach = age > BODY_EXTRAPOLATE_S ? BODY_EXTRAPOLATE_S : age < -BODY_EXTRAPOLATE_S ? -BODY_EXTRAPOLATE_S : age;
    _place.x = m.x + m.vx * reach;
    _place.y = m.y + m.vy * reach;
    _place.z = m.z + m.vz * reach;
    _place.heading = m.heading;
  }

  /**
   * Host, once a simulation step: a player not heard for `BODIES_SILENT_S` is gone. Each other present player: the body of his that a cable holds is knocked if it stands, and a car of the host's that runs over
   * him (`runsDown`, as for any walker) strikes his record for `STRUCK_HOLD_S` with its launch as the velocity.
   */
  step(cars: readonly DeformableCar[], ownCar: number, crowdSeconds: number, now: number, bodies: OpenWorldBodies | null): void {
    for (let car = 0; car < MAX_CARS; car++) {
      if (this.present[car] === 1 && now - this.heardAt[car]! > BODIES_SILENT_S) this.present[car] = 0;
      if (this.present[car] === 0 || car === ownCar) continue;
      const person = personOf(BODY_KIND.player, car, this.capacity);
      if (bodies?.ropedPerson(person) === true) bodies.knockPerson(person, 0, 0, 0);
      if (this.motion[car]!.posture === BODY_POSTURE.down) this.struckUntil[car] = -Infinity;
      if (this.motion[car]!.posture !== BODY_POSTURE.stand || crowdSeconds - this.struckAt[car]! < STRIKE_COOLDOWN) continue;
      this.movedTo(car, crowdSeconds);
      const ground = activeGround().heightAt(_place.x, _place.z, _place.y);
      if (ground === NO_FLOOR) continue;
      for (let i = 0; i < cars.length; i++) {
        if (!runsDown(cars[i]!, _place.x, _place.z, ground)) continue;
        fell(cars[i]!, i, -1, _place.x, ground, _place.z, detSin(_place.heading), detCos(_place.heading), _strike);
        this.strike(car, _strike.vx, _strike.vy, _strike.vz, crowdSeconds);
        break;
      }
    }
  }

  /** Host: a car or a shot struck player `car` at crowd second `crowdSeconds`, launching him at (vx, vy, vz) m/s. */
  strike(car: number, vx: number, vy: number, vz: number, crowdSeconds: number): void {
    this.launch[3 * car] = vx;
    this.launch[3 * car + 1] = vy;
    this.launch[3 * car + 2] = vz;
    this.struckAt[car] = crowdSeconds;
    this.struckUntil[car] = crowdSeconds + STRUCK_HOLD_S;
  }

  /** Host: the players on foot written into `out`: first the host's own walker (`own`, null while he is in a car), then each other present player: from the body of his a cable holds (roped), else his record moved to the host's clock, struck while a strike's hold runs. */
  writeRecords(out: BodyFrame, ownCar: number, own: BodyMotion | null, crowdSeconds: number, bodies: OpenWorldBodies | null): void {
    if (own !== null) this.copyRecord(out, ownCar, own, own.posture);
    for (let car = 0; car < MAX_CARS; car++) {
      if (this.present[car] === 0 || car === ownCar) continue;
      const person = personOf(BODY_KIND.player, car, this.capacity);
      if (bodies !== null && bodies.ropedPerson(person) && bodies.motionOf(person, _target)) {
        this.copyRecord(out, car, _target, _target.posture | BODY_FLAG.roped);
        continue;
      }
      this.movedTo(car, crowdSeconds);
      _place.vx = this.motion[car]!.vx;
      _place.vy = this.motion[car]!.vy;
      _place.vz = this.motion[car]!.vz;
      let state = this.motion[car]!.posture;
      if (crowdSeconds < this.struckUntil[car]!) {
        state |= BODY_FLAG.struck;
        _place.vx = this.launch[3 * car]!;
        _place.vy = this.launch[3 * car + 1]!;
        _place.vz = this.launch[3 * car + 2]!;
      }
      this.copyRecord(out, car, _place, state);
    }
  }

  /** A player record of car `car` with `state`, its place, velocity and facing from `m`, added to `out`. */
  private copyRecord(out: BodyFrame, car: number, m: BodyMotion, state: number): void {
    const at = addBodyRecord(out, BODY_KIND.player, car, state);
    if (at < 0) return;
    out.pos[3 * at] = m.x;
    out.pos[3 * at + 1] = m.y;
    out.pos[3 * at + 2] = m.z;
    out.vel[3 * at] = m.vx;
    out.vel[3 * at + 1] = m.vy;
    out.vel[3 * at + 2] = m.vz;
    out.heading[at] = m.heading;
  }

  /** Every machine, before the crowd steps: every player of `frame` but car `ownCar` is a body the crowd steps round, never a shove. */
  feed(frame: BodyFrame | null, walkers: CrowdWalkers, ownCar: number, crowdSeconds: number): void {
    if (frame === null) return;
    for (let at = 0; at < frame.count; at++) {
      if (frame.kind[at] !== BODY_KIND.player || frame.id[at] === ownCar) continue;
      recordTarget(frame, at, crowdSeconds - frame.crowdTime, _target);
      walkers.addBody(_target.x, _target.z, _target.vx, _target.vz);
    }
  }

  /** Whether `frame` has a player record of car `car`: he is on foot, so his car holds nobody. */
  away(frame: BodyFrame | null, car: number): boolean {
    if (frame === null) return false;
    for (let at = 0; at < frame.count; at++) if (frame.kind[at] === BODY_KIND.player && frame.id[at] === car) return true;
    return false;
  }

  /** Guest: what the host's record of car `ownCar` does to his own walker: struck once each time `struck` comes on (tried again each frame until the walker takes it), and a roped record drags him. */
  obey(frame: BodyFrame | null, ownCar: number, crowdSeconds: number, ports: OwnWalkerPorts): void {
    if (frame === null) return;
    for (let at = 0; at < frame.count; at++) {
      if (frame.kind[at] !== BODY_KIND.player || frame.id[at] !== ownCar) continue;
      const state = frame.state[at]!;
      if ((state & BODY_FLAG.struck) === 0) this.applied[ownCar] = 0;
      else if (this.applied[ownCar] === 0) this.applied[ownCar] = ports.knockWalker(frame.vel[3 * at]!, frame.vel[3 * at + 1]!, frame.vel[3 * at + 2]!) ? 1 : 0;
      if ((state & BODY_FLAG.roped) === 0) return;
      recordTarget(frame, at, crowdSeconds - frame.crowdTime, _target);
      ports.dragWalker(_target);
      return;
    }
  }

  /** The walker to send the host: true while he is on foot (`onFoot`; `out` already holds him), and `LEFT_CALLS` more calls with `out.left` once he is back in a car. */
  footOut(out: FootRecord, onFoot: boolean, crowdSeconds: number): boolean {
    if (onFoot) this.leftCalls = LEFT_CALLS;
    else if (this.leftCalls > 0) this.leftCalls--;
    else return false;
    out.left = !onFoot;
    out.crowdTime = crowdSeconds;
    return true;
  }

  /** Sight players for the field: the players on foot of `frame` but car `ownCar`, written into `out` from index `from`; the index after the last. */
  sightOf(frame: BodyFrame | null, ownCar: number, crowdSeconds: number, out: SightPlayer[], from: number): number {
    let count = from;
    if (frame === null) return count;
    for (let at = 0; at < frame.count; at++) {
      if (frame.kind[at] !== BODY_KIND.player || frame.id[at] === ownCar) continue;
      recordTarget(frame, at, crowdSeconds - frame.crowdTime, _target);
      const sight = this.sights[frame.id[at]!]!;
      sight.group.position.x = _target.x;
      sight.group.position.z = _target.z;
      out[count++] = sight;
    }
    return count;
  }
}
