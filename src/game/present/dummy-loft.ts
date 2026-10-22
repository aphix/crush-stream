import { bodyIndex } from "./dummy-bodies.ts";
import { headAt, type Head } from "./dummy-head.ts";
import { printAt, type Fit, type Ring, type Shell } from "./dummy-rig.ts";

/** Wear as lofted shells: rings of cross-sections joined into a closed skin riding one bone, seated on the fitted body's surface. */

/** The body's shared triangle list, decoded once for every fitting. */
export const BODY_INDEX = bodyIndex();

/**
 * The fitted body's surface furthest along axis `along` (1: y, 2: z) at x and `across` (the other of y and z): the highest
 * plane of the triangles whose outline in the plane of x and that axis holds the point. The wear sits on this, not on the
 * nearest vertex (the baked triangles are 5 to 7 cm across on the torso).
 */
function surfaceAlong(fit: Fit, along: 1 | 2, x: number, across: number): number {
  const index = BODY_INDEX;
  const p = fit.rest;
  const other = 3 - along;
  let front = -Infinity;
  for (let t = 0; t < index.length; t += 3) {
    const [a, b, c] = [index[t]! * 3, index[t + 1]! * 3, index[t + 2]! * 3];
    const area = (p[b + other]! - p[c + other]!) * (p[a]! - p[c]!) + (p[c]! - p[b]!) * (p[a + other]! - p[c + other]!);
    if (Math.abs(area) < 1e-12) continue;
    const weightA = ((p[b + other]! - p[c + other]!) * (x - p[c]!) + (p[c]! - p[b]!) * (across - p[c + other]!)) / area;
    const weightB = ((p[c + other]! - p[a + other]!) * (x - p[c]!) + (p[a]! - p[c]!) * (across - p[c + other]!)) / area;
    if (weightA >= 0 && weightB >= 0 && weightA + weightB <= 1) front = Math.max(front, weightA * p[a + along]! + weightB * p[b + along]! + (1 - weightA - weightB) * p[c + along]!);
  }
  if (front === -Infinity) throw new RangeError(`no body surface at (${x}, ${across}) seen along axis ${along}`);
  return front;
}

/** The front-most z (m) of the fitted body's surface at (x, y). */
export function surfaceZ(fit: Fit, x: number, y: number): number {
  return surfaceAlong(fit, 2, x, y);
}

/** The top-most y (m) of the fitted body's surface at (x, z). */
export function surfaceY(fit: Fit, x: number, z: number): number {
  return surfaceAlong(fit, 1, x, z);
}

/** 12, not 8: an octagon reads as a brick. */
export const TUBE_SIDES = 12;
export const BOX_SIDES = 4;

/** A box (a lofted square, flat ends) centred (x, y, z) with sizes (width, height, depth): the small features. */
export function box(x: number, y: number, z: number, [width, height, depth]: readonly [number, number, number], role: number, kinds: number, bone: number): Shell {
  const corner = 1 / Math.cos(Math.PI / BOX_SIDES);
  const ring = (at: number): Ring => [at, (width / 2) * corner, (depth / 2) * corner, z, role];
  return { x, sides: BOX_SIDES, kinds, bone, rings: [ring(y + height / 2), ring(y - height / 2)], top: 0, bottom: 0 };
}

/** Rings over the measured head at heights `ys` (top to bottom), `out` m out of it, the face half of each ring scaled by `frontShare(y)` (below 1: under the skin, so the shell ends in a hairline). */
export function overHead(head: Head, ys: readonly number[], out: number, role: number, frontShare: (y: number) => number): Ring[] {
  return ys.map((y): Ring => {
    const [halfWidth, halfDepth, middleZ] = headAt(head, y);
    return [y, halfWidth + out, halfDepth + out, middleZ, role, frontShare(y)];
  });
}

export type Lofted = { position: number[]; bones: number[]; roleKind: number[]; print: number[]; index: number[]; coarse: number[] };

/** The coarse loft's fewest sides a ring keeps: a hexagon still reads round on a seated driver seen through the glass. */
const COARSE_SIDES = 6;
/** The coarse loft skips a ring nearer than this (m: its height's, half widths' and middle's changes summed) to the last one it kept. */
const COARSE_RING_GAP = 0.04;

/**
 * Shell `shell` into `mesh`: its rings joined side to side (a band takes its lower ring's role), its ends closed by a fan to a pole. The winding faces out only for rings running top to bottom.
 * `mesh.coarse` gets the same shell over the same vertices with fewer sides and rings (`COARSE_SIDES`, `COARSE_RING_GAP`), its ends and its role changes kept;
 * a brim (`frontPower`) keeps them all, its shape being its few front sides.
 */
export function loft(shell: Shell, mesh: Lofted): void {
  for (let r = 1; r < shell.rings.length; r++) {
    if (shell.rings[r]![0] > shell.rings[r - 1]![0]) throw new RangeError(`a shell's ring at y = ${shell.rings[r]![0]} is above the one before it (rings run top to bottom, else the shell is drawn inside out)`);
  }
  const sides = shell.sides;
  const whole = shell.frontPower !== undefined;
  let step = whole ? 1 : Math.max(1, Math.floor(sides / COARSE_SIDES));
  while (sides % step !== 0) step--;
  const last = shell.rings.length - 1;
  const keep = shell.rings.map((ring, r) => whole || r === 0 || r === last || ring[4] !== shell.rings[r - 1]![4] || ring[4] !== shell.rings[r + 1]![4]);
  for (let r = 1, kept = 0; r < last; r++) {
    const [a, b] = [shell.rings[kept]!, shell.rings[r]!];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]) >= COARSE_RING_GAP) keep[r] = true;
    if (keep[r]) kept = r;
  }
  const phase = Math.PI / sides;
  const addVertex = (y: number, x: number, z: number, role: number): number => {
    mesh.bones.push(shell.bone, shell.bone, 0);
    mesh.roleKind.push(role, shell.kinds);
    mesh.print.push(...printAt(shell.print, x, y, z));
    mesh.position.push(x, y, z);
    return mesh.position.length / 3 - 1;
  };
  const rings = shell.rings.map(([y, halfWidth, halfDepth, middleZ, role, frontShare = 1, radii, across = 0]) =>
    Array.from({ length: sides }, (_, k) => {
      const angle = phase + (2 * Math.PI * k) / sides;
      const toFront = Math.sin(angle);
      const frontScale = toFront > 0 ? (shell.frontPower === undefined ? frontShare : 1 + (frontShare - 1) * toFront ** shell.frontPower) : 1;
      const scale = radii?.[k] ?? 1;
      return addVertex(y, shell.x + across + scale * halfWidth * Math.cos(angle), middleZ + scale * halfDepth * toFront * frontScale, role);
    }),
  );
  let upper = rings[0]!;
  for (let r = 0; r + 1 < rings.length; r++) {
    const role = shell.rings[r + 1]![4];
    // Where the ring above differs, the band gets its own copy of it: every triangle is one role at all three corners, so its colour stops at the ring.
    const top = shell.rings[r]![4] === role ? rings[r]! : rings[r]!.map((vertex) => addVertex(mesh.position[vertex * 3 + 1]!, mesh.position[vertex * 3]!, mesh.position[vertex * 3 + 2]!, role));
    for (let k = 0; k < sides; k++) {
      const [a, b, c, d] = [top[k]!, top[(k + 1) % sides]!, rings[r + 1]![(k + 1) % sides]!, rings[r + 1]![k]!];
      mesh.index.push(a, b, d, b, c, d);
    }
    // A coarse band runs from the last kept ring to the next; a role change keeps both its rings, so a span between two is one role.
    if (keep[r]) upper = top;
    if (!keep[r + 1]) continue;
    for (let k = 0; k < sides; k += step) {
      const [a, b, c, d] = [upper[k]!, upper[(k + step) % sides]!, rings[r + 1]![(k + step) % sides]!, rings[r + 1]![k]!];
      mesh.coarse.push(a, b, d, b, c, d);
    }
  }
  const close = (ring: number[], at: Ring, poleOffset: number, up: boolean): void => {
    const pole = addVertex(at[0] + poleOffset, shell.x + (at[7] ?? 0), at[3], at[4]);
    for (let k = 0; k < sides; k++) mesh.index.push(pole, up ? ring[(k + 1) % sides]! : ring[k]!, up ? ring[k]! : ring[(k + 1) % sides]!);
    for (let k = 0; k < sides; k += step) mesh.coarse.push(pole, up ? ring[(k + step) % sides]! : ring[k]!, up ? ring[k]! : ring[(k + step) % sides]!);
  };
  if (shell.top !== undefined) close(rings[0]!, shell.rings[0]!, shell.top, true);
  if (shell.bottom !== undefined) close(rings[last]!, shell.rings[last]!, -shell.bottom, false);
}
