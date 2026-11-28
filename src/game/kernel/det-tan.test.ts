import { describe, expect, it } from "vitest";
import { detTan } from "./det-tan-core.js";
import { mulberry32 } from "../world/placements.ts";

const float = new Float64Array(1);
const words = new Uint32Array(float.buffer);
const integers = new BigInt64Array(float.buffer);
const ordinal = (x: number): bigint => {
  float[0] = x;
  const bits = integers[0]!;
  return bits < 0n ? -(bits & 0x7fffffffffffffffn) : bits;
};
const ulpsApart = (a: number, b: number): number => Math.abs(Number(ordinal(a) - ordinal(b)));
const MAX_ULP = 2;
const SAMPLES = 100_000;
const REACH = 1.55;
const DENSE_SAMPLES = 2_000_000;
/** From here up an argument is an odd quarter turn from a reduced angle inside the kernel's 0.6743 switch: the -1/t path. */
const BAND_FROM = 0.8964;
/** FNV-1a over the result bits of `SAMPLES` seeded inputs in ±REACH: the same in V8 and SpiderMonkey. */
const PINNED_BITS_HASH = 3693842762;

describe("given detTan over a seeded sweep of angles in ±1.55 rad", () => {
  it("when 2 million angles in ±1.55 and 1 million in the odd-turn band 0.8964 to 1.55 are read against Math.tan (V8's is fdlibm's), then every result is the same bits, and -x gives exactly -detTan(x)", () => {
    const random = mulberry32(12345);
    let different = 0;
    let asymmetric = 0;
    const check = (x: number): void => {
      if (detTan(x) !== Math.tan(x)) different++;
      if (!Object.is(detTan(-x), -detTan(x))) asymmetric++;
    };
    for (let i = 0; i < DENSE_SAMPLES; i++) check((random() * 2 - 1) * REACH);
    for (let i = 0; i < DENSE_SAMPLES / 2; i++) check(BAND_FROM + random() * (REACH - BAND_FROM));
    expect(different, "results that differ from Math.tan").toBe(0);
    expect(asymmetric, "results where -x is not -detTan(x)").toBe(0);
  });

  it("when the results' bits are hashed, then they equal the bits both engines were measured to produce", () => {
    const random = mulberry32(12345);
    let hash = 2166136261;
    for (let i = 0; i < SAMPLES; i++) {
      float[0] = detTan((random() * 2 - 1) * REACH);
      hash = Math.imul(hash ^ words[0]!, 16777619) >>> 0;
      hash = Math.imul(hash ^ words[1]!, 16777619) >>> 0;
    }
    expect(hash).toBe(PINNED_BITS_HASH);
  });
});

describe("given detTan at the angles where its range reduction and kernel change", () => {
  it("when it is read at 0, then it is that zero with its sign; at π/4, 3π/4 and the kernel's switch it is within 2 ulp of Math.tan, on both sides", () => {
    expect(Object.is(detTan(0), 0), "+0").toBe(true);
    expect(Object.is(detTan(-0), -0), "-0").toBe(true);
    for (const at of [Math.PI / 4, (3 * Math.PI) / 4, Math.PI / 2, Math.PI, 0.6743354797363281, 1e-300, 2 ** -28]) {
      for (const x of [at, -at, at * (1 + 2 ** -52), at * (1 - 2 ** -52)]) expect(ulpsApart(detTan(x), Math.tan(x)), `at ${x}`).toBeLessThanOrEqual(MAX_ULP);
    }
    expect(detTan(Math.PI / 4), "tan(π/4)").toBeCloseTo(1, 15);
  });

  it("when it is read far from zero and at non-finite angles, then large angles follow Math.tan within 2 ulp and infinities and NaN give NaN", () => {
    const random = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const x = (random() * 2 - 1) * 1e6;
      expect(ulpsApart(detTan(x), Math.tan(x)), `at ${x}`).toBeLessThanOrEqual(MAX_ULP);
    }
    for (const x of [1e7, -3e9, 1e15]) expect(Math.abs(detTan(x) / Math.tan(x) - 1), `at ${x}`).toBeLessThan(1e-12);
    for (const x of [Infinity, -Infinity, NaN]) expect(detTan(x), `at ${x}`).toBeNaN();
  });
});
