import { afterEach, describe, expect, it } from "vitest";
import { CRIME_STREAM, HOTHEAD_RUN_SHARE } from "../ai/openworld-crime/crime-constants.ts";
import { crimeDraw } from "../ai/openworld-crime/crime-draw.ts";
import { PatrolCars } from "../ai/openworld-crime/patrol-cars.ts";
import { TrafficPatrolPorts } from "../ai/openworld-crime/traffic-patrol-ports.ts";
import { OpenWorldTraffic, type DrivenCar } from "../ai/openworld-traffic/openworld-traffic.ts";
import { LEFT_TURN_SPEED, URGENT_SPEED } from "../ai/openworld-traffic/traffic-constants.ts";
import { ProximitySight } from "../ai/openworld-traffic/traffic-world.test-util.ts";
import type { TrafficPorts } from "../ai/openworld-traffic/traffic-ports.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { wrapPi } from "../kernel/scalar.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { activeGround, setGround } from "../world/ground.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-course.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { buildParkingSpots } from "../world/openworld/openworld-parking.ts";
import { buildRoadNetwork, HEADING, HEADING_COUNT, junctionIndex } from "../world/openworld/openworld-roads.ts";
import type { PropCollider } from "../world/placements.ts";
import { FRAME, frame, makeWorld, type World } from "../world/race-world.test-util.ts";

const network = buildRoadNetwork(openWorldGeometry(LAYOUT));
const spots = buildParkingSpots(network);
/** A kerb space just past the first interior crossing, and the space the patrol car is sent to: the one the trip east along that row ends in. */
const targetSpot = spots.laneStart[junctionIndex(network, 2, 2) * HEADING_COUNT + HEADING.east]! + 3;
/** A left turn through that crossing: a space on the lane east of the crossing before it, to one just north of it. */
const turnFromSpot = spots.laneStart[junctionIndex(network, 1, 2) * HEADING_COUNT + HEADING.east]! + 1;
const turnToSpot = spots.laneStart[junctionIndex(network, 2, 2) * HEADING_COUNT + HEADING.north]! + 2;
const TRIP_SECONDS = 90;
/** A car's half width (m): a prop closer than this to its middle is touched. */
const CAR_HALF_WIDTH = 0.9;
/** A solid whose underside is over this high (m) is a deck or an eave a car passes beneath. */
const OVERHEAD = 2.5;
/** Speed over the turn's cap (m/s) a car may still carry while it is going into the curve, and the yaw rate (rad/s) that tells it is in one. */
const TURN_SLACK = 2;
const TURNING_RATE = 0.7;
/** A curve is at least this many frames of that yaw rate: the row read something. */
const CURVE_FRAMES = 5;
/** Over the whole trip the car's speed stays under the urgent pace by this much slack (m/s). */
const URGENT_SLACK = 3;
/** The patrol car's cop steps out within this far (m) of the space it was sent to. */
const ARRIVE_REACH = 25;
/** A trip's turn is at least this much heading change (rad) in all. */
const TURNED_AT_LEAST = 1;
const CAREFUL_SEED = firstSeed((seed) => crimeDraw(seed, CRIME_STREAM.hothead, 0, 0) >= HOTHEAD_RUN_SHARE);

function firstSeed(ok: (seed: number) => boolean): number {
  for (let seed = 1; seed <= 400; seed++) if (ok(seed)) return seed;
  throw new Error("no seed in 1..400");
}

afterEach(() => setGround(null));

/** The open world's lobby, the local player's car seated, and traffic over the world's real cars, with `patrol` police-bodied cars among its `movers`. */
function openWorldLobby(movers: number, patrol: number): { w: World; traffic: OpenWorldTraffic; colliders: readonly PropCollider[] } {
  const w = makeWorld();
  w.skin = false;
  w.race.enter(false, true);
  w.race.showLobby(OPENWORLD_ID);
  w.race.seatLobby(0);
  const host = w.race["host"];
  const ports: TrafficPorts = {
    cars: () => w.live(),
    ensureCars: (count) => host.setCarCount(count),
    seated: (id) => id === 0,
    place: (id, x, z, yaw) => {
      const car = w.live()[id]!;
      car.stored = false;
      car.group.visible = true;
      car.spawnFacing(x, z, yaw, 0);
      car.group.position.y = activeGround().heightAt(x, z, 0.5);
      layOnGround(car);
      w.dress(car);
    },
    putAway: (id) => {
      const car = w.live()[id]!;
      car.stored = true;
      car.group.visible = false;
      car.spawnFacing(4000 + id * 12, 4000, 0, 0);
    },
    markPolice: () => {},
    sirens: () => {},
    openDoor: () => {},
    groundAt: () => 0,
    setBody: () => {},
    release: (id) => {
      w.live()[id]!.stored = false;
    },
  };
  const traffic = new OpenWorldTraffic([], ports, new ProximitySight(ports), { movers, kerb: 0, patrol, ambulance: 0 }, null);
  w.race.freeDrivers = traffic;
  return { w, traffic, colliders: w.race["colliders"] };
}

/** Whether a car's middle at (x, z) is within its half width of a solid prop the car does not pass beneath. */
function touchesProp(colliders: readonly PropCollider[], x: number, z: number): boolean {
  for (const prop of colliders) {
    if (prop.body !== "solid" || prop.base > OVERHEAD) continue;
    const ex = x - prop.x;
    const ez = z - prop.z;
    if (prop.kind === "circle") {
      if (hypot2(ex, ez) < prop.r + CAR_HALF_WIDTH) return true;
      continue;
    }
    const localX = ex * detCos(prop.yaw) - ez * detSin(prop.yaw);
    const localZ = ex * detSin(prop.yaw) + ez * detCos(prop.yaw);
    if (Math.abs(localX) < prop.hx + CAR_HALF_WIDTH && Math.abs(localZ) < prop.hz + CAR_HALF_WIDTH) return true;
  }
  return false;
}

/** Frames of the world and the traffic until `done` or `TRIP_SECONDS`, `each` after every frame: the crowd's clock is the frames'. */
function run(w: World, traffic: OpenWorldTraffic, step: (clock: number) => void, each: (clock: number) => void, done: () => boolean): void {
  const state = { acc: 0 };
  for (let n = 0; n < TRIP_SECONDS * 60 && !done(); n++) {
    const clock = n * FRAME;
    frame(w, state);
    traffic.step(clock, FRAME);
    step(clock);
    each(clock);
  }
}

describe("given a patrol car sent across a block of the open world's course", () => {
  // mutation: in src/game/ai/openworld-crime/patrol-cars.ts begin(), change `this.ports.setDriver(handle, this.wheel[slot] === 1 ? this.drivers[slot]! : null);` to `this.ports.setDriver(handle, this.drivers[slot]!);`
  it("when it drives, then it follows the streets to the kerb nearest the scene without touching a solid prop, within the urgent pace, and its cop steps out there", () => {
    const { w, traffic, colliders } = openWorldLobby(2, 1);
    let leased: DrivenCar | null = null;
    const lease = traffic.spawnDrivenCar.bind(traffic);
    traffic.spawnDrivenCar = (resident, from, to, options) => {
      leased = lease(resident, from, to, options);
      return leased;
    };
    const arrivals: { x: number; z: number }[] = [];
    const patrol = new PatrolCars(new TrafficPatrolPorts(traffic, () => {}), { arrived: (_caseIndex, x, z) => void arrivals.push({ x, z }), busted: () => {}, delivered: () => {} }, null, 12, CAREFUL_SEED);
    expect(patrol.dispatchToScene(0, spots.x[targetSpot]!, spots.z[targetSpot]!, 0), "a patrol car was leased").toBe(true);
    const index = leased!.index;
    let touched = 0;
    let fastest = 0;
    run(
      w,
      traffic,
      (clock) => patrol.step(clock, FRAME),
      () => {
        const car = w.live()[index]!;
        if (touchesProp(colliders, car.group.position.x, car.group.position.z)) touched++;
        fastest = Math.max(fastest, car.velocity.length());
      },
      () => arrivals.length > 0,
    );
    expect(arrivals.length, "the car came and its cop stepped out").toBe(1);
    expect(hypot2(arrivals[0]!.x - spots.x[targetSpot]!, arrivals[0]!.z - spots.z[targetSpot]!), "within reach of the space it was sent to").toBeLessThan(ARRIVE_REACH);
    expect(touched, "frames with the car touching a solid prop").toBe(0);
    expect(fastest, "its fastest pace").toBeLessThan(URGENT_SPEED + URGENT_SLACK);
  });

  // mutation: in src/game/ai/openworld-traffic/traffic-driver.ts think(), delete the line `target = Math.min(target, this.turnLimit(route, arc));`
  it("when its trip turns a corner, then its speed through the curve stays within the street's turn limit", () => {
    const { w, traffic } = openWorldLobby(2, 1);
    const handle = traffic.spawnDrivenCar(-1, turnFromSpot, turnToSpot, { urgent: true });
    expect(handle, "an urgent trip was leased").not.toBeNull();
    let heading = traffic.snaps[handle!.index]!.yaw;
    let turned = 0;
    let fastestInCurve = 0;
    let curveFrames = 0;
    run(
      w,
      traffic,
      () => {},
      () => {
        const snap = traffic.snaps[handle!.index]!;
        const change = wrapPi(snap.yaw - heading);
        heading = snap.yaw;
        turned += Math.abs(change);
        if (Math.abs(change) / FRAME <= TURNING_RATE) return;
        curveFrames++;
        fastestInCurve = Math.max(fastestInCurve, hypot2(snap.vx, snap.vz));
      },
      () => handle!.arrived,
    );
    expect(turned, "the trip turned a corner").toBeGreaterThan(TURNED_AT_LEAST);
    expect(curveFrames, "frames in the curve").toBeGreaterThan(CURVE_FRAMES);
    expect(fastestInCurve, "fastest pace in the middle of the curve").toBeLessThan(LEFT_TURN_SPEED + TURN_SLACK);
  });
});
