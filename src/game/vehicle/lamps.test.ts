import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { beltY } from "./car-lines.ts";
import { roofAt } from "./car-mesh.ts";
import { FULL_POOL, LampBatch, LampLights, type LampPool, lampPoolFor, PHONE_POOL } from "./lamp-lights.ts";
import { drawnLamp } from "./part-variants.ts";
import { PartBatch } from "./part-batch.ts";
import { type BodyStyle, CAR_STYLE_IDS, CAR_STYLES, type CarStyleId } from "./car-variants.ts";
import { lampEmissiveMap } from "./car-materials.ts";
import { assignClass, STYLE_CLASS, type VehicleClassId } from "./vehicle-classes.ts";
import { CLASS_LIFT, INTERIOR_MESH, LID } from "./constants.ts";
import { PartSeat } from "./part-geometry.ts";
import { DT, forModes, paint } from "./test-support.ts";

/** A seat has no `raycast`; a mesh of what it draws (`drawn`: a style's own grille or mirror) at its world pose stands in for it. */
function seatProbe(seat: PartSeat): THREE.Mesh {
  const probe = new THREE.Mesh(seat.drawn);
  probe.matrixWorld.copy(seat.matrixWorld);
  return probe;
}

/** Triangles `g` draws. */
const trianglesOf = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

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
    assert.equal(Array.from({ length: 13 }, (_, b) => batch.drawn(b)).join(), [1, 1, 2, 0, 0, 0, ...shares, 0, 0, 0, 0, 0].join(), "drawn as head lit / head broken / tail running / tail broken, no brake lamp or marker, the lid shares as the style has them, none broken, none braking");
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
        l.seat.updateWorldMatrix(true, false, true);
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

describe("given the hatchback's tail lamps, whose outer lens wraps the tail corner's roll", () => {
  it("when every lens triangle over the corner is probed along its normal, then the body skin never stands more than 2 mm in front of it (under the bezel's crest)", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "hatchback");
    assignClass(car, STYLE_CLASS.hatchback);
    car.group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const tri = new THREE.Triangle();
    const [a, b, c, n, p] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    // Barycentric samples: the centroid, the edge midpoints and three points near the corners.
    const samples = [[1 / 3, 1 / 3], [0.5, 0.5], [0, 0.5], [0.5, 0], [0.7, 0.15], [0.15, 0.7], [0.15, 0.15]];
    let probed = 0;
    for (const l of car.lamps.filter((x) => x.kind === "tail")) {
      l.seat.updateWorldMatrix(true, false);
      const g = drawnLamp(car.style, l.kind, l.side).geometry;
      const [pos, ix] = [g.getAttribute("position"), g.getIndex()!];
      let worst = 0;
      let where = "";
      for (let t = 0; t < ix.count / 3; t++) {
        a.fromBufferAttribute(pos, ix.getX(3 * t)).applyMatrix4(l.seat.matrixWorld);
        b.fromBufferAttribute(pos, ix.getX(3 * t + 1)).applyMatrix4(l.seat.matrixWorld);
        c.fromBufferAttribute(pos, ix.getX(3 * t + 2)).applyMatrix4(l.seat.matrixWorld);
        tri.set(a, b, c).getNormal(n);
        for (const [u, v] of samples) {
          p.set(0, 0, 0).addScaledVector(a, 1 - u! - v!).addScaledVector(b, u!).addScaledVector(c, v!);
          if (Math.abs(p.x) < 0.6) continue;
          ray.set(p.clone().addScaledVector(n, 0.3), n.clone().negate());
          ray.far = 0.35;
          const hit = ray.intersectObject(car.body, false)[0];
          // Only the skin under the lens (facing its way, within 15 mm): a bezel's wall or a far face across the corner is not a poke.
          if (!hit || hit.face!.normal.dot(n) < 0.5 || 0.3 - hit.distance > 0.015) continue;
          probed++;
          if (0.3 - hit.distance > worst) [worst, where] = [0.3 - hit.distance, p.toArray().map((e) => e.toFixed(3)).join(",")];
        }
      }
      assert.ok(worst <= 0.002, `tail ${l.side < 0 ? "L" : "R"}: the skin stands ${(worst * 1000).toFixed(1)} mm in front of the lens at ${where}`);
    }
    assert.ok(probed > 200, `the control: ${probed} samples met the skin over the corner`);
  });

  it("when its outer lens is followed round the corner onto the quarter, then it drops to the reference's side-view lamp height (y .63 or lower) with its front edge at z -1.60", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "hatchback");
    assignClass(car, STYLE_CLASS.hatchback);
    car.group.updateMatrixWorld(true);
    const tail = car.lamps.find((l) => l.kind === "tail" && l.side > 0)!;
    tail.seat.updateWorldMatrix(true, false);
    const g = drawnLamp(car.style, "tail", 1).geometry.clone().applyMatrix4(tail.seat.matrixWorld);
    const [pos, uv] = [g.getAttribute("position"), g.getAttribute("uv")];
    let [minY, maxZ, count] = [Infinity, -Infinity, 0];
    for (let i = 0; i < pos.count; i++) {
      // The lit lens only (u .75 on the emissive mask), out past the corner's start.
      if (uv.getX(i) !== 0.75 || Math.abs(pos.getX(i)) <= 0.66) continue;
      minY = Math.min(minY, pos.getY(i));
      maxZ = Math.max(maxZ, pos.getZ(i));
      count++;
    }
    assert.ok(count > 0, "no lit lens vertices out on the quarter");
    assert.ok(minY <= 0.63, `outer lens bottom on the quarter at y ${minY.toFixed(3)}`);
    assert.ok(maxZ >= -1.6, `outer lens front edge at z ${maxZ.toFixed(3)}`);
  });
});

describe("given each style with a high-mount brake lamp", () => {
  const styles = CAR_STYLE_IDS.filter((s) => CAR_STYLES[s].lamps.brake);
  it("the control: some style has one", () => assert.ok(styles.length > 0));
  for (const style of styles) {
    it(`when a ${style} is built, then its brake lamp sits on the first surface met from behind, the body or the rear glass, not inside the cabin`, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, style);
      const brake = car.lampFittings.find((f) => f.kind === "brake")!;
      car.group.updateMatrixWorld(true);
      const glass = car.glassPanes.find((p) => p.name === "rear")!.mesh;
      const seat = brake.seat.position;
      const hit = new THREE.Raycaster(new THREE.Vector3(seat.x, seat.y, -5), new THREE.Vector3(0, 0, 1)).intersectObjects([car.body, glass], false)[0];
      assert.ok(hit, `${style}: nothing behind its brake lamp`);
      const name = hit.object === glass ? "the rear glass" : "the body";
      assert.ok(Math.abs(hit.point.z - seat.z) < 0.01, `${style}: brake lamp at z ${seat.z.toFixed(3)}, ${name} met from behind at z ${hit.point.z.toFixed(3)}`);
    });
  }
});

describe("given the monster's side markers with and without a `tint`", () => {
  it("when the lamp batch packs them, then a tinted marker's colour is its look times the tint and an untinted one keeps the look", () => {
    const plain = CAR_STYLES.monster;
    const tint = 0x806040;
    const markers = plain.lamps.sideMarkers ?? [];
    assert.ok(markers.length > 0, "the control: the monster carries side markers");
    const colours = (style: BodyStyle): string => {
      const styles: Record<CarStyleId, BodyStyle> = CAR_STYLES;
      styles.monster = style;
      try {
        const car = new DeformableCar(paint(), new THREE.Scene(), null, "monster");
        car.group.updateMatrixWorld(true);
        const batch = new LampBatch(2);
        batch.sync([car]);
        const rows = car.lampFittings.flatMap((f, i) => (f.kind === "marker" ? [car.lamps.length + i] : []));
        const out = rows.map((row) => batch.draw.colorAt(row, new THREE.Color()).toArray().map((c) => c.toFixed(4)).join(" ")).join(", ");
        batch.dispose();
        return out;
      } finally {
        styles.monster = plain;
      }
    };
    const want = new THREE.Color(tint).toArray().map((c) => c.toFixed(4)).join(" ");
    const untinted: BodyStyle = { ...plain, lamps: { ...plain.lamps, sideMarkers: markers.map((m) => ({ at: m.at, size: m.size })) } };
    assert.equal(colours(untinted), Array.from({ length: markers.length * 2 }, () => "1.0000 1.0000 1.0000").join(", "), "untinted markers keep the head look's white");
    const tinted: BodyStyle = { ...plain, lamps: { ...plain.lamps, sideMarkers: markers.map((m) => ({ ...m, tint })) } };
    assert.equal(colours(tinted), Array.from({ length: markers.length * 2 }, () => want).join(", "), "tinted markers take the tint");
  });
});

describe("given the hatchback's lit head lamp under each `lamps.bulb` (none, halogen, LED), and under a dark lens", () => {
  const BULBS = [undefined, "halogen", "led"] as const;
  const styled = (bulb: (typeof BULBS)[number]): BodyStyle => ({ ...CAR_STYLES.hatchback, lamps: { ...CAR_STYLES.hatchback.lamps, bulb } });
  /** Bluest blue/red of the first `n` `rgb` triples. */
  const bluest = (rgb: ArrayLike<number>, n: number): number => {
    let best = 0;
    for (let i = 0; i < n; i++) best = Math.max(best, rgb[i * 3 + 2]! / Math.max(rgb[i * 3]!, 1e-6));
    return best;
  };
  /** The glow colours a lone car in `style` gets from the pool, head L and head R first, seen from ahead (a glow shows its lens's side only). */
  const glowOf = (style: BodyStyle): { rgb: ArrayLike<number>; n: number } => {
    const scene = new THREE.Scene();

    const car = new DeformableCar(paint(), scene, null, "hatchback");
    const restyled: { style: BodyStyle } = car; // `style` is readonly only to game code; the glow reads it per update
    restyled.style = style;
    car.spawnFacing(0, 10, 0, 0);
    car.group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
    camera.position.copy(car.group.position).addScaledVector(car.forward, 8).setY(1.5);
    camera.lookAt(car.group.position);
    const lights = new LampLights(scene, 12, FULL_POOL);
    lights.update([car], camera, car);
    return { rgb: lights.glow.geometry.getAttribute("color").array, n: lights.glow.geometry.drawRange.count };
  };

  /** Each bulb's lit lens texels as `[r, g, b]` triples read off the emissive map where its drawn head lens samples it. */
  const litTexels = (bulb: (typeof BULBS)[number]): number[] => {
    const map = lampEmissiveMap().image.data as Float32Array;
    const uv = drawnLamp(styled(bulb), "head", 1).geometry.getAttribute("uv");
    const texels: number[] = [];
    for (let i = 0; i < uv.count; i++) {
      const at = (Math.floor(uv.getY(i) * 2) * 2 + Math.floor(uv.getX(i) * 2)) * 4;
      if (map[at]! + map[at + 1]! + map[at + 2]! > 0) texels.push(map[at]!, map[at + 1]!, map[at + 2]!);
    }
    return texels;
  };

  it("when its lens is drawn, then the lit lens samples an emissive texel bluer from halogen to the neutral white to LED", () => {
    const ratios = BULBS.map((bulb) => {
      const texels = litTexels(bulb);
      return bluest(texels, texels.length / 3);
    });
    assert.ok(ratios[1]! < ratios[0]! && ratios[0]! < ratios[2]!, `lit texel blue/red, none/halogen/led: ${ratios.map((r) => r.toFixed(3)).join("/")}`);
  });

  it("when a halogen lens is drawn, then its texel's red, under the head lens's emissive (0.905 linear x 1.15), clears the post's bloom threshold, so it glows with a halo; the neutral lens stays under 1", () => {
    /** The post's bloom threshold (engine-post GRADE) over the head lens's emissive red (0xf4 linear 0.905 x emissiveIntensity 1.15). */
    const BLOOM_RED_TEXEL = 1.6 / (0.905 * 1.15);
    const [halogen, neutral] = [Math.max(...litTexels("halogen")), Math.max(...litTexels(undefined))];
    assert.ok(halogen > BLOOM_RED_TEXEL && neutral <= 1, `lit texel peak: halogen ${halogen.toFixed(3)} (bloom at ${BLOOM_RED_TEXEL.toFixed(3)}), neutral ${neutral.toFixed(3)}`);
  });

  it("when the pool lights it, then its head glow is bluer from halogen to the neutral white to LED", () => {
    const ratios = BULBS.map((bulb) => {
      const { rgb, n } = glowOf(styled(bulb));
      return bluest(rgb, n);
    });
    assert.ok(ratios[1]! < ratios[0]! && ratios[0]! < ratios[2]!, `head glow blue/red, none/halogen/led: ${ratios.map((r) => r.toFixed(3)).join("/")}`);
  });

  it("when its lens is dark (a lit DRL over it), then its head glow is under half the lit lens's, so the sprite never washes the lens white", () => {
    const lit = CAR_STYLES.hatchback;
    const head = lit.lamps.shapes!.head!;
    const dark: BodyStyle = { ...lit, lamps: { ...lit.lamps, shapes: { ...lit.lamps.shapes, head: { ...head, lens: "dark" } } } };
    const [a, b] = [glowOf(lit).rgb, glowOf(dark).rgb];
    assert.ok(b[0]! < 0.5 * a[0]!, `head L glow red channel: lit lens ${a[0]!.toFixed(3)}, dark lens ${b[0]!.toFixed(3)}`);
  });
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
    for (const [row, l] of car.lamps.entries()) {
      seatInLift.compose(l.seat.position, l.seat.quaternion, l.seat.scale);
      expected.multiplyMatrices(lift.matrixWorld, seatInLift);
      batch.draw.matrixAt(row, got);
      for (let k = 0; k < 16; k++) assert.ok(Math.abs(got.elements[k]! - expected.elements[k]!) < 1e-5, `${l.kind} ${l.side} element ${k}`);
      const unit = batch.draw.variants[batch.draw.variantAt(row)]!;
      assert.equal(trianglesOf(unit), trianglesOf(drawnLamp(car.style, l.kind, l.side).geometry), `${l.kind} ${l.side} draws its own unit`);
    }
  });

  it("when the car moves and its lamps are read and packed again, then no lamp seat composes its matrix, and each still follows the lift", () => {
    const car = dressed();
    const batch = new LampBatch(8);
    const pos = new THREE.Vector3();
    const dir = new THREE.Vector3();
    for (let i = 0; i < car.lamps.length; i++) car.lampWorld(i, pos, dir);
    batch.sync([car]);
    let composed = 0;
    for (const seat of [...car.lamps.map((l) => l.seat), ...car.lampFittings.map((f) => f.seat)]) {
      const own = seat.updateMatrix.bind(seat);
      seat.updateMatrix = () => {
        composed++;
        own();
      };
    }
    const lift = car.group.getObjectByName(CLASS_LIFT)!;
    const seatInLift = new THREE.Matrix4();
    const expected = new THREE.Vector3();
    const inLift = (l: (typeof car.lamps)[number]) => expected.setFromMatrixPosition(seatInLift.compose(l.seat.position, l.seat.quaternion, l.seat.scale).premultiply(lift.matrixWorld));
    // Read alone, then packed alone after a second move: each must bring the seat's world matrix current itself.
    car.group.position.x += 3;
    car.group.updateMatrixWorld(true);
    for (const [i, l] of car.lamps.entries()) {
      car.lampWorld(i, pos, dir);
      assert.ok(pos.distanceTo(inLift(l)) < 1e-6, `${l.kind} ${l.side} lights from ${pos.distanceTo(expected).toFixed(3)} m off its seat in the moved lift`);
    }
    car.group.position.z += 2;
    car.group.updateMatrixWorld(true);
    batch.sync([car]);
    const packed = new THREE.Matrix4();
    for (const [i, l] of car.lamps.entries()) {
      const drawnAt = pos.setFromMatrixPosition(batch.draw.matrixAt(i, packed));
      assert.ok(drawnAt.distanceTo(inLift(l)) < 1e-5, `${l.kind} ${l.side} drawn ${drawnAt.distanceTo(expected).toFixed(3)} m off its seat in the moved lift`);
    }
    assert.equal(composed, 0, "lamp seat matrices composed on a frame the skin did not move");
  });
});

describe("given the lamp batch and one car of each style", () => {
  /** Triangles of the variant geometries that rows `from` up to `to` of the lamp draw show. */
  const rowsTris = (batch: LampBatch, from: number, to: number): number => {
    let sum = 0;
    for (let r = from; r < to; r++) sum += trianglesOf(batch.draw.variants[batch.draw.variantAt(r)]!);
    return sum;
  };

  it("when one car of each style is packed, then its head and tail draws bill only its own lamp units' triangles, not the fleet's", () => {
    for (const id of CAR_STYLE_IDS) {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      assignClass(car, STYLE_CLASS[id]);
      car.group.updateMatrixWorld(true);
      const batch = new LampBatch(8);
      batch.sync([car]);
      const expected = car.lamps.reduce((sum, l) => sum + trianglesOf(drawnLamp(car.style, l.kind, l.side).geometry), 0);
      const heads = [0, 1, 2, 3].reduce((n, b) => n + batch.drawn(b), 0);
      assert.equal(heads, car.lamps.length, `${id}: every lamp is packed as a head or tail seat`);
      const drawnTris = rowsTris(batch, 0, car.lamps.length);
      assert.equal(drawnTris, expected, `${id}: the lamp batch bills ${drawnTris} triangles for lamps of ${expected}`);
      const packed = rowsTris(batch, 0, batch.draw.count);
      assert.equal(batch.draw.triangles, packed, `${id}: the one lamp draw bills ${batch.draw.triangles} triangles for seats of ${packed}`);
      batch.dispose();
    }
  });

  it("when one hatchback is packed, then every lamp and part draw left empty is hidden (no scene walk, upload or program switch) and every filled one shows", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "hatchback");
    car.group.updateMatrixWorld(true);
    const [lamps, parts] = [new LampBatch(8), new PartBatch(8)];
    lamps.sync([car]);
    parts.sync([car]);
    const instanced = (m: THREE.Mesh): m is THREE.InstancedMesh => (m as THREE.InstancedMesh).isInstancedMesh === true;
    const instancedDraws = [...parts.meshes, ...parts.casters].filter(instanced);
    const wrong = instancedDraws.filter((m) => m.visible !== m.count > 0);
    assert.equal(wrong.length, 0, `draws shown while empty or hidden while filled: ${wrong.map((m) => `${m.name || m.geometry.name || "?"} (${m.count})`).join(", ")}`);
    assert.ok(lamps.draw.mesh.visible === (lamps.draw.triangles > 0), "the lamp draw is shown only while it bills triangles");
    assert.ok(parts.styled.mesh.visible === (parts.styled.triangles > 0), "the styled part draw is shown only while it bills triangles");
    assert.ok(lamps.draw.triangles > 0 && parts.styled.triangles > 0 && instancedDraws.some((m) => m.count > 0), "nothing was packed");
    lamps.dispose();
    parts.dispose();
  });
  it("when a car is on its brakes, then its tail lamps and their lid shares draw bright and its high brake lamp lights; off the brakes the tails are dim running lights and the high brake lamp is dark; the tail glows brighten with them", () => {
    let highs = 0;
    for (const id of CAR_STYLE_IDS) {
      const scene = new THREE.Scene();
      const car = new DeformableCar(paint(), scene, null, id);
      car.spawnFacing(0, 0, 0, 0);
      car.group.updateMatrixWorld(true);
      const batch = new LampBatch(2);
      const lights = new LampLights(scene, car.lampCount);
      const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
      camera.position.copy(car.group.position).addScaledVector(car.forward, -8).setY(1.5);
      camera.lookAt(car.group.position);
      /** [running, braking] tail draws, [running, braking] boot-lid share draws, [lit, dark] high brake lamp draws, and the tail glows summed. */
      const read = () => {
        batch.sync([car]);
        lights.update([car], camera, null);
        const c = lights.glow.geometry.getAttribute("color");
        const glow = car.lamps.reduce((g, l, i) => (l.kind === "tail" ? g + c.getX(i) : g), 0);
        return { tails: [batch.drawn(2), batch.drawn(10)], shares: [batch.drawn(7), batch.drawn(11)], high: [batch.drawn(4), batch.drawn(12)], glow };
      };
      const shares = car.lampFittings.filter((f) => f.kind === "boot").length;
      const high = car.style.lamps.brake ? 1 : 0;
      highs += high;
      const off = read();
      car.drive.brake = 1;
      const on = read();
      assert.equal([off.tails, off.shares, off.high].join(" "), `2,0 ${shares},0 0,${high}`, `${id} off the brakes`);
      assert.equal([on.tails, on.shares, on.high].join(" "), `0,2 0,${shares} ${high},0`, `${id} on the brakes`);
      assert.ok(off.glow > 0 && on.glow > 2 * off.glow, `${id}: tail glows ${off.glow.toFixed(3)} off the brakes, ${on.glow.toFixed(3)} on them`);
      batch.dispose();
    }
    assert.ok(highs >= 2, `${highs} styles carry a high brake lamp`);
  });

  it("when a car taps its brakes, then the lamp draw re-colours its tails without rebuilding its geometry", () => {
    for (const id of CAR_STYLE_IDS) {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      car.spawnFacing(0, 0, 0, 0);
      car.group.updateMatrixWorld(true);
      const batch = new LampBatch(2);
      batch.sync([car]);
      const tail = car.lamps.findIndex((l) => l.kind === "tail");
      assert.ok(tail >= 0, `${id}: the control: the car carries a tail lamp`);
      const geo = batch.draw.mesh.geometry;
      const [position, index] = [(geo.getAttribute("position") as THREE.BufferAttribute).version, geo.index!.version];
      const glow = (): number => batch.draw.glowAt(tail, new THREE.Color()).r;
      const off = glow();
      car.drive.brake = 1;
      batch.sync([car]);
      assert.ok(batch.draw.mesh.geometry === geo, `${id}: braking swapped the draw's geometry`);
      assert.equal((geo.getAttribute("position") as THREE.BufferAttribute).version, position, `${id}: braking re-uploaded the vertices`);
      assert.equal(geo.index!.version, index, `${id}: braking re-uploaded the indices`);
      assert.ok(batch.drawn(10) > 0, `${id}: no tail drawn braking`);
      assert.ok(glow() > off, `${id}: tail glow red ${off.toFixed(3)} off the brakes, ${glow().toFixed(3)} on them`);
      batch.dispose();
    }
  });

  it("when a lamp breaks, then its share on the hood or boot lid goes dark with it and the other side's stays lit; when that lid tears off, both its shares go dark; a reset relights them", () => {
    let lids = 0;
    for (const id of CAR_STYLE_IDS) {
      for (const [kind, lid, slot] of [["head", LID.hood, 6], ["tail", LID.trunk, 7]] as const) {
        const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
        car.spawn(0, 0, 0);
        const shares = car.lampFittings.filter((f) => f.kind === (kind === "head" ? "hood" : "boot"));
        if (shares.length === 0) continue;
        lids++;
        const batch = new LampBatch(2);
        /** The share draws packed [lit, broken]. */
        const drawn = (): string => {
          car.group.updateMatrixWorld(true);
          batch.sync([car]);
          return [slot, slot + 2].map((b) => batch.drawn(b)).join();
        };
        assert.equal(drawn(), `${shares.length},0`, `${id} ${lid}: every share lit at rest`);
        car["breakLamp"](car.lamps.find((l) => l.kind === kind && l.side < 0)!);
        const left = shares.filter((f) => f.share?.lamp.side === -1).length;
        assert.equal(drawn(), `${shares.length - left},${left}`, `${id} ${lid}: the left lamp broke`);
        car["detachPart"](car["parts"].find((p) => p.name === lid)!, 0);
        assert.equal(drawn(), `0,${shares.length}`, `${id} ${lid}: the lid tore off`);
        car.resetVisual();
        assert.equal(drawn(), `${shares.length},0`, `${id} ${lid}: reset`);
        batch.dispose();
      }
    }
    assert.ok(lids >= 4, `${lids} lids carry lamp shares`);

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
  /** Whether a light reaches `p` at all: within its range and, for a spot, inside its cone. */
  const reaches = (l: THREE.PointLight | THREE.SpotLight, p: THREE.Vector3): boolean => {
    const to = p.clone().sub(l.position);
    if (to.length() >= l.distance) return false;
    return !(l instanceof THREE.SpotLight) || to.angleTo(l.target.position.clone().sub(l.position)) < l.angle;
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

  it("when a police car's sirens flash, then each siren's light reaches the road beside the car on its lens's side and nothing of the cabin under the roof (the seats' tops, the wheel, the headliner's middle)", () => {
    const { lights, scene, camera, far } = rig();
    const cop = new DeformableCar(paint(), scene, null, "police");
    cop.spawnFacing(-3, 8, 0, 0);
    cop.group.updateMatrixWorld(true);
    cop.setSirens(true);
    const style = cop.style;
    const z = (style.roofZ[0] + style.roofZ[1]) / 2;
    const [belt, roof] = [beltY(z, style), roofAt(z, style).y];
    const cabin = [-0.36, 0, 0.36].flatMap((x) => [belt - 0.05, roof - 0.12].map((y) => cop.group.localToWorld(new THREE.Vector3(x, y, z))));
    const lens = new THREE.Vector3();
    const out = new THREE.Vector3();
    for (const now of [0.1, 0.35]) {
      lights.update([far, cop], camera, far, now);
      const l = lights.tailSpots.find((p) => p.intensity > 1);
      assert.ok(l, `t=${now}: no siren lit`);
      for (let i = 0; i < cop.lampCount; i++) if (cop.lampWorld(i, lens, out) === "red" || cop.lampWorld(i, lens, out) === "blue") break;
      const road = lens.clone().addScaledVector(out, 1.6).setY(0.05);
      assert.ok(reaches(l, road), `t=${now}: the siren misses the road beside the car at ${road.toArray().map((e) => e.toFixed(2))}`);
      const lit = cabin.filter((p) => reaches(l, p));
      assert.equal(lit.length, 0, `t=${now}: the siren reaches the cabin at ${lit.map((p) => cop.group.worldToLocal(p.clone()).toArray().map((e) => e.toFixed(2)).join()).join("; ")}`);
    }
  });

  /** What the pool shows this frame: glows drawn, head spots and tail spots lit, ground pools laid. */
  const shows = (lights: LampLights): string =>
    `glows ${lights.glow.geometry.drawRange.count}, head spots ${lights.spots.filter((s) => s.intensity > 0).length}, tail spots ${lights.tailSpots.filter((s) => s.intensity > 0).length}, pools ${lights.pools.count}`;

  it("when night turns to day, then no car's head lamps, nor its tail lamps off the brakes, glow, take a real light or lay a pool; when night falls again they all come back", () => {
    const { lights, camera, far, near, behind } = rig();
    const frames = (night: boolean): string => {
      lights.night = night;
      // Real lights ease in over `FADE_S` (0.3 s): ten 0.1 s frames settle them.
      for (let f = 0; f < 10; f++) lights.update([far, near, behind], camera, far, 0, undefined, 0.1);
      return shows(lights);
    };
    const read = [frames(true), frames(false), frames(true)];
    assert.equal(read[1], "glows 0, head spots 0, tail spots 0, pools 0", "by day");
    for (const night of [read[0]!, read[2]!]) assert.ok(/^glows 12, head spots 4, tail spots 4, pools [1-9]/.test(night), `at night: ${night}`);
  });

  it("when it is day, then a braking car's tail lamps still glow, take real lights and draw lit lenses, and a police car's sirens still flash, while every head lamp and running tail stays off, its lens unlit", () => {
    const { lights, scene, camera, far, near } = rig();
    const cop = new DeformableCar(paint(), scene, null, "police");
    cop.spawnFacing(-3, 8, 0, 0);
    cop.setSirens(true);
    lights.night = false;
    far.drive.brake = 1;
    lights.update([far, near, cop], camera, far, 0.1);
    const siren = lights.tailSpots.filter((p) => p.intensity > 1).length;
    // The followed car's two braking tails and the one siren lit at t = 0.1: three glows, three tail spots; no head spot.
    assert.equal(`${shows(lights)}, siren spots ${siren}`, "glows 3, head spots 0, tail spots 3, pools 0, siren spots 1");

    // The lens looks the lamp batch draws (`LAMP_SLOTS`): lit head 0, running tail 2, braking tail 10, high brake lit 4, hood share 6,
    // boot share running 7 and braking 11; their unlit day looks 13 (head), 14 (tail), 15 (hood share), 16 (boot share).
    const cars = [far, near, cop];
    for (const c of cars) c.group.updateMatrixWorld(true);
    const batch = new LampBatch(cars.length);
    const lenses = (night: boolean): string => {
      batch.night = night;
      batch.sync(cars);
      const d = (b: number) => batch.drawn(b);
      return `heads ${d(0)} lit ${d(13)} unlit, running tails ${d(2)} lit ${d(14)} unlit, braking tails ${d(10)}, high brake ${d(4)}, hood shares ${d(6)} lit ${d(15)} unlit, boot shares ${d(7)} lit ${d(16)} unlit ${d(11)} braking`;
    };
    const count = (list: readonly DeformableCar[], kind: string) => list.reduce((n, c) => n + c.lamps.filter((l) => l.kind === kind).length + c.lampFittings.filter((f) => f.kind === kind).length, 0);
    const [heads, running, braking, high, hoods, boots, brakingBoots] = [count(cars, "head"), count([near, cop], "tail"), count([far], "tail"), count([far], "brake"), count(cars, "hood"), count([near, cop], "boot"), count([far], "boot")];
    const want = (day: boolean) =>
      `heads ${day ? 0 : heads} lit ${day ? heads : 0} unlit, running tails ${day ? 0 : running} lit ${day ? running : 0} unlit, braking tails ${braking}, high brake ${high}, hood shares ${day ? 0 : hoods} lit ${day ? hoods : 0} unlit, boot shares ${day ? 0 : boots} lit ${day ? boots : 0} unlit ${brakingBoots} braking`;
    assert.equal(`day: ${lenses(false)}; night: ${lenses(true)}`, `day: ${want(true)}; night: ${want(false)}`);
    assert.ok(heads > 0 && running > 0 && braking > 0, `the cars carry ${heads} heads, ${running} running tails, ${braking} braking tails`);
    batch.dispose();
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

describe("given each style's car alone at night, its lamps' glows seen from 8 m ahead and 8 m behind", () => {
  it("when the camera stands ahead, then its headlamps glow and its tail lamps' glows are dark (seen through the cabin's glass or past the body, a lens never shows from behind), and from behind the reverse", () => {
    for (const id of CAR_STYLE_IDS) {
      const scene = new THREE.Scene();
      const car = new DeformableCar(paint(), scene, null, id);
      car.spawnFacing(0, 0, 0, 0);
      car.group.updateMatrixWorld(true);
      const lights = new LampLights(scene, car.lampCount);
      const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
      /** Each lamp's glow (summed colour) with the camera 8 m along the car's heading times `ahead`, 1.5 m up. */
      const glows = (ahead: number): number[] => {
        camera.position.copy(car.group.position).addScaledVector(car.forward, 8 * ahead).setY(1.5);
        camera.lookAt(car.group.position);
        lights.update([car], camera, null);
        const c = lights.glow.geometry.getAttribute("color");
        return car.lamps.map((_, i) => c.getX(i) + c.getY(i) + c.getZ(i));
      };
      const lit = (row: number[], kind: string) => car.lamps.map((l, i) => [l.kind, row[i]!] as const).filter(([k]) => k === kind).map(([, g]) => g);
      const [front, back] = [glows(1), glows(-1)];
      assert.ok(lit(front, "head").every((g) => g > 0.5), `${id}: headlamp glows from ahead ${lit(front, "head")}`);
      assert.deepEqual(lit(front, "tail"), [0, 0], `${id}: tail lamp glows seen from ahead`);
      assert.ok(lit(back, "tail").every((g) => g > 0.1), `${id}: tail lamp glows from behind ${lit(back, "tail")}`);
      assert.deepEqual(lit(back, "head"), [0, 0], `${id}: headlamp glows seen from behind`);
    }
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

describe("given the lamp pool updating a lit car's glows every frame", () => {
  it("when it stores each lamp's glow and stash, then it never goes through three's shared Vector3.toArray (megamorphic once the cars are built)", () => {
    const scene = new THREE.Scene();
    const car = new DeformableCar(paint(), scene);
    car.spawnFacing(0, 10, 0, 0);
    car.group.updateMatrixWorld(true);
    const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 200);
    camera.position.copy(car.group.position).addScaledVector(car.forward, 8).setY(1.5);
    camera.lookAt(car.group.position);
    const lights = new LampLights(scene, 12, FULL_POOL);
    const toArray = THREE.Vector3.prototype.toArray;
    let calls = 0;
    THREE.Vector3.prototype.toArray = function (this: THREE.Vector3, ...args: Parameters<typeof toArray>) {
      calls++;
      return toArray.apply(this, args);
    } as typeof toArray;
    try {
      lights.update([car], camera, car);
    } finally {
      THREE.Vector3.prototype.toArray = toArray;
    }
    assert.ok(lights.glow.geometry.drawRange.count >= 4, `the control: ${lights.glow.geometry.drawRange.count} glows stored`);
    assert.equal(calls, 0, "Vector3.toArray calls in one update");
  });
});

describe("given the hatchback, whose tail lamp crosses the step from the infill to the quarter", () => {
  it("when its right tail lamp is met from behind along its band, then every ray from the gate's edge to the corner meets the lens, with no body showing at the step", () => {
    const car = new DeformableCar(paint(), new THREE.Scene(), null, "hatchback");
    car.group.updateMatrixWorld(true);
    const tail = car.lamps.find((l) => l.kind === "tail" && l.side > 0)!;
    tail.seat.updateWorldMatrix(true, false, true);
    const lens = new THREE.Mesh(drawnLamp(car.style, "tail", 1).geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    lens.matrixAutoUpdate = false;
    lens.matrixWorld.copy(tail.seat.matrixWorld);
    const ray = new THREE.Raycaster();
    const gaps: string[] = [];
    for (const y of [0.75, 0.765, 0.78]) {
      for (let x = 0.45; x <= 0.66; x += 0.001) {
        ray.set(new THREE.Vector3(x, y, -5), new THREE.Vector3(0, 0, 1));
        if (ray.intersectObjects([car.body, lens], false)[0]?.object !== lens) gaps.push(`${x.toFixed(4)},${y}`);
      }
    }
    assert.equal(gaps.join(" "), "", "rays along the band that meet the body before the lens, by x,y");
  });
});
