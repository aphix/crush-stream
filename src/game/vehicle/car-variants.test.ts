import * as THREE from "three";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeformableCar } from "./car.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES, CAR_STYLE_IDS, FLEET_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { PLATFORM_CAMERA, PLATFORM_HARDPOINTS } from "./car-styles/platform.ts";
import { ROCKER, doorAperture, glassTopY, glassX, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry, roofTopY, sampleSlice, sectionPoints } from "./car-mesh.ts";
import { aPillarTopZ, beltY, floorY, rockerAt } from "./car-lines.ts";
import { doorSkinZ, makeDoorGeometry, mirrorSeatX } from "./car-door-mesh.ts";
import { MIRROR_ROOT } from "./part-geometry.ts";
import { makeGreenhouseFrame, makeRoofGeometry } from "./car-greenhouse-mesh.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { DOOR_GLASS_SEAT, glassCorners, makeRearGlass, makeSideGlass, makeWindshield } from "./car-glass.ts";
import { LIGHT_BAR_FOOT, makeLightBar } from "./car-materials.ts";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { StreamedDeformation } from "../deform/streamed-deform.ts";
import { PLATFORM_RIG } from "../deform/deform-rig.ts";
import { assertSameDigest, assertSameNumbers } from "./test-support.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { LIGHT_BAR } from "./constants.ts";

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

describe("given every body style, compared with the sedan and the platform its rig is carried from", () => {
  const sedan = chassisBox(CAR_STYLES.sedan);
  const dimsLength = (id: CarStyleId): number => {
    const d = CAR_STYLES[id].dims;
    return d.overhang.front + d.wheelbase + d.overhang.rear;
  };

  for (const id of CAR_STYLE_IDS) {
    it(`when a ${id} is built, then its wheels stand where its own frame puts them, and its chassis is as much longer and wider than the sedan's as its dims say, to within 0.12 m and 3 cm`, () => {
      for (const [i, w] of cars[id].wheels.entries()) assertSameNumbers(w.position.toArray(), carFrame(CAR_STYLES[id]).wheels[i]!, `${id} wheel ${i}`);
      const b = chassisBox(CAR_STYLES[id]);
      const len = b.max.z - b.min.z;
      const longer = len - (sedan.max.z - sedan.min.z);
      assert.ok(Math.abs(longer - (dimsLength(id) - dimsLength("sedan"))) <= 0.12, `${id} length ${len}`);
      const wider = b.max.x - b.min.x - (sedan.max.x - sedan.min.x);
      assert.ok(Math.abs(wider - (CAR_STYLES[id].dims.width - CAR_STYLES.sedan.dims.width)) < 0.03, `${id} width ${b.min.x}..${b.max.x}`);
    });

    it(`when a ${id} is built, then its mass rig is the platform's carried onto its body: the platform's masses in its order, each the platform's mass times the car's mass scale, the hubs on its wheels and every other mass inside its dims' box`, () => {
      const c = cars[id];
      const d = CAR_STYLES[id].dims;
      assert.equal(c.deform.masses.map((m) => m.name).join(), PLATFORM_RIG.masses.map((m) => m.name).join());
      for (const [k, m] of c.deform.masses.entries()) {
        assert.ok(Math.abs(m.mass - PLATFORM_RIG.masses[k]!.mass * c.frame.rig.massScale) < 1e-9, `${id} ${m.name} mass ${m.mass}`);
        const hub = ["hubFL", "hubFR", "hubRL", "hubRR"].indexOf(m.name);
        if (hub >= 0) {
          assertSameNumbers(m.rest.toArray(), c.frame.wheels[hub]!, `${id} ${m.name} rest`);
          continue;
        }
        const [x, y, z] = m.rest.toArray();
        const inLength = z! <= d.wheelbase / 2 + d.overhang.front && z! >= -(d.wheelbase / 2 + d.overhang.rear);
        assert.ok(Math.abs(x!) <= d.width / 2 && y! >= 0 && y! <= d.height && inLength, `${id} ${m.name} rest ${x},${y},${z} outside its dims' box`);
      }
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
  // The sedan's body on the platform's hardpoints and flat floor: the rows move one hardpoint from known values.
  const sedan: BodyStyle = { ...CAR_STYLES.sedan, ...PLATFORM_HARDPOINTS, underside: undefined };
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

/**
 * The outer x of the body at the mirror's seat (its z, just under its height): the door skin's where the seat is in the door cut
 * (under its 2 cm edge roll), else the chassis' outside the cut (its rings are sparse in height, so over 8 cm under the seat);
 * linear between the two nearest vertex columns in z, the widest vertex of each. Throws, naming the style, with no column either side.
 */
function bodySideAtMirror(style: BodyStyle): number {
  const d = style.door;
  const mirrorY = d.hingeY + d.mirrorY;
  const mirrorZ = d.hingeZ - (d.mirrorZ ?? 0);
  const onDoor = doorAperture(mirrorZ, style) > 0;
  const geo = onDoor ? makeDoorGeometry(1, style) : makeChassisGeometry(style, "drawn");
  const [dx, dy, dz] = onDoor ? [d.hingeX, d.hingeY, d.hingeZ + doorSkinZ(style)] : [0, 0, 0];
  const [yLow, yHigh] = onDoor ? [mirrorY - 0.05, mirrorY - 0.02] : [mirrorY - 0.08, mirrorY];
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const columns = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [dx + pos.getX(i), dy + pos.getY(i), dz + pos.getZ(i)];
    if (x <= 0 || y < yLow || y > yHigh || (!onDoor && doorAperture(z, style) > 0)) continue;
    const key = Math.round(z * 1e4) / 1e4;
    columns.set(key, Math.max(columns.get(key) ?? -Infinity, x));
  }
  const zs = [...columns.keys()].sort((a, b) => a - b);
  const after = zs.findIndex((z) => z >= mirrorZ);
  assert.ok(after > 0, `${style.id}: no ${onDoor ? "door skin" : "chassis"} vertex column either side of the mirror's z ${mirrorZ} under its height ${mirrorY}`);
  const [z0, z1] = [zs[after - 1]!, zs[after]!];
  const [x0, x1] = [columns.get(z0)!, columns.get(z1)!];
  return x0 + ((x1 - x0) * (mirrorZ - z0)) / (z1 - z0);
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
  // The sedan's body on the platform's hardpoints and flat floor: the rows move one hardpoint from known values.
  const sedan: BodyStyle = { ...CAR_STYLES.sedan, ...PLATFORM_HARDPOINTS, underside: undefined };
  const ride = sedan.dims.rideHeight;

  it("when its underside is raised at the tail, then the section's lowest point and the rocker follow the floor there and nowhere else", () => {
    const moved: BodyStyle = { ...sedan, underside: [[-2.2, ride + 0.155], [-1.6, ride], [1.6, ride]] };
    for (const source of ["drawn", "cage"] as const) {
      const tail = ringLowest(moved, -2.0, source);
      assert.ok(Math.abs(tail - floorY(-2.0, moved)) < 1e-9 && tail > ride + 0.05, `${source}: lowest y at z -2.0 is ${tail}, floor ${floorY(-2.0, moved)}, must be > ${ride + 0.05}`);
      const mid = ringLowest(moved, 0, source);
      assert.ok(Math.abs(mid - ride) < 1e-9, `${source}: lowest y at z 0 is ${mid}, ride height ${ride}`);
    }
    const lift = rockerAt(-2.0, moved) - rockerAt(0, moved);
    assert.ok(Math.abs(lift - (floorY(-2.0, moved) - ride)) < 1e-9, `rocker lifts ${lift} m between z 0 and -2.0, the floor lifts ${floorY(-2.0, moved) - ride}`);
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

  it("when a mirror sits back along a door whose side narrows rearward, then its arm still starts on the door skin there", () => {
    const coupe = CAR_STYLES.coupe;
    // The side tapers 6 cm over the mirror's 0.3 m, so a seat taken at the hinge stands off the skin.
    const profile = coupe.profile.map((s) => ({ ...s, hw: s.hw - 0.2 * Math.max(0, coupe.door.hingeZ - s.z) }));
    const moved: BodyStyle = { ...coupe, profile, door: { ...coupe.door, mirrorZ: 0.3 } };
    const skin = bodySideAtMirror(moved);
    const root = moved.door.hingeX + mirrorSeatX(moved) + MIRROR_ROOT;
    assert.ok(Math.abs(root - skin) < 0.01, `mirror 0.3 m back: arm starts at x ${root}, door skin at x ${skin}`);
  });

  it("when the door and the A-pillar foot move, then the door glass spans from the door's trailing edge to the pillar's foot", () => {
    const sedan = CAR_STYLES.sedan;
    const moved: BodyStyle = { ...sedan, aPillarFoot: 0.88, door: { ...sedan.door, hingeZ: 0.74, length: 1.0 } };
    const box = partBox(makeSideGlass(1, moved));
    const { hingeZ } = moved.door;
    const [rear, front] = [box.min.z + hingeZ + DOOR_GLASS_SEAT.z, box.max.z + hingeZ + DOOR_GLASS_SEAT.z];
    assert.ok(Math.abs(rear - (0.74 - 1.0 + 0.03)) < 0.005, `door glass rear edge at z ${rear}, door trailing edge -0.26 + 0.03`);
    assert.ok(front > 0.86 && front < 0.95, `door glass front edge at z ${front}, around the A-pillar foot 0.88`);
  });

  it("when the A-pillar's top moves back, then the door glass's top-front corner and the pillar's rear top corner follow it", () => {
    const sedan = CAR_STYLES.sedan;
    const moved: BodyStyle = { ...sedan, aPillarTop: 0.3 };
    // glassCorners: 12 floats per pane, doorR is pane 3, its (front, top) corner the fourth.
    const doorTopFrontZ = (style: BodyStyle) => glassCorners(style)[3 * 12 + 9 + 2]!;
    const pillarRearZ = (style: BodyStyle) => partBox(makeGreenhouseFrame(style, "drawn")[0]!).min.z;
    assertSameNumbers([doorTopFrontZ(moved), pillarRearZ(moved)], [0.3, 0.3], "door glass top-front z, A-pillar rear top z", 1e-5);
    const stock = sedan.windshieldTop[1] - 0.05;
    assertSameNumbers([doorTopFrontZ(sedan), aPillarTopZ(sedan)], [stock, stock], "unset: 5 cm behind the windshield's top", 1e-5);
  });

  it("when the side glass drops less under the roof, then the glass top, the roof's side lip and the pillar tops rise with it", () => {
    const sedan = CAR_STYLES.sedan;
    const moved: BodyStyle = { ...sedan, glassTop: 0.05 };
    // glassCorners: doorR is pane 3, its (rear, top) corner the third; the roof loft's vertex 0 is its first ring's lip; frame part 1 is the left B-pillar.
    const rise = (read: (style: BodyStyle) => number) => read(moved) - read(sedan);
    const glass = rise((style) => glassCorners(style)[3 * 12 + 6 + 1]!);
    const lip = rise((style) => makeRoofGeometry(style).getAttribute("position").getY(0));
    const pillar = rise((style) => partBox(makeGreenhouseFrame(style, "drawn")[1]!).max.y);
    assertSameNumbers([glass, lip, pillar], [0.025, 0.025, 0.025], "door glass top, roof lip, B-pillar top rise (m)", 1e-5);
  });

  it("when the side glass top follows its own stations under the roof, then its corners meet them and a painted fill closes the gap to the cant line, drawn only", () => {
    const hatch = CAR_STYLES.hatchback;
    const [zRear, zFront] = [hatch.quarter.zRearTop, aPillarTopZ(hatch)];
    const [yRear, yFront] = [glassTopY(zRear, hatch) - 0.12, glassTopY(zFront, hatch) - 0.04];
    const moved: BodyStyle = { ...hatch, glassTop: [[zRear, yRear], [zFront, yFront]] };
    // glassCorners: quarterR is pane 5, its (rear, top) corner the third; doorR is pane 3, its (front, top) corner the fourth.
    const corners = glassCorners(moved);
    assertSameNumbers([corners[5 * 12 + 6 + 1]!, corners[3 * 12 + 9 + 1]!], [yRear, yFront], "quarter glass rear top y, door glass front top y", 1e-5);
    const [drawn, stock] = [makeGreenhouseFrame(moved, "drawn"), makeGreenhouseFrame(hatch, "drawn")];
    assert.equal(drawn.length - stock.length, 2, "one fill a side");
    const fill = partBox(drawn[drawn.length - 3]!);
    assert.ok(Math.abs(fill.min.y - yRear) < 1e-4 && fill.max.y > glassTopY(zFront, hatch) - 1e-4, `right fill spans y ${fill.min.y}..${fill.max.y}: from the glass top ${yRear} up to the cant line`);
    const cage = (style: BodyStyle) => makeGreenhouseFrame(style, "cage").map((g) => Array.from(g.getAttribute("position").array).join(",")).join("|");
    assert.ok(cage(moved) === cage(hatch), "the cage greenhouse is unchanged");
  });

  it("when a style seats its cameras, then its hood eye stands over its drawn bonnet and ahead of its windshield base", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      if (style.camera === undefined && id !== "sedan") continue;
      const [y, z] = (style.camera ?? PLATFORM_CAMERA).hood;
      const bonnet = topAt(id, z);
      assert.ok(y > bonnet + 0.05 && z > style.windshield.base[1], `${id}: hood eye y ${y} z ${z}: the drawn top there is ${bonnet.toFixed(3)} (5 cm under the eye at most), the windshield base at z ${style.windshield.base[1]}`);
    }
  });

  it("when the sill narrows toward the tail, then the side glass and the C-pillar's foot follow its stations", () => {
    const wagon = CAR_STYLES.wagon;
    const moved: BodyStyle = { ...wagon, belt: { ...wagon.belt, x: [[-1.6, 0.66], [-0.6, 0.85]] } };
    const at = (z: number) => glassX(z, beltY(z, moved), moved);
    assertSameNumbers([at(-1.8), at(-1.1), at(0)], [0.66, 0.755, 0.85], "side glass half-width on the sill at z -1.8, -1.1, 0", 1e-9);
    let footX = -Infinity;
    for (const part of makeGreenhouseFrame(moved, "drawn")) {
      const pos = part.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - moved.quarter.zRearBot) < 0.01 && pos.getX(i) > 0) footX = Math.max(footX, pos.getX(i));
    }
    // The belt rail's rear end stands 1.5 cm outboard of the sill and is 3 cm thick.
    assert.ok(footX > 0.65 && footX < 0.66 + 0.031, `C-pillar foot and belt rail at the quarter's rear z ${moved.quarter.zRearBot} stand out to x ${footX}, sill there 0.66`);
  });

  it("when the tailgate's bottom edge leans out, then its foot moves with it and its hinge edge stays put", () => {
    const hatchback = CAR_STYLES.hatchback;
    const upright: BodyStyle = { ...hatchback, boot: { ...hatchback.boot, z0: hatchback.boot.origin[1] } };
    const moved: BodyStyle = { ...hatchback, boot: { ...hatchback.boot, z0: hatchback.boot.origin[1] - 0.2 } };
    const [was, now] = [makeTrunkGeometry(upright), makeTrunkGeometry(moved)];
    const foot = edgeMeanZ(now, false) - edgeMeanZ(was, false);
    const hinge = edgeMeanZ(now, true) - edgeMeanZ(was, true);
    assert.ok(Math.abs(foot + 0.2) < 0.01, `lowest vertices moved ${foot} m in z, -0.2 asked`);
    assert.ok(Math.abs(hinge) < 0.005, `highest vertices moved ${hinge} m in z, 0 asked`);
  });

  it("when a bumper's wrap starts nearer the middle, then its corners sweep back from its face", () => {
    const moved: BodyStyle = { ...sedan, bumpers: { ...sedan.bumpers, front: { ...sedan.bumpers.front, wrap: { from: 0.25, back: 0.12 } } } };
    // Inside the narrowest nose's half-width, where the platform wrap (from 0.58) leaves the face flat.
    const gap = (style: BodyStyle) => bumperReachAt(makeBumperGeometry(true, style), 0, 0.05) - bumperReachAt(makeBumperGeometry(true, style), 0.35, 0.45);
    const [movedGap, sedanGap] = [gap(moved), gap(sedan)];
    assert.ok(movedGap - sedanGap >= 0.02, `moved bumper's corner at |x| 0.35-0.45 stands ${movedGap} m behind its middle, the platform wrap's ${sedanGap}: at least 0.02 more`);
    assert.ok(Math.abs(sedanGap) < 0.01, `platform-wrap bumper's corner at |x| 0.35-0.45 stands ${sedanGap} m behind its middle, under 0.01`);
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

  it("when its door hinge moves with the door's trailing edge kept, then the door glass stays in the same window: it rides on its door's own hinge", () => {
    const moved: BodyStyle = { ...sedan, door: { ...sedan.door, hingeX: 0.8, hingeY: 0.79, hingeZ: 0.7, length: sedan.door.length + 0.15 } };
    const inCar = (style: BodyStyle) => {
      const box = partBox(makeSideGlass(1, style));
      const { hingeX, hingeY, hingeZ } = style.door;
      return [box.max.x + hingeX + DOOR_GLASS_SEAT.x, box.max.y + hingeY + DOOR_GLASS_SEAT.y, box.max.z + hingeZ + DOOR_GLASS_SEAT.z];
    };
    assertSameNumbers(inCar(moved), inCar(sedan), "right door pane's top corner in the car (x, y, z)", 1e-6);
  });

  it("when its tyres stand outboard of the body, then the wheel-well liners stay inside the body side", () => {
    const moved: BodyStyle = { ...sedan, dims: { ...sedan.dims, track: 2.2 } };
    const box = partBox(makeChassisGeometry(moved, "drawn"));
    const widest = moved.profile.reduce((m, s) => Math.max(m, s.hw), 0);
    assert.ok(box.max.x <= widest + 0.02, `chassis reaches x ${box.max.x} on a 2.2 m track, the body's widest station ${widest}`);
  });

  it("when a cabin tub's floor is set under the body's floor, then the floor holds the body's", () => {
    const moved: BodyStyle = { ...sedan, tubs: [[-0.7, 0.7, ride - 0.1]] };
    for (const source of ["drawn", "cage"] as const) {
      const low = ringLowest(moved, 0, source);
      assert.ok(low >= ride - 1e-9, `${source} section at z 0 reaches down to y ${low}, the body's floor ${ride}`);
    }
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
