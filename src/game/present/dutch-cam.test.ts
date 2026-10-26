import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FREEWHEEL, launch, makeWorld, PARKED, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { makeWheelGeometry } from "../vehicle/car-materials.ts";
import { growDrawn } from "../vehicle/car-parts.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { PartSeat } from "../vehicle/part-geometry.ts";
import { buildCar } from "../vehicle/drawn-body.test-util.ts";
import { CLASSES, VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { FLAT_GROUND, setGround } from "../world/ground.ts";
import { ShotCam, type Shot } from "./shot-cam.ts";
import { DutchCam, type Sight } from "./spectate-cam.ts";

/** Open flat ground, nothing standing on it: only the car's own parts can cover a lens. */
const OPEN: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [] };
/** The platform wheel mesh's own box: the wheel batch scales it to each car's tyre. */
const WHEEL_BOX = (() => {
  const g = makeWheelGeometry("beadlock");
  g.computeBoundingBox();
  return g.boundingBox!;
})();
/** Room (m) the eye keeps from a drawn tyre's box. */
const TYRE_ROOM = 0.05;
/** The left rear well looking forward, along the left door. */
const LEFT_REAR_FORWARD = 4;
/** The right rear well looking forward, along the struck side's door. */
const RIGHT_REAR_FORWARD = 6;

/** `p` (world) stands within `TYRE_ROOM` of wheel `i`'s drawn tyre: the platform mesh's cylinder as the wheel batch scales it to the car's tyre, on the wheel's own axle. */
function insideTyre(car: DeformableCar, i: number, p: THREE.Vector3): boolean {
  const { r, halfW } = car.frame.rig.tyre;
  const w = car.wheels[i]!;
  w.updateWorldMatrix(true, false);
  const s = w.getWorldScale(new THREE.Vector3()).x;
  const local = p.clone().sub(w.getWorldPosition(new THREE.Vector3()));
  const axle = new THREE.Vector3(1, 0, 0).applyQuaternion(w.getWorldQuaternion(new THREE.Quaternion()));
  const across = local.dot(axle);
  const radial = local.addScaledVector(axle, -across).length();
  return Math.abs(across) < WHEEL_BOX.max.x * s * (halfW / PLATFORM_TYRE.halfW) + TYRE_ROOM && radial < WHEEL_BOX.max.y * s * (r / PLATFORM_TYRE.r) + TYRE_ROOM;
}

/** What `car` draws off its rest (open doors and lids, hanging panels, torn parts), as plain meshes at their world matrices, both faces hit: what three's own raycast reads. */
function displacedMeshes(car: DeformableCar): THREE.Mesh[] {
  const out: THREE.Object3D[] = [];
  const n = car.displacedParts(out, 0);
  const meshes: THREE.Mesh[] = [];
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const o of out.slice(0, n)) {
    o.updateWorldMatrix(true, true);
    o.traverseVisible((d) => {
      const g = d instanceof PartSeat ? d.drawn : d instanceof THREE.Mesh ? (d.geometry as THREE.BufferGeometry) : null;
      if (!g?.getAttribute("position")) return;
      // A posed shell moves its vertices: bounds cached before would let the raycast skip it.
      g.boundingSphere = null;
      g.boundingBox = null;
      const m = new THREE.Mesh(g, material);
      m.matrixWorld.copy(d.matrixWorld);
      meshes.push(m);
    });
  }
  return meshes;
}

/** The segment from `a` to `b` passes through one of `meshes`. */
function crosses(meshes: THREE.Mesh[], a: THREE.Vector3, b: THREE.Vector3): boolean {
  const ray = new THREE.Raycaster(a, b.clone().sub(a).normalize(), 0, a.distanceTo(b));
  return ray.intersectObjects(meshes, false).length > 0;
}

/** What `cam` (posed on a wheel mount of `car`) is meant to show: the frame's centre 10 m out, and the car's flank at the end it looks toward, level with the lens. */
function targets(cam: THREE.PerspectiveCamera, car: DeformableCar): { centre: THREE.Vector3; subject: THREE.Vector3 } {
  const dir = cam.getWorldDirection(new THREE.Vector3());
  const centre = cam.position.clone().addScaledVector(dir, 10);
  const eye = car.group.worldToLocal(cam.position.clone());
  const along = dir.clone().applyQuaternion(car.group.quaternion.clone().invert()).z;
  const subject = car.group.localToWorld(new THREE.Vector3(Math.sign(eye.x) * car.frame.half.x, eye.y, Math.sign(along) * car.frame.half.z));
  return { centre, subject };
}

/** `p` projects inside `cam`'s frame, in front of it. */
function inFrame(cam: THREE.PerspectiveCamera, p: THREE.Vector3): boolean {
  cam.updateMatrixWorld();
  const ndc = p.clone().project(cam);
  return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1;
}

function lens(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(56, 16 / 9, 0.1, 900);
}

describe("given the wheel-well dutch camera on every class's drawn body", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when a ${cls}'s eight mounts are placed, then each eye stands outside every drawn tyre and outboard of the drawn body`, () => {
      const car = buildCar(CLASSES[cls].style, cls);
      car.group.updateMatrixWorld(true);
      const body = new THREE.Box3();
      growDrawn(car.body, body);
      const side = Math.max(Math.abs(body.min.x), Math.abs(body.max.x));
      const dutch = new DutchCam();
      const cam = lens();
      for (let j = 0; j < 8; j++) {
        dutch.place(cam, car, j);
        const e = cam.position;
        for (let i = 0; i < 4; i++) assert.ok(!insideTyre(car, i, e), `${cls} mount ${j}: eye ${e.toArray().map((v) => v.toFixed(2))} inside tyre ${i}`);
        assert.ok(Math.abs(e.x) > side, `${cls} mount ${j}: eye at x ${e.x.toFixed(2)} within the drawn body's side ${side.toFixed(2)}`);
      }
    });
  }
});

describe("given a dutch shot seeded on the left rear well looking forward", () => {
  it("when the left door is shut the shot takes that mount; when it stands open across the lens, another mount whose centre and subject are clear of the door and the subject in frame", () => {
    const car = buildCar("sedan", "sedan");
    car.group.updateMatrixWorld(true);
    const shot: Shot = { kind: "dutch", mount: LEFT_REAR_FORWARD, angle: 0, seed: 0 };
    const seeded = lens();
    new DutchCam().place(seeded, car, LEFT_REAR_FORWARD);
    const sc = new ShotCam();
    const cam = lens();
    sc.frame(shot, car, OPEN, 0, 0, [car]);
    assert.ok(sc.found, "the shut car's dutch shot found no mount");
    sc.pose(cam, car, shot, { x: 0, y: 1 });
    assert.ok(cam.position.distanceTo(seeded.position) < 1e-9, "door shut: the seeded mount is not taken");

    car.setDoorOpen(-1, car.doorHinge(-1).spec.stop);
    car.group.updateMatrixWorld(true);
    const door = displacedMeshes(car);
    const before = targets(seeded, car);
    assert.ok(crosses(door, seeded.position, before.centre) || crosses(door, seeded.position, before.subject), "the open door does not stand across the seeded mount's view");

    sc.frame(shot, car, OPEN, 0, 0, [car]);
    assert.ok(sc.found, "door open: no clear mount found");
    sc.pose(cam, car, shot, { x: 0, y: 1 });
    const { centre, subject } = targets(cam, car);
    assert.ok(cam.position.distanceTo(seeded.position) > 0.1 || cam.getWorldDirection(new THREE.Vector3()).dot(seeded.getWorldDirection(new THREE.Vector3())) < 0, "door open: still on the seeded mount, looking the same way");
    assert.ok(!crosses(door, cam.position, centre), "door open: the frame's centre is behind the door");
    assert.ok(!crosses(door, cam.position, subject), "door open: the subject is behind the door");
    assert.ok(inFrame(cam, subject), "door open: the subject is out of frame");
  });
});

describe("given a fixed staged side hit (a sedan at 40 km/h into the parked car's right side), for each class", () => {
  for (const cls of VEHICLE_CLASS_IDS) {
    it(`when the struck ${cls} gets a dutch shot seeded along its struck side, then the eye stands outside its drawn tyres, the subject is in frame and its displaced parts cover neither the subject nor the frame's centre`, (t) => {
      setGround(FLAT_GROUND);
      try {
        const subject = buildCar(CLASSES[cls].style, cls);
        const bullet = buildCar("sedan", "sedan");
        launch(subject, 0, 0, 0, 0, 0);
        launch(bullet, 6, 0, -Math.PI / 2, -40 / 3.6, 0);
        layOnGround(subject);
        layOnGround(bullet);
        const w = makeWorld([subject, bullet], false, false);
        w.pedals.set(subject, PARKED);
        w.pedals.set(bullet, FREEWHEEL);
        for (let n = 0; n < 90; n++) tickWorld(w);
        subject.group.updateMatrixWorld(true);
        const shot: Shot = { kind: "dutch", mount: RIGHT_REAR_FORWARD, angle: 0, seed: 0 };
        const sc = new ShotCam();
        const p = subject.group.position;
        sc.frame(shot, subject, OPEN, p.x, p.z, [subject, bullet]);
        const parts = displacedMeshes(subject);
        const seeded = lens();
        new DutchCam().place(seeded, subject, RIGHT_REAR_FORWARD);
        const aim = targets(seeded, subject);
        const covered = crosses(parts, seeded.position, aim.centre) || crosses(parts, seeded.position, aim.subject);
        t.diagnostic(`${cls}: ${parts.length} displaced meshes, doors ${subject.doorAngle(-1).toFixed(2)} / ${subject.doorAngle(1).toFixed(2)} rad, seeded mount covered: ${covered}`);
        assert.ok(sc.found, `${cls}: no clear wheel mount`);
        const cam = lens();
        sc.pose(cam, subject, shot, { x: 0, y: 1 });
        for (let i = 0; i < 4; i++) assert.ok(!insideTyre(subject, i, cam.position), `${cls}: eye inside tyre ${i}`);
        const { centre, subject: flank } = targets(cam, subject);
        assert.ok(inFrame(cam, flank), `${cls}: the subject is out of frame`);
        assert.ok(!crosses(parts, cam.position, flank), `${cls}: the subject is behind its own displaced parts`);
        assert.ok(!crosses(parts, cam.position, centre), `${cls}: the frame's centre is behind its own displaced parts`);
      } finally {
        setGround(null);
      }
    });
  }
});
