import { afterEach, describe, expect, it } from "vitest";
import { hypot2 } from "../kernel/physics-core.js";
import type { FreeDrivers } from "../ai/openworld-traffic/openworld-traffic.ts";
import { OpenWorldTraffic } from "../ai/openworld-traffic/openworld-traffic.ts";
import { NOSE_OVERHANG } from "../ai/openworld-traffic/traffic-constants.ts";
import { LIGHT, lightState, SIGNAL_PHASE } from "../ai/openworld-traffic/traffic-lights.ts";
import { CYCLE_SECONDS } from "../ai/openworld-traffic/traffic-world.test-util.ts";
import type { TrafficPorts } from "../ai/openworld-traffic/traffic-ports.ts";
import { ProximitySight } from "../ai/openworld-traffic/traffic-sight.ts";
import { idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { activeGround, setGround } from "../world/ground.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-course.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { buildParkingSpots } from "../world/openworld/openworld-parking.ts";
import { buildRoadNetwork, HEADING, HEADING_COUNT, junctionIndex } from "../world/openworld/openworld-roads.ts";
import { FRAME, frame, makeWorld, type World } from "../world/race-world.test-util.ts";

const network = buildRoadNetwork(openWorldGeometry(LAYOUT));
const spots = buildParkingSpots(network);
/** A junction away from the lobby's spawn (the first interior crossing), and a trip east along its row across it. */
const junction = junctionIndex(network, 2, 2);
const fromSpot = spots.laneStart[junctionIndex(network, 1, 2) * HEADING_COUNT + HEADING.east]! + 1;
const toSpot = spots.laneStart[junction * HEADING_COUNT + HEADING.east]! + 3;
const barX = network.junctionX[junction]! - network.stopBar;
const ARRIVAL_SECONDS = 90;
const WAIT_SECONDS = 50;
const GO_SECONDS = 25;

afterEach(() => setGround(null));

/** The open world's lobby, with the local player's car seated, and traffic over the world's real cars. */
function openWorldLobby(movers: number): { w: World; traffic: OpenWorldTraffic } {
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
  };
  const traffic = new OpenWorldTraffic([], ports, new ProximitySight(ports), { movers, kerb: 0, patrol: 0 }, null);
  w.race.freeDrivers = traffic;
  return { w, traffic };
}

describe("given the lobby's cars no human drives", () => {
  // mutation: sed -i 's/ && !this.seats.has(i) ? (this.freeDrivers/ ? (this.freeDrivers/' src/game/engine/engine-race.ts
  it("when the free drivers are asked for inputs, then they are asked for the unseated cars only: never the local player's own, never a peer's seat", () => {
    const w = makeWorld();
    w.race.enter(false, true);
    w.race.showLobby(OPENWORLD_ID);
    w.race.setSeats(new Map([[1, "Peer"]]));
    w.race["host"].setCarCount(4);
    w.race.seatLobby(0);
    const asked: number[] = [];
    const drivers: FreeDrivers = {
      drive: () => {},
      inputOf: (id) => {
        asked.push(id);
        return null;
      },
    };
    w.race.freeDrivers = drivers;
    w.race.drive(FRAME);
    expect(asked).toEqual([2, 3]);
  });

  // mutation: sed -i 's/ ? (this.freeDrivers?.inputOf(i, dt) ?? null) : null;/ ? null : null;/' src/game/engine/engine-race.ts
  it("when a free driver gives a car an input, then the lobby applies it where it would have held the car on its brakes", () => {
    const w = makeWorld();
    w.race.enter(false, true);
    w.race.showLobby(OPENWORLD_ID);
    w.race["host"].setCarCount(2);
    w.race.seatLobby(0);
    const input: DriveInput = { ...idleDrive(), throttle: 0.7 };
    w.race.freeDrivers = { drive: () => {}, inputOf: (id) => (id === 1 ? input : null) };
    const car = w.live()[1]!;
    for (let n = 0; n < 60; n++) frame(w, { acc: 0 });
    const held = w.race["hold"].brake;
    expect(held, "the lobby's own hold is a full brake").toBe(1);
    expect(car.drive.throttle, "the throttle the free driver asked").toBeGreaterThan(0);
    expect(car.drive.brake, "no brake held on the driven car").toBeLessThan(held);
  });

  it("when there are no free drivers, then a lobby car is held on its brakes as ever", () => {
    const w = makeWorld();
    w.race.enter(false, true);
    w.race.showLobby(OPENWORLD_ID);
    w.race["host"].setCarCount(2);
    w.race.seatLobby(0);
    expect(w.race.freeDrivers).toBeNull();
    for (let n = 0; n < 60; n++) frame(w, { acc: 0 });
    expect(w.live()[1]!.drive.brake, "the held car's brake").toBe(1);
  });
});

describe("given a real car leased to drive across a signalled junction of the open world", () => {
  function timeShowing(state: number): number {
    for (let seconds = 0; seconds < CYCLE_SECONDS; seconds += 0.5) if (lightState(junction, SIGNAL_PHASE.eastWestThrough, seconds) === state) return seconds;
    throw new Error("no such light");
  }

  /** `seconds` of frames with the signals' clock held at `clock`. */
  function run(w: World, traffic: OpenWorldTraffic, clock: number, seconds: number, each?: () => void): void {
    const state = { acc: 0 };
    for (let n = 0; n < seconds * 60; n++) {
      frame(w, state);
      traffic.step(clock, FRAME);
      each?.();
    }
  }

  function leased(): { w: World; traffic: OpenWorldTraffic; index: number; arrived: () => boolean } {
    const { w, traffic } = openWorldLobby(1);
    const car = traffic.spawnDrivenCar(3, fromSpot, toSpot);
    expect(car, "a car was leased").not.toBeNull();
    return { w, traffic, index: car!.index, arrived: () => car!.arrived };
  }

  // mutation: sed -i 's/if (!urgent) target = Math.min(target, this.signalLimit/if (urgent) target = Math.min(target, this.signalLimit/' src/game/ai/openworld-traffic/traffic-driver.ts
  it("when the light stays red, then the car stops with its nose short of the stop bar", () => {
    const { w, traffic, index } = leased();
    run(w, traffic, timeShowing(LIGHT.red), WAIT_SECONDS);
    const car = w.live()[index]!;
    expect(car.velocity.length(), "speed at the bar").toBeLessThan(0.5);
    expect(car.group.position.x + NOSE_OVERHANG, "the nose against the bar").toBeLessThanOrEqual(barX + 0.5);
    expect(barX - car.group.position.x, "it came up to the bar").toBeLessThan(NOSE_OVERHANG + 8);
  });

  // mutation: sed -i 's/const lateral = network.laneOffset + (network.parkingOffset - network.laneOffset) \* smoothStep(step \/ SWING_STEPS);/const lateral = network.laneOffset;/' src/game/ai/openworld-traffic/trip-route.ts
  it("when the light turns green, then the car that waited goes through and parks in its space", () => {
    const { w, traffic, index, arrived } = leased();
    run(w, traffic, timeShowing(LIGHT.red), WAIT_SECONDS);
    run(w, traffic, timeShowing(LIGHT.green), ARRIVAL_SECONDS);
    const car = w.live()[index]!;
    expect(arrived(), "the car arrived").toBe(true);
    expect(hypot2(car.group.position.x - spots.x[toSpot]!, car.group.position.z - spots.z[toSpot]!), "the car's distance from its space's middle").toBeLessThan(1.5);
    expect(car.velocity.length(), "it stands").toBeLessThan(0.5);
  });

  it("when the light stays green, then the car crosses the junction on its way without stopping", () => {
    const { w, traffic, index } = leased();
    let slowest = Infinity;
    run(w, traffic, timeShowing(LIGHT.green), GO_SECONDS, () => {
      const car = w.live()[index]!;
      if (Math.abs(car.group.position.x - barX) < 8) slowest = Math.min(slowest, car.velocity.length());
    });
    expect(slowest, "slowest speed within 8 m of the bar").toBeGreaterThan(4);
  });
});
