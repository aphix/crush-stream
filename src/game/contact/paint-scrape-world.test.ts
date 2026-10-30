import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { FLAT_GROUND, setGround } from "../world/ground.ts";
import { armSolids, P_STRIDE, prismCut, Surface, WALL } from "../world/surfaces.ts";
import { PR_ID } from "../world/prism.ts";
import { propColliders, solidsOf } from "../world/placements.ts";
import { PREFAB } from "../world/constants.ts";
import { SPRAY_FACE } from "../vehicle/spray-box.ts";
import { FACE_MASK, FACE_WIDTH, STROKE_BYTES } from "../vehicle/paint-scrapes.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, tickWorld } from "./crash-scenarios.test-util.ts";
import { propContact, type PropHits } from "./prop-contact.ts";

/** Frames a slide runs (1.5 s at 60 Hz). */
const FRAMES = 90;
const SLIDE_SPEED = 8;
/** The grind's speed into the wall (m/s): over the 1.5 m/s a wall's sparks fly from. */
const GRIND_CLOSING = 2;

afterEach(() => {
  armSolids(null);
  setGround(null);
});

/** How many of `car`'s strokes lie on each `SPRAY_FACE`. */
function strokesByFace(car: DeformableCar): number[] {
  const out = [0, 0, 0, 0, 0];
  const l = car.scratches.list;
  for (let k = 0; k < car.scratches.count; k++) out[l[k * STROKE_BYTES + FACE_WIDTH]! & FACE_MASK]!++;
  return out;
}

function slide(car: DeformableCar, solids?: Surface, hits?: PropHits): void {
  const w = makeWorld([car], false, false, FREEWHEEL);
  // A race's walls meet a car where its sparks fly from (`propContact`'s `hits.fx`).
  if (solids && hits) w.world.collide = (c, i, h) => propContact(c, i, solids, new Uint8Array(1), hits, h);
  for (let f = 0; f < FRAMES; f++) tickWorld(w);
}

describe("given a sedan on the flat asphalt", () => {
  it(`when it slides on its roof at ${SLIDE_SPEED} m/s, then its roof takes strokes`, () => {
    setGround(FLAT_GROUND);
    const car = makeCar();
    launch(car, 0, 0, 0, 0, SLIDE_SPEED);
    car.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    car.group.position.y = 1.5;
    slide(car);
    const faces = strokesByFace(car);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(car.group.quaternion).y;
    expect(up, `the control: it stayed on its roof (its up axis ${up.toFixed(2)})`).toBeLessThan(-0.8);
    expect(faces[SPRAY_FACE.top], `strokes by face L/R/T/F/B ${faces.join("/")}`).toBeGreaterThan(0);
  });

  it(`when it grinds its left flank along a wall at ${SLIDE_SPEED} m/s, closing at ${GRIND_CLOSING} m/s, then the wall sparks and its left flank takes strokes`, () => {
    setGround(FLAT_GROUND);
    const car = makeCar();
    const solids = new Surface();
    // A 40 m concrete wall along z, its face 1 cm off the sedan's left flank (its footprint's) at the start: farther, the tyres stop the closing first.
    solids.addPrism({ x: car.cage.fields.planBox[0]! - 0.01 - 0.2, z: 15, yaw: 0, hx: 0.2, hz: 20, base: 0, top: 1.2, id: 0, role: WALL });
    armSolids(solids);
    let sparks = 0;
    const hits: PropHits = { knock: () => {}, fx: () => sparks++, wall: () => {} };
    launch(car, 0, 0, 0, -GRIND_CLOSING, SLIDE_SPEED);
    slide(car, solids, hits);
    const faces = strokesByFace(car);
    expect(sparks, "the control: the grind threw sparks").toBeGreaterThan(0);
    expect(faces[SPRAY_FACE.left], `strokes by face L/R/T/F/B ${faces.join("/")}`).toBeGreaterThan(0);
  });
});

describe("given a course's solids: a jersey barrier, a lamp post, a tree, and a course wall piece", () => {
  it("when each is asked how hard its sides cut a slide's paint, then each answers by its material: the concrete 1.3, the steel post 1.2, the bark nothing", () => {
    const placed = ([PREFAB.barrierBlock, "lamp", "tree"] as const).map((prefab, k) => ({ prefab, x: k * 20, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1 }));
    const props = propColliders(placed);
    const solids = solidsOf([{ ...props[0]!, index: 0, prefab: null }], props.map((c) => ({ ...c, index: c.index + 1 })));
    const cutOf = (id: number): number => {
      for (let k = 0; k < solids.count; k++) if (solids.p[k * P_STRIDE + PR_ID] === id) return prismCut(solids, k);
      return Number.NaN;
    };
    expect([0, 1, 2, 3].map(cutOf), "wall, barrier, lamp, tree").toEqual([1.3, 1.3, 1.2, 0]);
  });
});
