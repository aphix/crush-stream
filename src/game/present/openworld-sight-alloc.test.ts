import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { allocatedBytes, COMPILE_WAIT_S, untilQuiet } from "../kernel/alloc-sample.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { mulberry32 } from "../world/placements.ts";
import { OpenWorldCarLod, type LodCar } from "./openworld-car-lod.ts";
import { FACE, HIDE_GRACE, SightField } from "./openworld-sight.ts";
import { occluder, type Occluder } from "./spectate-cam.ts";

const PEOPLE = 300;
const CARS = 12;
/** Interiors asked about through their front a frame: the buildings of the first rows. */
const INTERIORS = 40;
const OPENING_TOP_M = 2.7;
/** A person's radius across the view (m). */
const PERSON_M = 0.6;
const BUILDING_COLUMNS = 20;
const BUILDING_ROWS = 10;
const LOT_PITCH_M = 7;
const BLOCK_PITCH_M = 40;
const SPREAD_M = 150;
/** Each row of buildings leaves a street this wide (m) round the camera's line: the people in it are seen, the rest are behind the rows. */
const STREET_HALF_M = 10;
/** Frames before the first read: past most of V8's tier-up (cold code runs in the interpreter, where every double is boxed). */
const WARM_FRAMES = 6000;
/** Windows of this many frames are read until one is quiet: how long the cold code lasts follows the box's load. */
const WINDOW_FRAMES = 2000;
const BOUND_B = 16;

const random = mulberry32(11);
const buildings: Occluder[] = [];
for (let row = 0; row < BUILDING_ROWS; row++) {
  for (let column = 0; column < BUILDING_COLUMNS; column++) {
    const x = (column - BUILDING_COLUMNS / 2) * LOT_PITCH_M;
    if (Math.abs(x) >= STREET_HALF_M) buildings.push(occluder(x, row * BLOCK_PITCH_M, 0, 3, 6.5, false, 0, 9.6));
  }
}
const sight = new SightField(buildings, 1024);
const lod = new OpenWorldCarLod(sight, { level: 0, setLevel() {} });
const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 400);
camera.position.set(0, 1.6, -20);
camera.lookAt(0, 1.6, 100);
const eyes = [camera];
const players = [{ group: { position: { x: 0, z: 0 } } }];
const firstPerson = sight.claim(PEOPLE);
const peopleX = Float64Array.from({ length: PEOPLE }, () => (random() - 0.5) * 2 * SPREAD_M);
const peopleZ = Float64Array.from({ length: PEOPLE }, () => random() * 2 * SPREAD_M);
const cars: LodCar[] = Array.from({ length: CARS }, () => ({ group: { position: { x: (random() - 0.5) * 2 * SPREAD_M, z: random() * 2 * SPREAD_M }, visible: true } }));
let frames = 0;
let seenPeople = 0;
const peopleSeen = new Uint8Array(PEOPLE);
const firstInterior = sight.claim(INTERIORS);

/** One frame: the field reads the camera, every person is observed and every car judged. */
function frame(): void {
  sight.update(eyes, frames++ / FRAME_HZ, players);
  seenPeople = 0;
  sight.seenMany(peopleX, peopleZ, PEOPLE, PERSON_M, peopleSeen);
  for (let person = 0; person < PEOPLE; person++) if (sight.recordSighting(firstPerson + person, peopleSeen[person] === 1)) seenPeople++;
  lod.frame(cars, null, false);
  const probe = sight.probe;
  for (let interior = 0; interior < INTERIORS; interior++) {
    const box = buildings[interior]!;
    probe.x = box.x;
    probe.z = box.z;
    probe.yaw = 0;
    probe.halfDepth = box.hx;
    probe.halfWidth = box.hz;
    probe.top = OPENING_TOP_M;
    sight.recordSighting(firstInterior + interior, sight.seenThroughFace(FACE.front));
  }
}

function windowPerFrame(): number {
  return (
    allocatedBytes(() => {
      for (let f = 0; f < WINDOW_FRAMES; f++) frame();
    }) / WINDOW_FRAMES
  );
}

describe("given a warmed field of 200 buildings, 300 people observed, 12 cars judged and 40 interiors asked through their fronts every frame", () => {
  it(`when a window of frames is run, then the field allocates no more than ${BOUND_B} bytes a frame`, () => {
    for (let f = 0; f < WARM_FRAMES; f++) frame();
    const perFrame = untilQuiet(windowPerFrame, BOUND_B);
    if (process.env.ALLOC_PRINT) console.log(`openworld-sight-alloc: ${perFrame.toFixed(2)} B/frame`);
    expect(seenPeople, "people seen in the last frame").toBeGreaterThan(0);
    expect(seenPeople, "people seen in the last frame, of all").toBeLessThan(PEOPLE);
    expect(sight.unseenFor(firstPerson + peopleX.findIndex((x, person) => !sight.seen(x, peopleZ[person]!, 0.6))), "a person behind a building has been unseen past the grace").toBeGreaterThanOrEqual(HIDE_GRACE);
    expect(perFrame, `${perFrame.toFixed(1)} B a frame > ${BOUND_B} in every window for ${COMPILE_WAIT_S} s: the sight field allocates`).toBeLessThanOrEqual(BOUND_B);
  });
});

// After the row above, with a loop of its own: a second callee at the measured loop's call site would cost the field its optimized code.
describe("given the allocation measure", () => {
  it("when a frame makes a vector, then it reads over the bar", () => {
    const kept: THREE.Vector3[] = [];
    const perFrame =
      allocatedBytes(() => {
        for (let f = 0; f < WINDOW_FRAMES; f++) kept[f % 8] = new THREE.Vector3();
      }) / WINDOW_FRAMES;
    expect(perFrame, `${perFrame.toFixed(1)} B a frame for a vector a frame: the measure sees nothing`).toBeGreaterThan(BOUND_B);
  });
});
