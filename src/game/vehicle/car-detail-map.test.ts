import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { applySpray, BARE_SPRAY, sprayUniforms } from "../present/spray.ts";
import { CAR_SPRAY } from "../match/look-data.ts";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "./car.ts";
import { applyDetailMap, REST_FRAME_ATTRIBUTES } from "./car-detail-map.ts";
import { compileHooks, detailPaint, detailReader, switchFinish } from "./car-detail-map.test-util.ts";
import { makePaintMaterial } from "./car-materials.ts";
import { CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { assertSameNumbers, paint } from "./test-support.ts";

type Details = NonNullable<BodyStyle["details"]>;

const SEDAN = CAR_STYLES.sedan;
/** The paint's program key with the finish on, before any detail: what a car with no details keeps. */
const PAINT_FINISH_KEY = "car-paint-primer|finish-paint";
/** One texel of the atlas (m): a reading's nearest texel centre lies within half of it. */
const TEXEL = 0.004;

/** The sedan with `details` instead of its own table: a new style object, so it bakes its own atlas. */
function sedanWith(details: Details): BodyStyle {
  return { ...SEDAN, details };
}

function within(actual: number, expected: number, share: number, label: string): void {
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * share, `${label}: ${actual} is not within ${share * 100}% of ${expected}`);
}

describe("given a style's detail table baked to its atlas", () => {
  it("when a v groove runs along the side, then its centre reads its depth and cavity and nothing lies past half its width", () => {
    const read = detailReader(sedanWith({ lines: [{ view: "side", points: [[-1, 0.5], [1, 0.5]], width: 0.04, depth: -0.004, profile: "v", cavity: 0.85 }], patches: [] }));
    const centre = read("side", 0, 0.5);
    within(centre.height, -0.004, 0.12, "height on the groove's centre");
    within(centre.cavity, 0.85, 0.12, "cavity on the groove's centre");
    within(read("side", 0, 0.5 + 0.01).height, -0.002, 0.2, "height a quarter width off the centre, half way down the v");
    const past = read("side", 0, 0.5 + 0.02 + 1.5 * TEXEL);
    assert.equal(past.height, 0, "height one texel past half the width");
    assert.equal(past.cavity, 0, "cavity one texel past half the width");
  });

  it("when a top-view stroke sits at x 0.3, then a lookup at x -0.3 reads it the same", () => {
    const read = detailReader(sedanWith({ lines: [{ view: "top", points: [[-0.5, 0.3], [0.5, 0.3]], width: 0.02, depth: -0.004, profile: "v", cavity: 0.85 }], patches: [] }));
    const right = read("top", 0, 0.3);
    const left = read("top", 0, -0.3);
    assert.ok(right.height < -0.003, `the stroke reads at x 0.3: ${right.height}`);
    assert.equal(left.height, right.height, "height at x -0.3");
    assert.equal(left.cavity, right.cavity, "cavity at x -0.3");
  });

  it("when any style's bottom tile is read on its exhaust run, then the pipe stands proud and dark on both sides, where its top tile has no pipe", () => {
    for (const style of Object.values(CAR_STYLES)) {
      if (!style.details) continue;
      const read = detailReader(style);
      const pipe = style.exhaust?.x ?? 0.4;
      for (const x of [pipe, -pipe]) {
        const under = read("bottom", -0.5, x);
        assert.ok(under.height >= 0.005 && under.cavity >= 0.4, `${style.id} at x ${x}: height ${under.height}, cavity ${under.cavity}`);
      }
      assert.ok(read("top", -0.5, pipe).height < 0.005, `${style.id}: the top tile reads no pipe`);
    }
  });

  it("when the shader is built, then a down-facing pixel reads the bottom tile in the top's place", () => {
    const { fragmentShader } = compileHooks(detailPaint(SEDAN));
    assert.ok(fragmentShader.includes("bool detailUnder = vDetailNormal.y < 0.0;") && fragmentShader.includes("detailUnder ? detailTiles[4] : detailTiles[1]"), "the bottom tile replaces the top's under the car");
  });

  it("when a step runs forward along the side, then its left (above) stands its depth proud and its right (below) reads nothing", () => {
    const read = detailReader(sedanWith({ lines: [{ view: "side", points: [[-1, 0.7], [1, 0.7]], width: 0.012, depth: 0.003, profile: "step", cavity: 0 }], patches: [] }));
    within(read("side", 0, 0.7 + 0.012).height, 0.003, 0.1, "height a width left of the line");
    assert.equal(read("side", 0, 0.7 - 0.012).height, 0, "height a width right of the line");
  });

  it("when a patch is recessed with a rim, then its floor reads its depth and cavity, half way up its rim about half its depth, and outside nothing", () => {
    const outline: Details["patches"][number]["points"] = [[0.1, 0.3], [0.5, 0.3], [0.5, 0.6], [0.1, 0.6]];
    const read = detailReader(sedanWith({ lines: [], patches: [{ view: "front", points: outline, depth: -0.005, rim: 0.02, cavity: 0.6 }] }));
    const floor = read("front", 0.3, 0.45);
    within(floor.height, -0.005, 0.02, "height on the floor");
    within(floor.cavity, 0.6, 0.02, "cavity on the floor");
    within(read("front", 0.11, 0.45).height, -0.0025, 0.2, "height half way up the rim");
    assert.equal(read("front", 0.09, 0.45).height, 0, "height outside the outline");
  });

  it("when a patch carries horizontal slats, then a bar stands its depth off the floor without cavity and between bars the floor reads", () => {
    const outline: Details["patches"][number]["points"] = [[0.1, 0.3], [0.5, 0.3], [0.5, 0.6], [0.1, 0.6]];
    const pattern = { kind: "hslats", pitch: 0.03, bar: 0.012, depth: 0.003 } as const;
    const read = detailReader(sedanWith({ lines: [], patches: [{ view: "front", points: outline, depth: -0.004, rim: 0.004, pattern, cavity: 0.8 }] }));
    const bar = read("front", 0.3, 0.3 + pattern.pitch / 2 + 4 * pattern.pitch);
    const between = read("front", 0.3, 0.3 + 5 * pattern.pitch);
    within(bar.height, -0.001, 0.05, "height on a bar");
    assert.equal(bar.cavity, 0, "cavity on a bar");
    within(between.height, -0.004, 0.02, "height between bars");
    within(between.cavity, 0.8, 0.02, "cavity between bars");
  });

  it("when a stroke runs past the nose, then it ends at the side tile's edge and nothing wraps to the tail", () => {
    const nose = SEDAN.dims.wheelbase / 2 + SEDAN.dims.overhang.front;
    const tail = -(SEDAN.dims.wheelbase / 2 + SEDAN.dims.overhang.rear);
    const read = detailReader(sedanWith({ lines: [{ view: "side", points: [[nose - 0.25, 0.5], [nose + 0.25, 0.5]], width: 0.02, depth: -0.004, profile: "v", cavity: 0.85 }], patches: [] }));
    assert.ok(read("side", nose - 0.05, 0.5).height < -0.003, "the stroke reads inside the tile");
    let deepest = 0;
    for (let z = tail; z < tail + 0.3; z += TEXEL) for (let y = 0.47; y < 0.53; y += TEXEL) deepest = Math.min(deepest, read("side", z, y).height);
    assert.equal(deepest, 0, "deepest height along the tail's first 30 cm");
  });
});

/** The sedan's details while a car of it is built: two shut lines, enough to switch the rest frame on. */
const SEDAN_DETAILS: Details = {
  lines: [
    { view: "side", points: [[0.55, 0.25], [0.55, 0.84]], width: 0.008, depth: -0.004, profile: "v", cavity: 0.85 },
    { view: "top", points: [[0.77, 0], [0.77, 0.75]], width: 0.008, depth: -0.004, profile: "v", cavity: 0.85 },
  ],
  patches: [],
};

describe("given a sedan built with a details table", () => {
  const ownDetails = SEDAN.details;
  let car: DeformableCar;
  before(() => {
    CAR_STYLES.sedan.details = SEDAN_DETAILS;
    car = new DeformableCar(paint(), new THREE.Scene(), null, "sedan");
    car.deform.setMode("shape");
  });
  after(() => {
    CAR_STYLES.sedan.details = ownDetails;
  });

  /** The body, hood, boot and two doors the detail map paints, in that order. */
  const skins = () => {
    const m = car.lookMeshes();
    return [m.body, m.hood, m.trunk, ...m.doors];
  };

  it("when it is built, then the body, hood, boot and doors carry their vertices' car-frame positions as rest positions", () => {
    car.group.updateMatrixWorld(true);
    const intoCar = car.group.matrixWorld.clone().invert();
    const v = new THREE.Vector3();
    for (const [k, mesh] of skins().entries()) {
      const toCar = intoCar.clone().multiply(mesh.matrixWorld);
      const pos = mesh.geometry.getAttribute("position");
      const expected = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(toCar).toArray(expected, i * 3);
      const rest = mesh.geometry.getAttribute("sprayPos");
      assert.ok(rest !== undefined, `skin ${k} has a rest position`);
      assertSameNumbers(rest.array, expected, `rest positions of skin ${k}`, 1e-5);
    }
  });

  it("when it hits a wall at 50 km/h, then its skin crushes and every rest position stays as built", () => {
    const rests = skins().map((mesh) => Float32Array.from(mesh.geometry.getAttribute("sprayPos").array));
    const body = car.lookMeshes().body.geometry.getAttribute("position");
    const bodyBefore = Float32Array.from(body.array);
    runWall(50, 1, "front", { car });
    let crush = 0;
    for (let i = 0; i < body.array.length; i++) crush = Math.max(crush, Math.abs(body.array[i]! - bodyBefore[i]!));
    assert.ok(crush > 0.05, `the body skin moved ${crush} m`);
    for (const [k, mesh] of skins().entries()) assertSameNumbers(mesh.geometry.getAttribute("sprayPos").array, rests[k]!, `rest positions of skin ${k}`);
  });
});

const CHAINS = [
  { it: "when the detail hook is chained before the spray, then the composed vertex shader declares each rest attribute once", detailFirst: true },
  { it: "when the spray is chained before the detail hook, then the composed vertex shader declares each rest attribute once", detailFirst: false },
] as const;

describe("given the detail compile hook on a paint material", () => {
  const style = sedanWith(SEDAN_DETAILS);

  it("when the finish is on, then the shader samples the detail map inside the finish's draw gate", () => {
    const { fragmentShader } = compileHooks(detailPaint(style));
    assert.ok(fragmentShader.includes("uniform sampler2D detailMap;"), "the sampler is declared");
    assert.ok(fragmentShader.includes("float detailNear = finishMeshNear();"), "the detail reads the finish's mesh distance gate");
    assert.ok(fragmentShader.includes("float detailX = abs(vDetailPos.x);"), "the top and end tiles are read at |x|, mirroring the x >= 0 strokes");
  });

  for (const testCase of CHAINS) {
    it(testCase.it, () => {
      const material = makePaintMaterial(0x336699);
      const spray = () => applySpray(material, sprayUniforms(CAR_SPRAY, BARE_SPRAY, 1), REST_FRAME_ATTRIBUTES, "vSprayP = sprayPos;\nvSprayN = sprayNrm;\nvSprayRow = 0.0;", "car");
      if (testCase.detailFirst) applyDetailMap(material, style);
      spray();
      if (!testCase.detailFirst) applyDetailMap(material, style);
      switchFinish(material, true);
      const { vertexShader } = compileHooks(material);
      assert.ok(vertexShader.includes("vDetailPos = sprayPos;") && vertexShader.includes("vSprayP = sprayPos;"), "both hooks read the rest frame");
      assert.equal(vertexShader.split("attribute vec3 sprayPos;").length - 1, 1, "sprayPos declarations");
      assert.equal(vertexShader.split("attribute vec3 sprayNrm;").length - 1, 1, "sprayNrm declarations");
    });
  }

  it("when the style has no details, then the material keeps its hook, its program key and samples no texture, unlike one with details", () => {
    const bare = makePaintMaterial(0x336699);
    const bareHook = bare.onBeforeCompile;
    applyDetailMap(bare, { ...SEDAN, details: undefined });
    switchFinish(bare, true);
    assert.ok(bare.onBeforeCompile === bareHook, "the compile hook is the one it had");
    assert.equal(bare.customProgramCacheKey(), PAINT_FINISH_KEY, "program key without details");
    assert.ok(compileHooks(bare).uniforms.detailMap === undefined, "no detail map uniform without details");
    const detailed = detailPaint(style);
    assert.equal(detailed.customProgramCacheKey(), `${PAINT_FINISH_KEY}|detail`, "program key with details");
    assert.ok(compileHooks(detailed).uniforms.detailMap?.value instanceof THREE.DataTexture, "a detail map with details");
  });

  it("when the finish is off (a low tier), then a detailed material keeps today's program key, its atlas is already baked, and a Low→High→Low→High round trip draws that same atlas", () => {
    const material = makePaintMaterial(0x336699);
    applyDetailMap(material, sedanWith(SEDAN_DETAILS));
    assert.equal(material.customProgramCacheKey(), "car-paint-primer", "program key with the finish off");
    const baked = compileHooks(material).uniforms.detailMap?.value;
    assert.ok(baked instanceof THREE.DataTexture, "the atlas is baked when the material is patched, before any compile with the finish on");
    switchFinish(material, true);
    assert.ok(compileHooks(material).uniforms.detailMap?.value === baked, "the first compile with the finish on bakes nothing new");
    switchFinish(material, false);
    compileHooks(material);
    switchFinish(material, true);
    assert.ok(compileHooks(material).uniforms.detailMap?.value === baked, "a tier round trip keeps the atlas");
  });
});
