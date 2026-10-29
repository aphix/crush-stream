import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import type { DetachPart } from "./car-core.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { BLACKOUT, CABIN_TRIM, INNER_PANEL, PRIMER_ATTRIBUTE, WELL_PANEL } from "./constants.ts";
import { CAR_STYLE_IDS, CAR_STYLES, drawnStyle, type CarStyleId } from "./car-variants.ts";
import { makeShell, PANEL_NAMES, panelRegions, poseShell, setPrimer } from "./car-panels.ts";
import { bootCut, bootCutAt, makeHoodGeometry } from "./car-mesh.ts";
import { DENT_MAX, newDentState, recordDent } from "./loose-dent.ts";
import { runWall, type CrashResult } from "../contact/crash-scenarios.test-util.ts";
import { assertSameNumbers, DT, paint } from "./test-support.ts";
import { lowest, RESTS } from "./loose-step.test-util.ts";

/** The body's paint attribute, joined: 0 paint, 1 primer, `INNER_PANEL` the unpainted bay trough, `WELL_PANEL` the wheel wells, `BLACKOUT` gloss-black trim, `CABIN_TRIM` the cabin. */
const primerOf = (car: DeformableCar): string => Array.from(car.body.geometry.getAttribute("primer").array).join();
/** The rest build's (the drawn style's, as the car builds its body): paint, the trough's inner panel, the wells, the blacked-out trim (roof fittings, pillars, cowl) and the cabin's trim (blended at its tub's ends) only. */
const restPrimer = (car: DeformableCar): string => {
  const rest = Array.from(makeChassisGeometry(drawnStyle(car.style)).getAttribute("primer").array);
  expect(rest.every((v) => v === 0 || v === 1 || v === INNER_PANEL || v === WELL_PANEL || v === BLACKOUT || (v < 0 && v >= CABIN_TRIM)), "a rest body holds only paint, primer, inner panel, wells, blackout and cabin trim").toBeTruthy();
  return rest.join();
};

/** How far (m) the light bar may sink into the roof skin under it past where it sits at rest: its feet's seat (measured 0.022 at worst, struck and tilted). */
const BAR_SEAT_M = 0.03;
/** A roof skin vertex counts as under a bar vertex within this plan distance (m): the skin's vertex spacing on the roof. */
const UNDER_M = 0.15;
/** Body positions are float32: a quarter vertex cut exactly at the door's rear edge reads within this (m) of the float64 edge. */
const FLOAT32_EDGE = 1e-6;

/** How deep (m) the light bar's deepest vertex sits under the roof skin directly beneath it (negative: clear of it). */
function barDepth(car: Probe): number {
  car.flushDeferredSkin();
  car.updateSkin();
  car.group.updateMatrixWorld(true);
  const pos = car.body.geometry.getAttribute("position") as THREE.BufferAttribute;
  const skin: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) skin.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(car.body.matrixWorld));
  let deepest = -Infinity;
  car.part("lightBar").object.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.visible) return;
    const bp = o.geometry.getAttribute("position") as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < bp.count; i++) {
      v.fromBufferAttribute(bp, i).applyMatrix4(o.matrixWorld);
      let roof = -Infinity;
      for (const s of skin) if (Math.hypot(s.x - v.x, s.z - v.z) < UNDER_M) roof = Math.max(roof, s.y);
      if (roof > -Infinity) deepest = Math.max(deepest, roof - v.y);
    }
  });
  return deepest;
}
/** The car with its parts and its hood readable, and a part tearable at a chosen impulse. */
class Probe extends DeformableCar {
  get allParts(): DetachPart[] {
    return this.parts;
  }
  get hoodMesh(): THREE.Mesh {
    return this.hood;
  }
  tear(name: string, impulse: number): void {
    this.detachPart(this.part(name), impulse);
  }
  part(name: string): DetachPart {
    return this.parts.find((p) => p.name === name)!;
  }
}
function probe(style: CarStyleId = "sedan"): Probe {
  const car = new Probe(paint(), new THREE.Scene(), null, style);
  car.deform.setMode("shape");
  return car;
}
const positions = (m: THREE.Object3D) => ((m as THREE.Mesh).geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
const worst = (r: CrashResult, kind: "quarter" | "arch") => Math.max(...PANEL_NAMES.filter((n) => n.startsWith(kind)).map((n) => r.hinge[n]!));
const torn = (r: CrashResult, kind: "quarter" | "arch") => r.detached.filter((n) => n.startsWith(kind));

describe("given every car body style, whose panels are cut from each body's own skin", () => {
  const bodies = CAR_STYLE_IDS.map((id) => ({ id, body: makeChassisGeometry(drawnStyle(CAR_STYLES[id])) }));

  it("when each body's panels are cut, then every body has all six panels and no triangle belongs to two of them", () => {
    for (const { id, body } of bodies) {
      const cuts = panelRegions(CAR_STYLES[id], body);
      expect(cuts.map((r) => r.name).join()).toBe(PANEL_NAMES.join());
      const seen = new Set<string>();
      for (const r of cuts) {
        expect(r.verts.length > 20 && r.tris.count >= 30 * 3, `${id} ${r.name} has ${r.tris.count / 3} triangles`).toBeTruthy();
        for (let t = 0; t < r.tris.count; t += 3) {
          const key = [0, 1, 2].map((k) => r.tris.getX(t + k)).join(",");
          expect(!seen.has(key), `${id}: triangle ${key} is in two panels (${r.name})`).toBe(true);
          seen.add(key);
        }
      }
    }
  });

  it("when the sedan, coupe and pickup quarter panels are cut, then each starts at its body's own rear door seam or behind its door, not at one shared place", () => {
    const front = (id: string) => {
      const { body } = bodies.find((b) => b.id === id)!;
      const r = panelRegions(CAR_STYLES[id as keyof typeof CAR_STYLES], body).find((q) => q.name === "quarterR")!;
      const pos = body.getAttribute("position") as THREE.BufferAttribute;
      return Math.max(...[...r.verts].map((v) => pos.getZ(v)));
    };
    expect(front("sedan"), `sedan quarter reaches z=${front("sedan")}, past its rear door`).toBeLessThan(-0.5);
    // The pickup's extended cab ends in a rear-access panel: its quarter starts at that panel's seam, as a four-door's does.
    const seam = CAR_STYLES.pickup.rearDoorSeam!;
    expect(Math.abs(front("pickup") - seam), `pickup quarter starts at z=${front("pickup")}, not at its rear-access panel's seam ${seam}`).toBeLessThanOrEqual(FLOAT32_EDGE);
    const doorRear = CAR_STYLES.coupe.door.hingeZ - CAR_STYLES.coupe.door.length;
    expect(front("coupe"), `coupe quarter starts at z=${front("coupe")}, not reaching its door's rear edge ${doorRear}`).toBeGreaterThanOrEqual(doorRear - FLOAT32_EDGE);
  });

  it("when the sedan's quarter panel is shelled flat and then bent, then the flat shell lies on the skin (4 mm proud, its sheet 2 cm behind) and the bent panel peels at its leading edge and holds at the tail", () => {
    const { body } = bodies[0]!;
    const r = panelRegions(CAR_STYLES.sedan, body).find((q) => q.name === "quarterR")!;
    const shell = makeShell(r, body);
    const pos = body.getAttribute("position") as THREE.BufferAttribute;
    const out = shell.getAttribute("position") as THREE.BufferAttribute;
    const n = r.verts.length;
    const at = (k: number, back: number) => new THREE.Vector3(out.getX(k + back * n), out.getY(k + back * n), out.getZ(k + back * n)).add(r.origin);
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, r.verts[k]!);
      expect(at(k, 0).distanceTo(v), `front vertex ${k} stands ${at(k, 0).distanceTo(v)} m off the skin`).toBeLessThan(0.0045);
      expect(Math.abs(at(k, 1).distanceTo(v) - 0.02), `back vertex ${k} is ${at(k, 1).distanceTo(v)} m behind`).toBeLessThan(1e-4);
    }
    poseShell(r, shell, body, 1, 0);
    let free = 0;
    let held = 0;
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, r.verts[k]!);
      const d = at(k, 0).distanceTo(v);
      if (r.w[k]! > 0.9) free = Math.max(free, d);
      if (r.w[k]! < 0.05) held = Math.max(held, d);
    }
    expect(free, `the free end peeled ${free} m`).toBeGreaterThan(0.2);
    expect(held, `the hinge end moved ${held} m`).toBeLessThan(0.02);
  });

  it("when a police car nobody has crashed is checked, then it carries no panel mesh: attached panels are body, with no draw of their own", () => {
    const car = probe("police");
    for (const p of car.allParts.filter((q) => q.region)) expect(!p.open && p.object.parent === null, `${p.name} is in the scene`).toBeTruthy();
    expect(primerOf(car), "the body is paint (and the bay trough unpainted) before any panel hinged").toBe(restPrimer(car));
  });
});

describe("given the standard crashes into a wall, body panels hinge, then tear", () => {
  // todo -> after the plan: recalibrate the off-centre wall hit's crush against the lever's spin. 56 km/h rear wall 30 % offset gives a
  // quarter-panel hinge 0.055 (the bend needs 0.2-0.8): the lever spins the car away, so the corner crushes less than a square hit.
  todoRow("when a car hits a rear wall 30 % offset at 56 km/h and then at 80, then a quarter panel bends at 56 and tears at 80", true, () => {
    const soft = runWall(56, 0.3, "rear");
    expect(worst(soft, "quarter") > 0.2 && worst(soft, "quarter") < 0.8, `56 km/h hinge ${worst(soft, "quarter")}`).toBeTruthy();
    expect(torn(soft, "quarter")).toHaveLength(0);
    const hard = runWall(80, 0.3, "rear");
    expect(torn(hard, "quarter").length, `80 km/h tore ${torn(hard, "quarter")}`).toBe(1);
  });

  // todo -> after the plan: recalibrate the off-centre wall hit's crush against the lever's spin. 40 km/h front wall 30 % offset gives an
  // arch hinge 0.073 (the flap needs more than 0.5): the lever spins the car away from the wall, so the struck corner crushes less.
  todoRow("when a car hits a front wall 30 % offset at 40 km/h and then at 56, then an arch flare flaps at 40 and tears at 56", true, () => {
    const soft = runWall(40, 0.3, "front");
    expect(worst(soft, "arch"), `40 km/h arch hinge ${worst(soft, "arch")}`).toBeGreaterThan(0.5);
    expect(torn(soft, "arch")).toHaveLength(0);
    expect(torn(runWall(56, 0.3, "front"), "arch").length).toBe(1);
  });

  it("when a car hits a wall off-centre with its nose at 24 km/h, then the front bumper hangs from its far corner, still on", () => {
    const car = probe();
    runWall(24, 0.3, "front", { car });
    const bumper = car.part("bumperF");
    expect(bumper.hingeT > 0.3 && !bumper.detached, `bumper hinge ${bumper.hingeT}`).toBeTruthy();
    expect(Math.abs(bumper.object.rotation.z), `bumper rolled ${bumper.object.rotation.z} rad`).toBeGreaterThan(0.05);
  });

  it("when a car hits a wall at 24 km/h, then every panel stays flat and no shell is in the scene", () => {
    const car = probe();
    const r = runWall(24, 1, "front", { car });
    for (const n of PANEL_NAMES) expect(r.hinge[n], `${n} hinged at 24 km/h`).toBe(0);
    expect(car.allParts.every((p) => !p.region || !p.open)).toBeTruthy();
  });

  it("when a police car hits a wall at 56 km/h, then its light bar folds on its base hinge, stays on the roof it rides (not through it), and does not shear off (it shears off at 64)", () => {
    const car = probe("police");
    const r = runWall(56, 1, "front", { car });
    expect(!r.detached.includes("lightBar")).toBe(true);
    expect(r.hinge.lightBar! > 0.3 && r.hinge.lightBar! < 0.95, `bar hinge ${r.hinge.lightBar}`).toBeTruthy();
    const bar = car.part("lightBar");
    expect(Math.abs(bar.object.rotation.x), `bar folded ${bar.object.rotation.x} rad`).toBeGreaterThan(0.1);
    const rest = probe("police");
    rest.spawnFacing(0, 0, 0, 0);
    const atRest = barDepth(rest);
    const struck = barDepth(car);
    // Tipped about its far foot with the struck side going down, the bar stood 0.35 m through the roof for the rest of the run (light-bar.test.ts holds the gaps of its edges).
    expect(struck, `the struck bar is ${struck.toFixed(3)} m into the roof under it, ${atRest.toFixed(3)} at rest`).toBeLessThanOrEqual(atRest + BAR_SEAT_M);
  });
});

describe("given a car whose quarter panels and arch flares are torn off", () => {
  it("when the car steps on, then a torn arch rests on the road (lowest point within a centimetre), a car shows at most two torn shells, and a reset brings every shell back and the body to paint", () => {
    const car = probe();
    for (const n of ["quarterL", "quarterR", "archFL", "archFR"]) car.tear(n, 20);
    for (let i = 0; i < 240; i++) car.step(DT);
    for (const n of ["archFL", "archFR"]) {
      const low = lowest(car.part(n));
      expect(low >= -1e-9 && low <= RESTS, `${n} lowest point ${low.toFixed(4)} m over the road`).toBeTruthy();
    }
    expect(car.allParts.filter((p) => p.region && p.detached && p.object.visible).length, "drawn torn shells").toBe(2);
    car.resetVisual();
    expect(car.allParts.every((p) => !p.region || p.object.visible), "a reset brings every shell back").toBeTruthy();
    expect(primerOf(car), "and the body is paint again (the bay trough still unpainted)").toBe(restPrimer(car));
  });

  // The arch flies as its box (`boxShape`; its drawn U as support points is ticket B, post-overhaul) and which face that box lands on is
  // chaos in the tear: torn at 16, 18, 19, 20, 21, 22 and 24 m/s, the 0.405 m arch lay flat at 19 and 20 only, on its edge (thin axis
  // 0.001-0.008 up) or 0.62 up at the rest; the 0.375 m arch (CarSedan 20334982) at 19 only (20 m/s: thin axis 0.030 up). Both rest on
  // the road (lowest point 0.0000 m) every time.
  it.todo("when the car steps on, then a torn arch lies flat on the road (thin axis up), as a torn hood does, at any tear speed");

  it("when a panel is torn and posed again, then it stays hidden when off screen and its cull bounds enclose every vertex of each new pose", () => {
    const car = probe();
    car.tear("quarterR", 20);
    const part = car.part("quarterR");
    const mesh = part.object as THREE.Mesh;
    expect(mesh.frustumCulled, "a torn panel is frustum-culled").toBe(true);
    expect(mesh.geometry.boundingSphere, "recentre leaves no stale sphere").toBe(null);
    mesh.geometry.computeBoundingSphere();
    poseShell(part.region!, mesh.geometry, car.body.geometry, 1, 0);
    expect(mesh.geometry.boundingSphere, "poseShell leaves no stale sphere").toBe(null);
    mesh.geometry.computeBoundingSphere();
    const sphere = mesh.geometry.boundingSphere!;
    const p = positions(mesh);
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i]! - sphere.center.x, p[i + 1]! - sphere.center.y, p[i + 2]! - sphere.center.z);
      expect(d, `vertex ${i / 3} is ${d} from the centre, radius ${sphere.radius}`).toBeLessThanOrEqual(sphere.radius + 1e-6);
    }
  });
});

describe("given a parked car that tears its hood and right quarter panel off and drops them on the road (dents on torn parts)", () => {
  /** A parked car tears its hood and right quarter panel off, then drops them on the road: 240 fixed steps. */
  function dropped(): Probe {
    const car = probe();
    car.tear("hood", 20);
    car.tear("quarterR", 20);
    for (let i = 0; i < 240; i++) car.step(DT);
    return car;
  }
  const fresh = positions(probe().hoodMesh);

  it("when the parts land, then they dent where they land, by centimetres, and a second run dents them to the same vertex", () => {
    const a = dropped();
    const hood = a.part("hood");
    expect(hood.dent.count > 0 && a.part("quarterR").dent.count > 0, "no bounce dented them").toBeTruthy();
    let moved = 0;
    for (const [i, v] of positions(hood.object).entries()) moved = Math.max(moved, Math.abs(v - fresh[i]!));
    expect(moved > 0.01 && moved <= 0.09, `hood dented by ${moved} m`).toBeTruthy();
    const b = dropped();
    assertSameNumbers(positions(b.part("hood").object), positions(hood.object), "hood vertices");
    assertSameNumbers(positions(b.part("quarterR").object), positions(a.part("quarterR").object), "quarter panel vertices");
  });

  it("when the car is reset, then the skin is put back", () => {
    const car = dropped();
    car.resetVisual();
    assertSameNumbers(positions(car.part("hood").object), fresh, "reset hood");
    expect(car.part("hood").dent.count).toBe(0);
  });

  it("when a soft touch lands and then many hard ones, then the soft touch does not dent and a part takes no more than its share of dents", () => {
    const d = newDentState();
    const o = new THREE.Object3D();
    recordDent(d, o, new THREE.Vector3(0, 1, 0));
    expect(d.count, "a 1 m/s touch dented").toBe(0);
    for (let i = 0; i < DENT_MAX + 5; i++) recordDent(d, o, new THREE.Vector3(0, 6, 0));
    expect(d.count).toBe(DENT_MAX);
  });
});

describe("given every style's detachable panels as they read once they come off", () => {
  /** How many of `geo`'s vertices whose normal `face` keeps hold primer `tone`, of how many it keeps. */
  const toneOf = (geo: THREE.BufferGeometry, face: (n: THREE.Vector3, v: number) => boolean, tone: number): { held: number; of: number } => {
    const [primer, normal] = [geo.getAttribute(PRIMER_ATTRIBUTE), geo.getAttribute("normal")];
    const n = new THREE.Vector3();
    let [held, of] = [0, 0];
    for (let v = 0; v < normal.count; v++) {
      if (!face(n.fromBufferAttribute(normal, v), v)) continue;
      of++;
      if (primer?.getX(v) === tone) held++;
    }
    return { held, of };
  };

  it("when each car's drawn hood is read as it is built (a bulge and scoop merged in), then the lid's underside is an unpainted inner panel", () => {
    for (const id of CAR_STYLE_IDS) {
      const hood = new DeformableCar(paint(), new THREE.Scene(), null, id).lookMeshes().hood.geometry;
      // The lid's own vertices lead the merge; the bulge's and scoop's buried bases follow them.
      const lid = makeHoodGeometry(CAR_STYLES[id]).getAttribute("position").count;
      const { held, of } = toneOf(hood, (n, v) => v < lid && n.y < -0.5, INNER_PANEL);
      expect(of > 0 && held === of, `${id}: ${held} of ${of} hood underside vertices unpainted`).toBeTruthy();
    }
  });

  it("when each style with a deck lid is read, then its boot's floor corners, the hollow a popped or torn lid shows, are the cabin's dark trim (the boot's carpet), not bare steel", () => {
    let lined = 0;
    for (const id of CAR_STYLE_IDS) {
      const cut = bootCut(CAR_STYLES[id]);
      if (!cut.lined) continue;
      const body = makeChassisGeometry(CAR_STYLES[id]);
      const { ring, slices } = body.userData.loft as { ring: number; slices: number };
      const [pos, primer] = [body.getAttribute("position"), body.getAttribute(PRIMER_ATTRIBUTE)];
      let [held, of] = [0, 0];
      for (let s = 0; s < slices; s++) {
        // A wrapped lid's tail ring (slice 0) is the tail cap's too: its corners stay paint.
        if ((s === 0 && cut.face) || bootCutAt(pos.getZ(s * ring), cut).open < 1) continue;
        for (const v of [s * ring, s * ring + ring - 1]) {
          of++;
          if (primer.getX(v) === CABIN_TRIM) held++;
        }
      }
      expect(of > 0 && held === of, `${id}: ${held} of ${of} boot floor corners cabin trim`).toBeTruthy();
      if (cut.face) expect(primer.getX(0) === 0 && primer.getX(ring - 1) === 0, `${id}: the tail cap's corners tone ${primer.getX(0)}, ${primer.getX(ring - 1)}, not paint`).toBeTruthy();
      lined++;
    }
    expect(lined, "some style has a deck lid's boot").toBeGreaterThan(0);
  });

  it("when each style's quarter and arch shells are built, then the front layer wears the panel's rest tones and the back layer, its inside once torn, is an unpainted inner panel", () => {
    for (const id of CAR_STYLE_IDS) {
      const body = makeChassisGeometry(CAR_STYLES[id]);
      for (const r of panelRegions(CAR_STYLES[id], body)) {
        const primer = makeShell(r, body).getAttribute(PRIMER_ATTRIBUTE);
        const n = r.verts.length;
        expect(primer !== undefined && primer.count === 2 * n, `${id} ${r.name}: a primer per shell vertex`).toBeTruthy();
        let wrong = 0;
        for (let k = 0; k < n; k++) if (primer.getX(k) !== r.rest[k] || primer.getX(n + k) !== INNER_PANEL) wrong++;
        expect(wrong, `${id} ${r.name}: ${wrong} of ${n} vertices off their layer's tone`).toBe(0);
      }
    }
  });

  it("when a panel peels or tears off, then the under-panel left on the body is dark unpainted inner panel, and no vertex darker still at rest (a well's own tone) turns lighter", () => {
    for (const id of CAR_STYLE_IDS) {
      const body = makeChassisGeometry(CAR_STYLES[id]);
      const primer = body.getAttribute(PRIMER_ATTRIBUTE);
      for (const r of panelRegions(CAR_STYLES[id], body)) {
        setPrimer(r, body, true);
        let lighter = 0;
        for (let k = 0; k < r.verts.length; k++) if (primer.getX(r.verts[k]!) < Math.max(INNER_PANEL, r.rest[k]!)) lighter++;
        expect(lighter, `${id} ${r.name}: ${lighter} under-panel vertices lighter than inner panel or their own darker rest tone`).toBe(0);
        setPrimer(r, body, false);
      }
    }
  });
});
