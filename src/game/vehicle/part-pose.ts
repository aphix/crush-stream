import * as THREE from "three";
import { detCos, detSin } from "../kernel/physics-core.js";
import type { StreamedDeformation } from "../deform/streamed-deform.ts";
import type { DetachPart } from "./car-core.ts";
import { LIGHT_BAR_FOOT } from "./car-materials.ts";

const _seat = new THREE.Vector3();
const _rest = new THREE.Vector3();

/**
 * The light bar's fold at full hinge value (rad). Its free edge lifts `2 · LIGHT_BAR_FOOT.z · sin(BAR_FOLD · hinge)` off the roof: 7.5 cm at the
 * last hinge value (0.95), where the bar shears off at 1. Small on purpose: a bar that stands further off the roof it rides reads as floating.
 */
export const BAR_FOLD = 0.45;

/**
 * Where a hinged lid (`cowl` hood, `tail` boot), a door or the light bar stands at hinge value `t = p.hingeT` (from rest, which turns nothing): position x, y, z
 * then quaternion x, y, z, w into `out` at `o`. The lids turn about x through their rest origin, the boot by its free swing too; a door turns about y through
 * its hinge, by the crash's jam or its free swing, as `CarParts.posePart` draws it. The bar (`bar`) turns about x too, but about the line
 * along its base's edge on the side the car's inertia sends it (`deform.impactInward.z`: a hit on the nose, inward −z, tips it forward, a hit on the tail back):
 * the edge of both feet's soles stays where it is and the other edge rises, as a door's hinge side stays and its free edge swings. The bar is skinned
 * with the roof (`skinPanel`), which carries that edge down and back with the crushed roof (0.15 m back in a frontal crush: turning about its rest place
 * stood the edge 5 cm off the skin), so the line it turns about is where the roof's lattice puts the edge now (`panelPoint`). The bar spans the roof across the car
 * (feet 0.8 m apart on the gutters), so a hinge along that line is the one a clamped pair of feet can fold on; the old turn about one foot, along the car,
 * lifted the far end 0.35 m off the roof. The one pose the drawn mesh (`CarParts.posePart`) and the car's cage (`CageRig`) both take, from the part's
 * state and the deformation's lattice alone.
 */
export function hingePose(p: DetachPart, deform: StreamedDeformation, out: Float64Array, o: number): void {
  const t = p.hingeT;
  const x = p.restPos.x;
  let y = p.restPos.y;
  let z = p.restPos.z;
  let turn: number;
  if (p.hinge === "cowl") {
    z -= t * 0.08;
    y += t * 0.26;
    turn = -t * 0.5;
  } else if (p.hinge === "door") {
    // About y, sideways: the crash's jam or the free swing, whichever holds it further open, out from the hinge as the jam springs it.
    const sign = p.name === "doorL" ? -1 : 1;
    const half = (-sign * Math.max(t * p.swing!.spec.jam, p.swing!.theta)) / 2;
    out[o] = x + sign * t * 0.06;
    out[o + 1] = y;
    out[o + 2] = z;
    out[o + 3] = 0;
    out[o + 4] = detSin(half);
    out[o + 5] = 0;
    out[o + 6] = detCos(half);
    return;
  } else if (p.hinge === "tail") {
    z += t * 0.08;
    y += t * 0.22;
    // The crash's jam or the free swing, whichever holds it further open, the way its hinge opens.
    const s = p.swing!;
    turn = s.spec.dir * Math.max(t * s.spec.jam, s.theta);
  } else {
    const side = deform.impactInward.z > 0 ? -1 : 1;
    turn = side * t * BAR_FOLD;
    // The hinge line's place in the bar's own frame: its rest place, carried by the roof.
    _rest.set(0, LIGHT_BAR_FOOT.sole, side * LIGHT_BAR_FOOT.z);
    deform.panelPoint("roof", _rest, p.restPos, _seat);
    const py = _seat.y;
    const pz = _seat.z;
    const c = detCos(turn);
    const s = detSin(turn);
    y += py * (1 - c) + pz * s;
    z += pz * (1 - c) - py * s;
  }
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = detSin(turn / 2);
  out[o + 4] = 0;
  out[o + 5] = 0;
  out[o + 6] = detCos(turn / 2);
}

/** Floats of `DetachPart.poseMemo`: the hinge value and swing a part posed from, then the 13 numbers of the pose it wrote. */
export const POSE_MEMO_LENGTH = 2 + 13;

/** The swing value, past the hinge value, that a part's pose reads (`posesFromOwnState`). */
function swingInput(p: DetachPart): number {
  return p.hinge === "tail" ? p.swing!.theta : p.mirror ? p.swing!.mirrorFold : 0;
}

/** Whether `p`'s pose is a function of its hinge value and swing alone, with no road, car pose or skin read: the hood, the boot lid, a mirror, a panel at rest. */
export function posesFromOwnState(p: DetachPart): boolean {
  return p.hinge === "cowl" || p.hinge === "tail" || p.mirror || (p.region !== null && !p.folding && !p.open);
}

/** Whether `p` already stands as its last pose from this hinge value and swing left it, so posing it again writes what is there. */
export function standsAsPosed(p: DetachPart): boolean {
  const m = p.poseMemo;
  const { position: pos, quaternion: quat, rotation: euler, scale } = p.object;
  return (
    Object.is(m[0], p.hingeT) &&
    Object.is(m[1], swingInput(p)) &&
    Object.is(m[2], pos.x) &&
    Object.is(m[3], pos.y) &&
    Object.is(m[4], pos.z) &&
    Object.is(m[5], quat.x) &&
    Object.is(m[6], quat.y) &&
    Object.is(m[7], quat.z) &&
    Object.is(m[8], quat.w) &&
    Object.is(m[9], euler.x) &&
    Object.is(m[10], euler.y) &&
    Object.is(m[11], euler.z) &&
    Object.is(m[12], scale.x) &&
    Object.is(m[13], scale.y) &&
    Object.is(m[14], scale.z)
  );
}

/** Records the pose `p` stands in from its hinge value and swing (`standsAsPosed`). */
export function notePosed(p: DetachPart): void {
  const m = p.poseMemo;
  const { position: pos, quaternion: quat, rotation: euler, scale } = p.object;
  m[0] = p.hingeT;
  m[1] = swingInput(p);
  m[2] = pos.x;
  m[3] = pos.y;
  m[4] = pos.z;
  m[5] = quat.x;
  m[6] = quat.y;
  m[7] = quat.z;
  m[8] = quat.w;
  m[9] = euler.x;
  m[10] = euler.y;
  m[11] = euler.z;
  m[12] = scale.x;
  m[13] = scale.y;
  m[14] = scale.z;
}

/** The masses the cabin interior is placed by (`interiorPose`'s `lx`/`rx`, then the cell's travel `dy`/`dz`). */
export const INTERIOR_MASSES = ["doorL", "doorR", "cell"] as const;

/**
 * Where the interior mesh stands once the cabin is crushed, from the door masses' x (`lx`, `rx`) and the cell mass's travel off its
 * rest in y and z (`dy`, `dz`), as its x scale then its x, y, z position into `out`. The one placement the drawn mesh
 * (`CarParts.fitInterior`) and the car's cage (`CageRig`: the interior is what shows through a gone pane) both take.
 */
export function interiorPose(lx: number, rx: number, dy: number, dz: number, out: Float64Array): void {
  out[0] = Math.max(0.32, Math.min(1, Math.max(0.35, rx - lx) / 1.56));
  out[1] = (lx + rx) * 0.5;
  out[2] = Math.max(-0.08, Math.min(0.1, dy));
  out[3] = dz * 0.35;
}
