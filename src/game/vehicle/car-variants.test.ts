import * as THREE from "three";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeformableCar } from "./car.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES, CAR_STYLE_IDS, FLEET_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { PLATFORM_CAMERA, PLATFORM_HARDPOINTS, st } from "./car-styles/platform.ts";
import { ROCKER, deckTopY, doorAperture, glassTopY, glassX, lerp, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry, roofTopY, sampleSlice, sectionPoints } from "./car-mesh.ts";
import { aPillarTopZ, beltY, floorY, rockerAt } from "./car-lines.ts";
import { doorSkinZ, makeDoorGeometry, mirrorSeatX } from "./car-door-mesh.ts";
import { GRILLE_SEAT, MIRROR_REACH, MIRROR_ROOT, PART_KIND, partGeometry } from "./part-geometry.ts";
import { drawnLamp, drawnPart, lampRest, lampSeatAt } from "./part-variants.ts";
import { makeGreenhouseFrame, makeRoofGeometry } from "./car-greenhouse-mesh.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { withHoodBulge, withRearFittings } from "./car-fittings-mesh.ts";
import { DOOR_GLASS_SEAT, glassCorners, makeRearGlass, makeSideGlass, makeWindshield } from "./car-glass.ts";
import { LIGHT_BAR_FOOT, PAINT_COLOR_TONE, PAINTED_ATTRIBUTE, TRIM_BLACK, TRIM_CHROME, bumperMaterial, makeLightBar, trimMaterial } from "./car-materials.ts";
import { boxShape, newLooseShape } from "./loose-step.ts";
import { wearCarLook } from "../present/car-look.ts";
import { NO_CAR_PICK } from "../match/look-data.ts";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { StreamedDeformation } from "../deform/streamed-deform.ts";
import { PLATFORM_RIG } from "../deform/deform-rig.ts";
import { assertSameDigest, assertSameNumbers } from "./test-support.ts";
import { LampBatch } from "./lamp-lights.ts";
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
/** A bed floor stands within two of the references' pixels of where its spec's bed tub puts it. */
const BED_FLOOR_TOL = 0.03;
/** The references' beds are open about 0.40 m under the rail; under 0.35 m a bed reads as a flatbed. */
const BED_DEPTH = 0.35;
/** Two styles' roofs stand as far apart as their spec heights say, within this (m): under a pixel pair of the references. */
const ROOF_GAP_TOL = 0.01;

/** Whether a style has a deck at `z`: inside its boot lid's span, or ahead of a hatch / tailgate's top edge (its roof over the cargo); behind that a tail panel leans away and no deck stands there. */
function hasDeckAt(style: BodyStyle, z: number): boolean {
  const b = style.boot;
  if (b.kind === "lid") return z >= Math.min(b.z0, b.z1) && z <= Math.max(b.z0, b.z1);
  return z >= b.origin[1];
}

/** Box in the car's frame of every mesh it draws but the light bar and a bumper's fittings (exhaust tips, hitch): the spec leaves them off. */
function shellBox(car: DeformableCar): THREE.Box3 {
  car.group.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  car.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.name === LIGHT_BAR) return;
    const fitting = o.geometry.getAttribute(FITTING_ATTRIBUTE);
    if (!fitting) return void box.expandByObject(o);
    const pos = o.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) if (fitting.getX(i) === 0) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  return box;
}

describe("given every body style's spec dimensions (`BodyStyle.dims`)", () => {
  for (const id of CAR_STYLE_IDS) {
    const d = CAR_STYLES[id].dims;

    it(`when a ${id} is built, then its drawn shell's nose, tail, width and roof, and its body's floor pan, stand where its dims put them, within ${DIMS_TOL * 1000} mm`, () => {
      const b = shellBox(cars[id]);
      // The floor is the body's (a bumper may hang under it: the monster's).
      const floor = new THREE.Box3().setFromObject(cars[id].body).min.y;
      const half = d.wheelbase / 2;
      assertSameNumbers(
        [b.max.z, b.min.z, b.max.x - b.min.x, b.max.y, floor],
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
  it("when the sedan is measured, then it is a fastback: the roof stands over the cabin and the rear glass falls from it in one slope to a short deck", () => {
    assert.ok(topAt("sedan", -0.2) > 1.25);
    const glassTop = topAt("sedan", -1.2);
    const glassMid = topAt("sedan", -1.45);
    const deck = topAt("sedan", -1.9);
    assert.ok(glassTop > 1.15 && glassTop < 1.26, `sedan rear glass top at z=-1.2 is ${glassTop}`);
    assert.ok(glassMid > 1.05 && glassMid < glassTop - 0.07, `sedan rear glass at z=-1.45 is ${glassMid}`);
    assert.ok(deck > 0.9 && deck < 1.02, `sedan deck at z=-1.9 is ${deck}`);
  });

  it("when the wagon's roof is measured 1.2 m and 1.5 m behind the centre, then it runs on past the sedan's toward the tail, above 1.2 m at both", () => {
    for (const z of [-1.2, -1.5]) assert.ok(topAt("wagon", z) > 1.2, `wagon roof at z=${z} is ${topAt("wagon", z)}`);
  });

  it("when the hatchback is measured, then its roof runs on toward the tail but its tail drops at least 0.2 m below the wagon's", () => {
    assert.ok(topAt("hatchback", -1.2) > 1.2, `hatch roof ${topAt("hatchback", -1.2)}`);
    assert.ok(topAt("hatchback", -1.75) < topAt("wagon", -1.75) - 0.2, "hatch tail is as tall as the wagon's");
  });

  it("when the muscle (coupe) is measured, then its roof sits lower than the sedan's by the gap between their spec heights", () => {
    const gap = CAR_STYLES.sedan.dims.height - CAR_STYLES.coupe.dims.height;
    const measured = topAt("sedan", -0.2) - topAt("coupe", -0.2);
    assert.ok(measured > 0 && Math.abs(measured - gap) <= ROOF_GAP_TOL, `coupe ${topAt("coupe", -0.2)} sedan ${topAt("sedan", -0.2)}: ${measured} m apart against the specs' ${gap}`);
  });

  it("when the pickup and the monster are measured, then each has a cab roof and an open bed: its floor where its spec's bed tub puts it, deep under its rail, and lower than every other style's deck", () => {
    const beds: readonly CarStyleId[] = ["pickup", "monster"];
    for (const id of beds) {
      assert.ok(topAt(id, -0.2) > 1.25, `${id} cab roof ${topAt(id, -0.2)}`);
      const style = CAR_STYLES[id];
      const [zRear, zFront, floorY] = style.tubs.at(-1)!;
      const mid = (zRear + zFront) / 2;
      const floor = topAt(id, mid);
      assert.ok(Math.abs(floor - floorY) <= BED_FLOOR_TOL, `${id} bed floor ${floor} at z=${mid} vs its tub's ${floorY}`);
      const rail = sampleSlice(mid, style.profile).yBelt;
      assert.ok(rail - floor >= BED_DEPTH, `${id} bed ${rail - floor} m deep under its rail at ${rail}`);
    }
    for (const z of [-1.1, -1.7]) {
      for (const id of CAR_STYLE_IDS) {
        if (beds.includes(id) || !hasDeckAt(CAR_STYLES[id], z)) continue;
        assert.ok(topAt(id, z) > 0.78, `${id} deck at z=${z}`);
        for (const bed of beds) assert.ok(topAt(bed, z) < topAt(id, z), `${bed} bed floor ${topAt(bed, z)} at z=${z} against the ${id} deck ${topAt(id, z)}`);
      }
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

/** The platform's cowl-to-nose stations (every style's front clip before each drew its own): a nose wide enough that a bumper's corners never clamp. */
const PLATFORM_NOSE = [st(0.82, 0.87, 0.8, 1.05, 0.52, 0.4), st(1.18, 0.86, 0.775), st(1.58, 0.83, 0.72), st(1.9, 0.75, 0.64), st(2.11, 0.62, 0.54)];

describe("given a body style's own hardpoints (windshield, belt, hood, bumpers, rocker, floor, arches)", () => {
  // The sedan's body on the platform's hardpoints, nose and flat floor: the rows move one hardpoint from known values (the sedan's own narrow nose would clamp the bumper's corners).
  const sedan: BodyStyle = { ...CAR_STYLES.sedan, ...PLATFORM_HARDPOINTS, profile: [...CAR_STYLES.sedan.profile.filter((s) => s.z < PLATFORM_NOSE[0]!.z), ...PLATFORM_NOSE], underside: undefined };
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

/** The door skin's outer x (car frame) at the mirror's seat: the widest drawn triangle covering its height and z, which beats the slab's inner face. Throws, naming the style, with no triangle there. */
function doorSkinAtMirror(style: BodyStyle): number {
  const d = style.door;
  const geo = makeDoorGeometry(1, style);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const index = geo.index!;
  const [zT, yT] = [-(d.mirrorZ ?? 0) - doorSkinZ(style), d.mirrorY];
  let widest = -Infinity;
  for (let k = 0; k < index.count; k += 3) {
    const [a, b, c] = [index.getX(k), index.getX(k + 1), index.getX(k + 2)];
    const [za, ya, zb, yb, zc, yc] = [pos.getZ(a), pos.getY(a), pos.getZ(b), pos.getY(b), pos.getZ(c), pos.getY(c)];
    const det = (yb - yc) * (za - zc) + (zc - zb) * (ya - yc);
    if (Math.abs(det) < 1e-12) continue;
    const wa = ((yb - yc) * (zT - zc) + (zc - zb) * (yT - yc)) / det;
    const wb = ((yc - ya) * (zT - zc) + (za - zc) * (yT - yc)) / det;
    const wc = 1 - wa - wb;
    if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
    widest = Math.max(widest, wa * pos.getX(a) + wb * pos.getX(b) + wc * pos.getX(c));
  }
  assert.ok(widest > -Infinity, `${style.id}: no door skin triangle at the mirror's z ${zT} and height ${yT}`);
  return d.hingeX + widest;
}

/**
 * The outer x of the body at the mirror's seat (its z, just under its height): the door skin's, exactly at the seat, where it is in the door cut,
 * else the chassis' outside the cut (its rings are sparse in height, so over 8 cm under the seat); linear between the two nearest vertex
 * columns in z, the widest vertex of each. Throws, naming the style, with no column either side.
 */
function bodySideAtMirror(style: BodyStyle): number {
  const d = style.door;
  const mirrorY = d.hingeY + d.mirrorY;
  const mirrorZ = d.hingeZ - (d.mirrorZ ?? 0);
  if (doorAperture(mirrorZ, style) > 0) return doorSkinAtMirror(style);
  const geo = makeChassisGeometry(style, "drawn");
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const columns = new Map<number, number>();
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    if (x <= 0 || y < mirrorY - 0.08 || y > mirrorY || doorAperture(z, style) > 0) continue;
    const key = Math.round(z * 1e4) / 1e4;
    columns.set(key, Math.max(columns.get(key) ?? -Infinity, x));
  }
  const zs = [...columns.keys()].sort((a, b) => a - b);
  const after = zs.findIndex((z) => z >= mirrorZ);
  assert.ok(after > 0, `${style.id}: no chassis vertex column either side of the mirror's z ${mirrorZ} under its height ${mirrorY}`);
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
      const root = style.door.hingeX + mirrorSeatX(style) + MIRROR_ROOT * (style.door.mirrorReach / MIRROR_REACH);
      assert.ok(Math.abs(root - side) < 0.005, `${id}: mirror arm starts at x ${root}, body side at x ${side}`);
    }
  });

  it("when a mirror sits back along a door whose side narrows rearward, then its arm still starts on the door skin there", () => {
    const coupe = CAR_STYLES.coupe;
    // The side tapers 6 cm over the mirror's 0.3 m, so a seat taken at the hinge stands off the skin.
    const profile = coupe.profile.map((s) => ({ ...s, hw: s.hw - 0.2 * Math.max(0, coupe.door.hingeZ - s.z) }));
    // On the door's face, under its top: the probe reads the skin triangle at the mirror's own height.
    const moved: BodyStyle = { ...coupe, profile, door: { ...coupe.door, mirrorZ: 0.3, mirrorY: Math.min(coupe.door.mirrorY, coupe.door.halfHeight - 0.05) } };
    const skin = bodySideAtMirror(moved);
    const root = moved.door.hingeX + mirrorSeatX(moved) + MIRROR_ROOT * (moved.door.mirrorReach / MIRROR_REACH);
    assert.ok(Math.abs(root - skin) < 0.005, `mirror 0.3 m back: arm starts at x ${root}, door skin at x ${skin}`);
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
    const sedan: BodyStyle = { ...CAR_STYLES.sedan, aPillarTop: undefined };
    const moved: BodyStyle = { ...sedan, aPillarTop: 0.3 };
    // glassCorners: 12 floats per pane, doorR is pane 3, its (front, top) corner the fourth.
    const doorTopFrontZ = (style: BodyStyle) => glassCorners(style)[3 * 12 + 9 + 2]!;
    const pillarRearZ = (style: BodyStyle) => partBox(makeGreenhouseFrame(style, "drawn")[0]!).min.z;
    assertSameNumbers([doorTopFrontZ(moved), pillarRearZ(moved)], [0.3, 0.3], "door glass top-front z, A-pillar rear top z", 1e-5);
    const stock = sedan.windshieldTop[1] - 0.05;
    assertSameNumbers([doorTopFrontZ(sedan), aPillarTopZ(sedan)], [stock, stock], "unset: 5 cm behind the windshield's top", 1e-5);
  });

  it("when the side glass drops less under the roof, then the glass top, the roof's side lip and the pillar tops rise with it", () => {
    const sedan: BodyStyle = { ...CAR_STYLES.sedan, glassTop: undefined };
    const moved: BodyStyle = { ...sedan, glassTop: 0.05 };
    // glassCorners: doorR is pane 3, its (rear, top) corner the third; the roof loft's vertex 0 is its first ring's lip; frame part 1 is the left B-pillar.
    const rise = (read: (style: BodyStyle) => number) => read(moved) - read(sedan);
    const glass = rise((style) => glassCorners(style)[3 * 12 + 6 + 1]!);
    const lip = rise((style) => makeRoofGeometry(style).getAttribute("position").getY(0));
    const pillar = rise((style) => partBox(makeGreenhouseFrame(style, "drawn")[1]!).max.y);
    assertSameNumbers([glass, lip, pillar], [0.025, 0.025, 0.025], "door glass top, roof lip, B-pillar top rise (m)", 1e-5);
  });

  it("when the side glass top follows its own stations under the roof, then its corners meet them and a painted fill closes the gap to the cant line, drawn only", () => {
    const hatch: BodyStyle = { ...CAR_STYLES.hatchback, glassTop: undefined };
    const [zRear, zFront] = [hatch.quarter.zRearTop, aPillarTopZ(hatch)];
    const [yRear, yFront] = [glassTopY(zRear, hatch) - 0.12, glassTopY(zFront, hatch) - 0.04];
    const moved: BodyStyle = { ...hatch, glassTop: [[zRear, yRear], [zFront, yFront]] };
    // glassCorners: quarterR is pane 5, its (rear, top) corner the third; doorR is pane 3, its (front, top) corner the fourth.
    const corners = glassCorners(moved);
    assertSameNumbers([corners[5 * 12 + 6 + 1]!, corners[3 * 12 + 9 + 1]!], [yRear, yFront], "quarter glass rear top y, door glass front top y", 1e-5);
    const [drawn, stock] = [makeGreenhouseFrame(moved, "drawn"), makeGreenhouseFrame(hatch, "drawn")];
    assert.equal(drawn.length - stock.length, 2, "one fill a side");
    const fill = partBox(drawn[drawn.length - 3]!);
    const low = Math.min(yRear, yFront);
    assert.ok(Math.abs(fill.min.y - low) < 1e-4 && fill.max.y > glassTopY(zFront, hatch) - 1e-4, `right fill spans y ${fill.min.y}..${fill.max.y}: from the glass top's low end ${low} up to the cant line`);
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
    it: "when a rear bumper carries twin round tips, then a chrome oval with a dark rear-facing throat stands at each of ±x at its y, its size across, ending at the bumper's face (none past it), and the cage builds are unchanged",
    exhaust: { tips: 2, x: 0.55, y: 0.22, size: [0.09, 0.06], shape: "round" },
    expectedXs: [-0.55, 0.55],
  },
  {
    it: "when a rear bumper carries one rectangular tip, then one chrome box with a dark rear-facing throat stands at its x and y, its size across, ending at the bumper's face (none past it), and the cage builds are unchanged",
    exhaust: { tips: 1, x: 0.4, y: 0.25, size: [0.12, 0.06], shape: "rect" },
    expectedXs: [0.4],
  },
] as const;
/** A round tip's 14-sided tube spans this share of its width (its widest chord). */
const ROUND_TIP_SPAN = 0.97;
/** A tip ends within this (m) inside the bumper's rearmost face: flush in the lower band, not proud of the tail. */
const TIP_FLUSH = 0.01;

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
    const pickup = { ...CAR_STYLES.pickup, bumpers: { ...CAR_STYLES.pickup.bumpers, rear: { ...CAR_STYLES.pickup.bumpers.rear, hitch: false } }, exhaust: undefined };
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
        assert.ok(tip.min.z >= face.min.z && tip.min.z < face.min.z + TIP_FLUSH && throats > 0 && throatBack < -0.99, `the tip ends at z ${tip.min.z.toFixed(3)}, the face at ${face.min.z.toFixed(3)}; ${throats} throat vertices, normal z up to ${throatBack.toFixed(3)}`);
        assert.ok(toneBox(fitted, null, 0).box.min.z >= face.min.z, "nothing of the fittings stands past the bumper's face");
      }
      assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
    });
  }
});

type MirrorSpec = NonNullable<BodyStyle["door"]["mirror"]>;
/** A drawn mirror's foot meets the drawn skin at its seat within this (m). */
const MIRROR_SEAT_TOL = 0.005;

/** The sedan with `mirror` on its door, 4 cm short of the platform's reach: the seat's x-scale (0.81, the sim's) would squash a shared mirror. */
function mirrorStyle(mirror: MirrorSpec): BodyStyle {
  const sedan = CAR_STYLES.sedan;
  return { ...sedan, door: { ...sedan.door, mirrorReach: 0.17, mirror } };
}

/** `style`'s right drawn mirror in the car frame (its seat's x-scale applied): its innermost and outermost x, the box of its painted cap, and its outermost vertex's colour. */
function readMirror(style: BodyStyle): { inner: number; outer: number; cap: THREE.Box3; tip: THREE.Color } {
  const scaleX = style.door.mirrorReach / MIRROR_REACH;
  const seat = style.door.hingeX + mirrorSeatX(style);
  const geo = drawnPart(PART_KIND.mirrorR, style).geometry;
  const [pos, painted, colour] = [geo.getAttribute("position"), geo.getAttribute(PAINTED_ATTRIBUTE), geo.getAttribute("color")];
  const cap = new THREE.Box3();
  let [inner, outer, tip] = [Infinity, -Infinity, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = seat + pos.getX(i) * scaleX;
    inner = Math.min(inner, x);
    if (x > outer) [outer, tip] = [x, i];
    if (painted.getX(i) === 1) cap.expandByPoint(new THREE.Vector3(x, pos.getY(i), pos.getZ(i)));
  }
  return { inner, outer, cap, tip: new THREE.Color(colour.getX(tip), colour.getY(tip), colour.getZ(tip)) };
}

/** A sedan built while its table door carries `mirror` (put back after). */
function sedanWithMirror(mirror: MirrorSpec): DeformableCar {
  const sedan = CAR_STYLES.sedan;
  const door = sedan.door;
  sedan.door = { ...door, mirror };
  try {
    return new DeformableCar(PAINT, scene, null, "sedan");
  } finally {
    sedan.door = door;
  }
}

/** What the sim reads off car `car`'s mirror `i`: its seat's pose, its rest box, and the box its torn part flies as. */
function mirrorSimReading(car: DeformableCar, i: 0 | 1): string {
  const seat = car.partSeats[i === 0 ? PART_KIND.mirrorL : PART_KIND.mirrorR]!;
  const rest = car["mirrorRestBox"](i);
  const torn = newLooseShape();
  boxShape(torn, seat);
  return [...seat.position.toArray(), ...seat.scale.toArray(), ...rest.min.toArray(), ...rest.max.toArray(), torn.reach, ...torn.centre.toArray(), ...torn.points].join();
}

describe("given a body style's P2 parts", () => {
  it("when a door carries its own mirror, then its cap is its own size, unsquashed, its outer face at the door's mirror reach, its foot on the drawn skin at the seat, and the seat and cage builds are unchanged", () => {
    const size = [0.14, 0.09, 0.07] as const;
    const style = mirrorStyle({ cap: "rounded", finish: "body", size });
    const { inner, outer, cap } = readMirror(style);
    const capSize = cap.getSize(new THREE.Vector3());
    assertSameNumbers([capSize.x, capSize.y, capSize.z, outer], [...size, style.door.hingeX + mirrorSeatX(style) + style.door.mirrorReach], "the cap's w, h, d and its outer face", POSITION_TOL);
    const skin = bodySideAtMirror(style);
    assert.ok(Math.abs(inner - skin) < MIRROR_SEAT_TOL, `the foot starts at x ${inner}, the drawn skin at ${skin}`);
    assert.ok(mirrorSeatX(style) === mirrorSeatX({ ...style, door: { ...CAR_STYLES.sedan.door, mirrorReach: style.door.mirrorReach } }), "the seat is the platform mirror's at that reach");
    assert.ok(cageHash(style) === cageHash(CAR_STYLES.sedan), "the cage builds are unchanged");
  });

  it("when a mirror's finish is black or chrome, then its cap wears that tone and nothing takes paint; when it is body, its cap carries the paint's tone for its door's colour", () => {
    for (const [finish, hex] of [["black", TRIM_BLACK], ["chrome", TRIM_CHROME]] as const) {
      const { cap, tip } = readMirror(mirrorStyle({ cap: "box", finish }));
      assert.ok(cap.isEmpty(), `${finish}: nothing is painted`);
      assert.equal(tip.getHex(), hex, `${finish}: the cap's outer face`);
    }
    const { cap, tip } = readMirror(mirrorStyle({ cap: "rounded", finish: "body" }));
    assert.ok(!cap.isEmpty() && tip.getHex() === PAINT_COLOR_TONE.getHex(), `body: the cap is painted, its outer face 0x${tip.getHexString()}`);
  });

  it("when a style has no mirror or grille of its own, then its seats draw the platform parts", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const own = [style.door.mirror, style.door.mirror, style.grille];
      for (const [k, kind] of [PART_KIND.mirrorL, PART_KIND.mirrorR, PART_KIND.grille].entries()) {
        const seat = cars[id].partSeats[kind]!;
        assert.ok(own[k] !== undefined || (seat.drawn === partGeometry(kind) && seat.variant === 0 && drawnPart(kind, style).geometry === partGeometry(kind)), `${id} kind ${kind}`);
      }
    }
  });

  it("when a car's style carries its own mirror, then its seats and torn mirrors draw it in the door's paint, and a look's door colour, while every box the sim reads stays the platform mirror's", () => {
    const own = sedanWithMirror({ cap: "rounded", finish: "body" });
    const plain = new DeformableCar(PAINT, scene, null, "sedan");
    const seat = own.partSeats[PART_KIND.mirrorR]!;
    assert.ok(seat.geometry === partGeometry(PART_KIND.mirrorR) && seat.drawn !== seat.geometry, "the sim's shape is the platform mirror's, the drawn one its own");
    assert.equal(seat.tint.getHex(), PAINT.body, "the cap takes the door's paint");
    wearCarLook(own, { ...NO_CAR_PICK, doors: 0x336699 }, null);
    assert.equal(seat.tint.getHex(), 0x336699, "and a look's door colour");
    for (const car of [own, plain]) for (const side of [-1, 1]) car.breakMirror(side, new THREE.Vector3(side, 0.5, 0));
    for (const i of [0, 1] as const) assert.equal(mirrorSimReading(own, i), mirrorSimReading(plain, i), `mirror ${i}: seat, rest box and torn box`);
    const loose = seat.children.find((c): c is THREE.Mesh => c instanceof THREE.Mesh)!;
    const [painted, colour] = [loose.geometry.getAttribute(PAINTED_ATTRIBUTE), loose.geometry.getAttribute("color")];
    const k = Array.from({ length: painted.count }, (_, i) => i).find((i) => painted.getX(i) === 1)!;
    const want = PAINT_COLOR_TONE.clone().multiply(new THREE.Color(0x336699));
    assertSameNumbers([colour.getX(k), colour.getY(k), colour.getZ(k)], [want.r, want.g, want.b], "the torn cap keeps its paint", 1e-6);
  });

  it("when a front bumper carries its own grille, then its surround fills its size at its height with its face at its z, in its finish, and the grille seat and the cage builds are unchanged", () => {
    const sedan = CAR_STYLES.sedan;
    const seat = sedan.bumpers.front.seat;
    const grille = { y: 0.48, z: seat.z + 0.07, size: [0.6, 0.12], kind: "bars", finish: "chrome" } as const;
    const style: BodyStyle = { ...sedan, grille, lamps: { ...sedan.lamps, shapes: undefined } };
    const geo = drawnPart(PART_KIND.grille, style).geometry;
    const box = toneBox(geo, null, 0).box.translate(new THREE.Vector3(0, seat.y + GRILLE_SEAT.y, seat.z + GRILLE_SEAT.z));
    const [size, centre] = [box.getSize(new THREE.Vector3()), box.getCenter(new THREE.Vector3())];
    assertSameNumbers([size.x, size.y, centre.y, box.max.z], [...grille.size, grille.y, grille.z], "the grille's w, h, centre height and face", POSITION_TOL);
    const colour = geo.getAttribute("color");
    const chrome = new THREE.Color(TRIM_CHROME);
    assert.ok(Array.from({ length: colour.count }, (_, i) => i).some((i) => Math.abs(colour.getX(i) - chrome.r) < 1e-6), "its surround and bars are chrome");
    const plain: BodyStyle = { ...style, grille: undefined };
    assert.ok(drawnPart(PART_KIND.grille, plain).geometry === partGeometry(PART_KIND.grille), "without the field, the platform grille");
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a style draws its own head lamp to an outline, then its lit lens fills the outline 1-6 mm proud of the skin, the left lamp mirrors the right, and the cage builds are unchanged", () => {
    const sedan = CAR_STYLES.sedan;
    const [x, y] = [0.53, 0.51];
    const loop = { points: [[x - 0.08, y - 0.03], [x + 0.08, y - 0.03], [x + 0.08, y + 0.03], [x - 0.08, y + 0.03]] } as const;
    const style: BodyStyle = { ...sedan, lamps: { ...sedan.lamps, head: [x, y], shapes: { head: { loops: [loop], lens: "lit", bezel: "chrome" } } } };
    const skin = new THREE.Mesh(makeChassisGeometry(style));
    const ray = new THREE.Raycaster();
    const lens = [-1, 1].map((side) => {
      const rest = new THREE.Matrix4().compose(lampSeatAt(style, "head", side), lampRest("head", style, new THREE.Quaternion()), new THREE.Vector3(1, 1, 1));
      const geo = drawnLamp(style, "head", side).geometry.clone().applyMatrix4(rest);
      const [pos, nrm, uv] = [geo.getAttribute("position"), geo.getAttribute("normal"), geo.getAttribute("uv")];
      // Each lit vertex back onto the skin along its normal: the lens's footprint, and how far proud of it the lens stands.
      const [footprint, drawn] = [new THREE.Box3(), new THREE.Box3()];
      let [low, high] = [Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++) {
        if (uv.getX(i) !== 0.75) continue;
        const [v, n] = [new THREE.Vector3().fromBufferAttribute(pos, i), new THREE.Vector3().fromBufferAttribute(nrm, i)];
        drawn.expandByPoint(v);
        ray.set(v.clone().addScaledVector(n, 0.05), n.clone().negate());
        const hit = ray.intersectObject(skin, false)[0]!;
        footprint.expandByPoint(hit.point);
        [low, high] = [Math.min(low, hit.distance - 0.05), Math.max(high, hit.distance - 0.05)];
      }
      return { footprint, drawn, low, high };
    });
    const [l, r] = [lens[0]!, lens[1]!];
    assert.ok(!r.footprint.isEmpty(), "the control: the lit lens is drawn");
    assertSameNumbers([r.footprint.min.x, r.footprint.max.x, r.footprint.min.y, r.footprint.max.y], [x - 0.08, x + 0.08, y - 0.03, y + 0.03], "the lens fills its outline", 0.003);
    assertSameNumbers([l.drawn.min.x, l.drawn.max.x], [-r.drawn.max.x, -r.drawn.min.x], "the left lamp mirrors the right", POSITION_TOL);
    assert.ok(r.low > 0.001 && r.high < 0.006, `the lens stands ${(r.low * 1000).toFixed(1)}-${(r.high * 1000).toFixed(1)} mm off the skin`);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a grille is a trapezoid hex mesh with a badge, then its surround is its width at the top and `bottom` at the bottom, and a chrome badge sits at its centre", () => {
    const sedan = CAR_STYLES.sedan;
    const seat = sedan.bumpers.front.seat;
    const grille = { y: 0.45, size: [0.7, 0.24], bottom: 0.5, kind: "hex", badge: 0.03, finish: "black" } as const;
    const geo = drawnPart(PART_KIND.grille, { ...sedan, grille, lamps: { ...sedan.lamps, shapes: undefined } }).geometry;
    const [pos, colour] = [geo.getAttribute("position"), geo.getAttribute("color")];
    const cy = grille.y - seat.y - GRILLE_SEAT.y;
    const widthAt = (y: number): number => 2 * Math.max(...Array.from({ length: pos.count }, (_, i) => (Math.abs(pos.getY(i) - y) < 1e-4 ? Math.abs(pos.getX(i)) : 0)));
    assertSameNumbers([widthAt(cy + 0.12), widthAt(cy - 0.12)], [0.7, 0.5], "the surround's width at its top and bottom", 1e-4);
    const chrome = new THREE.Color(TRIM_CHROME);
    const badge = Array.from({ length: pos.count }, (_, i) => i).filter((i) => Math.hypot(pos.getX(i), pos.getY(i) - cy) < grille.badge + 1e-4 && Math.abs(colour.getX(i) - chrome.r) < 1e-6);
    assert.ok(badge.length > 0, "a chrome badge at the centre of a black grille");
  });

  it("when a style puts lamps on its bumpers, then the grille seat draws the front ones on the fascia and the tail trim the rear ones, with no shared dark strip across the tail", () => {
    const sedan = CAR_STYLES.sedan;
    const meet = (front: boolean, x: number, y: number): number => {
      const { seat } = sedan.bumpers[front ? "front" : "rear"];
      const fascia = new THREE.Mesh(makeBumperGeometry(front, sedan).translate(0, seat.y, front ? seat.z : -seat.z));
      return new THREE.Raycaster(new THREE.Vector3(x, y, front ? 5 : -5), new THREE.Vector3(0, 0, front ? -1 : 1)).intersectObject(fascia, false)[0]!.point.z;
    };
    const near = (geo: THREE.BufferGeometry, offset: THREE.Vector3, at: THREE.Vector3): boolean => {
      const pos = geo.getAttribute("position");
      return Array.from({ length: pos.count }, (_, i) => i).some((i) => new THREE.Vector3().fromBufferAttribute(pos, i).add(offset).distanceTo(at) < 0.015);
    };
    const { front, rear } = sedan.bumpers;
    const grille = drawnPart(PART_KIND.grille, sedan).geometry;
    const grilleAt = new THREE.Vector3(0, front.seat.y + GRILLE_SEAT.y, front.seat.z + GRILLE_SEAT.z);
    for (const x of [-0.6, 0.6]) assert.ok(near(grille, grilleAt, new THREE.Vector3(x, 0.305, meet(true, Math.abs(x), 0.305))), `the fog lens at x ${x} on the fascia`);
    const trim = drawnPart(PART_KIND.tailTrim, sedan).geometry;
    const trimAt = new THREE.Vector3(0, rear.seat.y, -rear.seat.z);
    for (const x of [-0.62, 0.62]) assert.ok(near(trim, trimAt, new THREE.Vector3(x, 0.495, meet(false, Math.abs(x), 0.495))), `the reflector at x ${x} on the fascia`);
    const plate = partGeometry(PART_KIND.tailTrim);
    plate.computeBoundingBox();
    assert.ok(plate.boundingBox!.max.x - plate.boundingBox!.min.x < 0.4, `the platform tail trim is the plate alone, ${(plate.boundingBox!.max.x - plate.boundingBox!.min.x).toFixed(2)} m wide`);
  });

  it("when a tail lamp's outline runs onto the boot lid, then the lid carries that share and opens with it, and the body keeps the rest", () => {
    const car = new DeformableCar(PAINT, new THREE.Scene(), null, "hatchback");
    const lid = car.lampFittings.find((f) => f.kind === "boot");
    assert.ok(lid, "the hatch carries a share of the tails");
    const trunk = lid.seat.parent as THREE.Mesh;
    assert.ok(trunk.parent && trunk.position.z === car.style.boot.origin[1], "riding the lid itself");
    car.group.updateMatrixWorld(true);
    // Nearest distance (m) from a car-frame point to a mesh's surface.
    const gap = (mesh: THREE.Mesh, p: THREE.Vector3): number => {
      const [pos, index] = [mesh.geometry.getAttribute("position"), mesh.geometry.getIndex()!];
      const [tri, q] = [new THREE.Triangle(), new THREE.Vector3()];
      let best = Infinity;
      for (let t = 0; t < index.count; t += 3) {
        tri.set(...([0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, index.getX(t + k)).applyMatrix4(mesh.matrixWorld)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]));
        best = Math.min(best, tri.closestPointToPoint(p, q).distanceTo(p));
      }
      return best;
    };
    // Every lid-share triangle has a corner on the lid (lens and bezel stand at most 1.6 cm off it); the body's share is probed in lamps.test.
    const lidShare = drawnLamp(car.style, "boot", 0).geometry;
    const [pos, index] = [lidShare.getAttribute("position"), lidShare.getIndex()!];
    const off = Array.from({ length: pos.count }, (_, i) => gap(trunk, new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(trunk.matrixWorld)));
    let loose = 0;
    for (let t = 0; t < index.count; t += 3) if (Math.min(off[index.getX(t)]!, off[index.getX(t + 1)]!, off[index.getX(t + 2)]!) > 0.016) loose++;
    assert.equal(loose, 0, "lid-share triangles off the lid");
    assert.ok(drawnLamp(car.style, "tail", 1).geometry.getIndex()!.count > 0, "the body keeps a share");
    trunk.rotation.x = 0.6;
    car.group.updateMatrixWorld(true);
    const batch = new LampBatch(2);
    batch.sync([car]);
    const got = new THREE.Matrix4();
    batch.meshes[7]!.getMatrixAt(0, got);
    for (let k = 0; k < 16; k++) assert.ok(Math.abs(got.elements[k]! - trunk.matrixWorld.elements[k]!) < 1e-6, `the opened lid's pose, element ${k}`);
  });
});
