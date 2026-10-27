import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { carSprayLayout, depthCode, PERSON_SPRAY, sprayPlace, type SprayLayout, type SpraySurface } from "../match/look-data.ts";
import { REST_POSITION } from "../vehicle/car-detail-map.ts";
import { BONES_ATTRIBUTE } from "./dummy-rig.ts";
import { PARTS } from "./ragdoll-body.ts";
import { bodyIndex } from "./dummy-bodies.ts";
import { dummyGeometry } from "./dummy-skin.ts";

/**
 * Which surface of a body a texel of its spray belongs to: the outermost one along the face's axis, the one a ray down that
 * axis meets first, and the body part that surface is. The box projection (`sprayFace`) gives every surface facing the same way at
 * an (x, y) the same texels, so the shader draws a texel's paint only on fragments at that depth or out past it, and (the dummy's
 * puffs) a puff paints only texels of the part it landed on.
 */

/** A texel centre this far (barycentric) outside a triangle's edge still counts as covered, so a sliver of surface is not a hole in the map. */
const EDGE_SLACK = 0.1;
/** A car's: none, so a panel's outline (a door's top over the belt, the roof's edge over the side glass) never spreads over the skin beside it. */
const CAR_EDGE_SLACK = 0;
/** A car's depth map: `CAR_SPRAY`'s faces at 4x its side (5 mm texels on the flanks), so a door's jamb under its outline is told from the belt beside it. */
const CAR_DEPTH = carSprayLayout(1024);
/** A car's band (m): over half an end face's depth step (4.7 m / 254), under the 13 mm a door's seam lies inboard of its skin. */
export const CAR_SPRAY_DEPTH_BAND = 0.01;
/** Texels round a panel's outline that keep the shallowest surface near them: one left dark specks on the roof rail over the side glass. */
export const OUTLINE_KEEP = 2;

type Rect = readonly [number, number, number, number];
type Triangle = { readonly corner: readonly [Float64Array, Float64Array, Float64Array]; readonly depth: readonly [number, number, number]; readonly part: number };

/** The part (a `PARTS` index + 1) vertex `vertex` of the dummy rides: the bone it is weighted to most. */
export function personSprayPartOf(vertex: number): number {
  const bones = dummyGeometry().getAttribute(BONES_ATTRIBUTE);
  return (bones.getZ(vertex) < 0.5 ? bones.getX(vertex) : bones.getY(vertex)) + 1;
}

/** The part (an index + 1) standing where `part` does across the body's left-right plane: an arm's or a leg's other one; the torso and the head are their own. */
export function personSprayMirrorPart(part: number): number {
  const [x, y, z] = PARTS[part - 1]!.c;
  return PARTS.findIndex((other) => other.c[0] === -x && other.c[1] === y && other.c[2] === z) + 1;
}

/** The dummy's body at rest: per texel of `PERSON_SPRAY`, its outermost triangle's depth and part. */
function buildPersonSpraySurface(): SpraySurface {
  return spraySurfaceOf(PERSON_SPRAY, dummyGeometry().getAttribute("position").array, bodyIndex(), personSprayPartOf);
}

/** Per texel of `layout`'s faces, the depth (`depthCode`) and part (`partOf` its triangle's first vertex) of the outermost of the triangles `index` of the vertices `rest` (xyz each), each covering `slack` past its edges; 0 where none is. */
function spraySurfaceOf(layout: SprayLayout, rest: ArrayLike<number>, index: ArrayLike<number>, partOf: (vertex: number) => number, slack = EDGE_SLACK): SpraySurface {
  const { w, h } = layout;
  const surface = { depth: new Uint8Array(w * h), part: new Uint8Array(w * h) };
  const corner: [Float64Array, Float64Array, Float64Array] = [new Float64Array(2), new Float64Array(2), new Float64Array(2)];
  const depth: [number, number, number] = [0, 0, 0];
  for (const [face, rect] of layout.faces.entries()) {
    const [fx, fy, fw, fh] = rect;
    for (let t = 0; t < index.length; t += 3) {
      for (let c = 0; c < 3; c++) {
        const v = index[t + c]!;
        depth[c] = sprayPlace(layout, face, rest[3 * v]!, rest[3 * v + 1]!, rest[3 * v + 2]!, corner[c]!);
        corner[c]![0] = fx + corner[c]![0]! * fw;
        corner[c]![1] = fy + corner[c]![1]! * fh;
      }
      rasterise(surface, w, rect, { corner, depth, part: partOf(index[t]!) }, slack);
    }
    spreadToBareNeighbours(surface, w, rect);
  }
  return surface;
}

/** The triangle's texels of `rect` into `surface`, keeping the outer surface where two overlap. */
function rasterise(surface: SpraySurface, width: number, rect: Rect, { corner, depth, part }: Triangle, slack: number): void {
  const [fx, fy, fw, fh] = rect;
  const [a, b, c] = corner;
  const area = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (b[1]! - a[1]!);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(fx, Math.floor(Math.min(a[0]!, b[0]!, c[0]!)));
  const x1 = Math.min(fx + fw - 1, Math.floor(Math.max(a[0]!, b[0]!, c[0]!)));
  const y0 = Math.max(fy, Math.floor(Math.min(a[1]!, b[1]!, c[1]!)));
  const y1 = Math.min(fy + fh - 1, Math.floor(Math.max(a[1]!, b[1]!, c[1]!)));
  const nearest = Math.min(...depth);
  const outermost = Math.max(...depth);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const wb = ((px - a[0]!) * (c[1]! - a[1]!) - (c[0]! - a[0]!) * (py - a[1]!)) / area;
      const wc = ((b[0]! - a[0]!) * (py - a[1]!) - (px - a[0]!) * (b[1]! - a[1]!)) / area;
      const wa = 1 - wb - wc;
      if (wa < -slack || wb < -slack || wc < -slack) continue;
      const code = depthCode(Math.min(outermost, Math.max(nearest, wa * depth[0] + wb * depth[1] + wc * depth[2])));
      if (code <= surface.depth[y * width + x]!) continue;
      surface.depth[y * width + x] = code;
      surface.part[y * width + x] = part;
    }
  }
}

/** Every bare texel of `rect` with a surface in its 8 neighbours takes the outermost one's depth and part: a silhouette texel's centre can miss the surface its fragments sit on. */
function spreadToBareNeighbours(surface: SpraySurface, width: number, rect: Rect): void {
  const [fx, fy, fw, fh] = rect;
  const before = { depth: surface.depth.slice(), part: surface.part.slice() };
  for (let y = fy; y < fy + fh; y++) {
    for (let x = fx; x < fx + fw; x++) {
      if (before.depth[y * width + x] !== 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < fx || nx >= fx + fw || ny < fy || ny >= fy + fh || before.depth[ny * width + nx]! <= surface.depth[y * width + x]!) continue;
          surface.depth[y * width + x] = before.depth[ny * width + nx]!;
          surface.part[y * width + x] = before.part[ny * width + nx]!;
        }
      }
    }
  }
}

/** The dummy's outermost surface per spray texel, built on first use from its body at rest. */
export const personSpraySurface = once(buildPersonSpraySurface);

/** The depths of `surface` (of `layout`) as the texture the shader samples (nearest: a code is a depth, never blended with its neighbour's). */
function sprayDepthTexture(layout: SprayLayout, surface: SpraySurface): THREE.DataTexture {
  const texture = new THREE.DataTexture(surface.depth, layout.w, layout.h, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** `personSpraySurface`'s depths for the dummy's shader. Shared, never disposed. */
export const personSprayDepthTexture = once(() => sprayDepthTexture(PERSON_SPRAY, personSpraySurface()));

/** A car's outermost surface per texel of `CAR_SPRAY`, from the rest frames (`ensureRestFrame`) of its painted `meshes` (body, lids, doors), all one part. */
function carSpraySurface(meshes: readonly THREE.Mesh[]): SpraySurface {
  const rest: number[] = [];
  const index: number[] = [];
  for (const mesh of meshes) {
    const base = rest.length / 3;
    const positions = mesh.geometry.getAttribute(REST_POSITION).array;
    for (const value of positions) rest.push(value);
    const own = mesh.geometry.index;
    if (own) for (const v of own.array) index.push(base + v);
    else for (let v = 0; v < positions.length / 3; v++) index.push(base + v);
  }
  const surface = spraySurfaceOf(CAR_DEPTH, rest, index, () => 1, CAR_EDGE_SLACK);
  for (let pass = 0; pass < OUTLINE_KEEP; pass++) for (const rect of CAR_DEPTH.faces) keepShallowestNeighbour(surface, CAR_DEPTH.w, rect);
  return surface;
}

/** Every surfaced texel of `rect` takes the shallowest surface among it and its 8 neighbours: a fragment beside a panel's outline, its texel straddling a panel further out, keeps its paint. */
function keepShallowestNeighbour(surface: SpraySurface, width: number, rect: Rect): void {
  const [fx, fy, fw, fh] = rect;
  const before = surface.depth.slice();
  for (let y = fy; y < fy + fh; y++) {
    for (let x = fx; x < fx + fw; x++) {
      for (let ny = Math.max(fy, y - 1); ny <= Math.min(fy + fh - 1, y + 1); ny++) {
        for (let nx = Math.max(fx, x - 1); nx <= Math.min(fx + fw - 1, x + 1); nx++) {
          const code = before[ny * width + nx]!;
          if (code !== 0 && code < surface.depth[y * width + x]!) surface.depth[y * width + x] = code;
        }
      }
    }
  }
}

/** `carSpraySurface`'s depths for the car paint's shader: under a lid or a door (a jamb, a sill, the bay's rim) a torn one bares, a fragment draws no paint. */
export function carSprayDepthTexture(meshes: readonly THREE.Mesh[]): THREE.DataTexture {
  return sprayDepthTexture(CAR_DEPTH, carSpraySurface(meshes));
}
