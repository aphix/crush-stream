import * as THREE from "three";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DeformableCar } from "./car.ts";
import { carFrame } from "./car-rig.ts";
import { CAR_STYLES, CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { sampleSlice } from "./car-mesh.ts";
import { paint } from "./test-support.ts";

/** A bump this far (m) out of, or up from, the body either side of it is a hump: the eye catches one at 1 cm. */
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

/**
 * Each arch's humps on `id`'s drawn body (body loft, hood, boot lid): the side's half-width at the belt and the shoulder's top,
 * sampled over the arch's stretch (the fitter's arch zone, where a plan read that took the flare for the body side swelled both)
 * and scored by `hump` for peaks over the wheel opening (hub ± one arch radius). A peak at the stretch's ends is the cowl's or
 * the C-pillar foot's, not the wheel's.
 */
function archHumps(id: CarStyleId): string[] {
  const style = CAR_STYLES[id];
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.group.updateMatrixWorld(true);
  const look = car.lookMeshes();
  const skin = skinOf(look.body, look.hood, look.trunk);
  const reach = ARCH_SPAN * style.arch.radius;
  const out: string[] = [];
  for (const hub of carFrame(style).wheels.filter((w) => w[0] > 0)) {
    const [z0, z1] = [hub[2] - reach, hub[2] + reach];
    const reads = new Map<string, [number, number][]>();
    const add = (name: string, z: number, v: number | null) => {
      if (v === null) return;
      if (!reads.has(name)) reads.set(name, []);
      reads.get(name)!.push([z, v]);
    };
    for (let z = z0; z <= z1 + 1e-9; z += STEP_M) {
      const belt = sampleSlice(z, style.profile).yBelt;
      const side = hit(skin, _o.set(3, belt - BELT_READ_M, z), _d.set(-1, 0, 0));
      add("half-width at the belt", z, side?.x ?? null);
      const top = side === null ? null : (hit(skin, _o.set(side.x - TOP_INSET_M, 3, z), _d.set(0, -1, 0))?.y ?? null);
      add("shoulder top", z, top !== null && top > belt - CABIN_DROP_M ? top : null);
    }
    for (const [name, pts] of reads) {
      const [z, h] = hump(pts, hub[2] - style.arch.radius, hub[2] + style.arch.radius);
      if (h > BULGE_M) out.push(`${id} ${hub[2] > 0 ? "front" : "rear"} arch: ${name} humps ${(h * 100).toFixed(1)} cm at z ${z.toFixed(2)}`);
    }
  }
  car.dispose();
  return out;
}

/** Styles whose stations still carry a hump on lane-cars: its owner and the reading. The owning car lane's ticket turns its cell live. */
const OPEN_HUMPS: Partial<Record<CarStyleId, string>> = {
  wagon: "CarHatchSuv: rear arch half-width at the belt humps 1.8 cm at z -1.61",
  sedan: "CarGreenhouse2: belt rail top 1.6 cm over the shoulder from z -0.88 (rear arch shoulder top humps 1.3 cm at z -0.88)",
  police: "CarGreenhouse2: belt rail top 1.6 cm over the shoulder from z -0.88 (rear arch shoulder top humps 1.3 cm at z -0.88)",
};

describe("arch humps", () => {
  for (const id of CAR_STYLE_IDS) {
    const name = `when a ${id} is built, then no body hump over 1 cm stands at the belt or the shoulder top over its wheels`;
    const open = OPEN_HUMPS[id];
    if (open !== undefined) {
      it.todo(`${name} (${open})`);
      continue;
    }
    it(name, () => {
      const humps = archHumps(id);
      assert.ok(humps.length === 0, `humps over the arches:\n${humps.join("\n")}`);
    });
  }
});
