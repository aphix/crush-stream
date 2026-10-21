import * as THREE from "three";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeformableCar } from "./car.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES, CAR_STYLE_IDS, FLEET_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { ROCKER, deckTopY, doorAperture, lerp, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry, roofTopY, sampleSlice, sectionPoints } from "./car-mesh.ts";
import { beltY, floorY, rockerAt } from "./car-lines.ts";
import { doorSkinZ, makeDoorGeometry, mirrorSeatX } from "./car-door-mesh.ts";
import { MIRROR_ROOT } from "./part-geometry.ts";
import { makeGreenhouseFrame } from "./car-greenhouse-mesh.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { withHoodBulge, withRearFittings } from "./car-fittings-mesh.ts";
import { DOOR_GLASS_SEAT, glassCorners, makeRearGlass, makeSideGlass, makeWindshield } from "./car-glass.ts";
import { LIGHT_BAR_FOOT, bumperMaterial, makeLightBar, trimMaterial } from "./car-materials.ts";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { StreamedDeformation } from "../deform/streamed-deform.ts";
import { assertSameDigest, assertSameNumbers } from "./test-support.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { FITTING_ATTRIBUTE, FITTING_TONE, LIGHT_BAR, PRIMER_ATTRIBUTE } from "./constants.ts";

const PAINT = { body: 0xc5c8ce, accent: 0x9aa0a8, name: "Titanium" };
const scene = new THREE.Scene();
const cars: Record<CarStyleId, DeformableCar> = {
  sedan: new DeformableCar(PAINT, scene, null, "sedan"),
  hatchback: new DeformableCar(PAINT, scene, null, "hatchback"),
  wagon: new DeformableCar(PAINT, scene, null, "wagon"),
  coupe: new DeformableCar(PAINT, scene, null, "coupe"),
  pickup: new DeformableCar(PAINT, scene, null, "pickup"),
  police: new DeformableCar(PAINT, scene, null, "police"),
  monster: new DeformableCar(PAINT, scene, null, "monster"),
};

/** Highest visible surface at (x=0, z): roof, glass, deck or bed floor — never the debug rig. */
function topAt(id: CarStyleId, z: number): number {
  const c = cars[id];
  c.group.updateMatrixWorld(true);
  const meshes: THREE.Object3D[] = [];
  c.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.name === "deform-rig") return;
    meshes.push(o);
  });
  const hit = new THREE.Raycaster(new THREE.Vector3(0, 3, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes, false)[0];
  assert.ok(hit, `${id}: nothing under z=${z}`);
  return hit.point.y;
}

function chassisBox(style: BodyStyle): THREE.Box3 {
  const geo = makeChassisGeometry(style);
  geo.computeBoundingBox();
  const b = geo.boundingBox!.clone();
  geo.dispose();
  return b;
}

/** Max |skinned − rest| of a panel skinned against an undeformed rig: >0 only where the cage clamps it. */
function panelClamp(deform: StreamedDeformation, geo: THREE.BufferGeometry, part: Parameters<StreamedDeformation["skinPanel"]>[2], origin: THREE.Vector3): number {
  const attr = geo.getAttribute("position") as THREE.BufferAttribute;
  const rest = new Float32Array(attr.array as Float32Array);
  deform.skinPanel(geo, rest, part, origin);
  let drift = 0;
  for (let i = 0; i < rest.length; i++) drift = Math.max(drift, Math.abs(attr.array[i]! - rest[i]!));
  return drift;
}

/** Roof-level body vertices are cage-skinned. An at-rest skin pass moves them only by the
 *  cage solve's own breathing (≈5 cm on the base sedan), never off the body. */
function roofSkinDrift(style: BodyStyle): number {
  const geo = makeChassisGeometry(style);
  const d = new StreamedDeformation(geo, carFrame(style).rig);
  const attr = geo.getAttribute("position") as THREE.BufferAttribute;
  const rest = new Float32Array(attr.array as Float32Array);
  d.applyImpact(new THREE.Vector3(0, 0.4, 2), new THREE.Vector3(0, 0, -1), 4);
  d.stepCrush(1 / FRAME_HZ);
  d.update(geo);
  let drift = 0;
  for (let i = 0; i < attr.count; i++) {
    if (rest[i * 3 + 1]! < 1.0) continue;
    drift = Math.max(drift, Math.hypot(attr.getX(i) - rest[i * 3]!, attr.getY(i) - rest[i * 3 + 1]!, attr.getZ(i) - rest[i * 3 + 2]!));
  }
  geo.dispose();
  return drift;
}

describe("given every body style, compared with the sedan that the shared platform is built on", () => {
  const sedan = chassisBox(CAR_STYLES.sedan);

  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id} is built, then it keeps the sedan's wheel positions, and its length to within 0.12 m and its width to within 3 cm`, () => {
      for (const [i, w] of cars[id].wheels.entries()) assertSameNumbers(w.position.toArray(), carFrame(CAR_STYLES.sedan).wheels[i]!, `${id} wheel ${i}`);
      const b = chassisBox(CAR_STYLES[id]);
      const len = b.max.z - b.min.z;
      assert.ok(Math.abs(len - (sedan.max.z - sedan.min.z)) <= 0.12, `${id} length ${len}`);
      assert.ok(Math.abs(b.max.x - sedan.max.x) < 0.03 && Math.abs(b.min.x - sedan.min.x) < 0.03, `${id} width ${b.min.x}..${b.max.x}`);
    });

    it(`when a ${id} is built, then it keeps the sedan's mass rig (the masses and where each sits at rest)`, () => {
      const rig = (c: DeformableCar) => c.deform.masses.map((m) => [m.name, m.mass, ...m.rest.toArray()]);
      assertSameDigest(rig(cars[id]), rig(cars.sedan), `${id} mass rig`);
    });
  }

  it("when a 10-car field is generated, then every fleet style and the monster appear, slot 0 is the sedan and police never spawn on their own", () => {
    const field = Array.from({ length: 10 }, (_, i) => fleetStyle(i));
    assert.equal(field[0], "sedan");
    assertSameDigest([...new Set(field)].sort(), [...FLEET_STYLE_IDS, "monster"].sort(), "styles in a 10-car field");
  });
});

/** Tolerance (m) between a style's spec dimensions and its built car: well under a pixel of the references at their scale. */
const DIMS_TOL = 0.005;

/** Box in the car's frame of every mesh it draws but the light bar (the spec leaves it off). */
function shellBox(car: DeformableCar): THREE.Box3 {
  car.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  car.group.traverse((o) => {
    if (o instanceof THREE.Mesh && o.name !== LIGHT_BAR) box.expandByObject(o);
  });
  return box;
}

describe("given every body style's spec dimensions (`BodyStyle.dims`)", () => {
  for (const id of CAR_STYLE_IDS) {
    const d = CAR_STYLES[id].dims;

    it(`when a ${id} is built, then its drawn shell's nose, tail, width, roof and floor stand where its dims put them, within ${DIMS_TOL * 1000} mm`, () => {
      const b = shellBox(cars[id]);
      const half = d.wheelbase / 2;
      assertSameNumbers(
        [b.max.z, b.min.z, b.max.x - b.min.x, b.max.y, b.min.y],
        [half + d.overhang.front, -half - d.overhang.rear, d.width, d.height, d.rideHeight],
        `${id} nose, tail, width, roof, floor`,
        DIMS_TOL,
      );
    });

    it(`when a ${id} is built, then its wheels sit on its wheelbase and track, each hub one tyre radius up, on tyres its dims' width`, () => {
      const hubs = cars[id].wheels.flatMap((w) => [Math.abs(w.position.x), w.position.y, Math.abs(w.position.z)]);
      assertSameNumbers(hubs, cars[id].wheels.flatMap(() => [d.track / 2, d.wheel.radius, d.wheelbase / 2]), `${id} hubs`, DIMS_TOL);
      const halfW = cars[id].frame.rig.tyre.halfW;
      assert.ok(Math.abs(2 * halfW - d.wheel.width) < DIMS_TOL, `${id} tyre width ${2 * halfW} vs dims ${d.wheel.width}`);
    });
  }
});


describe("given each body style's silhouette, measured as the highest visible surface along the car's length", () => {
  it("when the sedan is measured, then it is three-box: the roof stands over the cabin and the trunk deck sits below 0.9 m behind the glass", () => {
    assert.ok(topAt("sedan", -0.2) > 1.25);
    assert.ok(topAt("sedan", -1.5) < 0.9, `sedan trunk ${topAt("sedan", -1.5)}`);
  });

  it("when the wagon's roof is measured 1.2 m and 1.5 m behind the centre, then it runs on past the sedan's toward the tail, above 1.2 m at both", () => {
    for (const z of [-1.2, -1.5]) assert.ok(topAt("wagon", z) > 1.2, `wagon roof at z=${z} is ${topAt("wagon", z)}`);
  });

  it("when the hatchback is measured, then its roof outruns the sedan's but its tail drops at least 0.2 m below the wagon's", () => {
    assert.ok(topAt("hatchback", -1.2) > 1.2, `hatch roof ${topAt("hatchback", -1.2)}`);
    assert.ok(topAt("sedan", -1.2) < 1.05, `sedan glass at z=-1.2 is ${topAt("sedan", -1.2)}`);
    assert.ok(topAt("hatchback", -1.75) < topAt("wagon", -1.75) - 0.2, "hatch tail is as tall as the wagon's");
  });

  it("when the coupe is measured, then its roof sits at least 6 cm lower than the sedan's", () => {
    assert.ok(topAt("coupe", -0.2) < topAt("sedan", -0.2) - 0.06, `coupe ${topAt("coupe", -0.2)} sedan ${topAt("sedan", -0.2)}`);
  });

  it("when the pickup and the monster are measured, then each has a cab roof and an open bed floor below 0.6 m, lower than every other style's deck", () => {
    const beds: readonly CarStyleId[] = ["pickup", "monster"];
    for (const id of beds) assert.ok(topAt(id, -0.2) > 1.25, `${id} cab roof ${topAt(id, -0.2)}`);
    for (const z of [-1.1, -1.7]) {
      for (const id of beds) assert.ok(topAt(id, z) < 0.6, `${id} bed floor at z=${z} is ${topAt(id, z)}`);
      for (const id of CAR_STYLE_IDS) if (!beds.includes(id)) assert.ok(topAt(id, z) > 0.78, `${id} deck at z=${z}`);
    }
  });
});

describe("given every body style's rig cage (the soft-body frame that wraps the car)", () => {
  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];

    it(`when a ${id} is at rest, then its boot, glass and any light bar sit inside their cages with no clamping`, () => {
      const d = new StreamedDeformation(makeChassisGeometry(style), carFrame(style).rig);
      const [oy, oz] = style.boot.origin;
      assert.ok(panelClamp(d, makeTrunkGeometry(style), "boot", new THREE.Vector3(0, oy, oz)) < 1e-4, `${id} boot`);
      assert.ok(panelClamp(d, makeWindshield(style), "glassFront", new THREE.Vector3()) < 1e-4, `${id} windshield`);
      assert.ok(panelClamp(d, makeRearGlass(style), "glassRear", new THREE.Vector3()) < 1e-4, `${id} rear glass`);
      if (style.lightBar) {
        const bar = cars[id].group.getObjectByName("lightBar")!;
        assert.ok(panelClamp(d, makeLightBar(), "roof", bar.position) < 1e-4, `${id} light bar`);
      }
    });

    it(`when a ${id} gets an at-rest skin pass, then its roof and pillars stay put, drifting under 0.1 m`, () => {
      const drift = roofSkinDrift(style);
      assert.ok(drift < 0.1, `${id} roof-level skin drift ${drift.toFixed(3)} m`);
    });

    it(`when a ${id} is hit from behind, then the tail crushes in by more than 5 cm without the skin exploding or any vertex going NaN`, () => {
      const c = new DeformableCar(PAINT, new THREE.Scene(), null, id);
      const d = c.deform;
      const geo = c.body.geometry;
      c.group.updateMatrixWorld();
      const vel = new THREE.Vector3(0, 0, -14);
      d.beginCrush(new THREE.Vector3(0, 0.36, -2.06), new THREE.Vector3(0, 0, 1), 14, 14, c.group, vel, new THREE.Vector3());
      const rl = d.masses.find((m) => m.name === "bumperRL")!;
      const z0 = rl.local.z;
      for (let i = 0; i < 24; i++) {
        d.notifyContact();
        d.feedOverlap(rl.world, new THREE.Vector3(0, 0, 1), 0.1, 14, 1 / FRAME_HZ);
        d.stepStructure(1 / FRAME_HZ);
        d.followGroup(c.group, vel, new THREE.Vector3(), 1 / FRAME_HZ);
        d.stepCrush(1 / FRAME_HZ);
        d.update(geo);
      }
      assert.ok(rl.local.z - z0 > 0.05, `${id} tail did not crush ${z0} → ${rl.local.z}`);
      const a = geo.getAttribute("position").array as Float32Array;
      let r = 0;
      for (let i = 0; i < a.length; i += 3) {
        assert.ok(Number.isFinite(a[i]! + a[i + 1]! + a[i + 2]!), `${id} NaN vertex`);
        r = Math.max(r, Math.hypot(a[i]!, a[i + 1]!, a[i + 2]!));
      }
      assert.ok(r < 4.2, `${id} skin exploded, vertex radius ${r}`);
    });
  }
});

/** A police car through a square `kph` wall hit (shape mode), and its bar. */
function copThroughWall(kph: number): { car: DeformableCar; detached: string[]; bar: THREE.Mesh } {
  const car = new DeformableCar(PAINT, new THREE.Scene(), null, "police");
  car.deform.setMode("shape");
  const bar = car.group.getObjectByName("lightBar");
  assert.ok(bar instanceof THREE.Mesh, "police car has no light bar");
  return { car, detached: runWall(kph, 1, "front", { car }).detached, bar };
}

/** Same hit on a sedan: its torn-off parts. */
function sedanThroughWall(kph: number): string[] {
  const car = new DeformableCar(PAINT, new THREE.Scene(), null, "sedan");
  car.deform.setMode("shape");
  return runWall(kph, 1, "front", { car }).detached;
}

describe("given the police cruiser", () => {
  it("when its paint and light bar are inspected, then the body is black, the doors are white whatever the fleet paint, and a light bar stands on top of the sedan's roof", () => {
    const c = cars.police;
    assert.equal((c.body.material as THREE.MeshStandardMaterial).color.getHex(), new THREE.Color(CAR_STYLES.police.livery!.body).getHex());
    const paints = new Set<number>();
    c.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshPhysicalMaterial && o.material.clearcoat > 0) paints.add(o.material.color.getHex());
    });
    assert.ok(paints.has(new THREE.Color(CAR_STYLES.police.livery!.doors).getHex()), "no white door paint");
    assert.ok(!paints.has(new THREE.Color(PAINT.body).getHex()), "the fleet paint leaked onto the police car");
    const z = c.group.getObjectByName("lightBar")!.position.z;
    assert.ok(topAt("police", z) > topAt("sedan", z) + 0.1, `bar top ${topAt("police", z)} vs sedan roof ${topAt("sedan", z)}`);
  });

  it("when the light bar's sole corners are measured against the roof under them, then the bar stands on its feet, every corner within 1.2 cm of the roof", () => {
    const c = cars.police;
    c.group.updateMatrixWorld(true);
    const bar = c.group.getObjectByName("lightBar")!;
    const sole = new THREE.Vector3();
    for (const x of [-LIGHT_BAR_FOOT.x - 0.04, -LIGHT_BAR_FOOT.x + 0.04, LIGHT_BAR_FOOT.x - 0.04, LIGHT_BAR_FOOT.x + 0.04]) {
      for (const z of [-0.09, 0.09]) {
        sole.set(x, LIGHT_BAR_FOOT.sole, z).applyMatrix4(bar.matrixWorld);
        const roof = new THREE.Raycaster(new THREE.Vector3(sole.x, 3, sole.z), new THREE.Vector3(0, -1, 0)).intersectObject(c.body, false)[0];
        assert.ok(roof, `no roof under the sole at x=${x}`);
        const gap = sole.y - roof.point.y;
        assert.ok(Math.abs(gap) < 0.012, `sole at x=${x} z=${z} is ${(gap * 100).toFixed(1)} cm off the roof`);
      }
    }
  });

  it("when it hits a wall square-on at 56 km/h, then the light bar stays on, bent with the roof, and every other part fares as it does on a sedan", () => {
    const { detached, bar } = copThroughWall(56);
    assertSameDigest(detached, sedanThroughWall(56), "parts off at 56 km/h");
    const rest = makeLightBar().getAttribute("position").array;
    const now = bar.geometry.getAttribute("position").array;
    let moved = 0;
    for (let i = 0; i < rest.length; i++) moved = Math.max(moved, Math.abs(now[i]! - rest[i]!));
    assert.ok(moved > 0.005 && moved < 0.3, `bar skin moved ${moved.toFixed(3)} m with the roof`);
  });

  it("when it hits a wall square-on at 64 km/h, then the light bar is thrown clear onto the ground with its sirens dark, and the rest tears as it does on a sedan", () => {
    const { car, detached, bar } = copThroughWall(64);
    assert.ok(detached.includes("lightBar"), `parts off: ${detached}`);
    assertSameDigest(detached.filter((n) => n !== "lightBar"), sedanThroughWall(64), "other parts off at 64 km/h");
    assert.ok(bar.parent !== car.group && bar.position.y < 0.5, `the bar is still up at y=${bar.position.y.toFixed(2)}, not on the ground`);
    car.setSirens(true);
    const p = new THREE.Vector3();
    for (const now of [0.1, 0.35]) {
      car.flashSirens(now);
      for (let i = 4; i < car.lampCount; i++) assert.equal(car.lampWorld(i, p, new THREE.Vector3()), null, `siren ${i} lit at t=${now} off a torn bar`);
    }
  });
});

/** Box of a built part, in its own frame. */
function partBox(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

describe("given a body style's own hardpoints (windshield, belt, hood, bumpers, rocker, floor, arches)", () => {
  const sedan = CAR_STYLES.sedan;
  const moved: BodyStyle = {
    ...sedan,
    windshield: { base: [0.82, 1.0], wBase: 1.24, wTop: 0.9 },
    belt: { x: 0.84, y: [[-0.9, 0.95], [0.76, 0.87]] },
    hood: { z0: 0.8, z1: 1.9, origin: [0.7, 0.8] },
    bumpers: { ...sedan.bumpers, front: { ...sedan.bumpers.front, span: 0.7 } },
    rocker: { y: 0.25 },
    dims: { ...sedan.dims, rideHeight: 0.17 },
    arch: { radius: 0.42 },
  };

  it("when they are moved, then the windshield's base, the side glass's sill, the hood's span and the front bumper's width follow them", () => {
    const ws = partBox(makeWindshield(moved));
    const hood = partBox(makeHoodGeometry(moved));
    const bumper = partBox(makeBumperGeometry(true, moved));
    assertSameNumbers([ws.min.y, ws.max.x - ws.min.x, hood.min.z + 0.8, hood.max.z + 0.8, bumper.max.x - bumper.min.x], [0.82, 1.24, 0.8, 1.9, 1.4], "windshield base y and width, hood z0 and z1, bumper width", 1e-3);
    const corners = glassCorners(moved);
    for (const pane of [2, 4]) {
      for (const k of [0, 1]) {
        const at = pane * 12 + k * 3;
        assert.ok(Math.abs(corners[at + 1]! - beltY(corners[at + 2]!, moved)) < 1e-6, `pane ${pane} base corner ${k} at y ${corners[at + 1]} off the belt ${beltY(corners[at + 2]!, moved)}`);
      }
    }
  });

  it("when they are moved, then the body side ends at the style's rocker, the keel at its floor, and the arch opening clears its radius above the hub", () => {
    const ring = sectionPoints(sampleSlice(-0.4, moved.profile), moved, "drawn");
    assertSameNumbers([ring[ROCKER]!.y, ring[(ring.length - 1) / 2]!.y], [0.25, 0.17], "rocker, keel", 1e-9);
    const [, hubY, hubZ] = carFrame(moved).wheels[0]!;
    const arch = sectionPoints(sampleSlice(hubZ, moved.profile), moved, "drawn");
    const outer = Math.max(...arch.map((p) => p.x));
    const lowestOuter = Math.min(...arch.filter((p) => p.x > outer - 0.01).map((p) => p.y));
    assert.ok(lowestOuter > hubY + 0.42 - 0.01, `the side over the front hub comes down to ${lowestOuter.toFixed(3)} m, inside the ${0.42} m arch`);
  });
});

/** Lowest y of the section ring `style` draws at `z` as `source`. */
function ringLowest(style: BodyStyle, z: number, source: "drawn" | "cage"): number {
  return sectionPoints(sampleSlice(z, style.profile), style, source).reduce((m, p) => Math.min(m, p.y), Infinity);
}

/** Largest x of the chassis' vertices on the door-mirror's band over the hinge; throws, naming the style, if it has none. */
function bodySideAtMirror(style: BodyStyle): number {
  const d = style.door;
  const pos = makeChassisGeometry(style, "drawn").getAttribute("position") as THREE.BufferAttribute;
  const mirrorY = d.hingeY + d.mirrorY;
  let side = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const inBand = Math.abs(pos.getZ(i) - d.hingeZ) < 0.08 && pos.getY(i) >= mirrorY - 0.08 && pos.getY(i) <= mirrorY && pos.getX(i) > 0;
    if (inBand) side = Math.max(side, pos.getX(i));
  }
  assert.ok(side > -Infinity, `${style.id}: no chassis vertex within 0.08 m of the hinge z ${d.hingeZ} and 0.08 m under the mirror height ${mirrorY}`);
  return side;
}

/** Mean z of the vertices at `geo`'s highest (`top`) or lowest y. */
function edgeMeanZ(geo: THREE.BufferGeometry, top: boolean): number {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  let edge = top ? -Infinity : Infinity;
  for (let i = 0; i < pos.count; i++) edge = top ? Math.max(edge, pos.getY(i)) : Math.min(edge, pos.getY(i));
  let sum = 0;
  let n = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getY(i) - edge) > 1e-4) continue;
    sum += pos.getZ(i);
    n++;
  }
  return sum / n;
}

/** Largest z among the bumper's vertices with |x| in [lo, hi). */
function bumperReachAt(geo: THREE.BufferGeometry, lo: number, hi: number): number {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  let reach = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = Math.abs(pos.getX(i));
    if (x >= lo && x < hi) reach = Math.max(reach, pos.getZ(i));
  }
  return reach;
}

describe("given a body style's H2 hardpoints", () => {
  const sedan = CAR_STYLES.sedan;

  it("when its underside is raised at the tail, then the section's lowest point and the rocker follow the floor there and nowhere else", () => {
    const moved: BodyStyle = { ...sedan, underside: [[-2.2, 0.3], [-1.6, 0.145], [1.6, 0.145]] };
    for (const source of ["drawn", "cage"] as const) {
      const tail = ringLowest(moved, -2.0, source);
      assert.ok(Math.abs(tail - floorY(-2.0, moved)) < 1e-9 && tail > 0.2, `${source}: lowest y at z -2.0 is ${tail}, floor ${floorY(-2.0, moved)}, must be > 0.2`);
      const mid = ringLowest(moved, 0, source);
      assert.ok(Math.abs(mid - 0.145) < 1e-9, `${source}: lowest y at z 0 is ${mid}, ride height 0.145`);
    }
    const lift = rockerAt(-2.0, moved) - rockerAt(0, moved);
    assert.ok(Math.abs(lift - (floorY(-2.0, moved) - 0.145)) < 1e-9, `rocker lifts ${lift} m between z 0 and -2.0, the floor lifts ${floorY(-2.0, moved) - 0.145}`);
  });

  it("when its ride height and rocker are raised, then no section point, on the body side or in the door cut, dips below the floor", () => {
    const moved: BodyStyle = { ...sedan, dims: { ...sedan.dims, rideHeight: 0.245 }, rocker: { y: 0.3 } };
    for (const source of ["drawn", "cage"] as const) {
      for (const z of [-0.5, 0.27, 0.5]) {
        const low = ringLowest(moved, z, source);
        assert.ok(low >= 0.245 - 1e-9, `${source} section at z ${z} reaches down to y ${low}, floor 0.245`);
      }
    }
  });

  it("when its door aperture is moved, then the body's cut and the door skin's length and place follow it", () => {
    const moved: BodyStyle = { ...sedan, door: { ...sedan.door, aperture: [-0.2, 0.7] } };
    assert.ok(doorAperture(0.6, moved) === 1 && doorAperture(-0.1, moved) === 1, `moved cut at z 0.6 is ${doorAperture(0.6, moved)}, at z -0.1 ${doorAperture(-0.1, moved)}, both 1`);
    assert.ok(doorAperture(0.6, sedan) === 0, `sedan cut at z 0.6 is ${doorAperture(0.6, sedan)}, 0`);
    const box = partBox(makeDoorGeometry(1, moved));
    const length = box.max.z - box.min.z;
    assert.ok(Math.abs(length - 0.94) < 1e-3, `skin is ${length} m long, 0.9 + 0.04`);
    const centre = (box.max.z + box.min.z) / 2 + doorSkinZ(moved) + moved.door.hingeZ;
    assert.ok(Math.abs(centre - 0.25) < 1e-3, `skin is centred at car z ${centre}, the cut's middle 0.25`);
  });

  it("when any style's mirror is seated, then its arm starts on the body side", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const side = bodySideAtMirror(style);
      const root = style.door.hingeX + mirrorSeatX(style) + MIRROR_ROOT;
      assert.ok(Math.abs(root - side) < 0.01, `${id}: mirror arm starts at x ${root}, body side at x ${side}`);
    }
  });

  it("when the tailgate's bottom edge leans out, then its foot moves with it and its hinge edge stays put", () => {
    const hatchback = CAR_STYLES.hatchback;
    const moved: BodyStyle = { ...hatchback, boot: { ...hatchback.boot, z0: hatchback.boot.origin[1] - 0.2 } };
    const [was, now] = [makeTrunkGeometry(hatchback), makeTrunkGeometry(moved)];
    const foot = edgeMeanZ(now, false) - edgeMeanZ(was, false);
    const hinge = edgeMeanZ(now, true) - edgeMeanZ(was, true);
    assert.ok(Math.abs(foot + 0.2) < 0.01, `lowest vertices moved ${foot} m in z, -0.2 asked`);
    assert.ok(Math.abs(hinge) < 0.005, `highest vertices moved ${hinge} m in z, 0 asked`);
  });

  it("when a bumper's wrap starts nearer the middle, then its corners sweep back from its face", () => {
    const moved: BodyStyle = { ...sedan, bumpers: { ...sedan.bumpers, front: { ...sedan.bumpers.front, wrap: { from: 0.25, back: 0.12 } } } };
    const movedGap = bumperReachAt(makeBumperGeometry(true, moved), 0, 0.05) - bumperReachAt(makeBumperGeometry(true, moved), 0.5, 0.6);
    const sedanGap = bumperReachAt(makeBumperGeometry(true, sedan), 0, 0.05) - bumperReachAt(makeBumperGeometry(true, sedan), 0.5, 0.6);
    assert.ok(movedGap >= 0.03, `moved bumper's corner at |x| 0.5-0.6 stands ${movedGap} m behind its middle, at least 0.03`);
    assert.ok(Math.abs(sedanGap) < 0.01, `sedan bumper's corner at |x| 0.5-0.6 stands ${sedanGap} m behind its middle, under 0.01 (wrap starts at 0.58)`);
  });

  it("when any style's header bars are built, then they stay under its roof skin over their ends", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const bars = makeGreenhouseFrame(style, "drawn").slice(-2);
      const specs = [
        { name: "windshield", width: style.windshield.wTop + 0.1, z: style.windshieldTop[1] - 0.02 },
        { name: "rear", width: style.rearGlass.wTop + 0.12, z: style.rearGlass.top[1] - 0.02 },
      ];
      for (let k = 0; k < specs.length; k++) {
        const { name, width, z } = specs[k]!;
        const top = partBox(bars[k]!).max.y;
        const roof = roofTopY(width / 2, z, style);
        // 1e-6: the bar's vertices are float32, a ulp at 1.3 m is 1.2e-7.
        assert.ok(top <= roof + 1e-6, `${id} ${name} header bar tops out at y ${top}, roof skin over its end (x ${width / 2}, z ${z}) at ${roof}`);
      }
    }
  });

  it("when its door hinge moves, then the door glass stays in the same window: it rides on its door's own hinge", () => {
    const moved: BodyStyle = { ...sedan, door: { ...sedan.door, hingeX: 0.8, hingeY: 0.79, hingeZ: 0.7 } };
    const inCar = (style: BodyStyle) => {
      const box = partBox(makeSideGlass(1, style));
      const { hingeX, hingeY, hingeZ } = style.door;
      return [box.max.x + hingeX + DOOR_GLASS_SEAT.x, box.max.y + hingeY + DOOR_GLASS_SEAT.y, box.max.z + hingeZ + DOOR_GLASS_SEAT.z];
    };
    assertSameNumbers(inCar(moved), inCar(sedan), "right door pane's top corner in the car (x, y, z)", 1e-6);
  });
});

const DETAIL_TOLERANCE = 0.02;

function detailFaults(style: BodyStyle): string[] {
  const { dims, details } = style;
  const faults: string[] = [];
  if (!details) return faults;
  const zMin = -(dims.wheelbase / 2 + dims.overhang.rear);
  const zMax = dims.wheelbase / 2 + dims.overhang.front;
  const halfWidth = dims.width / 2;
  const boxes = {
    side: [[zMin, zMax], [0, dims.height]],
    top: [[zMin, zMax], [0, halfWidth]],
    front: [[0, halfWidth], [0, dims.height]],
    rear: [[0, halfWidth], [0, dims.height]],
  } as const;
  const check = (kind: string, index: number, item: (typeof details.lines)[number] | (typeof details.patches)[number]) => {
    const [a, b] = boxes[item.view];
    for (const [p, q] of item.points) {
      if (p < a[0] - DETAIL_TOLERANCE || p > a[1] + DETAIL_TOLERANCE || q < b[0] - DETAIL_TOLERANCE || q > b[1] + DETAIL_TOLERANCE) {
        faults.push(`${style.id} ${kind} ${index} (${item.view}) point [${p}, ${q}] is outside the car box a [${a[0]}, ${a[1]}], b [${b[0]}, ${b[1]}]`);
      }
    }
    if (Math.abs(item.depth) > 0.006) faults.push(`${style.id} ${kind} ${index} depth ${item.depth} exceeds 0.006`);
    if (item.cavity < 0 || item.cavity > 1) faults.push(`${style.id} ${kind} ${index} cavity ${item.cavity} is outside [0, 1]`);
  };
  for (let i = 0; i < details.lines.length; i++) {
    const line = details.lines[i]!;
    check("line", i, line);
    if (line.points.length < 2) faults.push(`${style.id} line ${i} has ${line.points.length} points, needs 2`);
    if (line.width < 0.006) faults.push(`${style.id} line ${i} width ${line.width} is under 0.006`);
  }
  for (let i = 0; i < details.patches.length; i++) {
    const patch = details.patches[i]!;
    check("patch", i, patch);
    if (patch.points.length < 3) faults.push(`${style.id} patch ${i} has ${patch.points.length} points, needs 3`);
    if (patch.rim < 0) faults.push(`${style.id} patch ${i} rim ${patch.rim} is negative`);
  }
  return faults;
}

describe("given a body style's detail table", () => {
  it("when any style's details are read, then every stroke and patch lies on the car within its view", () => {
    for (const id of CAR_STYLE_IDS) {
      const faults = detailFaults(CAR_STYLES[id]);
      assert.ok(faults.length === 0, `${id} has ${faults.length} detail faults: ${faults.join("; ")}`);
    }
  });

  it("when a stroke runs past the nose, then the check names it", () => {
    const sedan = CAR_STYLES.sedan;
    const noseZ = sedan.dims.wheelbase / 2 + sedan.dims.overhang.front;
    const style: BodyStyle = {
      ...sedan,
      details: {
        lines: [{ view: "side", points: [[0, 0.5], [noseZ + 0.1, 0.5]], width: 0.008, depth: -0.004, profile: "v", cavity: 0.85 }],
        patches: [],
      },
    };
    const faults = detailFaults(style);
    assert.ok(faults.length === 1, `expected 1 fault for a stroke 0.1 m past the nose at z ${noseZ + 0.1}, got ${faults.length}: ${faults.join("; ")}`);
  });
});

// ---- P1 parts: drawn-only add-ons ----------------------------------------------------------------------------------------------

/** A hood vertex standing more than this (m) over the lid counts as raised. */
const RAISED_M = 0.005;
/** Float32 positions hold a part's numbers to about this (m). */
const POSITION_TOL = 1e-5;

/** Short sha-256 of geometries' positions and indices: two builds hash alike only when they are the same to the bit. */
function geometryHash(geometries: readonly THREE.BufferGeometry[]): string {
  const hash = createHash("sha256");
  for (const g of geometries) {
    const pos = g.getAttribute("position").array as Float32Array;
    hash.update(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength));
    const index = g.getIndex()?.array;
    if (index) hash.update(new Uint8Array(index.buffer, index.byteOffset, index.byteLength));
  }
  return hash.digest("hex").slice(0, 16);
}

/** Every cage build the sim reads off a style (body, bonnet, boot), hashed. */
function cageHash(style: BodyStyle): string {
  return geometryHash([makeChassisGeometry(style, "cage"), makeHoodGeometry(style, "cage"), makeTrunkGeometry(style, "cage")]);
}

/** Box of `geometry`'s vertices from `from` on whose `attribute` reads `tone` (every vertex when `attribute` is null), and how many. */
function toneBox(geometry: THREE.BufferGeometry, attribute: string | null, tone: number, from = 0): { box: THREE.Box3; count: number } {
  const pos = geometry.getAttribute("position");
  const tones = attribute === null ? null : geometry.getAttribute(attribute);
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  let count = 0;
  for (let i = from; i < pos.count; i++) {
    if (tones !== null && tones.getX(i) !== tone) continue;
    box.expandByPoint(p.fromBufferAttribute(pos, i));
    count++;
  }
  return { box, count };
}

/** A hood (`withHoodBulge`) read in the car frame: the box of the vertices standing over the lid, the highest point over the lid's centre line, and its primer-dark mouths' box and least forward normal. */
function readBulge(hood: THREE.BufferGeometry, style: BodyStyle): { raised: THREE.Box3; peak: number; mouth: THREE.Box3; forward: number } {
  const [oy, oz] = style.hood.origin;
  const pos = hood.getAttribute("position");
  const nrm = hood.getAttribute("normal");
  const primer = hood.hasAttribute(PRIMER_ATTRIBUTE) ? hood.getAttribute(PRIMER_ATTRIBUTE) : null;
  const raised = new THREE.Box3();
  const mouth = new THREE.Box3();
  const p = new THREE.Vector3();
  let peak = 0;
  let forward = 1;
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i) + oy, pos.getZ(i) + oz);
    if (primer !== null && primer.getX(i) === 1) {
      mouth.expandByPoint(p);
      forward = Math.min(forward, nrm.getZ(i));
    } else if (p.y - deckTopY(p.x, p.z, style) > RAISED_M) raised.expandByPoint(p);
    peak = Math.max(peak, p.y - deckTopY(0, p.z, style));
  }
  return { raised, peak, mouth, forward };
}

/** The outermost (+x) vertex of a hood's loft station at `z` (car frame). */
function outerEdgeAt(hood: THREE.BufferGeometry, style: BodyStyle, z: number): { x: number; y: number } {
  const [oy, oz] = style.hood.origin;
  const pos = hood.getAttribute("position");
  const edge = { x: -Infinity, y: 0 };
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(pos.getZ(i) + oz - z) > POSITION_TOL || pos.getX(i) <= edge.x) continue;
    edge.x = pos.getX(i);
    edge.y = pos.getY(i) + oy;
  }
  return edge;
}

/** Among `geometry`'s vertices whose coordinate `axis` (1 y, 2 z) is `at`, the largest coordinate `read` (`sign` -1: the smallest). */
function extremeAt(geometry: THREE.BufferGeometry, axis: 1 | 2, at: number, read: 1 | 2, sign: 1 | -1): number {
  const a = geometry.getAttribute("position").array;
  let best = -Infinity;
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i + axis]! - at) < POSITION_TOL) best = Math.max(best, sign * a[i + read]!);
  return sign * best;
}

/** The sedan's drawn body with `roof`: the vertices past the plain body's (the roof parts), their box, and the box of the primer-dark ones. */
function roofParts(roof: NonNullable<BodyStyle["roof"]>): { style: BodyStyle; body: THREE.BufferGeometry; from: number; all: { box: THREE.Box3; count: number }; dark: { box: THREE.Box3; count: number } } {
  const style: BodyStyle = { ...CAR_STYLES.sedan, roof };
  const body = makeChassisGeometry(style);
  const from = makeChassisGeometry(CAR_STYLES.sedan).getAttribute("position").count;
  return { style, body, from, all: toneBox(body, null, 0, from), dark: toneBox(body, PRIMER_ATTRIBUTE, 1, from) };
}

/** Over the body's vertices from `from` on: the least |x|, and the most any stands over the roof skin at `x` (at its own x when null). */
function overRoof(body: THREE.BufferGeometry, from: number, style: BodyStyle, x: number | null): { inner: number; peak: number } {
  const pos = body.getAttribute("position");
  let inner = Infinity;
  let peak = -Infinity;
  for (let i = from; i < pos.count; i++) {
    inner = Math.min(inner, Math.abs(pos.getX(i)));
    peak = Math.max(peak, pos.getY(i) - roofTopY(x ?? pos.getX(i), pos.getZ(i), style));
  }
  return { inner, peak };
}

const EXHAUST_CASES = [
  {
    it: "when a rear bumper carries twin round tips, then a chrome oval with a dark rear-facing throat stands at each of ±x at its y, its size across, past the bumper's face, and the cage builds are unchanged",
    exhaust: { tips: 2, x: 0.55, y: 0.22, size: [0.09, 0.06], shape: "round" },
    expectedXs: [-0.55, 0.55],
  },
  {
    it: "when a rear bumper carries one rectangular tip, then one chrome box with a dark rear-facing throat stands at its x and y, its size across, past the bumper's face, and the cage builds are unchanged",
    exhaust: { tips: 1, x: 0.4, y: 0.25, size: [0.12, 0.06], shape: "rect" },
    expectedXs: [0.4],
  },
] as const;
/** A round tip's 14-sided tube spans this share of its width (its widest chord). */
const ROUND_TIP_SPAN = 0.97;

describe("given a body style's P1 parts", () => {
  const sedan = CAR_STYLES.sedan;

  it("when a hood carries a bulge with a twin scoop, then the bulge stands over the lid only inside its width and z span, the scoop tops out its height over the bulge with its dark mouths facing forward at its z, and the cage builds are unchanged", () => {
    const bulge = { z0: 0.9, z1: 1.8, width: 0.6, rise: 0.04, scoop: { inlets: 2, z: 1.55, width: 0.44, height: 0.05 } } as const;
    const style: BodyStyle = { ...sedan, hood: { ...sedan.hood, bulge } };
    const plainHood = makeHoodGeometry(sedan);
    assert.ok(withHoodBulge(plainHood, sedan) === plainHood, "a hood without a bulge comes back as built");
    const plain = readBulge(plainHood, sedan);
    assert.ok(plain.raised.isEmpty() && plain.peak < POSITION_TOL, `the plain lid has nothing standing over it (peak ${plain.peak})`);
    const { raised, peak, mouth, forward } = readBulge(withHoodBulge(makeHoodGeometry(style), style), style);
    const half = bulge.width / 2;
    assert.ok(raised.max.x - raised.min.x > bulge.width * 0.8, `the bulge spans ${(raised.max.x - raised.min.x).toFixed(3)} m of its ${bulge.width}`);
    const inside = raised.min.x >= -half - POSITION_TOL && raised.max.x <= half + POSITION_TOL && raised.min.z >= bulge.z0 - POSITION_TOL && raised.max.z <= bulge.z1 + POSITION_TOL;
    assert.ok(inside, `raised x ${raised.min.x.toFixed(3)}..${raised.max.x.toFixed(3)}, z ${raised.min.z.toFixed(3)}..${raised.max.z.toFixed(3)}`);
    assertSameNumbers([peak], [bulge.rise + bulge.scoop.height], "the scoop's top over the lid's centre line", 1e-4);
    assertSameNumbers([mouth.min.z, mouth.max.z], [bulge.scoop.z, bulge.scoop.z], "the mouths' z", POSITION_TOL);
    const scoopHalf = bulge.scoop.width / 2;
    assert.ok(!mouth.isEmpty() && mouth.min.x >= -scoopHalf - POSITION_TOL && mouth.max.x <= scoopHalf + POSITION_TOL, `mouths x ${mouth.min.x}..${mouth.max.x}`);
    assert.ok(forward > 0.99, `every mouth vertex faces forward (least normal z ${forward.toFixed(3)})`);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a hood is a clamshell, then its sides wrap over the body's shoulder to a shut line on the fender top, clear of the body there, and the cage builds are unchanged", () => {
    const style: BodyStyle = { ...sedan, hood: { ...sedan.hood, kind: "clamshell" } };
    const z = lerp(sedan.hood.z0, sedan.hood.z1, 0.5);
    const ring = sectionPoints(sampleSlice(z, sedan.profile), sedan, "drawn");
    const fenderTop = ring[ring.length - 4]!;
    const lid = outerEdgeAt(makeHoodGeometry(sedan), sedan, z);
    const clam = outerEdgeAt(makeHoodGeometry(style), style, z);
    assert.ok(clam.x > fenderTop.x && clam.x - fenderTop.x < 0.01, `the clamshell's edge at x ${clam.x.toFixed(4)} stands clear of the fender top at ${fenderTop.x.toFixed(4)}, within 1 cm`);
    assertSameNumbers([clam.y], [fenderTop.y], "the shut line's height on the fender top", 1e-4);
    assert.ok(fenderTop.x - lid.x > 0.05, `the plain lid stops on the deck at x ${lid.x.toFixed(3)}, inboard of the fender top`);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a boot carries a lip, then a deck lid's top rises its rise at the rear edge, a tailgate's top edge kicks its rise out, nothing moves past its depth from the edge, and the cage builds are unchanged", () => {
    const lip = { rise: 0.025, depth: 0.08 };
    const { coupe, hatchback } = CAR_STYLES;
    const deck = coupe.boot;
    const gate = hatchback.boot;
    assert.ok(deck.kind === "lid" && gate.kind === "tailgate", "the coupe has a deck lid, the hatchback a tailgate");
    const deckStyle: BodyStyle = { ...coupe, boot: { ...deck, lip } };
    const gateStyle: BodyStyle = { ...hatchback, boot: { ...gate, lip } };
    const [plainDeck, lipDeck, plainGate, lipGate] = [coupe, deckStyle, hatchback, gateStyle].map((s) => makeTrunkGeometry(s));
    const edge = deck.z1 - deck.origin[1];
    const deckIn = lerp(deck.z0, deck.z1, 0.8) - deck.origin[1];
    const gateDown = lerp(gate.y0, gate.origin[0], 0.6) - gate.origin[0];
    const top = (g: THREE.BufferGeometry, at: number) => extremeAt(g, 2, at, 1, 1);
    const face = (g: THREE.BufferGeometry, at: number) => extremeAt(g, 1, at, 2, -1);
    assertSameNumbers([top(lipDeck!, edge) - top(plainDeck!, edge), top(lipDeck!, deckIn) - top(plainDeck!, deckIn)], [lip.rise, 0], "the deck lid's top over the plain one's at its rear edge and 0.13 m in", 1e-5);
    assertSameNumbers([face(plainGate!, 0) - face(lipGate!, 0), face(plainGate!, gateDown) - face(lipGate!, gateDown)], [lip.rise, 0], "the tailgate's face behind the plain one's at its top edge and 0.15 m down", 1e-5);
    assert.ok(cageHash(deckStyle) === cageHash(coupe) && cageHash(gateStyle) === cageHash(hatchback), "the cage builds are unchanged");
  });

  it("when a roof carries rails, then two dark rails stand on it between their |x| and z ends, their tops their rise over the roof at their inner edge, and the cage builds are unchanged", () => {
    const rails = { x: [0.45, 0.5], z: [-0.6, 0.4], rise: 0.04 } as const;
    const { style, body, from, all, dark } = roofParts({ rails });
    assert.ok(all.count > 0 && dark.count === all.count, `${all.count} roof-part vertices, ${dark.count} of them dark`);
    assertSameNumbers([all.box.min.x, all.box.max.x, all.box.min.z, all.box.max.z], [-0.5, 0.5, -0.6, 0.4], "the rails' x and z ends", POSITION_TOL);
    const { inner, peak } = overRoof(body, from, style, rails.x[0]);
    assertSameNumbers([inner, peak], [rails.x[0], rails.rise], "the rails' inner edge and their top over the roof there", 1e-4);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a roof carries a glass panel, then a dark panel lies on the roof a few mm proud across its width and z span, and the cage builds are unchanged", () => {
    const glassPanel = { z: [-0.6, 0.2], width: 0.8 } as const;
    const { style, body, from, all, dark } = roofParts({ glassPanel });
    assert.ok(all.count > 0 && dark.count === all.count, `${all.count} roof-part vertices, ${dark.count} of them dark`);
    assertSameNumbers([all.box.min.x, all.box.max.x, all.box.min.z, all.box.max.z], [-0.4, 0.4, -0.6, 0.2], "the panel's x and z ends", POSITION_TOL);
    const { peak } = overRoof(body, from, style, null);
    assert.ok(peak > 0 && peak < 0.01, `the panel stands ${(peak * 1000).toFixed(1)} mm over the roof skin`);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a roof carries a spoiler, then a body-colour wedge fills its z, y and half-width numbers, and the cage builds are unchanged", () => {
    const spoiler = { z: [-0.95, -0.8], y: [1.15, 1.22], halfWidth: 0.5 } as const;
    const { style, all, dark } = roofParts({ spoiler });
    assert.ok(all.count > 0 && dark.count === 0, `${all.count} roof-part vertices, ${dark.count} of them dark`);
    assertSameNumbers([...all.box.min.toArray(), ...all.box.max.toArray()], [-0.5, 1.15, -0.95, 0.5, 1.22, -0.8], "the spoiler's box", POSITION_TOL);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a bumper's trim is chrome, black or body, then it wears chrome, black plastic or the body's colour (unset: the car's accent trim), and no bumper or cage build changes", () => {
    const accent = 0x9aa0a8;
    const body = 0x7a1020;
    assert.ok(bumperMaterial(undefined, accent, body) === trimMaterial(accent), "unset: the accent trim every such car shares");
    const chrome = bumperMaterial("chrome", accent, body);
    const black = bumperMaterial("black", accent, body);
    const painted = bumperMaterial("body", accent, body);
    assert.ok(chrome.metalness > 0.9 && chrome.color.r > 0.5, `chrome: metalness ${chrome.metalness}, red ${chrome.color.r.toFixed(3)}`);
    assert.ok(black.color.r < 0.02 && black.color.g < 0.02 && black.color.b < 0.02, `black: ${black.color.getHexString()}`);
    assert.ok(painted.color.getHex() === body && painted.metalness < trimMaterial(accent).metalness, `body: ${painted.color.getHexString()}, metalness ${painted.metalness}`);
    const style: BodyStyle = { ...sedan, bumpers: { front: { ...sedan.bumpers.front, trim: "chrome" }, rear: { ...sedan.bumpers.rear, trim: "black" } } };
    const bumpers = (s: BodyStyle) => geometryHash([makeBumperGeometry(true, s), makeBumperGeometry(false, s)]);
    assert.ok(bumpers(style) === bumpers(sedan) && cageHash(style) === cageHash(sedan), "the bumpers and cage builds are unchanged");
  });

  it("when a rear bumper carries a hitch, then one black receiver stands under its middle, its top inside the bumper and its end past the bumper's face, and the cage builds are unchanged", () => {
    const pickup = CAR_STYLES.pickup;
    const style: BodyStyle = { ...pickup, bumpers: { ...pickup.bumpers, rear: { ...pickup.bumpers.rear, hitch: true } } };
    const fascia = makeBumperGeometry(false, pickup);
    assert.ok(withRearFittings(fascia, pickup) === fascia, "a bumper with no fittings comes back as built");
    const face = partBox(makeBumperGeometry(false, style)).clone();
    const fitted = withRearFittings(makeBumperGeometry(false, style), style);
    const { box, count } = toneBox(fitted, FITTING_ATTRIBUTE, FITTING_TONE.black);
    assert.ok(count > 0 && toneBox(fitted, FITTING_ATTRIBUTE, FITTING_TONE.chrome).count === 0, `${count} black vertices, no chrome`);
    assertSameNumbers([box.min.x + box.max.x], [0], "the receiver's middle x", POSITION_TOL);
    assert.ok(box.min.y < face.min.y && box.max.y > face.min.y && box.max.y < face.min.y + 0.03, `receiver y ${box.min.y.toFixed(3)}..${box.max.y.toFixed(3)}, the bumper's bottom ${face.min.y.toFixed(3)}`);
    assert.ok(box.min.z < face.min.z && box.max.z > face.min.z, `receiver z ${box.min.z.toFixed(3)}..${box.max.z.toFixed(3)}, the bumper's face ${face.min.z.toFixed(3)}`);
    assert.ok(cageHash(style) === cageHash(pickup), "the cage builds are unchanged");
  });

  for (const testCase of EXHAUST_CASES) {
    it(testCase.it, () => {
      const { exhaust } = testCase;
      const style: BodyStyle = { ...sedan, exhaust };
      const face = partBox(makeBumperGeometry(false, sedan)).clone();
      const fitted = withRearFittings(makeBumperGeometry(false, style), style);
      const pos = fitted.getAttribute("position");
      const tone = fitted.getAttribute(FITTING_ATTRIBUTE);
      const nrm = fitted.getAttribute("normal");
      const [w, h] = exhaust.size;
      for (const x of testCase.expectedXs) {
        const tip = new THREE.Box3();
        let throatBack = -Infinity;
        let throats = 0;
        for (let i = 0; i < pos.count; i++) {
          if (tone.getX(i) === 0 || Math.abs(pos.getX(i) - x) > w) continue;
          if (tone.getX(i) === FITTING_TONE.chrome) tip.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
          else {
            throatBack = Math.max(throatBack, nrm.getZ(i));
            throats++;
          }
        }
        const size = tip.getSize(new THREE.Vector3());
        const centre = tip.getCenter(new THREE.Vector3());
        assertSameNumbers([centre.x, centre.y, size.y], [x, exhaust.y - sedan.bumpers.rear.seat.y, h], `the tip at x ${x}: middle x, y and height`, 1e-4);
        assert.ok(size.x > w * (exhaust.shape === "round" ? ROUND_TIP_SPAN : 1) - 1e-4 && size.x < w + 1e-4, `the tip at x ${x} is ${size.x.toFixed(4)} m wide of ${w}`);
        assert.ok(tip.min.z < face.min.z && throats > 0 && throatBack < -0.99, `the tip ends at z ${tip.min.z.toFixed(3)} past the face ${face.min.z.toFixed(3)}; ${throats} throat vertices, normal z up to ${throatBack.toFixed(3)}`);
      }
      assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
    });
  }
});
