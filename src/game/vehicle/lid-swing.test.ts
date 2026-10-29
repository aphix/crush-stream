import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { LID } from "./constants.ts";
import { paint } from "./test-support.ts";
import { must } from "../kernel/must.test-util.ts";

/**
 * The trunk lid, hatch, liftgate and drop gate swing on the doors' hinge model (docs/DOOR_RIG.md, "Lids"): a rear hit past the
 * latch's threshold springs it, it swings on its weight, struts and the car's surge, re-latches when shut under its slam limit,
 * and tears off at its stop, on a slam, or under a hit once open.
 */

const H = 1 / FINE_HZ;
const LIDS: readonly CarStyleId[] = ["sedan", "hatchback", "wagon", "pickup", "monster"];
/** The owner's open-hood photos, hood against belt line in their side views: a real hood stands this far up (degrees). */
const HOOD_OPEN_DEG = [27, 34] as const;
/** The hood's rear edge may rise this far (m) above its rest top as it turns (its own thickness): no visible gap at the cowl. */
const HOOD_EDGE_RISE = 0.015;
/** The rear-edge band (m, from the hood's rearmost point) read as its hinge line. */
const EDGE_BAND = 0.01;

function parked(id: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.spawnFacing(0, 0, 0, 0);
  return car;
}

/** `seconds` of free swing; `az` the car's forward acceleration (m/s²). */
function swing(car: DeformableCar, seconds: number, az = 0): void {
  for (let t = 0; t < seconds - 1e-9; t += H) {
    car.velocity.addScaledVector(car.fwdFlat, az * H);
    car.swingHinges(H);
  }
}

/** The closing (or opening) rate (rad/s) at which the lid carries `share` × `energy` (J). */
const rateFor = (car: DeformableCar, share: number, energy: number): number => Math.sqrt((2 * share * energy) / car.lidHinge().spec.inertia);

describe("given a rear hit on a car with its lid shut", () => {
  for (const id of LIDS) {
    it(`when a ${id} backs into a wall at 14 km/h, then its lid stays latched; at 30 km/h its latch springs and the lid stays on`, (t) => {
      const soft = parked(id);
      runWall(14, 1, "rear", { car: soft });
      const hard = parked(id);
      runWall(30, 1, "rear", { car: hard });
      t.annotate(`${id}: 14 km/h hinge ${soft.lidAngle().toFixed(3)} rad, 30 km/h ${hard.lidAngle().toFixed(3)} rad`);
      expect(soft.lidHinge().latched, `${id} lid sprang at 14 km/h`).toBeTruthy();
      expect(!hard.lidHinge().latched && !hard.lidOff(), `${id} lid at 30 km/h: latched ${hard.lidHinge().latched}, off ${hard.lidOff()}`).toBeTruthy();
    });
  }
});

describe("given an unlatched lid on a parked car", () => {
  it("when a pickup's tailgate is sprung, then it drops rearward onto its cables, level (90°), and never swings under", () => {
    const car = parked("pickup");
    const s = car.lidHinge().spec;
    // Where a 30 km/h rear hit springs it (`lidAngle` above): a gate barely off upright is held by its hinges' friction.
    car.setLidOpen(0.15);
    let most = 0;
    for (let k = 0; k < 2 * FINE_HZ; k++) {
      car.swingHinges(H);
      most = Math.max(most, car.lidHinge().theta);
    }
    const h = car.lidHinge();
    expect(Math.abs(s.stop - Math.PI / 2), `stop ${s.stop}`).toBeLessThan(1e-9);
    expect(h.theta).toBe(s.stop);
    expect(most, `swung to ${most}`).toBeLessThanOrEqual(s.stop);
    expect(h.load > 0 && h.load < s.tearJ && !car.lidOff(), `cables took ${h.load} J`).toBeTruthy();
  });

  for (const id of ["wagon", "hatchback"] as const) {
    it(`when a ${id}'s top-hinged gate is let go, then its gas struts lift it up to its stop and hold it there`, () => {
      const car = parked(id);
      car.setLidOpen(0.02);
      swing(car, 3);
      expect(car.lidHinge().theta).toBe(car.lidHinge().spec.stop);
      expect(!car.lidOff()).toBe(true);
    });
  }

  it("when a sedan's lid is let go, then its torsion bars lift it to its stop, a hard launch swings it down off the stop, and coasting lets it rise back", () => {
    const car = parked("sedan");
    const h = car.lidHinge();
    car.setLidOpen(0.05);
    swing(car, 2);
    expect(h.theta).toBe(h.spec.stop);
    swing(car, 0.5, 8);
    const launched = h.theta;
    swing(car, 2);
    expect(launched < h.spec.stop - 0.1 && !h.latched, `launch left it at ${launched}`).toBeTruthy();
    expect(h.theta).toBe(h.spec.stop);
  });
});

describe("given an open lid pushed shut or flung onto its stop", () => {
  it("when a solid pushes it shut at 0.9× its slam limit, then it latches; at 1.1×, then it is wrenched off", () => {
    const soft = parked("sedan");
    soft.setLidOpen(1);
    soft.shutLid(0, rateFor(soft, 0.9, soft.lidHinge().spec.slamJ));
    const hard = parked("sedan");
    hard.setLidOpen(1);
    hard.shutLid(0, rateFor(hard, 1.1, hard.lidHinge().spec.slamJ));
    expect(soft.lidHinge().latched && !soft.lidOff() && soft.lidAngle() === 0).toBeTruthy();
    expect(hard.lidOff() && hard.hasLoosePart()).toBeTruthy();
  });

  it("when it is flung onto its stop at 0.8× its hinge limit, then it holds; at 1.25×, then it tears off", () => {
    const fling = (share: number): DeformableCar => {
      const car = parked("sedan");
      car.setLidOpen(0.4);
      car.lidHinge().omega = rateFor(car, share, car.lidHinge().spec.tearJ);
      swing(car, 0.5);
      return car;
    };
    const soft = fling(0.8);
    expect(!soft.lidOff() && soft.lidHinge().theta === soft.lidHinge().spec.stop, `load ${soft.lidHinge().load}`).toBeTruthy();
    expect(fling(1.25).lidOff()).toBeTruthy();
  });
});

describe("given a rear hit on a car whose lid is already open", () => {
  it("when a sedan backs into a wall at 40 km/h and then 24 km/h, then the first springs the lid open and the second tears it off as a loose part", (t) => {
    const car = parked("sedan");
    runWall(40, 1, "rear", { car });
    const open = !car.lidHinge().latched && !car.lidOff();
    const r = runWall(24, 1, "rear", { car });
    t.annotate(`after the second hit: hinge ${r.hinge[LID.trunk]?.toFixed(3)}, detached ${r.detached.join(",")}, stop load ${car.lidHinge().load.toFixed(1)} J, ebs ${car.deform.hitSpeedValue.toFixed(2)}`);
    expect(open, "the first hit left the lid shut or tore it off").toBeTruthy();
    expect(car.lidOff() && r.detached.includes(LID.trunk) && car.hasLoosePart()).toBeTruthy();
  });
});

/** The rear pane's first vertex in the world (m). */
function rearPaneAt(car: DeformableCar): THREE.Vector3 {
  const mesh = car["glassPanes"].find((g) => g.name === "rear")!.mesh;
  car.group.updateMatrixWorld(true);
  return new THREE.Vector3().fromBufferAttribute(mesh.geometry.getAttribute("position") as THREE.BufferAttribute, 0).applyMatrix4(mesh.matrixWorld);
}

describe("given a car's rear window and its lid (docs/DOOR_RIG.md, Lids)", () => {
  for (const [id, gate] of [["hatchback", true], ["wagon", true], ["sedan", false], ["pickup", false]] as const) {
    it(`when the ${id}'s lid opens to its stop and then tears off, then its rear pane ${gate ? "swings and leaves with it" : "stays on the body"}`, () => {
      const car = parked(id);
      const shut = rearPaneAt(car);
      car.setLidOpen(car.lidHinge().spec.stop);
      const moved = rearPaneAt(car).distanceTo(shut);
      car.ripLid(new THREE.Vector3());
      let up: THREE.Object3D | null = car["glassPanes"].find((g) => g.name === "rear")!.mesh;
      while (up !== null && up !== car.group) up = up.parent;
      if (gate) expect(moved > 0.1 && up === null, `${id} pane moved ${moved.toFixed(3)} m, still on the body ${up !== null}`).toBeTruthy();
      else expect(moved === 0 && up === car.group, `${id} pane moved ${moved} m, on the body ${up !== null}`).toBeTruthy();
    });
  }
});

/** The strip probed beside a gate's glass: this far (m) forward of the D-post's rear edge, in the post's share next to the glass. */
const POST_STRIP = 0.015;
/** The D-post's rear edge is found stepping forward this far (m) at a time from 5 cm behind the glass's side edge. */
const EDGE_STEP = 0.0025;
/** A body surface this near (m) to where the shut gate's was counts as left on the body. */
const NEAR = 0.03;

/**
 * The probes (car frame) of a shut roof-hinged gate's frame and spoiler: where the gate carries a share of each D-post (`boot.postShare`), a ray in from outboard at three
 * heights up each D-post, `POST_STRIP` forward of the first surface (body or gate) beside the rear glass's edge; and one down onto the spoiler behind its shut line.
 */
function gateProbes(car: DeformableCar, meshes: THREE.Object3D[]): { name: string; from: THREE.Vector3; toward: THREE.Vector3 }[] {
  const { base, top } = car.style.rearGlass;
  const spoiler = car.style.roof?.spoiler;
  const gate = spoiler?.gate;
  must(spoiler !== undefined && gate !== undefined, `${car.style.id}: its spoiler has no shut line on the gate`);
  const ray = new THREE.Raycaster();
  const out: { name: string; from: THREE.Vector3; toward: THREE.Vector3 }[] = [];
  for (const side of car.style.boot.postShare === undefined ? [] : [-1, 1]) {
    for (const t of [0.3, 0.5, 0.7]) {
      const [y, edge] = [THREE.MathUtils.lerp(base[0], top[0], t), THREE.MathUtils.lerp(base[1], top[1], t)];
      const toward = new THREE.Vector3(-side, 0, 0);
      let z = edge - 0.05;
      for (; z < edge + 0.15; z += EDGE_STEP) {
        ray.set(new THREE.Vector3(side * 3, y, z), toward);
        if (ray.intersectObjects(meshes, false).length > 0) break;
      }
      expect(z, `${car.style.id}: no D-post beside the glass at ${t} on side ${side}`).toBeLessThan(edge + 0.15);
      out.push({ name: `beside the glass at ${t} on side ${side}`, from: new THREE.Vector3(side * 3, y, z + POST_STRIP), toward });
    }
  }
  out.push({ name: "on the spoiler behind its shut line", from: new THREE.Vector3(0, 3, (spoiler.z[0] + gate) / 2), toward: new THREE.Vector3(0, -1, 0) });
  return out;
}

describe("given a roof-hinged gate's frame and spoiler (hatchback, wagon)", () => {
  for (const id of ["hatchback", "wagon"] as const) {
    it(`when the ${id}'s gate is shut, opened to its stop and torn off, then its spoiler behind the shut line (and the strip beside its glass, where it carries D-post shares) are the gate's: shut they are the lid's skin, open or torn nothing of them stays on the body`, () => {
      const ray = new THREE.Raycaster();
      const shut = parked(id);
      const lid = shut["trunk"];
      shut.group.updateMatrixWorld(true);
      const probes = gateProbes(shut, [shut.body, lid]);
      const at: THREE.Vector3[] = [];
      for (const p of probes) {
        ray.set(p.from, p.toward);
        const hit = ray.intersectObjects([shut.body, lid], false)[0];
        const met = hit === undefined ? "nothing" : hit.object === shut.body ? "the body" : "another mesh";
        expect(hit !== undefined && hit.object === lid, `${id} ${p.name}: the first hit is ${met}${hit ? ` at ${hit.point.toArray().map((v) => v.toFixed(3)).join()}` : ""}, not the gate's skin`).toBeTruthy();
        at.push(hit.point.clone());
      }
      const leaves = (car: DeformableCar, what: string): void => {
        car.group.updateMatrixWorld(true);
        for (let i = 0; i < probes.length; i++) {
          ray.set(probes[i]!.from, probes[i]!.toward);
          for (const hit of ray.intersectObject(car.body, false)) {
            const gap = hit.point.distanceTo(at[i]!);
            expect(gap, `${id} ${probes[i]!.name}, gate ${what}: the body has a surface at ${hit.point.toArray().map((v) => v.toFixed(3)).join()}, ${gap.toFixed(3)} m from where the gate's skin was (${at[i]!.toArray().map((v) => v.toFixed(3)).join()})`).toBeGreaterThanOrEqual(NEAR);
          }
        }
      };
      const open = parked(id);
      open.showPose("open");
      leaves(open, "opened to its stop");
      const torn = parked(id);
      torn.ripLid(new THREE.Vector3());
      leaves(torn, "torn off");

      // The frame and spoiler (`surround`..) skin on the rear glass's cage: the boot cage's clamp would flatten them.
      const geometry = lid.geometry;
      const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
      const surround = geometry.userData.surround;
      expect(typeof surround === "number" && surround < attr.count, `${id}: the gate's surround starts at ${String(surround)} of ${attr.count} vertices`).toBeTruthy();
      const rest = Float32Array.from(attr.array);
      shut.deform.skinPanel(geometry, rest, "glassRear", shut["trunkOrigin"], surround);
      let drift = 0;
      for (let i = surround * 3; i < rest.length; i++) drift = Math.max(drift, Math.abs(attr.array[i]! - rest[i]!));
      expect(drift, `${id}: the surround skinned on the rear glass's cage at rest moves ${drift.toExponential(1)} m`).toBeLessThan(1e-4);
    });
  }
});

describe("given every style parked and posed open for show (`showPose`)", () => {
  it("when its hood is read, then it stands up as far as the owner's open-hood photos show, turned about its rear edge, which stays down on the cowl", () => {
    const rows: string[] = [];
    const bad: string[] = [];
    const at = new THREE.Vector3();
    for (const id of CAR_STYLE_IDS) {
      const car = parked(id);
      car.group.updateMatrixWorld(true);
      const hood = car["parts"].find((p) => p.hinge === "cowl")!.object as THREE.Mesh;
      const pos = hood.geometry.getAttribute("position") as THREE.BufferAttribute;
      let zMin = Infinity;
      for (let i = 0; i < pos.count; i++) zMin = Math.min(zMin, pos.getZ(i));
      const edge: number[] = [];
      for (let i = 0; i < pos.count; i++) if (pos.getZ(i) < zMin + EDGE_BAND) edge.push(i);
      const topY = (): number => Math.max(...edge.map((i) => at.fromBufferAttribute(pos, i).applyMatrix4(hood.matrixWorld).y));
      const restTop = topY();
      const axis = at.setFromMatrixPosition(hood.matrixWorld).y - restTop;
      car.showPose("open");
      car.group.updateMatrixWorld(true);
      const rise = topY() - restTop;
      const nose = at.set(0, 0, 1).transformDirection(hood.matrixWorld);
      const deg = THREE.MathUtils.radToDeg(Math.asin(nose.y));
      rows.push(`${id}: hinge axis ${(axis * 1000).toFixed(0)} mm over the rear edge at rest; open, the edge rises ${(rise * 1000).toFixed(0)} mm and the hood stands ${deg.toFixed(1)} deg`);
      if (rise > HOOD_EDGE_RISE || deg < HOOD_OPEN_DEG[0] || deg > HOOD_OPEN_DEG[1]) bad.push(id);
    }
    expect(bad.join(","), rows.join("\n")).toBe("");
  });
});
