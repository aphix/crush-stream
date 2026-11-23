import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { allocatedBytes, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { writeRace } from "../net/codec.ts";
import { packSeats, SEATS_NOTICE } from "../net/seats-codec.ts";
import { SeatTable } from "../scenes/seat-table.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-course.ts";
import { OnFootRig } from "./engine-onfoot.test-util.ts";

const LINK = "#scene=openworld&seed=beef";
const SETTLE_S = 3;
/** This machine is the guest in car 1 of a room; the host's id as the guest knows it. */
const GUEST_CAR = 1;
const TAKEN_CAR = 2;
const HOST_ID = "host";
/** The climb out of a car (0.8 s) and a moment. */
const CLIMB_S = 1.2;
/** A course of the lobby that is not the open world. */
const OTHER_COURSE = "havana";
const REFUSAL_TEXT = "Walk up to a car's door";

// One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
let rig: OnFootRig;

/** The seat table the host sends: `actor` in car `car`'s seat `seat`, or nobody. */
function tableWith(entries: readonly (readonly [actor: number, car: number, seat: number])[]): SeatTable {
  const table = new SeatTable();
  for (const [actor, car, seat] of entries) table.sit(actor, car, seat);
  return table;
}

/** The host's message reaches this guest. */
function hear(data: Uint8Array): void {
  rig.engine["net"]["clientReceive"](HOST_ID, data);
}

/** The host's race keyframe of its open-world lobby. */
function raceKeyframe(): Uint8Array {
  return writeRace({ lobby: null, trackId: OPENWORLD_ID, look: 0, gate: null, next: null, snap: null });
}

beforeAll(async () => {
  rig = await OnFootRig.boot(LINK);
  rig.run(SETTLE_S);
  const net = rig.engine["net"];
  Object.defineProperty(net, "role", { value: "client", configurable: true, writable: true });
  net["hostId"] = HOST_ID;
  net["car"] = GUEST_CAR;
});
beforeEach(() => {
  rig.engine["onFoot"].reset();
  rig.engine["ragdolls"].reset();
  rig.engine["desk"].table.clear();
  const race = rig.engine["race"];
  race.adoptCar(0);
  race.adoptCar(GUEST_CAR);
  rig.engine["adoptedCar"] = null;
  rig.sit(GUEST_CAR);
  rig.engine["desk"].table.clear();
  rig.run(0.2);
});
afterAll(() => rig.dispose());

describe("given the real engine as a guest in a room of the open world, in car 1", () => {
  it("when the host's seat table gives him the wheel of car 2 and its next race keyframe arrives, then he is still in drive mode on car 2, which is the car he drives", () => {
    hear(packSeats(tableWith([[GUEST_CAR, GUEST_CAR, 0]]), SEATS_NOTICE.none));
    rig.run(0.2);
    hear(packSeats(tableWith([[GUEST_CAR, TAKEN_CAR, 0]]), SEATS_NOTICE.none));
    rig.run(0.3);
    expect(rig.engine["seat"].carIndex, "the camera follows it").toBe(TAKEN_CAR);
    hear(raceKeyframe());
    rig.run(0.3);
    expect(rig.engine["seat"].carIndex, "after the keyframe the camera is still on it").toBe(TAKEN_CAR);
    expect(rig.engine["seat"].mode, "his keys drive it").toBe("drive");
    expect(rig.engine["drivenCar"](), "it is the car he drives").toBe(TAKEN_CAR);
  });

  it("when he asks to get in a car and the host refuses, then he is on foot and the refusal text shows", () => {
    hear(packSeats(tableWith([[GUEST_CAR, GUEST_CAR, 0]]), SEATS_NOTICE.none));
    rig.run(0.2);
    rig.press("Enter");
    hear(packSeats(tableWith([]), SEATS_NOTICE.none));
    rig.run(CLIMB_S);
    expect(rig.phase(), "the host let him out").toBe("onFoot");
    rig.walkToDoor(rig.cars()[GUEST_CAR]!);
    rig.press("Enter");
    rig.run(0.2);
    expect(rig.engine["desk"].table.carOf(GUEST_CAR), "nothing changes here until the host answers").toBe(-1);
    hear(packSeats(tableWith([]), SEATS_NOTICE.noCar));
    rig.run(0.3);
    expect(rig.phase(), "he is still on foot").toBe("onFoot");
    expect(rig.engine["onFoot"].hud()?.refusal, "the refusal text shows").toBe(REFUSAL_TEXT);
  });

});

describe("given the real engine as a guest passenger whose walker cannot be started", () => {
  it("when the host lets him out, then he asks it for his seat, and after its answer he is at a wheel", () => {
    hear(packSeats(tableWith([[GUEST_CAR, TAKEN_CAR, 1], [3, TAKEN_CAR, 0]]), SEATS_NOTICE.none));
    rig.run(0.3);
    expect(rig.engine["seat"].carIndex, "control: he rides in car 2").toBe(TAKEN_CAR);
    const asked = vi.spyOn(rig.engine["net"], "requestRespawn");
    const ragdolls = rig.engine["ragdolls"];
    const start = ragdolls.startWalker;
    ragdolls.startWalker = () => -1;
    try {
      rig.press("Enter");
      hear(packSeats(tableWith([[3, TAKEN_CAR, 0]]), SEATS_NOTICE.none));
      rig.run(0.5);
    } finally {
      ragdolls.startWalker = start;
    }
    expect(asked, "he asked the host for a seat").toHaveBeenCalledTimes(1);
    asked.mockRestore();
    hear(packSeats(tableWith([[3, TAKEN_CAR, 0], [GUEST_CAR, GUEST_CAR, 0]]), SEATS_NOTICE.none));
    rig.run(0.3);
    expect(rig.engine["desk"].table.driverOf(GUEST_CAR), "the host seated him").toBe(GUEST_CAR);
    expect(rig.engine["seat"].carIndex, "the view is on his car").toBe(GUEST_CAR);
    expect(rig.engine["seat"].mode, "he drives").toBe("drive");
  });
});

describe("given the real engine as a guest in a room whose host changes the course", () => {
  it("when the host's race state then names another course, then he is in drive mode on his own car, not the taken car's number on the new course", () => {
    hear(packSeats(tableWith([[GUEST_CAR, TAKEN_CAR, 0]]), SEATS_NOTICE.none));
    rig.run(0.3);
    expect(rig.engine["seat"].carIndex, "control: he is on the taken car").toBe(TAKEN_CAR);
    hear(writeRace({ lobby: null, trackId: OTHER_COURSE, look: 0, gate: null, next: null, snap: null }));
    rig.run(0.3);
    expect(rig.engine["seat"].carIndex, "his own car").toBe(GUEST_CAR);
    expect(rig.engine["seat"].mode, "he drives").toBe("drive");
    expect(rig.engine["drivenCar"](), "the car he drives").toBe(GUEST_CAR);
  });
});

describe("given the real engine as a guest, asked where every player stands as the law asks each crowd step", () => {
  /** Crowd steps asked, and the bound (bytes): the sampling profiler's own cost is 4-5 KB of a read. */
  const STEPS = 600;
  const BOUND_BYTES = 8192;

  it("when all 8 players' places are asked for 600 steps, then all of it allocates under 8 KB: which car is his own is a field read, not a status built each time", () => {
    const place = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
    expect(rig.engine["ownCar"](), "control: this machine is the guest in car 1").toBe(GUEST_CAR);
    const ask = (): void => {
      for (let step = 0; step < STEPS; step++) for (let actor = 0; actor < 8; actor++) rig.engine["actorPlace"](actor, place);
    };
    const bytes = untilQuiet(() => allocatedBytes(ask), BOUND_BYTES);
    expect(bytes, "bytes allocated by 600 steps of asking").toBeLessThanOrEqual(BOUND_BYTES);
  });
});
