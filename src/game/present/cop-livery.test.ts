import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as THREE from "three";
import { CrashEngine } from "../engine/engine.ts";
import { element, stubBrowser } from "../engine/engine-headless.test-util.ts";
import { HudStore } from "../hud/hud-store.ts";
import "../kernel/rapier-node.test-util.ts";
import { CAR_SPRAY, NO_CAR_PICK, packSpray, SPRAY_FACE, SPRAY_PALETTE, sprayFace, type SprayLayout, type SprayPaint } from "../match/look-data.ts";
import { COP_LIVERY } from "../vehicle/car-styles/police.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { setGround } from "../world/ground.ts";
import { copPaint, copSpray } from "./cop-livery.ts";
import { wearCarLook } from "./car-look.ts";
import { SprayBitmap } from "./spray.ts";

const WHITE = 1;
const BLACK = 2;
/** The can's red preset: a player's dot on the roof. */
const RED = 4;
const ROOF_DOT = [0, 1.3, -0.4] as const;
const ROOF_BARE = [0.3, 1.3, 0.1] as const;
const UP = [0, 1, 0] as const;

/** The texel of `layout` that rest point `p` with normal `n` paints (`SprayBitmap.spray`'s rounding). */
function texelAt(layout: SprayLayout, p: readonly number[], n: readonly number[]): number {
  const uv = new Float64Array(2);
  const face = sprayFace(layout, p[0]!, p[1]!, p[2]!, n[0]!, n[1]!, n[2]!, uv);
  const [fx, fy, fw, fh] = layout.faces[face]!;
  return (fy + Math.min(fh - 1, Math.floor(uv[1]! * fh))) * layout.w + fx + Math.min(fw - 1, Math.floor(uv[0]! * fw));
}

function inkCount(paint: SprayPaint, layout: SprayLayout, face: number, ink: number): number {
  const [fx, fy, fw, fh] = layout.faces[face]!;
  let n = 0;
  for (let y = fy; y < fy + fh; y++) for (let x = fx; x < fx + fw; x++) if (paint.texels[y * layout.w + x] === ink) n++;
  return n;
}

const rgbaHex = (rgba: Uint8Array, i: number): number => (rgba[i * 4]! << 16) | (rgba[i * 4 + 1]! << 8) | rgba[i * 4 + 2]!;

describe("given the police style's livery drawn into a spray bitmap", () => {
  const spray = copSpray(CAR_STYLES.police)!;

  it("when it is read, then the roof is white, POLICE stands black on both flanks, and the nose, tail and rear quarters stay bare (the black body)", () => {
    const { layout } = spray;
    assert.equal(spray.texels[texelAt(layout, ROOF_BARE, UP)], WHITE, "roof");
    for (const face of [SPRAY_FACE.left, SPRAY_FACE.right]) assert.ok(inkCount(spray, layout, face, BLACK) > 100, `letters on face ${face}`);
    assert.equal(spray.texels[texelAt(layout, [0, 0.5, 2.0], [0, 0, 1])], 0, "nose");
    assert.equal(spray.texels[texelAt(layout, [0, 0.6, -2.1], [0, 0, -1])], 0, "tail");
    assert.equal(spray.texels[texelAt(layout, [0.8, 0.6, -1.6], [1, 0, 0])], 0, "rear quarter");
    assert.equal(spray.palette[WHITE], COP_LIVERY.doors);
    assert.equal(spray.palette[BLACK], COP_LIVERY.body);
  });

  it("when a car with no light bar asks for it, then there is none", () => {
    assert.ok(copSpray(CAR_STYLES.sedan) === null, "a sedan has no livery bitmap");
    assert.ok(copPaint(CAR_STYLES.sedan, CAR_SPRAY) === null, "a sedan has no livery paint");
  });
});

/** The uniforms a three program build hands the material's compile hook. */
function compiledUniforms(material: THREE.Material): Record<string, THREE.IUniform> {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  Reflect.apply(material.onBeforeCompile, material, [shader]);
  return shader.uniforms;
}

function paintKeys(car: DeformableCar): string[] {
  const m = car.lookMeshes();
  return [m.bodyPaint, m.hood.material, m.trunk.material, ...m.doors.map((d) => d.material)].map((material) => {
    assert.ok(material instanceof THREE.Material);
    return material.customProgramCacheKey();
  });
}

// Last in the file: the engine's browser stand-ins define `document`.
describe("given the real engine with every car built as police", () => {
  let engine: CrashEngine;
  before(async () => {
    stubBrowser();
    engine = new CrashEngine(element(), new HudStore(), element());
    Object.assign(engine["renderer"], { render() {}, compile() {}, compileAsync: () => Promise.resolve() });
    await engine.ready;
  });
  after(() => {
    engine.dispose();
    setGround(null);
  });

  it("when a cop with no player's look is dressed, then its paint samples its style's livery bitmap", () => {
    engine.useOneBody("police");
    const cop = engine["cars"][1]!;
    assert.equal(cop.style.id, "police");
    // Identity, not assert.equal: a failing equal inspects both textures in full (megabytes of texels).
    assert.ok(compiledUniforms(cop.lookMeshes().bodyPaint).sprayMap?.value === copSpray(CAR_STYLES.police)!.texture, "the cop's paint samples its livery bitmap");
  });

  it("when the player's own cop has a red dot sprayed on the roof, then its bare texels show the livery, the dot keeps its red, and the bitmap packs as it did without the livery", () => {
    const mine: SprayBitmap = engine["looks"].mine.carSpray;
    engine.useOneBody("sedan");
    mine.load(null);
    mine.spray(new THREE.Vector3(...ROOF_DOT), new THREE.Vector3(...UP), 0.1, RED, () => 0);
    const packed = packSpray(mine).join();
    engine.useOneBody("police");
    const bare = texelAt(mine.layout, ROOF_BARE, UP);
    const dot = texelAt(mine.layout, ROOF_DOT, UP);
    assert.equal(mine.texels[bare], 0, "the livery is not in the texels");
    assert.equal(rgbaHex(mine.rgba, bare), COP_LIVERY.doors, "a bare roof texel shows the white roof");
    assert.equal(mine.rgba[bare * 4 + 3], 255);
    assert.equal(rgbaHex(mine.rgba, dot), SPRAY_PALETTE[RED], "the dot keeps its ink");
    assert.equal(packSpray(mine).join(), packed, "wire and storage bytes");
    engine.useOneBody("sedan");
    assert.equal(mine.rgba[bare * 4 + 3], 0, "back on a sedan, the bare roof is bare again");
    mine.load(null);
  });

  it("when a cop and a sprayed sedan are dressed on one tier, then every program key of the cop's paints is one the sprayed sedan's paints use", () => {
    engine.useOneBody("police");
    const sedan = engine["buildCar"](engine["cars"].length, { cls: "sedan", style: "sedan" });
    wearCarLook(sedan, NO_CAR_PICK, new SprayBitmap(CAR_SPRAY));
    engine["dressCar"](sedan);
    const sedanKeys = new Set(paintKeys(sedan));
    for (const key of paintKeys(engine["cars"][1]!)) assert.ok(sedanKeys.has(key), `cop key ${key} not in ${[...sedanKeys].join(", ")}`);
    engine["scene"].remove(sedan.group);
    sedan.dispose();
  });
});
