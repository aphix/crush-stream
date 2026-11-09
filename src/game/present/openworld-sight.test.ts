import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FACE, HIDE_GRACE, SightField } from "./openworld-sight.ts";
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

  it("when an owner gives its ids back and claims again, then it gets the same ids with fresh clocks, and the field never runs out however often it does", () => {
    const owners = new SightField([], IDS);
    owners.update([], 0, []);
    const cars = owners.claim(4);
    const interiors = owners.claim(4);
    const traffic = owners.claim(6);
    owners.observe(traffic, 0, 0, PERSON_M);
    owners.update([], 5, []);
    for (let rebuild = 0; rebuild < IDS; rebuild++) {
      owners.release(traffic, 6);
      expect(owners.claim(6), "the traffic's ids after a rebuild").toBe(traffic);
    }
    expect(owners.unseenFor(traffic), "a released id's clock").toBe(0);
    owners.release(cars, 4);
    expect(owners.claim(2), "a claim that fits where the cars were").toBe(cars);
    expect([cars, interiors, traffic], "first ids of the three claims").toEqual([0, 4, 8]);
  });

  it("when an owner gives its ids back after the field was cleared, then nothing is freed twice and a new claim gets its own ids", () => {
    const left = new SightField([], IDS);
    const old = left.claim(6);
    left.clear();
    left.release(old, 6);
    const first = left.claim(4);
    const second = left.claim(4);
    expect([first, second], "first ids of the two claims after the clear").toEqual([0, 4]);
  });

  it("when the field is cleared, then the ids are free again", () => {
    field.clear();
    expect(field.claim(IDS), "all ids after the clear").toBe(0);
  });
});

/** A shop 20 m wide and 8 m deep, its front (local +x) turned to face the street camera, its front wall 26 m down the street; openings up to 2.7 m. */
const SHOP = { x: 0, z: 30, yaw: Math.PI / 2, halfDepth: 4, halfWidth: 10 } as const;
const SHOP_BOX = occluder(SHOP.x, SHOP.z, SHOP.yaw, SHOP.halfDepth, SHOP.halfWidth, false, 0, 10);
const OPENING_TOP_M = 2.7;
/** The same shop 80 m down the street, and a wider block standing between it and the street camera. */
const FAR_SHOP = { ...SHOP, z: 80 } as const;
const FAR_SHOP_BOX = occluder(FAR_SHOP.x, FAR_SHOP.z, FAR_SHOP.yaw, FAR_SHOP.halfDepth, FAR_SHOP.halfWidth, false, 0, 10);
const BLOCK_BETWEEN = occluder(0, 40, 0, 15, 4, false, 0, 10);

function aimAt(field: SightField, shop: typeof SHOP | typeof FAR_SHOP, top: number): void {
  Object.assign(field.probe, { x: shop.x, z: shop.z, yaw: shop.yaw, halfDepth: shop.halfDepth, halfWidth: shop.halfWidth, top });
}

function seesInto(field: SightField, shop: typeof SHOP | typeof FAR_SHOP, face: (typeof FACE)[keyof typeof FACE]): boolean {
  aimAt(field, shop, OPENING_TOP_M);
  return field.seenThroughFace(face);
}

describe("given a shop's interior and the street camera in front of its shopfront", () => {
  const behind = cameraAt(0, EYE_HEIGHT_M, 70, 0, EYE_HEIGHT_M, 0);
  const inside = cameraAt(0, EYE_HEIGHT_M, 31, 0, EYE_HEIGHT_M, 100);
  const beside = cameraAt(30, EYE_HEIGHT_M, 30, 0, EYE_HEIGHT_M, 30);
  const cases = [
    { it: "when the street camera looks at the shopfront, then the interior is seen through it", cameras: [street], face: FACE.front, expected: true },
    { it: "when the street camera is asked about the back wall's openings, then the interior is not seen through them", cameras: [street], face: FACE.back, expected: false },
    { it: "when a camera behind the shop is asked about the shopfront, then the interior is not seen through it", cameras: [behind], face: FACE.front, expected: false },
    { it: "when a camera behind the shop is asked about the back wall's openings, then the interior is seen through them", cameras: [behind], face: FACE.back, expected: true },
    { it: "when the camera stands inside the shop looking at its back wall, then the interior is seen", cameras: [inside], face: FACE.front, expected: true },
    { it: "when a camera beside the shop, behind the line of its front wall, is asked about the shopfront, then the interior is not seen through it", cameras: [beside], face: FACE.front, expected: false },
  ] as const;
  for (const testCase of cases) {
    it(testCase.it, () => {
      expect(seesInto(fieldSeenBy(testCase.cameras, [SHOP_BOX]), SHOP, testCase.face), "seen through the face").toBe(testCase.expected);
    });
  }

  it("when a wider block stands between the street camera and a shop further down, then its interior is not seen, and from a camera past the block it is", () => {
    expect(seesInto(fieldSeenBy([street], [BLOCK_BETWEEN, FAR_SHOP_BOX]), FAR_SHOP, FACE.front), "seen past the block from the street").toBe(false);
    const pastTheBlock = cameraAt(0, EYE_HEIGHT_M, 55, 0, EYE_HEIGHT_M, 100);
    expect(seesInto(fieldSeenBy([pastTheBlock], [BLOCK_BETWEEN, FAR_SHOP_BOX]), FAR_SHOP, FACE.front), "seen from past the block").toBe(true);
  });
});

describe("given a shop's interior behind a block, its verdicts recorded once a frame", () => {
  const interior = 0;

  it("when 2.9 s have passed, then the grace is not up, at 3 s it is, and when a camera past the block sees in, the clock reads 0", () => {
    const field = new SightField([BLOCK_BETWEEN, FAR_SHOP_BOX], IDS);
    for (let frame = 0; frame <= 29; frame++) {
      field.update([street], frame * FRAME_S, []);
      field.recordSighting(interior, seesInto(field, FAR_SHOP, FACE.front));
    }
    expect(field.unseenFor(interior), "seconds unseen at 2.9 s").toBeLessThan(HIDE_GRACE);
    field.update([street], 3, []);
    field.recordSighting(interior, seesInto(field, FAR_SHOP, FACE.front));
    expect(field.unseenFor(interior), "seconds unseen at 3 s").toBeGreaterThanOrEqual(HIDE_GRACE);
    field.update([cameraAt(0, EYE_HEIGHT_M, 55, 0, EYE_HEIGHT_M, 100)], 3.1, []);
    expect(field.recordSighting(interior, seesInto(field, FAR_SHOP, FACE.front)), "seen from past the block").toBe(true);
    expect(field.unseenFor(interior), "seconds unseen once seen").toBe(0);
  });
});

describe("given a shop's footprint and the players standing about it", () => {
  const players = (x: number, z: number) => [{ group: { position: { x, z } } }];
  const inside = (field: SightField) => {
    aimAt(field, SHOP, OPENING_TOP_M);
    return field.playerInside();
  };

  it("when the walker stands in the shop, then a player is inside it, and on the sidewalk in front of it no one is", () => {
    const field = new SightField([SHOP_BOX], IDS);
    field.update([street], 0, players(5, 31));
    expect(inside(field), "player inside, 5 m along the shop and 1 m behind its middle").toBe(true);
    field.update([street], 0, players(0, 24));
    expect(inside(field), "player inside, on the sidewalk 2 m in front of the shopfront").toBe(false);
  });
});

describe("given the zero-boxing forms of the queries, over a street camera and a building 30 m ahead", () => {
  const field = fieldSeenBy([street]);
  const at = [
    { x: 0, z: 15 },
    { x: 0, z: 50 },
    { x: 30, z: 50 },
    { x: 0, z: -20 },
    { x: 17, z: 50 },
  ] as const;

  it("when the probe is aimed at a place, then it is seen as the same place asked by number", () => {
    for (const place of at) {
      Object.assign(field.probe, { x: place.x, z: place.z, radius: PERSON_M });
      expect(field.seenAtProbe(), `seen at (${place.x}, ${place.z}) by the probe`).toBe(field.seen(place.x, place.z, PERSON_M));
    }
  });

  it("when a crowd is asked in one call, then each is seen as it is asked alone, and a building hides those behind it", () => {
    const seen = new Uint8Array(at.length);
    field.seenMany(at.map((place) => place.x), at.map((place) => place.z), at.length, PERSON_M, seen);
    for (const [index, place] of at.entries()) expect(seen[index], `seen at (${place.x}, ${place.z}) with the crowd`).toBe(field.seen(place.x, place.z, PERSON_M) ? 1 : 0);
    expect(seen[0], "in front of the building").toBe(1);
    expect(seen[1], "behind the building").toBe(0);
  });

  it("when the field is off, then a crowd asked in one call is all seen", () => {
    const off = fieldSeenBy([street]);
    off.enabled = false;
    const seen = new Uint8Array(2);
    off.seenMany([0, 0], [15, 50], 2, PERSON_M, seen);
    expect(seen[0]! + seen[1]!, "seen with the field off").toBe(2);
  });

  it("when the probe is aimed at a place and a player's car stands near it, then it is near, and not once the radius is short of the car", () => {
    const nearField = new SightField([], IDS);
    nearField.update([], 0, [{ group: { position: { x: 100, z: 0 } } }]);
    Object.assign(nearField.probe, { x: 130, z: 0, radius: 40 });
    expect(nearField.nearProbe(), "30 m from the car, within 40").toBe(true);
    nearField.probe.radius = 20;
    expect(nearField.nearProbe(), "30 m from the car, within 20").toBe(false);
  });
});

