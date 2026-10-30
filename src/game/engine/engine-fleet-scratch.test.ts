import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import type { CrashEngine } from "./engine.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { bootEngine, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import { REST_NORMAL, REST_POSITION, restNormals, restPositions } from "../vehicle/car-detail-map.ts";
import { FITTED_OVER, FITTING_ATTRIBUTE, PRIMER_ATTRIBUTE, PRIMER_MATERIAL } from "../vehicle/constants.ts";
import { TAKES_SCRATCH, type MaterialId } from "../kernel/material-ids.ts";
import { CAR_SPRAY, SPRAY_FACE, sprayFace } from "../vehicle/spray-box.ts";
import { FACE_MASK, FACE_WIDTH, STROKE_BYTES, U0, U1, V0, V1 } from "../vehicle/paint-scrapes.ts";
import { must } from "../kernel/must.test-util.ts";

/** The owner's truck-wreck capture: Fleet, seed 4315555, ramps up, the coupe driven. */
const OWNER_RUN = "scene=fleet&cars=5&seed=41d9a3&smin=10&smax=32&real=0.25&fxd=0.7&squash=0.32&buckle=0.45&ramps=1&car=muscle&loop=0";
const RUN_S = 20;
/** Sub-points across a texel, each way: some fragment anywhere in it draws the stroke there. */
const SUB = 3;
const PAINT_CODES = PRIMER_MATERIAL.filter(([, id]) => TAKES_SCRATCH.has(id)).map(([code]) => code);

/** `geometry`'s per-vertex `name` as built (all 0 without it): copied, so a tear that bares a primer later doesn't move it. */
const builtTone = (geometry: THREE.BufferGeometry, name: string, count: number) => new THREE.BufferAttribute(geometry.hasAttribute(name) ? Float32Array.from(geometry.getAttribute(name).array) : new Float32Array(count), 1);

/** A paint as `paints` raycasts it: `geometry`'s triangles at rest points `rest`, with rest normals `normal`, and its primer codes and fitting tones (`FITTING_ATTRIBUTE`). */
function paintMesh(geometry: THREE.BufferGeometry, rest: THREE.BufferAttribute, normal: THREE.BufferAttribute): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", rest);
  geo.setAttribute("restNormal", normal);
  geo.setAttribute("primer", builtTone(geometry, PRIMER_ATTRIBUTE, rest.count));
  geo.setAttribute("fitting", builtTone(geometry, FITTING_ATTRIBUTE, rest.count));
  geo.setIndex(geometry.index);
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

/** A car's paints as built: its skins (body, lids, door skins) with the rest frame and primer codes their shader reads before a tear bares any, and its bumpers whose finish takes scratches, at rest where they are attached (their trim has no primer; the fittings drawn in it show none). */
function restPaints(car: DeformableCar): THREE.Mesh[] {
  const m = car.lookMeshes();
  const skins = [m.body, m.hood, m.trunk, ...m.doors].map((mesh) => {
    const rest = mesh.geometry.getAttribute(REST_POSITION) as THREE.BufferAttribute | undefined;
    must(rest, `the control: the ${car.style.id}'s paint has its rest frame`);
    return paintMesh(mesh.geometry, rest, mesh.geometry.getAttribute(REST_NORMAL) as THREE.BufferAttribute);
  });
  const bumpers = m.bumpers.filter((mesh) => TAKES_SCRATCH.has((mesh.material as THREE.Material).userData.materialId as MaterialId));
  return [
    ...skins,
    ...bumpers.map((mesh) => paintMesh(mesh.geometry, new THREE.BufferAttribute(restPositions(mesh, mesh.geometry, car.group), 3), new THREE.BufferAttribute(restNormals(mesh, mesh.geometry, car.group), 3))),
  ];
}

/** The paint weight the shader gives primer `p` (`bare-metal.ts`'s `SCRATCH_PAINT_WEIGHT`). */
const paintWeight = (p: number) => PAINT_CODES.reduce((w, code) => w + 1 - THREE.MathUtils.smoothstep(Math.abs(p - code), 0.3, 0.6), 0);

/** Whether some fragment of `paints` that maps to texel (u, v) of `face` (by its rest normal, as `sprayFaceAt`) is paint: a ray down the face's axis through the texel. */
function onPaint(paints: THREE.Mesh[], face: number, u: number, v: number): boolean {
  const [, , fw, fh] = CAR_SPRAY.faces[face]!;
  const { min, max } = CAR_SPRAY;
  const ray = new THREE.Raycaster();
  const at = (i: number, t: number) => min[i]! + t * (max[i]! - min[i]!);
  const uv = new Float64Array(2);
  for (let a = 0; a < SUB; a++) {
    for (let b = 0; b < SUB; b++) {
      const su = (u + (a + 0.5) / SUB) / fw;
      const sv = (v + (b + 0.5) / SUB) / fh;
      const side = face === SPRAY_FACE.left || face === SPRAY_FACE.right;
      const from = side ? new THREE.Vector3(face === SPRAY_FACE.left ? -5 : 5, at(1, sv), at(2, su)) : face === SPRAY_FACE.top ? new THREE.Vector3(at(0, sv), 5, at(2, su)) : new THREE.Vector3(at(0, su), at(1, sv), face === SPRAY_FACE.front ? 5 : -5);
      const dir = side ? new THREE.Vector3(face === SPRAY_FACE.left ? 1 : -1, 0, 0) : face === SPRAY_FACE.top ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, face === SPRAY_FACE.front ? -1 : 1);
      ray.set(from, dir);
      for (const hit of ray.intersectObjects(paints, false)) {
        const g = (hit.object as THREE.Mesh).geometry;
        const { a: ia, b: ib, c: ic } = hit.face!;
        const n = THREE.Triangle.getInterpolatedAttribute(g.getAttribute("restNormal") as THREE.BufferAttribute, ia, ib, ic, hit.barycoord!, new THREE.Vector3());
        if (sprayFace(CAR_SPRAY, hit.point, n, uv) !== face) continue;
        const p = THREE.Triangle.getInterpolatedAttribute(g.getAttribute("primer") as THREE.BufferAttribute, ia, ib, ic, hit.barycoord!, new THREE.Vector4()).x;
        const fitting = THREE.Triangle.getInterpolatedAttribute(g.getAttribute("fitting") as THREE.BufferAttribute, ia, ib, ic, hit.barycoord!, new THREE.Vector4()).x;
        if (paintWeight(p) > 0 && fitting <= FITTED_OVER) return true;
      }
    }
  }
  return false;
}

describe("given the real engine on the owner's truck-wreck Fleet run (seed 4315555, ramps up)", () => {
  let engine: CrashEngine;
  let paints: Map<DeformableCar, THREE.Mesh[]>;
  beforeAll(async () => {
    stubBrowser();
    location.hash = `#${OWNER_RUN}`;
    engine = await bootEngine({ pacer: true });
    paints = new Map(engine["live"]().map((car) => [car, restPaints(car)]));
    runSeconds(engine, RUN_S);
  });
  afterAll(() => {
    engine.dispose();
    setGround(null);
  });

  it(`when it has run ${RUN_S} s, then every end of every car's paint strokes lies where its paint is drawn`, () => {
    const off: string[] = [];
    let ends = 0;
    for (const [car, meshes] of paints) {
      const l = car.scratches.list;
      for (let k = 0; k < car.scratches.count; k++) {
        const s = k * STROKE_BYTES;
        const face = l[s + FACE_WIDTH]! & FACE_MASK;
        for (const [u, v] of [[l[s + U0]!, l[s + V0]!], [l[s + U1]!, l[s + V1]!]] as const) {
          ends++;
          if (!onPaint(meshes, face, u, v)) off.push(`${car.style.id} face ${face} (${u}, ${v})`);
        }
      }
    }
    expect(ends, "the control: the run made strokes").toBeGreaterThanOrEqual(20);
    expect(off, `${off.length} of ${ends} ends off the paint`).toEqual([]);
  });
});
