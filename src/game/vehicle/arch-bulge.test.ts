import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { DeformableCar } from "./car.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES, CAR_STYLE_IDS, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { sampleSlice } from "./car-mesh.ts";
import { CLASSES, STYLE_CLASS } from "./vehicle-classes.ts";
import { paint } from "./test-support.ts";

/** A bump this far (m) out of, or up from, the body either side of it (or past the reference) is a hump: the eye catches one at 1 cm. */
const BULGE_M = 0.01;
/** An arch's stretch of body: this many arch radii either side of the hub (the fitter's arch zone). */
const ARCH_SPAN = 1.3;
/** A top read this far (m) under the belt fell through the cabin's opening onto the floor: no shoulder there. */
const CABIN_DROP_M = 0.15;
/** Sample spacing (m) along z. */
const STEP_M = 0.02;
/**
 * The side is read this far (m) under the station's belt: the shoulder's edge. Lower, the drawn fender flare (`archFlare`, from the
 * feature line down: the arch lip's) stands up to 2 cm out over every arch by design.
 */
const BELT_READ_M = 0.03;
/** The shoulder top is read this far (m) inside the side: on the roll-in, clear of the pillars. */
const TOP_INSET_M = 0.02;
/**
 * Either side of each glass base (the rear glass's, the windshield's) this far (m): the deck's rise to the rear glass, the cowl's to
 * the windshield, and the sail foot over them, which the reference shapes and a smooth fit cannot judge.
 */
const GLASS_ZONE_M = 0.25;

/**
 * Each style's reference picture as lines (`fit-car --lines-out`): the side's top edge (m over the tyres' ground: the drawn car's,
 * class lift and all) and the plan's half-width (mirrors cut, flares kept), each [z, value] with z from the reference's hub midpoint.
 */
interface ReferenceLines {
  readonly top: readonly (readonly [number, number])[];
  readonly plan: readonly (readonly [number, number])[];
}

const REFERENCE = JSON.parse(readFileSync(new URL("./car-reference-lines.fixture.json", import.meta.url), "utf8")) as Partial<Record<CarStyleId, ReferenceLines>>;
/** The police is drawn on the sedan's body (the owner's ruling): its own picture is another car's shape, so it answers to the sedan's. */
const REFERENCE_OF: Partial<Record<CarStyleId, CarStyleId>> = { police: "sedan" };

/** One sample of an arch's stretch: the half-width at the belt and the shoulder top (null where the read finds no shoulder). */
interface Sample {
  readonly z: number;
  readonly side: number | null;
  readonly top: number | null;
}

const ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

/** The skin a read may land on: the hood, the boot lid, and the drawn body's loft alone (its first triangles, `userData.loft`). */
interface Skin {
  readonly meshes: readonly THREE.Object3D[];
  readonly body: THREE.Mesh;
  readonly loftTris: number;
}

/** The car's skin: the greenhouse frame, belt seals and bulkheads merged into the body after its loft are no shoulder. */
function skinOf(body: THREE.Mesh, hood: THREE.Mesh, trunk: THREE.Mesh): Skin {
  const { ring, slices } = body.geometry.userData.loft as { ring: number; slices: number };
  return { meshes: [body, hood, trunk], body, loftTris: (slices - 1) * ring * 2 };
}

/** The first hit (world) on `skin` from `origin` along `dir`, or null. */
function hit(skin: Skin, origin: THREE.Vector3, dir: THREE.Vector3): THREE.Vector3 | null {
  ray.set(origin, dir);
  const hits = ray.intersectObjects(skin.meshes as THREE.Object3D[], false);
  return hits.find((h) => h.object !== skin.body || (h.faceIndex ?? Infinity) < skin.loftTris)?.point ?? null;
}

/** `line` ([z, v], z ascending) at `z`, linear between rows; null past its ends. */
function lineAt(line: readonly (readonly [number, number])[], z: number): number | null {
  if (line.length === 0 || z < line[0]![0] || z > line.at(-1)![0]) return null;
  for (let i = 1; i < line.length; i++) {
    const [z1, v1] = line[i]!;
    if (z > z1) continue;
    const [z0, v0] = line[i - 1]!;
    return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0 || 1);
  }
  return line.at(-1)![1];
}

/**
 * The worst hump in `pts` ([z, v], z ascending) peaking between z `lo` and `hi`: how far a sample stands over the higher of the
 * lowest samples either side of it, so a side that only climbs or falls toward one end of the stretch (a nose, a cowl) scores
 * nothing.
 */
function hump(pts: readonly (readonly [number, number])[], lo: number, hi: number): readonly [number, number] {
  let worst: readonly [number, number] = [0, 0];
  for (let i = 1; i < pts.length - 1; i++) {
    if (pts[i]![0] < lo || pts[i]![0] > hi) continue;
    let before = Infinity;
    let after = Infinity;
    for (let j = 0; j < i; j++) before = Math.min(before, pts[j]![1]);
    for (let j = i + 1; j < pts.length; j++) after = Math.min(after, pts[j]![1]);
    const h = pts[i]![1] - Math.max(before, after);
    if (h > worst[1]) worst = [pts[i]![0], h];
  }
  return worst;
}

function inGlassZone(z: number, style: BodyStyle): boolean {
  return [style.rearGlass.base[1], style.windshield.base[1]].some((base) => Math.abs(z - base) <= GLASS_ZONE_M);
}

/**
 * Which run of the body `z` is on: the glass bases part the hood and the boot deck from the cabin, and the station's belt (which
 * the reads hang from) steps there, from the glass sill to the deck.
 */
function run(z: number, style: BodyStyle): string {
  if (z < style.rearGlass.base[1]) return "on the boot deck";
  return z > style.windshield.base[1] ? "on the hood" : "under the glass";
}

/** The arch's stretch (`hub` ± ARCH_SPAN arch radii) read every STEP_M on `skin`. */
function sampleArch(skin: Skin, style: BodyStyle, hub: readonly number[]): Sample[] {
  const reach = ARCH_SPAN * style.arch.radius;
  const out: Sample[] = [];
  for (let z = hub[2]! - reach; z <= hub[2]! + reach + 1e-9; z += STEP_M) {
    const belt = sampleSlice(z, style.profile).yBelt;
    const side = hit(skin, _o.set(3, belt - BELT_READ_M, z), _d.set(-1, 0, 0));
    const top = side === null ? null : (hit(skin, _o.set(side.x - TOP_INSET_M, 3, z), _d.set(0, -1, 0))?.y ?? null);
    out.push({ z, side: side?.x ?? null, top: top !== null && top > belt - CABIN_DROP_M ? top : null });
  }
  return out;
}

/**
 * The smooth-fit humps (`hump`, peaks over the wheel opening: hub ± one arch radius) of the half-width at the belt and the shoulder
 * top, each per run (`run`) and clear of the glass zones.
 */
function smoothHumps(samples: readonly Sample[], style: BodyStyle, hub: readonly number[]): string[] {
  const series = new Map<string, [number, number][]>();
  const add = (name: string, z: number, v: number | null) => {
    if (v === null) return;
    if (!series.has(name)) series.set(name, []);
    series.get(name)!.push([z, v]);
  };
  for (const s of samples) {
    if (inGlassZone(s.z, style)) continue;
    add(`half-width at the belt ${run(s.z, style)}`, s.z, s.side);
    add(`shoulder top ${run(s.z, style)}`, s.z, s.top);
  }
  const out: string[] = [];
  for (const [name, pts] of series) {
    const [z, h] = hump(pts, hub[2]! - style.arch.radius, hub[2]! + style.arch.radius);
    if (h > BULGE_M) out.push(`${name} humps ${(h * 100).toFixed(1)} cm at z ${z.toFixed(2)}`);
  }
  return out;
}

/**
 * In the glass zones, where the half-width at the belt or the shoulder top (drawn: over the class `lift`) stands more than BULGE_M
 * outside the reference's plan or side top edge at the same z (from the hub midpoint `mid`): a real deck rise passes, a sail foot
 * standing proud or a quarter stepping into the deck does not.
 */
function referenceOverhangs(samples: readonly Sample[], style: BodyStyle, ref: ReferenceLines, lift: number, mid: number): string[] {
  const worst = new Map<string, readonly [number, number]>();
  const check = (name: string, z: number, ours: number | null, theirs: number | null) => {
    if (ours === null || theirs === null) return;
    if (ours - theirs > (worst.get(name)?.[1] ?? BULGE_M)) worst.set(name, [z, ours - theirs]);
  };
  for (const s of samples) {
    if (!inGlassZone(s.z, style)) continue;
    check("half-width at the belt", s.z, s.side, lineAt(ref.plan, s.z - mid));
    check("shoulder top", s.z, s.top === null ? null : s.top + lift, lineAt(ref.top, s.z - mid));
  }
  return [...worst].map(([name, [z, h]]) => `${name} stands ${(h * 100).toFixed(1)} cm outside the reference at z ${z.toFixed(2)}`);
}

/** Each arch's humps on `id`'s drawn body (body loft, hood, boot lid): `smoothHumps` over the stretch, `referenceOverhangs` by the glass. */
function archHumps(id: CarStyleId): string[] {
  const style = CAR_STYLES[id];
  const ref = REFERENCE[REFERENCE_OF[id] ?? id];
  if (ref === undefined) throw new Error(`${id}: no lines in car-reference-lines.fixture.json (fit-car --lines-out)`);
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.group.updateMatrixWorld(true);
  const look = car.lookMeshes();
  const skin = skinOf(look.body, look.hood, look.trunk);
  const hubs = carFrame(style).wheels.filter((w) => w[0] > 0);
  const zs = hubs.map((w) => w[2]);
  const mid = (Math.max(...zs) + Math.min(...zs)) / 2;
  const out: string[] = [];
  for (const hub of hubs) {
    const samples = sampleArch(skin, style, hub);
    const found = [...smoothHumps(samples, style, hub), ...referenceOverhangs(samples, style, ref, CLASSES[STYLE_CLASS[id]].lift, mid)];
    for (const line of found) out.push(`${id} ${hub[2] > 0 ? "front" : "rear"} arch: ${line}`);
  }
  car.dispose();
  return out;
}

/** Styles whose stations still carry a hump on lane-cars: its owner and the reading. The owning car lane's ticket turns its cell live. */
const OPEN_HUMPS: Partial<Record<CarStyleId, string>> = {};

describe("arch humps", () => {
  for (const id of CAR_STYLE_IDS) {
    const name = `when a ${id} is built, then no body hump over 1 cm stands at the belt or the shoulder top over its wheels, nor past its reference by the glass`;
    const open = OPEN_HUMPS[id];
    if (open !== undefined) {
      it.todo(`${name} (${open})`);
      continue;
    }
    it(name, () => {
      const humps = archHumps(id);
      expect(humps.length, `humps over the arches:\n${humps.join("\n")}`).toBe(0);
    });
  }
});
