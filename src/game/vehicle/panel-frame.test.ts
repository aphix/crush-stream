import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import type { DetachPart } from "./car-core.ts";
import { assignClass, CLASSES, type VehicleClassId } from "./vehicle-classes.ts";
import { PANEL_NAMES } from "./car-panels.ts";
import { newWorld, stepWorld } from "../engine/world-step.ts";
import { assertSameNumbers, DT, paint } from "./test-support.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/**
 * A hinged panel's shell is drawn where its patch of body is: in the body's own frame, which carries the class lift,
 * the suspension pose and a lost wheel's sag. A torn shell starts from where it hung.
 */

class Probe extends DeformableCar {
  part(name: string): DetachPart {
    return this.parts.find((p) => p.name === name)!;
  }
  /** Hinge the panel to `t` through the game's own posing. */
  hang(name: string, t: number): DetachPart {
    const p = this.part(name);
    p.hingeT = t;
    this.posePart(p);
    return p;
  }
  tear(name: string): void {
    this.detachPart(this.part(name), 20);
  }
}

const HUBS = ["hubFL", "hubFR", "hubRL", "hubRR"] as const;

/** A wreck of class `cls` that has lost wheel `lost` (if any) and settled on it for 3 s. */
function wreck(cls: VehicleClassId, lost: number | null): Probe {
  const car = new Probe(paint(), new THREE.Scene(), null, CLASSES[cls].style);
  car.deform.setMode("shape");
  assignClass(car, cls);
  car.spawnFacing(0, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  car.applyImpact(car.group.position.clone().addScaledVector(car.forward, 2.05), car.forward.clone().negate(), 0.5, 0.5);
  if (lost !== null) car.deform.popHub(car.deform.masses.find((m) => m.name === HUBS[lost])!);
  const w = newWorld([car]);
  for (let f = 0; f < 180; f++) {
    stepWorld(w, DT);
    car.stepBreakage(DT);
    car.updateSkin();
  }
  car.group.updateMatrixWorld(true);
  return car;
}

/** Where a mesh's vertices (all, or only `verts`) are in the world, averaged. */
function centre(mesh: THREE.Mesh, verts?: readonly number[]): THREE.Vector3 {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.getAttribute("position");
  const ids = verts ?? Array.from({ length: pos.count }, (_, k) => k);
  const sum = new THREE.Vector3();
  for (const k of ids) sum.add(new THREE.Vector3().fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld));
  return sum.divideScalar(ids.length);
}

const CASES: readonly { cls: VehicleClassId; lost: number | null }[] = [
  { cls: "sedan", lost: null },
  { cls: "sedan", lost: 0 },
  { cls: "sedan", lost: 3 },
  { cls: "truck", lost: null },
  { cls: "truck", lost: 1 },
  { cls: "monster", lost: null },
  { cls: "monster", lost: 2 },
];

describe("given a wreck settled for 3 s (a sedan, truck or monster class, intact or minus a hub), a hinged panel's shell rides the body it is cut from", () => {
  for (const { cls, lost } of CASES) {
    const tag = `${cls}${lost === null ? "" : ` minus ${HUBS[lost]}`}`;

    it(`when the ${tag} wreck's panels are hinged to 0.5, then each shell's hinge line stands on the body skin (4 mm proud), whatever the lift and sag`, () => {
      const car = wreck(cls, lost);
      for (const name of PANEL_NAMES) {
        const p = car.hang(name, 0.5);
        const shell = p.object as THREE.Mesh;
        shell.updateWorldMatrix(true, false);
        car.body.updateWorldMatrix(true, false);
        const r = p.region!;
        const pos = car.body.geometry.getAttribute("position");
        const held = r.verts.reduce((a, _, k) => (r.w[k]! < r.w[a]! ? k : a), 0);
        const body = new THREE.Vector3().fromBufferAttribute(pos, r.verts[held]!).applyMatrix4(car.body.matrixWorld);
        const hinge = new THREE.Vector3().fromBufferAttribute(shell.geometry.getAttribute("position"), held).applyMatrix4(shell.matrixWorld);
        expect(hinge.distanceTo(body), `${name}: shell hinge ${(hinge.distanceTo(body) * 100).toFixed(1)} cm off its body vertex`).toBeLessThan(0.01);
      }
    });

    it(`when the ${tag} wreck's panels are hinged and torn off, then each torn panel starts where it tore, on its patch of body, not at the stock ride`, () => {
      const car = wreck(cls, lost);
      for (const name of ["quarterR", "archFL"]) {
        const p = car.hang(name, 0.05);
        const patch = centre(car.body, [...p.region!.verts]);
        car.tear(name);
        const d = centre(p.object as THREE.Mesh).sub(patch);
        expect(Math.abs(d.y), `${name}: torn shell starts ${(d.y * 100).toFixed(1)} cm above its patch of body`).toBeLessThan(0.03);
        expect(Math.hypot(d.x, d.z), `${name}: torn shell starts ${Math.hypot(d.x, d.z).toFixed(2)} m sideways of its patch of body`).toBeLessThan(0.2);
      }
    });
  }
});

/** The vertex buffer's upload count: the shell is rebuilt (and re-uploaded) once per `needsUpdate`. */
const uploads = (p: DetachPart) => ((p.object as THREE.Mesh).geometry.getAttribute("position") as THREE.BufferAttribute).version;

describe("given a settled wreck's hinged panel shells, a shell is rebuilt when it changes, not every frame", () => {
  it("when 30 more frames pass and then one shell's hinge moves, then the settled shells are not rebuilt and only the one whose hinge moved is", () => {
    const car = wreck("sedan", null);
    const open = ["quarterR", "archRL"].map((n) => car.hang(n, 0.5));
    for (let f = 0; f < 30; f++) {
      car.stepBreakage(1 / FRAME_HZ);
      car.updateSkin();
    }
    const before = open.map(uploads);
    for (let f = 0; f < 30; f++) {
      car.stepBreakage(1 / FRAME_HZ);
      car.updateSkin();
    }
    assertSameNumbers(open.map(uploads), before, "shell uploads over 30 settled frames");
    open[0]!.hingeT = 0.8;
    car.stepBreakage(1 / FRAME_HZ);
    car.updateSkin();
    expect(uploads(open[0]!), "a shell whose hinge moved stayed as it was").toBeGreaterThan(before[0]!);
    expect(uploads(open[1]!), "the other shell was rebuilt").toBe(before[1]);
  });

  it("when a third shell is torn past the two a car draws, then the oldest stays hidden where it was and the drawn ones lie down", () => {
    const car = new Probe(paint(), new THREE.Scene(), null, "sedan");
    car.deform.setMode("shape");
    const names = ["quarterL", "quarterR", "archFL"];
    for (const n of names) car.tear(n);
    const [hidden, ...drawn] = names.map((n) => car.part(n));
    expect(!hidden!.object.visible && drawn.every((p) => p.object.visible), "the oldest of three torn shells is the hidden one").toBeTruthy();
    const at = hidden!.object.position.clone();
    const was = drawn.map((p) => p.object.position.y);
    for (let f = 0; f < 120; f++) car.step(DT);
    expect(hidden!.object.position.distanceTo(at), "a hidden shell kept moving").toBe(0);
    expect(drawn.every((p, i) => p.object.position.y < was[i]! - 0.05), "a drawn shell did not fall").toBeTruthy();
  });
});
