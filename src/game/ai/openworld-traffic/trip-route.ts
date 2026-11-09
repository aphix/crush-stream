import { hypot2 } from "../../kernel/physics-core.js";
import { clamp } from "../../kernel/scalar.ts";
import { HEADING_COUNT, HEADING_DX, HEADING_DZ, laneLength, rightX, rightZ, type RoadNetwork } from "../../world/openworld/openworld-roads.ts";
import { laneOfSpot, type ParkingSpots } from "../../world/openworld/openworld-parking.ts";
import { CRUISE_SPEED, LEFT_TURN_SPEED, PARK_SPEED, PARK_SWING, RIGHT_TURN_SPEED, ROUTE_POINTS, ROUTE_SIGNALS, TURN_PENALTY, TURN_STEPS } from "./traffic-constants.ts";
import { phaseOfApproach } from "./traffic-lights.ts";

/** Points of a swing between the lane and a space. */
const SWING_STEPS = 5;
/** A space ahead on the same lane needs this much room (m) for a pull-out, a straight and a pull-in; nearer, the trip is a loop round the block. */
const AHEAD_MINIMUM = 2 * PARK_SWING + 3;
/** Lanes a trip chains at most: a corner to corner trip on the 4 x 4 grid with a loop round a block. */
const LANES_PER_TRIP = 24;
/** Turn codes: the heading step from the lane a car leaves to the lane it takes. */
const TURN = { straight: 0, right: 1, left: 3 } as const;
const TURNS = [TURN.straight, TURN.right, TURN.left] as const;
/** Route points nearer than this to the last (m) are the same point. */
const SAME_POINT = 0.05;

/** A car's way: points along its lanes, through its turns, into the space it is going to, and the signals it crosses. Filled by `RoutePlanner`, read by the driver. */
export class TripRoute {
  readonly x = new Float32Array(ROUTE_POINTS);
  readonly z = new Float32Array(ROUTE_POINTS);
  /** Distance (m) along the route to each point. */
  readonly arc = new Float32Array(ROUTE_POINTS);
  /** The fastest (m/s) a car may go at each point. */
  readonly cap = new Float32Array(ROUTE_POINTS);
  count = 0;
  /** Per signal: the arc (m) of its stop bar and of the box's edge, its junction and the phase that serves the car. */
  readonly barArc = new Float32Array(ROUTE_SIGNALS);
  readonly boxArc = new Float32Array(ROUTE_SIGNALS);
  readonly signalJunction = new Int16Array(ROUTE_SIGNALS);
  readonly signalPhase = new Uint8Array(ROUTE_SIGNALS);
  signalCount = 0;

  get length(): number {
    return this.count === 0 ? 0 : this.arc[this.count - 1]!;
  }

  clear(): void {
    this.count = 0;
    this.signalCount = 0;
  }
}

/** Where a car is on its route: the segment it is on, the arc length (m) of the nearest point and how far (m) the route lies to the left of it (+). */
type RouteProjection = { segment: number; arc: number; lateral: number };

export function blankRouteProjection(): RouteProjection {
  return { segment: 0, arc: 0, lateral: 0 };
}

/** The nearest point of the route at or after `hint`'s segment; never looks back, so a car's progress only grows. */
export function projectOnRoute(route: TripRoute, x: number, z: number, hint: number, out: RouteProjection): void {
  let segment = clamp(hint, 0, Math.max(0, route.count - 2));
  while (segment < route.count - 2) {
    const dx = route.x[segment + 1]! - route.x[segment]!;
    const dz = route.z[segment + 1]! - route.z[segment]!;
    const along = ((x - route.x[segment]!) * dx + (z - route.z[segment]!) * dz) / (dx * dx + dz * dz);
    if (along < 1) break;
    segment++;
  }
  const dx = route.x[segment + 1]! - route.x[segment]!;
  const dz = route.z[segment + 1]! - route.z[segment]!;
  const length = hypot2(dx, dz);
  const along = clamp(((x - route.x[segment]!) * dx + (z - route.z[segment]!) * dz) / (length * length), 0, 1);
  out.segment = segment;
  out.arc = route.arc[segment]! + along * length;
  out.lateral = ((route.x[segment]! + dx * along - x) * dz - (route.z[segment]! + dz * along - z) * dx) / length;
}

/** The point `arc` m along the route (clamped to its ends) and the unit direction there, searching on from `segment`. Returns the segment it was found on. */
export function pointAtArc(route: TripRoute, arc: number, segment: number, out: { x: number; z: number; tx: number; tz: number }): number {
  let k = clamp(segment, 0, Math.max(0, route.count - 2));
  while (k < route.count - 2 && route.arc[k + 1]! < arc) k++;
  while (k > 0 && route.arc[k]! > arc) k--;
  const dx = route.x[k + 1]! - route.x[k]!;
  const dz = route.z[k + 1]! - route.z[k]!;
  const length = route.arc[k + 1]! - route.arc[k]!;
  const along = clamp((arc - route.arc[k]!) / length, 0, 1);
  out.x = route.x[k]! + dx * along;
  out.z = route.z[k]! + dz * along;
  out.tx = dx / length;
  out.tz = dz / length;
  return k;
}

function smoothStep(share: number): number {
  return share * share * (3 - 2 * share);
}

/** Plans trips over the lanes: the cheapest chain of lanes from one space's lane to another's (a turn costs `TURN_PENALTY` m), then the points and signals along it. Allocates only at construction. */
export class RoutePlanner {
  private readonly network: RoadNetwork;
  private readonly spots: ParkingSpots;
  private readonly lanes: number;
  private readonly cost: Float32Array;
  private readonly previous: Int16Array;
  private readonly settled: Uint8Array;
  private readonly chain = new Int16Array(LANES_PER_TRIP);
  private chainCount = 0;
  private route: TripRoute = new TripRoute();

  constructor(network: RoadNetwork, spots: ParkingSpots) {
    this.network = network;
    this.spots = spots;
    this.lanes = network.junctionCount * HEADING_COUNT;
    this.cost = new Float32Array(this.lanes);
    this.previous = new Int16Array(this.lanes);
    this.settled = new Uint8Array(this.lanes);
  }

  /** Writes the route from space `fromSpot` to space `toSpot` into `route`; false when there is none (the same space, or a chain longer than a trip holds). */
  plan(route: TripRoute, fromSpot: number, toSpot: number): boolean {
    route.clear();
    if (fromSpot === toSpot) return false;
    this.route = route;
    const start = laneOfSpot(this.spots, fromSpot);
    const goal = laneOfSpot(this.spots, toSpot);
    const ahead = start === goal && this.spots.along[toSpot]! >= this.spots.along[fromSpot]! + AHEAD_MINIMUM;
    if (ahead) {
      this.chain[0] = start;
      this.chainCount = 1;
    } else if (!this.search(start, goal)) return false;
    this.emitPullOut(fromSpot);
    for (let index = 0; index < this.chainCount - 1; index++) this.emitLaneEnd(index);
    this.emitPullIn(toSpot);
    return route.count < ROUTE_POINTS;
  }

  /** Dijkstra over lanes from `start` to `goal`, the goal reached by at least one turn (a space behind the car's own is a trip round the block). Fills `chain`. */
  private search(start: number, goal: number): boolean {
    const { network } = this;
    this.cost.fill(Infinity);
    this.settled.fill(0);
    this.previous.fill(-1);
    this.cost[start] = 0;
    let loopCost = Infinity;
    let loopFrom = -1;
    for (;;) {
      let lane = -1;
      let best = Infinity;
      for (let candidate = 0; candidate < this.lanes; candidate++) {
        if (this.settled[candidate] === 1 || this.cost[candidate]! >= best) continue;
        best = this.cost[candidate]!;
        lane = candidate;
      }
      if (lane < 0 || (lane === goal && lane !== start)) break;
      this.settled[lane] = 1;
      const heading = lane % HEADING_COUNT;
      const next = network.neighbour[lane]!;
      for (let turnIndex = 0; turnIndex < TURNS.length; turnIndex++) {
        const turn = TURNS[turnIndex]!;
        const target = next * HEADING_COUNT + ((heading + turn) % HEADING_COUNT);
        if (network.neighbour[target]! < 0) continue;
        const through = best + laneLength(network, heading) + (turn === TURN.straight ? 0 : TURN_PENALTY);
        if (target === start && start === goal) {
          if (through < loopCost) {
            loopCost = through;
            loopFrom = lane;
          }
        } else if (through < this.cost[target]!) {
          this.cost[target] = through;
          this.previous[target] = lane;
        }
      }
    }
    const loop = start === goal;
    if (loop ? loopFrom < 0 : this.cost[goal] === Infinity) return false;
    let count = 0;
    let lane = loop ? loopFrom : goal;
    while (lane >= 0 && count < LANES_PER_TRIP - 1) {
      this.chain[count++] = lane;
      lane = this.previous[lane]!;
    }
    if (lane >= 0) return false;
    this.chain.subarray(0, count).reverse();
    if (loop) this.chain[count++] = goal;
    this.chainCount = count;
    return true;
  }

  private push(x: number, z: number, cap: number): void {
    const route = this.route;
    const last = route.count - 1;
    if (last >= 0 && hypot2(x - route.x[last]!, z - route.z[last]!) < SAME_POINT) {
      route.cap[last] = Math.min(route.cap[last]!, cap);
      return;
    }
    if (route.count >= ROUTE_POINTS) return;
    route.x[route.count] = x;
    route.z[route.count] = z;
    route.cap[route.count] = cap;
    route.arc[route.count] = last < 0 ? 0 : route.arc[last]! + hypot2(x - route.x[last]!, z - route.z[last]!);
    route.count++;
  }

  /** The ground point `along` m ahead of junction `junction`'s centre in `heading` and `lateral` m to its right. */
  private laneX(junction: number, heading: number, along: number, lateral: number): number {
    return this.network.junctionX[junction]! + HEADING_DX[heading]! * along + rightX(heading) * lateral;
  }

  private laneZ(junction: number, heading: number, along: number, lateral: number): number {
    return this.network.junctionZ[junction]! + HEADING_DZ[heading]! * along + rightZ(heading) * lateral;
  }

  private pushOnLane(junction: number, heading: number, along: number, lateral: number, cap: number): void {
    this.push(this.laneX(junction, heading, along, lateral), this.laneZ(junction, heading, along, lateral), cap);
  }

  private emitPullOut(spot: number): void {
    const { network, spots } = this;
    const junction = spots.junction[spot]!;
    const heading = spots.heading[spot]!;
    for (let step = 0; step <= SWING_STEPS; step++) {
      const lateral = network.parkingOffset + (network.laneOffset - network.parkingOffset) * smoothStep(step / SWING_STEPS);
      this.pushOnLane(junction, heading, spots.along[spot]! + (PARK_SWING * step) / SWING_STEPS, lateral, PARK_SPEED);
    }
  }

  /** Lane `index` of the chain ends at a junction: the box's edge, the signal there, and the turn into the next lane. */
  private emitLaneEnd(index: number): void {
    const { network, route } = this;
    const lane = this.chain[index]!;
    const heading = lane % HEADING_COUNT;
    const junction = network.neighbour[lane]!;
    const nextHeading = this.chain[index + 1]! % HEADING_COUNT;
    const turn = (nextHeading - heading + HEADING_COUNT) % HEADING_COUNT;
    const cap = turn === TURN.straight ? CRUISE_SPEED : turn === TURN.right ? RIGHT_TURN_SPEED : LEFT_TURN_SPEED;
    const offset = network.laneOffset;
    this.pushOnLane(junction, heading, -network.boxHalf, offset, cap);
    if (route.signalCount < ROUTE_SIGNALS) {
      const signal = route.signalCount++;
      route.boxArc[signal] = route.arc[route.count - 1]!;
      route.barArc[signal] = route.boxArc[signal]! - (network.stopBar - network.boxHalf);
      route.signalJunction[signal] = junction;
      route.signalPhase[signal] = phaseOfApproach(heading, turn === TURN.left);
    }
    const toX = this.laneX(junction, nextHeading, network.boxHalf, offset);
    const toZ = this.laneZ(junction, nextHeading, network.boxHalf, offset);
    if (turn === TURN.straight) {
      this.push(toX, toZ, cap);
      return;
    }
    // The incoming and outgoing lane lines cross at the curve's control point; the incoming line meets the outgoing one `offset` ahead or behind the junction's centre.
    const crossing = offset * (rightX(nextHeading) * HEADING_DX[heading]! + rightZ(nextHeading) * HEADING_DZ[heading]!);
    const controlX = this.laneX(junction, heading, crossing, offset);
    const controlZ = this.laneZ(junction, heading, crossing, offset);
    const fromX = route.x[route.count - 1]!;
    const fromZ = route.z[route.count - 1]!;
    for (let step = 1; step <= TURN_STEPS; step++) {
      const share = step / TURN_STEPS;
      const keep = 1 - share;
      this.push(keep * keep * fromX + 2 * keep * share * controlX + share * share * toX, keep * keep * fromZ + 2 * keep * share * controlZ + share * share * toZ, cap);
    }
  }

  /** The last lane runs to where the swing into the space begins, then swings into it and ends on its middle. */
  private emitPullIn(spot: number): void {
    const { network, spots } = this;
    const junction = spots.junction[spot]!;
    const heading = spots.heading[spot]!;
    const swingStart = spots.along[spot]! - PARK_SWING;
    this.pushOnLane(junction, heading, swingStart, network.laneOffset, CRUISE_SPEED);
    for (let step = 1; step <= SWING_STEPS; step++) {
      const lateral = network.laneOffset + (network.parkingOffset - network.laneOffset) * smoothStep(step / SWING_STEPS);
      this.pushOnLane(junction, heading, swingStart + (PARK_SWING * step) / SWING_STEPS, lateral, PARK_SPEED);
    }
  }
}
