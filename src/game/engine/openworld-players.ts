import { createCrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { CrowdWalkers } from "../ai/civilians/crowd-walkers.ts";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { SPRINT_SPEED } from "../present/walker-locomotion.ts";
import { addBodyRecord, BODY_FLAG, BODY_KIND, BODY_POSTURE, packArms, PLAYER_FLAG, SHOT_COUNT_MASK, shotsOfArms, weaponOfArms, type BodyFrame, type BodyMotion, type FootRecord } from "../net/body-codec.ts";
import { BODIES_SILENT_S, HALF_SEQUENCE } from "../net/net-constants.ts";
import type { DriverLook } from "../present/driver-look.ts";
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
/** How long (s) a blow that does not fell him stays on a player's record: four 15 Hz frames, and shorter than a punch's cooldown, so each blow is one stagger. */
const STAGGER_HOLD_S = 0.3;
/** A staggered player's record carries the blow's bearing in its activity clock, which nothing else reads on a player: a whole turn is this many seconds of that clock (its byte holds tenths up to 25.4 s: 254 steps a turn). */
const BEARING_CLOCK_S = 25.4;
/** After he is back in a car his machine tells the host so this many times. */
const LEFT_CALLS = 3;
/** Where a look word's epoch counter goes: a new walker's look word is one no other row has, so the art dresses the row again. */
const EPOCH_STEP = 64;

const _place: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _target: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _strike = blankStrike();

/** A look as one number: each field mixed in, an absent one as -1, so two looks that differ in any field hash apart (to the degree a 32-bit hash can). */
function lookHash(look: DriverLook): number {
  let h = look.woman ? 1 : 0;
  h = (Math.imul(h, 31) + look.shirt) | 0;
  h = (Math.imul(h, 31) + look.pants) | 0;
  h = (Math.imul(h, 31) + look.hair) | 0;
  h = (Math.imul(h, 31) + (look.hat ?? -1)) | 0;
  h = (Math.imul(h, 31) + (look.mustache ? 1 : 0)) | 0;
  h = (Math.imul(h, 31) + (look.portly === true ? 1 : 0)) | 0;
  h = (Math.imul(h, 31) + (look.outfit ?? -1)) | 0;
  h = (Math.imul(h, 31) + (look.shades === true ? 1 : 0)) | 0;
  h = (Math.imul(h, 31) + (look.face ?? -1)) | 0;
  return (Math.imul(h, 31) + (look.tie ?? -1)) | 0;
}

/** What a guest's own walker is told (`obey`): the engine's ports to knock it, to stagger it and to drag it. */
type OwnWalkerPorts = { knockWalker(vx: number, vy: number, vz: number): boolean; staggerWalker(dirX: number, dirZ: number): void; dragWalker(t: BodyMotion): void };

/** A guest's speed is seen over the ground between two of his records at least this far apart (s) on the host's clock: about the age of the view a shot at him was aimed in, and long enough that two messages bunched by the link, or one sent twice, do not read as a man standing still. A speed seen is capped at twice a sprint (m/s): a record that jumps is a teleport, not a run. */
const SEEN_BASE_S = 0.25;
const SEEN_SPEED_MAX = 2 * SPRINT_SPEED;

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
  private readonly seenSpeed = new Float32Array(MAX_CARS);
  /** Per guest, the record his seen speed is measured from: where it put him and the host's wall second it was heard. */
  private readonly baseX = new Float32Array(MAX_CARS);
  private readonly baseZ = new Float32Array(MAX_CARS);
  private readonly baseAt = new Float64Array(MAX_CARS);
  private readonly heardAt = new Float64Array(MAX_CARS).fill(-Infinity);
  private readonly struckAt = new Float64Array(MAX_CARS).fill(-Infinity);
  private readonly struckUntil = new Float64Array(MAX_CARS).fill(-Infinity);
  private readonly launch = new Float32Array(3 * MAX_CARS);
  private readonly applied = new Uint8Array(MAX_CARS);
  private readonly staggerUntil = new Float64Array(MAX_CARS).fill(-Infinity);
  private readonly staggerBearing = new Float32Array(MAX_CARS);
  private readonly staggered = new Uint8Array(MAX_CARS);
  private readonly epoch = new Uint16Array(MAX_CARS);
  /** Per row, the hash of the look its look word was last made from. */
  private readonly lookHash = new Int32Array(MAX_CARS);
  /** The calls left in which this machine's player, back in a car, tells the host so. */
  private leftCalls = 0;
  /** This machine's own player: the weapon slot in his hand, the shots he has fired (a counter that wraps) and the far end of his latest shot (m). The arms byte of his record, and of his `MSG.foot`, is these. */
  private ownWeapon = 0;
  private ownShots = 0;
  private readonly ownFar = new Float32Array(3);
  /** Host: per guest, the arms byte and the far end of his latest shot (m) as his machine last sent them. */
  private readonly footArms = new Uint8Array(MAX_CARS);
  private readonly footFar = new Float32Array(3 * MAX_CARS);
  /** Every machine: per player on foot in the frame last read (`readArms`) but this machine's own, whether he is in it, the weapon slot in his hand, his shot counter, the far end of his latest shot (m) and where he stands at this machine's crowd second. */
  readonly armsSeen = new Uint8Array(MAX_CARS);
  readonly armsWeapon = new Uint8Array(MAX_CARS);
  readonly armsShots = new Uint8Array(MAX_CARS);
  readonly armsFar = new Float32Array(3 * MAX_CARS);
  readonly armsPlace: BodyMotion[] = Array.from({ length: MAX_CARS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 }));
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
    const since = now - this.baseAt[car]!;
    if (this.present[car] !== 1 || since >= SEEN_BASE_S) {
      this.seenSpeed[car] = this.present[car] === 1 ? Math.min(SEEN_SPEED_MAX, hypot2(foot.x - this.baseX[car]!, foot.z - this.baseZ[car]!) / since) : 0;
      this.baseX[car] = foot.x;
      this.baseZ[car] = foot.z;
      this.baseAt[car] = now;
    }
    m.x = foot.x;
    m.y = foot.y;
    m.z = foot.z;
    m.vx = foot.vx;
    m.vy = foot.vy;
    m.vz = foot.vz;
    m.heading = foot.heading;
    m.posture = foot.posture;
    this.footArms[car] = foot.arms;
    this.footFar[3 * car] = foot.farX;
    this.footFar[3 * car + 1] = foot.farY;
    this.footFar[3 * car + 2] = foot.farZ;
    this.crowdTime[car] = foot.crowdTime;
    this.heardAt[car] = now;
    if (this.present[car] === 1) return;
    this.present[car] = 1;
    this.epoch[car] = this.epoch[car]! + 1;
    this.poses.look[car] = (1 + car + EPOCH_STEP * this.epoch[car]!) >>> 0;
  }

  /** Every machine, once a frame, after the rows are written: a shown player row whose car's look (`source.playerLook`) is not the one it was last dressed from gets a new look word, so the art dresses it again. A look that arrives after his first record, or a car slot a leaver's seat passed to another, changes the dress. */
  refreshLooks(source: { playerLook(car: number): DriverLook }): void {
    for (let car = 0; car < MAX_CARS; car++) {
      if (this.poses.shown[car] === 0) continue;
      const hash = lookHash(source.playerLook(car));
      if (hash === this.lookHash[car]) continue;
      this.lookHash[car] = hash;
      this.epoch[car] = this.epoch[car]! + 1;
      this.poses.look[car] = (1 + car + EPOCH_STEP * this.epoch[car]!) >>> 0;
    }
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

  /** Host: how fast player `car` has moved over the ground between two of his records `SEEN_BASE_S` apart, as the host saw it (m/s), 0 for a player not present or heard for less than that. A guest that reports a speed that is not his own, or sends a record twice, does not change it. */
  seenSpeedOf(car: number): number {
    return car >= 0 && car < MAX_CARS && this.present[car] === 1 ? this.seenSpeed[car]! : 0;
  }

  /** Host: where player `car` stands on foot at the host's clock and how he moves, into `out`; false while he is in a car or has not been heard. */
  placeOf(car: number, crowdSeconds: number, out: { x: number; y: number; z: number; heading: number; velocityX: number; velocityZ: number }): boolean {
    if (car < 0 || car >= MAX_CARS || this.present[car] === 0) return false;
    this.movedTo(car, crowdSeconds);
    out.x = _place.x;
    out.y = _place.y;
    out.z = _place.z;
    out.heading = _place.heading;
    out.velocityX = this.motion[car]!.vx;
    out.velocityZ = this.motion[car]!.vz;
    return true;
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

  /** Host: a blow that does not fell him lands on player `car` at crowd second `crowdSeconds`, going (dirX, dirZ). */
  stagger(car: number, dirX: number, dirZ: number, crowdSeconds: number): void {
    const bearing = detAtan2(dirX, dirZ);
    this.staggerBearing[car] = bearing < 0 ? bearing + 2 * Math.PI : bearing;
    this.staggerUntil[car] = crowdSeconds + STAGGER_HOLD_S;
  }

  /** Host: the players on foot written into `out`: first the host's own walker (`own`, null while he is in a car), then each other present player: from the body of his a cable holds (roped), else his record moved to the host's clock, struck while a strike's hold runs, staggered (the blow's bearing in the record's activity clock, his own velocity kept) while a lighter blow's does. */
  writeRecords(out: BodyFrame, ownCar: number, own: BodyMotion | null, crowdSeconds: number, bodies: OpenWorldBodies | null): void {
    if (own !== null) this.copyRecord(out, ownCar, own, own.posture, ownCar);
    for (let car = 0; car < MAX_CARS; car++) {
      if (this.present[car] === 0 || car === ownCar) continue;
      const person = personOf(BODY_KIND.player, car, this.capacity);
      if (bodies !== null && bodies.ropedPerson(person) && bodies.motionOf(person, _target)) {
        this.copyRecord(out, car, _target, _target.posture | BODY_FLAG.roped, ownCar);
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
      const at = this.copyRecord(out, car, _place, state, ownCar);
      if (at < 0 || (state & BODY_FLAG.struck) !== 0 || crowdSeconds >= this.staggerUntil[car]!) continue;
      out.state[at] = state | PLAYER_FLAG.staggered;
      out.activityClock[at] = (this.staggerBearing[car]! / (2 * Math.PI)) * BEARING_CLOCK_S;
    }
  }

  /** A player record of car `car` with `state`, its place, velocity and facing from `m`, and his arms (this machine's own for `ownCar`, else the guest's as his machine sent them), added to `out`; its index, -1 when the frame is full. */
  private copyRecord(out: BodyFrame, car: number, m: BodyMotion, state: number, ownCar: number): number {
    const at = addBodyRecord(out, BODY_KIND.player, car, state);
    if (at < 0) return at;
    out.pos[3 * at] = m.x;
    out.pos[3 * at + 1] = m.y;
    out.pos[3 * at + 2] = m.z;
    out.vel[3 * at] = m.vx;
    out.vel[3 * at + 1] = m.vy;
    out.vel[3 * at + 2] = m.vz;
    out.heading[at] = m.heading;
    const own = car === ownCar;
    out.arms[at] = own ? packArms(this.ownWeapon, this.ownShots) : this.footArms[car]!;
    for (let axis = 0; axis < 3; axis++) out.armsFar[3 * at + axis] = own ? this.ownFar[axis]! : this.footFar[3 * car + axis]!;
    return at;
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

  /** Guest: what the host's record of car `ownCar` does to his own walker: struck once each time `struck` comes on (tried again each frame until the walker takes it), staggered once each time `staggered` does, and a roped record drags him. */
  obey(frame: BodyFrame | null, ownCar: number, crowdSeconds: number, ports: OwnWalkerPorts): void {
    if (frame === null) return;
    for (let at = 0; at < frame.count; at++) {
      if (frame.kind[at] !== BODY_KIND.player || frame.id[at] !== ownCar) continue;
      const state = frame.state[at]!;
      if ((state & BODY_FLAG.struck) === 0) this.applied[ownCar] = 0;
      else if (this.applied[ownCar] === 0) this.applied[ownCar] = ports.knockWalker(frame.vel[3 * at]!, frame.vel[3 * at + 1]!, frame.vel[3 * at + 2]!) ? 1 : 0;
      if ((state & PLAYER_FLAG.staggered) === 0) this.staggered[ownCar] = 0;
      else if (this.staggered[ownCar] === 0) {
        this.staggered[ownCar] = 1;
        const bearing = (frame.activityClock[at]! / BEARING_CLOCK_S) * 2 * Math.PI;
        ports.staggerWalker(detSin(bearing), detCos(bearing));
      }
      if ((state & BODY_FLAG.roped) === 0) return;
      recordTarget(frame, at, crowdSeconds - frame.crowdTime, _target);
      ports.dragWalker(_target);
      return;
    }
  }

  /** This machine's player holds weapon slot `slot` (`WEAPON_ORDER` of the arms) from now on. */
  setOwnWeapon(slot: number): void {
    this.ownWeapon = slot;
  }

  /** This machine's player fired: his shot counter steps (it wraps) and the far end of his tracer is (x, y, z). */
  noteShot(x: number, y: number, z: number): void {
    this.ownShots = (this.ownShots + 1) & SHOT_COUNT_MASK;
    this.ownFar[0] = x;
    this.ownFar[1] = y;
    this.ownFar[2] = z;
  }

  /** Every machine, once a frame: each other player on foot in `frame` (null: none) into the arms table (`armsSeen` and its columns), moved to crowd second `crowdSeconds`; the rest are marked unseen. */
  readArms(frame: BodyFrame | null, ownCar: number, crowdSeconds: number): void {
    this.armsSeen.fill(0);
    if (frame === null) return;
    for (let at = 0; at < frame.count; at++) {
      const car = frame.id[at]!;
      if (frame.kind[at] !== BODY_KIND.player || car === ownCar || car >= MAX_CARS) continue;
      recordTarget(frame, at, crowdSeconds - frame.crowdTime, this.armsPlace[car]!);
      this.armsSeen[car] = 1;
      this.armsWeapon[car] = weaponOfArms(frame.arms[at]!);
      this.armsShots[car] = shotsOfArms(frame.arms[at]!);
      for (let axis = 0; axis < 3; axis++) this.armsFar[3 * car + axis] = frame.armsFar[3 * at + axis]!;
    }
  }

  /** Guest: the first hook end player `car` holds, as `frame` has it, into `out`; false when his record says he holds none. */
  holdAt(frame: BodyFrame | null, car: number, out: { x: number; y: number; z: number }): boolean {
    if (frame === null) return false;
    for (let at = 0; at < frame.count; at++) {
      if (frame.kind[at] !== BODY_KIND.player || frame.id[at] !== car) continue;
      if ((frame.state[at]! & PLAYER_FLAG.holds) === 0) return false;
      out.x = frame.holdAt[3 * at]!;
      out.y = frame.holdAt[3 * at + 1]!;
      out.z = frame.holdAt[3 * at + 2]!;
      return true;
    }
    return false;
  }

  /** The walker to send the host: true while he is on foot (`onFoot`; `out` already holds him), and `LEFT_CALLS` more calls with `out.left` once he is back in a car. His arms ride it. */
  footOut(out: FootRecord, onFoot: boolean, crowdSeconds: number): boolean {
    if (onFoot) this.leftCalls = LEFT_CALLS;
    else if (this.leftCalls > 0) this.leftCalls--;
    else return false;
    out.left = !onFoot;
    out.crowdTime = crowdSeconds;
    out.arms = packArms(this.ownWeapon, this.ownShots);
    out.farX = this.ownFar[0]!;
    out.farY = this.ownFar[1]!;
    out.farZ = this.ownFar[2]!;
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
