import * as THREE from "three";
import { detAtan2, hypot2 } from "../kernel/physics-core.js";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { SHOWCASE_KNOCK, type ShowcaseArt } from "../present/showcase-art.ts";
import { WALK_SPEED } from "../present/walker-locomotion.ts";
import { wrapAngle } from "../present/walker-math.ts";

/** Within this far (m) of his mark he has arrived; he then turns to his old facing, to within this much (rad), and goes back on the set. */
const ARRIVED = 0.25;
const FACING_BACK = 0.12;
/** A walker that has not got home by then (s) is put back on his mark where he is not: stuck on something, or lost off the set. */
const GIVE_UP = 30;
/** He slows over the last metres: the pace (m/s) never falls under this until he arrives. */
const SLOWEST = 0.5;

/** A figure the ragdoll world has: which one of the set he is, the pool slot his dummy is in, and how long he has been away (s). */
type Away = { figure: number; slot: number; seconds: number };

const _mark = new THREE.Vector3();
const _torso = new THREE.Vector3();
const _push = new THREE.Vector3();

/**
 * The showcase's figures after a press: the figure is knocked at the point the press landed, along the way the camera faces, and his dummy
 * (the ragdoll pool, an active ragdoll as the player on foot is) goes limp and reacts to where it landed; once he has lain a moment he gets up,
 * walks back to his mark and turns to his old facing, and the set takes him back as he stood. A press on a dummy already away knocks him again
 * where he is. The pool holds four: a fifth knock sends the one longest away home at once.
 */
export class ShowcaseWalks {
  private readonly art: ShowcaseArt;
  private readonly ragdolls: RagdollSystem;
  private readonly away: Away[] = [];

  constructor(art: ShowcaseArt, ragdolls: RagdollSystem) {
    this.art = art;
    this.ragdolls = ragdolls;
  }

  /** Whether the dummy in pool slot `slot` is a figure that is away. */
  isAway(slot: number): boolean {
    return this.away.some((a) => a.slot === slot);
  }

  /** Figure `figure` of the set is pushed at the world `point`, the way `facing` (a unit vector: the camera's) points. Whether the ragdoll world took him (not while Rapier loads). */
  knock(figure: number, point: THREE.Vector3, facing: THREE.Vector3): boolean {
    let slot = this.ragdolls.freeSlot();
    if (slot < 0 && this.away.length > 0) slot = this.sendHome(this.away[0]!);
    if (slot < 0) return false;
    this.art.markOf(figure, _mark);
    const dress = this.art.figureOf(figure);
    const placed = this.ragdolls.startWalker(_mark, this.art.yawOf(figure), dress, slot);
    if (placed < 0) return false;
    this.away.push({ figure, slot: placed, seconds: 0 });
    this.art.take(figure);
    this.push(placed, point, facing);
    return true;
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
      if (!walker.active || away.seconds > GIVE_UP || !this.ragdolls.walkerTorso(_torso, away.slot)) {
        this.sendHome(away);
        continue;
      }
      if (walker.state === "down") walker.ask();
      if (walker.state !== "stand") continue;
      this.art.markOf(away.figure, _mark);
      const gap = hypot2(_mark.x - _torso.x, _mark.z - _torso.z);
      if (gap > ARRIVED) {
        walker.heading = detAtan2(_mark.x - _torso.x, _mark.z - _torso.z);
        walker.command = Math.min(WALK_SPEED, SLOWEST + gap);
        continue;
      }
      walker.command = 0;
      walker.heading = this.art.yawOf(away.figure);
      if (Math.abs(wrapAngle(walker.heading - walker.facing)) < FACING_BACK) this.sendHome(away);
    }
  }

  /** Everyone is on the set (a reset). */
  reset(): void {
    this.away.length = 0;
    this.art.stand();
  }

  /** `away`'s dummy leaves the pool and the figure stands on his mark again; the slot it freed. */
  private sendHome(away: Away): number {
    this.ragdolls.stopWalker(away.slot);
    this.art.restore(away.figure);
    this.away.splice(this.away.indexOf(away), 1);
    return away.slot;
  }
}
