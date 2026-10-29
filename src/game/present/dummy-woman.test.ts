import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OUTFIT, type DriverLook } from "./driver-look.ts";
import { BUST, restFits } from "./dummy-fit.ts";
import { surfaceZ } from "./dummy-loft.ts";
import { drawnRows, posture, turn, type Drawn } from "./dummy-pose.test-util.ts";
import { BUILD, LEFT_ARM, LEFT_LEG, RIGHT_LEG, ROLE, SHORT_SLEEVES } from "./dummy-rig.ts";

/** Her foot: what of her body lies under this height (m); its heel the back `HEEL_LENGTH` m of it. */
const FOOT_TOP = 0.12;
const HEEL_LENGTH = 0.03;
/** A high heel holds her heel at least this far (m) off the floor; her toes and a stiletto's tip are within these of it. */
const HEEL_LIFT = 0.04;
const TOES_DOWN = 0.01;
const TIP_DOWN = 0.005;
/** Her bust stands at least this far (m) in front of her sternum: the second reference's full fitted top, not the bare mannequin's 3 cm. */
const BUST_PROJECTION = 0.075;
/** Under the top's scoop the fabric spans her cleavage: at the domes' centre height her middle stands within this (m) of their front. */
const BRIDGED = 0.01;
/** Her raised elbow moves at least this far (m): the raise really happened. */
const ARM_MOVED = 0.1;
/** A rigid ride keeps distances within float noise (m). */
const RIGID = 1e-4;
/** Her knees bent and her right arm raised this far (degrees) for the rides. */
const KNEE_BEND = 60;
const ARM_RAISE = 90;

const WOMAN: DriverLook = { woman: true, shirt: 0x7b4fa6, pants: 0x7f9fc6, hair: 0xb5532a, hat: null, mustache: false, outfit: OUTFIT.TOP };
const SIDES = [
  { name: "right", sign: -1, shin: LEFT_LEG + 1 },
  { name: "left", sign: 1, shin: RIGHT_LEG + 1 },
] as const;
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

const lowest = (rows: readonly Drawn[]) => Math.min(...rows.map((row) => row.at.y));
const ofWear = (rows: readonly Drawn[], role: number, kinds: number) => rows.filter((row) => row.wear && row.role === role && row.kinds === kinds);
/** How far (m) the vertices `riders` drift from body vertex `anchor` between `from` and `to` (both indexed by vertex): 0 for a rigid ride. */
function drift(riders: readonly Drawn[], anchor: number, from: ReadonlyMap<number, Drawn>, to: ReadonlyMap<number, Drawn>): number {
  return Math.max(...riders.map((row) => Math.abs(to.get(row.index)!.at.distanceTo(to.get(anchor)!.at) - from.get(row.index)!.at.distanceTo(from.get(anchor)!.at))));
}
/** The lowest body vertex rigid on `bone` above `above` m: the one a bend about the joint over it moves furthest. */
function lowestRigid(rows: readonly Drawn[], bone: number, above: number): Drawn {
  return rows.filter((row) => !row.wear && row.bone === bone && row.weight === 0 && row.at.y > above).reduce((low, row) => (row.at.y < low.at.y ? row : low));
}

describe("given the woman in her top, cut-offs and heels", () => {
  const fit = restFits().woman;
  const standing = drawnRows(false, WOMAN).rows;
  const byIndex = (rows: readonly Drawn[]) => new Map(rows.map((row) => [row.index, row]));

  for (const side of SIDES) {
    it(`when she stands, then her ${side.name} heel is held off the floor on a stiletto while her toes touch it`, () => {
      const foot = standing.filter((row) => !row.wear && row.at.y < FOOT_TOP && Math.sign(row.at.x) === side.sign);
      const back = Math.min(...foot.map((row) => row.at.z));
      const heel = foot.filter((row) => row.at.z < back + HEEL_LENGTH);
      expect(lowest(heel), `her heel's underside is ${lowest(heel).toFixed(3)} m off the floor`).toBeGreaterThanOrEqual(HEEL_LIFT);
      expect(lowest(foot), `her toes are ${lowest(foot).toFixed(3)} m off the floor`).toBeLessThanOrEqual(TOES_DOWN);
      const stiletto = ofWear(standing, ROLE.SHOE, BUILD.WOMAN).filter((row) => Math.sign(row.at.x) === side.sign);
      expect(stiletto.length, "she wears a stiletto").toBeGreaterThan(0);
      expect(lowest(stiletto), `the stiletto's tip is ${lowest(stiletto).toFixed(3)} m off the floor`).toBeLessThanOrEqual(TIP_DOWN);
    });
  }

  it(`when she bends her knees ${KNEE_BEND} degrees, then each stiletto keeps its distance to her ankle (it goes where her shin goes)`, () => {
    const bent = drawnRows(false, WOMAN, posture({ [LEFT_LEG + 1]: turn(X, KNEE_BEND), [RIGHT_LEG + 1]: turn(X, KNEE_BEND) })).rows;
    const [from, to] = [byIndex(standing), byIndex(bent)];
    for (const side of SIDES) {
      const ankle = lowestRigid(standing, side.shin, FOOT_TOP);
      const stiletto = ofWear(standing, ROLE.SHOE, BUILD.WOMAN).filter((row) => Math.sign(row.at.x) === side.sign);
      expect(stiletto.length > 0 && to.get(ankle.index)!.at.distanceTo(ankle.at) > HEEL_LIFT, `the ${side.name} ankle moved with the bend`).toBeTruthy();
      expect(drift(stiletto, ankle.index, from, to), `the ${side.name} stiletto drifts ${drift(stiletto, ankle.index, from, to).toFixed(4)} m from her ankle`).toBeLessThan(RIGID);
    }
  });

  it(`when she raises her right arm ${ARM_RAISE} degrees, then her sleeve keeps its distance to her upper arm (it goes where the arm goes)`, () => {
    const raised = drawnRows(false, WOMAN, posture({ [LEFT_ARM]: turn(Z, -ARM_RAISE) })).rows;
    const [from, to] = [byIndex(standing), byIndex(raised)];
    const elbow = lowestRigid(standing, LEFT_ARM, 0);
    const sleeve = ofWear(standing, ROLE.SHIRT, BUILD.WOMAN | SHORT_SLEEVES).filter((row) => row.at.x < 0);
    expect(sleeve.length > 0 && to.get(elbow.index)!.at.distanceTo(elbow.at) > ARM_MOVED, "she wears a sleeve and her arm moved").toBeTruthy();
    expect(drift(sleeve, elbow.index, from, to), `her sleeve drifts ${drift(sleeve, elbow.index, from, to).toFixed(4)} m from her arm`).toBeLessThan(RIGID);
  });

  it("when she and a man in the same clothes stand, then her bust is her body's own chest standing in front of her sternum, with no shell over it, and the man's chest stays flat", () => {
    const chest = (rows: readonly Drawn[]) => rows.filter((row) => !row.wear && Math.abs(row.at.y - BUST.y) < BUST.r && Math.abs(row.at.x) < BUST.x + BUST.r);
    const front = Math.max(...chest(standing).map((row) => row.at.z));
    expect(front - BUST.wall, `her bust stands ${(front - BUST.wall).toFixed(3)} m in front of her sternum`).toBeGreaterThanOrEqual(BUST_PROJECTION);
    expect(ofWear(standing, ROLE.SHIRT, BUILD.WOMAN).length, "no dome shell lies over her chest (its rim would show)").toBe(0);
    const man = Math.max(...chest(drawnRows(false, { ...WOMAN, woman: false }).rows).map((row) => row.at.z));
    expect(man - BUST.wall, `his chest stands ${(man - BUST.wall).toFixed(3)} m in front of her sternum's line`).toBeLessThan(BUST_PROJECTION / 2);
  });

  it("when she stands, then under her top's scoop the fabric spans her cleavage at her bust's own height", () => {
    const [middle, dome] = [surfaceZ(fit, 0, BUST.y), surfaceZ(fit, BUST.x, BUST.y)];
    expect(dome - middle, `her middle lies ${(dome - middle).toFixed(3)} m behind her bust's front`).toBeLessThanOrEqual(BRIDGED);
  });
});
