import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dressRow } from "./dummy-dress.ts";
import { OUTFIT, type DriverLook } from "./driver-look.ts";
import { FLAGS_AT, ROW_TEXELS } from "./dummy-rig.ts";

const MAN: DriverLook = { woman: false, shirt: 0x283857, pants: 0x1b222f, hair: 0x432d1c, hat: null, mustache: false, outfit: OUTFIT.TEE };

/** The share of `hang` (torso and sleeves, then trousers) that `look` (a police driver when `cop`) is dressed with. */
function hangOf(look: DriverLook, cop: boolean): [number, number] {
  const rows = new Float32Array(ROW_TEXELS * 4);
  dressRow(rows, 0, cop, look);
  return [rows[FLAGS_AT * 4 + 2]!, rows[FLAGS_AT * 4 + 3]!];
}

describe("given a slot dressed for its look", () => {
  const testCases = [
    { it: "when a man wears the tee and jeans, then his tee, sleeves and jeans hang off his body", look: MAN, cop: false, hang: [1, 1] },
    { it: "when a man wears the long sleeves and jeans, then they hang off his body", look: { ...MAN, outfit: OUTFIT.LONG_SLEEVE }, cop: false, hang: [1, 1] },
    { it: "when a woman wears her top and cut-offs, then they cling: the hang is the men's push", look: { ...MAN, woman: true, outfit: OUTFIT.TOP }, cop: false, hang: [0, 0] },
    { it: "when a woman is a police driver, then her uniform clings too, whatever the uniform's own hang", look: { ...MAN, woman: true }, cop: true, hang: [0, 0] },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const [upper, legs] = hangOf(testCase.look, testCase.cop);
      assert.equal(upper, testCase.hang[0], "torso and sleeves");
      assert.equal(legs, testCase.hang[1], "trousers");
    });
  }
});
