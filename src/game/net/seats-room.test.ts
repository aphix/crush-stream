import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { OpenWorldActs } from "../engine/engine-openworld-acts.ts";
import type { ActorPlace } from "../engine/engine-openworld-law.ts";
import { OpenWorldSeats } from "../engine/engine-openworld-seats.ts";
import { doorSpot } from "../engine/onfoot-doors.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { setGround } from "../world/ground.ts";
import { frame, makeWorld } from "../world/race-world.test-util.ts";
import { SeatTable } from "../scenes/seat-table.ts";
import { ACT } from "./act-codec.ts";
import { FRAME_MS, Hub } from "./net-hub.test-util.ts";
import { NetPlay } from "./net-play.ts";
import { worldGame } from "./net-world-game.test-util.ts";
import { packSeats, SEATS_NOTICE } from "./seats-codec.ts";

const PARKED = 3;
const PASSENGER_DOOR = -DRIVER_SIDE;
const TORSO_UP = 1;
/** Net frames (1/30 s) the host's grace for a peer that left runs, and a car driven this long must have moved this far (m). */
const GRACE_FRAMES = 360;
const DROVE_M = 3;

const open: NetPlay[] = [];
afterEach(() => {
  for (const net of open.splice(0)) net.leave();
  setGround(null);
});

/** A host and two guests in a room of the open world, the host with the seat functions over its cars and a parked fourth car to take. */
function room() {
  const hub = new Hub();
  let now = 1000;
  const worlds = [makeWorld(), makeWorld(), makeWorld()];
  const tables = [new SeatTable(), new SeatTable(), new SeatTable()];
  const places = new Map<number, ActorPlace>();
  const roster = new Set<number>();
  const hostWorld = worlds[0]!;
  const seats = new OpenWorldSeats({
    cars: () => hostWorld.live(),
    poles: () => [],
    place: (actor, out) => {
      const place = places.get(actor);
      if (place) Object.assign(out, place);
      return place !== undefined;
    },
    active: () => true,
    peer: (actor) => roster.has(actor),
    self: () => 0,
    guest: () => false,
    canTake: (car) => car === PARKED,
    taken: () => {},
    gas: () => 0,
    now: () => now / 1000,
    sendAct: () => {},
  });
  const acts = new OpenWorldActs(
    { actorPlace: (actor, out) => (places.has(actor) ? (Object.assign(out, places.get(actor)), true) : false), now: () => now / 1000, self: () => 0, guest: () => false, face: () => {}, layGun: () => false, sendAct: () => {}, seatedCar: (actor) => seats.table.carOf(actor), getIn: (actor, car) => seats.getIn(actor, car), getOut: (actor) => seats.getOut(actor), hookFire: () => {}, hookCut: () => {}, hookReel: () => {} },
    { punch: () => {}, shoot: () => 0, meet: () => 0, wallBetween: () => false, placeNamed: () => false, shotFired: () => {} },
  );
  tables[0] = seats.table;
  const hostGame = worldGame(hostWorld, "Ann", () => null, (actor, act) => acts.hear(actor, act), seats.table).game;
  const setSeats = hostGame.setSeats;
  hostGame.setSeats = (map) => {
    roster.clear();
    for (const car of map.keys()) roster.add(car);
    setSeats(map);
  };
  hostWorld.race.drivers = (car) => seats.table.driverOf(car);
  const host = new NetPlay(hostGame, { connect: hub.connect, now: () => now });
  const guests = [1, 2].map((n) => new NetPlay(worldGame(worlds[n]!, `Guest ${n}`, () => null, () => 0, tables[n]!).game, { connect: hub.connect, now: () => now }));
  open.push(host, ...guests);
  host.hostRoom({ kind: "openworld", code: "R", tx: "bc", minPlayers: 1, course: "", playlist: [], autoNext: true });
  for (const guest of guests) guest.join("R", "bc");
  hostWorld.race["host"].setCarCount(4);
  const clock = { acc: 0 };
  const step = (n: number): void => {
    for (let k = 0; k < n; k++) {
      now += FRAME_MS;
      frame(hostWorld, clock);
      frame(hostWorld, clock);
      seats.frame(FRAME_MS / 1000);
      host.frame(FRAME_MS / 1000);
      for (const guest of guests) guest.frame(FRAME_MS / 1000);
      hub.flush();
    }
  };
  step(90);
  return { worlds, tables, places, seats, host, guests, step };
}

type Room = ReturnType<typeof room>;

/** Guest `n` stands on foot at the door at x sign `side` of the parked car and asks to get in. */
function asksAtDoor(r: Room, n: number, side: number): void {
  r.tables[0]!.leave(n);
  const spot = doorSpot(r.worlds[0]!.live()[PARKED]!, new THREE.Vector3(), side);
  r.places.set(n, { x: spot.x, y: spot.y + TORSO_UP, z: spot.z, heading: 0, velocityX: 0, velocityZ: 0 });
  r.guests[n - 1]!.sendAct(ACT.getIn, PARKED, { x: spot.x, y: spot.y + TORSO_UP, z: spot.z }, { x: 0, y: 0, z: 1 });
  r.step(15);
}

/** The three machines' tables as the same bytes. */
function agree(r: Room): boolean {
  const [host, one, two] = r.tables.map((table) => Array.from(packSeats(table, SEATS_NOTICE.none)));
  return firstMismatch(host!, one!) === undefined && firstMismatch(host!, two!) === undefined;
}

describe("given a host and two guests in a room of the open world, and a parked car", () => {
  it("when guest 1 takes the driver's seat of the parked car and holds the throttle, then all three machines hold one seat table and the car drives on the host's input from him", () => {
    const r = room();
    expect(agree(r), "everyone starts in his own car, the same on all three").toBe(true);
    asksAtDoor(r, 1, DRIVER_SIDE);
    expect(r.tables[0]!.driverOf(PARKED), "the host's table").toBe(1);
    expect(agree(r), "the guests' copies").toBe(true);
    const gw = r.worlds[1]!;
    gw.race.adoptCar(PARKED);
    gw.seat.focus(PARKED);
    gw.seat.mode = "drive";
    const from = r.worlds[0]!.live()[PARKED]!.group.position.clone();
    gw.seat.sample(new Set(["KeyW"]), null);
    r.step(90);
    expect(r.worlds[0]!.live()[PARKED]!.group.position.distanceTo(from), "the host's car drove (m)").toBeGreaterThan(DROVE_M);
  });

  it("when guest 2 gets in beside him and then guest 1 leaves the room, then the other two machines see guest 1's seat free", () => {
    const r = room();
    asksAtDoor(r, 1, DRIVER_SIDE);
    asksAtDoor(r, 2, PASSENGER_DOOR);
    expect(r.tables[0]!.seatOf(2), "beside the driver on the host").toBe(1);
    expect(r.tables[2]!.seatOf(2), "and on his own machine").toBe(1);
    expect(agree(r)).toBe(true);
    r.guests[0]!.leave();
    r.step(GRACE_FRAMES);
    expect(r.tables[0]!.carOf(1), "the host frees it").toBe(-1);
    expect(r.tables[2]!.carOf(1), "and guest 2 sees it free").toBe(-1);
    expect(r.tables[2]!.holderOf(PARKED, 1), "his own seat stays").toBe(2);
  });

  it("when a guest far from every door asks to get in, then he is refused: nothing changes on any machine", () => {
    const r = room();
    r.tables[0]!.leave(1);
    r.places.set(1, { x: 5000, y: 1, z: 5000, heading: 0, velocityX: 0, velocityZ: 0 });
    r.guests[0]!.sendAct(ACT.getIn, PARKED, { x: 5000, y: 1, z: 5000 }, { x: 0, y: 0, z: 1 });
    r.step(15);
    expect(r.tables[0]!.carOf(1), "he sits nowhere").toBe(-1);
    expect(r.tables[1]!.carOf(1), "nor on his machine").toBe(-1);
  });
});
