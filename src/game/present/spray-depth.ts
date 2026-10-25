import * as THREE from "three";
import { once } from "../kernel/scalar.ts";
import { depthCode, PERSON_SPRAY, sprayPlace } from "../match/look-data.ts";
import { bodyIndex } from "./dummy-bodies.ts";
import { dummyGeometry } from "./dummy-skin.ts";

/**
 * Which surface of the dummy a texel of its spray belongs to: the outermost one along the face's axis, the one a ray down that
 * axis meets first. The box projection (`sprayFace`) gives every surface facing the same way at an (x, y) the same texels, so the
 * shader draws a texel's paint only on fragments at that depth or out past it (`sprayDraws`), and a puff reaches only texels whose surface is near its own.
 */

/** A texel centre this far (barycentric) outside a triangle's edge still counts as covered, so a sliver of surface is not a hole in the map. */
const EDGE_SLACK = 0.1;

/** A texel's depth code (`depthCode`) of the outermost body triangle over it, per face, 0 where none is; bare texels beside a surface take its neighbour's. */
function buildPersonSprayDepth(): Uint8Array {
  const { w, h } = PERSON_SPRAY;
  const out = new Uint8Array(w * h);
  const rest = dummyGeometry().getAttribute("position");
  const corner: [Float64Array, Float64Array, Float64Array] = [new Float64Array(2), new Float64Array(2), new Float64Array(2)];
  const depth: [number, number, number] = [0, 0, 0];
  const index = bodyIndex();
  for (const rect of PERSON_SPRAY.faces) {
    const face = PERSON_SPRAY.faces.indexOf(rect);
    const [fx, fy, fw, fh] = rect;
    for (let t = 0; t < index.length; t += 3) {
      for (let c = 0; c < 3; c++) {
        const v = index[t + c]!;
        depth[c] = sprayPlace(PERSON_SPRAY, face, rest.getX(v), rest.getY(v), rest.getZ(v), corner[c]!);
        corner[c]![0] = fx + corner[c]![0]! * fw;
        corner[c]![1] = fy + corner[c]![1]! * fh;
      }
      rasterise(out, w, rect, corner, depth);
    }
    spreadToBareNeighbours(out, w, rect);
  }
  return out;
}

/** The triangle `corner` (texel coordinates) with `depth` at its corners into `out`'s texels of `face` it covers, keeping the outer one. */
function rasterise(out: Uint8Array, width: number, face: readonly [number, number, number, number], corner: readonly [Float64Array, Float64Array, Float64Array], depth: readonly [number, number, number]): void {
  const [fx, fy, fw, fh] = face;
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
      if (wa < -EDGE_SLACK || wb < -EDGE_SLACK || wc < -EDGE_SLACK) continue;
      const here = Math.min(outermost, Math.max(nearest, wa * depth[0] + wb * depth[1] + wc * depth[2]));
      out[y * width + x] = Math.max(out[y * width + x]!, depthCode(here));
    }
  }
}

/** Every bare texel of `face` with a surface in its 8 neighbours takes the outermost one's depth: a silhouette texel's centre can miss the surface its fragments sit on. */
function spreadToBareNeighbours(out: Uint8Array, width: number, face: readonly [number, number, number, number]): void {
  const [fx, fy, fw, fh] = face;
  const before = out.slice();
  for (let y = fy; y < fy + fh; y++) {
    for (let x = fx; x < fx + fw; x++) {
      if (before[y * width + x] !== 0) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < fx || nx >= fx + fw || ny < fy || ny >= fy + fh) continue;
          out[y * width + x] = Math.max(out[y * width + x]!, before[ny * width + nx]!);
        }
      }
    }
  }
}

/** The dummy's outermost surface per spray texel (`depthCode` bytes), built on first use from its body at rest. */
export const personSprayDepth = once(buildPersonSprayDepth);

/** `personSprayDepth` as the texture the shader samples (nearest: a code is a depth, never blended with its neighbour's). Shared, never disposed. */
export const personSprayDepthTexture = once((): THREE.DataTexture => {
  const texture = new THREE.DataTexture(personSprayDepth(), PERSON_SPRAY.w, PERSON_SPRAY.h, THREE.RedFormat, THREE.UnsignedByteType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
});
