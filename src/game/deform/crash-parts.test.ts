import { describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { StreamedDeformation } from "./streamed-deform.ts";
import type { DeformMode } from "./deform-rig.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { PART_KIND, PartSeat } from "../vehicle/part-geometry.ts";
import { leftoverCrumple, snapshotPoints } from "./physics-util.ts";
import { FRAME_HZ, GRAVITY } from "../kernel/constants.ts";
import { closedOn, DT, dummyGeom, forModes, mass, paint } from "../vehicle/test-support.ts";
import { FREEWHEEL, launch, makeCar, makeWorld, PARKED, runPair, runWall, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { classCar } from "../vehicle/ejection.test-util.ts";
import { sliceSpeed } from "../contact/sat.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { DebrisSystem } from "../present/engine-fx.ts";
import { stepWreck, type WreckRig } from "./physics-util.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
type PartRow = { name: string; hingeT: number; detached: boolean };

function spawnOffset(impactX: number, speed = 14, mode: DeformMode = "lattice") {
  const geom = dummyGeom();
  const d = new StreamedDeformation(geom);
  d.mode = mode;
  const group = new THREE.Group();
  group.updateMatrixWorld();
  const vel = new THREE.Vector3(0, 0, speed);
  const omega = new THREE.Vector3();
  d.beginCrush(new THREE.Vector3(impactX, 0.36, 2.06), new THREE.Vector3(0, 0, -1), speed, speed, group, vel, omega);
  return { d, group, vel, omega, geom };
}

/** One frame of the wall hit. */
function stepWall(s: WreckRig & { geom: THREE.BufferGeometry }, dt: number, contactX: number): void {
  stepWreck(s, dt, () => {
    s.d.notifyContact();
    const fl = mass(s.d, "bumperFL").world;
    const fr = mass(s.d, "bumperFR").world;
    const contact = new THREE.Vector3(contactX, 0.38, (fl.z + fr.z) * 0.5);
    const n = new THREE.Vector3(0, 0, -1);
    const closing = Math.max(0, -s.vel.dot(n));
    if (s.d.massActive) s.d.markMotion();
    s.d.feedOverlap(contact, n, 0.1, closing, dt);
    if (s.d.massActive) s.d.takeMotion(s.vel, s.omega);
  });
  s.d.stepCrush(dt);
  s.d.update(s.geom);
}

forModes("given a car driving at 14 m/s into a wall that meets one front corner", (mode) => {
  it("when the wall hits the right-front corner, then the right-front bumper sits at least 8 cm further back than the left-front one and the rear bumper stays at least 1.95 m behind the middle (1.9 m in shape mode)", () => {
    const s = spawnOffset(0.62, 14, mode);
    for (let i = 0; i < 24; i++) stepWall(s, DT, mass(s.d, "bumperFR").world.x);
    const flz = mass(s.d, "bumperFL").local.z;
    const frz = mass(s.d, "bumperFR").local.z;
    const rlz = mass(s.d, "bumperRL").local.z;
    expect(frz, `no corner banana: FL.z=${flz.toFixed(3)} FR.z=${frz.toFixed(3)}`).toBeLessThan(flz - 0.08);
    expect(rlz, `rear extruded to ${rlz.toFixed(3)}`).toBeLessThanOrEqual((mode === "shape" ? -1.9 : -1.95));
  });

  it("when the wall hits the right-front corner, then the two front bumper corners stay more than 0.7 m apart across the car, the far corner staying wide as the nose bends sideways", () => {
    const s = spawnOffset(0.62, 14, mode);
    for (let i = 0; i < 22; i++) stepWall(s, DT, mass(s.d, "bumperFR").world.x);
    const r = mass(s.d, "bumperFR").local.x;
    const l = mass(s.d, "bumperFL").local.x;
    expect(r, `track collapsed: FL.x=${l.toFixed(3)} FR.x=${r.toFixed(3)}`).toBeGreaterThan(l + 0.7);
  });

  it("when the wall hits the left-front corner, then the left-front bumper sits at least 6 cm further back than the right-front one, so the sideways bend is not mirrored the wrong way", () => {
    const s = spawnOffset(-0.62, 14, mode);
    for (let i = 0; i < 22; i++) stepWall(s, DT, mass(s.d, "bumperFL").world.x);
    const flz = mass(s.d, "bumperFL").local.z;
    const frz = mass(s.d, "bumperFR").local.z;
    expect(flz, `inverted banana L=${flz.toFixed(3)} R=${frz.toFixed(3)}`).toBeLessThan(frz - 0.06);
  });

  it("when the squash slider (how readily the body crushes) is 0.7 instead of 0.2 and the wall hits the right-front corner, then the hit corner is pushed back more than 1.15 times as far", () => {
    const lo = spawnOffset(0.62, 14, mode);
    lo.d.squash = 0.2;
    const hi = spawnOffset(0.62, 14, mode);
    hi.d.squash = 0.7;
    for (let i = 0; i < 18; i++) {
      stepWall(lo, DT, mass(lo.d, "bumperFR").world.x);
      stepWall(hi, DT, mass(hi.d, "bumperFR").world.x);
    }
    const a = 2.06 - mass(lo.d, "bumperFR").local.z;
    const b = 2.06 - mass(hi.d, "bumperFR").local.z;
    expect(b, `squash slider dead: lo=${a.toFixed(3)} hi=${b.toFixed(3)}`).toBeGreaterThan(a * 1.15);
  });
});

forModes("given a car driving at 14 m/s head-on into a wall", (mode) => {
  it("when its nose is crushed by the first 20 frames of the hit, then the car body stays on the road, below 0.15 m high", () => {
    const s = spawnOffset(0, 14, mode);
    for (let i = 0; i < 20; i++) stepWall(s, DT, 0);
    expect(s.group.position.y, `lofted to y=${s.group.position.y}`).toBeLessThan(0.15);
  });

  it("when its nose is crushed by the first 20 frames of the hit, then the car body's position follows the cabin block (within 0.35 m sideways and 0.45 m lengthwise), not the crushed bumper", () => {
    const s = spawnOffset(0, 14, mode);
    for (let i = 0; i < 20; i++) stepWall(s, DT, 0);
    const cell = mass(s.d, "cell");
    expect(Math.abs(s.group.position.x - (cell.world.x - cell.rest.x))).toBeLessThan(0.35);
    expect(Math.abs(s.group.position.z - (cell.world.z - cell.rest.z))).toBeLessThan(0.45);
  });

  it("when the nose shortens over 28 frames, then the front bumper has moved back at least 8 cm (2 cm in shape mode) or sits over 5 cm from its rest position, and the remaining-crumple fraction is at most 1", () => {
    const s = spawnOffset(0, 14, mode);
    const z0 = mass(s.d, "bumperFL").local.z;
    for (let i = 0; i < 28; i++) stepWall(s, DT, 0);
    const z1 = mass(s.d, "bumperFL").local.z;
    expect(z0 - z1 > (mode === "shape" ? 0.02 : 0.08) || mass(s.d, "bumperFL").local.distanceTo(mass(s.d, "bumperFL").rest) > 0.05, `nose never shortened ${z0} → ${z1}`).toBeTruthy();
    const after = leftoverCrumple(s.d.crumpleTravel());
    expect(after).toBeLessThanOrEqual(1);
  });
});

describe("given a car in lattice deform mode (a lattice of beams joins its parts)", () => {
  it("when the front bumper's two corners are each pulled 0.4 m outward, then the beam between them reports stretch (strain above 0.05) and is still intact", () => {
    const s = spawnOffset(0, 14, "lattice");
    const beam = s.d.snapshot() as { beams: { a: string; b: string; rest: number }[] };
    const spec = beam.beams.find((b) => b.a === "bumperFL" && b.b === "bumperFR");
    expect(spec).toBeTruthy();
    const fl = mass(s.d, "bumperFL");
    const fr = mass(s.d, "bumperFR");
    fl.world.x -= 0.4;
    fr.world.x += 0.4;
    s.d.stepStructure(DT);
    const snap = s.d.snapshot() as { beams: { a: string; b: string; strain: number; alive: boolean }[] };
    const b = snap.beams.find((x) => x.a === "bumperFL" && x.b === "bumperFR")!;
    expect(b.alive).toBeTruthy();
    expect(b.strain, `tension strain ${b.strain}`).toBeGreaterThan(0.05);
  });

  it("when the nose is crushed head-on for 16 frames, then the beam from the left engine mount to the cabin reports compression (strain below -0.02)", () => {
    const s = spawnOffset(0, 14, "lattice");
    for (let i = 0; i < 16; i++) stepWall(s, DT, 0);
    const snap = s.d.snapshot() as { beams: { a: string; b: string; strain: number }[] };
    const b = snap.beams.find((x) => x.a === "engineL" && x.b === "cell")!;
    expect(b.strain, `expected compression, got ${b.strain}`).toBeLessThan(-0.02);
  });

  it("when the wall hits the right-front corner, then the rear bumper's cross beam keeps over 92 % of its rest length, so the far side is not squashed", () => {
    const s = spawnOffset(0.62, 14, "lattice");
    for (let i = 0; i < 16; i++) stepWall(s, DT, mass(s.d, "bumperFR").world.x);
    const snap = s.d.snapshot() as { beams: { a: string; b: string; plastic: number; rest: number }[] };
    const b = snap.beams.find((x) => x.a === "bumperRL" && x.b === "bumperRR")!;
    expect(b.plastic, `rear beam plastic-shrunk to ${b.plastic}`).toBeGreaterThan(b.rest * 0.92);
  });
});

forModes("given a car struck on its right side at 28 m/s, with the contact held for 45 frames", (mode) => {
  /** The engine's right-door hit (28 m/s closing) held for 45 frames; returns the parts by name. */
  const rightSideHit = (): Record<string, PartRow> => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    car.deform.setMode(mode);
    car.spawn(8, 12, 12);
    car.group.updateMatrixWorld();
    const hit = car.group.position.clone().addScaledVector(car.right, 0.9);
    hit.y = 0.5;
    const inward = car.right.clone().negate();
    car.applyImpact(hit, inward, 28, 28);
    for (let i = 0; i < 45; i++) {
      car.deform.notifyContact();
      car.deform.feedOverlap(hit, inward, 0.08, 12, DT);
      car.deform.stepStructure(DT);
      car.integrate(DT);
      car.stepBreakage(DT);
      car.updateSkin();
    }
    const snap = car.snapshot() as { parts: PartRow[] };
    return Object.fromEntries(snap.parts.map((p) => [p.name, p]));
  };

  it("when the hit settles, then the right door has opened (hinge past 0.15) and by at least 0.08 more than the left door", () => {
    const { doorR: r, doorL: l } = rightSideHit();
    expect(r!.hingeT, `right door never hinged (${r!.hingeT})`).toBeGreaterThan(0.15);
    expect(r!.hingeT, `doors tied together R=${r!.hingeT} L=${l!.hingeT}`).toBeGreaterThan(l!.hingeT + 0.08);
  });

  it("when the hit settles, then the right mirror has folded (hinge past 0.3) or broken off, and the left mirror is untouched, not detached and not hinged", () => {
    const { mirrorR: r, mirrorL: l } = rightSideHit();
    expect(r!.detached || r!.hingeT > 0.3, `right mirror untouched (${r!.hingeT})`).toBeTruthy();
    expect(!l!.detached && l!.hingeT === 0, `left mirror moved (${l!.hingeT}, detached ${l!.detached})`).toBeTruthy();
  });
});

forModes("given a car hit on its nose at 40 m/s, with the contact held for 50 frames", (mode) => {
  it("when the nose hit settles, then the front bumper has folded (hinge past 0.2) or detached", () => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    car.deform.setMode(mode);
    car.spawn(8, 12, 16);
    car.group.updateMatrixWorld();
    const hit = car.group.position.clone().addScaledVector(car.forward, 2.05);
    hit.y = 0.4;
    const inward = car.forward.clone().negate();
    car.applyImpact(hit, inward, 40, 40);
    for (let i = 0; i < 50; i++) {
      car.deform.notifyContact();
      car.deform.feedOverlap(hit, inward, 0.1, 16, DT);
      car.deform.stepStructure(DT);
      car.integrate(DT);
      car.stepBreakage(DT);
      car.updateSkin();
    }
    const snap = car.snapshot() as { parts: { name: string; hingeT: number; detached: boolean; folding: boolean }[] };
    const b = snap.parts.find((p) => p.name === "bumperF")!;
    expect(b.hingeT > 0.2 || b.detached, `bumper never folded (${b.hingeT})`).toBeTruthy();
  });
});

forModes("given a car spawned far from the map's origin and hit on its nose at 50 m/s, with the contact held for 60 frames", (mode) => {
  it("when parts detach, then some do and every loose part lies in world space near the car (within 30 m of it, above the ground), not at its rest position near the origin", () => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    car.deform.setMode(mode);
    car.spawn(80, 120, 14);
    car.group.updateMatrixWorld();
    const hit = car.group.position.clone().addScaledVector(car.forward, 2.05);
    hit.y = 0.4;
    const inward = car.forward.clone().negate();
    car.applyImpact(hit, inward, 50, 50);
    for (let i = 0; i < 60; i++) {
      car.deform.notifyContact();
      car.deform.feedOverlap(hit, inward, 0.12, 18, DT);
      car.deform.stepStructure(DT);
      car.integrate(DT);
      car.stepBreakage(DT);
      car.updateSkin();
      car.afterContacts(DT);
    }
    const snap = car.snapshot() as { parts: { name: string; detached: boolean; pos: { x: number; y: number; z: number } }[] };
    const loose = snap.parts.filter((p) => p.detached);
    expect(loose.length, "the 50/50 nose hit detached nothing").toBeGreaterThan(0);
    const at = car.group.position;
    for (const p of loose) {
      expect(p.pos.y, `${p.name} fell through the map to y=${p.pos.y}`).toBeGreaterThan(-0.05);
      // Left at its rest-local coordinates it would sit near the origin, ~140 m from the car spawned at (80, 120).
      const off = Math.hypot(p.pos.x - at.x, p.pos.z - at.z);
      expect(off, `${p.name} lies ${off.toFixed(1)} m from its car`).toBeLessThan(30);
    }
  });
});

forModes("given a car with one part detached", () => {
  it("when the car is disposed of, then the geometry and own materials of its attached and loose parts are all freed", () => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    car.spawn(0, 0, 0);
    const parts = car["parts"];
    car["detachPart"](parts[0]!, 10);
    const live = new Set<THREE.BufferGeometry | THREE.Material>();
    for (const p of parts) {
      p.object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        live.add(o.geometry);
        for (const m of [o.material].flat() as THREE.Material[]) if (!m.userData.shared) live.add(m);
      });
    }
    for (const r of live) r.addEventListener("dispose", () => live.delete(r));
    car.dispose();
    expect(live.size, `${live.size} part geometries/materials left undisposed`).toBe(0);
  });
});

forModes("given a car whose right mirror is torn off", () => {
  it("when the car is disposed of, then the loose mirror's own geometry copy is freed and the shared mirror geometry is not", () => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    car.spawn(0, 0, 0);
    const seat = car.partSeats[PART_KIND.mirrorR]!;
    car.breakMirror(1, new THREE.Vector3());
    const own = seat.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh);
    must(own, "the torn mirror's seat has no loose mesh");
    let ownFreed = false;
    let sharedFreed = false;
    own.geometry.addEventListener("dispose", () => void (ownFreed = true));
    seat.geometry.addEventListener("dispose", () => void (sharedFreed = true));
    car.dispose();
    expect(ownFreed, "the loose copy leaked").toBe(true);
    expect(sharedFreed, "the shared geometry was disposed with one car").toBe(false);
  });
});

forModes("given a freshly built car", () => {
  it("when it is disposed of, then every geometry and own material in its group, the hull overlay's lines included, is freed", () => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    const live = new Set<THREE.BufferGeometry | THREE.Material>();
    let drawn = 0;
    car.group.traverse((o) => {
      const d = o as THREE.Mesh | THREE.Line | THREE.Points;
      if (!d.geometry) return;
      drawn++;
      // A seat's geometry is the kind's shared one, drawn by every car and never disposed.
      if (o instanceof PartSeat) return;
      live.add(d.geometry);
      for (const m of [d.material].flat() as THREE.Material[]) if (!m.userData.shared) live.add(m);
    });
    expect([...live].some((r) => r instanceof THREE.BufferGeometry && r === (car["hullHelper"] as THREE.LineSegments).geometry), "the hull overlay is among what the car owns").toBeTruthy();
    expect(drawn, `${drawn} drawn objects found`).toBeGreaterThan(20);
    for (const r of live) r.addEventListener("dispose", () => live.delete(r));
    car.dispose();
    expect(live.size, `${live.size} geometries/materials left undisposed`).toBe(0);
  });
});

/** A rolling 16-sided rim's contact point jumps by one facet of its turn: the slip it shows is at most this share of its speed. */
const FACET_SLIP = 1 - Math.cos(Math.PI / 16);

forModes("given a car whose wheel hubs all pop off after a 2 m/s nose knock", (mode) => {
  it("when it runs for 10 s, then each wheel leaves the car as its own body, rolls on its tyre at ground level without sliding at 5 s, is at rest by 10 s, and the drivetrain is dead with no wheels left", () => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    car.deform.setMode(mode);
    car.spawn(0, 0, 8);
    car.group.updateMatrixWorld();
    const hit = car.group.position.clone().addScaledVector(car.forward, 2.05);
    car.applyImpact(hit, car.forward.clone().negate(), 2, 2);
    for (const m of car.deform.masses) if (m.hub) car.deform.popHub(m);
    const before = car.wheels.map((w) => w.position.clone());
    const bodies = car["looseWheels"];
    const tyreR = car.frame.rig.tyre.r;
    const toContact = new THREE.Vector3(0, -tyreR, 0);
    const slide = new THREE.Vector3();
    for (let i = 0; i < 600; i++) {
      if (i === 599) for (const [k, w] of car.wheels.entries()) before[k]!.copy(w.position);
      // The world's slice for a wreck: `integrate` steps its body, wheels and loose parts (once), `afterContacts` is what follows the contacts.
      car.integrate(DT);
      car.syncPose(DT);
      car.afterContacts(DT);
      if (i !== 299) continue;
      // 5 s in: the rim's point on the road moves with the road (centre velocity + spin × lever = 0), to a facet's jump and one slice's gravity.
      expect(car.deform.drivetrainAlive, "no wheels and the drivetrain still runs").toBe(false);
      for (const [k, w] of car.wheels.entries()) {
        const body = bodies[k]!;
        const slip = slide.crossVectors(body.angular, toContact).add(body.velocity).setY(0).length();
        const speed = body.velocity.length();
        expect(w.parent, `wheel ${k} still rides the car`).toBe(scene);
        expect(Math.abs(w.position.y - tyreR), `wheel ${k} rolls at y ${w.position.y.toFixed(3)}, not on its tyre`).toBeLessThanOrEqual(tyreR * FACET_SLIP + 0.02);
        expect(slip, `wheel ${k} slides at 5 s: ${slip.toFixed(3)} m/s at the road at ${speed.toFixed(2)} m/s`).toBeLessThanOrEqual(speed * FACET_SLIP + GRAVITY * DT);
      }
    }
    for (const [k, w] of car.wheels.entries()) expect(w.position.distanceTo(before[k]!), `wheel ${k} still moving after 10 s`).toBeLessThan(1e-3);
  });
});

forModes("given a car hit on its right-front corner at 22 m/s, with the contact held for 20 frames", (mode) => {
  it("when the right-front corner is crushed, then the left headlight is not destroyed before the right one", () => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    car.deform.setMode(mode);
    car.spawn(8, 12, 14);
    car.group.updateMatrixWorld();
    const hit = car.group.position.clone().addScaledVector(car.forward, 2.0).addScaledVector(car.right, 0.7);
    hit.y = 0.4;
    const inward = car.forward.clone().negate();
    car.applyImpact(hit, inward, 22, 22);
    for (let i = 0; i < 20; i++) {
      car.deform.notifyContact();
      car.deform.feedOverlap(hit, inward, 0.08, 10, DT);
      car.deform.stepStructure(DT);
      car.integrate(DT);
      car.stepBreakage(DT);
      car.updateSkin();
    }
    const snap = car.snapshot() as { lamps: { kind: string; side: number; intact: boolean }[] };
    const right = snap.lamps.find((l) => l.kind === "head" && l.side === 1)!;
    const left = snap.lamps.find((l) => l.kind === "head" && l.side === -1)!;
    if (!right.intact) expect(left.intact, "right-front hit killed the left head first").toBeTruthy();
  });
});

describe("given a car hitting a wall", () => {
  it("when it slides sideways into it at 30 km/h, or hits it head-on at 64 km/h full-width or with a 40 % offset, then the 30 km/h slide springs the struck door (hinge past 0.15) without tearing it off, and neither 64 km/h hit tears a door off or opens one past 0.2", () => {
    const side = runWall(30, 1, "side");
    expect(!side.detached.includes("doorL"), `30 km/h side slide tore the door off: ${side.detached.join(",")}`).toBe(true);
    expect(side.hinge.doorL!, `struck door never sprang (${side.hinge.doorL})`).toBeGreaterThan(0.15);
    for (const [name, r] of [["wall64", runWall(64)], ["offset64", runWall(64, 0.4)]] as const) {
      expect(!r.detached.some((p) => p.startsWith("door")), `${name} detached ${r.detached.join(",")}`).toBe(true);
      expect(Math.max(r.hinge.doorL!, r.hinge.doorR!), `${name} doors L=${r.hinge.doorL} R=${r.hinge.doorR}`).toBeLessThanOrEqual(0.2);
    }
  });
});

describe("given a car's front bumper, in shape deform mode", () => {
  it("when the car takes a 25 km/h nose hit and, separately, hits a wall at 56 km/h, then the 25 km/h hit folds the bumper (hinge past 0.1) but leaves it on, and the 56 km/h wall tears it off", () => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    car.deform.setMode("shape");
    car.spawn(8, 12, 16);
    car.group.updateMatrixWorld();
    const hit = car.group.position.clone().addScaledVector(car.forward, 2.05);
    hit.y = 0.4;
    const inward = car.forward.clone().negate();
    car.applyImpact(hit, inward, 16, 25 / 3.6);
    for (let i = 0; i < 50; i++) {
      car.deform.notifyContact();
      car.deform.feedOverlap(hit, inward, 0.1, 16, DT);
      car.deform.stepStructure(DT);
      car.integrate(DT);
      car.stepBreakage(DT);
      car.updateSkin();
    }
    const bumper = (car.snapshot() as { parts: PartRow[] }).parts.find((p) => p.name === "bumperF")!;
    expect(!bumper.detached && bumper.hingeT > 0.1, `25 km/h EBS: hingeT ${bumper.hingeT} detached ${bumper.detached}`).toBeTruthy();
    expect(runWall(56).detached.includes("bumperF"), "56 km/h wall kept the bumper").toBeTruthy();
  });
});

describe("given a wheel that leaves its car only on a hard small-overlap hit", () => {
  it("when cars hit a wall at 64 km/h with a 40 % offset, head-on at 2×56 km/h, and as the struck car of a 50 km/h T-bone, then only the front-left wheel leaves in the offset wall hit, fewer than two leave each car of the head-on and none leaves the struck car", () => {
    expect(firstMismatch(runWall(64, 0.4).hubsPopped, ["hubFL"]), "64 km/h 40 % offset").toBeUndefined();
    for (const r of runPair(56, 56)) expect(r.hubsPopped.length, `2×56 head-on popped ${r.hubsPopped.join(",")}`).toBeLessThan(2);
    const [struck] = runPair(0, 50, "t-bone");
    expect(struck.hubsPopped, "T-bone struck car").toHaveLength(0);
  });
});

describe("given a corner crushed to within 0.12 m of its wheel hub", () => {
  it("when cars hit head-on at 2×80 km/h, then both front wheels come off both cars, whereas a full-width wall at 56 or 64 km/h or a 2×56 km/h head-on takes none off", () => {
    for (const r of runPair(80, 80)) expect(firstMismatch(r.hubsPopped, ["hubFL", "hubFR"]), "2×80 head-on").toBeUndefined();
    for (const r of runPair(56, 56)) expect(r.hubsPopped, "2×56 head-on").toHaveLength(0);
    for (const kph of [56, 64]) expect(runWall(kph).hubsPopped, `${kph} km/h full-width wall`).toHaveLength(0);
  });
});

describe("given an engine block made of a left and a right half", () => {
  it("when a car hits a wall at 56 km/h with a 40 % offset, and a car is T-boned at 50 km/h, then the halves stay within 1.2 cm of their rest spacing on the offset-hit car and on both T-bone cars", () => {
    const [struck, bullet] = runPair(0, 50, "t-bone");
    for (const [name, r] of [["offset56", runWall(56, 0.4)], ["struck", struck], ["bullet", bullet]] as const) {
      expect(r.engineGapErr, `${name}: engineL–engineR off their rest spacing by ${r.engineGapErr.toFixed(3)} m`).toBeLessThanOrEqual(0.012);
    }
  });
});

describe("given a car's glass panes, which break from their frame's distortion", () => {
  const glassAfter = (kph: number, approach: "front" | "side", car = makeCar()): string[] => {
    runWall(kph, 1, approach, { car });
    return car["glassPanes"].map((g) => g.state);
  };
  // Pane order (addGlass): 0 windscreen, 1 rear glass, 2/3 door glass L/R, 4/5 quarter glass L/R.
  it("when a car taps a wall at 15 km/h, then every pane stays intact: a frame that has not moved breaks no glass", () => {
    expect(glassAfter(15, "front").join()).toBe("intact,intact,intact,intact,intact,intact");
  });

  // 50 km/h, not 56: at 56 the drivetrain dies and the driver is thrown through the windscreen, which smashes it (the ejection rows own that).
  it("when a car hits a wall at 20, 35 and 50 km/h, and is hit on its left at 50 km/h, then 20 and 35 leave every pane intact, the 50 km/h wall cracks the windscreen and leaves the doors' glass whole with no driver thrown out, and the side hit shatters the windscreen, the rear glass and the left door's glass but not the right's", () => {
    expect(glassAfter(20, "front").join(), "20 km/h wall").toBe("intact,intact,intact,intact,intact,intact");
    expect(glassAfter(35, "front").join(), "35 km/h wall").toBe("intact,intact,intact,intact,intact,intact");
    const car = makeCar();
    const hard = glassAfter(50, "front", car);
    expect(car.driverOut, "50 km/h wall: the driver stayed in").toBe(null);
    expect([hard[0], hard[2], hard[3]].join(), "50 km/h wall: windscreen, door glass L/R").toBe("cracked,intact,intact");
    const side = glassAfter(50, "side");
    expect(side.slice(0, 4).join(), "50 km/h left side hit: windscreen, rear, door glass L/R").toBe("shattered,shattered,shattered,intact");
  });

  it("when the same 50 km/h side hit runs with the glass breaking and with it never breaking, then every mass and every cage corner ends bit-identical: the panes hold nothing back", () => {
    const breaking = makeCar();
    const unbreakable = makeCar();
    unbreakable.deform.glassDistortion = () => 0;
    expect(glassAfter(50, "side", breaking).filter((s) => s === "shattered").length, "the hit broke the glass").toBe(4);
    expect(glassAfter(50, "side", unbreakable).join(), "the glass never broke").toBe("intact,intact,intact,intact,intact,intact");
    let worst = 0;
    const ma = breaking.deform["masses"];
    const mb = unbreakable.deform["masses"];
    for (let i = 0; i < ma.length; i++) worst = Math.max(worst, ma[i]!.local.distanceTo(mb[i]!.local), ma[i]!.world.distanceTo(mb[i]!.world));
    const ca = breaking.deform["cages"];
    const cb = unbreakable.deform["cages"];
    for (let i = 0; i < ca.length; i++) for (let k = 0; k < 8; k++) worst = Math.max(worst, ca[i]!.corners[k]!.distanceTo(cb[i]!.corners[k]!));
    expect(worst).toBe(0);
  });
});

/** Share of the stroke both noses use before the pair goes rigid (pair-contact's `PACKED_STROKE`). */
const PACKED = 0.9;
/** How far (share of the stroke) the stop may land from `PACKED`: the slice's travel is predicted from the masses' speeds, not stepped. */
const PACKED_TOL = 0.015;

describe("given two cars driving head-on at each other, with the squash setting at 0.32", () => {
  it("when each car drives at 40, 56, 64 or 100 km/h, then their tyres never overlap by more than 1 cm and no part jumps farther than 3·v·h + 5 cm in a physics step (v the speed, h the step); below 100 km/h no wheel pops off, and at 56 km/h the nose crushes 0.25–0.50 m", () => {
    for (const kph of [40, 56, 64, 100]) {
      for (const r of runPair(kph, kph, "head-on", { squash: 0.32 })) {
        expect(r.tyreOverlap, `${kph} km/h head-on: tyres overlap ${r.tyreOverlap.toFixed(3)} m`).toBeLessThanOrEqual(0.01);
        if (kph < 100) expect(r.hubsPopped.length, `${kph} km/h head-on popped ${r.hubsPopped.join(",")}`).toBe(0);
        // No mass steps past 3·v·h + 5 cm in a slice: not through the hit, its springback, or the stopped wreck levelling out.
        expect(r.massStepExcess, `${kph} km/h head-on: ${r.massStepName} stepped ${r.massStepExcess.toFixed(3)} m past 3·v·h + 5 cm in a slice`).toBeLessThanOrEqual(0);
        // The stop is the last limit, not a shorter crumple: 56 km/h stays in the 0.25–0.50 m nose band.
        if (kph === 56) expect(r.noseShortL >= 0.25 && r.noseShortL <= 0.5, `56 km/h nose ${r.noseShortL.toFixed(3)} m`).toBeTruthy();
      }
    }
  });

  // The pair goes rigid when both noses have used `PACKED_STROKE` (0.9) of the stroke; the slice that crosses it splits its exchange there
  // (`splitExchange`), so the stop does not land up to one slice's travel past it.
  it("when each car's speed rises through 100, 115, 130, 150, 180 and 200 km/h, then each pair stops with both noses within 0.015 of 0.9 of their stroke used, and each pair's mean nose crush is never more than 5 % below that of the slower pair before it", () => {
    let prev = 0;
    for (const kph of [100, 115, 130, 150, 180, 200]) {
      const [a, b] = runPair(kph, kph, "head-on", { squash: 0.32 });
      for (const r of [a, b]) expect(Math.abs(r.strokePeak - PACKED), `${kph} km/h head-on: the pair stopped at ${r.strokePeak.toFixed(3)} of the stroke`).toBeLessThanOrEqual(PACKED_TOL);
      const nose = (a.noseShortL + b.noseShortL) / 2;
      expect(nose, `${kph} km/h head-on: mean nose ${nose.toFixed(3)} m after ${prev.toFixed(3)} m at the slower speed`).toBeGreaterThanOrEqual(prev * 0.95);
      prev = nose;
    }
  });
});

describe("given a car hitting a wall or being hit from the side, until the stopped wreck levels out", () => {
  it("when a car hits at 64 km/h full-width, at 64 km/h with a 40 % offset, and at 56 km/h side-on, then no part jumps farther than 3·v·h + 5 cm in a physics step (v the speed, h the step)", () => {
    for (const [label, r] of [
      ["64 full", runWall(64)],
      ["64 offset", runWall(64, 0.4)],
      ["56 side", runWall(56, 1, "side")],
    ] as const) {
      expect(r.massStepExcess, `${label}: ${r.massStepName} stepped ${r.massStepExcess.toFixed(3)} m past 3·v·h + 5 cm in a slice`).toBeLessThanOrEqual(0);
    }
  });
});

/** 50 km/h T-bone (runPair's layout): the struck door's deepest intrusion in the first 0.3 s of
 *  contact, and the least gap (m) between the bullet's cell and the struck cell along the travel. */
function tbone(squash: number): { door: number; gap: number } {
  const a = makeCar("shape", squash);
  const b = makeCar("shape", squash);
  for (const [c, x, yaw, vx] of [[a, 0, 0, 0], [b, 6, -Math.PI / 2, -50 / 3.6]] as const) {
    c.spawnFacing(x, 0, yaw, 0);
    c.velocity.set(vx, 0, 0);
    c.deform.bindKinematic(c.group, c.velocity, c.angular);
  }
  const w = makeWorld([a, b], false, false, FREEWHEEL);
  w.pedals.set(a, PARKED);
  let door = 0;
  let gap = Infinity;
  let since = -1;
  for (let f = 0; f < 150; f++) {
    tickWorld(w);
    if (since < 0 && a.crashed) since = 0;
    if (since < 0 || !a.deform.massActive || !b.deform.massActive) continue;
    since += 1 / FRAME_HZ;
    if (since <= 0.3) door = Math.max(door, closedOn(mass(a.deform, "doorR"), mass(a.deform, "cell"), "x"));
    gap = Math.min(gap, mass(b.deform, "cell").world.x - mass(a.deform, "cell").world.x);
  }
  return { door, gap };
}

describe("given a 50 km/h T-bone, a car driving into the side of a stationary car", () => {
  // CRUSH_CALIBRATION tbone50 band (IIHS side 50 km/h): struck-door intrusion 0.12–0.28 m. Car-car
  // contact stopped the bullet's nose dead while the struck car got no momentum: door 0.01 m in the
  // impact; without the in-contact ground drag the bullet then drove through the struck car (its cell
  // 3.6–5 m past), and that pass-through was the 0.26 m "door" the calibration once recorded.
  it("when the cars run with the squash setting at 0.32 and at 0.4, then within 0.3 s of contact the struck door is pushed in 0.12–0.28 m and the striking car's cabin never gets within 0.9 m of the struck car's cabin", () => {
    for (const squash of [0.32, 0.4]) {
      const { door, gap } = tbone(squash);
      expect(door >= 0.12 && door <= 0.28, `squash ${squash}: door ${door.toFixed(3)} m in the impact`).toBeTruthy();
      expect(gap, `squash ${squash}: bullet cell ${gap.toFixed(2)} m from the struck cell`).toBeGreaterThan(0.9);
    }
  });
});

/** Share of a deep crush a part keeps 1 s after its deepest: real structure keeps 75-90 % of its peak, the rest springs back. */
const KEPT_SHARE = 0.75;
/** A crush this deep (m) is the structure's, not a skin dent's: the row's premise. */
const DEEP_CRUSH = 0.1;
/** How far (m) a part away from the dent may end off its rest: the body does not roll or lean onto the dent. */
const FAR_SIDE_OFF = 0.03;

/** Mass `name`'s crush (m): how far it sits from its rest place, against the cell. */
function crushOf(car: DeformableCar, name: string): number {
  const m = mass(car.deform, name);
  const c = mass(car.deform, "cell");
  return Math.hypot(m.local.x - m.rest.x - c.local.x + c.rest.x, m.local.y - m.rest.y - c.local.y + c.rest.y, m.local.z - m.rest.z - c.local.z + c.rest.z);
}

/**
 * The ejection matrix's 50 km/h T-bone, a sedan's nose into a parked police car's right door, for 3 s: each watched part's deepest
 * crush and its crush 1 s later, and how far the struck car's far door and roof end off their rest.
 */
function sideHit(): { parts: { name: string; peak: number; later: number }[]; farDoor: number; roof: number } {
  const striker = classCar("sedan");
  const struck = classCar("police");
  launch(struck, 0, 0, 0, 0, 0);
  launch(striker, 6, 0, -Math.PI / 2, -50 / 3.6, 0);
  const w = makeWorld([striker, struck], false, false, null);
  const watch = [
    { car: struck, name: "doorR", peak: 0, at: 0, later: 0 },
    { car: striker, name: "bumperFL", peak: 0, at: 0, later: 0 },
    { car: striker, name: "bumperFR", peak: 0, at: 0, later: 0 },
  ];
  let t = 0;
  while (t < 3) {
    tickWorld(w);
    t += w.clock.timeScale / FRAME_HZ;
    for (const p of watch) {
      const d = crushOf(p.car, p.name);
      if (d > p.peak) {
        p.peak = d;
        p.at = t;
      }
      if (t <= p.at + 1) p.later = d;
    }
  }
  const parts = watch.map((p) => ({ name: `${p.car === struck ? "struck" : "striker"} ${p.name}`, peak: p.peak, later: p.later }));
  const out = { parts, farDoor: mass(struck.deform, "doorL").local.distanceTo(mass(struck.deform, "doorL").rest), roof: mass(struck.deform, "roof").local.distanceTo(mass(struck.deform, "roof").rest) };
  striker.dispose();
  struck.dispose();
  return out;
}

describe("given a 50 km/h side hit, a sedan's nose into a parked police car's right door", () => {
  it("when 1 s has passed since each part's deepest crush, then the struck door and the striker's front corners each keep at least 75 % of it, and the struck car's far door and roof end within 3 cm of their rest", () => {
    const r = sideHit();
    for (const p of r.parts) {
      expect(p.peak, `${p.name}: crushed only ${p.peak.toFixed(3)} m`).toBeGreaterThan(DEEP_CRUSH);
      expect(p.later, `${p.name}: ${p.peak.toFixed(3)} m at the deepest, ${p.later.toFixed(3)} m 1 s later`).toBeGreaterThanOrEqual(KEPT_SHARE * p.peak);
    }
    expect(r.farDoor, `far door ${r.farDoor.toFixed(3)} m off rest`).toBeLessThanOrEqual(FAR_SIDE_OFF);
    expect(r.roof, `roof ${r.roof.toFixed(3)} m off rest`).toBeLessThanOrEqual(FAR_SIDE_OFF);
  });
});

/** The owner's "wrecks spin on the spot" capture (16-car fleet, shape mode): [paint, x, z, yaw, speed]. */
const SPIN_FLEET: [string, number, number, number, number][] = [
  ["Titanium", 20.8638, -8.1178, -1.1997, 28.513],
  ["Petrol", 23.6128, -13.4449, -1.0532, 14.733],
  ["Oxide", -2.6618, 25.8978, 3.0392, 19.6],
  ["Ink", 4.7018, -10.6017, -0.4174, 8.143],
  ["Bronze", 16.9026, 1.0423, -1.6324, 28.182],
  ["Moss", 7.1054, -21.5383, -0.3187, 9.485],
  ["Sand", -5.053, -23.6293, 0.2107, 10.532],
  ["Slate", -22.967, -17.576, 0.9176, 6.567],
  ["Ash", -18.2872, 7.1024, 1.9412, 8.595],
  ["Coal", 9.5697, -3.1629, -1.2516, 15.037],
  ["Khaki", -11.9963, 3.9944, 1.8922, 24.795],
  ["Teal", 11.3389, 15.7196, -2.5167, 17.877],
  ["Titanium-2", 0.1981, 17.6727, -3.1304, 8.599],
  ["Petrol-2", -1.1815, -12.542, 0.0939, 6.018],
  ["Oxide-2", 6.4505, 4.0158, -2.1276, 21.422],
  ["Ink-2", -24.5784, 5.4783, 1.7901, 24.339],
];

describe("given the recorded 16-car pile-up in which wrecks spun on the spot, in shape deform mode", () => {
  it("when it runs for 6 s, then no wreck is still turning at the end: each turns less than 0.1 rad over the last 2 s", () => {
    const cars = SPIN_FLEET.map(([name, x, z, yaw, speed], i) => {
      const car = new DeformableCar({ body: 0xffffff, accent: 0x444444, name }, new THREE.Scene(), null, fleetStyle(i));
      car.deform.setMode("shape");
      car.spawnFacing(x, z, yaw, 0);
      car.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
      car.speed = speed;
      car.spawnSpeed = speed;
      car.deform.bindKinematic(car.group, car.velocity, car.angular);
      return car;
    });
    const w = makeWorld(cars, false, false);
    const turn = cars.map(() => 0);
    const prev = cars.map((c) => c.group.rotation.y);
    for (let f = 0; f < 6 * 60; f++) {
      tickWorld(w);
      for (const [i, c] of cars.entries()) {
        const d = c.group.rotation.y - prev[i]!;
        prev[i] = c.group.rotation.y;
        if (f >= 4 * 60) turn[i]! += Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      }
    }
    const worst = turn.indexOf(Math.max(...turn));
    expect(turn[worst]!, `${SPIN_FLEET[worst]![0]} turned ${turn[worst]!.toFixed(2)} rad in the last 2 s, |ω| ${cars[worst]!.angular.y.toFixed(2)}`).toBeLessThan(0.1);
  });

  // todo -> Stage 5 (item 6's wreck split left Khaki at 5.85 rad/s), the same cause as derby-ai's contact peaks. Measured (SPIN_FLEET at squash 0.4) before item 6: Khaki 5.48 rad/s over 0.1 s (Bronze 7.29 with the
  // pair's friction off, Khaki 6.16 and 7.20 with the one-body motion and the kill subtraction off: no toggle of the kernel's terms removes it); the
  // last-2-s row above (no wreck still turning) passes. A pile's wreck struck at a lever spins by J·lever/I; the yaw grip that ends it is the wreck split's.
  todoRow("when the squash setting is 0.4 and the buckle setting 0.45, then no wreck turns faster than 5 rad/s over any 0.1 s of the first 2.5 s", "Khaki 5.32 rad/s over 0.1 s in the 16-car pile (bar 5; its nose struck Oxide-2 off its axis; lever torque of the pair kernel; the wreck's yaw grip is the tyres'): Stage 5", () => {
    const cars = SPIN_FLEET.map(([name, x, z, yaw, speed], i) => {
      const car = new DeformableCar({ body: 0xffffff, accent: 0x444444, name }, new THREE.Scene(), null, fleetStyle(i));
      car.deform.setMode("shape");
      car.deform.squash = 0.4;
      car.deform.buckle = 0.45;
      car.spawnFacing(x, z, yaw, 0);
      car.velocity.set(Math.sin(yaw) * speed, 0, Math.cos(yaw) * speed);
      car.speed = speed;
      car.spawnSpeed = speed;
      car.deform.bindKinematic(car.group, car.velocity, car.angular);
      return car;
    });
    const w = makeWorld(cars, false, false);
    const yaws = cars.map(() => [] as number[]);
    const peak = cars.map(() => 0);
    for (let f = 0; f < 2.5 * 60; f++) {
      tickWorld(w);
      for (const [i, c] of cars.entries()) {
        const h = yaws[i]!;
        h.push(c.group.rotation.y);
        if (h.length > 6) {
          const d = h[h.length - 1]! - h[h.length - 7]!;
          peak[i] = Math.max(peak[i]!, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 10);
        }
      }
    }
    const worst = peak.indexOf(Math.max(...peak));
    expect(peak[worst]!, `${SPIN_FLEET[worst]![0]} turned at ${peak[worst]!.toFixed(2)} rad/s over 0.1 s`).toBeLessThanOrEqual(5);
  });
});

/** A wreck at (x, z) heading `yaw`, moving at (vx, v) m/s (v along +z), its masses armed by a light knock. */
function slidingWreck(z: number, v: number, yaw = 0, x = 0, vx = 0): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene());
  car.deform.setMode("shape");
  car.spawnFacing(x, z, yaw, 0);
  car.velocity.set(vx, 0, v);
  car.speed = Math.hypot(vx, v);
  car.deform.bindKinematic(car.group, car.velocity, car.angular);
  car.applyImpact(car.group.localToWorld(new THREE.Vector3(0.7, 0.4, 2.2)), car.forward.clone().negate(), 2, 2);
  return car;
}

/** Mass-weighted speed (m/s) of every mass of `cars` together. */
function groupSpeed(cars: DeformableCar[]): number {
  let px = 0;
  let pz = 0;
  let m = 0;
  for (const c of cars) {
    for (const p of c.deform.masses) {
      px += p.vel.x * p.mass;
      pz += p.vel.z * p.mass;
      m += p.mass;
    }
  }
  return Math.hypot(px, pz) / m;
}

/** Mean deceleration (m/s²) of `cars` over `secs` of engine ticks, after the impact clock has run. */
function slideDecel(cars: DeformableCar[], secs: number): number {
  const w = makeWorld(cars, false, false);
  w.clock.phase = "slowmo";
  w.clock.wallSinceImpact = 1;
  for (let f = 0; f < 12; f++) tickWorld(w);
  const v0 = groupSpeed(cars);
  for (let f = 0; f < secs * 60; f++) tickWorld(w);
  return (v0 - groupSpeed(cars)) / secs;
}

/** A wreck on its drive's coast stops in 0.4-0.6 s: a longer window would read the speed it started with, not a rate. */
const GRIND_S = 0.15;

describe("given crashed wrecks sliding to a stop on the ground", () => {
  // Owner dump: a pair of wrecks grinding together slid at 0.44 g against 1.4–1.8 g alone: the mass
  // drag waited for the car-contact quiet timer, which the rubbing kept resetting.
  it("when two wrecks grind together, one's nose on the other's side, both sliding along, then they slow down at least as fast as one wreck alone, within 15 %", () => {
    const lone = slideDecel([slidingWreck(0, 10)], GRIND_S);
    // T-bone grind: the faster wreck's nose on the slower one's side, both sliding along +z.
    const pair = slideDecel([slidingWreck(-4, 11), slidingWreck(0, 9, Math.PI / 2)], GRIND_S);
    expect(pair, `pair ${(pair / 9.81).toFixed(2)} g vs alone ${(lone / 9.81).toFixed(2)} g`).toBeGreaterThanOrEqual(lone * 0.85);
  });
});

describe("given two overlapping wrecks in shape deform mode, one resting and one sliding at 6 m/s along z and 4 m/s toward it", () => {
  it("when they scrape flank to flank for one frame, then the pair kernel reports the contact and the resting wreck takes over 60 kg·m/s of the slide through friction", () => {
    const a = slidingWreck(0, 0);
    const b = slidingWreck(0, 6, 0, 1.5, -4);
    const w = makeWorld([a, b], false, false, null);
    let reported = false;
    w.world.pairHit = () => {
      reported = true;
    };
    tickWorld(w);
    const pz = a.deform.masses.reduce((s, m) => s + m.vel.z * m.mass, 0);
    expect(reported, "overlapping wrecks are a contact the pair kernel reports (`World.pairHit`)").toBeTruthy();
    expect(pz, `the struck wreck took ${pz.toFixed(1)} kg·m/s of the 6 m/s slide`).toBeGreaterThan(60);
  });
});

describe("given a crashed car yawing at 2 rad/s, with a door glass pane hung off its centre", () => {
  it("when the pane shatters, then the shard leaves with the pane's own velocity, to within 5 %, and the pane is moving faster than 0.5 m/s", () => {
    let shard: THREE.Vector3 | null = null;
    const car = new DeformableCar(paint(), new THREE.Scene(), (_o, v) => {
      shard = v.clone();
    });
    car.spawnFacing(0, 0, 0.3, 0);
    car.crashed = true;
    car.velocity.set(0, 0, 0);
    car.angular.set(0, 2, 0);
    car.group.updateMatrixWorld(true);
    // A pane hung off the body's centre (door glass), so ω × r is not zero.
    const pane = car["glassPanes"].find((g) => g.mesh.getWorldPosition(new THREE.Vector3()).distanceTo(car.group.position) > 0.5)!;
    const p0 = pane.mesh.getWorldPosition(new THREE.Vector3());
    car["shatterGlass"](pane);
    const h = 1e-4;
    car.integrate(h);
    car.group.updateMatrixWorld(true);
    const fd = pane.mesh.getWorldPosition(new THREE.Vector3()).sub(p0).divideScalar(h);
    const v = shard as THREE.Vector3 | null;
    must(v, "no shard burst");
    const err = Math.hypot(v.x - fd.x, v.z - fd.z);
    expect(Math.hypot(fd.x, fd.z), `pane barely moves (${fd.x.toFixed(2)},${fd.z.toFixed(2)})`).toBeGreaterThan(0.5);
    expect(err, `shard v=(${v.x.toFixed(2)},${v.z.toFixed(2)}) pane v=(${fd.x.toFixed(2)},${fd.z.toFixed(2)})`).toBeLessThan(0.05 * Math.hypot(fd.x, fd.z));
  });
});

describe("given a car with a drive speed of 0 m/s and a real velocity of (24, 0, -7) m/s", () => {
  it("when the speed of the physics slice is read, then it is 25 m/s, the wreck's real speed, not its stale drive speed", () => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    car.speed = 0;
    car.velocity.set(24, 0, -7);
    expect(sliceSpeed([car])).toBe(25);
  });
});

describe("given a debris piece sliding along the ground at 6 m/s", () => {
  it("when it slides for 0.5 s at 60 Hz and again at 240 Hz, then it ends within 5 % of the same distance both times, so it loses the same speed per second at either rate", () => {
    const slide = (hz: number) => {
      const debris = new DebrisSystem(new THREE.Scene(), 1);
      debris.burst(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0, -1), 1);
      debris["vx"][0] = 6;
      debris["vy"][0] = 0;
      debris["vz"][0] = 0;
      debris["life"][0] = 10;
      for (let i = 0; i < hz * 0.5; i++) debris.update(1 / hz);
      return debris.snapshot().items[0]!.x;
    };
    const x60 = slide(60);
    const x240 = slide(240);
    expect(Math.abs(x60 - x240), `0.5 s slide: ${x60.toFixed(3)} m at 60 Hz vs ${x240.toFixed(3)} m at 240 Hz`).toBeLessThan(0.05 * x240);
  });
});

describe("given a debris system with room for 16 pieces, after a burst of 10 pieces has flown for 0.1 s", () => {
  it("when a second burst of 3 pieces is fired, then 13 pieces are live and the first burst's 10 pieces stay where they flew instead of being cut or teleported", () => {
    const debris = new DebrisSystem(new THREE.Scene(), 16);
    debris.burst(new THREE.Vector3(5, 0, 0), new THREE.Vector3(0, 0, -1), 10);
    debris.update(0.1);
    debris.burst(new THREE.Vector3(-5, 0, 0), new THREE.Vector3(0, 0, -1), 3);
    const items = debris.snapshot().items;
    expect(items.length, "live pieces after a 10 then a 3 burst").toBe(13);
    expect(items.filter((p) => p.x > 2).length, "the first burst's pieces stay where they flew").toBe(10);
  });
});

describe("given a debris system of 8 pieces whose first piece is nearly spent", () => {
  it("when it runs for six 1/60 s steps, then the spent piece is no longer drawn (scale 0), the live pieces have differing scales, and pieces 1 and 2 have different rotations", () => {
    const debris = new DebrisSystem(new THREE.Scene(), 8);
    debris.burst(new THREE.Vector3(), new THREE.Vector3(0, 0, -1), 8);
    debris["life"][0] = 0.05;
    for (let i = 0; i < 6; i++) debris.update(1 / FRAME_HZ);
    const m = new THREE.Matrix4();
    const col = new THREE.Vector3();
    const qs = [0, 1, 2].map(() => new THREE.Quaternion());
    const scales: number[] = [];
    for (let i = 0; i < 8; i++) {
      debris["mesh"].getMatrixAt(i, m);
      scales.push(col.setFromMatrixColumn(m, 0).length());
      qs[Math.min(i, 2)]!.setFromRotationMatrix(m.extractRotation(m.clone()));
    }
    expect(scales[0], "spent piece 0 is still drawn").toBe(0);
    expect(new Set(scales.slice(1).map((x) => x.toFixed(4))).size, `every live piece has scale ${scales[1]}`).toBeGreaterThan(1);
    expect(qs[1]!.angleTo(qs[2]!), "pieces 1 and 2 share one rotation").toBeGreaterThan(0.01);
  });
});

forModes("given two cars overlapping head-on, each driving into the other", (mode) => {
  it("when they stay in contact for 20 frames, then neither car is thrown off the map (under 40 m from the origin), neither exceeds 60 m/s and none of their parts ends up NaN or past 60 m/s", () => {
    const scene = new THREE.Scene();
    const a = new DeformableCar(paint(), scene);
    const b = new DeformableCar(paint(), scene);
    a.deform.setMode(mode);
    b.deform.setMode(mode);
    a.spawn(0, 0, 18);
    b.spawn(0, 8, 18);
    a.group.updateMatrixWorld();
    b.group.updateMatrixWorld();
    const hit = a.group.position.clone().lerp(b.group.position, 0.5);
    hit.y = 0.4;
    const inward = b.group.position.clone().sub(a.group.position).setY(0).normalize();
    a.applyImpact(hit, inward, 30, 15);
    b.applyImpact(hit, inward.clone().negate(), 30, 15);
    for (let i = 0; i < 20; i++) {
      a.deform.notifyContact();
      b.deform.notifyContact();
      a.deform.feedOverlap(hit, inward, 0.12, 16, DT);
      b.deform.feedOverlap(hit, inward.clone().negate(), 0.12, 16, DT);
      a.deform.stepStructure(DT);
      b.deform.stepStructure(DT);
      a.syncPose(DT);
      b.syncPose(DT);
      a.stepBreakage(DT);
      b.stepBreakage(DT);
      a.updateSkin();
      b.updateSkin();
    }
    for (const car of [a, b]) {
      expect(car.group.position.length(), `${mode} group ${car.group.position.toArray()}`).toBeLessThan(40);
      expect(car.velocity.length(), `${mode} vel ${car.velocity.length()}`).toBeLessThan(60);
      for (const m of car.deform.masses) {
        expect(Number.isFinite(m.world.x + m.vel.z), `${m.name} NaN`).toBeTruthy();
        expect(m.vel.length(), `${m.name} ${m.vel.length()}`).toBeLessThan(60);
      }
    }
  });
});

describe("given particle positions read through snapshotPoints (the reader of debris positions)", () => {
  it("when one sample is dead and the other alive, then only the live one is reported, at a height of at least 0", () => {
    const pos = new Float32Array([1, 0.2, 2, 3, 250, 4]);
    const life = new Float32Array([0.4, 0]);
    const snap = snapshotPoints(pos, null, null, life, true);
    expect(snap.items.length).toBe(1);
    expect(snap.items[0]!.y).toBeGreaterThanOrEqual(0);
  });

  it("when a sample whose lifetime is still running sits at y = 250 (the height dead particles are parked at), then it is not reported as a live particle", () => {
    const pos = new Float32Array([0, 250, 0]);
    const life = new Float32Array([0.5]);
    const snap = snapshotPoints(pos, null, null, life, true);
    expect(snap.items.length).toBe(0);
  });
});

describe("given two cars driving head-on at each other, in shape deform mode", () => {
  const slow = runPair(28, 28);
  const fast = runPair(56, 56);
  const nose = (r: (typeof slow)[number]) => Math.max(r.noseMaxL, r.noseMaxR);

  const headOnNoseCrushCases = [
    { it: "when each car drives at 28 km/h, then each nose crushes between 0.15 and 0.40 m", speed: "slow", min: 0.15, max: 0.4 },
    { it: "when each car drives at 56 km/h, then each nose crushes between 0.35 and 0.70 m", speed: "fast", min: 0.35, max: 0.7 },
  ] as const;

  for (const testCase of headOnNoseCrushCases) {
    it(testCase.it, () => {
      for (const r of { slow, fast }[testCase.speed]) expect(nose(r) >= testCase.min && nose(r) <= testCase.max, `nose ${nose(r).toFixed(3)}`).toBeTruthy();
    });
  }

  it("when the speed doubles from 28 to 56 km/h each, then each car's nose crushes more than 1.4 times deeper", () => {
    for (let i = 0; i < 2; i++) expect(nose(fast[i]!), `56=${nose(fast[i]!).toFixed(3)} 28=${nose(slow[i]!).toFixed(3)}`).toBeGreaterThan(1.4 * nose(slow[i]!));
  });

  // The thrown-driver rows stage this hit as the one that kills both engines (`ragdoll-trigger`): with the contact hull's decimation
  // changed (lid outlines held over its budget) the noses crushed 0.267 m, not 0.549, and both engines lived.
  it("when each car drives at 56 km/h, then both engines are pushed back far enough to die", () => {
    for (const [i, r] of fast.entries()) expect(r.drivetrainAlive, `car ${i}: engine pushed back ${r.engineMax.toFixed(3)} m, nose ${nose(r).toFixed(3)} m`).toBe(false);
  });

  // The pair's stop lands the packed nose within a slice of PACKED_STROKE and the structure then springs it back by a few mm, a landing that moves
  // with the slice the stop falls in: the block's travel is the hit's energy once it packs, so it rises with speed through the kill window.
  it("when each car drives at 54.5, 55, 55.5, 56 and 56.5 km/h, then the engine block travels farther the faster they meet, and both engines die at 56", () => {
    let slower = 0;
    for (const kph of [54.5, 55, 55.5, 56, 56.5]) {
      const [r] = runPair(kph, kph);
      expect(r.engineTravel, `${kph} km/h: engine block ${r.engineTravel.toFixed(4)} m, the slower pair's ${slower.toFixed(4)} m`).toBeGreaterThan(slower);
      slower = r.engineTravel;
      if (kph === 56) expect(r.drivetrainAlive, `56 km/h: engine pushed back ${r.engineTravel.toFixed(4)} m`).toBe(false);
    }
  });

  it("when they hit at 28 km/h each with full overlap, then the impact point stays within 0.2 m of the centre line on both cars", () => {
    for (const r of slow) expect(Math.abs(r.impactLocalX), `impactLocal.x=${r.impactLocalX.toFixed(3)}`).toBeLessThan(0.2);
  });

  it("when the 2×56 km/h head-on is run in slow motion, then each nose's shortening is within 15 % of the full-speed head-on's, on both cars", () => {
    const slomo = runPair(56, 56, "head-on", { slomo: true });
    for (let i = 0; i < 2; i++) {
      for (const k of ["noseShortL", "noseShortR"] as const) {
        const ratio = slomo[i]![k] / fast[i]![k];
        expect(Math.abs(ratio - 1), `car ${i} ${k}: slomo ${slomo[i]![k].toFixed(3)} vs full ${fast[i]![k].toFixed(3)}`).toBeLessThanOrEqual(0.15);
      }
    }
  });
});

describe("given a car hitting a wall at 64 km/h with a 40 % offset", () => {
  // The slab's cabin floor read the struck corner's current length: a corner springing back off the face moved
  // the floor out, its push stretched the nose further, and in slow motion (faster spring-back per sim second)
  // that ran away: R nose 0.330 → 0.255 in 7 ms of sim time (R 0.272 vs 0.330). `slabTravel` keeps the hit's low mark.
  it("when the hit is run in slow motion, then each nose's shortening is within 15 % of the full-speed hit's", () => {
    const full = runWall(64, 0.4);
    const slow = runWall(64, 0.4, "front", { slomo: true });
    for (const k of ["noseShortL", "noseShortR"] as const) {
      expect(Math.abs(slow[k] / full[k] - 1), `${k}: slomo ${slow[k].toFixed(3)} vs full ${full[k].toFixed(3)}`).toBeLessThanOrEqual(0.15);
    }
  });
});

describe("given a car's glass panes, named for ragdoll ejection (a thrown-out driver)", () => {
  it("when a door pane is smashed, then that pane alone breaks, once, with a shard burst at the car, and the windscreen and doors are found on their own sides of the car", () => {
    const bursts: THREE.Vector3[] = [];
    const car = new DeformableCar(paint(), new THREE.Scene(), (origin) => bursts.push(origin.clone()));
    car.spawn(4, 9, 0);
    const at = (name: "windshield" | "doorL" | "doorR") => car.group.worldToLocal(car.glassWorld(name, new THREE.Vector3()));
    const doorsZ = Math.max(at("doorL").z, at("doorR").z);
    expect(at("windshield").z > doorsZ && Math.abs(at("windshield").x) < 0.05, `windshield at ${at("windshield").toArray()}, ahead of the door panes at z ${doorsZ}`).toBeTruthy();
    expect(at("doorL").x < -0.6 && at("doorR").x > 0.6, `doors at ${at("doorL").x} / ${at("doorR").x}`).toBeTruthy();
    expect(car.smashGlass("doorL")).toBe(true);
    expect(car.smashGlass("doorL"), "a shattered pane smashed twice").toBe(false);
    const { glass } = car.snapshot();
    must(Array.isArray(glass), "the car's snapshot lists its glass");
    expect(firstMismatch(glass, ["intact", "intact", "shattered", "intact", "intact", "intact"]), "glass pane states").toBeUndefined();
    expect(bursts.length).toBe(1);
  });
});
