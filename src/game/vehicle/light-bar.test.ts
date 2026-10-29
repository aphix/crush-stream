import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import type { DetachPart } from "./car-core.ts";
import { LIGHT_BAR_FOOT, LIGHT_BAR_LENS, makeLightBar, withPushBar } from "./car-materials.ts";
import { makeBumperGeometry } from "./car-mesh.ts";
import { withRearFittings } from "./car-fittings-mesh.ts";
import { withSeamCover } from "./part-variants.ts";
import { CAR_STYLES } from "./car-variants.ts";
import { BAR_FOLD, hingePose } from "./part-pose.ts";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { DT, paint } from "./test-support.ts";

/** How far (m) the bar's hinge edge may stand off the roof skin under it, over or in: its feet's seat (`panels.test.ts`: 0.022 at worst). */
const SEAT_M = 0.03;
/** The most the free edge may stand over the skin: the seat plus the fold at the last hinge value (0.95) the crash target reaches. */
const FREE_M = SEAT_M + 2 * LIGHT_BAR_FOOT.z * Math.sin(BAR_FOLD * 0.95) + 0.005;
/** The roof mass sinks this far (m) before the bar shears off (`BAR_TEAR_SINK`). */
const TEAR_SINK = 0.12;

/** The bar's feet's sole vertices (rest y on the sole, off the housing) with their rest z: the feet's front or back edge. */
const SOLE = (() => {
  const rest = makeLightBar().getAttribute("position");
  const out: { i: number; z: number }[] = [];
  for (let i = 0; i < rest.count; i++) if (Math.abs(rest.getY(i) - LIGHT_BAR_FOOT.sole) < 1e-6 && Math.abs(rest.getX(i)) > 0.3) out.push({ i, z: rest.getZ(i) });
  return out;
})();

/** How far (m) each sole vertex stands over the roof skin under it, per edge: a nose hit tips the bar forward, so its front edge (+z) is the hinge's. */
interface Gaps {
  hinge: number[];
  free: number[];
}

/** A police car that reads its parts and samples how far its bar's soles stand over the roof skin under them, every sixth frame drawn. */
class Probe extends DeformableCar {
  readonly samples: Gaps[] = [];
  private frames = 0;
  get bar(): DetachPart {
    return this.parts.find((p) => p.name === "lightBar")!;
  }
  override updateSkin(): void {
    super.updateSkin();
    if (this.crashed && !this.bar.detached && this.frames++ % 6 === 0) this.samples.push(this.gaps());
  }
  /** Each sole vertex's height over the body skin (the drawn triangles, interpolated, the highest where two overlap) at its plan place, in the world. */
  gaps(): Gaps {
    this.group.updateMatrixWorld(true);
    const index = this.body.geometry.getIndex()!;
    const skin = this.body.geometry.getAttribute("position") as THREE.BufferAttribute;
    const world: THREE.Vector3[] = [];
    for (let i = 0; i < skin.count; i++) world.push(new THREE.Vector3().fromBufferAttribute(skin, i).applyMatrix4(this.body.matrixWorld));
    const bar = this.bar.object as THREE.Mesh;
    bar.updateWorldMatrix(true, false);
    const verts = bar.geometry.getAttribute("position") as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const out: Gaps = { hinge: [], free: [] };
    for (const { i, z } of SOLE) {
      v.fromBufferAttribute(verts, i).applyMatrix4(bar.matrixWorld);
      let top = -Infinity;
      for (let t = 0; t < index.count; t += 3) {
        const a = world[index.getX(t)]!;
        const b = world[index.getX(t + 1)]!;
        const c = world[index.getX(t + 2)]!;
        const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
        if (Math.abs(det) < 1e-12) continue;
        const u = ((b.z - c.z) * (v.x - c.x) + (c.x - b.x) * (v.z - c.z)) / det;
        const w = ((c.z - a.z) * (v.x - c.x) + (a.x - c.x) * (v.z - c.z)) / det;
        if (u < 0 || w < 0 || u + w > 1) continue;
        top = Math.max(top, u * a.y + w * b.y + (1 - u - w) * c.y);
      }
      assert.ok(top > -Infinity, `no roof skin under the sole at ${v.x.toFixed(2)}, ${v.z.toFixed(2)}`);
      (z > 0 ? out.hinge : out.free).push(v.y - top);
    }
    return out;
  }
  /** The roof mass pushed down to `sink` m under its rest height, then the step's breakage rules run on it. */
  sinkRoof(sink: number): void {
    this.deform.massLocal("roof").y = this.roofRestY - sink;
    this.evaluateBreakage(0, DT);
  }
}
function cop(): Probe {
  const car = new Probe(paint(), new THREE.Scene(), null, "police");
  car.deform.setMode("shape");
  return car;
}

describe("given the police light bar on its base hinge", () => {
  it("when it stands at any hinge value and either struck end, on a car at rest and on one crushed by a 56 km/h hit, then it turns about the line along its base's edge, which the roof carries, and about nothing else", () => {
    const crushed = cop();
    runWall(56, 1, "front", { car: crushed });
    const pose = new Float64Array(7);
    for (const [state, car] of [["rest", cop()], ["crushed", crushed]] as const) {
      for (const inwardZ of [-1, 1]) {
        const side = inwardZ > 0 ? -1 : 1;
        car.deform.impactInward.set(0, 0, inwardZ);
        const edge = (z: number): THREE.Vector3 => car.deform.panelPoint("roof", new THREE.Vector3(0, LIGHT_BAR_FOOT.sole, z), car.bar.restPos, new THREE.Vector3());
        const hinge = edge(side * LIGHT_BAR_FOOT.z);
        const free = edge(-side * LIGHT_BAR_FOOT.z);
        for (const t of [0, 0.1, 0.5, 0.95, 1]) {
          car.bar.hingeT = t;
          hingePose(car.bar, car.deform, pose, 0);
          const q = new THREE.Quaternion(pose[3], pose[4], pose[5], pose[6]);
          const at = new THREE.Vector3(pose[0], pose[1], pose[2]);
          const label = `${state}, inward z ${inwardZ}, hinge ${t}`;
          assert.ok(pose[4] === 0 && pose[5] === 0, `${label}: the turn has a y or z part`);
          assert.ok(Math.abs(2 * Math.atan2(pose[3], pose[6]) - side * t * BAR_FOLD) < 1e-6, `${label}: turned ${2 * Math.atan2(pose[3], pose[6])} rad`);
          // Any point of the bar keeps its x: the axis runs across the car.
          for (const p of [new THREE.Vector3(0.4, -0.03, 0.09), new THREE.Vector3(-0.3, 0.1, -0.12), new THREE.Vector3(0.1, 0.04, 0.2)]) {
            const x = p.clone().applyQuaternion(q).add(at).x;
            assert.ok(Math.abs(x - (car.bar.restPos.x + p.x)) < 1e-6, `${label}: the point ${p.x} moved along the hinge axis`);
          }
          // The hinge edge stays where the roof puts it, whatever the turn.
          const moved = hinge.clone().applyQuaternion(q).add(at).sub(car.bar.restPos).sub(hinge).length();
          assert.ok(moved < 1e-6, `${label}: the hinge edge moved ${moved} m`);
          // The other edge rises as a point `free − hinge` turned about x does (a lift of its depth times the sine of the turn, as the roof carries the two apart).
          const rise = free.clone().applyQuaternion(q).add(at).sub(car.bar.restPos).y - free.y;
          const turn = side * t * BAR_FOLD;
          const wanted = (free.y - hinge.y) * (Math.cos(turn) - 1) - (free.z - hinge.z) * Math.sin(turn);
          assert.ok(Math.abs(rise - wanted) < 1e-6 && rise >= -1e-6, `${label}: the free edge rose ${rise} m, ${wanted} wanted`);
          const top = new THREE.Vector3(0, 0.1, 0).applyQuaternion(q).add(at).sub(car.bar.restPos);
          assert.ok(t === 0 || Math.sign(top.z) === side, `${label}: the bar's top went ${top.z}, not toward the hinge side`);
        }
      }
    }
  });

  it("when a police car hits a wall nose first at 56 km/h, then the bar's hinge edge stays within 3 cm of the roof skin under it all through the crush, its free edge lifts no more than its fold gives, and it does not shear off", () => {
    const car = cop();
    const r = runWall(56, 1, "front", { car });
    assert.ok(!r.detached.includes("lightBar"), "the bar sheared off");
    assert.ok(car.bar.hingeT > 0.3 && car.bar.hingeT < 0.95, `bar hinge ${car.bar.hingeT}`);
    assert.ok(car.samples.length > 10, `${car.samples.length} samples`);
    let seat = 0;
    let free = -Infinity;
    for (const s of car.samples) {
      for (const g of s.hinge) seat = Math.max(seat, Math.abs(g));
      for (const g of s.free) free = Math.max(free, g);
    }
    assert.ok(seat <= SEAT_M, `the hinge edge stood ${seat.toFixed(3)} m off the roof skin`);
    assert.ok(free <= FREE_M, `the free edge stood ${free.toFixed(3)} m over the roof skin (bar ${FREE_M.toFixed(3)})`);
    assert.ok(Math.abs(car.bar.object.rotation.x) > 0.05 && car.bar.object.rotation.z === 0 && car.bar.object.rotation.y === 0, "the bar did not turn about x alone");
  });

  it("when the roof mass sinks to just under and just over the shear depth, then the bar stays on and then goes, with its sirens dark", () => {
    const car = cop();
    runWall(30, 1, "front", { car });
    assert.ok(!car.bar.detached, "the bar went at 30 km/h");
    car.sinkRoof(TEAR_SINK - 0.005);
    assert.ok(!car.bar.detached, "the bar sheared before its depth");
    car.setSirens(true);
    car.flashSirens(0.1);
    const lit = car.lampWorld(car.lampCount - 2, new THREE.Vector3(), new THREE.Vector3());
    assert.equal(lit, "red", "the siren was dark on an attached, hinged bar");
    car.sinkRoof(TEAR_SINK + 0.005);
    assert.ok(car.bar.detached, "the bar held past its depth");
    car.flashSirens(0.1);
    for (let i = car.lampCount - 2; i < car.lampCount; i++) assert.equal(car.lampWorld(i, new THREE.Vector3(), new THREE.Vector3()), null, `siren ${i} lit off a torn bar`);
  });

  it("when the same 56 km/h hit and the same 64 km/h hit run twice, then the bar's hinge, its pose and its loose body agree to the bit", () => {
    const bits = (n: number[]): string => Buffer.from(new Float64Array(n).buffer).toString("hex");
    const digest = (kph: number): string => {
      const car = cop();
      const r = runWall(kph, 1, "front", { car });
      const o = car.bar.object;
      return bits([car.bar.hingeT, o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w, car.bar.velocity.x, car.bar.velocity.y, car.bar.velocity.z, car.bar.angular.x, car.bar.angular.y, car.bar.angular.z, r.detached.includes("lightBar") ? 1 : 0]);
    };
    assert.equal(digest(56), digest(56), "an attached bar differs between two runs of one crash");
    assert.equal(digest(64), digest(64), "a torn bar differs between two runs of one crash");
    assert.notEqual(digest(56), digest(64), "the two crashes read alike");
  });
});

/** The mean x (m, bar space) of `count` vertices of `geo` from `first`. */
function meanX(geo: THREE.BufferGeometry, first: number, count: number): number {
  const pos = geo.getAttribute("position");
  let x = 0;
  for (let v = first; v < first + count; v++) x += pos.getX(v);
  return x / count;
}

describe("given the light bar and the push bar as the reference cruiser wears them", () => {
  it("when the light bar is built, then its red lens stands on the car's left (+x) and its blue on its right, a clear module between", () => {
    const bar = makeLightBar();
    const [[redFirst, redCount], [blueFirst, blueCount]] = LIGHT_BAR_LENS;
    assert.ok(meanX(bar, redFirst, redCount) > 0.2, `red lens at x ${meanX(bar, redFirst, redCount)}`);
    assert.ok(meanX(bar, blueFirst, blueCount) < -0.2, `blue lens at x ${meanX(bar, blueFirst, blueCount)}`);
  });

  it("when the light bar is built, then each lens is domed, its top falling over its front and back edges, with a white lamp cell at its centre standing proud of its faces, as the reference's", () => {
    /** A domed lens's top falls at least this far (m) over its outer 1.5 cm front and back (its 3.5 cm round: 10 mm); a brick's falls none. */
    const DOME_DROP = 0.008;
    /** Over its outer this far (m) of half-depth, front and back. */
    const EDGE_RUN = 0.015;
    /** A white cell's vertex colour (linear) is over this in every channel; the clear takedown module's is under it. */
    const WHITE = 0.8;
    const bar = makeLightBar();
    const pos = bar.getAttribute("position");
    const color = bar.getAttribute("color");
    for (const [first, count] of LIGHT_BAR_LENS) {
      let [top, edgeTop, depth] = [-Infinity, -Infinity, 0];
      for (let v = first; v < first + count; v++) depth = Math.max(depth, Math.abs(pos.getZ(v)));
      for (let v = first; v < first + count; v++) {
        top = Math.max(top, pos.getY(v));
        if (Math.abs(pos.getZ(v)) > depth - EDGE_RUN) edgeTop = Math.max(edgeTop, pos.getY(v));
      }
      const x = meanX(bar, first, count);
      assert.ok(top - edgeTop >= DOME_DROP, `lens at x ${x.toFixed(2)}: its top falls ${((top - edgeTop) * 1000).toFixed(1)} mm over its edges, want ${DOME_DROP * 1000} or more`);
      let proud = -Infinity;
      for (let v = 0; v < pos.count; v++) {
        if (Math.abs(pos.getX(v) - x) > 0.05 || color.getX(v) < WHITE || color.getY(v) < WHITE || color.getZ(v) < WHITE) continue;
        proud = Math.max(proud, Math.abs(pos.getZ(v)) - depth);
      }
      assert.ok(proud > 0, `lens at x ${x.toFixed(2)}: no white cell stands proud of its faces at its centre`);
    }
  });

  it("when a front bumper takes a push bar, then one geometry stands its uprights ahead of the bumper's face and above its top, the bumper's own vertices first and unmoved", () => {
    const bumper = makeBumperGeometry(true, CAR_STYLES.police);
    bumper.computeBoundingBox();
    const before = bumper.boundingBox!.clone();
    const rest = (bumper.getAttribute("position").array as Float32Array).slice();
    const guarded = withPushBar(bumper);
    guarded.computeBoundingBox();
    const after = guarded.boundingBox!;
    // The reference cruiser's guard: its tubes 4 cm ahead of the face (their pads' face 9 cm), its top bar ~18 cm over the bumper's top (y ~0.62).
    assert.ok(after.max.z - before.max.z > 0.08 && after.max.z - before.max.z < 0.1, `face ${before.max.z} -> ${after.max.z}`);
    assert.ok(after.max.y - before.max.y > 0.15 && after.max.y - before.max.y < 0.21, `top ${before.max.y} -> ${after.max.y}`);
    assert.ok(after.min.y >= before.min.y - 1e-6, "the bar reaches below the bumper");
    const now = guarded.getAttribute("position").array;
    let moved = 0;
    for (let i = 0; i < rest.length; i++) moved = Math.max(moved, Math.abs(now[i]! - rest[i]!));
    assert.equal(moved, 0, "the bumper's own vertices moved");
  });

  it("when a police and a sedan are built, then the police's front bumper mesh carries its push bar and the sedan's is its bare fascia with its seam cover, and each rear bumper is its own fascia (the sedan's with its cover)", () => {
    const scene = new THREE.Scene();
    const [police, sedan] = (["police", "sedan"] as const).map((id) => new DeformableCar(paint(), scene, null, id));
    const box = (car: DeformableCar, i: 0 | 1): THREE.Box3 => {
      const geo = (car["bumperMeshes"] as THREE.Mesh[])[i]!.geometry;
      geo.computeBoundingBox();
      return geo.boundingBox!;
    };
    const geoBox = (geo: THREE.BufferGeometry): THREE.Box3 => {
      geo.computeBoundingBox();
      return geo.boundingBox!;
    };
    const bare = geoBox(makeBumperGeometry(true, CAR_STYLES.sedan));
    const covered = geoBox(withSeamCover(makeBumperGeometry(true, CAR_STYLES.sedan), CAR_STYLES.sedan, true));
    const [cop, plain] = [box(police!, 0), box(sedan!, 0)];
    assert.ok(plain.equals(covered), `sedan front bumper face ${plain.max.z}, top ${plain.max.y}: its fascia's with its seam cover`);
    assert.ok(cop.max.z - bare.max.z > 0.08 && cop.max.y - bare.max.y > 0.15, `police front bumper face ${cop.max.z} (bare fascia ${bare.max.z}), top ${cop.max.y} (bare fascia ${bare.max.y})`);
    const [copRear, plainRear] = [box(police!, 1), box(sedan!, 1)];
    const copFascia = geoBox(withRearFittings(makeBumperGeometry(false, CAR_STYLES.police), CAR_STYLES.police));
    const sedanDrawn = geoBox(withSeamCover(withRearFittings(makeBumperGeometry(false, CAR_STYLES.sedan), CAR_STYLES.sedan), CAR_STYLES.sedan, false));
    assert.ok(copRear.equals(copFascia) && plainRear.equals(sedanDrawn), "each rear bumper is its own fascia, the sedan's with its seam cover");
  });
});
