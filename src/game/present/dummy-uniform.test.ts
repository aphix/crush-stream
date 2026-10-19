import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { driverLook, type DriverLook } from "./driver-look.ts";
import { BODY_VERTICES } from "./dummy-bodies.ts";
import { COP_LOOK, ELDER_LOOK, GUARD_LOOK, VIP_LOOK } from "./dummy-dress.ts";
import { restFits } from "./dummy-fit.ts";
import { BELT_BOTTOM, hangingFit, SUIT_HANG } from "./dummy-garments.ts";
import { surfaceZ } from "./dummy-loft.ts";
import { drawnRows as drawn, posture, turn, type Drawn } from "./dummy-pose.test-util.ts";
import { LEFT_ARM, LEFT_LEG, RIGHT_LEG, ROLE, type Fit } from "./dummy-rig.ts";

/** A holster's vertices hang this far (m) under the belt's bottom; the belt and its pouches end above it. */
const UNDER_BELT = 0.03;
/** The furthest (m) a tie may stand off the chest it hangs on: its half thickness plus its gap. */
const TIE_OFF_CHEST = 0.03;
/** The furthest (m) a worn piece's vertex may lie from the body under it: the patch's half width on the sleeve, a shoe's toe past the foot's last vertex. */
const ON_BODY = 0.06;
/** A colour this dark (each linear channel) reads as black cloth (the reference aide's charcoal black; the cop's navy is 0.067 in blue), this bright as white. */
const BLACK = 0.05;
const WHITE = 0.8;

const CIVILIAN: DriverLook = { ...driverLook(1, 0), woman: false };

const ofRole = (rows: readonly Drawn[], role: number) => rows.filter((row) => row.wear && row.role === role);
/** How far (m) the worn vertex furthest from the body lies from the nearest body vertex riding `bone`. */
function furthestOff(worn: readonly Drawn[], rows: readonly Drawn[], bone: number): number {
  const body = rows.filter((row) => !row.wear && row.bone === bone);
  return Math.max(...worn.map((piece) => Math.min(...body.map((row) => row.at.distanceTo(piece.at)))));
}

describe("given the uniformed kinds' wear", () => {
  it("when a cop and a civilian man stand, then the cop wears a holster under the belt on his gun hand's side, pouches on the belt's front, a badge on his left breast and a patch on his right sleeve, and the civilian none of them", () => {
    const holster = (rows: readonly Drawn[]) => ofRole(rows, ROLE.BELT).filter((row) => row.at.y < BELT_BOTTOM - UNDER_BELT);
    const cop = drawn(true, COP_LOOK).rows;
    const civilian = drawn(false, CIVILIAN).rows;
    assert.ok(holster(cop).length > 0, "the cop has a holster");
    assert.ok(holster(cop).every((row) => row.at.x < 0), "on his right (-x), the gun hand's side");
    assert.ok(ofRole(cop, ROLE.BELT).some((row) => row.at.x > 0 && row.at.y > BELT_BOTTOM - UNDER_BELT), "pouches on the belt's left");
    assert.ok(ofRole(cop, ROLE.BADGE).length > 0 && ofRole(cop, ROLE.BADGE).every((row) => row.at.x > 0 && row.at.y > 1.15), "a badge on his left breast");
    assert.ok(ofRole(cop, ROLE.PATCH).length > 0 && ofRole(cop, ROLE.PATCH).every((row) => row.at.x < -0.2), "a patch on his right sleeve");
    assert.equal(holster(civilian).length, 0, "no holster on a civilian");
    assert.equal(ofRole(civilian, ROLE.BADGE).length + ofRole(civilian, ROLE.PATCH).length, 0, "no badge or patch on a civilian");
  });

  it("when the cop raises his right arm and bends both knees, then the patch stays on his sleeve and each dress shoe on its own foot", () => {
    const raised = drawn(true, COP_LOOK, posture({ [LEFT_ARM]: turn(new THREE.Vector3(0, 0, 1), -80), [LEFT_LEG + 1]: turn(new THREE.Vector3(1, 0, 0), 70), [RIGHT_LEG + 1]: turn(new THREE.Vector3(1, 0, 0), 70) })).rows;
    assert.ok(furthestOff(ofRole(raised, ROLE.PATCH), raised, LEFT_ARM) < ON_BODY, `the patch is ${furthestOff(ofRole(raised, ROLE.PATCH), raised, LEFT_ARM).toFixed(3)} m off the raised arm`);
    for (const shin of [LEFT_LEG + 1, RIGHT_LEG + 1]) {
      const shoe = [...ofRole(raised, ROLE.SHOE), ...ofRole(raised, ROLE.SOLE)].filter((row) => row.bone === shin);
      assert.ok(shoe.length > 0, `a shoe rides shin ${shin}`);
      assert.ok(furthestOff(shoe, raised, shin) < ON_BODY, `the shoe on shin ${shin} is ${furthestOff(shoe, raised, shin).toFixed(3)} m off its foot`);
    }
  });

  it("when the guard and the cop stand, then the guard draws the cop's body and kit at the same places, in black, without the police patch and with sunglasses", () => {
    const cop = drawn(true, COP_LOOK);
    const guard = drawn(false, GUARD_LOOK);
    const key = (row: Drawn) => `${row.role}:${row.at.x.toFixed(5)},${row.at.y.toFixed(5)},${row.at.z.toFixed(5)}`;
    const [copKeys, guardKeys] = [new Set(cop.rows.map(key)), new Set(guard.rows.map(key))];
    const copOnly = cop.rows.filter((row) => !guardKeys.has(key(row)));
    const guardOnly = guard.rows.filter((row) => !copKeys.has(key(row)));
    assert.ok(guard.rows.length - guardOnly.length > BODY_VERTICES, "the guard shares the cop's body and kit");
    assert.ok(copOnly.length > 0 && copOnly.every((row) => row.role === ROLE.PATCH), "all the cop has that the guard lacks is the police patch");
    assert.ok(guardOnly.length > 0 && guardOnly.every((row) => row.role === ROLE.EYES), "all the guard adds is his sunglasses");
    const shirt = guard.mesh.colourOf(0, ROLE.SHIRT, new THREE.Color());
    assert.ok(Math.max(shirt.r, shirt.g, shirt.b) < BLACK, `the guard's shirt is black, not the cop's navy: #${shirt.getHexString()}`);
  });

  for (const suit of [
    { name: "president", look: VIP_LOOK, build: "portly" },
    { name: "older man", look: ELDER_LOOK, build: "man" },
  ] as const) {
    it(`when the ${suit.name} stands in his suit, then a white collar and a tie rest on his chest as his jacket hangs, and dress shoes cover his feet`, () => {
      const { mesh, rows } = drawn(false, suit.look);
      const fit: Fit = hangingFit(restFits()[suit.build], SUIT_HANG);
      const tie = ofRole(rows, ROLE.TIE);
      assert.ok(tie.length > 0, "a tie");
      const worst = Math.max(...tie.map((row) => Math.abs(row.at.z - surfaceZ(fit, 0, row.at.y))));
      assert.ok(worst < TIE_OFF_CHEST, `the tie stands up to ${worst.toFixed(3)} m off his chest`);
      assert.ok(ofRole(rows, ROLE.COLLAR).length > 0, "a collar");
      const collar = mesh.colourOf(0, ROLE.COLLAR, new THREE.Color());
      assert.ok(Math.min(collar.r, collar.g, collar.b) > WHITE, `a white collar: #${collar.getHexString()}`);
      assert.ok(ofRole(rows, ROLE.SOLE).length > 0 && ofRole(rows, ROLE.SHOE).length > 0, "dress shoes");
    });
  }
});
