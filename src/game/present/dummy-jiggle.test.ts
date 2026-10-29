import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FRAME_HZ } from "../kernel/constants.ts";
import { JEANS, type DriverLook } from "./driver-look.ts";
import { BODY_VERTICES } from "./dummy-bodies.ts";
import { BUST } from "./dummy-fit.ts";
import { KINDS_ATTRIBUTE, ORBS_AT } from "./dummy-rig.ts";
import { PARTS } from "./ragdoll-body.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { presentedRate } from "./dummy-jiggle.ts";

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
/** A jolt (m) small enough that the bounce stays inside its reach, so gravity's asymmetry shows rather than the clamp's symmetry. */
const NUDGE = 0.02;
/** The third peak's share of the first, the dome's mid-ring share of its apex's motion, and the orbs' closing slack (m). */
const SETTLE_SHARE = 0.1;
const MASS_SHARE = 0.7;
const SEPARATION_SLACK = 0.004;
/** Direction reversals tolerated in a smooth 4 s of slow-mo, the throw's spin (rad/s), the reach (m) now in force and the share of it a spinning bust may stray (it rides the rig). */
const SMOOTH_FLIPS = 20;
const SPIN = 16;
const REACH_NOW = 0.039 * 1.28;
const SPIN_REACH = 0.1;
const SPIN_MOST = 0.02;
const SPIN_LEAST = 0.005;
/** How many times the evenly stepped speed a slow-mo bust may peak at. */
const SPEED_SPIKE = 2;
/** How closely a spinning bust's offset agrees between 60 and 144 Hz stepping (a share of it): the poses are sampled, so the orb sees chords of the turn, not its arc. */
const RATE_AGREES = 0.2;

/** Her left orb's widest offset (m) and direction reversals through a second of `SPIN` about `axis`, stepped at `hz`, and the speed (m/s) its anchor travels. */
function spinning(axis: THREE.Vector3, hz: number): { widest: number; flips: number; speed: number } {
  const mesh = new DummyMesh(1);
  mesh.dress(0, false, WOMAN);
  const rows = mesh["rows"] as Float32Array;
  let [widest, flips] = [0, 0];
  const last = [0, 0, 0];
  for (let n = 0; n < hz; n++) {
    stand(mesh, new THREE.Quaternion().setFromAxisAngle(axis, (SPIN * n) / hz), 0);
    mesh.jiggle(1 / hz);
    if (n < SPIN_UP_S * hz) continue;
    const lag = new THREE.Vector3(rows[ORBS_AT * 4], rows[ORBS_AT * 4 + 1], rows[ORBS_AT * 4 + 2]);
    widest = Math.max(widest, lag.length());
    for (let c = 0; c < 3; c++) {
      const v = lag.getComponent(c);
      if (Math.abs(v) > 1e-4) {
        if (last[c]! * v < 0) flips++;
        last[c] = v;
      }
    }
  }
  const radius = new THREE.Vector3(-BUST.x, BUST.y, (BUST.wall + BUST.tip) / 2).sub(new THREE.Vector3(...PARTS[0]!.c));
  return { widest, flips, speed: SPIN * radius.length() };
}
const SIM_EVERY = 4;

/** The peak speed (m/s) of her left orb through a 0.5 Hz bob whose sim advances one whole frame every `SIM_EVERY` frames, jiggled at `rateOf(frame)` of wall time. */
function slowmoPeakSpeed(rateOf: (frame: number) => number, every = SIM_EVERY): number {
  const mesh = new DummyMesh(1);
  mesh.dress(0, false, WOMAN);
  const rows = mesh["rows"] as Float32Array;
  let [simTime, last, peak] = [0, NaN, 0];
  for (let n = 0; n < 5 * FRAME_HZ; n++) {
    if (n % every === 0) simTime += FRAME * every * SLOWMO;
    const bob = 0.02 * Math.sin(2 * Math.PI * 0.5 * simTime);
    stand(mesh, new THREE.Quaternion(), bob);
    mesh.timeScale = rateOf(n);
    mesh.jiggle(FRAME);
    const orb = rows[ORBS_AT * 4 + 1]! - bob;
    if (n > FRAME_HZ && Number.isFinite(last)) peak = Math.max(peak, Math.abs(orb - last) / FRAME);
    last = orb;
  }
  return peak;
}
/** Seconds a spinning torso takes to be followed (its spin rate is averaged over them). */
const SPIN_UP_S = 0.33;
/** The downward excursion over the upward one for the same jolt: about 2:1, dampened by gravity but still a bounce. */
const ASYMMETRY_MIN = 1.6;
const ASYMMETRY_MAX = 2.4;
/** The peak excursion (m) of the `DROP` jolt before the 1.28x gain and gravity (main's `REACH`-saturated bounce). */
const BASE_PEAK = 0.039;
/** The slow-mo's time scale, and the least an inverted orb hangs below its anchor (m). */
const SLOWMO = 0.25;
const SAGS = 0.02;
/** The bust's old projection (m) before the owner's 1.28x, and how closely the baked shape follows its targets (m). */
const OLD_PROJECTION = 0.078;
const SIZE_TOLERANCE = 0.003;
/** Her breast tip's height (m) standing with the 6 mm sag (the rounder dome's tip vertex), and the footprint's old reach (m). */
const SAGGED_PEAK_Y = 1.2481;
const OLD_FOOTPRINT = 0.13;
/** Her dome's centre height (m): the measured breast peak's, `BUST_SAG` lower. */
const DOME_Y = 1.2439;

/** Slot 0's most forward breast vertex standing at rest, after seconds of jiggle (`live`) or none (a figure that never jiggles). */
function standingTip(live: boolean): THREE.Vector3 {
  const mesh = new DummyMesh(1);
  mesh.dress(0, false, WOMAN);
  stand(mesh, new THREE.Quaternion(), 0);
  if (live) for (let t = 0; t < SETTLED_BY * FRAME_HZ; t++) mesh.jiggle(FRAME);
  const at = new THREE.Vector3();
  mesh.posed(0, landmarks(mesh).tip, at);
  return at;
}
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
  const kinds = mesh.geometry.getAttribute(KINDS_ATTRIBUTE);
  const shape = mesh.geometry.getAttribute("shapeWoman");
  let [tip, back] = [0, -1];
  for (let i = 0; i < BODY_VERTICES; i++) {
    if (kinds.getZ(i) > kinds.getZ(tip)) tip = i;
    const isBack = kinds.getZ(i) === 0 && kinds.getW(i) === 0 && shape.getY(i) > BACK_FROM && shape.getY(i) < BACK_TO;
    if (isBack && (back < 0 || shape.getZ(i) < shape.getZ(back))) back = i;
  }
  return { tip, back };
}

/** Slot 0 dressed as `look`, at rest under `turn`, then jolted down `drop` m (up if negative) at presented-time `rate`: vertex `i`'s offset (m, world) from where its bones alone put it, a frame at a time for `seconds`. */
function jolted(look: DriverLook, turn: THREE.Quaternion, i: number, seconds: number, drop = DROP, rate = 1): THREE.Vector3[] {
  const mesh = new DummyMesh(1);
  mesh.timeScale = rate;
  mesh.dress(0, false, look);
  stand(mesh, turn, 0);
  mesh.jiggle(FRAME);
  const rigid = new THREE.Vector3();
  assert.ok(mesh.posed(0, i, rigid), `vertex ${i} is drawn`);
  rigid.y -= drop;
  stand(mesh, turn, drop);
  return Array.from({ length: Math.round(seconds / FRAME) }, () => {
    mesh.jiggle(FRAME);
    const at = new THREE.Vector3();
    mesh.posed(0, i, at);
    return at.sub(rigid);
  });
}

/** The highest and lowest y offset (m) over `offsets`. */
function extremes(offsets: THREE.Vector3[]): { up: number; down: number } {
  const ys = offsets.map((o) => o.y);
  return { up: Math.max(...ys), down: -Math.min(...ys) };
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

  it("when her torso is jolted up and then an equal amount down, then gravity dampens the upward excursion to about half the downward one, not to nothing", () => {
    const [fall, jump] = [extremes(jolted(WOMAN, upright, tip, SETTLED_BY, NUDGE)), extremes(jolted(WOMAN, upright, tip, SETTLED_BY, -NUDGE))];
    const ratio = fall.down / jump.up;
    assert.ok(ratio > ASYMMETRY_MIN && ratio < ASYMMETRY_MAX, `down ${fall.down.toFixed(4)} m vs up ${jump.up.toFixed(4)} m: ${ratio.toFixed(2)}:1`);
  });

  it("when she stands untouched, then her bust stays exactly where her torso carries it: gravity's sag is already in her shape", () => {
    const offsets = jolted(WOMAN, upright, tip, SETTLED_BY, 0);
    assert.ok(Math.max(...offsets.map((o) => o.length())) < RIGID, "no sag beyond her rest pose");
  });

  it("when her torso takes the jolt, then her bust swings the owner's ~28% farther than before", () => {
    const { up, down } = extremes(jolted(WOMAN, upright, tip, SETTLED_BY));
    const ratio = Math.max(up, down) / BASE_PEAK;
    assert.ok(ratio > 1.25 && ratio < 1.3, `peak ${Math.max(up, down).toFixed(4)} m is ${ratio.toFixed(3)}x the old ${BASE_PEAK} m`);
  });

  it("when the sim runs at a quarter speed, then the same wall time sees the bust swing slower", () => {
    const lowestAt = (rate: number): number => {
      const ys = jolted(WOMAN, upright, tip, SETTLED_BY, NUDGE, rate).map((o) => o.y);
      return ys.indexOf(Math.min(...ys));
    };
    assert.ok(lowestAt(SLOWMO) > 3 * lowestAt(1), `lowest at frame ${lowestAt(SLOWMO)} slowed, ${lowestAt(1)} at full speed`);
  });

  it("when she hangs upside down, then her orbs sag toward the ground, below where her torso carries them", () => {
    const upsideDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    const settled = jolted(WOMAN, upsideDown, tip, SETTLED_BY, 0).at(-1)!;
    assert.ok(settled.y < -SAGS, `her orb hangs ${settled.y.toFixed(4)} m from its anchor`);
  });

  it("when she stands, then her bust stands 1.28^(1/3) x the old 7.8 cm out of her chest, its footprint grown with it so it stays a round dome", () => {
    const out = standingTip(false).z - BUST.wall;
    assert.ok(Math.abs(out - OLD_PROJECTION * 1.28 ** (1 / 3)) < SIZE_TOLERANCE, `her bust stands ${out.toFixed(4)} m out of her chest`);
    assert.ok(Math.abs(BUST.r - OLD_FOOTPRINT * 1.28 ** (1 / 3)) < 1e-9, `its footprint reaches ${BUST.r.toFixed(4)} m`);
  });

  it("when her bust is knocked once, then its first swing back takes at least 350 ms and the third peak is under a tenth of the first: one clear bounce, a small second", () => {
    const ys = jolted(WOMAN, upright, tip, SETTLED_BY, NUDGE).map((o) => o.y);
    const swing = (ys.indexOf(Math.min(...ys)) + 1) * FRAME;
    const peaks = ys.flatMap((y, i) => (i > 0 && i < ys.length - 1 && Math.abs(y) > Math.abs(ys[i - 1]!) && Math.abs(y) >= Math.abs(ys[i + 1]!) ? [Math.abs(y)] : []));
    assert.ok(swing >= 0.35, `its first swing back takes ${(swing * 1000).toFixed(0)} ms`);
    assert.ok((peaks[2] ?? 0) < peaks[0]! * SETTLE_SHARE, `peaks ${peaks.slice(0, 4).map((p) => p.toFixed(4)).join(", ")} m`);
  });

  it("when her torso is jolted, then a vertex on the dome's flank, half way up it, moves most of what its apex does: the dome moves as a mass, not as a tip", () => {
    const kinds = new DummyMesh(1).geometry.getAttribute(KINDS_ATTRIBUTE);
    const shape = new DummyMesh(1).geometry.getAttribute("shapeWoman");
    let ring = 0;
    for (let i = 0; i < BODY_VERTICES; i++) {
      const [left, right] = [Math.hypot(shape.getX(i) + BUST.x, shape.getY(i) - BUST.y), Math.hypot(shape.getX(i) - BUST.x, shape.getY(i) - BUST.y)];
      const [across, share] = left < right ? [left, kinds.getZ(i)] : [right, kinds.getW(i)];
      const height = (shape.getZ(i) - BUST.wall) / (BUST.tip - BUST.wall);
      if (across > 0.3 * BUST.r && across < 0.6 * BUST.r && height > 0.3 && height < 0.6) ring = Math.max(ring, share);
    }
    const apex = Math.max(kinds.getZ(tip), kinds.getW(tip));
    assert.ok(ring >= apex * MASS_SHARE, `the mid ring takes ${ring.toFixed(2)} of the apex's ${apex.toFixed(2)}`);
  });

  it("when her torso is shaken hard from side to side, then her two orbs never come closer than their rest separation less the slack", () => {
    const mesh = new DummyMesh(1);
    mesh.dress(0, false, WOMAN);
    const rows = mesh["rows"] as Float32Array;
    let closest = Infinity;
    for (let n = 0; n < 3 * FRAME_HZ; n++) {
      const swing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5 * Math.sin(n * FRAME * 14));
      for (const [k, part] of PARTS.entries()) mesh.pose(0, k, new THREE.Vector3(...part.c).add(new THREE.Vector3(0.04 * Math.sin(n * FRAME * 20), 0, 0)), swing);
      mesh.jiggle(FRAME);
      closest = Math.min(closest, rows[(ORBS_AT + 1) * 4]! - rows[ORBS_AT * 4]!);
    }
    assert.ok(closest >= -SEPARATION_SLACK - 1e-6, `the orbs' offsets close by ${(-closest).toFixed(4)} m`);
  });

  it("when the sim steps one whole step every fourth frame at a quarter time scale, then the engine's rate keeps her bust's speed near the evenly stepped run's, where the old per-frame ratio (1, 0, 0, 0) quadrupled it", () => {
    const dense = slowmoPeakSpeed(() => SLOWMO, 1);
    const [engine, perFrame] = [slowmoPeakSpeed(() => presentedRate(null, FRAME, SLOWMO, 1)), slowmoPeakSpeed((n) => presentedRate(n % SIM_EVERY === 0 ? FRAME : 0, FRAME, SLOWMO, 1))];
    assert.ok(perFrame > SPEED_SPIKE * dense, `the old ratio peaks at ${perFrame.toFixed(4)} m/s against ${dense.toFixed(4)}`);
    assert.ok(engine <= SPEED_SPIKE * dense, `the engine's rate peaks at ${engine.toFixed(4)} m/s against ${dense.toFixed(4)}`);
  });

  it("when a thrown torso spins at 16 rad/s about its long axis and about its sideways axis, then her bust trails the chest calmly at any frame rate: a small visible offset, no flapping faster than 3 Hz, the same at 60 and 144 Hz", () => {
    for (const axis of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)]) {
      const [slow, fast] = [spinning(axis, 60), spinning(axis, 144)];
      for (const run of [slow, fast]) {
        assert.ok(run.widest < SPIN_MOST && run.widest > SPIN_LEAST, `about (${axis.toArray()}) her bust strays ${run.widest.toFixed(4)} m, wanted between ${SPIN_LEAST} and ${SPIN_MOST} m`);
        assert.ok(run.flips <= 6, `about (${axis.toArray()}) her bust reverses ${run.flips} times in a second`);
      }
      assert.ok(Math.abs(slow.widest - fast.widest) <= RATE_AGREES * slow.widest, `60 Hz strays ${slow.widest.toFixed(4)} m, 144 Hz ${fast.widest.toFixed(4)} m (about ${(1000 * slow.widest / slow.speed).toFixed(1)} and ${(1000 * fast.widest / fast.speed).toFixed(1)} ms behind the chest)`);
    }
  });

  it("when she stands untouched, then a live ragdoll's settled bust matches the instanced figure's, and hangs the gravity sag under her measured breast peak", () => {
    const [live, figure] = [standingTip(true), standingTip(false)];
    assert.ok(live.distanceTo(figure) < SIZE_TOLERANCE, `the live bust is ${live.distanceTo(figure).toFixed(4)} m from the figure's`);
    assert.ok(Math.abs(figure.y - SAGGED_PEAK_Y) < SIZE_TOLERANCE, `her breast peak stands at ${figure.y.toFixed(4)} m`);
    assert.ok(Math.abs(BUST.y - DOME_Y) < 1e-6, `her dome centres at ${BUST.y.toFixed(5)} m`);
  });
});
