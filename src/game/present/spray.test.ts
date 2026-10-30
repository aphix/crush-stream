import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { packSpray, PERSON_SPRAY, SPRAY_PALETTE, unpackSpray } from "../match/look-data.ts";
import { CAR_SPRAY, sprayFace, type SprayLayout } from "../vehicle/spray-box.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";
import { applySpray, BARE_SPRAY, SprayBitmap, sprayUniforms } from "./spray.ts";
import { personSprayDepthTexture } from "./spray-depth.ts";

const LAYOUTS: Record<string, SprayLayout> = { car: CAR_SPRAY, person: PERSON_SPRAY };
/** Face order in a layout's `faces`. */
const FACE = { left: 0, right: 1, top: 2, front: 3, back: 4 } as const;

describe("given a spray bitmap on the wire", () => {
  it("when a mostly bare bitmap is packed and read back, then every texel is the same and it travels as runs far under the 4-bit size", () => {
    const texels = new Uint8Array(CAR_SPRAY.w * CAR_SPRAY.h);
    texels.fill(4, 1000, 1400);
    texels.fill(9, 5000, 5003);
    const packed = packSpray({ texels, palette: SPRAY_PALETTE });
    expect(packed.length, `${packed.length} bytes against ${texels.length / 2} as nibbles`).toBeLessThan(texels.length / 2 / 10);
    assertSameNumbers(unpackSpray(packed, texels.length)!.texels, texels, "texels read back");
  });

  it("when a speckled bitmap (no two texels alike in a row) is packed and read back, then every texel is the same and it travels as nibbles, 4 bits a texel", () => {
    const texels = new Uint8Array(PERSON_SPRAY.w * PERSON_SPRAY.h);
    for (let i = 0; i < texels.length; i++) texels[i] = (i % 15) + 1;
    const packed = packSpray({ texels, palette: SPRAY_PALETTE });
    expect(packed.length, "one byte of header, then two texels a byte").toBe(1 + texels.length / 2);
    assertSameNumbers(unpackSpray(packed, texels.length)!.texels, texels, "texels read back");
  });

  it("when a stroke in a colour of the player's own is packed and read back into another bitmap, then it is drawn in that colour, for 5 bytes over the same stroke in a preset", () => {
    const mine = new SprayBitmap(CAR_SPRAY);
    const ink = mine.inkOf(0x123456);
    mine.spray(new THREE.Vector3(-0.9, 0.8, 0), new THREE.Vector3(-1, 0, 0), 0.15, ink, () => 0);
    const packed = packSpray(mine);
    const theirs = new SprayBitmap(CAR_SPRAY);
    theirs.load(unpackSpray(packed, mine.texels.length));
    assertSameNumbers(theirs.rgba, mine.rgba, "drawn texel for texel");
    const at = mine.texels.indexOf(ink);
    assertSameNumbers(theirs.rgba.subarray(at * 4, at * 4 + 4), [0x12, 0x34, 0x56, 255], "in the player's colour");
    expect(packed.length, "a count byte, then the ink and its r, g, b").toBe(packSpray({ texels: mine.texels, palette: SPRAY_PALETTE }).length + 5);
    mine.dispose();
    theirs.dispose();
  });

  it("when a bitmap of presets alone is packed, then its bytes are the ones a build before own inks wrote, and that build's saved nibbles and runs read back", () => {
    const texels = [4, 4, 0, 0];
    assertSameNumbers(packSpray({ texels: new Uint8Array(texels), palette: SPRAY_PALETTE }), [0, 0x44, 0], "packed");
    for (const saved of [[0, 0x44, 0], [1, 2, 4, 2, 0]]) {
      const paint = unpackSpray(new Uint8Array(saved), texels.length)!;
      assertSameNumbers(paint.texels, texels, `texels of ${saved}`);
      assertSameNumbers(paint.palette, SPRAY_PALETTE, `the presets of ${saved}`);
    }
  });

  it("when every ink shows and a 16th colour is sprayed, then it takes the nearest ink and no colour on the bitmap changes", () => {
    const bitmap = new SprayBitmap(CAR_SPRAY);
    bitmap.load({ texels: Uint8Array.from({ length: bitmap.texels.length }, (_, i) => (i % 15) + 1), palette: SPRAY_PALETTE });
    expect(bitmap.inkOf(0xd02020), "the preset red").toBe(SPRAY_PALETTE.indexOf(0xd62828));
    assertSameNumbers(bitmap.palette, SPRAY_PALETTE, "the inks");
    bitmap.dispose();
  });

  it("when a painted bitmap is cleared (loaded with no paint), then every texel and rgba byte is zero and the inks are the presets, as loading an all-bare paint writes them", () => {
    const cleared = new SprayBitmap(CAR_SPRAY);
    cleared.spray(new THREE.Vector3(-0.9, 0.8, 0), new THREE.Vector3(-1, 0, 0), 0.15, cleared.inkOf(0x123456), () => 0);
    expect(cleared.painted(), "something to clear").toBeTruthy();
    cleared.load(null);
    const perTexel = new SprayBitmap(CAR_SPRAY);
    perTexel.load({ texels: new Uint8Array(cleared.texels.length), palette: SPRAY_PALETTE });
    assertSameNumbers(cleared.texels, perTexel.texels, "texels");
    assertSameNumbers(cleared.rgba, perTexel.rgba, "rgba");
    assertSameNumbers(cleared.palette, SPRAY_PALETTE, "inks");
    expect(cleared.painted(), "bare").toBe(false);
    cleared.dispose();
    perTexel.dispose();
  });

  const refused = [
    { it: "when its runs come up one texel short, then it is refused", bytes: [1, 255, 0], count: 256 },
    { it: "when a run names a colour past the palette, then it is refused", bytes: [1, 4, 16], count: 4 },
    { it: "when its nibbles are one byte short, then it is refused", bytes: [0, 0x21], count: 4 },
    { it: "when its own inks name ink 0, then it is refused", bytes: [3, 1, 0, 1, 2, 3, 4, 0], count: 4 },
    { it: "when its own inks run past its bytes, then it is refused", bytes: [3, 2, 5, 1, 2, 3, 4, 0], count: 4 },
    { it: "when its header is neither nibbles nor runs, then it is refused", bytes: [7, 1, 1], count: 1 },
  ] as const;
  for (const testCase of refused) {
    it(testCase.it, () => {
      expect(unpackSpray(new Uint8Array(testCase.bytes), testCase.count)).toBe(null);
    });
  }
});

describe("given a spray bitmap wrapped round a car or a driver as a box", () => {
  const faces = [
    { it: "when the car is sprayed on its left flank, then the left face takes it", layout: "car", p: [-0.9, 0.7, 0.5], n: [-1, 0, 0], face: FACE.left },
    { it: "when the car is sprayed on its right flank, then the right face takes it", layout: "car", p: [0.9, 0.7, 0.5], n: [1, 0, 0], face: FACE.right },
    { it: "when the car is sprayed on its roof, then the top face takes it", layout: "car", p: [0, 1.4, 0], n: [0, 1, 0], face: FACE.top },
    { it: "when the car is sprayed on its nose, then the front face takes it", layout: "car", p: [0, 0.6, 2.2], n: [0, 0, 1], face: FACE.front },
    { it: "when the car is sprayed on its tail, then the back face takes it", layout: "car", p: [0, 0.6, -2.2], n: [0, 0, -1], face: FACE.back },
    { it: "when the driver is sprayed on his chest, then the front face takes it", layout: "person", p: [0, 1.2, 0.12], n: [0, 0, 1], face: FACE.front },
    { it: "when the driver is sprayed under a shoe, then no face takes it", layout: "person", p: [0.1, 0, 0], n: [0, -1, 0], face: -1 },
  ] as const;
  for (const testCase of faces) {
    it(testCase.it, () => {
      const uv = new Float64Array(2);
      const [px, py, pz] = testCase.p;
      const [nx, ny, nz] = testCase.n;
      expect(sprayFace(LAYOUTS[testCase.layout]!, px, py, pz, nx, ny, nz, uv)).toBe(testCase.face);
    });
  }

  it("when one puff of a can that never misses lands on the car's left flank, then the texels round its spot on the left face take the can's colour out to its radius, and no other face is touched", () => {
    const bitmap = new SprayBitmap(CAR_SPRAY);
    const radius = 0.15;
    expect(bitmap.spray(new THREE.Vector3(-0.9, 0.8, 0), new THREE.Vector3(-1, 0, 0), radius, 6, () => 0)).toBe(true);
    const [fx, fy, fw, fh] = CAR_SPRAY.faces[FACE.left]!;
    // The spot's middle: z 0 is half way along the 4.7 m face, y 0.8 half way up its 1.6 m.
    const cx = Math.floor(fx + fw / 2);
    const cy = Math.floor(fy + fh / 2);
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < CAR_SPRAY.h; y++) {
      for (let x = 0; x < CAR_SPRAY.w; x++) {
        if (bitmap.texels[y * CAR_SPRAY.w + x] === 0) continue;
        expect(bitmap.texels[y * CAR_SPRAY.w + x], "the can's colour").toBe(6);
        if (x >= fx && x < fx + fw && y >= fy && y < fy + fh) inside++;
        else outside++;
      }
    }
    expect(outside, "no texel off the left face").toBe(0);
    expect(inside, "the puff painted the left face").toBeGreaterThan(0);
    expect(bitmap.texels[cy * CAR_SPRAY.w + cx], "the spot's middle is painted").toBe(6);
    // Its reach along the face: the radius in texels (`fw` over the box's 4.7 m length), never past it.
    const reach = (radius * fw) / (CAR_SPRAY.max[2] - CAR_SPRAY.min[2]);
    for (let x = fx; x < fx + fw; x++) if (bitmap.texels[cy * CAR_SPRAY.w + x] !== 0) expect(Math.abs(x + 0.5 - (fx + fw / 2)), `texel ${x} within the radius`).toBeLessThanOrEqual(reach + 0.5);
    expect(bitmap.texels[cy * CAR_SPRAY.w + Math.floor(fx + fw / 2 + reach - 1)], "painted out to a texel short of its radius").toBe(6);
    bitmap.dispose();
  });
});

describe("given the spray patch on a material", () => {
  const patched = (outer: THREE.Texture | null, key: string): THREE.Material => {
    const material = new THREE.MeshStandardMaterial();
    applySpray(material, sprayUniforms(PERSON_SPRAY, BARE_SPRAY, 1, outer && { map: outer }), "", "vSprayP = position;", key);
    return material;
  };

  it("when it is given the dummy's depth map, then its fragment tests the fragment's depth against the texel's outermost surface, and a patch with no map does not", () => {
    const dummy = compileHooks(patched(personSprayDepthTexture(), "dummy-depth")).fragmentShader;
    const plain = compileHooks(patched(null, "plain")).fragmentShader;
    expect(dummy.includes("#define SPRAY_DEPTH") && dummy.includes("sprayBand"), "the dummy's patch has the depth test").toBeTruthy();
    expect(!plain.includes("#define SPRAY_DEPTH"), "a patch with no map has none").toBe(true);
  });
});
