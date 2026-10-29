import { describe, expect, it } from "vitest";
import { OUTFIT, type DriverLook } from "./driver-look.ts";
import { VIP_LOOK } from "./dummy-dress.ts";
import { restFits } from "./dummy-fit.ts";
import { EYES_AT, headAt, measureHead } from "./dummy-head.ts";
import { surfaceZ } from "./dummy-loft.ts";
import { drawnRows, type Drawn } from "./dummy-pose.test-util.ts";
import { BUILD, ROLE } from "./dummy-rig.ts";

/** Within this half width (m) of the face's middle and `FACE_CLEAR` inside the head's, from `FACE_FROM` of the head's height over the chin up to `FACE_TOP` (over the brows), no hair stands closer than `FACE_CLEAR` m behind the face's surface. */
const FACE_OPEN = 0.05;
const FACE_FROM = 0.1;
const FACE_TOP = 0.72;
const FACE_CLEAR = 0.01;
/** The reference man's hair stands about 0.023 m over his crown. */
const CROWN_VOLUME = 0.018;
/** Her hair frames her face: at eye height (within `EYE_BAND` m) it reaches past this |x| (m) on each side, and it ends above `HAIR_ENDS` m (her shoulders). */
const EYE_BAND = 0.012;
const FRAME_X = 0.1;
const HAIR_ENDS = 1.4;

const MAN: DriverLook = { woman: false, shirt: 0x2c4f9e, pants: 0x283650, hair: 0x4a3020, hat: null, mustache: false, outfit: OUTFIT.TEE };
const WOMAN: DriverLook = { woman: true, shirt: 0x7b4fa6, pants: 0x7f9fc6, hair: 0xb5532a, hat: null, mustache: false, outfit: OUTFIT.TOP };
const fits = restFits();
const HEADS = [
  { name: "man", look: MAN, fit: fits.man, kinds: BUILD.MAN },
  { name: "president", look: VIP_LOOK, fit: fits.portly, kinds: BUILD.PORTLY },
  { name: "woman", look: WOMAN, fit: fits.woman, kinds: BUILD.WOMAN },
] as const;

const hairOf = (rows: readonly Drawn[]) => rows.filter((row) => row.wear && (row.role === ROLE.HAIR || row.role === ROLE.LOCKS));

describe("given the people's hair", () => {
  for (const { name, look, fit } of HEADS) {
    it(`when the ${name} stands bare-headed, then the hair stays off the face from under the chin's line to over the brows`, () => {
      const head = measureHead(fit);
      const height = head.top - head.chin;
      const band = hairOf(drawnRows(false, look).rows).filter((row) => row.at.y > head.chin + FACE_FROM * height && row.at.y < head.chin + FACE_TOP * height && Math.abs(row.at.x) < Math.min(FACE_OPEN, headAt(head, row.at.y)[0] - FACE_CLEAR));
      expect(band.length, "the hair crosses that band (behind the head)").toBeGreaterThan(0);
      const over = band.filter((row) => row.at.z > surfaceZ(fit, row.at.x, row.at.y) - FACE_CLEAR);
      expect(over.length, `${over.length} hair vertices over the face`).toBe(0);
    });
  }

  it("when the man stands bare-headed, then his hair stands full over his crown", () => {
    const head = measureHead(fits.man);
    const top = Math.max(...hairOf(drawnRows(false, MAN).rows).map((row) => row.at.y));
    expect(top, `it stands ${(top - head.top).toFixed(3)} m over his crown`).toBeGreaterThanOrEqual(head.top + CROWN_VOLUME);
  });

  it("when she stands, then her hair frames her face past her cheeks on both sides at eye height and ends on her shoulders", () => {
    const head = measureHead(fits.woman);
    const eyes = head.chin + EYES_AT * (head.top - head.chin);
    const hair = hairOf(drawnRows(false, WOMAN).rows);
    const atEyes = hair.filter((row) => Math.abs(row.at.y - eyes) < EYE_BAND);
    expect(Math.max(...atEyes.map((row) => row.at.x)), `it reaches x = ${Math.max(...atEyes.map((row) => row.at.x)).toFixed(3)} m on her left`).toBeGreaterThanOrEqual(FRAME_X);
    expect(Math.min(...atEyes.map((row) => row.at.x)), `it reaches x = ${Math.min(...atEyes.map((row) => row.at.x)).toFixed(3)} m on her right`).toBeLessThanOrEqual(-FRAME_X);
    expect(Math.min(...hair.map((row) => row.at.y)), `it hangs to ${Math.min(...hair.map((row) => row.at.y)).toFixed(3)} m`).toBeGreaterThanOrEqual(HAIR_ENDS);
  });
});
