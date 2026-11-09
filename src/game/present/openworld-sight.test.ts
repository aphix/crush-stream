import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HIDE_GRACE, SightField } from "./openworld-sight.ts";
import { occluder } from "./spectate-cam.ts";

const EYE_HEIGHT_M = 1.6;
const FAR_M = 400;
const PERSON_M = 0.5;
const CAR_M = 3.5;
/** A building 20 m wide, 8 m deep and 10 m high, its middle 30 m down the street from the camera at the origin. */
const BUILDING = occluder(0, 30, 0, 10, 4, false, 0, 10);
const FRAME_S = 0.1;
const IDS = 16;

function cameraAt(x: number, y: number, z: number, lookX: number, lookY: number, lookZ: number): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, FAR_M);
  camera.position.set(x, y, z);
  camera.lookAt(lookX, lookY, lookZ);
  return camera;
}

/** The camera at the origin at eye height, looking down the street (+z) at the building. */
const street = cameraAt(0, EYE_HEIGHT_M, 0, 0, EYE_HEIGHT_M, 100);

function fieldSeenBy(cameras: readonly THREE.Camera[], solids = [BUILDING]): SightField {
  const field = new SightField(solids, IDS);
  field.update(cameras, 0, []);
  return field;
}

describe("given a camera on a street and a 10 m high building 30 m ahead", () => {
  const field = fieldSeenBy([street]);
  const cases = [
    { it: "when a person stands in front of the building, then the person is seen", x: 0, z: 15, radius: PERSON_M, expected: true },
    { it: "when a person stands right behind the building, then the person is not seen", x: 0, z: 50, radius: PERSON_M, expected: false },
    { it: "when a person stands behind but out past the building's side, then the person is seen", x: 30, z: 50, radius: PERSON_M, expected: true },
    { it: "when a person stands behind the camera, then the person is not seen", x: 0, z: -20, radius: PERSON_M, expected: false },
    { it: "when a person stands in view but past the camera's far plane, then the person is not seen", x: 200, z: 500, radius: PERSON_M, expected: false },
    { it: "when a person stands behind the building's edge, then the person is not seen", x: 17, z: 50, radius: PERSON_M, expected: false },
    { it: "when a car's flank reaches out past that same edge, then the car is seen", x: 17, z: 50, radius: CAR_M, expected: true },
    { it: "when a person stands at the building's own door inside its box, then the building does not hide the person", x: 0, z: 30, radius: PERSON_M, expected: true },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      expect(field.seen(testCase.x, testCase.z, testCase.radius), `seen at (${testCase.x}, ${testCase.z})`).toBe(testCase.expected);
    });
  }

  it("when no camera has been read, then everything is seen", () => {
    expect(new SightField([BUILDING], IDS).seen(0, 50, PERSON_M), "seen before the first update").toBe(true);
  });

  it("when the field is switched off, then everything is seen, and when it is switched on a person behind the building is not", () => {
    const switched = fieldSeenBy([street]);
    switched.enabled = false;
    expect(switched.seen(0, 50, PERSON_M), "seen with the field off").toBe(true);
    switched.enabled = true;
    expect(switched.seen(0, 50, PERSON_M), "seen with the field on").toBe(false);
  });

  it("when the only solids are a parked car's box and a lamp post, then they hide nothing", () => {
    const lowAndRound = fieldSeenBy([street], [occluder(0, 30, 0, 2, 1, false, 0, 1.5), occluder(0, 30, 0, 1, 1, true, 0, 9)]);
    expect(lowAndRound.seen(0, 50, PERSON_M), "seen behind a car and a lamp post").toBe(true);
  });

  it("when a second camera looks back from behind the building, then a person it hides from the first is seen by the second", () => {
    const back = cameraAt(0, EYE_HEIGHT_M, 70, 0, EYE_HEIGHT_M, 0);
    expect(fieldSeenBy([street]).seen(0, 50, PERSON_M), "seen by the street camera alone").toBe(false);
    expect(fieldSeenBy([street, back]).seen(0, 50, PERSON_M), "seen by either camera").toBe(true);
  });
});

describe("given a camera 60 m up looking down at a building 30 m ahead", () => {
  const above = fieldSeenBy([cameraAt(0, 60, 0, 0, 0, 45)]);

  it("when a person stands just behind the building, then the roof is in the line and the person is not seen", () => {
    expect(above.seen(0, 36, PERSON_M), "seen at 2 m behind the back wall").toBe(false);
  });

  it("when a person stands 16 m behind it, then the line clears the roof and the person is seen", () => {
    expect(above.seen(0, 50, PERSON_M), "seen at 16 m behind the back wall").toBe(true);
  });
});

describe("given a person behind a building, observed once a frame by a camera on the street", () => {
  const person = 0;

  /** Frames of `FRAME_S` run, the person observed in each; the field's verdict from the last. */
  function observedFor(frames: number, x: number, z: number): { field: SightField; seen: boolean } {
    const field = new SightField([BUILDING], IDS);
    let seen = false;
    for (let frame = 0; frame <= frames; frame++) {
      field.update([street], frame * FRAME_S, []);
      seen = field.observe(person, x, z, PERSON_M);
    }
    return { field, seen };
  }

  it("when 2.9 s have passed, then the grace is not yet up", () => {
    const { field, seen } = observedFor(29, 0, 50);
    expect(seen, "seen").toBe(false);
    expect(field.unseenFor(person), "seconds unseen").toBeLessThan(HIDE_GRACE);
  });

  it("when 3 s have passed, then the grace is up", () => {
    const { field } = observedFor(30, 0, 50);
    expect(field.unseenFor(person), "seconds unseen").toBeGreaterThanOrEqual(HIDE_GRACE);
    expect(HIDE_GRACE, "the grace in seconds").toBe(3);
  });

  it("when the person steps out from behind the building, then the clock reads 0 the same frame", () => {
    const { field } = observedFor(40, 0, 50);
    field.update([street], 4.1, []);
    expect(field.observe(person, 30, 50, PERSON_M), "seen out past the side").toBe(true);
    expect(field.unseenFor(person), "seconds unseen").toBe(0);
  });

  it("when the id was never observed, then it has been unseen for 0 s, and a reset starts its grace over", () => {
    const { field } = observedFor(40, 0, 50);
    expect(field.unseenFor(person + 1), "an id nobody observed").toBe(0);
    field.reset(person);
    expect(field.unseenFor(person), "after the reset").toBe(0);
    field.update([street], 10, []);
    field.observe(person, 0, 50, PERSON_M);
    field.update([street], 12, []);
    expect(field.unseenFor(person), "2 s after the first look since the reset").toBe(2);
  });
});

describe("given players' cars and claimed ids", () => {
  const field = new SightField([], IDS);
  field.update([], 0, [{ group: { position: { x: 100, z: 0 } } }]);

  it("when a point is within the radius of a player's car, then it is near, and past the radius it is not", () => {
    expect(field.near(130, 0, 40), "30 m from the car").toBe(true);
    expect(field.near(150, 0, 40), "50 m from the car").toBe(false);
  });

  it("when two claimants each ask for ids, then they get separate ranges, and asking past the capacity throws", () => {
    const first = field.claim(10);
    const second = field.claim(6);
    expect([first, second], "first ids of the two claims").toEqual([0, 10]);
    expect(() => field.claim(1), "a claim past the capacity").toThrow(RangeError);
  });

  it("when the field is cleared, then the ids are free again", () => {
    field.clear();
    expect(field.claim(IDS), "all ids after the clear").toBe(0);
  });
});
