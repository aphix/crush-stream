import * as THREE from "three";
import { afterEach, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { ACT } from "../net/act-codec.ts";
import { SEATS_NOTICE } from "../net/seats-codec.ts";
import { DeformableCar } from "../vehicle/car.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { paint } from "../vehicle/test-support.ts";
import { setGround } from "../world/ground.ts";
import type { ActorPlace } from "./engine-openworld-acts.ts";
import { ASK, OpenWorldSeats } from "./engine-openworld-seats.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { SeatTable } from "../scenes/seat-table.ts";
import { doorSpot } from "./onfoot-doors.ts";

/** The cars the room starts with: the host's (0), three guests' (1 to 3) and two parked ones to take (4: a sedan, 5: a regular-cab pickup), side by side, far enough apart that no door is near another car. */
const STYLES: readonly CarStyleId[] = ["sedan", "sedan", "sedan", "sedan", "sedan", "pickup"];
const SPACING_M = 12;
const PARKED_SEDAN = 4;
const PARKED_PICKUP = 5;
const PASSENGER_DOOR = -DRIVER_SIDE;
const FAR_FROM_EVERY_DOOR_M = 7;
/** A frame at 60 Hz (s), and the seconds a door needs to swing wide and to shut again. */
const FRAME_S = 1 / FRAME_HZ;
const SWING_OPEN_S = 0.4;
const SWING_SHUT_S = 3;
const WIDE_RAD = 0.5;

afterEach(() => setGround(null));

/** A car of `id` at rest at (x, 0) facing +z. */
function carAt(id: CarStyleId, x: number): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.spawnFacing(x, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  return car;
}

/** What a row holds of the room: the cars, where each player on foot stands, the cars the traffic was told to let go, the room's switches, and the seats under test with their table. */
interface Fixture {
  cars: DeformableCar[];
  places: Map<number, ActorPlace>;
  taken: number[];
  state: { self: number; peers: Set<number>; parked: Set<number>; gas: number; now: number; active: boolean };
  seats: OpenWorldSeats;
  table: SeatTable;
}

/** The host's seats over real cars: the room's players are actors 0 (this machine's) to 3, each sitting in his own car after the first frame; cars 4 and 5 stand parked, free to take. */
function fixture(): Fixture {
  const cars = STYLES.map((id, i) => carAt(id, i * SPACING_M));
  const places = new Map<number, ActorPlace>();
  const taken: number[] = [];
  const state = { self: 0, peers: new Set([0, 1, 2, 3]), parked: new Set([PARKED_SEDAN, PARKED_PICKUP]), gas: 0, now: 0, active: true };
  const seats = new OpenWorldSeats({
    cars: () => cars,
    poles: () => [],
    place: (actor, out) => {
      const place = places.get(actor);
      if (place) Object.assign(out, place);
      return place !== undefined;
    },
    active: () => state.active,
    peer: (actor) => state.peers.has(actor),
    self: () => state.self,
    guest: () => false,
    canTake: (car) => state.parked.has(car),
    taken: (car) => void taken.push(car),
    gas: () => state.gas,
    now: () => state.now,
    sendAct: (kind) => expect.fail(`a host sends no act (${kind})`),
  });
  seats.frame(0);
  return { cars, places, taken, state, seats, table: seats.table };
}


/** Actor `actor` is on foot at the door at x sign `side` of car `car`. */
function standAt(f: Fixture, actor: number, car: number, side: number): void {
  const spot = doorSpot(f.cars[car]!, new THREE.Vector3(), side);
  f.places.set(actor, { x: spot.x, y: spot.y + 1, z: spot.z, heading: 0 });
}

/** Actor `actor` is on foot (his seat is free), at the door at x sign `side` of car `car`. */
function walkUp(f: Fixture, actor: number, car: number, side: number): void {
  f.table.leave(actor);
  standAt(f, actor, car, side);
}

function run(f: Fixture, seconds: number): void {
  for (let t = 0; t < seconds; t += FRAME_S) f.seats.frame(FRAME_S);
}

describe("given a room whose players each sit in their own car and a parked sedan and pickup", () => {
  it("when a player on foot at the passenger door of the parked sedan gets in, then he is at its wheel, that door and not the driver's swings open and shuts behind him, and the car is his for good", () => {
    const f = fixture();
    walkUp(f, 0, PARKED_SEDAN, PASSENGER_DOOR);
    expect(f.seats.getIn(0, PARKED_SEDAN)).toBe(SEATS_NOTICE.none);
    expect(f.table.driverOf(PARKED_SEDAN), "he drives it").toBe(0);
    run(f, SWING_OPEN_S);
    expect(f.cars[PARKED_SEDAN]!.doorAngle(PASSENGER_DOOR), "the passenger door").toBeGreaterThan(WIDE_RAD);
    expect(f.cars[PARKED_SEDAN]!.doorAngle(DRIVER_SIDE), "the driver's door").toBe(0);
    expect(f.taken.length, "the traffic lets one car go").toBe(1);
    expect(f.taken[0], "the one he took").toBe(PARKED_SEDAN);
    run(f, SWING_SHUT_S);
    expect(f.cars[PARKED_SEDAN]!.doorAngle(PASSENGER_DOOR), "shut behind him").toBe(0);
  });

  for (const door of [DRIVER_SIDE, PASSENGER_DOOR]) {
    it(`when a second player gets in at the ${door === DRIVER_SIDE ? "driver's" : "passenger"} door of the car the first drives, then he sits in the other front seat`, () => {
      const f = fixture();
      walkUp(f, 1, 0, door);
      expect(f.seats.getIn(1, 0)).toBe(SEATS_NOTICE.none);
      expect(f.table.driverOf(0), "the first still drives").toBe(0);
      expect(f.table.holderOf(0, 1), "the other front seat").toBe(1);
    });
  }

  it("when a third and a fourth get in, then they fill the rear row of a sedan, each on the side of his door", () => {
    const f = fixture();
    walkUp(f, 1, 0, PASSENGER_DOOR);
    walkUp(f, 2, 0, DRIVER_SIDE);
    walkUp(f, 3, 0, PASSENGER_DOOR);
    for (const actor of [1, 2, 3]) expect(f.seats.getIn(actor, 0), `actor ${actor}`).toBe(SEATS_NOTICE.none);
    expect([f.table.seatOf(1), f.table.seatOf(2), f.table.seatOf(3)], "front passenger, rear driver's side, rear other side").toEqual([1, 2, 3]);
  });

  it("when a third gets in beside two in a pickup, which has no rear row, then he is refused and the table does not change", () => {
    const f = fixture();
    walkUp(f, 0, PARKED_PICKUP, DRIVER_SIDE);
    walkUp(f, 1, PARKED_PICKUP, PASSENGER_DOOR);
    walkUp(f, 2, PARKED_PICKUP, DRIVER_SIDE);
    f.seats.getIn(0, PARKED_PICKUP);
    f.seats.getIn(1, PARKED_PICKUP);
    const version = f.table.version;
    expect(f.seats.getIn(2, PARKED_PICKUP), "no seat").toBe(SEATS_NOTICE.noCar);
    expect(f.table.version, "nothing changed").toBe(version);
    expect(f.table.carOf(2), "he sits nowhere").toBe(-1);
  });

  it("when two players ask for the same seat, then the first asked has it and the second gets the next seat by the fill rule", () => {
    const f = fixture();
    walkUp(f, 1, PARKED_SEDAN, DRIVER_SIDE);
    walkUp(f, 2, PARKED_SEDAN, DRIVER_SIDE);
    f.seats.getIn(1, PARKED_SEDAN);
    f.seats.getIn(2, PARKED_SEDAN);
    expect(f.table.driverOf(PARKED_SEDAN), "the first asked drives").toBe(1);
    expect(f.table.seatOf(2), "the second sits in the other front seat").toBe(1);
  });

  it("when a player farther than the reach from every door asks while another stands at the door, then he is refused, nothing changes for him and the one at the door is seated", () => {
    const f = fixture();
    walkUp(f, 1, PARKED_SEDAN, DRIVER_SIDE);
    walkUp(f, 2, PARKED_SEDAN, DRIVER_SIDE);
    const away = f.places.get(2)!;
    f.places.set(2, { ...away, z: away.z + FAR_FROM_EVERY_DOOR_M });
    expect(f.seats.getIn(2, PARKED_SEDAN), "too far").toBe(SEATS_NOTICE.noCar);
    expect(f.table.carOf(2), "he sits nowhere").toBe(-1);
    expect(f.seats.getIn(1, PARKED_SEDAN), "the one at the door").toBe(SEATS_NOTICE.none);
    expect(f.table.driverOf(PARKED_SEDAN)).toBe(1);
  });

  it("when a car has a driver of its own (the traffic's), then no player may take its wheel, and a passenger may not get in either", () => {
    const f = fixture();
    f.state.parked.delete(PARKED_SEDAN);
    walkUp(f, 1, PARKED_SEDAN, DRIVER_SIDE);
    expect(f.seats.getIn(1, PARKED_SEDAN)).toBe(SEATS_NOTICE.noCar);
    expect(f.table.carOf(1)).toBe(-1);
  });

  it("when a car rolls faster than a person may step into, then he is told to stop it first", () => {
    const f = fixture();
    walkUp(f, 1, PARKED_SEDAN, DRIVER_SIDE);
    f.cars[PARKED_SEDAN]!.velocity.set(0, 0, 4);
    expect(f.seats.getIn(1, PARKED_SEDAN)).toBe(SEATS_NOTICE.tooFast);
  });
});

describe("given players seated in a car", () => {
  it("when a passenger gets out, then his seat is free and the door on his seat's side swings open for him", () => {
    const f = fixture();
    walkUp(f, 1, 0, PASSENGER_DOOR);
    f.seats.getIn(1, 0);
    expect(f.seats.getOut(1)).toBe(SEATS_NOTICE.none);
    expect(f.table.holderOf(0, 1), "the seat is free again").toBe(-1);
    run(f, SWING_OPEN_S);
    expect(f.cars[0]!.doorAngle(PASSENGER_DOOR), "his door").toBeGreaterThan(WIDE_RAD);
    expect(f.cars[0]!.doorAngle(DRIVER_SIDE), "not the driver's").toBe(0);
  });

  it("when a passenger in the rear gets out, then it is by the door on his seat's side", () => {
    const f = fixture();
    for (const [actor, door] of [[1, PASSENGER_DOOR], [2, DRIVER_SIDE]] as const) {
      walkUp(f, actor, 0, door);
      f.seats.getIn(actor, 0);
    }
    expect(f.table.seatOf(2), "the rear seat on the driver's side").toBe(2);
    f.seats.getOut(2);
    run(f, SWING_OPEN_S);
    expect(f.cars[0]!.doorAngle(DRIVER_SIDE), "the driver's side door").toBeGreaterThan(WIDE_RAD);
  });

  it("when the driver gets out and the passenger presses the throttle, then the passenger slides into the driver's seat, and without the throttle he stays where he is", () => {
    const f = fixture();
    walkUp(f, 1, 0, PASSENGER_DOOR);
    f.seats.getIn(1, 0);
    f.seats.getOut(0);
    f.state.self = 1;
    run(f, 1);
    expect(f.table.seatOf(1), "no throttle: still in the front passenger seat").toBe(1);
    f.state.gas = 1;
    f.state.now = 5;
    run(f, FRAME_S * 2);
    expect(f.table.driverOf(0), "the throttle takes the wheel").toBe(1);
    expect(f.table.holderOf(0, 1), "the seat he left is free").toBe(-1);
  });

  it("when the driver is thrown out, then his seat is free and the passenger stays seated", () => {
    const f = fixture();
    walkUp(f, 1, 0, PASSENGER_DOOR);
    f.seats.getIn(1, 0);
    f.seats.driverEjected(0);
    expect(f.table.driverOf(0), "the driver is out").toBe(-1);
    expect(f.table.holderOf(0, 1), "the passenger stays").toBe(1);
  });

  it("when a car with a passenger and no driver is asked about, then a player on foot may not take its wheel", () => {
    const f = fixture();
    walkUp(f, 1, 0, PASSENGER_DOOR);
    f.seats.getIn(1, 0);
    f.seats.getOut(0);
    walkUp(f, 2, 0, DRIVER_SIDE);
    expect(f.seats.mayEnter(2, 0)).toBe(false);
  });

  it("when a player asks to get out of a car he does not sit in, then nothing happens", () => {
    const f = fixture();
    f.table.leave(1);
    const version = f.table.version;
    expect(f.seats.getOut(1)).toBe(SEATS_NOTICE.noCar);
    expect(f.table.version).toBe(version);
  });

  it("when a guest on foot asks for a car, then the ask goes to the host as one get-in act with the car's index and his torso, and no seat changes here", () => {
    const sent: { kind: number; arg: number; x: number }[] = [];
    const f = fixture();
    const place = { x: 1, y: 1, z: 2, heading: 0 };
    const guest = new OpenWorldSeats({
      cars: () => f.cars,
      poles: () => [],
      place: (_actor, out) => {
        Object.assign(out, place);
        return true;
      },
      active: () => true,
      peer: () => false,
      self: () => 1,
      guest: () => true,
      canTake: () => true,
      taken: () => expect.fail("a guest takes no car"),
      gas: () => 0,
      now: () => 0,
      sendAct: (kind, arg, eye) => void sent.push({ kind, arg, x: eye.x }),
    });
    expect(guest.askIn(PARKED_SEDAN), "he waits for the host").toBe(ASK.sent);
    expect(sent.length, "one act").toBe(1);
    expect(sent[0]!.kind, "a get-in").toBe(ACT.getIn);
    expect(sent[0]!.arg, "of that car").toBe(PARKED_SEDAN);
    expect(sent[0]!.x, "from his torso").toBe(1);
    expect(guest.table.count, "nobody sits here until the host says").toBe(0);
  });
});

describe("given a player's own car and the car he last drove", () => {
  it("when guest 1 is on foot beside his car (a car the traffic never offers), then the host at its driver's door is refused the wheel and guest 1 himself gets it", () => {
    const f = fixture();
    walkUp(f, 1, 1, DRIVER_SIDE);
    standAt(f, 0, 1, DRIVER_SIDE);
    f.table.leave(0);
    expect(f.seats.getIn(0, 1), "the host").toBe(SEATS_NOTICE.noCar);
    expect(f.table.carOf(0), "he sits nowhere").toBe(-1);
    expect(f.seats.getIn(1, 1), "its owner").toBe(SEATS_NOTICE.none);
    expect(f.table.driverOf(1)).toBe(1);
  });

  it("when a player drove a parked car and stepped out, then, the traffic port refusing the car, the seats let him take it again and refuse another player", () => {
    const f = fixture();
    walkUp(f, 0, PARKED_SEDAN, DRIVER_SIDE);
    f.seats.getIn(0, PARKED_SEDAN);
    f.seats.getOut(0);
    f.state.parked.delete(PARKED_SEDAN);
    walkUp(f, 2, PARKED_SEDAN, DRIVER_SIDE);
    standAt(f, 0, PARKED_SEDAN, DRIVER_SIDE);
    expect(f.seats.getIn(2, PARKED_SEDAN), "another player").toBe(SEATS_NOTICE.noCar);
    expect(f.seats.getIn(0, PARKED_SEDAN), "the one who drove it").toBe(SEATS_NOTICE.none);
  });
});

describe("given a car whose driver was thrown out", () => {
  it("when a player gets in at its wheel, then the car is driven again", () => {
    const f = fixture();
    f.cars[PARKED_SEDAN]!.driverOut = "windshield";
    walkUp(f, 1, PARKED_SEDAN, DRIVER_SIDE);
    expect(f.seats.getIn(1, PARKED_SEDAN)).toBe(SEATS_NOTICE.none);
    expect(f.cars[PARKED_SEDAN]!.driverOut, "nobody is out of it now").toBeNull();
  });

  it("when its passenger presses the throttle with the driver's seat empty, then he is at the wheel and the car is driven again", () => {
    const f = fixture();
    walkUp(f, 1, 0, PASSENGER_DOOR);
    f.seats.getIn(1, 0);
    f.seats.getOut(0);
    f.cars[0]!.driverOut = "windshield";
    f.state.self = 1;
    f.state.gas = 1;
    f.state.now = 5;
    run(f, FRAME_S * 2);
    expect(f.table.driverOf(0), "at the wheel").toBe(1);
    expect(f.cars[0]!.driverOut, "driven again").toBeNull();
  });
});

describe("given a swing begun in the open world", () => {
  it("when the open world is left and entered again with the cars reset, then the swing writes no door of the new session", () => {
    const f = fixture();
    walkUp(f, 0, PARKED_SEDAN, PASSENGER_DOOR);
    f.seats.getIn(0, PARKED_SEDAN);
    run(f, FRAME_S * 3);
    expect(f.cars[PARKED_SEDAN]!.doorAngle(PASSENGER_DOOR), "control: the door has begun to open").toBeGreaterThan(0);
    f.state.active = false;
    run(f, FRAME_S);
    f.cars[PARKED_SEDAN]!.setDoorOpen(PASSENGER_DOOR, 0);
    f.state.active = true;
    run(f, 1);
    expect(f.cars[PARKED_SEDAN]!.doorAngle(PASSENGER_DOOR), "the new session's door").toBe(0);
  });

  it("when a passenger's climb out is cut short by a reset that shuts the door itself, then the door stays shut", () => {
    const f = fixture();
    walkUp(f, 1, 0, PASSENGER_DOOR);
    f.seats.getIn(1, 0);
    run(f, 2);
    f.state.self = 1;
    f.seats.getOut(1);
    run(f, FRAME_S * 3);
    expect(f.cars[0]!.doorAngle(PASSENGER_DOOR), "control: the door has begun to open").toBeGreaterThan(0);
    f.seats.tripEnded();
    f.cars[0]!.setDoorOpen(PASSENGER_DOOR, 0);
    run(f, 1);
    expect(f.cars[0]!.doorAngle(PASSENGER_DOOR)).toBe(0);
  });
});

describe("given a player on foot whose last-driven car is taken", () => {
  it("when he presses reset, then he sits at the wheel of his own car instead", () => {
    const f = fixture();
    walkUp(f, 0, PARKED_SEDAN, DRIVER_SIDE);
    f.seats.getIn(0, PARKED_SEDAN);
    f.seats.getOut(0);
    f.table.sit(2, PARKED_SEDAN, 0);
    expect(f.seats.respawned(0), "the car to put back").toBe(0);
    expect(f.table.driverOf(0)).toBe(0);
  });
});

describe("given the room's roster", () => {
  it("when a peer joins, then he sits in his own car; once he has got out he is not seated again; when he leaves, his seat is free", () => {
    const f = fixture();
    f.state.peers.add(7);
    f.seats.frame(FRAME_S);
    expect(f.table.carOf(7), "the newcomer sits in his own car").toBe(7);
    f.table.leave(7);
    f.seats.frame(FRAME_S);
    expect(f.table.carOf(7), "on foot he stays on foot").toBe(-1);
    f.table.sit(7, PARKED_SEDAN, 0);
    f.state.peers.delete(7);
    f.seats.frame(FRAME_S);
    expect(f.table.carOf(7), "gone").toBe(-1);
    expect(f.table.driverOf(PARKED_SEDAN), "the wheel is free").toBe(-1);
  });

  it("when a player on foot presses reset, then he sits at the wheel of the car he last drove if it is free, and that car is the one put back", () => {
    const f = fixture();
    walkUp(f, 0, PARKED_SEDAN, DRIVER_SIDE);
    f.seats.getIn(0, PARKED_SEDAN);
    f.seats.getOut(0);
    expect(f.seats.respawned(0), "the car to put back").toBe(PARKED_SEDAN);
    expect(f.table.driverOf(PARKED_SEDAN)).toBe(0);
  });
});
