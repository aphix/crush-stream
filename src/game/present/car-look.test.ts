import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { NO_CAR_PICK } from "../match/look-data.ts";
import { CAR_SPRAY, sprayFace, sprayPlace, SPRAY_FACE } from "../vehicle/spray-box.ts";
import { REST_POSITION } from "../vehicle/car-detail-map.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { PRIMER_ATTRIBUTE } from "../vehicle/constants.ts";
import { paint } from "../vehicle/test-support.ts";
import { sprayCovers, wearCarLook } from "./car-look.ts";
import { SprayBitmap } from "./spray.ts";
import { CAR_SPRAY_DEPTH_BAND, type RestTriangles } from "./spray-depth.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const INK = 4;
/** Samples of a triangle (weights of its corners) inside it on a grid of sixths: a corner or an edge is shared with the next surface. */
const SAMPLES = [1, 2, 3, 4].flatMap((i) => [1, 2, 3, 4].filter((j) => i + j < 6).map((j) => [i / 6, j / 6, (6 - i - j) / 6]));
/** A painted fragment's `primer` lies within this of 0: past it the bare steel, the well, the black trim or the cabin's take over the spray. */
const PAINTED = 0.3;
/** The shader's decode of a depth code: `(code - 1) / DEPTH_STEPS` along the face's axis. */
const DEPTH_STEPS = 254;
/** A ray cast from this far (m) out meets its fragment first when it lands within this of it (m). */
const RAY_START = 3;
const SURFACE_HIT = 0.005;
/** A frame fragment stands this far (m) clear of the door's outline in its face's plane: past the two texels round an outline that read bare (`OUTLINE_KEEP`), 6.7 mm each up a flank. */
const OUTLINE_CLEAR = 0.0175;
/** The skin asked beside the door's outline: within this (m) of the door's box. */
const BESIDE_DOOR = 0.05;
/** `sprayCovers`' left door. */
const LEFT_DOOR = 2;
const AXES = [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
const _uv = new Float64Array(2);

/** A painted point of a part at rest (its rest frame, `sprayPos`), with its normal. */
type Fragment = { p: THREE.Vector3; n: THREE.Vector3 };

/** `mesh`'s painted fragments (primer, where it has one, near 0 at every corner), sampled across each of its triangles in the rest frame. */
function paintedFragments(mesh: THREE.Mesh): Fragment[] {
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
    for (const weights of SAMPLES) out.push({ p: at(rest, corners, weights), n: at(normal, corners, weights).normalize() });
  }
  return out;
}

/** Triangles in the car frame as a mesh, both sides: what a ray from outside the car meets. */
function restMesh({ positions, index }: RestTriangles): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(positions), 3));
  if (index) geometry.setIndex(Array.from(index));
  geometry.computeBoundingBox();
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

/** `face`'s axis length in the layout's box (m): x on the sides, y on the top, z on the ends. */
function axisSpan(face: number): number {
  const axis = face === SPRAY_FACE.left || face === SPRAY_FACE.right ? 0 : face === SPRAY_FACE.top ? 1 : 2;
  return CAR_SPRAY.max[axis]! - CAR_SPRAY.min[axis]!;
}

/** The first hit of a ray from `RAY_START` m out along `direction` through `p`, among `meshes`. */
function firstHit(ray: THREE.Raycaster, meshes: readonly THREE.Mesh[], p: THREE.Vector3, direction: THREE.Vector3): THREE.Intersection | undefined {
  ray.set(p.clone().addScaledVector(direction, RAY_START), direction.clone().negate());
  return ray.intersectObjects([...meshes], false)[0];
}

/** What the rows read off a police car sprayed all over: its paint's spray uniforms, its body, and its covers at rest (the left door's own). */
function sprayedPolice() {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, "police");
  const bitmap = new SprayBitmap(CAR_SPRAY);
  bitmap.load({ texels: new Uint8Array(CAR_SPRAY.w * CAR_SPRAY.h).fill(INK), palette: bitmap.palette });
  wearCarLook(car, NO_CAR_PICK, bitmap);
  const m = car.lookMeshes();
  const uniforms = compileHooks(m.bodyPaint).uniforms;
  const covers = sprayCovers(car).map((cover) => cover.triangles.map(restMesh));
  const body = restMesh({ positions: m.body.geometry.getAttribute(REST_POSITION).array, index: m.body.geometry.index!.array });
  const leftDoor = covers[LEFT_DOOR]!;
  const doorBox = new THREE.Box3();
  for (const mesh of leftDoor) doorBox.union(mesh.geometry.boundingBox!);
  return { car, m, uniforms, leftDoor, all: [body, ...covers.flat()], doorBox, fragments: paintedFragments(m.body) };
}

/** Whether fragment `f` shows its texel's paint, the shader's `sprayTexel` with `uniforms` (the depth map, its band and the torn flags, where it has them). */
function drawsPaint(f: Fragment, uniforms: Record<string, THREE.IUniform>): boolean {
  const face = sprayFace(CAR_SPRAY, f.p, f.n, _uv);
  if (face < 0) return false;
  const map = uniforms.sprayDepth?.value as THREE.DataTexture | undefined;
  if (!map) return true;
  const { data, width } = map.image as { data: Uint8Array; width: number };
  const [fx, fy, fw, fh] = CAR_SPRAY.faces[face]!.map((v) => (v * width) / CAR_SPRAY.w) as [number, number, number, number];
  const texel = (fy + Math.min(fh - 1, Math.floor(_uv[1]! * fh))) * width + fx + Math.min(fw - 1, Math.floor(_uv[0]! * fw));
  const code = data[2 * texel]!;
  const under = ((code - 1) / DEPTH_STEPS - sprayPlace(CAR_SPRAY, face, f.p, _uv)) * axisSpan(face);
  const cover = data[2 * texel + 1]!;
  const torn = uniforms.sprayTorn?.value as THREE.Vector4 | undefined;
  return code === 0 || under <= (uniforms.sprayBand!.value as number) || (torn !== undefined && torn.getComponent(cover - 1) < 0.5);
}

describe("given a police car sprayed all over", () => {
  const police = sprayedPolice();
  const ray = new THREE.Raycaster();
  /** The torn flags its body's draw hands the paint now. */
  const tornNow = (): number[] | undefined => {
    Reflect.apply(police.m.body.onBeforeRender, police.m.body, []);
    return (police.uniforms.sprayTorn?.value as THREE.Vector4 | undefined)?.toArray();
  };

  it("when it is whole, then no fragment of its paint loses its livery, so it draws as it did", () => {
    const torn = tornNow();
    const refused = police.fragments.filter((f) => !drawsPaint(f, police.uniforms) && drawsPaint(f, {}));
    expect(refused.length, `fragments without their livery: ${refused.length}: ${refused.slice(0, 6).map((f) => f.p.toArray().map((v) => v.toFixed(3))).join("; ")}`).toBe(0);
    expect(firstMismatch(torn, [0, 0, 0, 0]), "torn flags of a whole car").toBeUndefined();
  });

  it("when its left door is torn off, then the frame it, its glass and its card covered (jambs, sill, the skin under the door) reads no livery, where the box projection alone smeared it over them", () => {
    police.car["detachPart"](police.car["parts"].find((p) => p.name === "doorL")!, 0);
    const torn = tornNow();
    const frame = police.fragments.filter((f) => underLeftDoor(f));
    const drawn = frame.filter((f) => drawsPaint(f, police.uniforms));
    expect(frame.some((f) => f.n.y > 0.7), "the sill's top, under the glass and the card, is asked").toBeTruthy();
    expect(frame.filter((f) => drawsPaint(f, {})).length, `control: the box projection alone draws livery on the frame's ${frame.length} fragments`).toBeGreaterThan(30);
    expect(drawn.length, `frame fragments drawing livery of ${frame.length}: ${drawn.map((f) => f.p.toArray().map((v) => v.toFixed(3))).join("; ")}`).toBe(0);
    expect(firstMismatch(torn, [0, 0, 1, 0]), "torn flags with the left door off").toBeUndefined();
  });

  it("when its left door is torn off, then the skin round the opening that a ray down its face's axis meets first keeps its livery", () => {
    tornNow();
    const near = police.doorBox.clone().expandByScalar(BESIDE_DOOR);
    const outer = police.fragments.filter((f) => near.containsPoint(f.p) && seenDownAxis(f));
    const refused = outer.filter((f) => !drawsPaint(f, police.uniforms));
    expect(outer.length, `skin fragments asked: ${outer.length}`).toBeGreaterThan(100);
    expect(refused.length, `skin round the opening without its livery: ${refused.length} of ${outer.length}: ${refused.slice(0, 6).map((f) => f.p.toArray().map((v) => v.toFixed(3))).join("; ")}`).toBe(0);
  });

  /** Whether the left door (skin, glass or card) at rest covers `f` along its face's axis, more than the band out, at it and `OUTLINE_CLEAR` round it. */
  function underLeftDoor(f: Fragment): boolean {
    const face = sprayFace(CAR_SPRAY, f.p, f.n, _uv);
    if (face < 0 || f.p.x > 0 || !police.doorBox.containsPoint(new THREE.Vector3(police.doorBox.min.x, f.p.y, f.p.z))) return false;
    const axis = AXES[face]!;
    const spots = [f.p, ...AXES.filter((a) => Math.abs(a.dot(axis)) < 0.5).map((a) => f.p.clone().addScaledVector(a, OUTLINE_CLEAR))];
    return spots.every((p) => {
      const hit = firstHit(ray, police.all, p, axis);
      return hit !== undefined && police.leftDoor.includes(hit.object as THREE.Mesh) && RAY_START - hit.distance > CAR_SPRAY_DEPTH_BAND;
    });
  }

  /** Whether a ray down `f`'s face's axis meets it first on the whole car. */
  function seenDownAxis(f: Fragment): boolean {
    const face = sprayFace(CAR_SPRAY, f.p, f.n, _uv);
    if (face < 0) return false;
    const hit = firstHit(ray, police.all, f.p, AXES[face]!);
    return hit !== undefined && Math.abs(RAY_START - hit.distance) < SURFACE_HIT;
  }
});
