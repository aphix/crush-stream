import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { PERSON_SPRAY, SPRAY_DEPTH_BAND, type SpraySurface } from "../match/look-data.ts";
import { SPRAY_FACE, sprayFace, sprayPlace } from "../vehicle/spray-box.ts";
import { BODY_VERTICES, bodyIndex } from "./dummy-bodies.ts";
import { BARE, BELTED, BONES_ATTRIBUTE, BUILD, isDrawn, KINDS_ATTRIBUTE, SHORT_SLEEVES, SNEAKERS } from "./dummy-rig.ts";
import { dummyGeometry } from "./dummy-skin.ts";
import { SprayBitmap } from "./spray.ts";
import { personSprayMirrorPart, personSpraySurface } from "./spray-depth.ts";

/** A man in a tee, bare-headed (the garage's standing driver): the triangles his slot draws. */
const TEE = BUILD.MAN | SHORT_SLEEVES | BELTED | SNEAKERS | BARE;
/** `PARTS` indices: the left forearm and its hand stand at -x, the right at +x; the torso and the head. */
const TORSO = 0;
const HEAD = 1;
const LEFT_HAND = 3;
const RIGHT_HAND = 5;
const HANDS = [LEFT_HAND, RIGHT_HAND];
/** Above the hands' height (m), under the elbows'. */
const HAND_TOP = 0.9;
const INK = 4;
/** A can the size of a hand (m): its puff reaches the thigh and hip beside the hand and behind it. */
const RADIUS = 0.12;
/** Samples of a triangle (weights of its corners): the corners, the edge midpoints and the middle. */
const SAMPLES = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3]] as const;
const _uv = new Float64Array(2);
/** The shader's decode of a depth code: `(code - 1) / DEPTH_STEPS` along the face's axis. */
const DEPTH_STEPS = 254;
/** The ray row asks every this-many'th vertex of the body, casts from this far (m) out, and takes a hit within a texel's edge (m) of the vertex for the vertex. */
const EVERY_NTH_VERTEX = 7;
const RAY_START = 1;
const TEXEL_EDGE = 0.01;
/** At most this share of the fragments asked may sit on a texel's edge, where its centre is on the neighbour's surface. */
const EDGE_SHARE = 0.02;

/** A point on the drawn dummy at rest with its normal, the first bone its triangle rides and whether it lies on a garment's shell, not the body. */
type Fragment = { p: THREE.Vector3; n: THREE.Vector3; part: number; onWear: boolean };

/** Every fragment the tee-wearing man draws, sampled across each of his triangles. */
function drawnFragments(): Fragment[] {
  const geometry = dummyGeometry();
  const rest = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const kinds = geometry.getAttribute(KINDS_ATTRIBUTE);
  const bones = geometry.getAttribute(BONES_ATTRIBUTE);
  const index = geometry.index!;
  const out: Fragment[] = [];
  const at = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, corners: readonly number[], weights: readonly number[]): THREE.Vector3 =>
    corners.reduce((sum, v, k) => sum.addScaledVector(new THREE.Vector3().fromBufferAttribute(attribute, v), weights[k]!), new THREE.Vector3());
  const ridden = (v: number): number => (bones.getZ(v) < 0.5 ? bones.getX(v) : bones.getY(v));
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (!isDrawn(kinds.getY(corners[0]!), TEE)) continue;
    for (const weights of SAMPLES) {
      out.push({ p: at(rest, corners, weights), n: at(normal, corners, weights).normalize(), part: ridden(corners[0]!), onWear: corners[0]! >= BODY_VERTICES });
    }
  }
  return out;
}

/** The fragment of `part` furthest along `direction` (a unit axis) among those facing it squarely and under `below` m: where a ray from that side lands. */
function outermost(fragments: readonly Fragment[], part: number, direction: THREE.Vector3, below = HAND_TOP): Fragment {
  const facing = fragments.filter((f) => f.part === part && !f.onWear && f.n.dot(direction) > 0.9 && f.p.y < below);
  return facing.reduce((best, f) => (f.p.dot(direction) > best.p.dot(direction) ? f : best));
}

/** `face`'s axis length in the layout's box (m): x on the sides, y on the top, z on the ends. */
function axisSpan(face: number): number {
  const axis = face === SPRAY_FACE.left || face === SPRAY_FACE.right ? 0 : face === SPRAY_FACE.top ? 1 : 2;
  return PERSON_SPRAY.max[axis]! - PERSON_SPRAY.min[axis]!;
}

/** The index of the texel at (u, v) across `face`, as the shader's nearest sampling reads it. */
function texelOf(face: number, uv: Float64Array): number {
  const [fx, fy, fw, fh] = PERSON_SPRAY.faces[face]!;
  return (fy + Math.min(fh - 1, Math.floor(uv[1]! * fh))) * PERSON_SPRAY.w + fx + Math.min(fw - 1, Math.floor(uv[0]! * fw));
}

/** Whether fragment `f` shows its texel's paint, the shader's rule: not under the texel's outermost surface (`surface`; null: any face's texel draws). */
function drawsPaint(f: Fragment, surface: SpraySurface | null): boolean {
  const face = sprayFace(PERSON_SPRAY, f.p.x, f.p.y, f.p.z, f.n.x, f.n.y, f.n.z, _uv);
  if (face < 0) return false;
  const code = surface?.depth[texelOf(face, _uv)] ?? 0;
  return code === 0 || sprayPlace(PERSON_SPRAY, face, f.p.x, f.p.y, f.p.z, _uv) >= (code - 1) / DEPTH_STEPS - SPRAY_DEPTH_BAND / axisSpan(face);
}

/** The fragments that draw paint after the can's puffs, each landing on a fragment (the second, a mirror's, one of the other flank), given the `surface` map. */
function paintedAfter(fragments: readonly Fragment[], puffs: readonly Fragment[], surface: SpraySurface | null): Fragment[] {
  const bitmap = new SprayBitmap(PERSON_SPRAY);
  for (const puff of puffs) bitmap.spray(puff.p, puff.n, RADIUS, INK, () => 0, surface, puff.part + 1);
  const painted = fragments.filter((f) => {
    const face = sprayFace(PERSON_SPRAY, f.p.x, f.p.y, f.p.z, f.n.x, f.n.y, f.n.z, _uv);
    return face >= 0 && bitmap.texels[texelOf(face, _uv)] !== 0 && drawsPaint(f, surface);
  });
  bitmap.dispose();
  return painted;
}

const partsOf = (fragments: readonly Fragment[]): number[] => [...new Set(fragments.map((f) => f.part))].sort();
const mirrored = (f: Fragment): Fragment => ({ ...f, p: new THREE.Vector3(-f.p.x, f.p.y, f.p.z), n: new THREE.Vector3(-f.n.x, f.n.y, f.n.z), part: personSprayMirrorPart(f.part + 1) - 1 });
const FRONT = new THREE.Vector3(0, 0, 1);
const LEFT = new THREE.Vector3(-1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);

describe("given a driver's spray, a box projection every surface facing the same way shares", () => {
  const fragments = drawnFragments();
  const surface = personSpraySurface();

  it("when the can sprays the front of a hand, then only that hand is painted, where the box projection alone painted the hip, shorts and legs behind it too", () => {
    const tip = outermost(fragments, LEFT_HAND, FRONT);
    assertSameNumbers(partsOf(paintedAfter(fragments, [tip], surface)), [LEFT_HAND], "parts painted with the depth map");
    const parts = partsOf(paintedAfter(fragments, [tip], null));
    expect(parts.some((part) => !HANDS.includes(part)), `control: the box projection alone paints parts ${parts}`).toBeTruthy();
  });

  it("when the can sprays the outside of a hand, then the other hand behind the body takes no paint, where the box projection alone painted it", () => {
    const tip = outermost(fragments, LEFT_HAND, LEFT);
    assertSameNumbers(partsOf(paintedAfter(fragments, [tip], surface)), [LEFT_HAND], "parts painted with the depth map");
    const parts = partsOf(paintedAfter(fragments, [tip], null));
    expect(parts.includes(RIGHT_HAND), `control: the box projection alone paints parts ${parts}`).toBeTruthy();
  });

  it("when the can sprays the front of a hand with Symmetric on, then the mirrored hand is painted too, and nothing else", () => {
    const tip = outermost(fragments, LEFT_HAND, FRONT);
    assertSameNumbers(partsOf(paintedAfter(fragments, [tip, mirrored(tip)], surface)), HANDS, "parts painted");
  });

  it("when the can sprays the outside of a hand with Symmetric on, then each hand is painted on its own outside", () => {
    const tip = outermost(fragments, LEFT_HAND, LEFT);
    assertSameNumbers(partsOf(paintedAfter(fragments, [tip, mirrored(tip)], surface)), HANDS, "parts painted");
  });

  it("when the can sprays his chest, then his torso is painted and no arm beside it", () => {
    const chest = fragments.filter((f) => f.part === TORSO && !f.onWear && f.n.dot(FRONT) > 0.95 && Math.abs(f.p.x) < 0.02 && Math.abs(f.p.y - 1.2) < 0.03)[0]!;
    assertSameNumbers(partsOf(paintedAfter(fragments, [chest], surface)), [TORSO], "parts painted");
  });

  it("when the can sprays the top of his head, then his hair, out past the skull, is painted", () => {
    const crown = outermost(fragments, HEAD, UP, Infinity);
    const painted = paintedAfter(fragments, [crown], surface);
    expect(painted.some((f) => f.onWear), "the hair's shell takes the paint").toBeTruthy();
  });

  it("when the body's vertices are asked, then paint draws where a ray down the face's axis meets the body first and nowhere it is hidden, bar a few at a texel's edge", () => {
    const rest = dummyGeometry().getAttribute("position");
    const normal = dummyGeometry().getAttribute("normal");
    const body = new THREE.BufferGeometry();
    body.setAttribute("position", rest);
    body.setIndex(Array.from(bodyIndex()));
    const mesh = new THREE.Mesh(body, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster();
    const axes = [LEFT, new THREE.Vector3(1, 0, 0), UP, FRONT, new THREE.Vector3(0, 0, -1)];
    const tally = { visible: 0, visibleRefused: 0, hidden: 0, hiddenDrawn: 0 };
    for (let v = 0; v < BODY_VERTICES; v += EVERY_NTH_VERTEX) {
      const p = new THREE.Vector3().fromBufferAttribute(rest, v);
      const n = new THREE.Vector3().fromBufferAttribute(normal, v);
      const face = sprayFace(PERSON_SPRAY, p.x, p.y, p.z, n.x, n.y, n.z, _uv);
      if (face < 0) continue;
      ray.set(p.clone().addScaledVector(axes[face]!, RAY_START), axes[face]!.clone().negate());
      const first = ray.intersectObject(mesh, false)[0];
      const draws = drawsPaint({ p, n, part: 0, onWear: false }, surface);
      if (first && Math.abs(first.distance - RAY_START) < TEXEL_EDGE) {
        tally.visible++;
        if (!draws) tally.visibleRefused++;
      } else {
        tally.hidden++;
        if (draws) tally.hiddenDrawn++;
      }
    }
    expect(tally.visible > 100 && tally.hidden > 50, `a mix of fragments is asked: ${JSON.stringify(tally)}`).toBeTruthy();
    expect(tally.visibleRefused, `outermost fragments refused: ${JSON.stringify(tally)}`).toBeLessThanOrEqual(tally.visible * EDGE_SHARE);
    expect(tally.hiddenDrawn, `hidden fragments drawn: ${JSON.stringify(tally)}`).toBeLessThanOrEqual(tally.hidden * EDGE_SHARE);
  });
});
