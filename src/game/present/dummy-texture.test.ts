import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { FACE, FACES } from "./dummy-faces.ts";
import { EYE_U, EYES_AT, FACE_SPAN, LIP_AT } from "./dummy-head.ts";
import { PRINT_CELL, PRINT_CELLS, PRINT_TEXELS, printMap } from "./dummy-texture.ts";

/** A window this wide covers the eye at each of the atlas's pupils; a pupil alone is a texel or two. */
const EYE_US = [0.5 - EYE_U, 0.5 + EYE_U] as const;
const EYE_HALF_WINDOW = 4;
const EYE_ROW_SLACK = 3;
/** The eye is looked for from half way down to the mouth up to this many rows over the eye line: the brows, as dark, sit 4 over it. */
const UNDER_BROWS = 2;

describe("given the print atlas", () => {
  it("when each face cell is read, then its darkest row at each eye, between the nose and the brows, lies on the head's eye line and its corners are clear", () => {
    const map = printMap();
    const px = map.image.data as Uint8Array;
    const n = PRINT_TEXELS;
    assert.equal(map.image.height, n * PRINT_CELLS);
    assert.equal(Object.keys(FACE).length, FACES.length);
    const eyeRow = (EYES_AT / FACE_SPAN) * n;
    const noseRow = Math.round(((EYES_AT + LIP_AT) / 2 / FACE_SPAN) * n);
    /** Over white: a clear texel never reads as an eye. */
    const overWhite = (cell: number, x: number, y: number) => {
      const i = ((cell * n + y) * n + x) * 4;
      const alpha = px[i + 3]! / 255;
      return ((px[i]! + px[i + 1]! + px[i + 2]!) / 3) * alpha + 255 * (1 - alpha);
    };
    for (const name of Object.keys(FACE) as (keyof typeof FACE)[]) {
      const cell = PRINT_CELL[name];
      for (const u of EYE_US) {
        const middle = Math.round(u * n - 0.5);
        let [darkest, darkestRow] = [Infinity, -1];
        for (let y = noseRow; y <= eyeRow + UNDER_BROWS; y++) {
          let sum = 0;
          for (let x = middle - EYE_HALF_WINDOW; x <= middle + EYE_HALF_WINDOW; x++) sum += overWhite(cell, x, y);
          if (sum < darkest) [darkest, darkestRow] = [sum, y];
        }
        assert.ok(Math.abs(darkestRow - eyeRow) <= EYE_ROW_SLACK, `${name}'s eye at u ${u} is darkest on row ${darkestRow}, the head's eye line is ${eyeRow.toFixed(1)}`);
      }
      for (const [x, y] of [[0, 0], [n - 1, 0], [0, n - 1], [n - 1, n - 1]] as const) {
        assert.equal(px[((cell * n + y) * n + x) * 4 + 3], 0, `${name}'s corner (${x}, ${y}) is clear`);
      }
    }
  });
});
