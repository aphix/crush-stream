import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { FULL_POOL, LampBatch, LampLights, type LampPool, lampPoolFor, PHONE_POOL } from "./lamp-lights.ts";
import { drawnLamp } from "./part-variants.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { assignClass, STYLE_CLASS, type VehicleClassId } from "./vehicle-classes.ts";
import { CLASS_LIFT, INTERIOR_MESH } from "./constants.ts";
import { PartSeat } from "./part-geometry.ts";
import { DT, forModes, paint } from "./test-support.ts";

/** A seat has no `raycast`; a mesh of what it draws (`drawn`: a style's own grille or mirror) at its world pose stands in for it. */
function seatProbe(seat: PartSeat): THREE.Mesh {
  const probe = new THREE.Mesh(seat.drawn);
  probe.matrixWorld.copy(seat.matrixWorld);
  return probe;
}

type LampRow = { kind: string; side: number; intact: boolean };
/** Lamp order inside the car: head L, head R, tail L, tail R. */
const HEAD_L = 0;
const HEAD_R = 1;

function lampRows(car: DeformableCar): LampRow[] {
  const snap = car.snapshot() as { lamps: LampRow[] }; // snapshot() is the test-facing record
  return snap.lamps;
}

/** Where lamp `i` is seated on the body skin, in car space. */
function lampLocal(car: DeformableCar, i: number): THREE.Vector3 {
  const p = new THREE.Vector3();
  car.lampWorld(i, p, new THREE.Vector3());
  return car.group.worldToLocal(p);
}

/** Distance (m) from a car-space point to the nearest facet of the current body skin. */
function offSkin(car: DeformableCar, p: THREE.Vector3): number {
  const pos = car.body.geometry.getAttribute("position");
  const index = car.body.geometry.index!;
  const tri = new THREE.Triangle();
  const q = new THREE.Vector3();
  let best = Infinity;
  for (let t = 0; t < index.count; t += 3) {
    tri.a.fromBufferAttribute(pos, index.getX(t));
    tri.b.fromBufferAttribute(pos, index.getX(t + 1));
    tri.c.fromBufferAttribute(pos, index.getX(t + 2));
    best = Math.min(best, tri.closestPointToPoint(p, q).distanceTo(p));
  }
  return best;
}

/** Wall pushed into the front-left corner only (car-local x = −0.7). */
function crushFrontLeft(car: DeformableCar, deferSkin = false): void {
  car.group.updateMatrixWorld();
  const hit = car.group.position.clone().addScaledVector(car.forward, 2.0).addScaledVector(car.right, -0.7);
  hit.y = 0.4;
  const inward = car.forward.clone().negate();
  car.applyImpact(hit, inward, 22, 22);
  for (let i = 0; i < 20; i++) {
    car.deform.notifyContact();
    car.deform.feedOverlap(hit, inward, 0.08, 10, DT);
    car.deform.stepStructure(DT);
    car.syncPose(DT);
    car.deform.skinDeferred = deferSkin;
    car.stepBreakage(DT);
    car.updateSkin();
  }
}

function spawned(mode: "lattice" | "shape"): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene());
  car.deform.setMode(mode);
  car.spawn(8, 12, 14);
  return car;
}

forModes("given a car whose lamps live on the body and break per corner", (mode) => {
  it("when the front-left corner is crushed, then the left headlamp alone goes out", () => {
    const car = spawned(mode);
    crushFrontLeft(car);
    const rows = lampRows(car);
    const out = rows.filter((l) => !l.intact).map((l) => `${l.kind}${l.side < 0 ? "L" : "R"}`);
    assert.deepEqual(out, ["headL"], `lamps out: ${out.join(",") || "none"}`);
    const batch = new LampBatch(2);
    batch.sync([car]);
    const shares = (["hood", "boot"] as const).map((k) => car.lampFittings.filter((f) => f.kind === k).length);
    assert.equal(batch.slots.map((s) => s.reduce((n, m) => n + m.count, 0)).join(), [1, 1, 2, 0, 0, 0, ...shares].join(), "drawn as head lit / head broken / tail lit / tail broken, no brake lamp or marker, the lid shares as the style has them");
  });

  it("when the front-left corner is crushed, then the crushed corner carries its lamp with the skin and the lamp stays seated on it", () => {
    const car = spawned(mode);
    const rest = lampLocal(car, HEAD_L);
    crushFrontLeft(car);
    const lamp = lampLocal(car, HEAD_L);
    assert.ok(lamp.distanceTo(rest) > 0.03, `left headlamp did not follow the crushed skin (moved ${lamp.distanceTo(rest).toFixed(3)} m)`);
    for (const i of [HEAD_L, HEAD_R]) {
      const gap = offSkin(car, lampLocal(car, i));
      assert.ok(gap < 0.005, `lamp ${i} floats ${gap.toFixed(3)} m off the skin`);
    }
  });

  it("when the crushed corner is on a deferred (level-of-detail) skin, then the lamp is re-seated when the skin is flushed, not before", () => {
    const car = spawned(mode);
    const rest = lampLocal(car, HEAD_L);
    crushFrontLeft(car, true);
    assert.ok(lampLocal(car, HEAD_L).distanceTo(rest) < 1e-6, "lamp moved while its skin was deferred");
    car.flushDeferredSkin();
    const lamp = lampLocal(car, HEAD_L);
    assert.ok(lamp.distanceTo(rest) > 0.03, "flushing the owed skin left the lamp behind");
    assert.ok(offSkin(car, lamp) < 0.005, "flushed lamp is off the skin");
  });
});

describe("given a car whose front bumper is torn off with no corner crush (a detached bumper leaves the lamps behind)", () => {
  it("when the bumper comes away, then every lamp stays lit and on the body", () => {
    const car = new DeformableCar(paint(), new THREE.Scene());
    car.spawn(8, 12, 0);
    const before = [0, 1, 2, 3].map((i) => lampLocal(car, i));
    const priv = car as unknown as { parts: { name: string; object: THREE.Object3D }[]; detachPart(p: unknown, impulse: number): void };
    const bumper = priv.parts.find((p) => p.name === "bumperF")!;
    const bumperAt = bumper.object.getWorldPosition(new THREE.Vector3());
    priv.detachPart(bumper, 20);
    for (let i = 0; i < 30; i++) car.step(DT);
    assert.ok(bumper.object.getWorldPosition(new THREE.Vector3()).distanceTo(bumperAt) > 0.2, "bumper never left the car");
    assert.ok(lampRows(car).every((l) => l.intact), "a lamp went out with the bumper");
    for (let i = 0; i < 4; i++) {
      const d = lampLocal(car, i).distanceTo(before[i]!);
      assert.ok(d < 1e-4, `lamp ${i} moved ${d.toFixed(4)} m relative to the body`);
    }
  });
});

describe("given every body style fitted with its own lamps", () => {
  const bodies: [CarStyleId, VehicleClassId][] = [...CAR_STYLE_IDS.map((s): [CarStyleId, VehicleClassId] => [s, STYLE_CLASS[s]]), ["pickup", "monster"]];
  for (const [style, cls] of bodies) {
    it(`when a ${style} body is given the ${cls} class, then each lamp lies on its end panel's skin, faces out, and lights from where it is drawn`, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
      assignClass(car, cls);
      car.group.updateMatrixWorld(true);
      const exterior: THREE.Object3D[] = [];
      car.group.traverse((o) => {
        if (!(o instanceof THREE.Mesh || o instanceof PartSeat) || o.name === INTERIOR_MESH) return;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === "deform-rig" || !p.visible) return;
        exterior.push(o instanceof PartSeat ? seatProbe(o) : o);
      });
      const ray = new THREE.Raycaster();
      const axis = new THREE.Vector3();
      const q = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const dir = new THREE.Vector3();
      for (const [i, l] of car.lamps.entries()) {
        const name = `${l.kind}${l.side < 0 ? "L" : "R"}`;
        l.seat.updateWorldMatrix(true, false);
        const m = l.seat.matrixWorld;
        axis.setFromMatrixColumn(m, 2).normalize();
        assert.ok(axis.z * (l.kind === "head" ? 1 : -1) > 0.99, `${name} faces ${axis.toArray().map((v) => v.toFixed(2))}`);
        // Every drawn triangle, probed from 0.6 m out along its normal: the first surface met must be the body skin (not air, a bumper,
        // grille or lid over the lamp) within 2 cm of the triangle, so no lens chord dives into the skin and no bezel floats off a corner.
        const unit = drawnLamp(car.style, l.kind, l.side).geometry;
        const [upos, unrm, uidx] = [unit.getAttribute("position"), unit.getAttribute("normal"), unit.getIndex()!];
        const tris = uidx.count / 3;
        const [c, n, v] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
        for (let t = 0; t < tris; t++) {
          c.set(0, 0, 0);
          n.set(0, 0, 0);
          for (let k = 0; k < 3; k++) {
            c.add(v.fromBufferAttribute(upos, uidx.getX(3 * t + k)).divideScalar(3));
            n.add(v.fromBufferAttribute(unrm, uidx.getX(3 * t + k)));
          }
          c.applyMatrix4(m);
          n.transformDirection(m);
          ray.set(q.copy(c).addScaledVector(n, 0.6), n.clone().negate());
          const hit = ray.intersectObjects(exterior, false)[0];
          assert.ok(hit?.object === car.body, `${name} probe ${t} at ${c.toArray().map((e) => e.toFixed(3))} meets ${hit ? hit.object.name || hit.object.parent?.name || "a part" : "nothing"}`);
          const off = 0.6 - hit.distance;
          assert.ok(Math.abs(off) < 0.02, `${name} probe ${t}: skin ${(off * 100).toFixed(1)} cm off the lamp`);
        }
        car.lampWorld(i, pos, dir);
        assert.ok(pos.distanceTo(q.setFromMatrixPosition(m)) < 1e-6, `${name} lights from ${pos.distanceTo(q).toFixed(3)} m off the drawn lamp`);
        assert.ok(dir.dot(axis) > 0.9999, `${name} light axis off the lamp's`);
      }
    });
  }
});

describe("given a monster-class car, whose lamp seats ride its lift", () => {
  const dressed = (): DeformableCar => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "pickup");
    assignClass(car, "monster");
    car.group.updateMatrixWorld(true);
    return car;
  };

  it("when its group is walked, then no lamp seat is one of its nodes", () => {
    const car = dressed();
    const seats = new Set<THREE.Object3D>(car.lamps.map((l) => l.seat));
    let found = 0;
    car.group.traverse((o) => void (seats.has(o) && found++));
    assert.equal(found, 0);
  });

  it("when the batch packs its lamps, then each instance is the seat's pose in the lift's frame", () => {
    const car = dressed();
    const lift = car.group.getObjectByName(CLASS_LIFT)!;
    assert.ok(lift.position.y > 0.1, "the control: the monster class raises the body");
    const batch = new LampBatch(8);
    batch.sync([car]);
    const seatInLift = new THREE.Matrix4();
    const expected = new THREE.Matrix4();
    const got = new THREE.Matrix4();
    for (const l of car.lamps) {
      seatInLift.compose(l.seat.position, l.seat.quaternion, l.seat.scale);
      expected.multiplyMatrices(lift.matrixWorld, seatInLift);
      const draws = batch.slots[l.kind === "head" ? 0 : 2]!;
      const own = draws.length === 1 ? null : l.variant;
      const slot = car.lamps.filter((other) => other.kind === l.kind && (own === null || other.variant === own)).indexOf(l);
      draws[own ?? 0]!.getMatrixAt(slot, got);
      for (let k = 0; k < 16; k++) assert.ok(Math.abs(got.elements[k]! - expected.elements[k]!) < 1e-5, `${l.kind} ${l.side} element ${k}`);
    }
  });
});

describe("given the lamp batch and one car of each style", () => {
  const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

  it("when one car of each style is packed, then its head and tail draws bill only its own lamp units' triangles, not the fleet's", () => {
    for (const id of CAR_STYLE_IDS) {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      assignClass(car, STYLE_CLASS[id]);
      car.group.updateMatrixWorld(true);
      const batch = new LampBatch(8);
      batch.sync([car]);
      const drawnTris = batch.slots.slice(0, 4).reduce((sum, draws) => sum + draws.reduce((n, m) => n + m.count * tris(m.geometry), 0), 0);
      const expected = car.lamps.reduce((sum, l) => sum + tris(drawnLamp(car.style, l.kind, l.side).geometry), 0);
      assert.equal(drawnTris, expected, `${id}: the lamp batch bills ${drawnTris} triangles for lamps of ${expected}`);
      batch.dispose();
    }
  });
});

describe("given the lamp light pool with a followed car far ahead, a nearer car between and a nearest car behind the camera", () => {
  /** Followed car far ahead, a nearer car between, a nearest car behind the camera. */
  function rig(pool: LampPool = FULL_POOL): { lights: LampLights; scene: THREE.Scene; camera: THREE.PerspectiveCamera; far: DeformableCar; near: DeformableCar; behind: DeformableCar } {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
    camera.position.set(0, 3, -10);
    camera.lookAt(0, 0, 20);
    const far = new DeformableCar(paint(), scene);
    const near = new DeformableCar(paint(), scene);
    const behind = new DeformableCar(paint(), scene);
    far.spawnFacing(0, 30, 0, 0);
    near.spawnFacing(3, 4, 0, 0);
    behind.spawnFacing(0, -16, 0, 0);
    return { lights: new LampLights(scene, 12, pool), scene, camera, far, near, behind };
  }

  const lightCount = (scene: THREE.Scene): number => {
    let n = 0;
    scene.traverseVisible((o) => {
      if (o instanceof THREE.Light) n++;
    });
    return n;
  };
  /** Is a lit spot sitting on one of `car`'s headlamps? */
  const spotOn = (s: THREE.SpotLight, car: DeformableCar): boolean => {
    const p = new THREE.Vector3();
    for (const i of [HEAD_L, HEAD_R]) {
      car.lampWorld(i, p, new THREE.Vector3());
      if (s.intensity > 0 && p.distanceTo(s.position) < 1e-6) return true;
    }
    return false;
  };

  it("when the pool updates, then the followed car's headlamps get spots first, then the cars on the middle tile, and every intact lamp glows", () => {
    const { lights, camera, far, near, behind } = rig();
    lights.update([far, near, behind], camera, far);
    const want = [far, far, near, near].slice(0, FULL_POOL.spots);
    for (const [k, car] of want.entries()) assert.ok(spotOn(lights.spots[k]!, car), `spot ${k} is not on the expected car`);
    assert.equal(lights.glow.geometry.drawRange.count, 12);
  });

  it("when a lamp is broken, then it never gets a light or a glow, and spare spots go dark, never away", () => {
    const { lights, scene, camera, far, near } = rig();
    lights.update([far, near], camera, far);
    const count = lightCount(scene);
    const priv = far as unknown as { lamps: unknown[]; breakLamp(l: unknown): void };
    priv.breakLamp(priv.lamps[HEAD_L]);
    priv.breakLamp(priv.lamps[HEAD_R]);
    lights.update([far, near], camera, far);
    assert.ok(lights.spots.every((s) => !spotOn(s, far)), "a broken headlamp kept its spot");
    assert.equal(lights.spots.filter((s) => spotOn(s, near)).length, Math.min(2, FULL_POOL.spots));
    assert.ok(lights.spots.slice(2).every((s) => s.intensity === 0), "an unassigned spot stayed lit");
    assert.equal(lights.glow.geometry.drawRange.count, 6);
    assert.equal(lightCount(scene), count, "the pool added or hid a light");
  });

  it("when a police car's sirens are on, then they flash red then blue, each lit lens taking a pooled point in its colour, and with sirens off nothing is lit", () => {
    const { lights, scene, camera, far } = rig();
    const cop = new DeformableCar(paint(), scene, null, "police");
    cop.spawnFacing(-3, 8, 0, 0);
    const count = lightCount(scene);
    // A tail point is dim red (0.5); a siren point is bright (3), red or blue.
    const sirenPoints = () => lights.tailSpots.filter((p) => p.intensity > 1);
    lights.update([far, cop], camera, far, 0.1);
    assert.equal(sirenPoints().length, 0, "a siren lit with the sirens off");
    assert.equal(lights.glow.geometry.drawRange.count, 8);

    cop.setSirens(true);
    for (const [now, red] of [[0.1, true], [0.35, false], [0.6, true]] as const) {
      lights.update([far, cop], camera, far, now);
      const lit = sirenPoints();
      assert.equal(lit.length, 1, `t=${now}: ${lit.length} siren points`);
      assert.equal(lit[0]!.color.r > lit[0]!.color.b, red, `t=${now}: wrong colour`);
      assert.ok(lit[0]!.position.y > 1.4, `t=${now}: siren light at y=${lit[0]!.position.y.toFixed(2)}, not over the roof`);
      assert.equal(lights.glow.geometry.drawRange.count, 9);
    }
    assert.equal(lightCount(scene), count, "sirens added or hid a light");

    cop.setSirens(false);
    lights.update([far, cop], camera, far, 0.1);
    assert.equal(sirenPoints().length, 0, "sirens stayed lit after setSirens(false)");
    assert.equal(new DeformableCar(paint(), scene).lampCount, 4, "a car without a light bar grew siren slots");
  });

  it("when the pool is the phone's, then it holds 2 head spots and 2 tail spots, the followed car's two headlamps take both spots, and every intact lamp still glows", () => {
    const { lights, scene, camera, far, near, behind } = rig(PHONE_POOL);
    lights.update([far, near, behind], camera, far);
    assert.equal(lights.spots.length, 2);
    assert.equal(lights.tailSpots.length, 2);
    assert.ok(lights.spots.every((s) => spotOn(s, far)), "a spot is not on the followed car");
    assert.equal(lights.glow.geometry.drawRange.count, 12);
    let pooled = 0;
    scene.traverse((o) => void ((o instanceof THREE.SpotLight || o instanceof THREE.PointLight) && pooled++));
    assert.equal(pooled, 4, "the scene holds more pooled lights than the phone's");
  });

  it("when one car is followed, one is in the highlight, one is on the middle tile and one is far off it, then the followed and highlight cars get the real spots, and the other two get fake pools and no spot", () => {
    const { scene, camera, far, near, behind } = rig();
    const aside = new DeformableCar(paint(), scene);
    aside.spawnFacing(-30, 10, 0, 0);
    const lights = new LampLights(scene, 16);
    lights.update([aside, near, behind, far], camera, far, 0, [behind]);
    const want = [far, far, behind, behind];
    for (const [k, car] of want.entries()) assert.ok(spotOn(lights.spots[k]!, car), `spot ${k} is not on the expected car`);
    for (const car of [near, aside]) assert.ok(lights.spots.every((s) => !spotOn(s, car)), "a car outside the followed car and the highlight kept a real spot");
    const m = lights.pools.instanceMatrix.array;
    const pooled = (car: DeformableCar, i: number): boolean => {
      const p = new THREE.Vector3();
      car.lampWorld(i, p, new THREE.Vector3());
      for (let k = 0; k < lights.pools.count; k++) if (Math.abs(m[k * 16 + 12]! - p.x) < 1e-4 && Math.abs(m[k * 16 + 14]! - p.z) < 1e-4) return true;
      return false;
    };
    for (const car of [near, aside]) for (const i of [HEAD_L, HEAD_R]) assert.ok(pooled(car, i), `headlamp ${i} of a car without a spot has no fake pool`);
    for (const car of [far, behind]) for (const i of [HEAD_L, HEAD_R]) assert.ok(!pooled(car, i), `headlamp ${i} of a car with real spots also shows a fake pool`);
  });

  it("when the followed car's tail lamps hold real lights, then each lights the road behind its lens and nothing ahead of it (the cabin, the bed floor)", () => {
    const { lights, camera, far, near } = rig();
    lights.update([far, near], camera, far);
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    /** Whether a light reaches `p` at all: within its range and, for a spot, inside its cone. */
    const reaches = (l: THREE.PointLight | THREE.SpotLight, p: THREE.Vector3): boolean => {
      const to = p.clone().sub(l.position);
      if (to.length() >= l.distance) return false;
      return !(l instanceof THREE.SpotLight) || to.angleTo(l.target.position.clone().sub(l.position)) < l.angle;
    };
    let tails = 0;
    for (let i = 0; i < far.lampCount; i++) {
      if (far.lampWorld(i, pos, dir) !== "tail") continue;
      tails++;
      const l = lights.tailSpots.find((s) => s.intensity > 0 && s.position.distanceTo(pos) < 0.1);
      assert.ok(l, `tail lamp ${i} of the followed car holds no lit light`);
      const ahead = pos.clone().addScaledVector(dir, -0.4).setY(pos.y + 0.2);
      const behind = pos.clone().addScaledVector(dir, 1).setY(pos.y - 0.4);
      assert.ok(!reaches(l, ahead), `tail lamp ${i}'s light reaches ${ahead.toArray().map((e) => e.toFixed(2))}, 40 cm ahead of its lens`);
      assert.ok(reaches(l, behind), `tail lamp ${i}'s light misses the road behind it`);
    }
    assert.equal(tails, 2);
  });
});

describe("given a device class and the page's ?lamps setting", () => {
  const testCases = [
    { it: "when the device is a desktop, then it links the full pool", desktop: true, lamps: null, spots: 4, tails: 4 },
    { it: "when a desktop's page asks ?lamps=lean, then it still links the full pool", desktop: true, lamps: "lean", spots: 4, tails: 4 },
    { it: "when the device is a phone, then it links the lean pool", desktop: false, lamps: null, spots: 2, tails: 2 },
    { it: "when a phone's page asks ?lamps=full (the A/B arm), then it links the full pool", desktop: false, lamps: "full", spots: 4, tails: 4 },
  ] as const;
  for (const testCase of testCases) {
    it(testCase.it, () => {
      const pool = lampPoolFor(testCase.desktop, testCase.lamps);
      assert.equal(pool.spots, testCase.spots, "spots");
      assert.equal(pool.tails, testCase.tails, "tails");
    });
  }
});
