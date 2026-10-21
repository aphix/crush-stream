import * as THREE from "three";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeformableCar } from "./car.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES, CAR_STYLE_IDS, FLEET_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { PLATFORM_CAMERA, PLATFORM_HARDPOINTS, st } from "./car-styles/platform.ts";
import { ROCKER, cantY, deckTopY, doorAperture, glassTopY, glassX, lerp, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry, roofAt, roofTopY, sampleSlice, sectionPoints } from "./car-mesh.ts";
import { aPillarTopZ, aPostRearZ, beltY, floorY, rockerAt } from "./car-lines.ts";
import { doorSkinZ, drawnDoorCard, makeDoorGeometry, mirrorSeatX } from "./car-door-mesh.ts";
import { MIRROR_REACH, MIRROR_ROOT, PART_KIND, partGeometry, styleMirrorDrawn } from "./part-geometry.ts";
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
import { FRAME_HZ } from "../kernel/constants.ts";
import { FITTING_ATTRIBUTE, FITTING_TONE, LIGHT_BAR, PRIMER_ATTRIBUTE } from "./constants.ts";
import { bootPivot, lidSpec, roofHinged } from "./hinge-spec.ts";

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

/** The left drawn A-post and, when the door glass starts behind it, the sail between them. */
function aPillarParts(style: BodyStyle): THREE.BufferGeometry[] {
  const parts = makeGreenhouseFrame(style, "drawn");
  const sail = parts.find((g) => g.name === "sail");
  return [parts.find((g) => g.name === "a")!, ...(sail ? [sail] : [])];
}

/** Side view of `geo` against the windshield's edge line: each vertex's distance behind it (m; negative in front of it). */
function behindWindshieldEdge(geo: THREE.BufferGeometry, style: BodyStyle): number[] {
  const [baseY, baseZ] = style.windshield.base;
  const [topY, topZ] = style.windshieldTop;
  const run = Math.sqrt((topZ - baseZ) ** 2 + (topY - baseY) ** 2);
  const [uz, uy] = [(topZ - baseZ) / run, (topY - baseY) / run];
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  return Array.from({ length: pos.count }, (_, i) => (pos.getY(i) - baseY) * uz - (pos.getZ(i) - baseZ) * uy);
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
      const [oy, oz] = bootPivot(style.boot);
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

/** The owner's lids (docs/DOOR_RIG.md, Lids): a sedan's lid hinged at the rear window's base wraps the tail down to its lamps; a hatch is a roof-hinged lid wrapping down a leaning tail face to just above the bumper. */
const WRAPPED: readonly [string, BodyStyle][] = [
  ["sedan", { ...CAR_STYLES.sedan, boot: { kind: "lid", z0: -1.65, z1: -2.06, origin: [0.97, -1.62], pivot: [1.02, -1.65], drop: { y: 0.5, w: 0.47 } } }],
  ["hatchback", { ...CAR_STYLES.hatchback, boot: { kind: "lid", z0: -1.61, z1: -1.716, origin: [0.94, -1.61], pivot: [1.28, -1.15], drop: { y: 0.57, w: 0.43, z: -1.775 } } }],
];

describe("given a deck lid that wraps the tail (boot.drop)", () => {
  for (const [id, style] of WRAPPED) {
    it(`when a ${id}'s wrapping lid is built, then it folds down the rear face to drop.y, its bottom edge at drop.z (else z1), drop.w wide, inside its cage with no clamping`, () => {
      const boot = style.boot;
      assert.ok(boot.kind === "lid" && boot.drop !== undefined);
      const [py, pz] = bootPivot(boot);
      const geo = makeTrunkGeometry(style);
      const pos = geo.getAttribute("position") as THREE.BufferAttribute;
      let low = Infinity;
      let back = Infinity;
      let faceW = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) + py;
        low = Math.min(low, y);
        if (y > boot.drop.y + 1e-6) continue;
        back = Math.min(back, pos.getZ(i) + pz);
        faceW = Math.max(faceW, Math.abs(pos.getX(i)));
      }
      const bottomZ = boot.drop.z ?? boot.z1;
      assert.ok(Math.abs(low - boot.drop.y) < 1e-6 && Math.abs(faceW - boot.drop.w) < 1e-6, `${id} face bottom ${low} m, half-width ${faceW} m`);
      assert.ok(back < bottomZ && back > bottomZ - 0.02, `${id} face bottom edge at z ${back}`);
      const d = new StreamedDeformation(makeChassisGeometry(style), carFrame(style).rig);
      assert.ok(panelClamp(d, geo, "boot", new THREE.Vector3(0, py, pz)) < 1e-4, `${id} boot clamped`);
    });
  }

  it("when their hinges are read, then the sedan's lid is a torsion-bar deck lid and the roof-hinged hatch a strutted hatch carrying its glass", () => {
    const [sedan, hatch] = WRAPPED.map(([, s]) => s.boot);
    assert.ok(!roofHinged(sedan!) && lidSpec(sedan!).kg === 12.4 && lidSpec(sedan!).dir === 1, `sedan ${JSON.stringify(lidSpec(sedan!))}`);
    assert.ok(roofHinged(hatch!) && lidSpec(hatch!).kg === 18 && lidSpec(hatch!).dir === 1, `hatch ${JSON.stringify(lidSpec(hatch!))}`);
  });
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
    // Without the style's own B band, which ends the pane at the band instead.
    const moved: BodyStyle = { ...sedan, pillars: undefined, aPillarFoot: 0.88, door: { ...sedan.door, hingeZ: 0.74, length: 1.0 } };
    const box = partBox(makeSideGlass(1, moved));
    const { hingeZ } = moved.door;
    const [rear, front] = [box.min.z + hingeZ + DOOR_GLASS_SEAT.z, box.max.z + hingeZ + DOOR_GLASS_SEAT.z];
    assert.ok(Math.abs(rear - (0.74 - 1.0 + 0.03)) < 0.005, `door glass rear edge at z ${rear}, door trailing edge -0.26 + 0.03`);
    assert.ok(front > 0.86 && front < 0.95, `door glass front edge at z ${front}, around the A-pillar foot 0.88`);
  });

  it("when the A-pillar's top moves back, then the door glass's top-front corner and the pillar's rear top corner (its post's, or the sail's behind it) follow it", () => {
    const sedan = CAR_STYLES.sedan;
    // 30 cm behind the windshield's top: behind the A-post's own rear top, so the sail reaches back to it.
    const top = sedan.windshieldTop[1] - 0.3;
    const moved: BodyStyle = { ...sedan, aPillarTop: top };
    // glassCorners: 12 floats per pane, doorR is pane 3, its (front, top) corner the fourth.
    const doorTopFrontZ = (style: BodyStyle) => glassCorners(style)[3 * 12 + 9 + 2]!;
    const pillarRearZ = (style: BodyStyle) => Math.min(...aPillarParts(style).map((g) => partBox(g).min.z));
    assertSameNumbers([doorTopFrontZ(moved), pillarRearZ(moved)], [top, top], "door glass top-front z, A-pillar rear top z", 1e-5);
    const unset: BodyStyle = { ...sedan, aPillarTop: undefined };
    const stock = sedan.windshieldTop[1] - 0.05;
    assertSameNumbers([doorTopFrontZ(unset), aPillarTopZ(unset)], [stock, stock], "unset: 5 cm behind the windshield's top", 1e-5);
  });

  it("when any style's drawn A-pillar is read, then it is a post along the windshield's edge: never proud of the glass, 6 cm wide in side view, its top under the roof skin; also with its top at the windshield's", () => {
    for (const id of CAR_STYLE_IDS) {
      const stock = CAR_STYLES[id];
      for (const style of [stock, { ...stock, aPillarTop: stock.windshieldTop[1] - 0.02 }]) {
        const [post] = aPillarParts(style);
        const side = behindWindshieldEdge(post!, style);
        const proud = -Math.min(...side);
        // The post's front stands 4 mm off the glass; the old slab stood 1-2 cm over it.
        assert.ok(proud < 0.006, `${id} aPillarTop ${aPillarTopZ(style)}: the post stands ${proud} m proud of the windshield's edge line`);
        // Side-view width across the windshield's edge, ring by ring along the post (its stations, belt to top).
        const { ring, slices } = post!.userData.loft as { ring: number; slices: number };
        for (let slice = 0; slice < slices; slice++) {
          const behind = side.slice(slice * ring, (slice + 1) * ring);
          const width = Math.max(...behind) - Math.min(...behind);
          assert.ok(width > 0.058, `${id} aPillarTop ${aPillarTopZ(style)}: the post is ${width} m wide in side view at station ${slice + 1}/${slices}`);
        }
        // Every drawn greenhouse part (A-post, sail, B, rear, divider, rail, fills) stays in the roof: under its skin, and in under its side over the cant line.
        for (const part of makeGreenhouseFrame(style, "drawn")) {
          const pos = part.getAttribute("position") as THREE.BufferAttribute;
          for (let i = 0; i < pos.count; i++) {
            const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
            if (z < style.roofZ[0] || z > style.roofZ[1]) continue;
            // 1e-6: float32 vertices, a ulp at 1.3 m is 1.2e-7.
            assert.ok(y <= roofTopY(x, z, style) + 1e-6, `${id} ${part.name} vertex (${x}, ${y}, ${z}) stands over the roof skin there (${roofTopY(x, z, style)})`);
            // The drawn roof's side runs 1 cm past the cant line, out to the pillars' faces.
            const lipX = roofAt(z, style).x + 0.09;
            assert.ok(y <= cantY(z, style) + 1e-6 || Math.abs(x) <= lipX + 1e-6, `${id} ${part.name} vertex (${x}, ${y}, ${z}) stands out past the roof's lip (x ${lipX}) over the cant line`);
          }
        }
      }
    }
  });

  it("when a style's door glass starts further back than the A-post's width, then a sail fills the gap from the post to the glass at the belt", () => {
    const sedan = CAR_STYLES.sedan;
    const moved: BodyStyle = { ...sedan, aPillarFoot: sedan.windshield.base[1] - 0.4 };
    const [post, sail] = aPillarParts(moved);
    assert.ok(sail !== undefined, "the sail is drawn");
    const belt = beltY(moved.aPillarFoot, moved);
    const lowZ = (g: THREE.BufferGeometry) => {
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const zs: number[] = [];
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) - belt) < 1e-4) zs.push(pos.getZ(i));
      return [Math.min(...zs), Math.max(...zs)];
    };
    const [[sailRear, sailFront], [postRear]] = [lowZ(sail), lowZ(post!)];
    assertSameNumbers([sailRear, sailFront], [moved.aPillarFoot, postRear!], "the sail at the belt runs from the door glass's front edge to the post's rear (z)", 1e-5);
  });

  it("when a style knees its door glass onto the A-post (aPillarKnee), then the glass's front edge meets the post's rear edge there and the sail ends there: a small triangle at the foot, glass over it", () => {
    const sedan = CAR_STYLES.sedan;
    const gap: BodyStyle = { ...sedan, pillars: undefined, aPillarFoot: sedan.windshield.base[1] - 0.4 };
    const knee = beltY(gap.aPillarFoot, gap) + 0.1;
    const kneed: BodyStyle = { ...gap, aPillarKnee: knee };
    const top = (g: THREE.BufferGeometry) => partBox(g).max.y;
    assert.ok(top(aPillarParts(gap)[1]!) > knee + 0.1, "the control: without a knee the sail runs up the post");
    assert.ok(Math.abs(top(aPillarParts(kneed)[1]!) - knee) < 1e-5, `the sail tops out at the knee ${knee}: ${top(aPillarParts(kneed)[1]!)}`);
    const pane = makeSideGlass(1, kneed);
    const pos = pane.getAttribute("position") as THREE.BufferAttribute;
    const { hingeY, hingeZ } = kneed.door;
    let front = -Infinity;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) + hingeY + DOOR_GLASS_SEAT.y - knee) < 1e-5) front = Math.max(front, pos.getZ(i) + hingeZ + DOOR_GLASS_SEAT.z);
    assert.ok(Math.abs(front - (aPostRearZ(knee, kneed) + 0.01)) < 1e-5, `the door glass's front edge at the knee stands at z ${front}, 1 cm under the post's rear edge ${aPostRearZ(knee, kneed)}`);
  });

  it("when a style blacks out greenhouse parts, then exactly their drawn vertices turn primer-dark, and the drawn shape and the cage are unchanged", () => {
    // The style may black out parts of its own: the row's control is the wagon with none.
    const wagon: BodyStyle = { ...CAR_STYLES.wagon, blackout: undefined };
    const dark: BodyStyle = { ...wagon, blackout: { b: true, divider: true } };
    const primer = (g: THREE.BufferGeometry) => g.getAttribute(PRIMER_ATTRIBUTE) as THREE.BufferAttribute;
    const [was, now] = [makeChassisGeometry(wagon), makeChassisGeometry(dark)];
    const bz = (wagon.bPillar.rear + wagon.bPillar.front) / 2;
    let turned = 0;
    for (let i = 0; i < primer(now).count; i++) {
      if (primer(now).getX(i) === primer(was).getX(i)) continue;
      turned++;
      const z = now.getAttribute("position").getZ(i);
      assert.ok(Math.abs(z - bz) < 0.06 || Math.abs(z - wagon.midPillarZ!) < 0.05, `vertex ${i} at z ${z} turned dark: off the B-pillar (z ${bz}) and the divider (z ${wagon.midPillarZ})`);
    }
    const pillars = makeGreenhouseFrame(dark, "drawn").filter((g) => g.userData.blackout === true);
    assert.equal(pillars.length, 4, "two B-pillars and two dividers");
    assert.equal(turned, pillars.reduce((n, g) => n + g.getAttribute("position").count, 0), "every vertex of them, no other");
    const bits = (g: THREE.BufferGeometry) => createHash("sha256").update(new Uint8Array((g.getAttribute("position").array as Float32Array).buffer)).digest("hex");
    assert.ok(bits(now) === bits(was), "the drawn body's shape is unchanged");
    assert.ok(bits(makeChassisGeometry(dark, "cage")) === bits(makeChassisGeometry(wagon, "cage")), "the cage is unchanged");
    const sailed: BodyStyle = { ...wagon, aPillarFoot: wagon.windshield.base[1] - 0.4, blackout: { a: true, sail: true, rear: true } };
    const names = makeGreenhouseFrame(sailed, "drawn").filter((g) => g.userData.blackout === true).map((g) => g.name || "rear");
    assert.ok(names.join(",") === "a,rear,sail,a,rear,sail", `A-posts, rear pillars and sails dark: ${names.join(",")}`);
  });

  it("when a style sets its B-pillar's width and seats a leaning divider, then the drawn pillars take them at the belt and the top, the side panes tuck under the B-pillar, and the cage keeps its bands", () => {
    const wagon = CAR_STYLES.wagon;
    const m = wagon.midPillarZ!;
    const moved: BodyStyle = { ...wagon, pillars: { b: 0.07, divider: { width: [0.05, 0.04], z: [m - 0.06, m + 0.04] } } };
    const bz = (wagon.bPillar.rear + wagon.bPillar.front) / 2;
    // Frame parts per side: A-pillar, B-pillar, C-pillar, divider.
    const parts = makeGreenhouseFrame(moved, "drawn");
    const spans = (g: THREE.BufferGeometry) => {
      const pos = g.getAttribute("position") as THREE.BufferAttribute;
      const box = partBox(g);
      const [low, top]: number[][] = [[], []];
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < box.min.y + 0.005) low.push(pos.getZ(i));
        if (pos.getY(i) > box.max.y - 0.005) top.push(pos.getZ(i));
      }
      return [Math.min(...low), Math.max(...low), Math.min(...top), Math.max(...top)];
    };
    assertSameNumbers(spans(parts[1]!), [bz - 0.035, bz + 0.035, bz - 0.035, bz + 0.035], "B-pillar z span at the belt and at its top", 1e-5);
    assertSameNumbers(spans(parts[3]!), [m - 0.085, m - 0.035, m + 0.02, m + 0.06], "divider z span at the belt and at its top", 1e-5);
    // glassCorners: doorR is pane 3, its rear corners (across 0) at the base and the top; quarterR is pane 5, its front corners (across 1).
    const c = glassCorners(moved);
    assertSameNumbers([c[3 * 12 + 2]!, c[3 * 12 + 6 + 2]!, c[5 * 12 + 3 + 2]!, c[5 * 12 + 9 + 2]!], [bz + 0.025, bz + 0.025, bz - 0.025, bz - 0.025], "door glass rear and quarter glass front edges, 1 cm under the B-pillar (z)", 1e-5);
    const cage = (style: BodyStyle) => makeGreenhouseFrame(style, "cage").map((g) => Array.from(g.getAttribute("position").array).join(",")).join("|");
    assert.ok(cage(moved) === cage(wagon), "the cage greenhouse is unchanged");
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
    const fill = partBox(drawn[drawn.length - 1]!);
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
    const gateTop = gate.origin[0] - bootPivot(gate)[0];
    const gateDown = gateTop + lerp(gate.y0, gate.origin[0], 0.6) - gate.origin[0];
    const top = (g: THREE.BufferGeometry, at: number) => extremeAt(g, 2, at, 1, 1);
    const face = (g: THREE.BufferGeometry, at: number) => extremeAt(g, 1, at, 2, -1);
    assertSameNumbers([top(lipDeck!, edge) - top(plainDeck!, edge), top(lipDeck!, deckIn) - top(plainDeck!, deckIn)], [lip.rise, 0], "the deck lid's top over the plain one's at its rear edge and 0.13 m in", 1e-5);
    assertSameNumbers([face(plainGate!, gateTop) - face(lipGate!, gateTop), face(plainGate!, gateDown) - face(lipGate!, gateDown)], [lip.rise, 0], "the tailgate's face behind the plain one's at its top edge and 0.15 m down", 1e-5);
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
  const geo = styleMirrorDrawn(style, 1).geometry;
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

  it("when a style has no mirror of its own, then its seats draw the platform mirror", () => {
    for (const id of CAR_STYLE_IDS) {
      for (const [kind, sign] of [[PART_KIND.mirrorL, -1], [PART_KIND.mirrorR, 1]] as const) {
        const seat = cars[id].partSeats[kind]!;
        assert.ok(CAR_STYLES[id].door.mirror !== undefined || (seat.drawn === partGeometry(kind) && seat.variant === 0 && styleMirrorDrawn(CAR_STYLES[id], sign).geometry === partGeometry(kind)), `${id} side ${sign}`);
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
});

// ---- boot openings, open floors and arch lips (drawn only) -----------------------------------------------------------------

/** Ray spacing (m) over an opening, and how far inside its edges the rays stay (m): clear of the lid's shut line and the hollow's ramps. */
const OPEN_GRID = 0.04;
const OPEN_EDGE = 0.03;
/** A deck lid's edge stands 7.5 cm in from its station's half-width; the rays stay 4.5 cm further in. A lid wrapping the tail folds over its last 8 cm. */
const LID_EDGE = 0.12;
const LID_FOLD = 0.08;
/** The opening's rim (the tail panel's top, the rear window's sill) stands up to this far (m) inside a deck lid's ends: the hollow's ramp, and the loft's last station before the tail's roll. */
const LID_RIM = 0.08;
/** How far (m) under a deck lid's top, or in through a face, a ray looks for body standing in the opening. */
const OPEN_DEPTH = 0.15;
/** How near (m) a lip's measured stand-off comes to its `flare`: its section's straight facets span the fender flare's 2.2 cm bump. */
const LIP_TOL = 0.003;
const SIDED = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

/** The point where a ray from `from` heading `dir` first meets `body` within `far` (m), or null. */
function bodyHit(body: THREE.Mesh, from: THREE.Vector3Tuple, dir: THREE.Vector3Tuple, far: number): THREE.Vector3 | null {
  return new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir), 0, far).intersectObject(body, false)[0]?.point ?? null;
}

/** The rear face's opening of a tailgate, or of a lid wrapping the tail: its half-width, its sill and its top (m). */
function faceOpening(style: BodyStyle): { half: number; sill: number; top: number } | null {
  const b = style.boot;
  const tail = style.profile[0]!.z;
  if (b.kind === "lid") return b.drop ? { half: b.drop.w, sill: b.drop.y, top: sampleSlice(tail, style.profile).yBelt } : null;
  const bed = style.tubs.find(([z0]) => z0 < tail + 0.1);
  return { half: makeTrunkGeometry(style).boundingBox!.max.x, sill: Math.max(b.y0, bed?.[2] ?? 0), top: b.origin[0] };
}

/** Where the drawn body stands in `style`'s boot opening: under its deck lid between the lid's edges, and in its rear face's cut. */
function openingCrossings(style: BodyStyle): string[] {
  const body = new THREE.Mesh(makeChassisGeometry(style), SIDED);
  const b = style.boot;
  const tail = style.profile[0]!.z;
  const hits: string[] = [];
  const at = (p: THREE.Vector3 | null) => p && hits.push(`(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  if (b.kind === "lid" && !roofHinged(b)) {
    for (let z = b.z1 + LID_RIM + (b.drop ? LID_FOLD : 0); z <= b.z0 - LID_RIM; z += OPEN_GRID) {
      const half = sampleSlice(z, style.profile).hw - LID_EDGE;
      for (let x = -half; x <= half; x += OPEN_GRID) at(bodyHit(body, [x, deckTopY(x, z, style) + 0.05, z], [0, -1, 0], OPEN_DEPTH));
    }
  }
  const face = faceOpening(style);
  if (!face) return hits;
  for (let y = face.sill + OPEN_EDGE; y <= face.top - OPEN_EDGE; y += OPEN_GRID) {
    for (let x = -face.half + OPEN_EDGE; x <= face.half - OPEN_EDGE; x += OPEN_GRID) at(bodyHit(body, [x, y, tail - 0.05], [0, 0, 1], OPEN_DEPTH));
  }
  return hits;
}

/** The liner's inner edge across the car (m) over wheel [wx, , wz]: the liner stands over the tyre, or inside the side of a body it stands outboard of. */
function linerInnerEdge(style: BodyStyle, wx: number, wz: number): number {
  const hw = sampleSlice(wz, style.profile).hw;
  return (Math.abs(wx) > hw ? hw - 0.12 : Math.abs(wx)) - 0.12;
}

/** A style without its arch lip. */
const lipless = (style: BodyStyle): BodyStyle => ({ ...style, arch: { radius: style.arch.radius } });

describe("given a body style's boot opening, its open floors and its arch lips (drawn only)", () => {
  const cases: readonly [string, BodyStyle][] = [...CAR_STYLE_IDS.map((id): [string, BodyStyle] => [id, CAR_STYLES[id]]), ...WRAPPED.map(([id, s]): [string, BodyStyle] => [`${id} (wrapped lid)`, s])];
  for (const [id, style] of cases) {
    it(`when a ${id}'s drawn body is built, then nothing of it stands in its boot's opening: under its lid between the lid's edges, in its face's cut`, () => {
      const hits = openingCrossings(style);
      assert.ok(hits.length === 0, `${id}: ${hits.length} rays meet body in the opening, first ${hits.slice(0, 4).join(" ")}`);
    });
  }

  for (const id of ["pickup", "monster", "hatchback", "wagon"] as const) {
    it(`when a ${id}'s bed or cargo floor is looked down onto behind its rear bulkhead, then it is flat between the wheel humps`, () => {
      const style = CAR_STYLES[id];
      const [z0, z1, f] = style.tubs.reduce((a, t) => (t[0] < a[0] ? t : a));
      const body = new THREE.Mesh(makeChassisGeometry(style), SIDED);
      let worst = 0;
      for (let z = z0 + 0.1; z <= Math.min(z1, style.rearBulkhead.z) - 0.1; z += OPEN_GRID) {
        const floor = Math.max(f, floorY(z, style));
        for (let x = -0.45; x <= 0.45; x += 0.05) worst = Math.max(worst, Math.abs((bodyHit(body, [x, floor + 0.3, z], [0, -1, 0], 1)?.y ?? 0) - floor));
      }
      assert.ok(worst < 0.005, `${id}: the floor stands ${worst.toFixed(3)} m off its height`);
    });
  }

  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];
    const r = style.arch.radius;
    const raised = carFrame(style).wheels.filter(([, wy, wz]) => style.tubs.some(([z0, z1, f]) => wy + r > Math.max(f, floorY(wz, style)) && wz > z0 && wz < z1));
    if (raised.length === 0) continue;
    it(`when a ${id}'s open floor is looked down onto over its wheels, then a hump closes each liner there: its top over the liner's inner edge stands at the liner's top or above`, () => {
      const body = new THREE.Mesh(makeChassisGeometry(style), SIDED);
      for (const [wx, wy, wz] of raised) {
        const x = Math.sign(wx) * (linerInnerEdge(style, wx, wz) - 0.01);
        const top = bodyHit(body, [x, wy + r + 0.1, wz], [0, -1, 0], r + 0.5)?.y ?? -Infinity;
        assert.ok(top >= wy + r, `${id} wheel at x ${wx.toFixed(2)} z ${wz.toFixed(2)}: the top over the liner's edge at ${top.toFixed(3)} m, the liner's top at ${(wy + r).toFixed(3)} m`);
      }
    });
  }

  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];
    const lip = style.arch.lip;
    if (!lip) continue;
    it(`when a ${id}'s arch tops are scanned across their lip, then each lip stands its own ${lip.flare} m proud of the body side, and the cage build is the lip-less body's`, () => {
      const drawn = new THREE.Mesh(makeChassisGeometry(style), SIDED);
      const plain = new THREE.Mesh(makeChassisGeometry(lipless(style)), SIDED);
      for (const [wx, wy, wz] of carFrame(style).wheels) {
        const s = Math.sign(wx);
        let proud = 0;
        for (let k = 0; k <= 10; k++) {
          const y = wy + style.arch.radius + (k / 10) * lip.width;
          const out = (mesh: THREE.Mesh) => Math.abs(bodyHit(mesh, [s * 3, y, wz], [-s, 0, 0], 3)?.x ?? 0);
          proud = Math.max(proud, out(drawn) - out(plain));
        }
        assert.ok(Math.abs(proud - lip.flare) < LIP_TOL, `${id} arch at x ${wx.toFixed(2)} z ${wz.toFixed(2)}: the lip stands ${proud.toFixed(4)} m proud`);
      }
      assert.ok(cageHash(style) === cageHash(lipless(style)), "the cage build is unchanged");
    });
  }
});

describe("given every style's doors and the shared door card", () => {
  it("when a ray from outside meets each style's door skin at every drawn card vertex, then the card stands under the skin's outer face (no dark wedge where the skin tucks in); the sim still measures the card's own box", () => {
    for (const sign of [-1, 1]) {
      const card = drawnDoorCard(sign);
      assert.ok(card !== partGeometry(sign < 0 ? PART_KIND.liningL : PART_KIND.liningR), "the seat's measured geometry is the card's own");
      const pos = card.getAttribute("position") as THREE.BufferAttribute;
      const ray = new THREE.Raycaster();
      for (const id of CAR_STYLE_IDS) {
        const skin = new THREE.Mesh(makeDoorGeometry(sign, CAR_STYLES[id]));
        skin.position.z = doorSkinZ(CAR_STYLES[id]);
        skin.updateMatrixWorld();
        for (let i = 0; i < pos.count; i++) {
          ray.set(new THREE.Vector3(sign * 2, pos.getY(i), pos.getZ(i)), new THREE.Vector3(-sign, 0, 0));
          const hit = ray.intersectObject(skin, false)[0];
          if (hit) assert.ok(sign * pos.getX(i) < sign * hit.point.x, `${id} side ${sign}: card vertex (${pos.getX(i)}, ${pos.getY(i)}, ${pos.getZ(i)}) stands out of the door skin at x ${hit.point.x}`);
        }
        skin.geometry.dispose();
      }
    }
  });
});

describe("given a style with privacy glass", () => {
  it("when its car is built, and again after a player recolours its glass, then its rear and quarter panes wear the colour well under half as light, its windshield and door panes the colour itself", () => {
    const hatch = CAR_STYLES.hatchback;
    const was = hatch.privacyGlass;
    hatch.privacyGlass = { rear: true, quarter: true };
    try {
      const car = new DeformableCar(PAINT, new THREE.Scene(), null, "hatchback");
      const light = (name: string) => (car["glassPanes"].find((g) => g.name === name)!.mesh.material as THREE.MeshStandardMaterial).color.getHSL({ h: 0, s: 0, l: 0 }).l;
      for (const pass of ["built", "recoloured"]) {
        if (pass === "recoloured") car.setGlassTint(0x6688aa);
        for (const dark of ["rear", "quarterL", "quarterR"]) assert.ok(light(dark) < 0.5 * light("windshield"), `${pass}: ${dark} ${light(dark)} against the windshield's ${light("windshield")}`);
        assert.ok(light("doorR") === light("windshield"), `${pass}: the door pane wears the colour itself`);
      }
    } finally {
      hatch.privacyGlass = was;
    }
  });
});
