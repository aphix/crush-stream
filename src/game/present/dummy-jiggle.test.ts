import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { JEANS, type DriverLook } from "./driver-look.ts";
import { BODY_VERTICES } from "./dummy-bodies.ts";
import { BUST_ATTRIBUTE } from "./dummy-jiggle.ts";
import { PARTS } from "./ragdoll-body.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";

const WOMAN: DriverLook = { woman: true, shirt: 0x7b4fa6, pants: JEANS, hair: 0xb5532a, hat: null, mustache: false };
const MAN: DriverLook = { ...WOMAN, woman: false };
const FRAME = 1 / FRAME_HZ;
/** The jolt: every part dropped this far (m) in one frame, the torso's knock in a fall. */
const DROP = 0.1;
/** Her bust trails a jolt by at least this much (m) a frame later; a rigid vertex moves with its bone to within float noise. */
const TRAILS = 0.01;
const RIGID = 1e-6;
/** A bounce overshoots the rest point by at least this much (m), and has settled within this long (s). */
const OVERSHOOT = 0.003;
const SETTLED_BY = 5;
/** Her back: a torso vertex this high (m) with no share of either orb, the rear-most. */
const BACK_FROM = 1.1;
const BACK_TO = 1.3;

/** Every part of slot 0 standing, turned by `turn` about the torso's centre, then dropped `drop` m. */
function stand(mesh: DummyMesh, turn: THREE.Quaternion, drop: number): void {
  const torso = new THREE.Vector3(...PARTS[0]!.c);
  for (const [k, part] of PARTS.entries()) {
    const at = new THREE.Vector3(...part.c).sub(torso).applyQuaternion(turn).add(torso);
    mesh.pose(0, k, at.setY(at.y - drop), turn);
  }
}

/** Vertices by their share of the left orb's lag: her breast's front (`tip`, her body's own), and her back (none). */
function landmarks(mesh: DummyMesh): { tip: number; back: number } {
  const bust = mesh.geometry.getAttribute(BUST_ATTRIBUTE);
  const shape = mesh.geometry.getAttribute("shapeWoman");
  let [tip, back] = [0, -1];
  for (let i = 0; i < BODY_VERTICES; i++) {
    if (bust.getX(i) > bust.getX(tip)) tip = i;
    const isBack = bust.getX(i) === 0 && bust.getY(i) === 0 && shape.getY(i) > BACK_FROM && shape.getY(i) < BACK_TO;
    if (isBack && (back < 0 || shape.getZ(i) < shape.getZ(back))) back = i;
  }
  return { tip, back };
}

/** Slot 0 dressed as `look`, at rest under `turn`, then jolted down `DROP`: vertex `i`'s offset (m, world) from where its bones alone put it, a frame at a time for `seconds`. */
function jolted(look: DriverLook, turn: THREE.Quaternion, i: number, seconds: number): THREE.Vector3[] {
  const mesh = new DummyMesh(1);
  mesh.dress(0, false, look);
  stand(mesh, turn, 0);
  mesh.jiggle(FRAME);
  const rigid = new THREE.Vector3();
  assert.ok(mesh.posed(0, i, rigid), `vertex ${i} is drawn`);
  rigid.y -= DROP;
  stand(mesh, turn, DROP);
  return Array.from({ length: Math.round(seconds / FRAME) }, () => {
    mesh.jiggle(FRAME);
    const at = new THREE.Vector3();
    mesh.posed(0, i, at);
    return at.sub(rigid);
  });
}

describe("given a woman's bust riding her torso as two cosmetic particles", () => {
  const { tip, back } = landmarks(new DummyMesh(1));
  const upright = new THREE.Quaternion();

  it("when her torso drops in one frame, then her bust trails it, bounces past its rest and settles back onto it, while her back rides the torso rigidly", () => {
    const offsets = jolted(WOMAN, upright, tip, SETTLED_BY);
    assert.ok(offsets[0]!.y > TRAILS, `her bust trails the drop by ${offsets[0]!.y.toFixed(4)} m a frame later`);
    const lowest = Math.min(...offsets.map((o) => o.y));
    assert.ok(lowest < -OVERSHOOT, `it bounces ${(-lowest).toFixed(4)} m past its rest`);
    assert.ok(offsets.at(-1)!.length() < RIGID, `${SETTLED_BY} s later it is ${offsets.at(-1)!.length().toExponential(1)} m off its rest`);
    const backs = jolted(WOMAN, upright, back, FRAME * 3);
    assert.ok(Math.max(...backs.map((o) => o.length())) < RIGID, "her back rides the torso");
  });

  it("when she lies on her back and drops, then her bust trails upward in the world: the lag is in the torso's own frame, turned with it", () => {
    const onHerBack = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const offsets = jolted(WOMAN, onHerBack, tip, FRAME);
    assert.ok(offsets[0]!.y > TRAILS, `her bust trails the drop by ${offsets[0]!.y.toFixed(4)} m upward`);
  });

  it("when a man's torso drops the same way, then the vertex that is her breast rides his torso rigidly: only a woman's bust bounces", () => {
    const offsets = jolted(MAN, upright, tip, FRAME * 10);
    assert.ok(Math.max(...offsets.map((o) => o.length())) < RIGID, "his chest rides the torso");
  });
});
