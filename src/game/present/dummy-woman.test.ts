import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { OUTFIT, type DriverLook } from "./driver-look.ts";
import { BUST, restFits } from "./dummy-fit.ts";
import { EYES_AT, HAIRLINE_FRONT, headAt, measureHead } from "./dummy-head.ts";
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
/** The top's bust stands at least this far (m) in front of her sternum: the reference's fitted top, not the bare mannequin's 3 cm. */
const BUST_PROJECTION = 0.05;
/** A dome's side rim lies under the skin or at most this far (m) out of it: it rises out of the chest, no ledge. */
const RIM_OFF_SKIN = 0.005;
/** Her face, kept clear of hair: within this half width (m) and `FACE_CLEAR` inside the head's, from this share of the head's height over the chin up to the hairline, no hair stands closer than `FACE_CLEAR` m behind the face's surface. */
const FACE_OPEN = 0.05;
const FACE_FROM = 0.1;
const FACE_CLEAR = 0.01;
/** Her hair frames her face: at eye height (within `EYE_BAND` m) it reaches past this |x| (m) on each side, and it ends above `HAIR_ENDS` m (her shoulders). */
const EYE_BAND = 0.012;
const FRAME_X = 0.1;
const HAIR_ENDS = 1.4;
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
      assert.ok(lowest(heel) >= HEEL_LIFT, `her heel's underside is ${lowest(heel).toFixed(3)} m off the floor`);
      assert.ok(lowest(foot) <= TOES_DOWN, `her toes are ${lowest(foot).toFixed(3)} m off the floor`);
      const stiletto = ofWear(standing, ROLE.SHOE, BUILD.WOMAN).filter((row) => Math.sign(row.at.x) === side.sign);
      assert.ok(stiletto.length > 0, "she wears a stiletto");
      assert.ok(lowest(stiletto) <= TIP_DOWN, `the stiletto's tip is ${lowest(stiletto).toFixed(3)} m off the floor`);
    });
  }

  it(`when she bends her knees ${KNEE_BEND} degrees, then each stiletto keeps its distance to her ankle (it goes where her shin goes)`, () => {
    const bent = drawnRows(false, WOMAN, posture({ [LEFT_LEG + 1]: turn(X, KNEE_BEND), [RIGHT_LEG + 1]: turn(X, KNEE_BEND) })).rows;
    const [from, to] = [byIndex(standing), byIndex(bent)];
    for (const side of SIDES) {
      const ankle = lowestRigid(standing, side.shin, FOOT_TOP);
      const stiletto = ofWear(standing, ROLE.SHOE, BUILD.WOMAN).filter((row) => Math.sign(row.at.x) === side.sign);
      assert.ok(stiletto.length > 0 && to.get(ankle.index)!.at.distanceTo(ankle.at) > HEEL_LIFT, `the ${side.name} ankle moved with the bend`);
      assert.ok(drift(stiletto, ankle.index, from, to) < RIGID, `the ${side.name} stiletto drifts ${drift(stiletto, ankle.index, from, to).toFixed(4)} m from her ankle`);
    }
  });

  it(`when she raises her right arm ${ARM_RAISE} degrees, then her sleeve keeps its distance to her upper arm (it goes where the arm goes)`, () => {
    const raised = drawnRows(false, WOMAN, posture({ [LEFT_ARM]: turn(Z, -ARM_RAISE) })).rows;
    const [from, to] = [byIndex(standing), byIndex(raised)];
    const elbow = lowestRigid(standing, LEFT_ARM, 0);
    const sleeve = ofWear(standing, ROLE.SHIRT, BUILD.WOMAN | SHORT_SLEEVES).filter((row) => row.at.x < 0);
    assert.ok(sleeve.length > 0 && to.get(elbow.index)!.at.distanceTo(elbow.at) > FRAME_X, "she wears a sleeve and her arm moved");
    assert.ok(drift(sleeve, elbow.index, from, to) < RIGID, `her sleeve drifts ${drift(sleeve, elbow.index, from, to).toFixed(4)} m from her arm`);
  });

  it("when she and a man in the same clothes stand, then her bust stands in front of her chest as the top's, and the man draws none of it", () => {
    const bust = (rows: readonly Drawn[]) => ofWear(rows, ROLE.SHIRT, BUILD.WOMAN);
    const front = Math.max(...bust(standing).map((row) => row.at.z));
    assert.ok(bust(standing).length > 0, "her bust is drawn");
    assert.ok(front - BUST.wall >= BUST_PROJECTION, `her bust stands ${(front - BUST.wall).toFixed(3)} m in front of her sternum`);
    assert.equal(bust(drawnRows(false, { ...WOMAN, woman: false }).rows).length, 0, "no bust on a man");
  });

  it("when she stands, then each ring of her bust's domes has its side rims at or under the skin of her chest", () => {
    const bust = ofWear(standing, ROLE.SHIRT, BUILD.WOMAN).sort((a, b) => a.index - b.index);
    const rings: Drawn[][] = [];
    for (const row of bust) {
      const ring = rings.at(-1);
      if (ring !== undefined && ring[0]!.index + ring.length === row.index && ring[0]!.at.y === row.at.y) ring.push(row);
      else rings.push([row]);
    }
    const lofted = rings.filter((ring) => ring.length > 2);
    assert.ok(lofted.length > 0, "the domes' rings were found");
    let [worst, where] = [-Infinity, ""];
    for (const ring of lofted) {
      for (const rim of [ring.reduce((a, b) => (b.at.x < a.at.x ? b : a)), ring.reduce((a, b) => (b.at.x > a.at.x ? b : a))]) {
        const off = rim.at.z - surfaceZ(fit, rim.at.x, rim.at.y);
        if (off > worst) [worst, where] = [off, `(${rim.at.x.toFixed(3)}, ${rim.at.y.toFixed(3)})`];
      }
    }
    assert.ok(worst <= RIM_OFF_SKIN, `a rim stands ${worst.toFixed(4)} m out of her chest at ${where}`);
  });

  it("when she stands, then her hair stays off her face, from under her chin's line to her hairline", () => {
    const head = measureHead(fit);
    const height = head.top - head.chin;
    const band = ofWear(standing, ROLE.LOCKS, BUILD.WOMAN).filter((row) => row.at.y > head.chin + FACE_FROM * height && row.at.y < head.chin + HAIRLINE_FRONT * height && Math.abs(row.at.x) < Math.min(FACE_OPEN, headAt(head, row.at.y)[0] - FACE_CLEAR));
    assert.ok(band.length > 0, "her hair crosses that band (behind her head)");
    const over = band.filter((row) => row.at.z > surfaceZ(fit, row.at.x, row.at.y) - FACE_CLEAR);
    assert.equal(over.length, 0, `${over.length} hair vertices over her face`);
  });

  it("when she stands, then her hair frames her face past her cheeks on both sides at eye height and ends on her shoulders", () => {
    const head = measureHead(fit);
    const eyes = head.chin + EYES_AT * (head.top - head.chin);
    const hair = ofWear(standing, ROLE.LOCKS, BUILD.WOMAN);
    const atEyes = hair.filter((row) => Math.abs(row.at.y - eyes) < EYE_BAND);
    assert.ok(Math.max(...atEyes.map((row) => row.at.x)) >= FRAME_X, `it reaches x = ${Math.max(...atEyes.map((row) => row.at.x)).toFixed(3)} m on her left`);
    assert.ok(Math.min(...atEyes.map((row) => row.at.x)) <= -FRAME_X, `it reaches x = ${Math.min(...atEyes.map((row) => row.at.x)).toFixed(3)} m on her right`);
    assert.ok(lowest(hair) >= HAIR_ENDS, `it hangs to ${lowest(hair).toFixed(3)} m`);
  });
});
