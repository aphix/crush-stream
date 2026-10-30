import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { depthCode, PERSON_SPRAY, type SpraySurface } from "../match/look-data.ts";
import { carSprayLayout, SPRAY_FACE, sprayPlace, type SprayLayout } from "../vehicle/spray-box.ts";
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
/** A car's depth map: `CAR_SPRAY`'s faces at 4x its side (5 mm texels on the flanks), so a door's jamb under its outline is told from the belt beside it. */
const CAR_DEPTH = carSprayLayout(1024);
/** A car's band (m): over half an end face's depth step (4.7 m / 254), under the 13 mm a door's seam lies inboard of its skin. */
export const CAR_SPRAY_DEPTH_BAND = 0.01;
/** A gap in the covers seen from above narrower than twice this (texels) is closed: the 1-3 cm slot between a door's skin and its glass, over the sill. */
const GAP_CLOSE = 3;
/** Texels round a cover's outline that read bare: the skin beside a door's or a lid's outline keeps its paint where its texel straddles the outline. */
const OUTLINE_KEEP = 2;

/** A cover's triangles in the car frame: `positions` xyz each, `index` (null: every three vertices). */
export type RestTriangles = { readonly positions: ArrayLike<number>; readonly index: ArrayLike<number> | null };
/** One part that comes off over a car's skin, with what rides it (a door's glass and card); `flat` a lid, lying along the car. */
export type SprayCover = { readonly triangles: readonly RestTriangles[]; readonly flat: boolean };

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

/**
 * Per texel of `layout`'s faces, the depth (`depthCode`) and part (`partOf` its triangle's first vertex) of the outermost of the triangles
 * `index` of the vertices `rest` (xyz each); 0 where none is. Not `exact` (the dummy's), a triangle covers `EDGE_SLACK` past its edges
 * and a bare texel beside a surface takes it; `exact` (a car's covers), a texel is covered only where its centre is.
 */
function spraySurfaceOf(layout: SprayLayout, rest: ArrayLike<number>, index: ArrayLike<number>, partOf: (vertex: number) => number, exact = false): SpraySurface {
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
      rasterise(surface, w, rect, { corner, depth, part: partOf(index[t]!) }, exact ? 0 : EDGE_SLACK);
    }
    if (!exact) spreadToBareNeighbours(surface, w, rect);
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

/** `texture` sampled nearest: a code is a depth, never blended with its neighbour's. */
function nearest(texture: THREE.DataTexture): THREE.DataTexture {
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/** `personSpraySurface`'s depths for the dummy's shader. Shared, never disposed. */
export const personSprayDepthTexture = once(() => nearest(new THREE.DataTexture(personSpraySurface().depth, PERSON_SPRAY.w, PERSON_SPRAY.h, THREE.RedFormat, THREE.UnsignedByteType)));

/** The outermost of `covers` per texel of `CAR_DEPTH` and which (its index + 1); the flat ones left out with `flat` false. */
function outermostCover(covers: readonly SprayCover[], flat: boolean): SpraySurface {
  const rest: number[] = [];
  const index: number[] = [];
  const coverOf: number[] = [];
  for (const [k, cover] of covers.entries()) {
    if (cover.flat && !flat) continue;
    for (const { positions, index: own } of cover.triangles) {
      const base = rest.length / 3;
      for (let i = 0; i < positions.length; i++) rest.push(positions[i]!);
      for (let v = 0; v < positions.length / 3; v++) coverOf.push(k + 1);
      if (own) for (let i = 0; i < own.length; i++) index.push(base + own[i]!);
      else for (let v = 0; v < positions.length / 3; v++) index.push(base + v);
    }
  }
  return spraySurfaceOf(CAR_DEPTH, rest, index, (v) => coverOf[v]!, true);
}

/** The car's covers per texel: on the nose and tail no flat one, as a lid lies along the car, so there it stands only in front of skin it never covers (the deck before the boot lid). */
function carSpraySurface(covers: readonly SprayCover[]): SpraySurface {
  const surface = outermostCover(covers, true);
  const ends = outermostCover(covers, false);
  for (const face of [SPRAY_FACE.front, SPRAY_FACE.back]) {
    const [fx, fy, fw, fh] = CAR_DEPTH.faces[face]!;
    for (let y = fy; y < fy + fh; y++) {
      const row = y * CAR_DEPTH.w + fx;
      surface.depth.set(ends.depth.subarray(row, row + fw), row);
      surface.part.set(ends.part.subarray(row, row + fw), row);
    }
  }
  fillGapsAcross(surface, CAR_DEPTH.w, CAR_DEPTH.faces[SPRAY_FACE.top]!);
  for (let pass = 0; pass < OUTLINE_KEEP; pass++) for (const rect of CAR_DEPTH.faces) bareOutlines(surface, CAR_DEPTH.w, rect);
  return surface;
}

/** In each column of `rect` (the roof face's: along x at one z), a bare run of at most `2 * GAP_CLOSE` texels between two covered ones takes the deeper of the two. */
function fillGapsAcross(surface: SpraySurface, width: number, rect: Rect): void {
  const [fx, fy, fw, fh] = rect;
  for (let x = fx; x < fx + fw; x++) {
    let last = -1;
    for (let y = fy; y < fy + fh; y++) {
      const at = y * width + x;
      if (surface.depth[at] === 0) continue;
      if (last >= 0 && y - last > 1 && y - last <= 2 * GAP_CLOSE + 1) {
        const from = last * width + x;
        const deeper = surface.depth[from]! < surface.depth[at]! ? from : at;
        for (let g = last + 1; g < y; g++) {
          surface.depth[g * width + x] = surface.depth[deeper]!;
          surface.part[g * width + x] = surface.part[deeper]!;
        }
      }
      last = y;
    }
  }
}

/** Every texel of `rect` beside a bare one (of its 8 neighbours) goes bare. */
function bareOutlines(surface: SpraySurface, width: number, rect: Rect): void {
  const [fx, fy, fw, fh] = rect;
  const before = surface.depth.slice();
  for (let y = fy; y < fy + fh; y++) {
    for (let x = fx; x < fx + fw; x++) {
      for (let ny = Math.max(fy, y - 1); ny <= Math.min(fy + fh - 1, y + 1); ny++) {
        for (let nx = Math.max(fx, x - 1); nx <= Math.min(fx + fw - 1, x + 1); nx++) if (before[ny * width + nx] === 0) surface.depth[y * width + x] = 0;
      }
    }
  }
}

/**
 * Up to 4 `covers` (doors, lids) of a car at rest as the car paint's depth map: per texel the outermost one's depth and which it is
 * (index + 1), so a fragment under a cover the car has lost (a jamb, a sill, the bay's rim) draws no paint (`SprayDepth.torn`).
 */
export function carSprayDepthTexture(covers: readonly SprayCover[]): THREE.DataTexture {
  const { depth, part } = carSpraySurface(covers);
  const texels = new Uint8Array(depth.length * 2);
  for (let i = 0; i < depth.length; i++) {
    texels[2 * i] = depth[i]!;
    texels[2 * i + 1] = part[i]!;
  }
  return nearest(new THREE.DataTexture(texels, CAR_DEPTH.w, CAR_DEPTH.h, THREE.RGFormat, THREE.UnsignedByteType));
}
