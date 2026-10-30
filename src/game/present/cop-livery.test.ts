import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { CrashEngine } from "../engine/engine.ts";
import { bootEngine, stubBrowser } from "../engine/engine-headless.test-util.ts";
import "../kernel/rapier-node.test-util.ts";
import { NO_CAR_PICK, packSpray, SPRAY_PALETTE, type SprayPaint } from "../match/look-data.ts";
import { CAR_SPRAY, SPRAY_FACE, sprayFace, type SprayLayout } from "../vehicle/spray-box.ts";
import { COP_LIVERY } from "../vehicle/car-styles/police.ts";
import { CAR_STYLES } from "../vehicle/car-variants.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { setGround } from "../world/ground.ts";
import { copPaint, copSpray } from "./cop-livery.ts";
import { wearCarLook } from "./car-look.ts";
import { SprayBitmap } from "./spray.ts";
import { must } from "../kernel/must.test-util.ts";

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
  const spray = copSpray(CAR_STYLES.police, "desktop")!;

  it("when it is read, then the roof, the A-pillars and the C-pillars beside the rear glass are white, POLICE stands black on both flanks, and the nose, front fenders, tail, rear quarters, the sail's tail on the deck's shoulder and the skin under the rear glass stay bare (the black body)", () => {
    const { layout } = spray;
    expect(spray.texels[texelAt(layout, ROOF_BARE, UP)], "roof").toBe(WHITE);
    for (const face of [SPRAY_FACE.left, SPRAY_FACE.right]) expect(inkCount(spray, layout, face, BLACK), `letters on face ${face}`).toBeGreaterThan(100);
    expect(spray.texels[texelAt(layout, [0, 0.5, 2.0], [0, 0, 1])], "nose").toBe(0);
    expect(spray.texels[texelAt(layout, [0, 0.6, -2.1], [0, 0, -1])], "tail").toBe(0);
    expect(spray.texels[texelAt(layout, [0.8, 0.6, -1.6], [1, 0, 0])], "rear quarter").toBe(0);
    // The rear glass spans |x| < 0.51 at z -1.4 (police: the sedan's quad, 1.05 wide at -1.68 to 1.0 at -1.159).
    expect(spray.texels[texelAt(layout, [0, 1.15, -1.4], UP)], "under the rear glass").toBe(0);
    expect(spray.texels[texelAt(layout, [0.65, 1.1, -1.4], UP)], "C-pillar beside the rear glass").toBe(WHITE);
    expect(spray.texels[texelAt(layout, [0.6, 1.0, -1.665], UP)], "the deck lid's front strip beside the rear glass").toBe(0);
    // The A-post over the belt (0.9) at z 0.6, between the door glass's front edge and the windshield's foot (0.93): white, as the reference's.
    expect(spray.texels[texelAt(layout, [0.75, 1.0, 0.6], [1, 0, 0])], "A-pillar").toBe(WHITE);
    expect(spray.texels[texelAt(layout, [0.8, 0.75, 0.85], [1, 0, 0])], "front fender, ahead of the door, under the belt").toBe(0);
    expect(spray.palette[WHITE]).toBe(COP_LIVERY.doors);
    expect(spray.palette[BLACK]).toBe(COP_LIVERY.body);
  });

  it("when a car with no light bar asks for it, then there is none", () => {
    expect(copSpray(CAR_STYLES.sedan, "desktop"), "a sedan has no livery bitmap").toBe(null);
    expect(copPaint(CAR_STYLES.sedan, CAR_SPRAY), "a sedan has no livery paint").toBe(null);
  });

  it("when cops ask for it on a desktop and on a phone, then every cop of the style shares one bitmap per device, 512 a side on the desktop and the rivals' 256 on the phone", () => {
    expect(copSpray(CAR_STYLES.police, "desktop"), "a second desktop cop drew its own bitmap").toBe(spray);
    const phone = copSpray(CAR_STYLES.police, "mobile")!;
    expect(`${spray.layout.w} ${phone.layout.w}`).toBe("512 256");
    expect(copSpray(CAR_STYLES.police, "mobile"), "a second phone cop drew its own bitmap").toBe(phone);
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
    must(material instanceof THREE.Material, "paint is not a single material");
    return material.customProgramCacheKey();
  });
}

// Last in the file: the engine's browser stand-ins define `document`.
describe("given the real engine with every car built as police", () => {
  let engine: CrashEngine;
  beforeAll(async () => {
    stubBrowser();
    engine = await bootEngine({ fades: true });
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it("when a cop with no player's look is dressed, then its paint samples its style's livery bitmap", () => {
    engine.useOneBody("police");
    const cop = engine["cars"][1]!;
    expect(cop.style.id).toBe("police");
    // Identity, not equality: a failing deep compare inspects both textures in full (megabytes of texels).
    expect(compiledUniforms(cop.lookMeshes().bodyPaint).sprayMap?.value, "the cop's paint samples its livery bitmap").toBe(copSpray(CAR_STYLES.police, engine["deviceClass"])!.texture);
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
    expect(mine.texels[bare], "the livery is not in the texels").toBe(0);
    expect(rgbaHex(mine.rgba, bare), "a bare roof texel shows the white roof").toBe(COP_LIVERY.doors);
    expect(mine.rgba[bare * 4 + 3]).toBe(255);
    expect(rgbaHex(mine.rgba, dot), "the dot keeps its ink").toBe(SPRAY_PALETTE[RED]);
    expect(packSpray(mine).join(), "wire and storage bytes").toBe(packed);
    engine.useOneBody("sedan");
    expect(mine.rgba[bare * 4 + 3], "back on a sedan, the bare roof is bare again").toBe(0);
    mine.load(null);
  });

  it("when a cop and a sprayed sedan are dressed on one tier, then every program key of the cop's paints is one the sprayed sedan's paints use", () => {
    engine.useOneBody("police");
    const sedan = engine["buildCar"](engine["cars"].length, { cls: "sedan", style: "sedan" });
    wearCarLook(sedan, NO_CAR_PICK, new SprayBitmap(CAR_SPRAY));
    engine["dressCar"](sedan);
    const sedanKeys = new Set(paintKeys(sedan));
    for (const key of paintKeys(engine["cars"][1]!)) expect(sedanKeys.has(key), `cop key ${key} not in ${[...sedanKeys].join(", ")}`).toBeTruthy();
    engine["scene"].remove(sedan.group);
    sedan.dispose();
  });
});
