import { hypot2 } from "../../kernel/physics-core.js";
import type { WalkGraph } from "../../world/openworld/walk-graph.ts";
import type { PathFinder } from "../civilians/walk-path.ts";
import { CAR_COP, CAR_COP_BACK_REACH, COP_PATROL_SPEED, COP_REPLAN_STEPS, COP_RUN_SPEED, CRIME_STEP_SECONDS, ESCORT_SPEED, CRIME_STREAM, FOOT_COP_COUNT, PATROL_COPS, STRAIGHT_APPROACH } from "./crime-constants.ts";
import { crimeDraw } from "./crime-draw.ts";
import type { FootWalkers } from "./foot-walkers.ts";

export const COP_MODE = { patrol: 0, respond: 1, grip: 2, returning: 3, off: 4, escort: 5, down: 6 } as const;

/** The foot cops: walkers 0 .. FOOT_COP_COUNT - 1. The ones on patrol wander the sidewalks on seeded turns; a case calls the nearest free ones, who run to what they are aimed at. */
export class FootCops {
  readonly mode = new Uint8Array(FOOT_COP_COUNT).fill(COP_MODE.patrol);
  /** The case each cop serves, -1 on patrol or off. */
  readonly caseOf = new Int8Array(FOOT_COP_COUNT).fill(-1);
  readonly aimX = new Float64Array(FOOT_COP_COUNT);
  readonly aimZ = new Float64Array(FOOT_COP_COUNT);
  private readonly walkers: FootWalkers;
  private readonly graph: WalkGraph;
  private readonly finder: PathFinder;
  private readonly noFear: Float32Array;
  private readonly seed: number;
  private readonly previousNode = new Int32Array(FOOT_COP_COUNT).fill(-1);
  private readonly patrolDraws = new Uint32Array(FOOT_COP_COUNT);
  private carHomeX = 0;
  private carHomeZ = 0;
  /** Per cop: where his beat starts, and the crowd second a car's knock leaves him off the street until. */
  private readonly beatNode = new Int32Array(FOOT_COP_COUNT);
  private readonly downUntil = new Float64Array(FOOT_COP_COUNT);

  constructor(walkers: FootWalkers, graph: WalkGraph, finder: PathFinder, seed: number) {
    this.walkers = walkers;
    this.graph = graph;
    this.finder = finder;
    this.noFear = new Float32Array(graph.nodeX.length);
    this.seed = seed;
    const nodeCount = graph.nodeX.length;
    for (let cop = 0; cop < PATROL_COPS; cop++) {
      const node = Math.min(nodeCount - 1, Math.floor(crimeDraw(seed, CRIME_STREAM.patrolStart, cop, 0) * nodeCount));
      this.beatNode[cop] = node;
      walkers.place(cop, graph.nodeX[node]!, graph.nodeZ[node]!);
    }
    this.mode[CAR_COP] = COP_MODE.off;
  }

  /** The patrolling cop nearest (x, z), the lower number on a tie; -1 when none is free. */
  nearestFree(x: number, z: number): number {
    let best = -1;
    let bestGap = Infinity;
    for (let cop = 0; cop < FOOT_COP_COUNT; cop++) {
      if (this.mode[cop] !== COP_MODE.patrol || this.caseOf[cop] !== -1) continue;
      const gap = hypot2(this.walkers.x[cop]! - x, this.walkers.z[cop]! - z);
      if (gap >= bestGap) continue;
      bestGap = gap;
      best = cop;
    }
    return best;
  }

  /** Cop `cop` answers case `caseIndex`. */
  assign(cop: number, caseIndex: number): void {
    this.caseOf[cop] = caseIndex;
    this.mode[cop] = COP_MODE.respond;
    this.walkers.halt(cop);
  }

  /** Whether cop `cop` is out on the street: not in his car, not down from a car's knock. */
  onStreet(cop: number): boolean {
    return this.mode[cop] !== COP_MODE.off && this.mode[cop] !== COP_MODE.down;
  }

  /** Cop `cop` goes back to patrol; the car's cop runs back to where it stepped out, to its car. A cop down stays down. */
  release(cop: number): void {
    this.caseOf[cop] = -1;
    if (this.mode[cop] === COP_MODE.down) return;
    this.walkers.halt(cop);
    if (cop !== CAR_COP) this.mode[cop] = COP_MODE.patrol;
    else if (this.onStreet(cop)) this.mode[cop] = COP_MODE.returning;
  }

  /** The car's cop steps out of its car at (x, z) for case `caseIndex`. */
  emerge(x: number, z: number, caseIndex: number): void {
    this.walkers.place(CAR_COP, x, z);
    this.aimX[CAR_COP] = x;
    this.aimZ[CAR_COP] = z;
    this.carHomeX = x;
    this.carHomeZ = z;
    this.assign(CAR_COP, caseIndex);
  }

  /** Cop `cop` takes hold of whoever it reached: it stands. */
  grip(cop: number): void {
    this.mode[cop] = COP_MODE.grip;
    this.walkers.halt(cop);
    this.walkers.speed[cop] = 0;
  }

  /** A car ran cop `cop` down: he is off the street until crowd second `until`, his case's work dropped. */
  knockDown(cop: number, until: number): void {
    this.caseOf[cop] = -1;
    this.mode[cop] = COP_MODE.down;
    this.downUntil[cop] = until;
    this.walkers.halt(cop);
    this.walkers.speed[cop] = 0;
  }

  /** Cop `cop` leads a cuffed suspect at a walk to (x, z). */
  escort(cop: number, x: number, z: number): void {
    this.mode[cop] = COP_MODE.escort;
    this.aimX[cop] = x;
    this.aimZ[cop] = z;
    this.walkers.halt(cop);
  }

  /** Cop `cop` runs again for its case. */
  resume(cop: number): void {
    this.mode[cop] = COP_MODE.respond;
  }

  gapTo(cop: number, x: number, z: number): number {
    return hypot2(this.walkers.x[cop]! - x, this.walkers.z[cop]! - z);
  }

  /** One grid step of cop `cop`. */
  step(cop: number, stepIndex: number): void {
    switch (this.mode[cop]) {
      case COP_MODE.patrol:
        this.patrol(cop);
        break;
      case COP_MODE.respond:
        this.run(cop, stepIndex, COP_RUN_SPEED);
        break;
      case COP_MODE.escort:
        this.run(cop, stepIndex, ESCORT_SPEED);
        break;
      case COP_MODE.returning:
        this.aimX[cop] = this.carHomeX;
        this.aimZ[cop] = this.carHomeZ;
        this.run(cop, stepIndex, COP_RUN_SPEED);
        if (this.gapTo(cop, this.carHomeX, this.carHomeZ) <= CAR_COP_BACK_REACH) this.mode[cop] = COP_MODE.off;
        break;
      case COP_MODE.grip:
        this.walkers.speed[cop] = 0;
        this.walkers.face(cop, this.aimX[cop]!, this.aimZ[cop]!);
        break;
      case COP_MODE.down:
        if (stepIndex * CRIME_STEP_SECONDS >= this.downUntil[cop]!) this.getUp(cop);
        break;
      default:
        this.walkers.speed[cop] = 0;
    }
  }

  /** Back from a knock: a patrol cop at his beat's start, the car's cop in his car. */
  private getUp(cop: number): void {
    if (cop === CAR_COP) {
      this.mode[cop] = COP_MODE.off;
      return;
    }
    const node = this.beatNode[cop]!;
    this.walkers.place(cop, this.graph.nodeX[node]!, this.graph.nodeZ[node]!);
    this.mode[cop] = COP_MODE.patrol;
  }

  /** The next sidewalk node on a seeded turn, not straight back the way it came unless it must. */
  private patrol(cop: number): void {
    const walkers = this.walkers;
    if (!walkers.hasRoute(cop)) {
      const node = walkers.nearestNode(walkers.x[cop]!, walkers.z[cop]!);
      const { edgeStart, edgeTo } = this.graph;
      const degree = edgeStart[node + 1]! - edgeStart[node]!;
      if (degree === 0) return;
      const turn = this.patrolDraws[cop]!;
      this.patrolDraws[cop] = turn + 1;
      let pick = Math.floor(crimeDraw(this.seed, CRIME_STREAM.patrolTurn, cop, turn) * degree);
      if (degree > 1 && edgeTo[edgeStart[node]! + pick] === this.previousNode[cop]) pick = (pick + 1) % degree;
      this.previousNode[cop] = node;
      walkers.goToNode(cop, edgeTo[edgeStart[node]! + pick]!);
    }
    walkers.advance(cop, COP_PATROL_SPEED * CRIME_STEP_SECONDS, CRIME_STEP_SECONDS);
  }

  /** Along the sidewalks to the aim's nearest node, replanned a few times a second as the aim moves; the last metres straight. */
  private run(cop: number, stepIndex: number, speed: number): void {
    const walkers = this.walkers;
    const aimX = this.aimX[cop]!;
    const aimZ = this.aimZ[cop]!;
    const distance = speed * CRIME_STEP_SECONDS;
    if (hypot2(walkers.x[cop]! - aimX, walkers.z[cop]! - aimZ) <= STRAIGHT_APPROACH) {
      walkers.halt(cop);
      walkers.moveToward(cop, aimX, aimZ, distance, CRIME_STEP_SECONDS);
      return;
    }
    if (!walkers.hasRoute(cop) || (stepIndex + cop) % COP_REPLAN_STEPS === 0) walkers.plan(cop, this.finder, walkers.nearestNode(aimX, aimZ), this.noFear, 0);
    walkers.advance(cop, distance, CRIME_STEP_SECONDS);
  }
}
