import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { CAR_SPRAY, NO_CAR_PICK, SPRAY_FACE, sprayFace, sprayPlace } from "../match/look-data.ts";
import { REST_POSITION } from "../vehicle/car-detail-map.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { PRIMER_ATTRIBUTE } from "../vehicle/constants.ts";
import { paint } from "../vehicle/test-support.ts";
import { wearCarLook } from "./car-look.ts";
import { SprayBitmap } from "./spray.ts";
import { OUTLINE_KEEP } from "./spray-depth.ts";

const INK = 4;
/** Samples of a triangle (weights of its corners) inside it, a corner or an edge being shared with the next surface: on a grid of sixths (the frame's few triangles), or the middle and half way to each corner (the whole skin's). */
const FINE_SAMPLES = [1, 2, 3, 4].flatMap((i) => [1, 2, 3, 4].filter((j) => i + j < 6).map((j) => [i / 6, j / 6, (6 - i - j) / 6]));
const COARSE_SAMPLES = [[1 / 3, 1 / 3, 1 / 3], [2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]];
/** A painted fragment's `primer` lies within this of 0: past it the bare steel, the well, the black trim or the cabin's take over the spray. */
const PAINTED = 0.3;
/** The shader's decode of a depth code: `(code - 1) / DEPTH_STEPS` along the face's axis. */
const DEPTH_STEPS = 254;
/** A ray cast from this far (m) out meets its fragment first when it lands within this of it (m). */
const RAY_START = 3;
const SURFACE_HIT = 0.005;
/** A frame fragment stands this far (m) clear of the door's outline in its face's plane: past the texels round an outline that keep the outer skin's depth (`OUTLINE_KEEP`, 6.7 mm each up a flank). */
const OUTLINE_CLEAR = OUTLINE_KEEP * 0.007;
const AXES = [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const _uv = new Float64Array(2);

/** A painted point of a part at rest (its rest frame, `sprayPos`), with its normal. */
type Fragment = { p: THREE.Vector3; n: THREE.Vector3 };

/** `mesh`'s painted fragments (primer, where it has one, near 0 at every corner), sampled at `samples` across each of its triangles in the rest frame. */
function paintedFragments(mesh: THREE.Mesh, samples: readonly number[][]): Fragment[] {
  const geometry = mesh.geometry;
  const rest = geometry.getAttribute(REST_POSITION);
  const normal = geometry.getAttribute("sprayNrm");
  const primer = geometry.hasAttribute(PRIMER_ATTRIBUTE) ? geometry.getAttribute(PRIMER_ATTRIBUTE) : null;
  const index = geometry.index!;
  const out: Fragment[] = [];
  const at = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, corners: readonly number[], weights: readonly number[]): THREE.Vector3 =>
    corners.reduce((sum, v, k) => sum.addScaledVector(new THREE.Vector3().fromBufferAttribute(attribute, v), weights[k]!), new THREE.Vector3());
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (primer && corners.some((v) => Math.abs(primer.getX(v)) > PAINTED)) continue;
    for (const weights of samples) out.push({ p: at(rest, corners, weights), n: at(normal, corners, weights).normalize() });
  }
  return out;
}

/** `mesh` drawn in its rest frame, both sides: what a ray from outside the car meets. */
function restMesh(mesh: THREE.Mesh): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", mesh.geometry.getAttribute(REST_POSITION));
  geometry.setIndex(mesh.geometry.index);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

/** The index of the texel at (u, v) across `face` of a map `side` texels square (the faces scale with it), as the shader's nearest sampling reads it. */
function texelOf(face: number, uv: Float64Array, side: number): number {
  const [fx, fy, fw, fh] = CAR_SPRAY.faces[face]!.map((v) => (v * side) / CAR_SPRAY.w) as [number, number, number, number];
  return (fy + Math.min(fh - 1, Math.floor(uv[1]! * fh))) * side + fx + Math.min(fw - 1, Math.floor(uv[0]! * fw));
}

/** `face`'s axis length in the layout's box (m): x on the sides, y on the top, z on the ends. */
function axisSpan(face: number): number {
  const axis = face === SPRAY_FACE.left || face === SPRAY_FACE.right ? 0 : face === SPRAY_FACE.top ? 1 : 2;
  return CAR_SPRAY.max[axis]! - CAR_SPRAY.min[axis]!;
}

/** Whether fragment `f` shows its texel's paint, the shader's `sprayTexel`: on a painted face and not more than `band` m under the texel's outermost surface (`depth`, null: none). */
function drawsPaint(f: Fragment, depth: Uint8Array | null, band = 0): boolean {
  const face = sprayFace(CAR_SPRAY, f.p.x, f.p.y, f.p.z, f.n.x, f.n.y, f.n.z, _uv);
  if (face < 0) return false;
  const code = depth?.[texelOf(face, _uv, Math.sqrt(depth.length))] ?? 0;
  return code === 0 || sprayPlace(CAR_SPRAY, face, f.p.x, f.p.y, f.p.z, _uv) >= (code - 1) / DEPTH_STEPS - band / axisSpan(face);
}

/** The first hit of a ray from `RAY_START` m out along `axis` through `p`, among `meshes`. */
function firstHit(ray: THREE.Raycaster, meshes: readonly THREE.Mesh[], p: THREE.Vector3, axis: THREE.Vector3): THREE.Intersection | undefined {
  ray.set(p.clone().addScaledVector(axis, RAY_START), axis.clone().negate());
  return ray.intersectObjects([...meshes], false)[0];
}

/** The first hits of rays down face `face`'s axis through `f` and `OUTLINE_CLEAR` m from it each way across the face. */
function hitsAround(ray: THREE.Raycaster, meshes: readonly THREE.Mesh[], f: Fragment, face: number): (THREE.Intersection | undefined)[] {
  const axis = AXES[face]!;
  const across = AXES.filter((a) => Math.abs(a.dot(axis)) < 0.5);
  return [f.p, ...across.map((a) => f.p.clone().addScaledVector(a, OUTLINE_CLEAR))].map((p) => firstHit(ray, meshes, p, axis));
}

describe("given a police car sprayed all over, its left door torn off", () => {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "police");
  const bitmap = new SprayBitmap(CAR_SPRAY);
  bitmap.load({ texels: new Uint8Array(CAR_SPRAY.w * CAR_SPRAY.h).fill(INK), palette: bitmap.palette });
  wearCarLook(car, NO_CAR_PICK, bitmap);
  const doorL = car["parts"].find((p) => p.name === "doorL")!;
  car["detachPart"](doorL, 0);
  const m = car.lookMeshes();
  const painted = [m.body, m.hood, m.trunk, ...m.doors];
  const rest = painted.map(restMesh);
  const doorRest = rest[3]!;
  const uniforms = compileHooks(m.bodyPaint).uniforms;
  const depthMap = uniforms.sprayDepth?.value as THREE.DataTexture | undefined;
  const depth = depthMap ? (depthMap.image.data as Uint8Array) : null;
  const band = (uniforms.sprayBand?.value as number | undefined) ?? 0;
  const ray = new THREE.Raycaster();

  it("when the frame the door covered is drawn, then its jambs, sill and skin under the door read no livery, where the box projection alone smeared it over them", () => {
    assert.ok(depth !== null, "the body paint's spray samples the car's depth map");
    const underDoor = (f: Fragment): boolean => {
      const face = sprayFace(CAR_SPRAY, f.p.x, f.p.y, f.p.z, f.n.x, f.n.y, f.n.z, _uv);
      return face >= 0 && f.p.x < 0 && hitsAround(ray, rest, f, face).every((hit) => hit?.object === doorRest && RAY_START - hit.distance > band);
    };
    const frame = paintedFragments(m.body, FINE_SAMPLES).filter(underDoor);
    const smeared = frame.filter((f) => drawsPaint(f, null)).length;
    const drawn = frame.filter((f) => drawsPaint(f, depth, band));
    assert.ok(smeared > 30, `control: the box projection alone draws livery on ${smeared} of the frame's ${frame.length} fragments`);
    assert.equal(drawn.length, 0, `frame fragments drawing livery of ${frame.length}: ${drawn.map((f) => f.p.toArray().map((v) => v.toFixed(3))).join("; ")}`);
  });

  it("when its outer skin is drawn, then every fragment a ray down its face's axis meets first, clear of another panel's outline, draws its livery as before", () => {
    let visible = 0;
    const refused: string[] = [];
    for (const [k, mesh] of painted.entries()) {
      for (const f of paintedFragments(mesh, COARSE_SAMPLES)) {
        const face = sprayFace(CAR_SPRAY, f.p.x, f.p.y, f.p.z, f.n.x, f.n.y, f.n.z, _uv);
        if (face < 0) continue;
        const [hit, ...around] = hitsAround(ray, rest, f, face);
        if (!hit || Math.abs(hit.distance - RAY_START) > SURFACE_HIT || around.some((h) => h?.object !== rest[k])) continue;
        visible++;
        if (!drawsPaint(f, depth, band)) refused.push(`${k}:${face}@${f.p.toArray().map((v) => v.toFixed(3))}`);
      }
    }
    assert.ok(visible > 1000, `outer fragments asked: ${visible}`);
    assert.equal(refused.length, 0, `outer fragments refused: ${refused.length} of ${visible}: ${refused.slice(0, 12).join(", ")}`);
  });
});
