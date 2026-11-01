import * as THREE from "three";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { PARTS } from "../present/ragdoll-body.ts";
import { SHOWCASE_KNOCK, type ShowcaseArt } from "../present/showcase-art.ts";
import type { Walker } from "../present/ragdoll-walker.ts";
import { WALK_SPEED } from "../present/walker-locomotion.ts";
import { wrapAngle } from "../present/walker-math.ts";

/** Within this far (m) of his mark he has arrived; he then turns to his old facing, to within this much (rad), and goes back on the set. */
const ARRIVED = 0.25;
const FACING_BACK = 0.12;
/** A walker that has not got home by then (s) is put back on his mark where he is not: stuck on something, or lost off the set; a thrown one that has not reached his mark takes another. */
const GIVE_UP = 30;
/** He slows over the last metres: the pace (m/s) never falls under this until he arrives. */
const SLOWEST = 0.5;
/** A figure who stepped into the ragdoll world standing (`stepIn`) stays there at least this long (s), so a thrown prop that only bumps him bounces off him before the set takes him back. */
const BUMP_HOLD = 1;

/** A thrown figure wanders inside this far (m) of the showcase's middle; his marks lie `WANDER_EDGE` m inside it, so a bump or a stride's overshoot still leaves him within. */
const WANDER_RADIUS = 30;
const WANDER_EDGE = 2;
/** The `figure` of a dummy that was thrown: no figure of the set stands for him. */
const THROWN = -1;

/** A dummy the ragdoll world has: which figure of the set he is (`THROWN`: none), the pool slot, how long he has been away (s; a thrown one's: since he picked his mark), and the mark (x, z) a thrown one walks to, null for a set figure walking home. */
type Away = { figure: number; slot: number; seconds: number; wander: { x: number; z: number } | null };

const _mark = new THREE.Vector3();
const _torso = new THREE.Vector3();
const _push = new THREE.Vector3();

/**
 * The showcase's figures after a press: the figure is knocked at the point the press landed, along the way the camera faces, and his dummy
 * (the ragdoll pool, an active ragdoll as the player on foot is) goes limp and reacts to where it landed; once he has lain a moment he gets up,
 * walks back to his mark and turns to his old facing, and the set takes him back as he stood. A press on a dummy already away knocks him again
 * where he is. A full pool (its capacity: 32 in the showcase) sends the one longest away home at once for the next knock.
 */
export class ShowcaseWalks {
  private readonly art: ShowcaseArt;
  private readonly ragdolls: RagdollSystem;
  private readonly away: Away[] = [];
  /** Where a wanderer's next mark falls: a uniform draw in [0, 1). */
  private random: () => number = Math.random;

  constructor(art: ShowcaseArt, ragdolls: RagdollSystem) {
    this.art = art;
    this.ragdolls = ragdolls;
  }

  /** Whether the dummy in pool slot `slot` is a figure that is away. */
  isAway(slot: number): boolean {
    return this.away.some((a) => a.slot === slot);
  }

  /** Whether figure `figure` stands on the set, not away in the ragdoll world. */
  onSet(figure: number): boolean {
    for (const a of this.away) if (a.figure === figure) return false;
    return true;
  }

  /** Figure `figure` of the set is pushed at the world `point`, the way `facing` (a unit vector: the camera's) points. Whether the ragdoll world took him (not while Rapier loads). */
  knock(figure: number, point: THREE.Vector3, facing: THREE.Vector3): boolean {
    const slot = this.stepIn(figure);
    if (slot < 0) return false;
    this.push(slot, point, facing);
    return true;
  }

  /**
   * Figure `figure` of the set steps into the ragdoll world as he stands, on his mark and unpushed, a walker held up: a thrown prop on
   * its way meets his body there, and knocks him down or bounces off him by the one law (`PropBodies.strikeDolls`). His pool slot, or -1
   * while Rapier loads. A full pool sends the one longest away home at once.
   */
  stepIn(figure: number): number {
    let slot = this.ragdolls.freeSlot();
    if (slot < 0 && this.away.length > 0) slot = this.sendHome(this.away[0]!);
    if (slot < 0) return -1;
    this.art.markOf(figure, _mark);
    const placed = this.ragdolls.startWalker(_mark, this.art.yawOf(figure), this.art.figureOf(figure), slot);
    if (placed < 0) return -1;
    this.away.push({ figure, slot: placed, seconds: 0, wander: null });
    this.art.take(figure);
    return placed;
  }

  /**
   * Figure `which` of the set (`ShowcaseArt.figureOf`: 0 the man, 1 the woman) is thrown as a new dummy, his torso at `torso` leaving at `v` m/s: a ragdoll in flight that lies, gets up and then
   * wanders `WANDER_RADIUS` m about the middle, turned to the way he flies. Nobody of the set stands for him. His pool slot, or -1 while Rapier loads; a full pool sends the one longest away home.
   */
  throwFigure(which: number, torso: THREE.Vector3, v: THREE.Vector3): number {
    let slot = this.ragdolls.freeSlot();
    if (slot < 0 && this.away.length > 0) slot = this.sendHome(this.away[0]!);
    if (slot < 0) return -1;
    _mark.set(torso.x, torso.y - PARTS[0].c[1], torso.z);
    const placed = this.ragdolls.throwWalker(_mark, detAtan2(v.x, v.z), v, this.art.figureOf(which), slot);
    if (placed < 0) return -1;
    this.away.push({ figure: THROWN, slot: placed, seconds: 0, wander: { x: Infinity, z: Infinity } });
    return placed;
  }

  /** Every thrown dummy goes: his slot is free again. The set's figures knocked over walk on home. */
  clearThrown(): void {
    for (let i = this.away.length - 1; i >= 0; i--) if (this.away[i]!.figure === THROWN) this.sendHome(this.away[i]!);
  }

  /** The dummy in pool slot `slot`, a figure already away (lying, getting up, walking home), is pushed again at `point`: he goes limp where he is, and his way home starts over. */
  knockAgain(slot: number, point: THREE.Vector3, facing: THREE.Vector3): void {
    const away = this.away.find((a) => a.slot === slot);
    if (away === undefined) return;
    away.seconds = 0;
    this.push(slot, point, facing);
  }

  /** The push of a press at `point` facing the way `facing` (a unit vector) points, level with a lift: on the walker in `slot`. */
  private push(slot: number, point: THREE.Vector3, facing: THREE.Vector3): void {
    _push.set(facing.x, 0, facing.z);
    if (_push.lengthSq() < 1e-6) _push.copy(facing);
    this.ragdolls.strikeWalker(slot, point, _push.normalize().setY(SHOWCASE_KNOCK.lift).normalize(), SHOWCASE_KNOCK.speed);
  }

  /** One frame before the ragdoll world steps: each figure away lies, gets up, or walks home. */
  step(wallDt: number): void {
    for (let i = this.away.length - 1; i >= 0; i--) {
      const away = this.away[i]!;
      away.seconds += wallDt;
      const walker = this.ragdolls.walkers[away.slot]!;
      if (!walker.active || (away.wander === null && away.seconds > GIVE_UP) || !this.ragdolls.walkerTorso(_torso, away.slot)) {
        this.sendHome(away);
        continue;
      }
      if (walker.state === "down") walker.ask();
      if (walker.state !== "stand") continue;
      if (away.wander !== null) {
        // Not at his mark by then: something holds him (a parked car in his way), so he takes another.
        if (away.seconds > GIVE_UP) away.wander.x = Infinity;
        if (this.wander(away.wander, walker)) away.seconds = 0;
        continue;
      }
      this.art.markOf(away.figure, _mark);
      const gap = hypot2(_mark.x - _torso.x, _mark.z - _torso.z);
      if (gap > ARRIVED) {
        walker.heading = detAtan2(_mark.x - _torso.x, _mark.z - _torso.z);
        walker.command = Math.min(WALK_SPEED, SLOWEST + gap);
        continue;
      }
      walker.command = 0;
      walker.heading = this.art.yawOf(away.figure);
      if (Math.abs(wrapAngle(walker.heading - walker.facing)) < FACING_BACK && away.seconds >= BUMP_HOLD) this.sendHome(away);
    }
  }

  /** Everyone is on the set (a reset), and no thrown dummy is left in the ragdoll world. */
  reset(): void {
    this.clearThrown();
    this.away.length = 0;
    this.art.stand();
  }

  /** He walks to his mark; arrived (or with none yet), the next is a random point inside the wander circle. Whether a new mark was picked. */
  private wander(mark: { x: number; z: number }, walker: Walker): boolean {
    const next = hypot2(mark.x - _torso.x, mark.z - _torso.z) < ARRIVED || hypot2(mark.x, mark.z) > WANDER_RADIUS - WANDER_EDGE;
    if (next) {
      const radius = (WANDER_RADIUS - WANDER_EDGE) * Math.sqrt(this.random());
      const angle = 2 * Math.PI * this.random();
      mark.x = radius * detSin(angle);
      mark.z = radius * detCos(angle);
    }
    walker.heading = detAtan2(mark.x - _torso.x, mark.z - _torso.z);
    walker.command = WALK_SPEED;
    return next;
  }

  /** `away`'s dummy leaves the pool and the figure stands on his mark again; the slot it freed. */
  private sendHome(away: Away): number {
    this.ragdolls.stopWalker(away.slot);
    if (away.figure !== THROWN) this.art.restore(away.figure);
    this.away.splice(this.away.indexOf(away), 1);
    return away.slot;
  }
}
