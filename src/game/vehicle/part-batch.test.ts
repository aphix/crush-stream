import { afterAll, describe, expect, test } from "vitest";
import * as THREE from "three";
import { DETAIL_LEVELS } from "../present/car-detail.ts";
import { DeformableCar } from "./car.ts";
import { BUMPER_F, DRIVER_SIDE } from "./constants.ts";
import { CAR_STYLES, CAR_STYLE_IDS, drawnStyle } from "./car-variants.ts";
import { windshieldBaseY } from "./car-glass.ts";
import { applyDents, DENT_MIN_DV, recordDent } from "./loose-dent.ts";
import { PartBatch } from "./part-batch.ts";
import { drawnDoorCard } from "./car-door-mesh.ts";
import { cageInterior } from "./interior-geometry.ts";
import { PART_KIND, PART_KINDS, PART_PER_CAR, partGeometry, type PartKind } from "./part-geometry.ts";
import { partBatchGeometries } from "./part-variants.ts";
import { assertSameNumbers, paint, stageBatch } from "./test-support.ts";

/** The instance matrix is float32: a seat's position of a few hundred metres is stored within 1e-4 m. */
const FLOAT32_SLACK = 1e-4;
const FAR_BEYOND = DETAIL_LEVELS[0]!.far;
const CARS = 3;
/** The car-space shove a torn part leaves with; any value, the rows read where the part's meshes are, not where it flies. */
const SHOVE = new THREE.Vector3(1.2, 0.6, 0);
/** A unit direction skimming the grille's top corner, off every axis so one grille vertex is furthest against it (the dent's contact). */
const GRILLE_NORMAL = new THREE.Vector3(0.05, -1, -0.02).normalize();
/** A bounce well over the dent threshold, so it is recorded at its full depth (m/s). */
const HARD_BOUNCE = 3 * DENT_MIN_DV;
/** loose-dent's reach (m), which it keeps private: skin within this of the contact moves. */
const DENT_REACH = 0.26;
/** Seats of a kind one car at rest draws: its `PART_PER_CAR`, and none of the bay or the crash bars (hood and bumpers on), nor a lifted truck's undercarriage (a sedan has none). */
const atRest = (kind: number): number => (kind === PART_KIND.engineBay || kind === PART_KIND.crashBar || kind === PART_KIND.ladderFrame || kind === PART_KIND.axle ? 0 : PART_PER_CAR[kind]!);
/** The kinds a style may draw its own way: `PartBatch.styled` draws them, their variants lying in `styled.variants` in this order. */
const STYLED: readonly PartKind[] = [PART_KIND.mirrorL, PART_KIND.mirrorR, PART_KIND.grille, PART_KIND.tailTrim, PART_KIND.wipers];

/** Where styled `kind`'s variants lie in `PartBatch.styled.variants` ([first, end)): after those of the styled kinds before it, the platform part first. */
function variantRange(kind: PartKind): [number, number] {
  let first = 0;
  for (const k of STYLED) {
    const end = first + partBatchGeometries(k)!.length;
    if (k === kind) return [first, end];
    first = end;
  }
  throw new Error(`kind ${kind} is not drawn by the styled draw`);
}

/** The rows of `batch.styled` drawing one of styled `kind`'s variants, in pack order. */
function rowsOf(batch: PartBatch, kind: PartKind): number[] {
  const [first, end] = variantRange(kind);
  const rows: number[] = [];
  for (let row = 0; row < batch.styled.count; row++) {
    const variant = batch.styled.variantAt(row);
    if (variant >= first && variant < end) rows.push(row);
  }
  return rows;
}

const stage = (capacity = 16) => stageBatch(() => new PartBatch(capacity), (b, cars) => b.sync(cars));

const looseMeshes = (seat: THREE.Object3D): THREE.Mesh[] => seat.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh);

const positions = (g: THREE.BufferGeometry): ArrayLike<number> => g.getAttribute("position").array;

describe("given a few cars near the camera, their parts drawn in batches", () => {
  test("when the cars are synced, then every kind shown at rest has its seats per car, the bay and crash bars none, and the parts cost one draw per shown plain kind plus one for all the styled kinds, whatever the car count", () => {
    for (const n of [1, CARS]) {
      const { batch, car, draw } = stage();
      draw(Array.from({ length: n }, () => car(10)));
      expect(batch.kinds.length).toBe(PART_KINDS.length);
      for (const kind of PART_KINDS) expect(batch.drawn(kind), `kind ${kind} with ${n} cars`).toBe(n * atRest(kind));
      expect(PART_KINDS.filter((k) => batch.drawn(k) > 0).length, `${n} cars draw ten kinds`).toBe(PART_KINDS.filter((k) => atRest(k) > 0).length);
      // Old: one mesh per styled variant drawn, so ten for ten kinds of one style; the four styled kinds are now the one `SeatDraw`: six plain meshes plus it.
      const draws = batch.kinds.filter((m) => m !== null && m.count > 0).length + (batch.styled.triangles > 0 ? 1 : 0);
      expect(draws, `${n} cars of one style draw seven meshes`).toBe(PART_KINDS.filter((k) => atRest(k) > 0 && !STYLED.includes(k)).length + 1);
    }
  });

  test("when undamaged cars are synced, then their shadows are one instanced caster per style, holding each car's rest caster where the car stands, and a car beyond the far cut still casts", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(20), car(FAR_BEYOND + 20)];
    draw(cars);
    const sedan = batch.casters.find((m) => m.name === "shadow-caster-sedan")!;
    expect(sedan.count, "one instance per undamaged sedan").toBe(cars.length);
    expect(sedan.geometry, "the batch draws the sedan's rest caster").toBe(cars[0]!.restCaster);
    expect(sedan.castShadow, "the batch casts").toBeTruthy();
    expect(batch.casters.filter((m) => m.count > 0).length, "one caster draw for a field of one style").toBe(1);
    const m = new THREE.Matrix4();
    sedan.getMatrixAt(1, m);
    assertSameNumbers(m.elements, cars[1]!.group.matrixWorld.elements, "the second sedan's caster instance", FLOAT32_SLACK);
  });

  test("when a car is synced, then its mirror is drawn where its mirror seat stands", () => {
    const { batch, car, draw } = stage();
    const only = car(10);
    draw([only]);
    const matrix = new THREE.Matrix4();
    const seat = only.partSeats[PART_KIND.mirrorR]!;
    const rows = rowsOf(batch, PART_KIND.mirrorR);
    expect(rows.length, "one mirror row").toBe(1);
    expect(batch.styled.variantAt(rows[0]!), "the row draws the seat's variant").toBe(variantRange(PART_KIND.mirrorR)[0] + seat.variant);
    batch.styled.matrixAt(rows[0]!, matrix);
    assertSameNumbers(matrix.elements, seat.matrixWorld.elements, "the mirror row is the seat's world matrix", FLOAT32_SLACK);
  });

  test("when the batches are built, then each plain kind draws its one shared geometry (a door card's: the one inside every door skin), and each kind a style draws its own way (mirrors, grille, tail trim, wipers) has no draw of its own, its variants in the one styled draw starting with the platform part", () => {
    const { batch } = stage();
    for (const kind of PART_KINDS) {
      const mesh = batch.kinds[kind];
      if (!STYLED.includes(kind)) {
        const card = kind === PART_KIND.liningL ? -1 : kind === PART_KIND.liningR ? 1 : 0;
        // Identity, never a deep compare: a geometry holds big typed arrays.
        expect(mesh !== null && mesh.geometry === (card !== 0 ? drawnDoorCard(card) : partGeometry(kind)), `kind ${kind} draws one shape once (same object, not equal copies)`).toBeTruthy();
        continue;
      }
      expect(mesh, `kind ${kind}: the styled draw holds it, no draw of its own`).toBe(null);
      const [first, end] = variantRange(kind);
      expect(end - first, `kind ${kind}: a variant per own shape`).toBeGreaterThan(1);
      assertSameNumbers(positions(batch.styled.variants[first]!), positions(partGeometry(kind)), `kind ${kind}: the platform part is its variant 0`);
    }
    expect(batch.styled.variants.length, "the styled draw holds every styled kind's variants and no more").toBe(variantRange(STYLED[STYLED.length - 1]!)[1]);
  });
});

describe("given one car of each style, its parts drawn in batches", () => {
  const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute("position").count) / 3;

  // Runs while the wagon's own mirror (set when the describe below registers, put back after its rows) is on, as the fleet table was built with it.
  test("when one car of each style is synced, then its styled parts bill only their own triangles, not the fleet's variants", () => {
    for (const id of CAR_STYLE_IDS) {
      const { batch, car, draw } = stage(1);
      const only = car(10, id);
      draw([only]);
      let expected = 0;
      for (const kind of STYLED) {
        const n = batch.drawn(kind);
        const rows = rowsOf(batch, kind);
        const own = tris(only.partSeats[kind]!.drawn);
        expect(n, `${id} kind ${kind}: ${n} seats drawn for one car`).toBeLessThanOrEqual(1);
        expect(rows.length, `${id} kind ${kind}: a row per seat drawn`).toBe(n);
        for (const row of rows) expect(tris(batch.styled.variants[batch.styled.variantAt(row)]!), `${id} kind ${kind}: the seat bills its own variant's triangles`).toBe(own);
        expected += n * own;
      }
      expect(batch.styled.triangles, `${id}: the styled draw bills ${batch.styled.triangles} triangles for ${expected} of its own`).toBe(expected);
      batch.dispose();
    }
  });
});

describe("given one car of each style, its windshield whole and then shattered", () => {
  /** Off the glass (m): nothing of the wipers deeper than this into it, and the pivot cap, standing highest, under the other. */
  const [INTO_GLASS, OVER_GLASS] = [0.001, 0.06];

  /** Each vertex of `part`'s geometry against the glass `pane` draws (both in the pane's space): how far out of the glass it stands, nearest facet's side. */
  const offGlass = (part: THREE.BufferGeometry, pane: THREE.BufferGeometry): number[] => {
    const [pos, glass, index] = [part.getAttribute("position"), pane.getAttribute("position"), pane.index!];
    const tri = new THREE.Triangle();
    const [p, q, n] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const out: number[] = [];
    for (let v = 0; v < pos.count; v++) {
      p.fromBufferAttribute(pos, v);
      let [best, off] = [Infinity, 0];
      for (let t = 0; t < index.count; t += 3) {
        tri.setFromAttributeAndIndices(glass, index.getX(t), index.getX(t + 1), index.getX(t + 2));
        const d = tri.closestPointToPoint(p, q).distanceTo(p);
        if (d >= best) continue;
        tri.getNormal(n);
        if (n.z < 0) n.negate();
        [best, off] = [d, p.clone().sub(q).dot(n) >= 0 ? d : -d];
      }
      out.push(off);
    }
    return out;
  };

  /**
   * How far (m) each point of `part` (in `seat`'s space) stands past `car`'s drawn outline in the side view: the car's shown meshes (body,
   * lids, doors, glass, bumpers) projected along its x onto (z, y), their union the outline; 0 for a point it covers.
   */
  const pastOutline = (car: DeformableCar, seat: THREE.Object3D, part: THREE.BufferGeometry): number[] => {
    car.group.updateMatrixWorld(true);
    const toCar = car.group.matrixWorld.clone().invert();
    const tris: number[] = [];
    const v = new THREE.Vector3();
    car.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible || p.name === "deform-rig") return;
      const pos = o.geometry.getAttribute("position");
      if (!pos) return;
      const m = toCar.clone().multiply(o.matrixWorld);
      const index = o.geometry.index;
      const n = index ? index.count : pos.count;
      for (let t = 0; t + 2 < n; t += 3) {
        for (let c = 0; c < 3; c++) {
          v.fromBufferAttribute(pos, index ? index.getX(t + c) : t + c).applyMatrix4(m);
          tris.push(v.z, v.y);
        }
      }
    });
    const f = Float64Array.from(tris);
    const toSeat = toCar.clone().multiply(seat.matrixWorld);
    const pos = part.getAttribute("position");
    const [p, a, b, q] = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()];
    const toEdge = (): number => {
      const ab = q.subVectors(b, a);
      const s = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-18), 0, 1);
      return p.distanceTo(a.clone().addScaledVector(ab, s));
    };
    return Array.from({ length: pos.count }, (_, k) => {
      v.fromBufferAttribute(pos, k).applyMatrix4(toSeat);
      p.set(v.z, v.y);
      let best = Infinity;
      for (let t = 0; t < f.length && best > 0; t += 6) {
        const [az, ay, bz, by, cz, cy] = [f[t]!, f[t + 1]!, f[t + 2]!, f[t + 3]!, f[t + 4]!, f[t + 5]!];
        if (p.x < Math.min(az, bz, cz) - best || p.x > Math.max(az, bz, cz) + best || p.y < Math.min(ay, by, cy) - best || p.y > Math.max(ay, by, cy) + best) continue;
        const d1 = (p.x - bz) * (ay - by) - (az - bz) * (p.y - by);
        const d2 = (p.x - cz) * (by - cy) - (bz - cz) * (p.y - cy);
        const d3 = (p.x - az) * (cy - ay) - (cz - az) * (p.y - ay);
        if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) best = 0;
        for (const [i, j] of [[0, 2], [2, 4], [4, 0]] as const) {
          a.set(f[t + i]!, f[t + i + 1]!);
          b.set(f[t + j]!, f[t + j + 1]!);
          best = Math.min(best, toEdge());
        }
      }
      return best;
    });
  };

  test(`when each car is synced, then its own wipers draw (one seat, its style's variant, riding the windshield): each blade parked along the glass's base, its tip toward the driver's side (x +${DRIVER_SIDE}), a share of the base width, the whole part on the glass's outside within ${OVER_GLASS * 100} cm of it; once the windshield shatters, they are gone with it`, () => {
    for (const id of CAR_STYLE_IDS) {
      const { batch, car, draw } = stage(1);
      const only = car(10, id);
      const style = drawnStyle(CAR_STYLES[id]);
      draw([only]);
      const seat = only.partSeats[PART_KIND.wipers]!;
      const pane = only.glassPanes.find((g) => g.name === "windshield")!.mesh;
      expect(`${batch.drawn(PART_KIND.wipers)} ${rowsOf(batch, PART_KIND.wipers).length} ${seat.variant > 0} ${seat.parent === pane}`, `${id}: one wiper seat drawn in the styled draw, its style's own, on the windshield`).toBe("1 1 true true");
      const blades = seat.drawn.userData.blades as { pivot: number[]; tip: number[] }[];
      expect(blades.length, `${id}: blades`).toBe(style.wipers?.count ?? 2);
      for (const { pivot, tip } of blades) {
        expect(Math.sign(tip[0]! - pivot[0]!), `${id}: a blade parks from x ${pivot[0]!.toFixed(2)} to ${tip[0]!.toFixed(2)}`).toBe((style.wipers?.park ?? DRIVER_SIDE));
        const share = Math.abs(tip[0]! - pivot[0]!) / style.windshield.wBase;
        expect(share > 0.25 && share < 0.55, `${id}: a blade spans ${share.toFixed(2)} of the base width`).toBeTruthy();
        const floor = windshieldBaseY(style, pivot[0]! / (style.windshield.wBase / 2));
        expect(pivot[1]! > floor && pivot[1]! < floor + 0.06, `${id}: a pivot at y ${pivot[1]!.toFixed(3)}, just over the glass's base ${floor.toFixed(3)} at its column`).toBeTruthy();
      }
      const off = offGlass(seat.drawn, pane.geometry);
      const [low, high] = [Math.min(...off), Math.max(...off)];
      expect(low > -INTO_GLASS && high < OVER_GLASS, `${id}: the wipers stand ${(low * 1000).toFixed(1)} to ${(high * 1000).toFixed(1)} mm off the glass`).toBeTruthy();
      only.smashGlass("windshield");
      draw([only]);
      expect(`${batch.drawn(PART_KIND.wipers)} ${rowsOf(batch, PART_KIND.wipers).length}`, `${id}: wipers drawn over a shattered windshield`).toBe("0 0");
      batch.dispose();
    }
  });

  /** How far (m) a wiper may show past the side outline: its blade and arm, 1.4 and 2.2 cm off the glass at the glass's foot, a line over the cowl. */
  const PAST_OUTLINE = 0.025;

  // The coupe's side landing shot showed its far wiper's pivot cap, a 2.8 cm block 4.2 cm off the glass at its outer foot, floating over the cowl.
  test("when each car is seen from its side, then its wipers show past the outline of its body, lids and glass by no more than their blades and arms (nothing floats over the cowl)", () => {
    const past: string[] = [];
    for (const id of CAR_STYLE_IDS) {
      const { batch, car, draw } = stage(1);
      const only = car(10, id);
      draw([only]);
      const seat = only.partSeats[PART_KIND.wipers]!;
      const out = pastOutline(only, seat, seat.drawn);
      const far = Math.max(...out);
      if (far > PAST_OUTLINE) past.push(`${id}: ${out.filter((d) => d > PAST_OUTLINE).length} points past it, up to ${(far * 100).toFixed(1)} cm`);
      batch.dispose();
    }
    expect(past.join("; ")).toBe("");
  });
});

describe("given a car whose style has its own mirror, beside a car with the platform mirror", () => {
  // Set before the first batch or car reads the fleet's mirror variants; the per-style row above builds a wagon too, and runs while this mirror is set.
  const wagon = CAR_STYLES.wagon;
  const door = wagon.door;
  wagon.door = { ...door, mirror: { cap: "rounded", finish: "body" } };
  afterAll(() => {
    wagon.door = door;
  });

  test("when it is synced beside a platform-mirror car, then its mirror draws in its own variant, painted its door's colour, and that draw's geometry is its mirror", () => {
    const { batch, draw } = stage();
    // Every real style carries its own mirror now: the neighbour is a hatchback stripped of its own for its build, so it draws the platform's; a fresh twin reference rebuilds its drawn style (cached per twin).
    const hatch = CAR_STYLES.hatchback;
    const hatchDoor = hatch.door;
    const hatchTwin = hatch.drawn;
    hatch.door = { ...hatchDoor, mirror: undefined };
    let plain: DeformableCar;
    try {
      hatch.drawn = hatchTwin && { ...hatchTwin };
      plain = new DeformableCar(paint(), new THREE.Scene(), null, "hatchback");
    } finally {
      hatch.door = hatchDoor;
      hatch.drawn = hatchTwin;
    }
    plain.spawn(0, 10, 0);
    const own = new DeformableCar({ ...paint(), body: 0x336699 }, new THREE.Scene(), null, "wagon");
    own.spawn(0, 10, 0);
    draw([plain, own]);
    const seat = own.partSeats[PART_KIND.mirrorR]!;
    const rows = rowsOf(batch, PART_KIND.mirrorR);
    const { styled } = batch;
    expect(seat.variant, `the control: the wagon's mirror is variant ${seat.variant}`).toBeGreaterThan(0);
    expect(batch.drawn(PART_KIND.mirrorR), "both cars' mirrors draw").toBe(2);
    expect(rows.length, "one row each").toBe(2);
    expect(styled.variantAt(rows[0]!), "the platform-mirror neighbour draws as variant 0, alone").toBe(variantRange(PART_KIND.mirrorR)[0]);
    expect(styled.variantAt(rows[1]!), "the wagon's mirror draws in its own variant, alone").toBe(variantRange(PART_KIND.mirrorR)[0] + seat.variant);
    expect(styled.colorAt(rows[1]!, new THREE.Color()).getHex(), "the seat colour is its door's paint").toBe(0x336699);
    assertSameNumbers(positions(styled.variants[styled.variantAt(rows[1]!)]!), positions(seat.drawn), "its variant's vertices are its drawn mirror's");
  });

  test("when the cage interior is built, then its steering wheel is on the car's left (+x), the driver's side", () => {
    const attr = cageInterior().getAttribute("position");
    let count = 0;
    let sumX = 0;
    // Only the wheel torus lies here: the dash is at |x| 0.41, the seats and their backs are lower or further back.
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i);
      const y = attr.getY(i);
      const z = attr.getZ(i);
      if (Math.abs(x) < 0.38 && y > 0.55 && y < 0.8 && z > 0.2 && z < 0.5) {
        count++;
        sumX += x;
      }
    }
    expect(count, "the wheel's vertices were found").toBeGreaterThan(0);
    expect(sumX / count, `the wheel's mean car-local x is ${(sumX / count).toFixed(2)}`).toBeGreaterThan(0.15);
  });
});

describe("given cars in batches, one whose right mirror snaps off", () => {
  test("when the mirror is torn, then its seat grows a mesh of its own geometry and leaves the mirror batch", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    const mirror = cars[0]!.partSeats[PART_KIND.mirrorR]!;
    draw(cars);
    cars[0]!.breakMirror(1, SHOVE);
    draw(cars);
    const own = looseMeshes(mirror);
    expect(own.length, "one loose mesh under the seat").toBe(1);
    expect(own[0]!.geometry, "a clone, so the shared geometry is never disposed with the loose part").not.toBe(partGeometry(PART_KIND.mirrorR));
    expect(batch.drawn(PART_KIND.mirrorR)).toBe(CARS - 1);
    expect(batch.drawn(PART_KIND.mirrorL), "the left mirror stays").toBe(CARS);
  });

  test("when the torn mirror's car is beyond the far cut, then the seat is back on the camera's layer and so is its mesh", () => {
    const { car, draw } = stage();
    const cars = [car(FAR_BEYOND + 20), car(10), car(10)];
    const mirror = cars[0]!.partSeats[PART_KIND.mirrorR]!;
    draw(cars);
    expect(mirror.layers.isEnabled(0), "the control: the far cut took the seat off the camera").toBe(false);
    cars[0]!.breakMirror(1, SHOVE);
    draw(cars);
    expect(mirror.layers.isEnabled(0), "the torn seat shows on every camera").toBe(true);
    expect(looseMeshes(mirror)[0]!.layers.isEnabled(0), "its mesh too").toBe(true);
  });

  test("when the car is reset and synced, then the seat is back in the batch, keeps its mesh off the seat, and the car's dispose frees that mesh", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    const mirror = cars[0]!.partSeats[PART_KIND.mirrorR]!;
    draw(cars);
    cars[0]!.breakMirror(1, SHOVE);
    draw(cars);
    const own = looseMeshes(mirror)[0]!;
    let freed = 0;
    const onFreed = () => void freed++;
    own.geometry.addEventListener("dispose", onFreed);
    cars[0]!.resetVisual();
    draw(cars);
    expect(mirror.loose).toBe(false);
    expect(looseMeshes(mirror).length).toBe(0);
    expect(batch.drawn(PART_KIND.mirrorR)).toBe(CARS);
    expect(freed, "a re-attached seat keeps its mesh, dents and all, for the next tear").toBe(0);
    cars[0]!.dispose();
    // The mirror seat is reached twice (its own part and its door's), as the old mesh was; three's dispose is idempotent.
    expect(freed, `the car's dispose frees it while it is off the seat (${freed} dispose events)`).toBeGreaterThanOrEqual(1);
  });
});

describe("given cars in batches, one that loses a door or its front bumper", () => {
  test("when the right door is torn, then its lining and mirror are loose and leave their batches, the left ones stay", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    draw(cars);
    cars[0]!["detachPart"](cars[0]!["doorParts"][1]!, 0, SHOVE);
    draw(cars);
    for (const kind of [PART_KIND.liningR, PART_KIND.mirrorR]) {
      expect(cars[0]!.partSeats[kind]!.loose, `kind ${kind} loose`).toBe(true);
      expect(batch.drawn(kind), `kind ${kind} left the batch`).toBe(CARS - 1);
    }
    for (const kind of [PART_KIND.liningL, PART_KIND.mirrorL]) {
      expect(cars[0]!.partSeats[kind]!.loose, `kind ${kind} fast`).toBe(false);
      expect(batch.drawn(kind), `kind ${kind} stays`).toBe(CARS);
    }
  });

  test("when the front bumper is torn, then its grille is loose and leaves the batch, the tail trim stays", () => {
    const { batch, car, draw } = stage();
    const cars = Array.from({ length: CARS }, () => car(10));
    draw(cars);
    cars[0]!["detachPart"](cars[0]!["parts"].find((p) => p.name === BUMPER_F)!, 0, SHOVE);
    draw(cars);
    expect(cars[0]!.partSeats[PART_KIND.grille]!.loose).toBe(true);
    expect(batch.drawn(PART_KIND.grille)).toBe(CARS - 1);
    expect(cars[0]!.partSeats[PART_KIND.tailTrim]!.loose).toBe(false);
    expect(batch.drawn(PART_KIND.tailTrim)).toBe(CARS);
  });

  test("when the torn bumper is dented at its grille, then only the grille's own mesh moves, within the dent's reach of the contact", () => {
    const { car } = stage();
    // The cop's bumper carries no seam cover, so its grille is the top the dent meets from above.
    const only = car(10, "police");
    const bumper = only["parts"].find((p) => p.name === BUMPER_F)!;
    only["detachPart"](bumper, 0, SHOVE);
    const seat = only.partSeats[PART_KIND.grille]!;
    const shared = positions(seat.drawn);
    const sharedBefore = Float32Array.from(shared);
    // The dent's normal is read in the part's frame; an upright part makes it the one above.
    bumper.object.quaternion.identity();
    recordDent(bumper.dent, bumper.object, GRILLE_NORMAL.clone().multiplyScalar(HARD_BOUNCE));
    applyDents(bumper.dent, bumper.object);
    const dented = positions(looseMeshes(seat)[0]!.geometry);
    const inBumperFrame = (a: ArrayLike<number>, i: number): THREE.Vector3 => new THREE.Vector3(a[i]!, a[i + 1]!, a[i + 2]!).add(seat.position);
    let contact = inBumperFrame(shared, 0);
    for (let i = 3; i < shared.length; i += 3) {
      const v = inBumperFrame(shared, i);
      if (v.dot(GRILLE_NORMAL) < contact.dot(GRILLE_NORMAL)) contact = v;
    }
    let moved = 0;
    for (let i = 0; i < shared.length; i += 3) {
      if (dented[i] === shared[i] && dented[i + 1] === shared[i + 1] && dented[i + 2] === shared[i + 2]) continue;
      moved++;
      const reach = inBumperFrame(shared, i).distanceTo(contact);
      expect(reach, `vertex ${i / 3} moved from ${reach.toFixed(3)} m off the contact`).toBeLessThan(DENT_REACH);
    }
    expect(moved, "the dent moved nothing on the grille's mesh").toBeGreaterThan(0);
    assertSameNumbers(shared, sharedBefore, "the shared grille positions");
  });
});

describe("given a car the distance detail cuts, among cars drawn in batches", () => {
  test("when one of three cars is beyond the far distance, then each kind draws the other two only; when it comes back, all three", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(10), car(FAR_BEYOND + 20)];
    draw(cars);
    for (const kind of PART_KINDS) expect(batch.drawn(kind), `kind ${kind} while cut`).toBe((CARS - 1) * atRest(kind));
    cars[2]!.group.position.z = 12;
    draw(cars);
    for (const kind of PART_KINDS) expect(batch.drawn(kind), `kind ${kind} restored`).toBe(CARS * atRest(kind));
  });

  test("when a car is hidden, then its seats draw nothing; when shown again, they do", () => {
    const { batch, car, draw } = stage();
    const cars = [car(10), car(10)];
    cars[1]!.group.visible = false;
    draw(cars);
    for (const kind of PART_KINDS) expect(batch.drawn(kind), `kind ${kind} while hidden`).toBe(atRest(kind));
    cars[1]!.group.visible = true;
    draw(cars);
    for (const kind of PART_KINDS) expect(batch.drawn(kind), `kind ${kind} shown`).toBe(2 * atRest(kind));
  });
});

describe("given more cars than the parts batches have room for", () => {
  test("when more cars than the capacity are synced, then every kind stops at the capacity", () => {
    const capacity = CARS - 1;
    const { batch, car, draw } = stage(capacity);
    draw(Array.from({ length: CARS }, () => car(10)));
    for (const kind of PART_KINDS) {
      expect(batch.drawn(kind), `kind ${kind}`).toBe(capacity * atRest(kind));
      const mesh = batch.kinds[kind];
      if (mesh) expect(mesh.instanceMatrix.count, `kind ${kind}: the matrix buffer is the capacity's size, nothing grew`).toBe(capacity * PART_PER_CAR[kind]!);
    }
    expect(batch.styled.capacity, "the styled draw's seat room is the capacity's size, nothing grew").toBe(STYLED.reduce<number>((n, kind) => n + capacity * PART_PER_CAR[kind]!, 0));
  });
});

describe("given the parts batches are no longer needed", () => {
  test("when it is disposed, then each mesh is released and the shared geometries are not", () => {
    const { batch, car, draw } = stage();
    draw([car(10)]);
    let meshesFreed = 0;
    let geometriesFreed = 0;
    const onMesh = () => void meshesFreed++;
    const onGeometry = () => void geometriesFreed++;
    const instanced = batch.meshes.filter((m): m is THREE.InstancedMesh => (m as THREE.InstancedMesh).isInstancedMesh);
    expect(instanced.length, "the control: every plain kind has its instanced mesh").toBe(PART_KINDS.length - STYLED.length);
    for (const mesh of instanced) mesh.addEventListener("dispose", onMesh);
    // The styled draw is a plain Mesh with no dispose event: what it frees is its own geometry and material.
    batch.styled.mesh.geometry.addEventListener("dispose", onMesh);
    (batch.styled.mesh.material as THREE.Material).addEventListener("dispose", onMesh);
    for (const kind of PART_KINDS) partGeometry(kind).addEventListener("dispose", onGeometry);
    try {
      batch.dispose();
    } finally {
      for (const kind of PART_KINDS) partGeometry(kind).removeEventListener("dispose", onGeometry);
    }
    expect(meshesFreed, "every instanced mesh, and the styled draw's geometry and material").toBe(instanced.length + 2);
    expect(geometriesFreed, "the geometry is shared by every car, so the batch never frees it").toBe(0);
    for (const kind of PART_KINDS) expect(partGeometry(kind).getAttribute("position").array.length, `kind ${kind} keeps its positions`).toBeGreaterThan(0);
  });
});

describe("given a resting field of cars drawn in batches", () => {
  test("when it syncs again with nothing moved, then no draw uploads; when the cars move, every kind, caster and the styled draw upload again", () => {
    const { batch, car, draw } = stage();
    const cars = [car(8), car(12, "wagon")];
    draw(cars);
    const instanced = [...batch.kinds.filter((m): m is THREE.InstancedMesh => m !== null && m.count > 0), ...batch.casters.filter((m) => m.count > 0)];
    expect(instanced.length > 0 && batch.styled.count > 0, "the control: the field draws instanced kinds, a caster and styled parts").toBeTruthy();
    const versions = () => [...instanced.map((m) => m.instanceMatrix.version), batch.styled.texture.version].join(",");
    const before = versions();
    draw(cars);
    expect(versions(), "a resting field re-uploaded matrices").toBe(before);
    for (const c of cars) c.group.position.x += 0.5;
    draw(cars);
    const after = versions().split(",").map(Number);
    const was = before.split(",").map(Number);
    expect(after.every((v, i) => v > was[i]!), `a moved car's draws must upload again: ${before} -> ${after.join(",")}`).toBeTruthy();
  });

  test("when the boot warm hides every draw after a sync (its restore) and the field then syncs at rest, then each kind the monster draws (its frame and axles too) and its caster show again, uploading nothing", () => {
    const { batch, car, draw } = stage();
    const monster = car(8, "monster");
    draw([monster]);
    const instanced = [...batch.kinds.filter((m): m is THREE.InstancedMesh => m !== null && m.count > 0), ...batch.casters.filter((m) => m.count > 0)];
    expect(batch.kinds[PART_KIND.ladderFrame]!.count === 1 && batch.kinds[PART_KIND.axle]!.count === 2, "the control: the monster draws its frame and both axles").toBeTruthy();
    const versions = () => instanced.map((m) => m.instanceMatrix.version).join(",");
    const before = versions();
    for (const m of [...instanced, batch.styled.mesh]) m.visible = false;
    draw([monster]);
    const hidden = [...instanced.filter((m) => !m.visible).map((m) => m.name || `kind ${batch.kinds.indexOf(m)}`), ...(batch.styled.mesh.visible ? [] : ["styled"])];
    expect(hidden.join(), "draws left hidden after the warm's restore").toBe("");
    expect(versions(), "a resting field re-uploaded matrices").toBe(before);
  });
});

describe("given a field of cars whose styled parts were drawn once", () => {
  test("when its buffers are read, then every one is static, never dynamic (a dynamic one may sit in host memory the GPU reads every frame)", () => {
    const { batch, car, draw } = stage();
    draw([car(8), car(12, "wagon")]);
    const geo = batch.styled.mesh.geometry;
    expect(geo.drawRange.count, "the control: the styled draw packed seats").toBeGreaterThan(0);
    const dynamic: string[] = [];
    for (const [name, a] of [...Object.entries(geo.attributes), ["index", geo.index!] as const]) if ((a as THREE.BufferAttribute).usage !== THREE.StaticDrawUsage) dynamic.push(name);
    expect(dynamic.join(",")).toBe("");
  });
});
