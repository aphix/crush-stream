import { describe, expect, it } from "vitest";
import { idleDrive } from "../../vehicle/car-drive.ts";
import { blankAiCar } from "../derby-ai.ts";
import { PATROL_START_DISTANCE } from "./crime-constants.ts";
import { TrafficPatrolPorts, type LeasedCar, type TrafficApi } from "./traffic-patrol-ports.ts";

const PATROL_CAR_INDEX = 1;
const TRAFFIC_CAR_INDEX = 2;
const TRAFFIC_RESIDENT = 9;

/** A traffic with kerb spaces along x = 0, 40, 110, 200 and 300 m, a patrol-sized lease at car 1 and a driven car at index 2. */
function fakeTraffic() {
  const calls: string[] = [];
  const leased: LeasedCar = { index: PATROL_CAR_INDEX, arrived: false, driver: null };
  const driven: LeasedCar = { index: TRAFFIC_CAR_INDEX, arrived: false, driver: null };
  const sirens = (carIndex: number, on: boolean): void => void calls.push(`sirens ${carIndex} ${on}`);
  const traffic: TrafficApi = {
    parkingSpots: { count: 5, x: [0, 40, PATROL_START_DISTANCE, 200, 300], z: [0, 0, 0, 0, 0] },
    snaps: [blankAiCar(0), blankAiCar(1), blankAiCar(2)],
    patrolPool: 2,
    driverDoorSpotOf: () => false,
    openDriverDoor: () => undefined,
    nearestSpot: () => 0,
    onRedLightRun: () => () => undefined,
    spawnDrivenCar: (resident, from, to, options) => {
      calls.push(`spawn ${resident} ${from} ${to} ${options?.urgent === true}`);
      return leased;
    },
    despawn: () => void calls.push("despawn"),
    redirect: (_handle, spot) => {
      calls.push(`redirect ${spot}`);
      return spot !== 3;
    },
    drivenCarAt: (carIndex) => (carIndex === TRAFFIC_CAR_INDEX ? driven : null),
    evade: (carIndex, chaserIndex) => {
      calls.push(`evade ${carIndex} ${chaserIndex}`);
      return carIndex === TRAFFIC_CAR_INDEX;
    },
    endEvade: (carIndex) => void calls.push(`endEvade ${carIndex}`),
    residentOf: (carIndex) => (carIndex === TRAFFIC_CAR_INDEX ? TRAFFIC_RESIDENT : -1),
  };
  return { traffic, calls, leased, driven, sirens };
}

describe("the patrol cars' cars come from the traffic's pool", () => {
  it("leases an urgent car from the space about a patrol start away to the space nearest the scene", () => {
    const { traffic, calls, sirens } = fakeTraffic();
    const ports = new TrafficPatrolPorts(traffic, sirens);
    expect(ports.lease(0, 0), "the first slot").toBe(0);
    expect(calls[0], "from the 110 m space to space 0, urgent, for no resident").toBe("spawn -1 2 0 true");
  });

  it("drives the leased car through its handle and gives it back when let go", () => {
    const { traffic, calls, leased, sirens } = fakeTraffic();
    const ports = new TrafficPatrolPorts(traffic, sirens);
    const slot = ports.lease(0, 0);
    const driver = () => idleDrive();
    ports.setDriver(slot, driver);
    ports.setSirens(slot, true);
    expect(leased.driver, "the traffic applies this driver").toBe(driver);
    expect(calls.at(-1), "the light bar of the leased car").toBe(`sirens ${PATROL_CAR_INDEX} true`);
    expect(ports.snap(slot), "the car as the cops see it").toBe(traffic.snaps[PATROL_CAR_INDEX]);
    ports.release(slot);
    expect(calls.at(-1)).toBe("despawn");
    expect(ports.lease(0, 0), "the slot is free again").toBe(0);
  });

  // mutation: in src/game/ai/openworld-crime/traffic-patrol-ports.ts redirect(), change `this.traffic.redirect(this.leased[handle]!, to)` to `false`
  it("re-aims a leased car at the kerb space nearest a point, and says when the traffic cannot", () => {
    const { traffic, calls, sirens } = fakeTraffic();
    const ports = new TrafficPatrolPorts(traffic, sirens);
    const slot = ports.lease(0, 0);
    expect(ports.redirect(slot, 50, 0), "the traffic re-planned").toBe(true);
    expect(calls.at(-1), "to the space nearest the point").toBe("redirect 0");
    traffic.nearestSpot = () => 3;
    expect(ports.redirect(slot, 50, 0), "the traffic has no way").toBe(false);
    traffic.nearestSpot = () => -1;
    expect(ports.redirect(slot, 50, 0), "no space near the point").toBe(false);
  });

  it("stops a traffic car through its handle and leaves the player's car alone", () => {
    const { traffic, driven, sirens } = fakeTraffic();
    const ports = new TrafficPatrolPorts(traffic, sirens);
    const driver = () => idleDrive();
    expect(ports.takeTraffic(TRAFFIC_CAR_INDEX, driver)).toBe(true);
    expect(driven.driver).toBe(driver);
    expect(ports.takeTraffic(0, driver), "the player's car is not the traffic's").toBe(false);
    expect(ports.driverOf(TRAFFIC_CAR_INDEX)).toBe(TRAFFIC_RESIDENT);
    expect(ports.driverOf(0), "nobody at the player's wheel").toBe(-1);
  });
});

describe("the patrol cars tell the traffic whom they chase", () => {
  // mutation: in src/game/ai/openworld-crime/traffic-patrol-ports.ts evade(), change `this.leased[chaserHandle]!.index` to `chaserHandle`
  it("names the chasing car by its engine index, and ends the evasion by the chased car's", () => {
    const { traffic, calls, sirens } = fakeTraffic();
    const ports = new TrafficPatrolPorts(traffic, sirens);
    const slot = ports.lease(0, 0);
    expect(ports.evade(TRAFFIC_CAR_INDEX, slot), "a traffic car").toBe(true);
    expect(calls.at(-1), "the leased car's engine index, not its slot").toBe(`evade ${TRAFFIC_CAR_INDEX} ${PATROL_CAR_INDEX}`);
    expect(ports.evade(0, slot), "the player's car is not the traffic's").toBe(false);
    ports.endEvade(TRAFFIC_CAR_INDEX);
    expect(calls.at(-1)).toBe(`endEvade ${TRAFFIC_CAR_INDEX}`);
  });
});

