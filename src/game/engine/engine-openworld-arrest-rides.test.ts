import { describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import { ACTIVITY, ACTIVITY_SECONDS } from "../ai/civilians/civilian-activity.ts";
import { ARREST_PLAYER_RESIDENT, EVENT_KIND } from "../ai/civilians/civilian-constants.ts";
import { queueEvents } from "../ai/civilians/civilian-events.ts";
import { createCityState } from "../ai/civilians/society.ts";
import { ESCORT_TO, SUBJECT_MODE } from "../ai/openworld-crime/case-table.ts";
import { harness, IDLE_FOOT_ARREST, NODE_SPACING, runFor, runUntil, STATION_NODE, type Harness, type Ride } from "../ai/openworld-crime/crime-fixture.test-util.ts";
import type { FakeStreet } from "../ai/openworld-crime/crime-street.test-util.ts";
import { launch, pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { ArrestRides } from "./engine-openworld-arrest-rides.ts";
import { OpenWorldDirector, type OpenWorldPorts } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildFixtureMap();
const CRIMINAL = 1;
const CRIME_X = 60;
const STATION_X = STATION_NODE * NODE_SPACING;
/** How far (m) short of the station's door the guest's car stands, so the pair have some way to walk in. */
const CAR_SHORT_OF_DOOR_M = 12;
/** The longest any stage of the arrest takes in these rows (s). */
const STAGE_LIMIT_SECONDS = 120;
/** The car's index in the engine's list: the one patrol car of the host's street, the one car of the guest's. */
const CAR = 0;
/** A car this peer does not have. */
const MISSING_CAR = 7;

function streetOf(run: Harness): FakeStreet {
  must(run.street, "the harness has a street");
  return run.street;
}

/** A crime at x = 60 with a cop standing on it and a patrol car that reaches the scene before the cuffs are on, on a map with a station: the host's arrest rides to the station in that car. */
function hostArrest(): Harness {
  const run = harness([CRIME_X, 0, 0], { station: true, withCars: true });
  streetOf(run).leaseAt = { x: CRIME_X, z: -20, yaw: 0 };
  run.offences.x[CRIMINAL] = CRIME_X;
  run.offences.commitCrime(CRIMINAL);
  return run;
}

/** The same crime on a client's law: no patrol cars, only the real `car` it hears the host's pair board and leave. */
function guestArrest(car: DeformableCar): { guest: Harness; rides: ArrestRides } {
  const rides = new ArrestRides(() => [car]);
  const guest = harness([CRIME_X, 0, 0], { station: true, authority: false, rides });
  guest.offences.x[CRIMINAL] = CRIME_X;
  guest.offences.commitCrime(CRIMINAL);
  return { guest, rides };
}

/** The host's log of rides or alightings as the engine writes it: the resident, then the car, at one second. */
function logOf(kind: number, ...told: readonly Ride[]): Float64Array {
  return Float64Array.from(told.flatMap((ride) => [kind, ride.resident, ride.seconds, kind, ride.car, ride.seconds]));
}

/** The host's arrest run until the pair has boarded, and then until it has got out at the station. */
function hostTold(): { rode: Ride; alighted: Ride } {
  const run = hostArrest();
  runUntil(run, STAGE_LIMIT_SECONDS, () => run.rodes.length > 0);
  runUntil(run, STAGE_LIMIT_SECONDS, () => run.alighteds.length > 0);
  return { rode: run.rodes[0]!, alighted: run.alighteds[0]! };
}

function runUntilLawSecond(run: Harness, seconds: number): void {
  runUntil(run, STAGE_LIMIT_SECONDS, () => run.scene.foot.seconds >= seconds);
}

/** Tells the guest's law of `log` at its own crowd second. */
function hear(guest: Harness, rides: ArrestRides, log: Float64Array): void {
  rides.hear(log, guest.scene.foot.arrests, guest.scene.foot.seconds);
}

/** A car standing `CAR_SHORT_OF_DOOR_M` short of the station's door with its door shut: where the host's car delivers the pair. */
function carAtStation(): DeformableCar {
  const car = pooledCar(0);
  launch(car, STATION_X - CAR_SHORT_OF_DOOR_M, 0, 0, 0, 0);
  car.setDoorOpen(DRIVER_SIDE, 0);
  return car;
}

describe("given the host's arrest of a civilian by a patrol car that has come, on a map with a police station", () => {
  // mutation: sed -i '/      this.hooks.rode(slot, cars.carIndexOf(car));/d' src/game/ai/openworld-crime/arrests.ts
  it("when the pair has got into the car, then the engine is told once of the resident and the car's place in its list", () => {
    const run = hostArrest();
    runUntil(run, STAGE_LIMIT_SECONDS, () => run.rodes.length > 0);
    expect(run.rodes, "told once").toHaveLength(1);
    expect(run.rodes[0]?.resident, "who").toBe(CRIMINAL);
    expect(run.rodes[0]?.car, "which car").toBe(CAR);
    expect(run.scene.foot.table.mode[0], "she is in the car as it is told").toBe(SUBJECT_MODE.conveyed);
    expect(run.alighteds, "nobody has got out").toHaveLength(0);
  });

  // mutation: sed -i '/      this.hooks.alighted(slot, cars.carIndexOf(carSlot));/d' src/game/ai/openworld-crime/arrests.ts
  it("when the car has come to the station, then the engine is told once more, later, that she gets out of the same car", () => {
    const { rode, alighted } = hostTold();
    expect(alighted.resident, "who").toBe(CRIMINAL);
    expect(alighted.car, "which car").toBe(CAR);
    expect(alighted.seconds, "after the ride began").toBeGreaterThan(rode.seconds);
  });
});

describe("given the player on foot held by a cop and taken to the station in the cop's own patrol car", () => {
  // mutation: sed -i 's/this.table.isPlayerSlot(slot) ? ARREST_PLAYER_RESIDENT :/false ? ARREST_PLAYER_RESIDENT :/' src/game/ai/openworld-crime/foot-law.ts
  it("when the pair has got into the car, then the engine is told of the player's own arrest by the resident no one is", () => {
    const run = harness([40, 0, 0], { station: true, withCars: true });
    const street = streetOf(run);
    street.homeCars = 3;
    street.leaseAt = { x: -300, z: 0, yaw: Math.PI / 2 };
    run.signals.against = true;
    run.scene.setFoot(true, 65, 0, 1, 0, 0);
    runUntil(run, STAGE_LIMIT_SECONDS, () => run.rodes.length > 0);
    expect(run.rodes[0]?.resident, "no resident").toBe(ARREST_PLAYER_RESIDENT);
  });
});

describe("given a client whose own law is walking an arrested civilian to the station on foot while the host drives her there", () => {
  // mutation: sed -i '/    this.cops.ride(cop);$/d' src/game/ai/openworld-crime/arrests.ts
  it("when it reads the host's ride, then she is conveyed in that car, off the street, with her cop riding", () => {
    const { rode } = hostTold();
    const { guest, rides } = guestArrest(carAtStation());
    const { table, cops } = guest.scene.foot;
    runUntilLawSecond(guest, rode.seconds);
    expect(table.mode[0], "on her way on foot until the ride is heard").toBe(SUBJECT_MODE.escorted);
    hear(guest, rides, logOf(EVENT_KIND.arrestRide, rode));
    runFor(guest, 0.2);
    expect(table.mode[0], "in the car").toBe(SUBJECT_MODE.conveyed);
    expect(table.carOf[0], "that car").toBe(CAR);
    expect(guest.poses.shown[CRIMINAL], "off the street").toBe(0);
    expect(cops.onStreet(table.holder[0]!), "her cop with her").toBe(false);
  });

  // mutation: sed -i 's/      if (when > seconds) return;/      if (when > seconds + 1000) return;/' src/game/engine/engine-openworld-arrest-rides.ts
  it("when the ride is in the log before this peer's law has reached its second, then she is seated only once it has", () => {
    const { rode } = hostTold();
    const { guest, rides } = guestArrest(carAtStation());
    const { table } = guest.scene.foot;
    runUntilLawSecond(guest, rode.seconds - 1);
    hear(guest, rides, logOf(EVENT_KIND.arrestRide, rode));
    expect(table.mode[0], "not yet").toBe(SUBJECT_MODE.escorted);
    runUntilLawSecond(guest, rode.seconds);
    hear(guest, rides, logOf(EVENT_KIND.arrestRide, rode));
    expect(table.mode[0], "now").toBe(SUBJECT_MODE.conveyed);
  });

  // mutation: sed -i 's/      this.handledAtNewest = sameSecond;/      this.handledAtNewest = 0;/' src/game/engine/engine-openworld-arrest-rides.ts
  it("when the log that seated her is read again while she is led away in a later arrest, then the old ride seats her no more", () => {
    const { rode } = hostTold();
    const { guest, rides } = guestArrest(carAtStation());
    const { table } = guest.scene.foot;
    const log = logOf(EVENT_KIND.arrestRide, rode);
    runUntilLawSecond(guest, rode.seconds);
    hear(guest, rides, log);
    expect(table.mode[0], "seated by the ride").toBe(SUBJECT_MODE.conveyed);
    table.mode[0] = SUBJECT_MODE.escorted;
    hear(guest, rides, log);
    expect(table.mode[0], "the heard ride is not heard again").toBe(SUBJECT_MODE.escorted);
  });

  // mutation: sed -i 's/    this.cars()\[car\]?.setDoorOpen(DRIVER_SIDE, radians);/    this.cars()[car]?.setDoorOpen(DRIVER_SIDE, 0);/' src/game/engine/engine-openworld-arrest-rides.ts
  // mutation: sed -i '/private noteRide/{n;d}' src/game/ai/openworld-crime/foot-law.ts
  it("when it reads the host's alighting at the station, then she and her cop get out at the car's door, its door swinging, and walk in at the station, telling the engine of nothing", () => {
    const { rode, alighted } = hostTold();
    const car = carAtStation();
    const { guest, rides } = guestArrest(car);
    const { table } = guest.scene.foot;
    runUntilLawSecond(guest, rode.seconds);
    hear(guest, rides, logOf(EVENT_KIND.arrestRide, rode));
    runUntilLawSecond(guest, alighted.seconds);
    hear(guest, rides, logOf(EVENT_KIND.arrestAlight, alighted));
    runFor(guest, 1);
    expect(table.mode[0], "getting out").toBe(SUBJECT_MODE.alighting);
    expect(guest.poses.activity[CRIMINAL], "her clip").toBe(ACTIVITY.carOut);
    expect(car.doorHinge(DRIVER_SIDE).theta, "the door is open").toBeGreaterThan(0.1);
    runFor(guest, ACTIVITY_SECONDS.carOut);
    expect(table.mode[0], "led on").toBe(SUBJECT_MODE.escorted);
    expect(table.escortTo[0], "to the station's door").toBe(ESCORT_TO.station);
    runUntil(guest, STAGE_LIMIT_SECONDS, () => table.mode[0] === SUBJECT_MODE.free);
    expect(table.mode[0], "she has walked in: gone from the street").toBe(SUBJECT_MODE.free);
    expect(guest.alighteds, "a client tells the engine of nothing").toHaveLength(0);
  });

  // mutation: sed -i 's/ || !this.hooks.cars()?.doorSpot(carIndex, this.door)) return false;/) return false;/' src/game/ai/openworld-crime/arrests.ts
  it("when the log names a car this peer does not have, or the player's own arrest, then nothing changes", () => {
    const { rode } = hostTold();
    const { guest, rides } = guestArrest(carAtStation());
    const { table } = guest.scene.foot;
    runUntilLawSecond(guest, rode.seconds);
    hear(guest, rides, logOf(EVENT_KIND.arrestRide, { ...rode, car: MISSING_CAR }, { ...rode, resident: ARREST_PLAYER_RESIDENT }));
    expect(table.mode[0], "still led on foot").toBe(SUBJECT_MODE.escorted);
    expect(table.carOf[0], "in no car").toBe(-1);
  });
});

describe("given the host's log with rides and alightings among the other events", () => {
  const BUST = [EVENT_KIND.bust, 5, 100];

  // mutation: sed -i 's/  return (kind === EVENT_KIND.knock || kind === EVENT_KIND.crime/  return (kind === EVENT_KIND.arrestRide || kind === EVENT_KIND.arrestAlight || kind === EVENT_KIND.knock || kind === EVENT_KIND.crime/' src/game/ai/civilians/civilian-events.ts
  it("when the brain queues it, then it has the bust alone: the same as without them", () => {
    const told: Ride = { resident: 3, car: 1, seconds: 100 };
    const withRides = createCityState(9, map, 60);
    queueEvents(withRides, 0, Float64Array.from([...logOf(EVENT_KIND.arrestRide, told), ...logOf(EVENT_KIND.arrestAlight, told), ...BUST]));
    const bare = createCityState(9, map, 60);
    queueEvents(bare, 0, Float64Array.from(BUST));
    expect(bare.events, "the control: the bust is queued").toHaveLength(1);
    expect(withRides.events, "and only the bust with the rides").toHaveLength(1);
    expect(withRides.events[0]?.kind, "the bust").toBe(EVENT_KIND.bust);
    expect(withRides.events[0]?.subject, "of her").toBe(BUST[1]);
    expect(firstMismatch(withRides.hiddenUntilTick, bare.hiddenUntilTick), "the same custody").toBeUndefined();
  });
});

/** The police's engine ports with no course solids, nobody to bust and no light bars. */
function idleLawPorts(): NonNullable<OpenWorldPorts["law"]> {
  return { solids: () => null, playerBusted: () => {}, sirens: () => {}, lineOfSight: () => true, footArrest: IDLE_FOOT_ARREST };
}

/** A director with police in the open world on the fixture map, past its first frame: a client that has heard a host's clock, or a solo host. */
function lawDirector(client: boolean): OpenWorldDirector {
  const director = new OpenWorldDirector({ ...idleOpenWorldPorts(), isClient: () => client, makeArt: () => ({ update: () => {}, dispose: () => {} }), law: idleLawPorts() });
  director.startOpenWorld(map);
  if (client) director.hear(5, 1000, 40, new Float64Array(0));
  director.step(FRAME_SECONDS);
  director.frame(FRAME_SECONDS);
  return director;
}

/** The times the law reads the host's rides in one more frame of a director. */
function ridesReadInAFrame(client: boolean): number {
  const director = lawDirector(client);
  let reads = 0;
  director["law"]!["rides"]!.hear = () => void reads++;
  director.step(FRAME_SECONDS);
  director.frame(FRAME_SECONDS);
  return reads;
}

describe("given the open world's director with police", () => {
  // mutation: sed -i 's/      this.law?.hearRides();//' src/game/engine/engine-openworld.ts
  it("when it is a client's frame, then the law reads the host's rides from the crowd's log, and a host's frame reads none", () => {
    expect(ridesReadInAFrame(true), "a client reads once a frame").toBe(1);
    expect(ridesReadInAFrame(false), "a host has none to read").toBe(0);
  });

  // mutation: sed -i '/    this.crowd.raiseEvent(kind, carIndex, seconds);/d' src/game/engine/engine-openworld-law.ts
  it("when the host's law tells of a ride and an alighting, then the crowd's log has each as two entries of one kind at one second: the resident, then the car", () => {
    const director = lawDirector(false);
    const ports = director["law"]!["scene"]["ports"];
    ports.rode(5, 2, 7.5);
    ports.alighted(6, 3, 9);
    const told = Float64Array.of(EVENT_KIND.arrestRide, 5, 7.5, EVENT_KIND.arrestRide, 2, 7.5, EVENT_KIND.arrestAlight, 6, 9, EVENT_KIND.arrestAlight, 3, 9);
    const log = director["crowd"]!.eventLog();
    expect(firstMismatch(log.subarray(log.length - told.length), told), "the log's newest four entries").toBeUndefined();
  });
});
