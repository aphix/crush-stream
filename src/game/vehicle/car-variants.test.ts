import * as THREE from "three";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeformableCar } from "./car.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES, CAR_STYLE_IDS, FLEET_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { PLATFORM_CAMERA, PLATFORM_HARDPOINTS, pullHandle, st } from "./car-styles/platform.ts";
import { ROCKER, cantX, cantY, deckTopY, doorAperture, drawnSideX, glassTopY, glassX, lerp, makeBumperGeometry, makeHoodGeometry, makeTrunkGeometry, roofAt, roofTopY, sampleSlice, sectionPoints, sideX, tailgateHalf } from "./car-mesh.ts";
import { aPillarTopZ, aPostRearZ, bPillarBand, beltX, beltY, floorY, pillarBands, rockerAt, tubWall } from "./car-lines.ts";
import { doorSkinZ, drawnDoorCard, makeDoorGeometry, mirrorSeatX } from "./car-door-mesh.ts";
import { GRILLE_SEAT, MIRROR_REACH, MIRROR_ROOT, PART_KIND, partGeometry } from "./part-geometry.ts";
import { drawnLamp, drawnPart, lampRest, lampSeatAt, withSeamCover } from "./part-variants.ts";
import { RAIL_LIP, RAIL_PROUD, makeGreenhouseFrame, makeRoofGeometry } from "./car-greenhouse-mesh.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { withFrontBand, withHoodBulge, withRearFittings } from "./car-fittings-mesh.ts";
import { DOOR_GLASS_SEAT, domeFall, glassCorners, makeBodyGlassFrames, makeRearGlass, makeRearSideGlass, makeSideGlass, makeWindshield } from "./car-glass.ts";
import { archLipGeometry, makeWellLiners } from "./car-well-mesh.ts";
import { LIGHT_BAR_FOOT, PAINT_COLOR_TONE, PAINTED_ATTRIBUTE, PUSH_BAR_REACH, TRIM_BLACK, TRIM_CHROME, TRIM_FINISH, bumperMaterial, makeLightBar, toned, trimMaterial } from "./car-materials.ts";
import { BOX_HALVES, boxShape, newLooseShape, partMass, stepLoose } from "./loose-step.ts";
import { armSolids, Surface } from "../world/surfaces.ts";
import { wearCarLook } from "../present/car-look.ts";
import { NO_CAR_PICK } from "../match/look-data.ts";
import { runWall } from "../contact/crash-scenarios.test-util.ts";
import { fleetStyle } from "../scenes/fleet.ts";
import { StreamedDeformation } from "../deform/streamed-deform.ts";
import { PLATFORM_RIG } from "../deform/deform-rig.ts";
import { assertSameDigest, assertSameNumbers } from "./test-support.ts";
import { LampBatch } from "./lamp-lights.ts";
import { FRAME_HZ, QUIET_HZ } from "../kernel/constants.ts";
import { BLACKOUT, FITTING_ATTRIBUTE, FITTING_TONE, GLASS_ATTRIBUTE, LIGHT_BAR, MATTE_BLACKOUT, MATTE_PRIVACY, PRIMER_ATTRIBUTE, WELL_PANEL } from "./constants.ts";
import { bootPivot, lidSpec, roofHinged } from "./hinge-spec.ts";
import { SPRINGS } from "./car-suspension.ts";
import { CarCage } from "./car-cage.ts";
import { cageSourceOf } from "./car-cage-rig.ts";
import { CLASSES, STYLE_CLASS } from "./vehicle-classes.ts";

const PAINT = { body: 0xc5c8ce, accent: 0x9aa0a8, name: "Titanium" };
/** The sedan's rear seam cover, both sides: a band from the seam to the fascia's top, kept inside the car's triangle budget. */
const SEAM_COVER_TRIANGLES = 160;
/** A seam cover vertex stands at most this far (m) off the body skin: its 6 mm lift plus a chord's sag across a corner. */
const SEAM_COVER_OFF = 0.015;
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
      // A push bar stands its reach past the nose the spec gives (the length spec leaves it off, as the height leaves off the light bar).
      const guard = CAR_STYLES[id].pushBar ? PUSH_BAR_REACH : 0;
      assertSameNumbers(
        [b.max.z, b.min.z, b.max.x - b.min.x, b.max.y, floor],
        [half + d.overhang.front + guard, -half - d.overhang.rear, d.width, d.height, d.rideHeight],
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

/** A windshield and a rear glass bowed deep in plan (m, the centre line off the edges' line at the base and the top): CarSedan's reference read. */
const DEEP_BOWS = { windshield: { base: 0.22, top: 0.06 }, rear: { base: -0.11, top: -0.04 } } as const;
/** The default bows (`WINDSHIELD_BOW`, `REAR_GLASS_BOW`) at the glass tops, which the drawn roof's flat ends already cover. */
const DEFAULT_TOP_BOWS = { windshield: 0.02, rear: -0.015 } as const;

describe("given a sedan whose windshield and rear glass bow deep in plan", () => {
  const sedan = CAR_STYLES.sedan;
  const style: BodyStyle = { ...sedan, windshield: { ...sedan.windshield, bow: DEEP_BOWS.windshield }, rearGlass: { ...sedan.rearGlass, bow: DEEP_BOWS.rear } };
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;

  it("when its panes are built, then each centre line stands its bow off the edges' line at the base and the top, the edges stay on the style's lines, and the pane's centre (where an ejection launches) is the bowed one", () => {
    const panes = [
      { name: "windshield", geo: makeWindshield(style), base: sedan.windshield.base[1], top: sedan.windshieldTop[1], bow: DEEP_BOWS.windshield, segX: 10, segY: 8 },
      { name: "rear glass", geo: makeRearGlass(style), base: sedan.rearGlass.base[1], top: sedan.rearGlass.top[1], bow: DEEP_BOWS.rear, segX: 8, segY: 6 },
    ];
    for (const { name, geo, base, top, bow, segX, segY } of panes) {
      const pos = geo.getAttribute("position");
      const z = (i: number, j: number) => pos.getZ(j * (segX + 1) + i);
      assert.ok(near(z(segX / 2, 0), base + bow.base) && near(z(segX / 2, segY), top + bow.top), `${name}: its centre line at z ${z(segX / 2, 0)} (base) and ${z(segX / 2, segY)} (top)`);
      assert.ok(near(z(0, 0), base) && near(z(segX, 0), base) && near(z(0, segY), top) && near(z(segX, segY), top), `${name}: its corners on the style's edge lines`);
      const centre = geo.userData.centre as readonly [number, number, number];
      assert.ok(near(centre[2], (base + top) / 2 + (bow.base + bow.top) / 2), `${name}: its centre at z ${centre[2]}`);
    }
  });

  it("when it is at rest, then both panes sit inside their glass cages with no clamping: each cage reaches out as far as its pane's bow outgrows the default one", () => {
    const d = new StreamedDeformation(makeChassisGeometry(style), carFrame(style).rig);
    assert.ok(panelClamp(d, makeWindshield(style), "glassFront", new THREE.Vector3()) < 1e-4, "windshield");
    assert.ok(panelClamp(d, makeRearGlass(style), "glassRear", new THREE.Vector3()) < 1e-4, "rear glass");
  });

  it("when its roof is drawn, then the roof's front and rear edges bow with the glass tops under them, past the default bows", () => {
    const extentZ = (geo: THREE.BufferGeometry) => {
      const pos = geo.getAttribute("position");
      const zs = Array.from({ length: pos.count }, (_, v) => pos.getZ(v));
      return [Math.min(...zs), Math.max(...zs)];
    };
    const [[flatRear, flatFront], [bowedRear, bowedFront]] = [extentZ(makeRoofGeometry(sedan)), extentZ(makeRoofGeometry(style))];
    assert.ok(near(bowedFront - flatFront, DEEP_BOWS.windshield.top - DEFAULT_TOP_BOWS.windshield), `front edge bowed ${(bowedFront - flatFront).toFixed(4)} m`);
    assert.ok(near(bowedRear - flatRear, DEEP_BOWS.rear.top - DEFAULT_TOP_BOWS.rear), `rear edge bowed ${(bowedRear - flatRear).toFixed(4)} m`);
  });
});

describe("given a coupe whose roof's ends roll onto its glass tops (roofEnds)", () => {
  /** Each end's run (m), and a rear glass top 6 cm under the dome's edge (the coupe's fastback read), so the rear's whole section drops. */
  const RUNS = { rear: 0.15, front: 0.12 } as const;
  const FASTBACK_DROP = 0.06;
  const coupe = CAR_STYLES.coupe;
  const rearTop: BodyStyle["rearGlass"]["top"] = [roofAt(coupe.roofZ[0], coupe).y - FASTBACK_DROP, coupe.rearGlass.top[1]];
  const rolled: BodyStyle = { ...coupe, roofEnds: RUNS, rearGlass: { ...coupe.rearGlass, top: rearTop } };
  const roof = makeRoofGeometry(rolled);
  const pos = roof.getAttribute("position") as THREE.BufferAttribute;
  const headliner = new Set(Array.from(roof.userData.shellTwins as Int32Array).filter((_, k) => k % 2 === 0));

  it("when its roof is drawn, then each end's crown (bowed in plan with its glass) sits at its glass top's height, and past the runs the crown is the plain coupe's", () => {
    const crowns: { y: number; z: number }[] = [];
    for (let v = 0; v < pos.count; v++) if (Math.abs(pos.getX(v)) < 1e-6 && !headliner.has(v)) crowns.push({ y: pos.getY(v), z: pos.getZ(v) });
    crowns.sort((a, b) => a.z - b.z);
    const [rear, front] = [crowns[0]!, crowns[crowns.length - 1]!];
    assert.ok(Math.abs(rear.y - rearTop[0]) < 1e-5 && Math.abs(front.y - coupe.windshieldTop[0]) < 1e-5, `end crowns at y ${rear.y} / ${front.y}, the glass tops ${rearTop[0]} / ${coupe.windshieldTop[0]}`);
    const inside = crowns.filter((c) => c.z > coupe.roofZ[0] + RUNS.rear && c.z < coupe.roofZ[1] - RUNS.front);
    assert.ok(inside.length > 0, "no crown read between the runs");
    for (const c of inside) assert.ok(Math.abs(c.y - roofTopY(0, c.z, coupe)) < 1e-5, `crown at z ${c.z}: y ${c.y}, the plain coupe's ${roofTopY(0, c.z, coupe)}`);
  });

  it("when its roof's dome is read, then every skin vertex over the dome (inside its edges) is at roofTopY, and every drawn greenhouse part stays under roofTopY: the posts' clamp follows the rolled ends", () => {
    for (let v = 0; v < pos.count; v++) {
      const [x, y, z] = [pos.getX(v), pos.getY(v), pos.getZ(v)];
      if (headliner.has(v) || z < rolled.roofZ[0] || z > rolled.roofZ[1] || Math.abs(x) > roofAt(z, rolled).x + 1e-6 || y < roofTopY(roofAt(z, rolled).x, z, rolled) - 1e-6) continue;
      assert.ok(Math.abs(y - roofTopY(x, z, rolled)) < 1e-5, `dome vertex (${x}, ${y}, ${z}): roofTopY ${roofTopY(x, z, rolled)}`);
    }
    for (const part of makeGreenhouseFrame(rolled, "drawn")) {
      const at = part.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < at.count; i++) {
        const [x, y, z] = [at.getX(i), at.getY(i), at.getZ(i)];
        if (z >= rolled.roofZ[0] && z <= rolled.roofZ[1]) assert.ok(y <= roofTopY(x, z, rolled) + 1e-6, `${part.name} vertex (${x}, ${y}, ${z}) over the rolled roof (${roofTopY(x, z, rolled)})`);
      }
    }
  });
});

describe("given the pickup whose roof's rear corners sit flush over its posts (roofEnds.flush.rear 1)", () => {
  it("when its roof is drawn, then no skin vertex at the rear end stands past the dome's edge, while without `flush` the side lip reaches past it there", () => {
    const pickup = CAR_STYLES.pickup;
    const lipped: BodyStyle = { ...pickup, roofEnds: { ...pickup.roofEnds, flush: undefined } };
    const z0 = pickup.roofZ[0];
    const reachAtEnd = (style: BodyStyle): number => {
      const pos = makeRoofGeometry(style).getAttribute("position") as THREE.BufferAttribute;
      let x = -Infinity;
      for (let v = 0; v < pos.count; v++) if (Math.abs(pos.getZ(v) - z0) < 1e-6) x = Math.max(x, pos.getX(v));
      return x - roofAt(z0, style).x;
    };
    const [flush, lip] = [reachAtEnd(pickup), reachAtEnd(lipped)];
    assert.ok(flush < 1e-6 && lip > 0.05, `rear end past the dome's edge: flush ${flush.toFixed(4)} m, without flush ${lip.toFixed(4)} m`);
  });
});

describe("given a coupe whose rear glass has round corners (rearGlass.round)", () => {
  const ROUND = 0.09;
  const coupe = CAR_STYLES.coupe;
  const square: BodyStyle = { ...coupe, rearGlass: { ...coupe.rearGlass, round: undefined, roundOutline: undefined } };
  const rounded: BodyStyle = { ...coupe, rearGlass: { ...coupe.rearGlass, round: ROUND, roundOutline: undefined } };
  const outlined: BodyStyle = { ...coupe, rearGlass: { ...coupe.rearGlass, round: ROUND, roundOutline: true } };

  it("when its rear glass is built with a round outline (roundOutline: the coupe's), then its glass keeps the corner's arc in from each square corner, as the bead does, and its frit corners stand 1 cm in behind the plain build's as a backing", () => {
    /** The backing's inset (m) behind the pane. */
    const INSET = 0.01;
    const geo = makeRearGlass(outlined);
    const plain = makeRearGlass(rounded);
    const [pos, flat] = [geo.getAttribute("position"), plain.getAttribute("position")];
    const tone = geo.getAttribute(GLASS_ATTRIBUTE);
    assert.ok(pos.count === flat.count, `${pos.count} vertices against the plain build's ${flat.count}`);
    let frit = 0;
    for (let i = 0; i < pos.count; i++) {
      const off = new THREE.Vector3().fromBufferAttribute(pos, i).distanceTo(new THREE.Vector3().fromBufferAttribute(flat, i));
      if (tone.getX(i) === 0) assert.ok(off < 1e-6, `clear vertex ${i} moved ${off} m`);
      else {
        frit++;
        assert.ok(Math.abs(off - INSET) < 1e-4, `frit vertex ${i} stands ${(off * 1000).toFixed(1)} mm off the plain build's`);
      }
    }
    assert.ok(frit > 0, "no frit backing");
    const squarePos = makeRearGlass(square).getAttribute("position");
    for (const k of [0, 8, 54, 62]) {
      const corner = new THREE.Vector3().fromBufferAttribute(squarePos, k);
      let near = Infinity;
      for (let i = 0; i < pos.count; i++) if (tone.getX(i) === 0) near = Math.min(near, corner.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i)));
      assert.ok(near > 0.9 * ROUND * (Math.SQRT2 - 1), `corner ${k}: the glass reaches ${near.toFixed(4)} m off it`);
    }
  });

  it("when its rear glass is built, then the clear pane keeps a corner's arc in from each square corner (the arc's middle lies r(√2 − 1) off it), black frit fills out to the corner, and the outline and the pane's centre stay the square pane's", () => {
    const geo = makeRearGlass(rounded);
    const pos = geo.getAttribute("position");
    const tone = geo.getAttribute(GLASS_ATTRIBUTE);
    assert.ok(tone !== undefined, "the rounded pane carries its frit's glass tone");
    // The square pane's corners as drawn (its 8 × 6 grid's), fallen with the roof's dome at the top.
    const squarePos = makeRearGlass(square).getAttribute("position");
    for (const k of [0, 8, 54, 62]) {
      const corner = new THREE.Vector3().fromBufferAttribute(squarePos, k);
      let [clear, frit] = [Infinity, Infinity];
      for (let i = 0; i < pos.count; i++) {
        const d = corner.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i));
        if (tone.getX(i) === 0) clear = Math.min(clear, d);
        else frit = Math.min(frit, d);
      }
      assert.ok(clear > 0.9 * ROUND * (Math.SQRT2 - 1) && clear < 1.2 * ROUND * (Math.SQRT2 - 1), `corner ${k}: the clear pane's nearest point ${clear.toFixed(4)} m off it`);
      assert.ok(frit < 1e-6, `corner ${k}: the frit reaches it (${frit} m)`);
    }
    const [box, squareBox] = [partBox(geo), partBox(makeRearGlass(square))];
    assert.ok(box.min.distanceTo(squareBox.min) < 1e-6 && box.max.distanceTo(squareBox.max) < 1e-6, "the outline is the square pane's");
    assert.ok(`${geo.userData.centre}` === `${makeRearGlass(square).userData.centre}`, `centre ${geo.userData.centre}`);
  });

  it("when its chrome bead is built (windowTrim), then the bead keeps the corner's arc in from each square corner too, not a sharp mitre on it", () => {
    /** The bead's nearest point to a square corner: at least half the arc's middle's r(√2 − 1) off it (a sharp mitre sits on it, the section's outward offset away). */
    const BEAD_ARC = 0.5 * ROUND * (Math.SQRT2 - 1);
    const near = (style: BodyStyle): number[] => {
      const pos = makeBodyGlassFrames(style, true).getAttribute("position");
      const rg = style.rearGlass;
      return [-1, 1].flatMap((sx) =>
        [rg.base, rg.top].map(([y, z], k) => {
          const corner = new THREE.Vector3((sx * (k === 0 ? rg.wBase : rg.wTop)) / 2, y, z);
          let d = Infinity;
          for (let i = 0; i < pos.count; i++) d = Math.min(d, corner.distanceTo(new THREE.Vector3().fromBufferAttribute(pos, i)));
          return d;
        }),
      );
    };
    const [round, sharp] = [near(rounded), near(square)];
    assert.ok(Math.min(...sharp) < BEAD_ARC, `the control: the square pane's bead stands ${sharp.map((d) => d.toFixed(4)).join(", ")} m off its corners`);
    assert.ok(Math.min(...round) >= BEAD_ARC, `the bead stands ${round.map((d) => d.toFixed(4)).join(", ")} m off the square corners, want ${BEAD_ARC.toFixed(4)} or more`);
  });
});

/** The owner's lids (docs/DOOR_RIG.md, Lids): a sedan's lid hinged at the rear window's base wraps the tail down to its lamps; a hatch is a roof-hinged lid wrapping down a leaning tail face to just above the bumper. */
const WRAPPED: readonly [string, BodyStyle][] = [
  ["sedan", CAR_STYLES.sedan],
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

/** The widest x of `geo`'s triangles covering (z, y) in its own frame, by barycentrics in the z-y plane; -Infinity with none there. */
function widestAt(geo: THREE.BufferGeometry, zT: number, yT: number): number {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const index = geo.index!;
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
  return widest;
}

/** The door skin's outer x (car frame) at the mirror's seat: the widest drawn triangle covering its height and z, which beats the slab's inner face. Throws, naming the style, with no triangle there. */
function doorSkinAtMirror(style: BodyStyle): number {
  const d = style.door;
  const [zT, yT] = [-(d.mirrorZ ?? 0) - doorSkinZ(style), d.mirrorY];
  const widest = widestAt(makeDoorGeometry(1, style), zT, yT);
  assert.ok(widest > -Infinity, `${style.id}: no door skin triangle at the mirror's z ${zT} and height ${yT}`);
  return d.hingeX + widest;
}

/** The drawn right door glass's outer x (car frame) at car (z, y); NaN off the pane. */
function paneXAt(style: BodyStyle, z: number, y: number): number {
  const { hingeX, hingeY, hingeZ } = style.door;
  const widest = widestAt(makeSideGlass(1, style), z - hingeZ - DOOR_GLASS_SEAT.z, y - hingeY - DOOR_GLASS_SEAT.y);
  return widest > -Infinity ? hingeX + DOOR_GLASS_SEAT.x + widest : NaN;
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
  if (d.mirror?.mount === "glass") return paneXAt(style, mirrorZ, mirrorY);
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

  it("when any style's car is reset and its mirrors posed, then each mirror's seat still stretches the platform mirror to the style's own reach", () => {
    const wrong: string[] = [];
    for (const id of CAR_STYLE_IDS) {
      const car = new DeformableCar(PAINT, scene, null, id);
      const want = CAR_STYLES[id].door.mirrorReach;
      const read = (when: string): void => {
        for (const name of ["mirrorL", "mirrorR"]) {
          const reach = car["parts"].find((p) => p.name === name)!.object.scale.x * MIRROR_REACH;
          if (Math.abs(reach - want) > 1e-9) wrong.push(`${id} ${name} ${when}: reach ${reach.toFixed(3)} m, its door's ${want}`);
        }
      };
      read("built");
      car.resetVisual();
      read("reset");
      for (const p of car["parts"]) if (p.mirror) car["posePart"](p);
      read("posed");
      car.dispose();
    }
    assert.deepEqual(wrong, []);
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

  it("when a style that sets no B widths moves its B-pillar band, then the door glass's rear edge and the quarter glass's front edge follow the band, 1 cm in under its edges at the belt and the top, wherever the door's trailing edge is", () => {
    const sedan = CAR_STYLES.sedan;
    // The door's trailing edge (hingeZ - length = -0.26) 4 cm ahead of the band's front edge: the panes follow the band, not the door.
    const moved: BodyStyle = { ...sedan, pillars: undefined, bPillar: { rear: -0.4, front: -0.3 }, aPillarFoot: 0.88, door: { ...sedan.door, hingeZ: 0.74, length: 1.0 } };
    // glassCorners: doorR is pane 3, its rear corners (across 0) at the base and the top; quarterR is pane 5, its front corners (across 1).
    const c = glassCorners(moved);
    const edges = [c[3 * 12 + 2]!, c[3 * 12 + 6 + 2]!, c[5 * 12 + 3 + 2]!, c[5 * 12 + 9 + 2]!];
    assertSameNumbers(edges, [-0.31, -0.325, -0.39, -0.375], "door glass rear and quarter glass front edges at the belt and the top (z), band [-0.4, -0.3] narrowing 1.5 cm a side at its top", 1e-5);
    const front = partBox(makeSideGlass(1, moved)).max.z + moved.door.hingeZ + DOOR_GLASS_SEAT.z;
    assert.ok(front > 0.86 && front < 0.95, `door glass front edge at z ${front}, around the A-pillar foot 0.88`);
  });

  it("when the A-pillar's top moves back, then the door glass's top-front corner and the pillar's rear top corner (its post's, or the sail's behind it) follow it", () => {
    // The straight edge: the sedan's own knee off.
    const sedan: BodyStyle = { ...CAR_STYLES.sedan, aPillarKnee: undefined };
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

  it("when any style's drawn A-pillar is read, then it is a post along the windshield's edge: never proud of the glass, its width in side view (6 cm unless the style sets `pillars.a`), its top under the roof skin; also with its top at the windshield's", () => {
    for (const id of CAR_STYLE_IDS) {
      const stock = CAR_STYLES[id];
      for (const style of [stock, { ...stock, aPillarTop: stock.windshieldTop[1] - 0.02 }]) {
        const [post] = aPillarParts(style);
        const side = behindWindshieldEdge(post!, style);
        const proud = -Math.min(...side);
        // The post's front stands 4 mm off the glass; the old slab stood 1-2 cm over it.
        assert.ok(proud < 0.006, `${id} aPillarTop ${aPillarTopZ(style)}: the post stands ${proud} m proud of the windshield's edge line`);
        // Side-view width across the windshield's edge, ring by ring along the post (its stations, belt to top); a station reaching up past
        // the cant line into the roof's side is held in under the roof's skin (checked below), so it is buried, not read.
        const { ring, slices } = post!.userData.loft as { ring: number; slices: number };
        const pos = post!.getAttribute("position") as THREE.BufferAttribute;
        let read = 0;
        for (let slice = 0; slice < slices; slice++) {
          const ks = Array.from({ length: ring }, (_, k) => slice * ring + k);
          if (ks.some((i) => pos.getZ(i) >= style.roofZ[0] && pos.getZ(i) <= style.roofZ[1] && pos.getY(i) > cantY(pos.getZ(i), style))) continue;
          read++;
          const behind = ks.map((i) => side[i]!);
          const width = Math.max(...behind) - Math.min(...behind);
          const set = style.pillars?.a;
          const want = (set ?? 0.06) - 0.002;
          assert.ok(width > want, `${id} aPillarTop ${aPillarTopZ(style)}: the post is ${width} m wide in side view at station ${slice + 1}/${slices}, under ${want}`);
          if (set !== undefined) assert.ok(width < set + 0.01, `${id}: the post is ${width} m wide in side view at station ${slice + 1}/${slices}, its pillars.a ${set}`);
        }
        assert.ok(read >= slices - 2, `${id} aPillarTop ${aPillarTopZ(style)}: ${read} of ${slices} stations show under the roof`);
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

  it("when a style without a drip (roofDrip 0: the coupe's) is read, then its drawn roof's side stands nowhere out past the cant line (the side glass's plane): it rolls into the glass, no rail", () => {
    const ids = CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].roofDrip === 0);
    assert.ok(ids.length > 0, "no style sets roofDrip 0");
    for (const id of ids) {
      const style = CAR_STYLES[id];
      const pos = makeRoofGeometry(style).getAttribute("position") as THREE.BufferAttribute;
      let out = -Infinity;
      for (let i = 0; i < pos.count; i++) out = Math.max(out, Math.abs(pos.getX(i)) - cantX(pos.getZ(i), style));
      assert.ok(out <= 1e-6, `${id}: the roof's side stands ${(out * 1000).toFixed(1)} mm out past the cant line`);
    }
  });

  it("when any style's drawn A-post is read, then its top station lies inside the roof's z span, so the roof holds its whole top ring: no blade past the roof's front end", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      for (const post of makeGreenhouseFrame(style, "drawn").filter((g) => g.name === "a")) {
        const { ring, slices } = post.userData.loft as { ring: number; slices: number };
        const pos = post.getAttribute("position") as THREE.BufferAttribute;
        for (let k = (slices - 1) * ring; k < slices * ring; k++) {
          assert.ok(pos.getZ(k) <= style.roofZ[1], `${id}: A-post top vertex (${pos.getX(k)}, ${pos.getY(k)}, ${pos.getZ(k)}) past the roof's front end ${style.roofZ[1]}`);
        }
      }
    }
  });

  /** The pickup windshield's top-corner turn (°) from its flat pane: at 3.1° the corner mirrored the garage's key light into a bloom blob in the landing iso; at 0.76° (a quarter of the dome) it did not. */
  const PICKUP_CORNER_TURN_DEG = 1;

  it("when any style's raked panes are built, then each top edge follows its style's share of the roof's dome across the car (`domeFall`; every top-edge vertex stands as far over the roof at its x as the edge's middle does, less the dome it does not take; no vertex of the pane, frit or round corner further), while the corners the thrown dummies fit their slab to stay on the pane's plane through its middle", () => {
    const off: string[] = [];
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const corners = glassCorners(style);
      const panes = [
        { name: "windshield", top: style.windshieldTop, geo: makeWindshield(style), grid: true, segX: 10, segY: 8 },
        { name: "rear glass", top: style.rearGlass.top, geo: makeRearGlass(style), grid: !style.rearGlass.frame && !style.rearGlass.round, segX: 8, segY: 6 },
      ];
      for (const [p, { name, top: [topY, topZ], geo, grid, segX, segY }] of panes.entries()) {
        const middle = topY - roofTopY(0, topZ, style);
        const share = style.domeFall ?? 1;
        const overAt = (x: number, y: number) => y - roofTopY(x, topZ, style) - (1 - share) * (roofTopY(0, topZ, style) - roofTopY(x, topZ, style));
        const pos = geo.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          const over = overAt(pos.getX(i), pos.getY(i));
          if (over > middle + 1e-5) off.push(`${id} ${name} vertex x ${pos.getX(i).toFixed(3)}: ${(over * 1000).toFixed(1)} mm over the roof, its top's middle ${(middle * 1000).toFixed(1)} mm`);
        }
        for (let i = 0; grid && i <= segX; i++) {
          const over = overAt(pos.getX(segY * (segX + 1) + i), pos.getY(segY * (segX + 1) + i));
          if (Math.abs(over - middle) > 1e-5) off.push(`${id} ${name} top x ${pos.getX(segY * (segX + 1) + i).toFixed(3)}: ${(over * 1000).toFixed(1)} mm over the roof, its middle ${(middle * 1000).toFixed(1)} mm`);
        }
        for (const k of [2, 3]) if (Math.abs(corners[p * 12 + k * 3 + 1]! - topY) > 1e-5) off.push(`${id} ${name} slab corner ${k}: y ${corners[p * 12 + k * 3 + 1]}, the pane's plane ${topY}`);
      }
    }
    assert.ok(off.length === 0, off.join("\n"));
  });

  it(`when the pickup's windshield is built, then its top corners' normals turn under ${PICKUP_CORNER_TURN_DEG}° from the flat pane's and follow its own faces: at the roof's whole dome they turned 3.1° and mirrored the garage's key light`, () => {
    const pickup = CAR_STYLES.pickup;
    const [geo, flat] = [makeWindshield(pickup), makeWindshield({ ...pickup, domeFall: 0 })];
    const [pos, normal, flatNormal] = [geo.getAttribute("position"), geo.getAttribute("normal"), flat.getAttribute("normal")];
    const at = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, k: number) => new THREE.Vector3().fromBufferAttribute(a, k);
    const [segX, segY] = [10, 8];
    for (const [k, across] of [[segY * (segX + 1), 1], [segY * (segX + 1) + segX, -1]] as const) {
      const turn = THREE.MathUtils.radToDeg(at(normal, k).angleTo(at(flatNormal, k)));
      assert.ok(turn < PICKUP_CORNER_TURN_DEG, `top corner ${k}: its normal turns ${turn.toFixed(2)}° from the flat pane's`);
      const face = at(pos, k + across).sub(at(pos, k)).cross(at(pos, k - segX - 1).sub(at(pos, k))).normalize();
      const off = THREE.MathUtils.radToDeg(Math.min(face.angleTo(at(normal, k)), face.negate().angleTo(at(normal, k))));
      assert.ok(off < 0.5, `top corner ${k}: its normal ${off.toFixed(2)}° off its own face's`);
    }
  });

  it("when any style's drawn A-post is read, then it stands under 6 mm proud of the windshield's side edge as drawn, which falls with the roof's dome toward its top", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const [baseY, baseZ] = style.windshield.base;
      const [topY, topZ] = style.windshieldTop;
      const along = (y: number, z: number) => (y - baseY) * (topY - baseY) + (z - baseZ) * (topZ - baseZ);
      const glass = makeWindshield(style);
      const glassBehind = behindWindshieldEdge(glass, style);
      const gp = glass.getAttribute("position");
      // The pane's right column, base to top (its 10 × 8 grid).
      const edge = Array.from({ length: 9 }, (_, j) => j * 11 + 10).map((i) => ({ s: along(gp.getY(i), gp.getZ(i)), behind: glassBehind[i]! }));
      const [post] = aPillarParts(style);
      const pos = post!.getAttribute("position");
      const behind = behindWindshieldEdge(post!, style);
      let proud = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const s = along(pos.getY(i), pos.getZ(i));
        const j = edge.findIndex((e, k) => k > 0 && s <= e.s);
        if (s < edge[0]!.s || j < 0) continue;
        const [a, b] = [edge[j - 1]!, edge[j]!];
        proud = Math.max(proud, lerp(a.behind, b.behind, (s - a.s) / (b.s - a.s)) - behind[i]!);
      }
      assert.ok(proud < 0.006, `${id}: the A-post stands ${(proud * 1000).toFixed(1)} mm proud of the windshield's drawn edge`);
    }
  });

  it("when any style's drawn rear post (no sail) is read, then its top ring lies inside the roof's z span, so the roof takes all of it down the dome: no fold where half of it stood over the roof", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      if (style.cPillar) continue;
      for (const post of makeGreenhouseFrame(style, "drawn").filter((g) => g.name === "rear")) {
        const { ring, slices } = post.userData.loft as { ring: number; slices: number };
        const pos = post.getAttribute("position") as THREE.BufferAttribute;
        for (let k = (slices - 1) * ring; k < slices * ring; k++) {
          assert.ok(pos.getZ(k) >= style.roofZ[0], `${id}: rear post top vertex (${pos.getX(k)}, ${pos.getY(k)}, ${pos.getZ(k)}) behind the roof's rear end ${style.roofZ[0]}`);
        }
      }
    }
  });

  it("when a drawn A-post 10 cm wide or more is read at a station under the roof, then its outer face turns 25° or more across its width, outboard on both sides: a curved post from the side glass to the windshield, not a flat plank (the plank turned 15-20°)", () => {
    /** A post section's outer face in ring points (`postSection`: three chords a corner, then the crown's three points): its edges and the chords off them. */
    const FACE = { edge: [3, 7], next: [4, 6] } as const;
    /** A 10 cm post's outer face between its 13.5 mm corners (m): narrower posts read round at any crown. */
    const WIDE_FACE = 0.073;
    let read = 0;
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      for (const post of makeGreenhouseFrame(style, "drawn").filter((g) => g.name === "a")) {
        const { ring, slices } = post.userData.loft as { ring: number; slices: number };
        const pos = post.getAttribute("position") as THREE.BufferAttribute;
        for (let slice = 0; slice < slices; slice++) {
          const at = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, slice * ring + k);
          const points = Array.from({ length: ring }, (_, k) => at(k));
          if (points.some((p) => p.z >= style.roofZ[0] && p.z <= style.roofZ[1] && p.y > cantY(p.z, style))) continue;
          const [a, b] = [at(FACE.edge[0]), at(FACE.edge[1])];
          if (a.distanceTo(b) < WIDE_FACE) continue;
          read++;
          const centre = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(ring);
          const mid = a.clone().add(b).multiplyScalar(0.5);
          assert.ok(Math.abs(mid.x) > Math.abs(centre.x), `${id} station ${slice}: the crowned face stands inboard of the post's centre (x ${mid.x} vs ${centre.x})`);
          const turn = at(FACE.next[0]).sub(a).angleTo(b.clone().sub(at(FACE.next[1])));
          assert.ok(turn >= THREE.MathUtils.degToRad(25), `${id} station ${slice}: the outer face turns ${THREE.MathUtils.radToDeg(turn).toFixed(1)}° across ${(a.distanceTo(b) * 1000).toFixed(0)} mm`);
        }
      }
    }
    assert.ok(read > 0, "no A-post station 10 cm wide under the roof");
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
    // The control has no knee: the sedan's own off.
    const sedan: BodyStyle = { ...CAR_STYLES.sedan, aPillarKnee: undefined };
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

  it("when a style blacks out greenhouse parts, then exactly their drawn vertices turn gloss black, and the drawn shape and the cage are unchanged", () => {
    // The style may black out parts of its own: the row's control is the wagon with none.
    const wagon: BodyStyle = { ...CAR_STYLES.wagon, blackout: undefined };
    const dark: BodyStyle = { ...wagon, blackout: { b: true, divider: true } };
    const primer = (g: THREE.BufferGeometry) => g.getAttribute(PRIMER_ATTRIBUTE) as THREE.BufferAttribute;
    const [was, now] = [makeChassisGeometry(wagon), makeChassisGeometry(dark)];
    // A turned vertex lies on the B-pillar's or the divider's band (the wagon's divider is 10.5 cm wide), 1 cm at most past its edges.
    const bands = [bPillarBand(wagon), pillarBands(wagon.pillars!.divider!, wagon.midPillarZ!)];
    const onBand = (z: number) => bands.some(({ belt, top }) => z > Math.min(belt[0], top[0]) - 0.01 && z < Math.max(belt[1], top[1]) + 0.01);
    let turned = 0;
    for (let i = 0; i < primer(now).count; i++) {
      if (primer(now).getX(i) === primer(was).getX(i)) continue;
      turned++;
      const z = now.getAttribute("position").getZ(i);
      assert.ok(onBand(z), `vertex ${i} at z ${z} turned dark: off the B-pillar and divider bands ${JSON.stringify(bands)}`);
      assert.ok(primer(now).getX(i) === BLACKOUT, `vertex ${i} turned to ${primer(now).getX(i)}: blacked-out pillars are gloss black (BLACKOUT), not bare-steel primer`);
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

  it("when the SUV's rear pillar is matte, then exactly the gloss-black rear pillar's vertices turn matte black, and the drawn shape is unchanged", () => {
    const wagon = CAR_STYLES.wagon;
    const gloss: BodyStyle = { ...wagon, blackout: { ...wagon.blackout, rear: true } };
    const primer = (g: THREE.BufferGeometry) => g.getAttribute(PRIMER_ATTRIBUTE) as THREE.BufferAttribute;
    const [was, now] = [makeChassisGeometry(gloss), makeChassisGeometry(wagon)];
    let turned = 0;
    for (let i = 0; i < primer(now).count; i++) {
      if (primer(now).getX(i) === primer(was).getX(i)) continue;
      turned++;
      assert.ok(primer(was).getX(i) === BLACKOUT && primer(now).getX(i) === MATTE_BLACKOUT, `vertex ${i}: ${primer(was).getX(i)} → ${primer(now).getX(i)}`);
    }
    const rear = makeGreenhouseFrame(wagon, "drawn").filter((g) => g.userData.matte === true);
    assert.ok(rear.length === 2 && turned === rear.reduce((n, g) => n + g.getAttribute("position").count, 0), `${rear.length} matte pillars, ${turned} vertices turned`);
    const bits = (g: THREE.BufferGeometry) => createHash("sha256").update(new Uint8Array((g.getAttribute("position").array as Float32Array).buffer)).digest("hex");
    assert.ok(bits(now) === bits(was), "the drawn body's shape is unchanged");
  });

  it("when a style blacks out its cowl, then the deck's crown from 5 cm under the windshield's foot to 5 cm under the hood's rear edge turns primer-dark, and nothing else does", () => {
    const sedan = CAR_STYLES.sedan;
    // The hood's rear edge 6 cm ahead of the glass's foot: a strip of deck shows between them.
    const open: BodyStyle = { ...sedan, blackout: undefined, hood: { ...sedan.hood, z0: sedan.windshield.base[1] + 0.06 } };
    const [was, now] = [makeChassisGeometry(open), makeChassisGeometry({ ...open, blackout: { cowl: true } })];
    const primer = (g: THREE.BufferGeometry) => g.getAttribute(PRIMER_ATTRIBUTE) as THREE.BufferAttribute;
    const { ring, slices } = now.userData.loft as { ring: number; slices: number };
    const [from, to] = [sedan.windshield.base[1] - 0.05, open.hood.z0 + 0.05];
    let turned = 0;
    for (let v = 0; v < primer(now).count; v++) {
      if (primer(now).getX(v) === primer(was).getX(v)) continue;
      turned++;
      const z = now.getAttribute("position").getZ(v);
      const onCrown = v < ring * slices && (v % ring === 0 || v % ring === ring - 1);
      assert.ok(onCrown && z >= from - 1e-6 && z <= to + 1e-6 && primer(now).getX(v) === BLACKOUT, `vertex ${v} (ring point ${v % ring}) at z ${z} turned to ${primer(now).getX(v)}: off the cowl's crown [${from}, ${to}]`);
    }
    assert.ok(turned >= 4, `the cowl's crown on both sides at two slices at least: ${turned} vertices turned`);
  });

  it("when a style leans its B-pillar and its divider, then the drawn pillars take their bands at the belt and the top, the side panes tuck under the B-pillar's edges, and the cage keeps its bands", () => {
    const wagon = CAR_STYLES.wagon;
    const m = wagon.midPillarZ!;
    const bz = (wagon.bPillar.rear + wagon.bPillar.front) / 2;
    // 17 cm at the belt, 10 at the top, its rear edge upright: the front door frame's rear edge leans into it (the sedan's reference).
    const moved: BodyStyle = { ...wagon, pillars: { b: { width: [0.17, 0.1], z: [bz + 0.035, bz] }, divider: { width: [0.05, 0.04], z: [m - 0.06, m + 0.04] } } };
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
    assertSameNumbers(spans(parts[1]!), [bz - 0.05, bz + 0.12, bz - 0.05, bz + 0.05], "B-pillar z span at the belt and at its top", 1e-5);
    assertSameNumbers(spans(parts[3]!), [m - 0.085, m - 0.035, m + 0.02, m + 0.06], "divider z span at the belt and at its top", 1e-5);
    // glassCorners: doorR is pane 3, its rear corners (across 0) at the base and the top; quarterR is pane 5, its front corners (across 1).
    const c = glassCorners(moved);
    assertSameNumbers([c[3 * 12 + 2]!, c[3 * 12 + 6 + 2]!, c[5 * 12 + 3 + 2]!, c[5 * 12 + 9 + 2]!], [bz + 0.11, bz + 0.04, bz - 0.04, bz - 0.04], "door glass rear and quarter glass front edges, 1 cm under the B-pillar's edges at the belt and the top (z)", 1e-5);
    const cage = (style: BodyStyle) => makeGreenhouseFrame(style, "cage").map((g) => Array.from(g.getAttribute("position").array).join(",")).join("|");
    assert.ok(cage(moved) === cage(wagon), "the cage greenhouse is unchanged");
  });

  it("when every style's drawn belt rail is read, then it runs along the quarter glass's belt edge on the glass plane, flush: its top covers the edge at every glass column and stands at most 5 mm over it, no vertex more than 1 cm out of it", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      // The quarter pane's belt edge (its uv row 0, rear to front, car space); past its front, under the B-pillar, the belt line.
      const pane = makeRearSideGlass(1, style);
      const [panePos, uv] = [pane.getAttribute("position"), pane.getAttribute("uv")];
      const edge: [number, number, number][] = [];
      for (let i = 0; i < panePos.count; i++) if (uv.getY(i) === 0) edge.push([panePos.getZ(i), panePos.getY(i), panePos.getX(i)]);
      const sillAt = (z: number): [number, number] => {
        const k = edge.findIndex(([ez]) => ez >= z);
        if (k < 0) return [beltX(z, style), beltY(z, style)];
        if (k === 0) return [edge[0]![2], edge[0]![1]];
        const [[z0, y0, x0], [z1, y1, x1]] = [edge[k - 1]!, edge[k]!];
        const t = (z - z0) / (z1 - z0);
        return [lerp(x0, x1, t), lerp(y0, y1, t)];
      };
      const rail = makeGreenhouseFrame(style, "drawn").find((g) => g.name === "beltRail")!;
      const pos = rail.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);
        const [x, y] = sillAt(z);
        const [out, over] = [Math.abs(pos.getX(i)) - x, pos.getY(i) - y];
        // 1 mm over the lip for the inner face, carried a few mm along the sill where its depth runs square to a sill turning in.
        assert.ok(out <= RAIL_PROUD + 1e-6 && over <= RAIL_LIP + 1e-3, `${id} rail vertex ${i} at z ${z.toFixed(3)}: ${(out * 100).toFixed(1)} cm out of the glass's edge, ${(over * 100).toFixed(1)} cm over it`);
      }
      // Each ring's top outer vertex, the lip on the glass plane: the rail's top line, read at every glass column.
      const { ring, slices } = rail.userData.loft as { ring: number; slices: number };
      const tops = Array.from({ length: slices }, (_, s) => {
        let best = s * ring;
        for (let i = best; i < (s + 1) * ring; i++) if (pos.getY(i) - pos.getY(best) > 1e-9 || (Math.abs(pos.getY(i) - pos.getY(best)) <= 1e-9 && Math.abs(pos.getX(i)) > Math.abs(pos.getX(best)))) best = i;
        return [pos.getZ(best), pos.getY(best)] as const;
      });
      for (const [z, y] of edge) {
        const k = Math.max(tops.findIndex(([tz]) => tz >= z - 1e-6), 1);
        const [[z0, y0], [z1, y1]] = [tops[k - 1]!, tops[k]!];
        const over = lerp(y0, y1, (z - z0) / (z1 - z0)) - y;
        assert.ok(over >= -1e-4 && over <= RAIL_LIP + 1e-4, `${id} rail top at the glass's column z ${z.toFixed(3)}: ${(over * 1000).toFixed(1)} mm over its edge`);
      }
    }
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

  it("when a bumper has lofted ends, then each runs on along the body side to `back`, its face `stand` off the skin there, where the plain wrap of the same bumper stays inside the skin", () => {
    const coupe = CAR_STYLES.coupe;
    const { front } = coupe.bumpers;
    assert.ok(front.wrap.end, "the control: the coupe's front bumper has lofted ends");
    const plain: BodyStyle = { ...coupe, bumpers: { ...coupe.bumpers, front: { ...front, wrap: { from: front.wrap.from, back: front.wrap.back } } } };
    // The bumper's rearmost z (car frame), and how far its rearmost ring's outermost point stands past the body side at its height (m).
    const endOf = (style: BodyStyle) => {
      const pos = makeBumperGeometry(true, style).getAttribute("position");
      let rear = Infinity;
      for (let i = 0; i < pos.count; i++) rear = Math.min(rear, pos.getZ(i));
      let stand = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getZ(i) > rear + 0.005) continue;
        const [z, y] = [front.seat.z + pos.getZ(i), front.seat.y + pos.getY(i)];
        const slice = sampleSlice(z, coupe.profile);
        stand = Math.max(stand, Math.abs(pos.getX(i)) - sideX(y, slice.hw, slice.yBelt, rockerAt(z, coupe)));
      }
      return { rear: front.seat.z + rear, stand };
    };
    const [lofted, wrapped] = [endOf(coupe), endOf(plain)];
    const faceZ = front.seat.z + Math.max(...front.fascia.map(([, out]) => out));
    assert.ok(Math.abs(faceZ - lofted.rear - front.wrap.back) < 0.001, `the lofted end runs ${faceZ - lofted.rear} m back from the face, ${front.wrap.back} asked`);
    assert.ok(lofted.stand >= front.wrap.end.stand - 0.001, `the lofted end stands ${lofted.stand} m off the skin, ${front.wrap.end.stand} asked`);
    assert.ok(wrapped.stand <= 0, `the plain wrap's end stands ${wrapped.stand} m off the skin: held inside it`);
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
    const wheels = carFrame(moved).wheels;
    for (const [k, liner] of makeWellLiners(moved, "drawn", makeChassisGeometry(moved)).entries()) {
      const wz = wheels[k]![2];
      const side = sampleSlice(wz, moved.profile).hw;
      const box = partBox(liner);
      const reach = Math.max(box.max.x, -box.min.x);
      assert.ok(reach <= side + 0.02, `liner ${k} reaches x ${reach} on a 2.2 m track, the body side ${side} at its wheel (z ${wz})`);
    }
  });

  /** A drawn liner's outer end stands at least this far (m) inside the body side 5 to 8 cm past its opening (nearer, the edge rolls in). */
  const LINER_END_INSIDE = 0.005;
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id} is drawn, then no wheel-well liner hangs below the rocker and each one's outer end stands inside the body side 5 to 8 cm past its opening, so no end shows outboard of the body`, () => {
      const style = CAR_STYLES[id];
      const body = makeChassisGeometry(style);
      const { ring, slices } = body.userData.loft as { ring: number; slices: number };
      const skin = new THREE.BufferGeometry().setAttribute("position", body.getAttribute("position"));
      skin.setIndex(Array.from(body.getIndex()!.array.subarray(0, (slices - 1) * ring * 6)));
      const loft = new THREE.Mesh(skin, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
      const ray = new THREE.Raycaster();
      const r = style.arch.radius;
      let worst = -Infinity;
      let where = "";
      let below = 0;
      let belowAt = "";
      for (const [k, liner] of makeWellLiners(style, "drawn", body).entries()) {
        const [wx, wy, wz] = carFrame(style).wheels[k]!;
        const side = Math.sign(wx);
        const pos = liner.getAttribute("position");
        let inner = Infinity;
        for (let v = 0; v < pos.count; v++) inner = Math.min(inner, pos.getX(v) * side);
        for (let v = 0; v < pos.count; v++) {
          const x = pos.getX(v) * side;
          const [y, z] = [pos.getY(v), pos.getZ(v)];
          if (x <= inner + 0.01 || Math.abs(Math.hypot(y - wy, z - wz) - r) > 1e-4) continue;
          if (rockerAt(z, style) - y > below) [below, belowAt] = [rockerAt(z, style) - y, `liner ${k} at z ${z.toFixed(3)}`];
          let skinX = Infinity;
          for (let seek = 0.05; seek <= 0.08 + 1e-9; seek += 0.005) {
            const at = new THREE.Vector3(3 * side, y + ((y - wy) / r) * seek, z + ((z - wz) / r) * seek);
            ray.set(at, new THREE.Vector3(-side, 0, 0));
            const hit = ray.intersectObject(loft)[0];
            if (hit && hit.point.x * side > inner) skinX = Math.min(skinX, hit.point.x * side);
          }
          if (skinX !== Infinity && x - skinX > worst) [worst, where] = [x - skinX, `liner ${k} at y ${y.toFixed(3)} z ${z.toFixed(3)}`];
        }
      }
      assert.ok(below <= 0.001, `${id}: ${belowAt} hangs ${(below * 100).toFixed(1)} cm below the rocker`);
      assert.ok(worst <= -LINER_END_INSIDE, `${id}: ${where} stands ${(worst * 100).toFixed(1)} cm outboard of the body side (bar: ${LINER_END_INSIDE * 100} cm inside)`);
    });
  }

  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s arch lips are drawn, then their dark underside stands only over the round opening, never as a dark fin over the painted skin`, () => {
      const style = CAR_STYLES[id];
      const lips = archLipGeometry(style, makeChassisGeometry(style));
      if (!lips) return;
      const pos = lips.getAttribute("position");
      const tone = lips.userData.tone as Float32Array;
      const [r, rise] = [style.arch.radius, style.arch.rise ?? 1];
      let worst = 0;
      for (let v = 0; v < pos.count; v++) {
        if (tone[v] === 0) continue;
        const [y, z] = [pos.getY(v), pos.getZ(v)];
        const past = Math.min(...carFrame(style).wheels.map(([, wy, wz]) => (y < wy ? Math.abs(z - wz) : Math.hypot((y - wy) / rise, z - wz)))) - r;
        worst = Math.max(worst, past);
      }
      assert.ok(worst <= 0.01, `${id}: a dark lip vertex stands ${(worst * 100).toFixed(1)} cm out past the opening, over painted skin`);
    });
  }

  for (const id of CAR_STYLE_IDS) {
    const inset = CAR_STYLES[id].arch.lip?.inset;
    if (inset === undefined) continue;
    it(`when the ${id}'s arch lips stand ${inset} m in over their openings, then from outside each arch's top reads painted lip down to that far under the opening's edge, where the lip-less arch shows the well`, () => {
      const style = CAR_STYLES[id];
      const plain: BodyStyle = { ...style, arch: { ...style.arch, lip: { ...style.arch.lip!, inset: undefined } } };
      /** The lowest height (m, under the arch's top) a ray in from outside over each wheel's top still meets paint at. */
      const paintedDown = (s: BodyStyle) => {
        const drawn = new THREE.Mesh(makeChassisGeometry(s), FRONT);
        let worst = Infinity;
        for (const [wx, wy, wz] of carFrame(s).wheels) {
          let down = 0;
          for (let d = 0.005; d < 0.15; d += 0.005) {
            const hit = toneHit(drawn, [Math.sign(wx) * 3, wy + s.arch.radius * (s.arch.rise ?? 1) - d, wz], [-Math.sign(wx), 0, 0], 6);
            if (!hit || hit.tone !== 0) break;
            down = d;
          }
          worst = Math.min(worst, down);
        }
        return worst;
      };
      const [lipped, bare] = [paintedDown(style), paintedDown(plain)];
      assert.ok(bare < inset / 2, `the control: the lip-less ${id} arch reads paint ${(bare * 100).toFixed(1)} cm under its top`);
      assert.ok(lipped >= inset - 0.01, `the ${id} arch reads paint only ${(lipped * 100).toFixed(1)} cm under its top, its lip stands ${inset * 100} cm in`);
    });
  }

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
    bottom: [[zMin, zMax], [0, halfWidth]],
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
/** Each side's lamp meets its own skin (the left's triangles are not the right's mirror), so its extent mirrors the other's to the meets' rounding (m). */
const OWN_SKIN_MIRROR_TOL = 1e-4;

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

/** A hood (`withHoodBulge`) read in the car frame: the box of the vertices standing over the lid, the highest point over the lid's centre line, and its near-black mouths' box and least forward normal. */
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
    if (primer !== null && primer.getX(i) === WELL_PANEL) {
      mouth.expandByPoint(p);
      forward = Math.min(forward, nrm.getZ(i));
    } else if (p.y - deckTopY(p.x, p.z, style, true) > RAISED_M) raised.expandByPoint(p);
    peak = Math.max(peak, p.y - deckTopY(0, p.z, style, true));
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
  return { style, body, from, all: toneBox(body, null, 0, from), dark: toneBox(body, PRIMER_ATTRIBUTE, BLACKOUT, from) };
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
    it: "when a rear bumper carries twin round tips, then a chrome oval with a dark rear-facing throat stands at each of ±x at its y, its size across, ending at the bumper's face behind it (none past it, round the wrapped corner too), and the cage builds are unchanged",
    exhaust: { tips: 2, x: 0.55, y: 0.22, size: [0.09, 0.06], shape: "round" },
    expectedXs: [-0.55, 0.55],
  },
  {
    it: "when a rear bumper carries one rectangular tip, then one chrome box with a dark rear-facing throat stands at its x and y, its size across, ending at the bumper's face behind it (none past it), and the cage builds are unchanged",
    exhaust: { tips: 1, x: 0.4, y: 0.25, size: [0.12, 0.06], shape: "rect" },
    expectedXs: [0.4],
  },
  {
    it: "when a rear bumper carries twin round tips in its band at the wrapped corner, then each ends at the face behind it, centimetres forward of the bumper's rearmost point, not standing out of the corner",
    exhaust: { tips: 2, x: 0.55, y: 0.47, size: [0.09, 0.05], shape: "round" },
    expectedXs: [-0.55, 0.55],
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

  it("when a crowned hood sets its inset, then its side edge stands that far inside the station's side, the cowl's at z0 and the nose's at z1, at the plain edge's height under the plain crown, and the cage builds are unchanged", () => {
    const plain: BodyStyle = { ...sedan, hood: { ...sedan.hood, inset: undefined } };
    const [nose, cowl] = sedan.hood.inset!;
    const halfWidth = (style: BodyStyle, z: number): number => {
      const pos = makeHoodGeometry(style).getAttribute("position");
      let w = 0;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) + style.hood.origin[1] - z) < POSITION_TOL) w = Math.max(w, Math.abs(pos.getX(i)));
      return w;
    };
    const { z0, z1 } = sedan.hood;
    assertSameNumbers([halfWidth(plain, z0) - halfWidth(sedan, z0), halfWidth(plain, z1) - halfWidth(sedan, z1)], [cowl - 0.07, nose - 0.07], "the inset past the plain 0.07 at the cowl and the nose", 1e-4);
    for (const z of [z0, (z0 + z1) / 2]) {
      const hw = sampleSlice(z, sedan.profile).hw;
      const edge = hw - lerp(cowl, nose, (z - z0) / (z1 - z0));
      const heights = [deckTopY(edge, z, sedan, true), deckTopY(0, z, sedan, true)];
      assertSameNumbers(heights, [deckTopY(hw - 0.07, z, plain, true), deckTopY(0, z, plain, true)], `at z ${z} the inset edge and the crown against the plain hood's`, 1e-6);
    }
    assert.ok(cageHash(sedan) === cageHash(plain), "the cage builds are unchanged");
  });

  it("when a hood bulge is rolled, then its flanks roll up from the lid in steps outside its crest, the crest stays inside the roll, and the cage builds are unchanged", () => {
    const bulge = { z0: 0.9, z1: 1.8, width: 0.6, rise: 0.04, round: 0.1 } as const;
    const style: BodyStyle = { ...sedan, hood: { ...sedan.hood, bulge } };
    const hood = withHoodBulge(makeHoodGeometry(style), style);
    const [oy, oz] = style.hood.origin;
    const zMid = (bulge.z0 + bulge.z1) / 2;
    const pos = hood.getAttribute("position");
    const raised: { x: number; y: number }[] = [];
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = [pos.getX(i), pos.getY(i) + oy, pos.getZ(i) + oz];
      if (Math.abs(z - zMid) < 1e-3 && y - deckTopY(x, z, style, true) > RAISED_M) raised.push({ x: Math.abs(x), y });
    }
    const steps = [...new Set(raised.map((v) => Math.round(v.x * 1000)))].sort((a, b) => a - b);
    assert.ok(steps.length >= 2, `the roll stands at one |x| only: ${steps.join(", ")} mm`);
    const top = Math.max(...raised.map((v) => v.y));
    for (const v of raised) {
      if (top - v.y < 1e-4) assert.ok(v.x <= bulge.width / 2 - bulge.round + POSITION_TOL, `the crest reaches |x| ${v.x.toFixed(4)}, outside its ${(bulge.width / 2 - bulge.round).toFixed(4)}`);
    }
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a hood bulge sets a cowl ramp and a cowl width, then it widens toward its cowl end and eases into the lid over that run there, its nose end as without them, and the cage builds are unchanged", () => {
    const plainBulge = { z0: 0.9, z1: 1.8, width: 0.4, rise: 0.04 } as const;
    const plain: BodyStyle = { ...sedan, hood: { ...sedan.hood, bulge: plainBulge } };
    const style: BodyStyle = { ...sedan, hood: { ...sedan.hood, bulge: { ...plainBulge, cowlWidth: 0.6, cowlRamp: 0.4 } } };
    /** On the bulge's ring `k` of 16: the most |x| standing over the lid, and the most it stands over the lid's centre line. */
    const ring = (s: BodyStyle, k: number): { x: number; top: number } => {
      const z = lerp(plainBulge.z0, plainBulge.z1, k / 16);
      const [oy, oz] = s.hood.origin;
      const pos = withHoodBulge(makeHoodGeometry(s), s).getAttribute("position");
      let [x, top] = [0, -Infinity];
      for (let i = 0; i < pos.count; i++) {
        const [vx, vy, vz] = [pos.getX(i), pos.getY(i) + oy, pos.getZ(i) + oz];
        if (Math.abs(vz - z) > 1e-4 || vy - deckTopY(vx, vz, s, true) <= RAISED_M) continue;
        x = Math.max(x, Math.abs(vx));
        top = Math.max(top, vy - deckTopY(0, vz, s, true));
      }
      return { x, top };
    };
    // Rings 4 and 12 sit a quarter and three quarters of the way from the cowl: 0.6 -> 0.4 wide narrows them 5 cm apart in half-width.
    assertSameNumbers([ring(style, 4).x - ring(style, 12).x, ring(plain, 4).x - ring(plain, 12).x], [0.05, 0], "the crest's half-width at ring 4 over ring 12", 1e-6);
    // Ring 4 is 0.225 m in from the cowl end: past the 0.15 m ramp at full rise, still on the 0.4 m one.
    assert.ok(ring(style, 4).top < plainBulge.rise * 0.6 && Math.abs(ring(plain, 4).top - plainBulge.rise) < 1e-6, `ring 4 stands ${ring(style, 4).top.toFixed(4)} m with the cowl ramp, ${ring(plain, 4).top.toFixed(4)} without`);
    assert.ok(ring(style, 15).top === ring(plain, 15).top, "the nose end eases in as before");
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a hood bulge sets a mouth, then its nose ring stands at full rise where the plain pod's sits on the lid, so its front cap is a face looking forward, and the cage builds are unchanged", () => {
    const plainBulge = { z0: 0.9, z1: 1.8, width: 0.4, rise: 0.04 } as const;
    const plain: BodyStyle = { ...sedan, hood: { ...sedan.hood, bulge: plainBulge } };
    const style: BodyStyle = { ...sedan, hood: { ...sedan.hood, bulge: { ...plainBulge, mouth: true } } };
    /** The most any hood vertex at the bulge's nose end (z1) stands over the lid's centre line. */
    const noseTop = (s: BodyStyle): number => {
      const [oy, oz] = s.hood.origin;
      const pos = withHoodBulge(makeHoodGeometry(s), s).getAttribute("position");
      let top = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const [vy, vz] = [pos.getY(i) + oy, pos.getZ(i) + oz];
        if (Math.abs(vz - plainBulge.z1) < 1e-4) top = Math.max(top, vy - deckTopY(0, vz, s, true));
      }
      return top;
    };
    assertSameNumbers([noseTop(style)], [plainBulge.rise], "the mouth pod's nose ring over the lid", 1e-6);
    assert.ok(noseTop(plain) < RAISED_M, `the plain pod's nose stands ${noseTop(plain).toFixed(4)} m over the lid`);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a hood bulge sets a groove, then mid-pod its crest dips that deep on the centre line, where the plain pod's crest has no vertex at all, and the cage builds are unchanged", () => {
    const bulge = { z0: 0.9, z1: 1.8, width: 0.6, rise: 0.04, round: 0.1 } as const;
    /** Over the bulge's mid ring, among the vertices standing over the lid: the crest's top less the top on the centre line (Infinity: none there). */
    const dip = (b: NonNullable<BodyStyle["hood"]["bulge"]>): number => {
      const style: BodyStyle = { ...sedan, hood: { ...sedan.hood, bulge: b } };
      const [oy, oz] = style.hood.origin;
      const zMid = (b.z0 + b.z1) / 2;
      const pos = withHoodBulge(makeHoodGeometry(style), style).getAttribute("position");
      let [crest, centre] = [-Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++) {
        const [x, y, z] = [pos.getX(i), pos.getY(i) + oy, pos.getZ(i) + oz];
        if (Math.abs(z - zMid) > 1e-3 || y - deckTopY(x, z, style, true) <= RAISED_M) continue;
        crest = Math.max(crest, y);
        if (Math.abs(x) < 1e-6) centre = Math.max(centre, y);
      }
      return crest - centre;
    };
    const grooved = { ...bulge, groove: 0.004 };
    assertSameNumbers([dip(grooved)], [0.004], "the grooved crest's dip on the centre line", 1e-6);
    assert.ok(dip(bulge) === Infinity, `the plain crest dips ${dip(bulge)} on the centre line`);
    assert.ok(cageHash({ ...sedan, hood: { ...sedan.hood, bulge: grooved } }) === cageHash(sedan), "the cage builds are unchanged");
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
    const { lip: ownLip, ...bareDeck } = coupe.boot;
    const { lip: gateLip, ...gate } = hatchback.boot;
    assert.ok(bareDeck.kind === "lid" && gate.kind === "tailgate", "the coupe has a deck lid, the hatchback a tailgate");
    // The plain deck and gate are the coupe's lid and the hatch's gate without their own lips, so the measured rise is the test lip's alone.
    const deck = bareDeck;
    const plainStyle: BodyStyle = { ...coupe, boot: bareDeck };
    const deckStyle: BodyStyle = { ...coupe, boot: { ...bareDeck, lip } };
    const plainGateStyle: BodyStyle = { ...hatchback, boot: gate };
    const gateStyle: BodyStyle = { ...hatchback, boot: { ...gate, lip } };
    assert.ok((ownLip === undefined || ownLip.rise > 0) && (gateLip === undefined || gateLip.rise < 0), "the coupe's own lip, if any, rises; the hatch's, if any, rolls in");
    const [plainDeck, lipDeck, plainGate, lipGate] = [plainStyle, deckStyle, plainGateStyle, gateStyle].map((s) => makeTrunkGeometry(s));
    const edge = deck.z1 - deck.origin[1];
    const deckIn = lerp(deck.z0, deck.z1, 0.8) - deck.origin[1];
    const gateTop = gate.origin[0] - bootPivot(gate)[0];
    const gateDown = gateTop + lerp(gate.y0, gate.origin[0], 0.6) - gate.origin[0];
    const top = (g: THREE.BufferGeometry, at: number) => extremeAt(g, 2, at, 1, 1);
    const face = (g: THREE.BufferGeometry, at: number) => extremeAt(g, 1, at, 2, -1);
    assertSameNumbers([top(lipDeck!, edge) - top(plainDeck!, edge), top(lipDeck!, deckIn) - top(plainDeck!, deckIn)], [lip.rise, 0], "the deck lid's top over the plain one's at its rear edge and 0.13 m in", 1e-5);
    assertSameNumbers([face(plainGate!, gateTop) - face(lipGate!, gateTop), face(plainGate!, gateDown) - face(lipGate!, gateDown)], [lip.rise, 0], "the tailgate's face behind the plain one's at its top edge and 0.15 m down", 1e-5);
    assert.ok(cageHash(deckStyle) === cageHash(plainStyle) && cageHash(gateStyle) === cageHash(plainGateStyle) && cageHash(plainGateStyle) === cageHash(hatchback), "the cage builds are unchanged");
  });

  it("when a deck lid is flush, then its edge seats on the deck edge like the hood's, lower and wider than the plain lid's step, its crown unchanged, and the cage builds are unchanged", () => {
    const { coupe } = CAR_STYLES;
    const bareDeck = { ...coupe.boot, flush: undefined };
    const deck = coupe.boot;
    assert.ok(deck.kind === "lid", "the coupe has a deck lid");
    const plainStyle: BodyStyle = { ...coupe, boot: bareDeck };
    const flushStyle: BodyStyle = { ...coupe, boot: { ...bareDeck, flush: true } };
    const z = lerp(deck.z0, deck.z1, 0.5) - deck.origin[1];
    const edgeAt = (g: THREE.BufferGeometry) => {
      const pos = g.getAttribute("position");
      let [w, y, crown] = [0, -Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - z) < 1e-6) [w, crown] = [Math.max(w, Math.abs(pos.getX(i))), Math.max(crown, pos.getY(i))];
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - z) < 1e-6 && Math.abs(pos.getX(i)) > w - 1e-6) y = Math.max(y, pos.getY(i));
      return { w, y, crown };
    };
    const [plain, flush] = [plainStyle, flushStyle].map((s) => edgeAt(makeTrunkGeometry(s)));
    assert.ok(plain!.w > 0 && flush!.w > 0, "the control: both lids have a ring at mid deck");
    assert.ok(plain!.y - flush!.y > 0.005, `the flush lid's edge (${flush!.y.toFixed(4)}) sits over 5 mm under the plain lid's step (${plain!.y.toFixed(4)})`);
    assert.ok(flush!.w > plain!.w, `the flush lid runs out to the deck edge (half-width ${flush!.w.toFixed(4)} against ${plain!.w.toFixed(4)})`);
    assertSameNumbers([flush!.crown], [plain!.crown], "the lid's crown", 1e-6);
    assert.ok(cageHash(flushStyle) === cageHash(plainStyle), "the cage builds are unchanged");
  });

  /** A rolled lid edge's sharpest turn (°): its one chord splits the corner's ~90° turn in two; a sharp corner turns ~90°. */
  const ROLLED_TURN_MAX = 50;
  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];
    if (style.boot.edgeRoll === undefined) continue;
    it(`when the ${id}'s ${style.boot.kind === "lid" ? "boot lid" : "tailgate"} is drawn with its edgeRoll, then its side edges turn under ${ROLLED_TURN_MAX}° (the field-less build turns ~90°), and the cage builds are unchanged`, () => {
      const plain: BodyStyle = { ...style, boot: { ...style.boot, edgeRoll: undefined } };
      /** The sharpest turn (°) along a ring at mid panel over its right-hand top and upper side (the upper share of its height). */
      const edgeTurn = (s: BodyStyle) => {
        const geo = makeTrunkGeometry(s);
        const { ring, slices } = geo.userData.loft as { ring: number; slices: number };
        const pos = geo.getAttribute("position");
        const at = Math.floor(slices / 2) * ring;
        const p = Array.from({ length: ring }, (_, i) => [pos.getX(at + i), pos.getY(at + i), pos.getZ(at + i)] as const);
        // The ring's plane holds two of x/y/z; across it, x and the panel's other varying axis (y for a lid, z for an upright gate).
        const spanY = Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1]));
        const spanZ = Math.max(...p.map((q) => q[2])) - Math.min(...p.map((q) => q[2]));
        const up = spanY >= spanZ ? 1 : 2;
        const sign = up === 1 ? 1 : -1;
        const h = p.map((q) => sign * q[up]);
        const [hi, lo] = [Math.max(...h), Math.min(...h)];
        let worst = 0;
        for (let i = 0; i < ring; i++) {
          if (p[i]![0] <= 0 || h[i]! < hi - 0.6 * (hi - lo)) continue;
          const [a, b] = [p[(i + ring - 1) % ring]!, p[(i + 1) % ring]!];
          const [ux, uh, vx, vh] = [p[i]![0] - a[0], h[i]! - sign * a[up], b[0] - p[i]![0], sign * b[up] - h[i]!];
          const turn = THREE.MathUtils.radToDeg(Math.abs(Math.atan2(ux * vh - uh * vx, ux * vx + uh * vh)));
          worst = Math.max(worst, turn);
        }
        return worst;
      };
      const [rolled, sharp] = [edgeTurn(style), edgeTurn(plain)];
      assert.ok(sharp > 80, `the control: the field-less ${id} lid's edge turns ${sharp.toFixed(1)}°`);
      assert.ok(rolled < ROLLED_TURN_MAX, `the ${id} lid's rolled edge turns ${rolled.toFixed(1)}° at its sharpest`);
      assert.ok(cageHash(style) === cageHash(plain), "the cage builds are unchanged");
    });
  }

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
      // Without the sedan's diffuser band: its black inlay would read as throat.
      const style: BodyStyle = { ...sedan, bumpers: { ...sedan.bumpers, rear: { ...sedan.bumpers.rear, band: undefined } }, exhaust };
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
        // The face behind this tip (a wrapped corner stands forward of the rearmost point); under the bumper, the rearmost point.
        const hit = new THREE.Raycaster(new THREE.Vector3(x, centre.y, face.min.z - 1), new THREE.Vector3(0, 0, 1)).intersectObject(new THREE.Mesh(makeBumperGeometry(false, sedan), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), false)[0];
        const behind = hit ? hit.point.z : face.min.z;
        assert.ok(tip.min.z >= behind && tip.min.z < behind + TIP_FLUSH && throats > 0 && throatBack < -0.99, `the tip ends at z ${tip.min.z.toFixed(3)}, the face behind it at ${behind.toFixed(3)} (rearmost ${face.min.z.toFixed(3)}); ${throats} throat vertices, normal z up to ${throatBack.toFixed(3)}`);
        assert.ok(toneBox(fitted, null, 0).box.min.z >= face.min.z, "nothing of the fittings stands past the bumper's face");
      }
      assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
    });
  }

  it("when a rear bumper sets a band, then the fascia rows in it carry a black inlay across the face between its heights, and the cage builds are unchanged", () => {
    const { seat, band, wrap } = sedan.bumpers.rear;
    const plain: BodyStyle = { ...sedan, bumpers: { ...sedan.bumpers, rear: { ...sedan.bumpers.rear, band: undefined } } };
    const [inlay, bare] = [sedan, plain].map((style) => toneBox(withRearFittings(makeBumperGeometry(false, style), style), FITTING_ATTRIBUTE, FITTING_TONE.black));
    assert.ok(inlay!.count > bare!.count, `${inlay!.count} black vertices with the band, ${bare!.count} without`);
    const [bottom, top] = band!.map((y) => y - seat.y);
    // The fascia's top crown lifts its rows up to 2 cm at the centre line.
    assert.ok(inlay!.box.min.y >= bottom! - POSITION_TOL && inlay!.box.max.y <= top! + 0.02 + POSITION_TOL, `black y ${inlay!.box.min.y.toFixed(3)}..${inlay!.box.max.y.toFixed(3)}, the band ${bottom!.toFixed(3)}..${top!.toFixed(3)}`);
    assert.ok(inlay!.box.max.x - inlay!.box.min.x > 2 * wrap.from, `the band spans ${(inlay!.box.max.x - inlay!.box.min.x).toFixed(3)} m across`);
    assert.ok(cageHash(sedan) === cageHash(plain), "the cage builds are unchanged");
  });

  it("when the pickup's front bumper sets a band (its valance), then the fascia rows in it carry a black inlay across the face between its heights, and a front bumper without one is drawn as it was", () => {
    const pickup = CAR_STYLES.pickup;
    const { seat, band, wrap } = pickup.bumpers.front;
    const plain: BodyStyle = { ...pickup, bumpers: { ...pickup.bumpers, front: { ...pickup.bumpers.front, band: undefined } } };
    const bare = makeBumperGeometry(true, plain);
    assert.ok(withFrontBand(bare, plain) === bare, "a front bumper without a band is its plain geometry");
    const inlay = toneBox(withFrontBand(makeBumperGeometry(true, pickup), pickup), FITTING_ATTRIBUTE, FITTING_TONE.black);
    assert.ok(inlay.count > 0, "the band draws black vertices");
    const [bottom, top] = band!.map((y) => y - seat.y);
    assert.ok(inlay.box.min.y >= bottom! - 0.02 - POSITION_TOL && inlay.box.max.y <= top! + 0.02 + POSITION_TOL, `black y ${inlay.box.min.y.toFixed(3)}..${inlay.box.max.y.toFixed(3)}, the band ${bottom!.toFixed(3)}..${top!.toFixed(3)}`);
    assert.ok(inlay.box.max.x - inlay.box.min.x > 2 * wrap.from, `the band spans ${(inlay.box.max.x - inlay.box.min.x).toFixed(3)} m across`);
  });
});

type MirrorSpec = NonNullable<BodyStyle["door"]["mirror"]>;
/** A drawn mirror's foot meets the drawn skin at its seat within this (m). */
const MIRROR_SEAT_TOL = 0.005;

/** The sedan with `mirror` on its door, 4 cm short of the platform's reach: the seat's x-scale (0.81, the sim's) would squash a shared mirror. */
function mirrorStyle(mirror: MirrorSpec): BodyStyle {
  const sedan = CAR_STYLES.sedan;
  return { ...sedan, door: { ...sedan.door, mirrorReach: 0.17, mirror } };
}

/**
 * `style`'s right drawn mirror in the car frame (its seat's x-scale applied): its innermost and outermost x, the box of its painted cap,
 * and its outermost vertex's colour and roughness (`toned` stores roughness in u as (round(r * 100) + 0.5) / 101).
 */
function readMirror(style: BodyStyle): { inner: number; outer: number; cap: THREE.Box3; tip: THREE.Color; tipRoughness: number } {
  const scaleX = style.door.mirrorReach / MIRROR_REACH;
  const seat = style.door.hingeX + mirrorSeatX(style);
  const geo = drawnPart(PART_KIND.mirrorR, style).geometry;
  const [pos, painted, colour, tone] = [geo.getAttribute("position"), geo.getAttribute(PAINTED_ATTRIBUTE), geo.getAttribute("color"), geo.getAttribute("uv")];
  const cap = new THREE.Box3();
  let [inner, outer, tip] = [Infinity, -Infinity, 0];
  for (let i = 0; i < pos.count; i++) {
    const x = seat + pos.getX(i) * scaleX;
    inner = Math.min(inner, x);
    if (x > outer) [outer, tip] = [x, i];
    if (painted.getX(i) === 1) cap.expandByPoint(new THREE.Vector3(x, pos.getY(i), pos.getZ(i)));
  }
  return { inner, outer, cap, tip: new THREE.Color(colour.getX(tip), colour.getY(tip), colour.getZ(tip)), tipRoughness: (tone.getX(tip) * 101 - 0.5) / 100 };
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

  it("when a mirror's cap is a tear, then its section tapers to its rear face, its inner face held, and the seat and cage builds are unchanged", () => {
    const size = [0.12, 0.095, 0.145] as const;
    const [w, , d] = size;
    const [tear, rounded] = (["tear", "rounded"] as const).map((cap) => {
      const style = mirrorStyle({ cap, finish: "body", size });
      const { cap: box } = readMirror(style);
      const geo = drawnPart(PART_KIND.mirrorR, style).geometry;
      const [pos, painted] = [geo.getAttribute("position"), geo.getAttribute(PAINTED_ATTRIBUTE)];
      const scaleX = style.door.mirrorReach / MIRROR_REACH;
      const rear = new THREE.Box3();
      for (let i = 0; i < pos.count; i++) if (painted.getX(i) === 1 && pos.getZ(i) <= box.min.z + 0.1 * d) rear.expandByPoint(new THREE.Vector3(pos.getX(i) * scaleX, pos.getY(i), pos.getZ(i)));
      return { style, inner: box.min.x, rear: rear.max.x - rear.min.x };
    });
    assert.ok(tear!.rear < 0.65 * w && rounded!.rear > 0.8 * w, `the cap's rear tenth spans ${tear!.rear.toFixed(3)} m (tear), ${rounded!.rear.toFixed(3)} m (rounded) of its ${w}`);
    assertSameNumbers([tear!.inner], [rounded!.inner], "the cap's inner face", 1e-4);
    assert.ok(mirrorSeatX(tear!.style) === mirrorSeatX(rounded!.style) && cageHash(tear!.style) === cageHash(CAR_STYLES.sedan), "the seat and cage builds are unchanged");
  });

  it("when a mirror is lifted, then its cap rises that far over the seat while its foot still starts on the drawn skin, and the seat and cage builds are unchanged", () => {
    const spec = { cap: "rounded", finish: "body", size: [0.1, 0.07, 0.1] } as const;
    const flat = readMirror(mirrorStyle(spec));
    const lifted = mirrorStyle({ ...spec, lift: 0.05 });
    const up = readMirror(lifted);
    assertSameNumbers([up.cap.min.y - flat.cap.min.y, up.cap.max.y - flat.cap.max.y], [0.05, 0.05], "the cap's rise", POSITION_TOL);
    assert.ok(Math.abs(up.inner - bodySideAtMirror(lifted)) < MIRROR_SEAT_TOL, `the foot starts at x ${up.inner}, the drawn skin at ${bodySideAtMirror(lifted)}`);
    assert.ok(mirrorSeatX(lifted) === mirrorSeatX(mirrorStyle(spec)), "the seat is unchanged");
    assert.ok(cageHash(lifted) === cageHash(CAR_STYLES.sedan), "the cage builds are unchanged");
  });

  it("when a mirror sets a stalk, then its foot runs that far along the car under the cap instead of 0.7 of the cap's depth, and the seat and cage builds are unchanged", () => {
    const spec = { cap: "rounded", finish: "body", size: [0.1, 0.07, 0.1], lift: 0.05 } as const;
    const slim = mirrorStyle({ ...spec, stalk: 0.025 });
    /** The length along the car of the mirror's unpainted pieces under its cap: its foot. */
    const footLength = (style: BodyStyle): number => {
      const geo = drawnPart(PART_KIND.mirrorR, style).geometry;
      const [pos, painted] = [geo.getAttribute("position"), geo.getAttribute(PAINTED_ATTRIBUTE)];
      const { cap } = readMirror(style);
      let [lo, hi] = [Infinity, -Infinity];
      for (let i = 0; i < pos.count; i++) {
        if (painted.getX(i) === 1 || pos.getY(i) >= cap.min.y - POSITION_TOL) continue;
        [lo, hi] = [Math.min(lo, pos.getZ(i)), Math.max(hi, pos.getZ(i))];
      }
      return hi - lo;
    };
    assertSameNumbers([footLength(mirrorStyle(spec)), footLength(slim)], [0.07, 0.025], "the foot's length along the car", POSITION_TOL);
    assert.ok(mirrorSeatX(slim) === mirrorSeatX(mirrorStyle(spec)), "the seat is unchanged");
    assert.ok(cageHash(slim) === cageHash(CAR_STYLES.sedan), "the cage builds are unchanged");
  });

  it("when a mirror is mounted on the door glass, then its foot lies on the drawn pane up its height and nowhere sinks into it, the pane's lean followed, which the same seat on the skin does not", () => {
    /** Every drawn mirror vertex over the drawn pane, as [its gap (m) out from the pane, its height] (car frame). */
    const paneGaps = (style: BodyStyle): [number, number][] => {
      const d = style.door;
      const [seatX, scaleX] = [d.hingeX + mirrorSeatX(style), d.mirrorReach / MIRROR_REACH];
      const pos = drawnPart(PART_KIND.mirrorR, style).geometry.getAttribute("position");
      const gaps: [number, number][] = [];
      for (let i = 0; i < pos.count; i++) {
        const y = d.hingeY + d.mirrorY + pos.getY(i);
        const pane = paneXAt(style, d.hingeZ - (d.mirrorZ ?? 0) + pos.getZ(i), y);
        if (!Number.isNaN(pane)) gaps.push([seatX + pos.getX(i) * scaleX - pane, y]);
      }
      return gaps;
    };
    /** The heights (mm) at which vertices lie on the pane, and the deepest gap (m) into it. */
    const reading = (gaps: [number, number][]) => ({
      on: new Set(gaps.filter(([g]) => Math.abs(g) < MIRROR_SEAT_TOL).map(([, y]) => Math.round(y * 1000))).size,
      deepest: Math.min(...gaps.map(([g]) => g)),
    });
    // The drawn pane is a coarse chord of the glass surface the foot follows: up to 1.2 cm off it at the foot's corners by the A-post.
    const PANE_CHORD_TOL = 0.015;
    const seated = ({ on, deepest }: { on: number; deepest: number }) => on >= 3 && deepest > -PANE_CHORD_TOL;
    const words = ({ on, deepest }: { on: number; deepest: number }) => `on the pane at ${on} heights, the deepest ${deepest.toFixed(4)} m into it`;
    for (const id of ["pickup", "monster"] as const) {
      const style = CAR_STYLES[id];
      assert.ok(style.door.mirror?.mount === "glass", `${id}: its tow mirror is glass-mounted`);
      const mounted = reading(paneGaps(style));
      assert.ok(seated(mounted), `${id}: ${words(mounted)}`);
      // The foot's inner face (within 1 cm of the glass surface; its outer face stands 1.6 cm out) lies on that surface, 2 mm sunk, at every row up its height.
      const d = style.door;
      const [seatX, scaleX] = [d.hingeX + mirrorSeatX(style), d.mirrorReach / MIRROR_REACH];
      const pos = drawnPart(PART_KIND.mirrorR, style).geometry.getAttribute("position");
      const inner: number[] = [];
      for (let i = 0; i < pos.count; i++) {
        const gap = seatX + pos.getX(i) * scaleX - glassX(d.hingeZ - (d.mirrorZ ?? 0) + pos.getZ(i), d.hingeY + d.mirrorY + pos.getY(i), style);
        if (Math.abs(gap) < 0.01) inner.push(gap);
      }
      assert.ok(inner.length >= 8 && inner.every((g) => Math.abs(g + 0.002) < 0.001), `${id}: the foot's inner face stands ${[...new Set(inner.map((g) => g.toFixed(4)))].join(", ")} m off the glass surface`);
      const onSkin = reading(paneGaps({ ...style, door: { ...style.door, mirror: { ...style.door.mirror!, mount: undefined } } }));
      assert.ok(!seated(onSkin), `${id} on the skin: ${words(onSkin)}`);
    }
  });

  it("when a mirror's finish is black or chrome, then its cap wears that tone and nothing takes paint, a black one gloss as the references' are; when it is body, its cap carries the paint's tone for its door's colour", () => {
    for (const [finish, hex] of [["black", TRIM_BLACK], ["chrome", TRIM_CHROME]] as const) {
      const { cap, tip, tipRoughness } = readMirror(mirrorStyle({ cap: "box", finish }));
      assert.ok(cap.isEmpty(), `${finish}: nothing is painted`);
      assert.equal(tip.getHex(), hex, `${finish}: the cap's outer face`);
      if (finish === "black") assert.ok(tipRoughness <= TRIM_FINISH.gloss.roughness + 0.01, `black: the cap's roughness ${tipRoughness} is gloss (${TRIM_FINISH.gloss.roughness}), not satin plastic`);
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

  it("when a grille sets a bezel, then a chrome frame of that width rings it, its front over the face, and without the field the grille has no chrome", () => {
    const sedan = CAR_STYLES.sedan;
    const bezel = 0.015;
    const grille = { y: 0.48, size: [0.6, 0.12], kind: "bars", count: 3, finish: "black" } as const;
    const lamps = { ...sedan.lamps, shapes: undefined };
    const chromeBox = (g: THREE.BufferGeometry): THREE.Box3 => {
      const [pos, colour] = [g.getAttribute("position"), g.getAttribute("color")];
      const chrome = new THREE.Color(TRIM_CHROME);
      const box = new THREE.Box3();
      for (let i = 0; i < pos.count; i++) if (Math.abs(colour.getX(i) - chrome.r) < 1e-6) box.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i));
      return box;
    };
    const framed = chromeBox(drawnPart(PART_KIND.grille, { ...sedan, grille: { ...grille, bezel }, lamps }).geometry);
    const size = framed.getSize(new THREE.Vector3());
    assertSameNumbers([size.x, size.y], [grille.size[0] + 2 * bezel, grille.size[1] + 2 * bezel], "the chrome frame's w and h", POSITION_TOL);
    assert.ok(chromeBox(drawnPart(PART_KIND.grille, { ...sedan, grille, lamps }).geometry).isEmpty(), "without the field, no chrome");
    assert.ok(cageHash({ ...sedan, grille: { ...grille, bezel } }) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a rear bumper sets its plate's height, then the plate's centre stands at it (unset: where the platform puts it), and the cage builds are unchanged", () => {
    const sedan = CAR_STYLES.sedan;
    const plain: BodyStyle = { ...sedan, lamps: { ...sedan.lamps, shapes: undefined }, bumpers: { ...sedan.bumpers, rear: { ...sedan.bumpers.rear, plate: undefined, plateFace: undefined } } };
    const plate = 0.4;
    const style: BodyStyle = { ...plain, bumpers: { ...plain.bumpers, rear: { ...plain.bumpers.rear, plate } } };
    const box = partBox(drawnPart(PART_KIND.tailTrim, style).geometry);
    assertSameNumbers([box.getCenter(new THREE.Vector3()).y + sedan.bumpers.rear.seat.y], [plate], "the plate's centre height", POSITION_TOL);
    assert.ok(drawnPart(PART_KIND.tailTrim, plain).geometry === partGeometry(PART_KIND.tailTrim), "without the field, the platform plate");
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a rear bumper sets its plate's face and colour, then the plate's rear face stands that far out of the seat in that colour, and the cage builds are unchanged", () => {
    const sedan = CAR_STYLES.sedan;
    const plain: BodyStyle = { ...sedan, lamps: { ...sedan.lamps, shapes: undefined }, bumpers: { ...sedan.bumpers, rear: { ...sedan.bumpers.rear, plate: undefined, plateFace: undefined } } };
    const plateFace = { out: 0.015, color: 0x1c1e22 };
    const rear = { ...plain.bumpers.rear, plate: 0.4 };
    const style: BodyStyle = { ...plain, bumpers: { ...plain.bumpers, rear: { ...rear, plateFace } } };
    const box = partBox(drawnPart(PART_KIND.tailTrim, style).geometry);
    assertSameNumbers([box.min.z, box.max.z - box.min.z], [-plateFace.out, 0.02], "the plate's rear face (bumper space z) and depth", POSITION_TOL);
    const colour = drawnPart(PART_KIND.tailTrim, style).geometry.getAttribute("color");
    const want = new THREE.Color(plateFace.color);
    let off = 0;
    for (let i = 0; i < colour.count; i++) off = Math.max(off, Math.abs(colour.getX(i) - want.r));
    assert.ok(off < 1e-6, `every plate vertex is the dark tone (off by ${off})`);
    const bare = partBox(drawnPart(PART_KIND.tailTrim, { ...plain, bumpers: { ...plain.bumpers, rear } }).geometry);
    assertSameNumbers([bare.min.z], [-0.09], "without the field, the platform plate's face", POSITION_TOL);
    assert.ok(cageHash(style) === cageHash(sedan), "the cage builds are unchanged");
  });

  it("when a style draws its own head lamp to an outline, then its lit lens fills the outline 1-6 mm proud of the skin on each side, the left lamp mirrors the right, and the cage builds are unchanged", () => {
    const sedan = CAR_STYLES.sedan;
    const [x, y] = [0.53, 0.51];
    const loop = { points: [[x - 0.08, y - 0.03], [x + 0.08, y - 0.03], [x + 0.08, y + 0.03], [x - 0.08, y + 0.03]] } as const;
    // The neutral bulb: its lit lens is the tone (u 0.75) this row reads.
    const style: BodyStyle = { ...sedan, lamps: { ...sedan.lamps, bulb: undefined, head: [x, y], shapes: { head: { loops: [loop], lens: "lit", bezel: "chrome" } } } };
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
    assertSameNumbers([l.drawn.min.x, l.drawn.max.x], [-r.drawn.max.x, -r.drawn.min.x], "the left lamp mirrors the right", OWN_SKIN_MIRROR_TOL);
    for (const [side, s] of [["right", r], ["left", l]] as const) assert.ok(s.low > 0.001 && s.high < 0.006, `the ${side} lens stands ${(s.low * 1000).toFixed(1)}-${(s.high * 1000).toFixed(1)} mm off the skin`);
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

  it("when a grille leans, then its face's top and bottom edges stand where the lean turns them about its centre line on its face", () => {
    const sedan = CAR_STYLES.sedan;
    const seat = sedan.bumpers.front.seat;
    const grille = { y: 0.48, z: seat.z + 0.07, size: [0.6, 0.16], kind: "hex", finish: "black", lean: 0.4 } as const;
    const pos = drawnPart(PART_KIND.grille, { ...sedan, grille, lamps: { ...sedan.lamps, shapes: undefined } }).geometry.getAttribute("position");
    const [cy, face, half] = [grille.y - seat.y - GRILLE_SEAT.y, grille.z - seat.z - GRILLE_SEAT.z, grille.size[1] / 2];
    const [dy, dz] = [half * Math.cos(grille.lean), half * Math.sin(grille.lean)];
    const has = (y: number, z: number): boolean => Array.from({ length: pos.count }, (_, i) => i).some((i) => Math.abs(Math.abs(pos.getX(i)) - 0.3) < 1e-4 && Math.abs(pos.getY(i) - y) < 1e-4 && Math.abs(pos.getZ(i) - z) < 1e-4);
    assert.ok(has(cy + dy, face - dz), `the face's top corners lean back to ${(cy + dy).toFixed(4)}, ${(face - dz).toFixed(4)}`);
    assert.ok(has(cy - dy, face + dz), `the face's bottom corners stand out to ${(cy - dy).toFixed(4)}, ${(face + dz).toFixed(4)}`);
  });

  it("when a grille's surround takes its own finish, then the ring out to the grille's edge turns chrome and its mesh stays black", () => {
    const sedan = CAR_STYLES.sedan;
    const grille = { y: 0.48, z: sedan.bumpers.front.seat.z + 0.07, size: [0.6, 0.16], kind: "hex", finish: "black" } as const;
    const chrome = new THREE.Color(TRIM_CHROME);
    const black = new THREE.Color(TRIM_BLACK);
    const tones = (spec: NonNullable<BodyStyle["grille"]>) => {
      const geo = drawnPart(PART_KIND.grille, { ...sedan, grille: spec, lamps: { ...sedan.lamps, shapes: undefined } }).geometry;
      const [pos, col] = [geo.getAttribute("position"), geo.getAttribute("color")];
      const is = (i: number, c: THREE.Color) => Math.abs(col.getX(i) - c.r) < 1e-6 && Math.abs(col.getY(i) - c.g) < 1e-6 && Math.abs(col.getZ(i) - c.b) < 1e-6;
      let [chromeN, blackN, reach] = [0, 0, 0];
      for (let i = 0; i < pos.count; i++) {
        if (is(i, chrome)) [chromeN, reach] = [chromeN + 1, Math.max(reach, Math.abs(pos.getX(i)))];
        else if (is(i, black)) blackN++;
      }
      return { chromeN, blackN, reach };
    };
    const plain = tones(grille);
    const rimmed = tones({ ...grille, rim: "chrome" });
    assert.ok(plain.chromeN === 0 && rimmed.chromeN > 0, `chrome vertices: ${plain.chromeN} plain, ${rimmed.chromeN} rimmed`);
    assert.ok(Math.abs(rimmed.reach - grille.size[0] / 2) < 1e-4, `the chrome reaches ${rimmed.reach.toFixed(4)} across, the grille's edge ${grille.size[0] / 2}`);
    assert.ok(rimmed.blackN === plain.blackN - rimmed.chromeN && rimmed.blackN > 0, `only the surround turned: black ${plain.blackN} -> ${rimmed.blackN}`);
  });

  it("when a hex grille gives a count, then it draws that many lines each way, one 12-triangle bar each", () => {
    const sedan = CAR_STYLES.sedan;
    const grille = { y: 0.48, z: sedan.bumpers.front.seat.z + 0.07, size: [0.6, 0.16], kind: "hex", finish: "black" } as const;
    const tris = (count: number) => drawnPart(PART_KIND.grille, { ...sedan, grille: { ...grille, count }, lamps: { ...sedan.lamps, shapes: undefined } }).geometry.getIndex()!.count / 3;
    assert.ok(tris(16) - tris(8) === 2 * 8 * 12, `16 lines each way draw ${tris(16) - tris(8)} triangles more than 8`);
  });

  it("when a hex grille gives its bars' angle, then their front edges run at ± that angle and none at the default 60°", () => {
    const sedan = CAR_STYLES.sedan;
    const seat = sedan.bumpers.front.seat;
    const grille = { y: 0.48, z: seat.z + 0.07, size: [0.6, 0.16], kind: "hex", count: 8, angle: 0.37, finish: "black" } as const;
    const pos = drawnPart(PART_KIND.grille, { ...sedan, grille, lamps: { ...sedan.lamps, shapes: undefined } }).geometry.getAttribute("position");
    const front = grille.z - seat.z - GRILLE_SEAT.z - 0.004;
    const ends = Array.from({ length: pos.count }, (_, i) => i).filter((i) => Math.abs(pos.getZ(i) - front) < 1e-5).map((i) => new THREE.Vector2(pos.getX(i), pos.getY(i)));
    const edgesAt = (angle: number): number => {
      let n = 0;
      for (const a of ends) for (const b of ends) if (b.x - a.x > 0.03 && Math.abs(Math.abs(Math.atan2(b.y - a.y, b.x - a.x)) - angle) < 1e-3) n++;
      return n;
    };
    assert.ok(edgesAt(grille.angle) > 0 && edgesAt(Math.PI / 3) === 0, `bar edges at ±${grille.angle}: ${edgesAt(grille.angle)}, at ±60°: ${edgesAt(Math.PI / 3)}`);
  });

  it("when a rear glass has a frame, then its clear pane is drawn that far inside the outline, the band out to the outline is its black frit, and the car's pane carries its per-vertex glass tone", () => {
    const hatch = CAR_STYLES.hatchback;
    const q = hatch.rearGlass;
    const [side, bottom] = q.frame!;
    const geo = makeRearGlass(hatch);
    const [pos, tone] = [geo.getAttribute("position"), geo.getAttribute(GLASS_ATTRIBUTE)];
    const ids = Array.from({ length: pos.count }, (_, i) => i);
    const [clear, frit] = [ids.filter((i) => tone.getX(i) === 0), ids.filter((i) => tone.getX(i) === 1)];
    const reach = (of: number[]): number[] => [Math.max(...of.map((i) => Math.abs(pos.getX(i)))), Math.min(...of.map((i) => pos.getY(i)))];
    const t0 = bottom / Math.hypot(q.top[0] - q.base[0], q.top[1] - q.base[1]);
    const half = lerp(q.wBase, q.wTop, t0) / 2 - side;
    // The pane falls with the roof's dome toward its top (`domeFall`), its foot's corners a little.
    const paneFoot = [half, q.base[0] + t0 * (q.top[0] - q.base[0]) - domeFall(hatch, q.top[1])(half, t0)];
    assertSameNumbers([...reach(clear), ...reach(frit)], [...paneFoot, q.wBase / 2, q.base[0]], "the clear pane's and the frit's half-width and foot", 1e-5);
    const pane = cars.hatchback["glassPanes"].find((p) => p.name === "rear")!;
    assert.ok(pane.mesh.geometry.hasAttribute(GLASS_ATTRIBUTE), "the car's rear pane carries its frit");
    assert.ok(!makeRearGlass({ ...hatch, rearGlass: { ...q, frame: undefined } }).hasAttribute(GLASS_ATTRIBUTE), "no frit without a frame");
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

  it("when a bumper lamp is met on the body too, then its lens stands proud of the body skin where the fascia's wrapped corner is held inside it", () => {
    // The row's fascia wraps plainly: its corner held inside the body, which a lofted end (`wrap.end`) stands off.
    const stock = CAR_STYLES.sedan;
    const sedan: BodyStyle = { ...stock, bumpers: { ...stock.bumpers, front: { ...stock.bumpers.front, wrap: { ...stock.bumpers.front.wrap!, end: undefined } } } };
    const { seat } = sedan.bumpers.front;
    const shapes = sedan.lamps.shapes!;
    const off: BodyStyle = { ...sedan, lamps: { ...sedan.lamps, shapes: { ...shapes, front: { ...shapes.front!, onBody: undefined } } } };
    const meetZ = (geo: THREE.BufferGeometry): number =>
      new THREE.Raycaster(new THREE.Vector3(0.62, 0.3, 5), new THREE.Vector3(0, 0, -1)).intersectObject(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), false)[0]?.point.z ?? -Infinity;
    const skin = meetZ(makeChassisGeometry(sedan));
    const [lens, buried] = [sedan, off].map((style) => meetZ(drawnPart(PART_KIND.grille, style).geometry.clone().translate(0, seat.y + GRILLE_SEAT.y, seat.z + GRILLE_SEAT.z)));
    assert.ok(lens! > skin + 0.001 && buried! < skin, `the fog pod's lens at z ${lens!.toFixed(4)} (without the field ${buried!.toFixed(4)}), the body skin at ${skin.toFixed(4)}`);
  });

  it("when the hatchback's and the SUV's bumper lamps are met from outside, then each lens, cell and strip is drawn in front of the body and the fascia, where the nose or tail corner stands proud of the bumper too", () => {
    const mid = (pts: readonly (readonly number[])[]): [number, number] => [pts.reduce((s, p) => s + p[0]!, 0) / pts.length, pts.reduce((s, p) => s + p[1]!, 0) / pts.length];
    const ray = new THREE.Raycaster();
    const hidden: string[] = [];
    let proud = 0;
    for (const id of ["hatchback", "wagon"] as const) {
      const style = CAR_STYLES[id];
      for (const front of [true, false]) {
        const shape = style.lamps.shapes?.[front ? "front" : "rear"];
        if (!shape) continue;
        const { seat } = style.bumpers[front ? "front" : "rear"];
        const z = front ? seat.z : -seat.z;
        const fitting = new THREE.Mesh(drawnPart(front ? PART_KIND.grille : PART_KIND.tailTrim, style).geometry);
        fitting.position.set(0, seat.y + (front ? GRILLE_SEAT.y : 0), z + (front ? GRILLE_SEAT.z : 0));
        const fascia = new THREE.Mesh(makeBumperGeometry(front, style));
        fascia.position.set(0, seat.y, z);
        const body = new THREE.Mesh(makeChassisGeometry(style));
        for (const m of [fitting, fascia, body]) m.updateMatrixWorld(true);
        const at = [
          ...shape.loops.filter((l) => !l.side).map((l) => mid(l.points)),
          ...(shape.cells ?? []).map((c) => mid(c.loop.points)),
          ...(shape.strips ?? []).flatMap((s) => s.line.points.slice(1).map((p, i) => mid([s.line.points[i]!, p]))),
        ];
        for (const [x, y] of at) {
          ray.set(new THREE.Vector3(x, y, front ? 5 : -5), new THREE.Vector3(0, 0, front ? -1 : 1));
          if (ray.intersectObjects([fitting, fascia, body], false)[0]?.object !== fitting) hidden.push(`${id} ${front ? "front" : "rear"} ${x.toFixed(3)},${y.toFixed(3)}`);
          if (ray.intersectObjects([fascia, body], false)[0]?.object === body) proud++;
        }
      }
    }
    assert.equal(hidden.join(" "), "", "bumper lamp points the body or the fascia hides");
    assert.ok(proud >= 3, `the control: the body stands proud of the fascia at ${proud} of them`);
  });

  it("when a rear bumper is plateless, then its tail trim is its bumper lamps alone, with no platform plate in it", () => {
    const plate = partGeometry(PART_KIND.tailTrim).getAttribute("color");
    const cream = [plate.getX(0), plate.getY(0), plate.getZ(0)].join();
    const creams = (id: CarStyleId): number => {
      const c = drawnPart(PART_KIND.tailTrim, CAR_STYLES[id]).geometry.getAttribute("color");
      return Array.from({ length: c.count }, (_, i) => [c.getX(i), c.getY(i), c.getZ(i)].join()).filter((k) => k === cream).length;
    };
    for (const id of ["hatchback", "wagon"] as const) {
      assert.equal(creams(id), 0, `plate vertices in the ${id}'s tail trim`);
      assert.ok(CAR_STYLES[id].bumpers.rear.plateless, `the ${id}'s reference shows no plate on its bumper`);
    }
    assert.ok(creams("sedan") > 0, "the control: the sedan's trim carries the plate");
  });

  it("when a bumper lamp's lens is black, then the hatchback's and the SUV's diffuser bands are the trim's matte black plastic, not a glossy dark lens", () => {
    const plastic = toned(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3)), TRIM_BLACK, TRIM_FINISH.plastic.roughness, TRIM_FINISH.plastic.metalness);
    const [black, texel] = [Array.from(plastic.getAttribute("color").array).join(), plastic.getAttribute("uv").getX(0)];
    for (const id of ["hatchback", "wagon"] as const) {
      const trim = drawnPart(PART_KIND.tailTrim, CAR_STYLES[id]).geometry;
      const [c, uv] = [trim.getAttribute("color"), trim.getAttribute("uv")];
      const band = Array.from({ length: c.count }, (_, i) => i).filter((i) => [c.getX(i), c.getY(i), c.getZ(i)].join() === black);
      assert.ok(band.length > 0, `${id}: no black plastic in the tail trim`);
      assert.equal(band.filter((i) => uv.getX(i) !== texel).length, 0, `${id}: black vertices off the plastic finish's texel`);
    }
  });

  it("when a tail lamp's outline runs onto the boot lid, then the lid carries that share and opens with it, and the body keeps the rest", () => {
    const car = new DeformableCar(PAINT, new THREE.Scene(), null, "hatchback");
    const lid = car.lampFittings.find((f) => f.kind === "boot");
    assert.ok(lid, "the hatch carries a share of the tails");
    const trunk = lid.seat.parent as THREE.Mesh;
    assert.ok(trunk.parent && trunk.position.z === bootPivot(car.style.boot)[1], "riding the lid itself");
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
    // Every lid-share triangle, either side's, has a corner on the lid (lens and bezel stand at most 1.6 cm off it); the body's share is probed in lamps.test.
    for (const side of [-1, 1]) {
      const lidShare = drawnLamp(car.style, "boot", side).geometry;
      const [pos, index] = [lidShare.getAttribute("position"), lidShare.getIndex()!];
      const off = Array.from({ length: pos.count }, (_, i) => gap(trunk, new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(trunk.matrixWorld)));
      let loose = 0;
      for (let t = 0; t < index.count; t += 3) if (Math.min(off[index.getX(t)]!, off[index.getX(t + 1)]!, off[index.getX(t + 2)]!) > 0.016) loose++;
      assert.ok(index.count > 0, `the lid carries side ${side}'s share`);
      assert.equal(loose, 0, `side ${side}: lid-share triangles off the lid`);
    }
    assert.ok(drawnLamp(car.style, "tail", 1).geometry.getIndex()!.count > 0, "the body keeps a share");
    trunk.rotation.x = 0.6;
    car.group.updateMatrixWorld(true);
    const batch = new LampBatch(2);
    batch.sync([car]);
    // Rows pack the lamps, then the fittings in order (all shown here): the lid's row follows the lamps and the fittings before it.
    const row = car.lamps.length + car.lampFittings.indexOf(lid);
    const got = batch.draw.matrixAt(row, new THREE.Matrix4());
    for (let k = 0; k < 16; k++) assert.ok(Math.abs(got.elements[k]! - trunk.matrixWorld.elements[k]!) < 1e-6, `the opened lid's pose, element ${k}`);
    const drawnShare = batch.draw.variants[batch.draw.variantAt(row)]!.getIndex()!.count;
    assert.equal(drawnShare, drawnLamp(car.style, "boot", lid.share!.lamp.side).geometry.getIndex()!.count, "the lid's row draws its own share");
  });

  it("when a bumper carries its seam, then it is the skin up to the seam on the end face and round the corner on both sides (rays from outside meet it 2 cm under the seam and the body 2 cm over), and a bumper without one draws as before", () => {
    const style = CAR_STYLES.sedan;
    const { seat, top, edge } = style.bumpers.rear;
    assert.ok(top && edge, "the control: the sedan's rear bumper carries its seam");
    const fascia = withRearFittings(makeBumperGeometry(false, style), style);
    const drawn = withSeamCover(fascia, style, false);
    assert.ok(drawn !== fascia, "the control: the seam cover is merged in");
    const cover = (drawn.index!.count - fascia.index!.count) / 3;
    assert.ok(cover <= SEAM_COVER_TRIANGLES, `the cover bills ${cover} triangles, over ${SEAM_COVER_TRIANGLES}: a band down to the fascia, not the skin it hides`);
    const both = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const bumper = new THREE.Mesh(drawn, both);
    bumper.position.set(0, seat.y, -seat.z);
    bumper.updateMatrixWorld();
    const body = new THREE.Mesh(makeChassisGeometry(style), both);
    const ray = new THREE.Raycaster();
    const meets = (from: THREE.Vector3, dir: THREE.Vector3): string => {
      ray.set(from, dir);
      const hit = ray.intersectObjects([body, bumper], false)[0];
      return hit ? (hit.object === bumper ? "bumper" : "body") : "nothing";
    };
    const tail = style.profile[0]!.z;
    for (const side of [1, -1]) {
      for (const [x, y] of top.slice(1)) {
        for (const [dy, want] of [[-0.02, "bumper"], [0.02, "body"]] as const) {
          assert.equal(meets(new THREE.Vector3(side * x, y + dy, tail - 5), new THREE.Vector3(0, 0, 1)), want, `end face [${side * x}, ${y + dy}]`);
        }
      }
      // The seam's run back along the quarter, before it turns down the arch's lip.
      for (const [z, y] of edge.slice(0, 5)) {
        for (const [dy, want] of [[-0.02, "bumper"], [0.02, "body"]] as const) {
          assert.equal(meets(new THREE.Vector3(side * 5, y + dy, z), new THREE.Vector3(-side, 0, 0)), want, `side [${z}, ${y + dy}] (${side < 0 ? "left" : "right"})`);
        }
      }
    }
    const plain = makeBumperGeometry(true, CAR_STYLES.coupe);
    assert.ok(withSeamCover(plain, CAR_STYLES.coupe, true) === plain, "a bumper with no seam is drawn as it was");
  });

  it("when a style's bumpers carry their seams, then every seam cover vertex lies on the body skin (no fold of the band stands off an edge)", () => {
    const both = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const ray = new THREE.Raycaster();
    const [p, n] = [new THREE.Vector3(), new THREE.Vector3()];
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const body = new THREE.Mesh(makeChassisGeometry(style), both);
      for (const front of [true, false]) {
        const { seat } = style.bumpers[front ? "front" : "rear"];
        const fascia = front ? makeBumperGeometry(true, style) : withRearFittings(makeBumperGeometry(false, style), style);
        const drawn = withSeamCover(fascia, style, front);
        if (drawn === fascia) continue;
        const [pos, nrm] = [drawn.getAttribute("position"), drawn.getAttribute("normal")];
        let off = 0;
        for (let i = fascia.getAttribute("position").count; i < pos.count; i++) {
          p.fromBufferAttribute(pos, i).add(new THREE.Vector3(0, seat.y, front ? seat.z : -seat.z));
          n.fromBufferAttribute(nrm, i).normalize();
          ray.set(p.clone().addScaledVector(n, 0.05), n.clone().negate());
          const hit = ray.intersectObject(body, false)[0];
          off = Math.max(off, hit ? Math.abs(hit.distance - 0.05) : Infinity);
        }
        assert.ok(off < SEAM_COVER_OFF, `${id} ${front ? "front" : "rear"}: a cover vertex ${(off * 100).toFixed(1)} cm off the skin`);
      }
    }
  });

  it("when a bumper carrying its seam is torn off, then its loose box (its flying shape and mass) holds every vertex it draws, the seam cover's too", () => {
    const car = new DeformableCar(PAINT, scene, null, "sedan");
    for (const name of ["bumperF", "bumperR"]) {
      const part = car["parts"].find((p) => p.name === name)!;
      car["detachPart"](part, 0, new THREE.Vector3());
      boxShape(part.shape, part.object);
      const half = new THREE.Vector3().fromArray(part.shape.points, BOX_HALVES).addScalar(1e-6);
      const box = new THREE.Box3(part.shape.centre.clone().sub(half), part.shape.centre.clone().add(half));
      let outside = 0;
      let worst = 0;
      const v = new THREE.Vector3();
      part.object.updateMatrixWorld(true);
      const toPart = part.object.matrixWorld.clone().invert();
      part.object.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        const pos = o.geometry.getAttribute("position");
        const m = toPart.clone().multiply(o.matrixWorld);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          if (box.containsPoint(v)) continue;
          outside++;
          worst = Math.max(worst, box.distanceToPoint(v));
        }
      });
      assert.ok(outside === 0, `${name}: ${outside} drawn vertices outside its loose box, the farthest ${(worst * 100).toFixed(1)} cm`);
    }
  });

  // ponytail: one box per torn part; an L/U bumper rests on the box's empty corner. Fix: two boxes from SHAPE_POINTS (2 x 8 corners).
  it.todo("when a torn sedan bumper settles on flat ground or against a wall, then its drawn shell lies within 3 cm of every surface its loose box rests on (today the front bumper rolled 90° wedges its box's empty corner into the wall's foot: the shell hovers 13.4 cm off the ground and 16.2 cm off the wall; on the ground the centre of mass falls up to 20 cm (front) / 72 cm (rear) outside the shell's footprint)", () => {
    const H = 1 / QUIET_HZ;
    const WALL_Z = 3;
    const HOVER = 0.03;
    const RESTS_ON = 0.01;
    const cases = [
      { name: "bumperF", euler: [0, 0, Math.PI / 2], wall: true },
      ...["bumperF", "bumperR"].flatMap((name) => [[0, 0, 0], [Math.PI, 0, 0], [Math.PI / 2, 0, 0], [0.4, 0.7, 0.3]].map((euler) => ({ name, euler, wall: false }))),
    ] as const;
    const fails: string[] = [];
    for (const c of cases) {
      const walls = new Surface();
      walls.addPrism({ x: 0, z: WALL_Z + 0.15, yaw: 0, hx: 6, hz: 0.15, base: 0, top: 2, id: 0 });
      armSolids(c.wall ? walls : null);
      try {
        const car = new DeformableCar(PAINT, new THREE.Scene(), null, "sedan");
        const part = car["parts"].find((p) => p.name === c.name)!;
        car["detachPart"](part, 0, new THREE.Vector3());
        part.object.position.set(0, c.wall ? 0.6 : 0.9, c.wall ? WALL_Z - 1.2 : 0);
        part.object.quaternion.setFromEuler(new THREE.Euler(...c.euler));
        part.velocity.set(0, 0, c.wall ? 4 : 0);
        part.angular.set(c.wall ? 0 : 0.3, c.wall ? 0 : 0.2, c.wall ? 0 : -0.25);
        for (let t = 0; t < 5 && !part.shape.asleep; t += H) stepLoose(part, H, -1, undefined, undefined, partMass(part));
        part.object.updateMatrixWorld(true);
        const s = part.shape;
        const corners = Array.from({ length: s.count }, (_, k) => new THREE.Vector3().fromArray(s.points, 3 * k).add(s.centre).applyQuaternion(part.object.quaternion).add(part.object.position));
        const faces = [{ surface: "ground", gap: (p: THREE.Vector3) => p.y }, ...(c.wall ? [{ surface: "wall", gap: (p: THREE.Vector3) => WALL_Z - p.z }] : [])];
        for (const f of faces) {
          if (corners.filter((p) => f.gap(p) < RESTS_ON).length < 3) continue;
          let shell = Infinity;
          const v = new THREE.Vector3();
          part.object.traverse((o) => {
            if (!(o instanceof THREE.Mesh)) return;
            const pos = o.geometry.getAttribute("position");
            for (let i = 0; i < pos.count; i++) shell = Math.min(shell, f.gap(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld)));
          });
          if (shell > HOVER) fails.push(`${c.name} ${c.euler.map((e) => e.toFixed(2))}${c.wall ? " into the wall" : ""}: rests on the ${f.surface}, its shell ${(shell * 100).toFixed(1)} cm off it`);
        }
      } finally {
        armSolids(null);
      }
    }
    assert.ok(fails.length === 0, fails.join("; "));
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
/** Up from the hub, the first face over the well this far (m) in past the body side is dark: the arch's edge reads over a gap, not a painted sliver. */
const WELL_GAP = [0.01, 0.02, 0.03] as const;
/** Primer past which the paint has turned to the inner panel's dark (`bare-metal.ts` darkens bare steel from 1.2 to 1.8). */
const WELL_DARK = 1.5;
/** Looking into an arch from the side, its rim (the lip and its return) is left out this far (m): the lip's own row covers it. */
const WELL_RIM = 0.05;
const SIDED = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
/** The paint's sidedness: a ray skips back faces, as the paint culls them. */
const FRONT = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });

/** The point where a ray from `from` heading `dir` first meets `body` within `far` (m), or null. */
function bodyHit(body: THREE.Mesh, from: THREE.Vector3Tuple, dir: THREE.Vector3Tuple, far: number): THREE.Vector3 | null {
  return new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir), 0, far).intersectObject(body, false)[0]?.point ?? null;
}

/** The first face a ray from `from` heading `dir` meets on `body` within `far` (m): its index offset and the primer the paint blends where it struck. */
function toneHit(body: THREE.Mesh, from: THREE.Vector3Tuple, dir: THREE.Vector3Tuple, far: number): { at: number; tone: number } | null {
  const hit = new THREE.Raycaster(new THREE.Vector3(...from), new THREE.Vector3(...dir), 0, far).intersectObject(body, false)[0];
  if (!hit?.face || hit.faceIndex == null) return null;
  const pos = body.geometry.getAttribute("position");
  const primer = body.geometry.getAttribute(PRIMER_ATTRIBUTE);
  const ids = [hit.face.a, hit.face.b, hit.face.c];
  const [a, b, c] = ids.map((v) => new THREE.Vector3().fromBufferAttribute(pos, v));
  const w = THREE.Triangle.getBarycoord(hit.point, a!, b!, c!, new THREE.Vector3())!;
  return { at: hit.faceIndex * 3, tone: w.x * primer.getX(ids[0]!) + w.y * primer.getX(ids[1]!) + w.z * primer.getX(ids[2]!) };
}

/** The rear face's opening of a tailgate, or of a lid wrapping the tail: its half-width at a height, its sill and its top (m). */
function faceOpening(style: BodyStyle): { half: (y: number) => number; sill: number; top: number } | null {
  const b = style.boot;
  const tail = style.profile[0]!.z;
  if (b.kind === "lid") return b.drop ? { half: () => b.drop!.w, sill: b.drop.y, top: sampleSlice(tail, style.profile).yBelt } : null;
  const bed = style.tubs.find(([z0]) => z0 < tail + 0.1);
  return { half: (y) => tailgateHalf(style, y), sill: Math.max(b.y0, bed?.[2] ?? 0), top: b.origin[0] };
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
      for (let x = -half; x <= half; x += OPEN_GRID) at(bodyHit(body, [x, deckTopY(x, z, style, false) + 0.05, z], [0, -1, 0], OPEN_DEPTH));
    }
  }
  const face = faceOpening(style);
  if (!face) return hits;
  for (let y = face.sill + OPEN_EDGE; y <= face.top - OPEN_EDGE; y += OPEN_GRID) {
    for (let x = -face.half(y) + OPEN_EDGE; x <= face.half(y) - OPEN_EDGE; x += OPEN_GRID) at(bodyHit(body, [x, y, tail - 0.05], [0, 0, 1], OPEN_DEPTH));
  }
  return hits;
}

/** The liner's inner edge across the car (m) over wheel [wx, , wz]: the liner stands over the tyre, or inside the side of a body it stands outboard of. */
function linerInnerEdge(style: BodyStyle, wx: number, wz: number): number {
  const hw = sampleSlice(wz, style.profile).hw;
  return (Math.abs(wx) > hw ? hw - 0.12 : Math.abs(wx)) - 0.12;
}

/** A style without its arch lip. */
const lipless = (style: BodyStyle): BodyStyle => ({ ...style, arch: { radius: style.arch.radius, rise: style.arch.rise } });

/** A bed's side wall stands this far (m) in from the body side at its foot (`halfRing`'s floor edge); its top edge at the style's `tubWall`. */
const BED_WALL_INSET = 0.06;

/** The wheels of `style` whose liner stands up through one of its tubs' floors, each with that floor's height. */
function wheelsInFloors(style: BodyStyle): [number, number, number, number][] {
  const r = style.arch.radius;
  return carFrame(style).wheels.flatMap(([wx, wy, wz]): [number, number, number, number][] => {
    const tub = style.tubs.find(([z0, z1, f]) => wy + r > Math.max(f, floorY(wz, style)) && wz > z0 && wz < z1);
    return tub ? [[wx, wy, wz, Math.max(tub[2], floorY(wz, style))]] : [];
  });
}

describe("given a body style's boot opening, its open floors and its arch lips (drawn only)", () => {
  const cases: readonly [string, BodyStyle][] = [...CAR_STYLE_IDS.map((id): [string, BodyStyle] => [id, CAR_STYLES[id]]), ...WRAPPED.map(([id, s]): [string, BodyStyle] => [`${id} (wrapped lid)`, s])];
  for (const [id, style] of cases) {
    it(`when a ${id}'s drawn body is built, then nothing of it stands in its boot's opening: under its lid between the lid's edges, in its face's cut`, () => {
      const hits = openingCrossings(style);
      assert.ok(hits.length === 0, `${id}: ${hits.length} rays meet body in the opening, first ${hits.slice(0, 4).join(" ")}`);
    });
  }

  it("when the hatch's tailgate is built on its seam's outline, then its edge stands on the outline at each of the outline's corners, in the drawn and the cage build", () => {
    const b = CAR_STYLES.hatchback.boot;
    assert.ok(b.kind === "tailgate" && b.outline, "the hatch's gate carries an outline");
    const [py] = bootPivot(b);
    const off: string[] = [];
    for (const source of ["drawn", "cage"] as const) {
      const pos = makeTrunkGeometry(CAR_STYLES.hatchback, source).getAttribute("position");
      for (const [ox, oy] of b.outline) {
        if (oy <= b.y0 || oy >= b.origin[0]) continue;
        let edge = 0;
        for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getY(i) + py - oy) < 1e-4) edge = Math.max(edge, pos.getX(i));
        if (Math.abs(edge - ox) > 1e-3) off.push(`${source} at y ${oy}: ${edge.toFixed(3)} (${ox})`);
      }
    }
    assert.ok(off.length === 0, `the gate's edge: ${off.join("; ")}`);
  });

  it("when the hatch's tailgate steps in between its tail lamps, then the body's tail beside the step is shut flush with the gate's face", () => {
    const style = CAR_STYLES.hatchback;
    const b = style.boot;
    assert.ok(b.kind === "tailgate" && b.z0 !== undefined, "the hatch's gate leans");
    const [y1, oz] = b.origin;
    const lean = (b.z0 - oz) / (b.y0 - y1);
    const body = new THREE.Mesh(makeChassisGeometry(style), SIDED);
    const off: string[] = [];
    for (let y = b.y0 + 0.05; y <= 0.78; y += OPEN_GRID) {
      for (const x of [0.46, 0.52, 0.58]) {
        const gate = oz + (y - y1) * lean;
        const z = bodyHit(body, [x, y, gate - 0.1], [0, 0, 1], 0.2)?.z ?? NaN;
        if (!(Math.abs(z - gate) < 0.005)) off.push(`(${x}, ${y.toFixed(2)}): ${z.toFixed(3)} vs ${gate.toFixed(3)}`);
      }
    }
    assert.ok(off.length === 0, `the tail beside the step: ${off.join("; ")}`);
  });

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
    const raised = wheelsInFloors(style);
    if (raised.length === 0) continue;
    it(`when a ${id}'s open floor is looked down onto over its wheels, then a hump closes each liner there: its top over the liner's inner edge stands at the liner's top or above`, () => {
      const body = new THREE.Mesh(makeChassisGeometry(style), SIDED);
      for (const [wx, wy, wz] of raised) {
        const x = Math.sign(wx) * (linerInnerEdge(style, wx, wz) - 0.01);
        const from = wy + r + 0.1 + (style.wheelTub?.rise ?? 0);
        const top = bodyHit(body, [x, from, wz], [0, -1, 0], from - wy)?.y ?? -Infinity;
        assert.ok(top >= wy + r, `${id} wheel at x ${wx.toFixed(2)} z ${wz.toFixed(2)}: the top over the liner's edge at ${top.toFixed(3)} m, the liner's top at ${(wy + r).toFixed(3)} m`);
      }
    });
  }

  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];
    const tub = style.wheelTub;
    if (!tub) continue;
    it(`when a ${id}'s bed is looked down onto over its wheels, then a tub stands at each side, ${tub.rise} m over the floor, ${tub.length} m long and ${tub.width} m in from the wall, in the drawn and the cage build`, () => {
      const off: string[] = [];
      for (const source of ["drawn", "cage"] as const) {
        const body = new THREE.Mesh(makeChassisGeometry(style, source), SIDED);
        const down = (x: number, z: number): number => bodyHit(body, [x, 3, z], [0, -1, 0], 3)?.y ?? -Infinity;
        for (const [wx, , wz, floor] of wheelsInFloors(style)) {
          const s = Math.sign(wx);
          const mid = s * (sampleSlice(wz, style.profile).hw - BED_WALL_INSET - tub.width / 2);
          const end = tub.length / 2 + 0.02;
          const readings: [string, number, number][] = [
            ["top", down(mid, wz), floor + tub.rise],
            ["inboard", down(mid - s * (tub.width / 2 + 0.02), wz), floor],
            ["ahead", down(mid, wz + end), floor],
            ["behind", down(mid, wz - end), floor],
          ];
          for (const [what, y, want] of readings) if (Math.abs(y - want) > 0.005) off.push(`${source} x ${wx.toFixed(2)} ${what} ${y.toFixed(3)} (${want.toFixed(3)})`);
        }
      }
      assert.ok(off.length === 0, `${id}: ${off.join("; ")}`);
    });

    it(`when a ${id}'s tyres are risen to their spring's stop, then none stands through the bed floor between the bed's walls`, () => {
      const body = new THREE.Mesh(makeChassisGeometry(style), SIDED);
      const cls = STYLE_CLASS[id];
      const { lift, wheelScale } = CLASSES[cls];
      const radius = style.dims.wheel.radius * wheelScale;
      const halfWidth = (style.dims.wheel.width * wheelScale) / 2;
      const bump = SPRINGS[cls].travel / 2;
      let worst = Infinity;
      let at = "none under the bed";
      for (const [wx, wy, wz] of wheelsInFloors(style)) {
        const hubY = wy + style.dims.wheel.radius * (wheelScale - 1) - lift + bump;
        const wall = sampleSlice(wz, style.profile).hw - BED_WALL_INSET;
        for (let x = Math.abs(wx) - halfWidth; x <= Math.min(Math.abs(wx) + halfWidth, wall); x += 0.02) {
          for (let dz = -radius; dz <= radius; dz += 0.02) {
            const skin = bodyHit(body, [Math.sign(wx) * x, 3, wz + dz], [0, -1, 0], 3)?.y;
            if (skin === undefined) continue;
            const gap = skin - (hubY + Math.sqrt(radius * radius - dz * dz));
            if (gap < worst) [worst, at] = [gap, `x ${x.toFixed(2)} z ${(wz + dz).toFixed(2)}`];
          }
        }
      }
      assert.ok(worst >= 0, `${id}: a tyre stands ${(-worst).toFixed(3)} m through the bed at ${at}`);
    });

    it(`when a ${id}'s bed is looked down onto just outside and inside its wall's top edge, then the rim is ${tubWall(style)} m wide and the wall's face drops away inside it, in the drawn and the cage build`, () => {
      const off: string[] = [];
      const [, front, floor] = style.tubs.at(-1)!;
      const z = front - 0.1;
      const edge = sampleSlice(z, style.profile).hw - tubWall(style);
      for (const source of ["drawn", "cage"] as const) {
        const body = new THREE.Mesh(makeChassisGeometry(style, source), SIDED);
        const down = (x: number): number => bodyHit(body, [x, 3, z], [0, -1, 0], 3)?.y ?? -Infinity;
        const rim = down(edge + 0.006);
        const inside = down(edge - 0.006);
        if (rim < floor + 0.1) off.push(`${source} rim ${rim.toFixed(3)} (over ${(floor + 0.1).toFixed(3)})`);
        if (rim - inside < 0.05) off.push(`${source} inside ${inside.toFixed(3)} (under ${(rim - 0.05).toFixed(3)})`);
      }
      assert.ok(off.length === 0, `${id} at z ${z.toFixed(2)}: ${off.join("; ")}`);
    });
  }

  for (const id of ["pickup", "monster"] as const) {
    it(`when a ${id}'s cage is built, then its hull is its body's hull without the wheel tubs, vertex for vertex, and the tubs' vertices follow it`, () => {
      const car = cars[id];
      const bare: DeformableCar = Object.assign(Object.create(car) as DeformableCar, { style: { ...car.style, wheelTub: undefined } });
      const [tubbed, plain] = [car, bare].map((c) => CarCage.shared({}, () => cageSourceOf(c)).style);
      const n = plain!.vertexCount;
      const hull = (pos: Float64Array): string => Array.from(pos.subarray(0, n * 3), (v) => v.toFixed(6)).join(",");
      assert.ok(tubbed!.vertexCount > n, `${id}: ${tubbed!.vertexCount} hull vertices, ${n} without its tubs`);
      assert.ok(hull(tubbed!.pristine.pos) === hull(plain!.pristine.pos), `${id}: the hull's first ${n} vertices are not the tub-less hull's`);
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
        const top = wy + style.arch.radius * (style.arch.rise ?? 1);
        let proud = 0;
        // From a tenth of its width over the opening's edge: on the edge itself the lip-less body's side turns in under it.
        for (let k = 1; k <= 10; k++) {
          // An inset lip (`lip.inset`) stands over the opening's top: it is read from there, against the skin at the top it seats on.
          const y = top - (lip.inset ?? 0) + (k / 10) * lip.width;
          const at = (mesh: THREE.Mesh, h: number) => Math.abs(bodyHit(mesh, [s * 3, h, wz], [-s, 0, 0], 3)?.x ?? 0);
          const out = (mesh: THREE.Mesh) => at(mesh, mesh === plain ? Math.max(y, top) : y);
          proud = Math.max(proud, out(drawn) - out(plain));
        }
        assert.ok(Math.abs(proud - lip.flare) < LIP_TOL, `${id} arch at x ${wx.toFixed(2)} z ${wz.toFixed(2)}: the lip stands ${proud.toFixed(4)} m proud`);
      }
      assert.ok(cageHash(style) === cageHash(lipless(style)), "the cage build is unchanged");
    });
    it(`when a ${id}'s arch tops are looked at from outside and from under, then the lip's crown is painted and, up to ${WELL_GAP.at(-1)} m in past the body side, the well over the tyre is unpainted (a lit edge over a dark gap)`, () => {
      const body = makeChassisGeometry(style);
      const drawn = new THREE.Mesh(body, FRONT);
      const plain = new THREE.Mesh(makeChassisGeometry(lipless(style)), SIDED);
      const lips = body.userData.archLips as { from: number; perWheel: readonly number[] };
      const lipEnd = lips.from + lips.perWheel.reduce((n, c) => n + c, 0);
      for (const [wx, wy, wz] of carFrame(style).wheels) {
        const s = Math.sign(wx);
        const top = wy + style.arch.radius * (style.arch.rise ?? 1);
        const skin = Math.abs(bodyHit(plain, [s * 3, top, wz], [-s, 0, 0], 3)!.x);
        const at = `${id} arch at x ${wx.toFixed(2)} z ${wz.toFixed(2)}`;
        const crown = toneHit(drawn, [s * 3, top - (lip.inset ?? 0) + 0.3 * lip.width, wz], [-s, 0, 0], 3);
        const onLip = crown !== null && crown.at >= lips.from && crown.at < lipEnd;
        assert.ok(onLip && crown.tone === 0, `${at}: from outside, ${onLip ? `the lip's crown is toned ${crown.tone}` : "the lip is not met"}`);
        const seen = WELL_GAP.map((d) => toneHit(drawn, [s * (skin - d), wy, wz], [0, 1, 0], style.arch.radius)?.tone ?? NaN);
        assert.ok(seen.every((t) => t >= WELL_DARK), `${at}: ${WELL_GAP.join(", ")} m in past the skin, up from the hub, the well is toned ${seen.map((t) => t.toFixed(2)).join(", ")}`);
      }
    });
  }

  for (const id of CAR_STYLE_IDS) {
    const style = CAR_STYLES[id];
    const outboard = carFrame(style).wheels.filter(([wx, , wz]) => Math.abs(wx) > sampleSlice(wz, style.profile).hw);
    if (outboard.length === 0) continue;
    it(`when a ${id}'s arches over tyres standing outboard of its body are looked into from the side, then every sight line through the opening meets the dark well, none the far side`, () => {
      const drawn = new THREE.Mesh(makeChassisGeometry(style), FRONT);
      const [r, rise] = [style.arch.radius, style.arch.rise ?? 1];
      for (const [wx, wy, wz] of outboard) {
        const s = Math.sign(wx);
        const off: string[] = [];
        let looked = 0;
        for (let y = wy; y < wy + r * rise; y += 0.05) {
          for (let z = wz - r; z <= wz + r; z += 0.05) {
            if (Math.hypot(z - wz, (y - wy) / rise) > r - WELL_RIM || y < rockerAt(z, style) + WELL_RIM) continue;
            looked++;
            const hit = toneHit(drawn, [s * 3, y, z], [-s, 0, 0], 6);
            if (!hit || hit.tone < WELL_DARK) off.push(`(y ${y.toFixed(2)}, z ${z.toFixed(2)}) ${hit ? `toned ${hit.tone.toFixed(2)}` : "through"}`);
          }
        }
        assert.ok(looked > 20 && off.length === 0, `${id} arch at z ${wz.toFixed(2)}: ${off.length} of ${looked} sight lines meet paint or nothing: ${off.slice(0, 6).join(", ")}`);
      }
    });
  }

  for (const id of CAR_STYLE_IDS) {
    const rise = CAR_STYLES[id].arch.rise;
    if (rise === undefined) continue;
    it(`when a ${id}'s lip-less arches are looked at from outside, then each opening crowns ${rise} of its radius over the hub: paint 1 cm over that, the dark well 2 cm under it`, () => {
      const style = lipless(CAR_STYLES[id]);
      const drawn = new THREE.Mesh(makeChassisGeometry(style), FRONT);
      for (const [wx, wy, wz] of carFrame(style).wheels) {
        const s = Math.sign(wx);
        const top = wy + style.arch.radius * rise;
        const [over, under] = [top + 0.01, top - 0.02].map((y) => toneHit(drawn, [s * 3, y, wz], [-s, 0, 0], 6)?.tone ?? NaN);
        assert.ok(over === 0 && under! >= WELL_DARK, `${id} arch at x ${wx.toFixed(2)} z ${wz.toFixed(2)}: toned ${over} 1 cm over its crown, ${under} 2 cm under`);
      }
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

  /** The door skin's outer-face vertices [x, y] (car frame) on its column at door-space `z`, top down: the slab's inner vertices share the face's y 5 cm inboard. */
  const faceColumn = (pos: THREE.BufferAttribute, style: BodyStyle, z: number): { x: number; y: number }[] => {
    const d = style.door;
    const outerAt = new Map<number, number>();
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getZ(i) - z) > 1e-6) continue;
      const y = d.hingeY + pos.getY(i);
      outerAt.set(y, Math.max(outerAt.get(y) ?? -Infinity, d.hingeX + pos.getX(i)));
    }
    return [...outerAt].map(([y, x]) => ({ x, y })).sort((a, b) => b.y - a.y);
  };

  it("when a door skin is built, then its face meets the drawn body side (its ring's chords over the ring rows it carries, the side's curve past them) at both cut ends (hinge and latch slices: a shut line, not a step) and stands 3 mm proud 2 cm inside them", () => {
    /** The face's stand-off (m) over the body side at a cut end, and 2 cm inside it. */
    const WANT = [[0, 0], [0.02, 0.003]] as const;
    /** Rows this near (m) the skin's top or bottom roll over its edge: left out. */
    const ROW_EDGE = 0.05;
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const d = style.door;
      const pos = makeDoorGeometry(1, style).getAttribute("position") as THREE.BufferAttribute;
      const half = (d.aperture[1] - d.aperture[0]) / 2;
      for (const end of [-1, 1]) {
        // The face's rows the body ring carries at the cut: the same rows, by index, span the ring's chords along the door.
        const ringYs = sectionPoints(sampleSlice(d.aperture[end > 0 ? 1 : 0], style.profile), style, "drawn").map((p) => p.y);
        const carried = faceColumn(pos, style, end * half).flatMap((p, row) => (ringYs.some((y) => Math.abs(y - p.y) < 1e-6) ? [row] : []));
        for (const [inside, want] of WANT) {
          const z = end * (half - inside);
          const zCar = d.hingeZ + doorSkinZ(style) + z;
          const sl = sampleSlice(zCar, style.profile);
          const face = faceColumn(pos, style, z);
          const [top, bottom] = [face[carried[0]!]!.y, face[carried[carried.length - 1]!]!.y];
          let proud = -Infinity;
          for (const p of face) {
            if (Math.abs(p.y - d.hingeY) > d.halfHeight - ROW_EDGE) continue;
            const held = THREE.MathUtils.clamp(p.y, bottom, top);
            const body = sideX(p.y, sl.hw, sl.yBelt, rockerAt(zCar, style)) + drawnSideX(zCar, held, style) - sideX(held, sl.hw, sl.yBelt, rockerAt(zCar, style));
            proud = Math.max(proud, p.x - body);
          }
          assert.ok(Math.abs(proud - want) < 1e-5, `${id}: ${inside * 100} cm inside the ${end > 0 ? "hinge" : "latch"} end the skin stands ${proud * 1000} mm proud, want ${want * 1000}`);
        }
      }
    }
  });

  it("when a door skin is built, then at each cut its face over the span of the body ring's rows it carries runs on the ring's facets: no ripple of door and fender standing proud of each other in turn along the shut line", () => {
    /** How far (m) the face's facets may stand off the body ring's at a cut. */
    const RIPPLE = 0.0005;
    const xAt = (points: readonly { x: number; y: number }[], y: number): number => {
      for (let i = 1; i < points.length; i++) {
        const [a, b] = [points[i - 1]!, points[i]!];
        if (y <= a.y && y >= b.y) return a.y === b.y ? a.x : a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
      }
      return NaN;
    };
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const d = style.door;
      const pos = makeDoorGeometry(1, style).getAttribute("position") as THREE.BufferAttribute;
      const half = (d.aperture[1] - d.aperture[0]) / 2;
      for (const end of [-1, 1]) {
        const face = faceColumn(pos, style, end * half);
        const ring = sectionPoints(sampleSlice(d.aperture[end > 0 ? 1 : 0], style.profile), style, "drawn");
        const body = ring.slice(1, ROCKER + 1).map((p) => ({ x: -p.x, y: p.y }));
        const shared = face.filter((f) => body.some((b) => Math.abs(b.y - f.y) < 1e-6)).map((f) => f.y);
        assert.ok(shared.length >= 2, `${id}: the ${end > 0 ? "hinge" : "latch"} cut's face carries only ${shared.length} of the body ring's rows`);
        let worst = 0;
        let at = 0;
        for (const y of [...face, ...body].map((p) => p.y)) {
          if (y > Math.max(...shared) || y < Math.min(...shared)) continue;
          const off = xAt(face, y) - xAt(body, y);
          if (Math.abs(off) > Math.abs(worst)) [worst, at] = [off, y];
        }
        assert.ok(Math.abs(worst) < RIPPLE, `${id}: at the ${end > 0 ? "hinge" : "latch"} cut the door's face stands ${worst * 1000} mm off the body's at y ${at}`);
      }
    }
  });

  it("when a door skin's top stands free at its hinge cut (the door glass stops ahead of it), then the top meets the fender's deck edge there: a shut line, not a fin over the fender", () => {
    /** How far (m) the skin's top at the cut may stand over the fender's deck edge. */
    const OVER = 0.002;
    /** The glass stopping this far (m) ahead of the cut leaves the skin's top standing free (the skin's edge roll). */
    const FREE = 0.02;
    let checked = 0;
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const d = style.door;
      if (d.aperture[1] - style.aPillarFoot < FREE) continue;
      checked++;
      const pos = makeDoorGeometry(1, style).getAttribute("position") as THREE.BufferAttribute;
      const z = (d.aperture[1] - d.aperture[0]) / 2;
      let top = -Infinity;
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - z) < 1e-6) top = Math.max(top, d.hingeY + pos.getY(i));
      const deckEdge = sectionPoints(sampleSlice(d.aperture[1], style.profile), style, "drawn")[1]!.y;
      assert.ok(top - deckEdge < OVER, `${id}: at the hinge cut the skin's top stands at y ${top}, ${(top - deckEdge) * 1000} mm over the fender's deck edge ${deckEdge}`);
    }
    assert.ok(checked >= 3, `only ${checked} styles' skin tops stand free at the hinge cut`);
  });
});

describe("given a style with privacy glass", () => {
  it("when its car is built, and again after a player recolours its glass, then its rear and quarter panes are marked privacy on every vertex, its windshield and door panes are not, and every pane wears the one colour", () => {
    const hatch = CAR_STYLES.hatchback;
    const was = hatch.privacyGlass;
    hatch.privacyGlass = { rear: true, quarter: true };
    try {
      const car = new DeformableCar(PAINT, new THREE.Scene(), null, "hatchback");
      const pane = (name: string) => car["glassPanes"].find((g) => g.name === name)!;
      const colour = (name: string) => (pane(name).mesh.material as THREE.MeshStandardMaterial).color;
      const privacy = (name: string): number[] => {
        const geo = pane(name).mesh.geometry;
        if (!geo.hasAttribute(GLASS_ATTRIBUTE)) return [0];
        const tone = geo.getAttribute(GLASS_ATTRIBUTE);
        return Array.from({ length: tone.count }, (_, i) => tone.getY(i));
      };
      for (const pass of ["built", "recoloured"]) {
        if (pass === "recoloured") car.setGlassTint(0x6688aa);
        for (const dark of ["rear", "quarterL", "quarterR"]) assert.ok(privacy(dark).every((y) => y === 1), `${pass}: ${dark} is marked privacy on every vertex`);
        for (const clear of ["windshield", "doorL", "doorR"]) assert.ok(privacy(clear).every((y) => y === 0), `${pass}: ${clear} is not marked privacy`);
        for (const g of car["glassPanes"]) assert.ok(colour(g.name).equals(colour("windshield")), `${pass}: ${g.name} wears the windshield's colour`);
      }
    } finally {
      hatch.privacyGlass = was;
    }
  });

  it("when the SUV's quarter glass is matte, then its quarter panes carry the matte privacy tone on every vertex and its rear glass plain privacy", () => {
    const car = new DeformableCar(PAINT, new THREE.Scene(), null, "wagon");
    const tones = (name: string): string => {
      const tone = car["glassPanes"].find((g) => g.name === name)!.mesh.geometry.getAttribute(GLASS_ATTRIBUTE);
      return [...new Set(Array.from({ length: tone.count }, (_, i) => tone.getY(i)))].join();
    };
    const read = ["rear", "quarterL", "quarterR"].map(tones).join(" ");
    assert.ok(read === `1 ${MATTE_PRIVACY} ${MATTE_PRIVACY}`, `privacy tones rear, quarterL, quarterR: ${read}`);
  });
});

describe("given a pull handle for a style's side details", () => {
  it("when it is drawn from z 0.04 to -0.15 at y 0.76, 5 cm tall, then its pocket is a recessed pill (rounded ends, no corner sharper than 35°) filling that span, with a raised rounded bar along its middle", () => {
    const [z0, z1, y, h] = [0.04, -0.15, 0.76, 0.05];
    const { patches, lines } = pullHandle(z0, z1, y, h);
    const [pocket] = patches;
    const [bar] = lines;
    assert.ok(pocket !== undefined && pocket.view === "side" && pocket.depth < 0 && pocket.cavity > 0, "one recessed, darkened side pocket");
    const pts = pocket.points;
    const zs = pts.map(([z]) => z);
    const ys = pts.map(([, py]) => py);
    assertSameNumbers([Math.min(...zs), Math.max(...zs), Math.min(...ys), Math.max(...ys)], [z1, z0, y - h / 2, y + h / 2], "the pocket fills the span", 1e-6);
    for (let i = 0; i < pts.length; i++) {
      const [a, b, c] = [pts[(i + pts.length - 1) % pts.length]!, pts[i]!, pts[(i + 1) % pts.length]!];
      const turn = (new THREE.Vector2(b[0] - a[0], b[1] - a[1]).angleTo(new THREE.Vector2(c[0] - b[0], c[1] - b[1])) * 180) / Math.PI;
      assert.ok(turn <= 35, `the outline turns ${turn.toFixed(1)}° at point ${i}: a corner, not a rounded end`);
    }
    assert.ok(bar !== undefined && bar.profile === "u" && bar.depth > 0 && bar.points.every(([z, py]) => py === y && z >= z1 && z <= z0), "a raised rounded bar inside the pocket, along its middle");
  });
});

describe("given a style with chrome window trim", () => {
  it("when its car is built, then a chrome bead rides each door at its glass's seat and one more the body, standing proud of the door glass, and a style without trim draws none", () => {
    const chrome = trimMaterial(TRIM_CHROME, "chrome");
    const trims = (car: DeformableCar) => {
      const found: THREE.Mesh[] = [];
      car.group.traverse((o) => void (o instanceof THREE.Mesh && o.name === "windowTrim" && found.push(o)));
      return found;
    };
    assert.ok(trims(cars.coupe).every((m) => m.material === chrome), "every trim mesh wears the shared chrome");
    const coupe = cars.coupe;
    const parents = trims(coupe).map((m) => m.parent);
    assert.equal(parents.length, 3, "three trim meshes: two doors and the body");
    assert.ok(parents.includes(coupe["doorL"]) && parents.includes(coupe["doorR"]) && parents.includes(coupe.group), "one on each door, one on the body");
    for (const door of [coupe["doorL"], coupe["doorR"]]) {
      const trim = trims(coupe).find((m) => m.parent === door)!;
      const pane = coupe["glassPanes"].find((g) => g.mesh.parent === door)!.mesh;
      assert.ok(trim.position.equals(pane.position), "the door's trim sits at its glass's seat");
      trim.geometry.computeBoundingBox();
      pane.geometry.computeBoundingBox();
      const out = (b: THREE.Box3) => Math.max(Math.abs(b.min.x), Math.abs(b.max.x));
      assert.ok(out(trim.geometry.boundingBox!) > out(pane.geometry.boundingBox!), "the trim stands proud of the glass");
    }
    assert.equal(trims(cars.sedan).length, 0, "the control: a style without trim draws none");
  });
});
