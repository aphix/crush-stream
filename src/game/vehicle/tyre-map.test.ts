import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type * as THREE from "three";
import type * as CarMaterials from "./car-materials.ts";
import {
  BEAD_RING_CENTRE_ROW,
  BEAD_RING_HALF_ROWS,
  LETTER_DASH_ROWS,
  LETTER_FIRST_ROW,
  LETTER_SLOTS,
  makeWheelGeometry,
  makeWheelGeometryFar,
  RIB_CREST_ROWS,
  RIB_HALF_ROWS,
  TREAD_BAND_FIRST_ROW,
  TREAD_BAND_ROWS,
  treadNormalMap,
  TYRE_MAP_HEIGHT,
  TYRE_MAP_WIDTH,
} from "./car-materials.ts";
import { BYTES_PER_TEXEL, deviationAt, FLAT_DEVIATION, mapBytes, normalAt, SIDEWALL_RELIEF_MIN, strongestDeviation } from "./tyre-map.test-util.ts";

/** sha-256 of the 64 rows the tread-only map had (128 x 64 RGBA bytes), taken before the sidewalls were added. */
const TREAD_ONLY_MAP_DIGEST = "7965487684e3707172607b773c8947ed96e93517e6d03586f1485dafaff784a6";
/** Triangles of the near and far wheels before the sidewall detail: the detail is texture, never geometry. */
const NEAR_WHEEL_TRIANGLES = 676;
const FAR_WHEEL_TRIANGLES = 120;
/** An 8-bit normal is unit length within the rounding of its three bytes. */
const UNIT_LENGTH_TOLERANCE = 0.01;
const MAP_ROW_BYTES = TYRE_MAP_WIDTH * BYTES_PER_TEXEL;
const LETTER_BAND_LAST_ROW = LETTER_FIRST_ROW + Math.max(...LETTER_DASH_ROWS) - 1;
const OUTER_SIDEWALL_LAST_ROW = TREAD_BAND_FIRST_ROW - 1;
const INNER_SIDEWALL_FIRST_ROW = TREAD_BAND_FIRST_ROW + TREAD_BAND_ROWS;
const BAND_END_V = TREAD_BAND_FIRST_ROW / TYRE_MAP_HEIGHT;
const INNER_BAND_START_V = INNER_SIDEWALL_FIRST_ROW / TYRE_MAP_HEIGHT;
const TREAD_CENTRE_V = (TREAD_BAND_FIRST_ROW + TREAD_BAND_ROWS / 2) / TYRE_MAP_HEIGHT;
/** A sidewall row counted from the inner bead is the outer row mirrored about the tread band. */
const innerRow = (outerRow: number): number => TYRE_MAP_HEIGHT - outerRow;

const digestOf = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const rowBytes = (bytes: Uint8Array, firstRow: number, rows: number): Uint8Array => bytes.subarray(firstRow * MAP_ROW_BYTES, (firstRow + rows) * MAP_ROW_BYTES);

/** The map module built a second time from scratch: a static import would return the one cached copy, which is the point of the dynamic one. */
async function freshBuild(): Promise<typeof CarMaterials> {
  return import(new URL("./car-materials.ts?fresh-tyre-map", import.meta.url).href);
}

/** The distinct `uv1` v values of the geometry's vertices, ascending. */
function distinctV(geometry: THREE.BufferGeometry): number[] {
  const uv1 = geometry.getAttribute("uv1");
  const seen = new Set<number>();
  for (let i = 0; i < uv1.count; i++) seen.add(uv1.getY(i));
  return [...seen].sort((a, b) => a - b);
}

describe("given the tyre normal map built twice from scratch", () => {
  it("when the two builds' bytes are hashed, then they are identical and the size is the stated one", async () => {
    const first = treadNormalMap();
    const second = (await freshBuild()).treadNormalMap();
    expect(second, "a fresh build, not the cached texture").not.toBe(first);
    expect(first.image.width, "width").toBe(TYRE_MAP_WIDTH);
    expect(first.image.height, "height").toBe(TYRE_MAP_HEIGHT);
    expect(mapBytes(first).length, "bytes").toBe(TYRE_MAP_WIDTH * TYRE_MAP_HEIGHT * BYTES_PER_TEXEL);
    expect(digestOf(mapBytes(second)), "digest of the bytes").toBe(digestOf(mapBytes(first)));
  });

  it("when the map is asked for twice, then it is the one shared texture", () => {
    expect(treadNormalMap()).toBe(treadNormalMap());
  });

  it("when the tread band's rows are hashed, then they are the tread-only map's, so the tread looks as it did", () => {
    const tread = rowBytes(mapBytes(treadNormalMap()), TREAD_BAND_FIRST_ROW, TREAD_BAND_ROWS);
    expect(digestOf(tread)).toBe(TREAD_ONLY_MAP_DIGEST);
  });

  it("when every texel is decoded, then each normal is unit length and points out of the tyre", () => {
    const bytes = mapBytes(treadNormalMap());
    for (let row = 0; row < TYRE_MAP_HEIGHT; row++) {
      for (let column = 0; column < TYRE_MAP_WIDTH; column++) {
        const [x, y, z] = normalAt(bytes, column, row);
        expect(Math.abs(Math.hypot(x, y, z) - 1), `length at column ${column}, row ${row}`).toBeLessThan(UNIT_LENGTH_TOLERANCE);
        expect(z, `outward at column ${column}, row ${row}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("given the rows of the tyre normal map", () => {
  const testCases = [
    { it: "row 0 (the rim's and spokes' uv1 row)", firstRow: 0, lastRow: 0, expectedRelief: false },
    { it: "the outer guard rows between the bead edge and the bead ring", firstRow: 0, lastRow: BEAD_RING_CENTRE_ROW - BEAD_RING_HALF_ROWS - 1, expectedRelief: false },
    { it: "the outer bead ring", firstRow: BEAD_RING_CENTRE_ROW - BEAD_RING_HALF_ROWS, lastRow: BEAD_RING_CENTRE_ROW + BEAD_RING_HALF_ROWS, expectedRelief: true },
    { it: "the flat row between the outer bead ring and the lettering", firstRow: BEAD_RING_CENTRE_ROW + BEAD_RING_HALF_ROWS + 1, lastRow: LETTER_FIRST_ROW - 2, expectedRelief: false },
    { it: "the outer lettering band", firstRow: LETTER_FIRST_ROW - 1, lastRow: LETTER_BAND_LAST_ROW + 1, expectedRelief: true },
    { it: "the flat row between the outer lettering and the ribs", firstRow: LETTER_BAND_LAST_ROW + 2, lastRow: RIB_CREST_ROWS[0] - Math.ceil(RIB_HALF_ROWS) - 1, expectedRelief: false },
    { it: "the outer ribs", firstRow: RIB_CREST_ROWS[0] - 1, lastRow: RIB_CREST_ROWS[2] + 1, expectedRelief: true },
    { it: "the outer margin before the tread band's lugs", firstRow: RIB_CREST_ROWS[2] + 3, lastRow: OUTER_SIDEWALL_LAST_ROW + 3, expectedRelief: false },
    { it: "the inner bead ring", firstRow: innerRow(BEAD_RING_CENTRE_ROW + BEAD_RING_HALF_ROWS), lastRow: innerRow(BEAD_RING_CENTRE_ROW - BEAD_RING_HALF_ROWS), expectedRelief: true },
    { it: "the inner ribs", firstRow: innerRow(RIB_CREST_ROWS[2] + 1), lastRow: innerRow(RIB_CREST_ROWS[0] - 1), expectedRelief: true },
    { it: "the inner rows where the outer sidewall has its lettering (the lettering is outer only)", firstRow: innerRow(LETTER_BAND_LAST_ROW), lastRow: innerRow(LETTER_FIRST_ROW), expectedRelief: false },
    { it: "the inner guard rows at the inner bead edge", firstRow: innerRow(BEAD_RING_CENTRE_ROW - BEAD_RING_HALF_ROWS - 1), lastRow: TYRE_MAP_HEIGHT - 1, expectedRelief: false },
  ] as const;

  for (const testCase of testCases) {
    it(`when the texels of ${testCase.it} are read, then the strongest normal tilt is ${testCase.expectedRelief ? "above the sidewall relief floor" : "flat"}`, () => {
      expect(testCase.firstRow, "the row range is not empty").toBeLessThanOrEqual(testCase.lastRow);
      const strongest = strongestDeviation(mapBytes(treadNormalMap()), testCase.firstRow, testCase.lastRow);
      if (testCase.expectedRelief) expect(strongest, `tilt ${strongest.toFixed(3)} over rows ${testCase.firstRow}..${testCase.lastRow}`).toBeGreaterThan(SIDEWALL_RELIEF_MIN);
      else expect(strongest, `tilt ${strongest.toFixed(3)} over rows ${testCase.firstRow}..${testCase.lastRow}`).toBeLessThan(FLAT_DEVIATION);
    });
  }

  it("when the bead ring's rows are read along the tyre, then every column holds the column 0 texel (a ring, not a dashed line)", () => {
    const bytes = mapBytes(treadNormalMap());
    const ringRow = BEAD_RING_CENTRE_ROW - 1;
    const column0 = digestOf(bytes.subarray(ringRow * MAP_ROW_BYTES, ringRow * MAP_ROW_BYTES + BYTES_PER_TEXEL));
    for (let column = 1; column < TYRE_MAP_WIDTH; column++) {
      const at = ringRow * MAP_ROW_BYTES + column * BYTES_PER_TEXEL;
      expect(digestOf(bytes.subarray(at, at + BYTES_PER_TEXEL)), `column ${column}`).toBe(column0);
    }
  });

  it("when a lettering row is read along the tyre, then raised dashes and flat gaps both occur at least once a slot", () => {
    const bytes = mapBytes(treadNormalMap());
    const letterRow = LETTER_FIRST_ROW - 1;
    let dashEdges = 0;
    let gaps = 0;
    for (let column = 0; column < TYRE_MAP_WIDTH; column++) {
      if (deviationAt(bytes, column, letterRow) > SIDEWALL_RELIEF_MIN) dashEdges++;
      else gaps++;
    }
    expect(dashEdges, `${dashEdges} raised texels`).toBeGreaterThanOrEqual(LETTER_SLOTS);
    expect(gaps, `${gaps} flat texels`).toBeGreaterThanOrEqual(LETTER_SLOTS);
  });
});

describe("given the near and far wheel geometry", () => {
  it("when the wheels are built, then their triangle counts are the ones before the sidewall detail", () => {
    expect(makeWheelGeometry().index!.count / 3, "near wheel").toBe(NEAR_WHEEL_TRIANGLES);
    expect(makeWheelGeometryFar().index!.count / 3, "far wheel").toBe(FAR_WHEEL_TRIANGLES);
  });

  it("when the near tyre's uv1 is read, then its two points on each sidewall sample interior sidewall rows and the tread edge samples the lug start", () => {
    const sidewallV = distinctV(makeWheelGeometry()).filter((v) => v > 0 && v < TREAD_CENTRE_V);
    expect(sidewallV.length, "outer: two sidewall points and the tread edge").toBe(3);
    expect(sidewallV[0]! * TYRE_MAP_HEIGHT, "the first sidewall point is past the bead ring").toBeGreaterThan(BEAD_RING_CENTRE_ROW);
    expect(sidewallV[1]! * TYRE_MAP_HEIGHT, "the second is among the ribs").toBeGreaterThan(RIB_CREST_ROWS[0] - RIB_HALF_ROWS);
    const innerV = distinctV(makeWheelGeometry()).filter((v) => v > TREAD_CENTRE_V && v < 1);
    expect(innerV.length, "inner: the tread edge and two sidewall points").toBe(3);
  });

  it("when the far tyre's uv1 is read, then its five points land in the outer sidewall, the tread centre and the inner sidewall", () => {
    const [beadEdge, outerShoulder, crown, innerShoulder, innerBeadEdge] = distinctV(makeWheelGeometryFar());
    expect(distinctV(makeWheelGeometryFar()).length, "five distinct v values").toBe(5);
    expect(beadEdge, "the outer bead edge is the flat row").toBe(0);
    expect(outerShoulder! > 0 && outerShoulder! < BAND_END_V, "the outer point is in the outer sidewall band").toBeTruthy();
    expect(crown! >= BAND_END_V && crown! < INNER_BAND_START_V, "the crown is in the tread band").toBeTruthy();
    expect(innerShoulder! > INNER_BAND_START_V && innerShoulder! < 1, "the inner point is in the inner sidewall band").toBeTruthy();
    expect(innerBeadEdge, "the inner bead edge is the last row").toBe(1);
  });
});
