import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { CAGE_DOOR_THICKNESS, doorSkinZ, makeDoorGeometry, mirrorSeatX } from "./car-door-mesh.ts";
import { drawnSideX } from "./car-mesh.ts";
import { detailReader } from "./car-detail-map.test-util.ts";
import { DeformableCar } from "./car.ts";
import { paint } from "./test-support.ts";

/** A door's skin lies within this far (m) of the body side across its flat panel: flush, the shut line a groove only. */
const FLUSH_M = 0.002;
/** The skin's rows are straight chords over the side's curve: a stand-off reads this far (m) off its table value. */
const READ_TOL_M = 0.0002;
/** The sim's door face (the cage's slab) stands this far (m) over the body side where its style sets no `door.proud`: the drawn stand never moves it. */
const CAGE_STAND_M = 0.003;
/** The panel is read this far (m) in from each cut end: there the skin's top rows come down onto the fender and the quarter (`DOOR_FRONT_SLOPE`, 0.13) and the hinge's closing runs, by design off the side's line. */
const END_M = 0.14;
/** The panel is read this far (m) in from the skin's top and bottom: the shoulder row, the edge roll and the lowest row's lift (`door.lowProud`) are the groove's walls, not the face. */
const SHOULDER_M = 0.08;
/** A shut line reads at least this deep (m) and this dark within `GROOVE_REACH_M` of each end of the cut (the monster's traced seam stands 5 cm off its cut). */
const GROOVE_DEPTH_M = 0.002;
const GROOVE_CAVITY = 0.5;
const GROOVE_REACH_M = 0.06;

/** How far (m) the door face's vertices inside the cut stand over (+) and under (-) the body side's own line, and how many were read. */
function faceStand(style: BodyStyle, cageThickness?: number): { high: number; low: number; read: number } {
  const d = style.door;
  const [z0, z1] = d.aperture;
  const pos = makeDoorGeometry(1, style, cageThickness).getAttribute("position") as THREE.BufferAttribute;
  const dz = d.hingeZ + doorSkinZ(style);
  let high = -Infinity;
  let low = Infinity;
  let read = 0;
  for (let i = 0; i < pos.count; i++) {
    const [y, z, x] = [d.hingeY + pos.getY(i), dz + pos.getZ(i), d.hingeX + pos.getX(i)];
    if (z < z0 + END_M || z > z1 - END_M || Math.abs(y - d.hingeY) > d.halfHeight - SHOULDER_M) continue;
    // The slab's inner vertices share the face's y and z, inboard: only the outer face is the skin.
    if (x < drawnSideX(z, y, style) - 4 * FLUSH_M) continue;
    const stand = x - drawnSideX(z, y, style);
    high = Math.max(high, stand);
    low = Math.min(low, stand);
    read++;
  }
  return { high, low, read };
}

describe("given each style's front door skin at rest", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s door face is read against the body side across its flat panel, then it stands within ${FLUSH_M * 1000} mm of it either way`, () => {
      const { high, low, read } = faceStand(CAR_STYLES[id]);
      expect(read, `${id}: the panel's face vertices read`).toBeGreaterThan(4);
      expect(high, `${id}: the skin stands ${(high * 1000).toFixed(2)} mm proud of the body side`).toBeLessThanOrEqual(FLUSH_M + READ_TOL_M);
      expect(low, `${id}: the skin stands ${(-low * 1000).toFixed(2)} mm under the body side`).toBeGreaterThanOrEqual(-FLUSH_M - READ_TOL_M);
    });

    it(`when the ${id}'s sim door slab is read, then its face stands where it did: ${CAGE_STAND_M * 1000} mm over the side unless the style sets its own`, () => {
      const style = CAR_STYLES[id];
      const { high } = faceStand(style, CAGE_DOOR_THICKNESS);
      // A style that sets its own proud has one face for both builds.
      const want = style.door.proud === undefined ? CAGE_STAND_M : faceStand(style).high;
      expect(Math.abs(high - want), `${id}: the slab's face stands ${(high * 1000).toFixed(2)} mm proud, want ${(want * 1000).toFixed(2)}`).toBeLessThanOrEqual(READ_TOL_M);
    });

    it(`when the ${id}'s detail map is read across both ends of its door cut, then each shut line is a groove: dark, and below the paint either side of it`, () => {
      const style = CAR_STYLES[id];
      const d = style.door;
      const read = detailReader(style);
      for (const z of d.aperture) {
        for (const share of [-0.4, 0, 0.4]) {
          const y = d.hingeY + share * d.halfHeight;
          let deepest = 0;
          let darkest = 0;
          for (let dz = -GROOVE_REACH_M; dz <= GROOVE_REACH_M + 1e-9; dz += 0.002) {
            const texel = read("side", z + dz, y);
            deepest = Math.min(deepest, texel.height);
            darkest = Math.max(darkest, texel.cavity);
          }
          expect(deepest, `${id}: the shut line at z ${z}, y ${y.toFixed(2)} reads ${(deepest * 1000).toFixed(1)} mm`).toBeLessThanOrEqual(-GROOVE_DEPTH_M);
          expect(darkest, `${id}: the shut line at z ${z}, y ${y.toFixed(2)} reads cavity ${darkest.toFixed(2)}`).toBeGreaterThanOrEqual(GROOVE_CAVITY);
        }
      }
    });
  }
});

describe("given each style's car built", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s mirror base and its mirror's seat are read, then they are where the sim's 3 mm slab put them: the drawn stand moves neither`, () => {
      const style = CAR_STYLES[id];
      const slabStand: BodyStyle = { ...style, door: { ...style.door, proud: style.door.proud ?? CAGE_STAND_M } };
      const want = mirrorSeatX(slabStand);
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      expect(Math.abs(car.mirrorBaseX - (style.door.hingeX + want)), `${id}: mirrorBaseX ${car.mirrorBaseX} off the slab's ${style.door.hingeX + want}`).toBeLessThan(1e-9);
      const seat = car["parts"].find((p) => p.name === "mirrorR")!.object.position.x;
      expect(Math.abs(seat - want), `${id}: the mirror's seat x ${seat} off the slab's ${want}`).toBeLessThan(1e-9);
      expect(mirrorSeatX(style, true), `${id}: the cage seat`).toBe(mirrorSeatX(slabStand, true));
    });
  }
});
