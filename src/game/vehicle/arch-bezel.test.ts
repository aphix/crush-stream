import { describe, expect, it } from "vitest";
import { CAR_STYLE_IDS, CAR_STYLES } from "./car-variants.ts";
import { carFrame } from "./car-rig.ts";
import { lipPath } from "./car-well-mesh.ts";
import { detailReader } from "./car-detail-map.test-util.ts";

/** A lip flares at least this far (m): the first hatchback's 9 mm lip read as no bezel at chase distance. */
const LIP_FLARE_MIN_M = 0.01;
/** The dark roll at a lip's edge reads at least this dark, and its crown bead at least this proud (m). */
const EDGE_CAVITY = 0.6;
const BEAD_HEIGHT_M = 0.003;
/** The bead's stroke stands this share of the lip's width out from the opening's edge (`BEZEL_STROKES`). */
const BEAD_SHARE = 0.35;
/** A cladding style's paint reads at least this dark where its lip's toe meets the skin (the reference's black trim); a plain bezel's soft seam reads .3 at most. */
const CLADDING_CAVITY = 0.5;

/** The detail map read from the opening's edge `out` m along the outward normal at the top of the front wheel's lip. */
function readLipTop(id: (typeof CAR_STYLE_IDS)[number], out: (lipWidth: number, inset: number) => number) {
  const style = CAR_STYLES[id];
  const lip = style.arch.lip!;
  const [, wy, wz] = carFrame(style).wheels.find(([x, , z]) => x > 0 && z > 0)!;
  const path = lipPath(style, wy, wz, lip.square === true);
  const [z, y, uz, uy] = path[Math.floor(path.length / 2)]!;
  const d = out(lip.width, lip.inset ?? 0);
  return detailReader(style)("side", z + uz * d, y + uy * d);
}

describe("given each style's wheel-arch lips and their detail-map bezels", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s lip is read, then it flares at least ${LIP_FLARE_MIN_M * 1000} mm over the body side`, () => {
      const flare = CAR_STYLES[id].arch.lip?.flare ?? 0;
      expect(flare, `${id}: the lip flares ${(flare * 1000).toFixed(1)} mm`).toBeGreaterThanOrEqual(LIP_FLARE_MIN_M);
    });

    it(`when the ${id}'s detail map is read across its arch lip's top, then the opening's edge is a dark roll and the crown carries a raised bead`, () => {
      const edge = readLipTop(id, (_, inset) => -inset);
      const bead = readLipTop(id, (width, inset) => BEAD_SHARE * width - inset);
      expect(edge.cavity, `${id}: the lip's edge reads cavity ${edge.cavity.toFixed(2)}`).toBeGreaterThanOrEqual(EDGE_CAVITY);
      expect(bead.height, `${id}: the lip's bead reads ${(bead.height * 1000).toFixed(1)} mm`).toBeGreaterThanOrEqual(BEAD_HEIGHT_M);
    });
  }

  for (const id of CAR_STYLE_IDS.filter((s) => CAR_STYLES[s].arch.lip?.cladding !== undefined)) {
    it(`when the ${id}'s detail map is read at its lip's toe, then its arch cladding darkens the paint there`, () => {
      const toe = readLipTop(id, (width, inset) => width - inset);
      expect(toe.cavity, `${id}: the lip's toe reads cavity ${toe.cavity.toFixed(2)}`).toBeGreaterThanOrEqual(CLADDING_CAVITY);
    });
  }
});
