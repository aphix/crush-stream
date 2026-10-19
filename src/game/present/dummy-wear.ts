import { EYES_AT, headAt, LIP_AT, measureHead, RIM_AT, type Head } from "./dummy-head.ts";
import { hairFor } from "./dummy-hair.ts";
import { box, overHead, surfaceZ, TUBE_SIDES } from "./dummy-loft.ts";
import { casualWear } from "./dummy-garments.ts";
import { BUILD, CAPPED, HEAD, ROLE, SHADES, WHISKERS, type Fit, type Ring, type Shell } from "./dummy-rig.ts";
import { PRINT_CELL } from "./dummy-texture.ts";
import { uniformWear } from "./dummy-uniform.ts";
import { womanWear } from "./dummy-woman.ts";

/** Each build's wear, lofted on its own fitted body: the head's here, the garments' from their own modules. */

const { HAIR, BRIM, EYES, MUSTACHE } = ROLE;

/**
 * The cap's peak stands this far (m) out of its crown, its reach falling off with the 6th power away from the centre: the
 * reference's baseball cap, a long brim out over the face that keeps to the front. The peak's rings step down from the rim by
 * `PEAK_TOP_DROP` then `PEAK_DROP`.
 */
const PEAK_REACH = 0.07;
const PEAK_POWER = 6;
const PEAK_TOP_DROP = 0.004;
const PEAK_DROP = 0.01;
/** The crown's rings round the head's top at these drops (m) under it; a pole straight over a wide ring would be a cone. */
const CROWN_DROPS = [0.004, 0.016, 0.035];
/** Metres a cap's crown stands out of the head. */
const CROWN_OUT = 0.022;
/** The cap's star (m): its middle this far above the rim on the crown's front, and its size. */
const EMBLEM_RISE = 0.034;
const EMBLEM_SIZE = [0.046, 0.046] as const;
/** A print on the crown's front shows only on its front, past this z (m) of the head's middle at the rim. */
const EMBLEM_FROM = 0.03;
/**
 * Dark glasses: two flat oval lenses (rings: m above the eye line, half width) `LENS_HALF_DEPTH` thick at `LENS_X` either side,
 * `LENS_OUT` in front of the brow, a bridge over the nose and arms back to the ears.
 */
const LENS_X = 0.037;
const LENS_RINGS = [[0.013, 0.012], [0.009, 0.021], [0, 0.025], [-0.008, 0.021], [-0.013, 0.01]] as const;
const LENS_HALF_DEPTH = 0.003;
const LENS_OUT = 0.006;
const BROW_RISE = 0.015;
const BRIDGE_SIZE = [0.024, 0.005, 0.004] as const;
const ARM_SIZE = [0.004, 0.005, 0.08] as const;
const FRAME_RISE = 0.006;
/** The moustache: a bar on the upper lip, `MOUSTACHE_RISE` m over the mouth's line, sunk `MOUSTACHE_SINK` into the face. */
const MOUSTACHE_SIZE = [0.04, 0.008, 0.012] as const;
const MOUSTACHE_RISE = 0.01;
const MOUSTACHE_SINK = 0.002;
/**
 * The ears (the baked head has none to speak of): a flat oval each side, its rings (m over the ear's middle, half thickness,
 * half length), its outside `EAR_OUT` m out of the skull at `EAR_AT` of the head's height over the chin, `EAR_BACK` m behind the head's middle.
 */
const EAR_RINGS = [[0.03, 0.003, 0.006], [0.022, 0.007, 0.015], [0.008, 0.008, 0.019], [-0.008, 0.008, 0.017], [-0.022, 0.006, 0.01], [-0.03, 0.003, 0.004]] as const;
const EAR_AT = 0.47;
const EAR_OUT = 0.012;
const EAR_BACK = 0.012;
const EAR_SIDES = 8;

/** The ears on `head`, drawn on `kinds`: skin, riding the head bone. */
function ears(head: Head, kinds: number): Shell[] {
  const middle = head.chin + EAR_AT * (head.top - head.chin);
  const [halfWidth, , middleZ] = headAt(head, middle);
  return [-1, 1].map((side) => ({
    x: side * (halfWidth + EAR_OUT - EAR_RINGS[2][1]),
    sides: EAR_SIDES,
    kinds,
    bone: HEAD,
    rings: EAR_RINGS.map(([rise, halfThick, halfLong]): Ring => [middle + rise, halfThick, halfLong, middleZ - EAR_BACK, ROLE.SKIN]),
    top: 0,
    bottom: 0,
  }));
}

/** Dark glasses on `fit`'s face at the eye line `eyes` (m): two lenses, the bridge and the arms. */
function shades(fit: Fit, head: Head, eyes: number, kinds: number): Shell[] {
  const frame = eyes + FRAME_RISE;
  const temple = headAt(head, frame)[0] + ARM_SIZE[0];
  return [-1, 1].flatMap((side) => {
    const lensZ = surfaceZ(fit, side * LENS_X, eyes + BROW_RISE) + LENS_OUT;
    const lens: Shell = { x: side * LENS_X, sides: TUBE_SIDES, kinds, bone: HEAD, rings: LENS_RINGS.map(([rise, halfWidth]): Ring => [eyes + rise, halfWidth, LENS_HALF_DEPTH, lensZ, EYES]), top: 0, bottom: 0 };
    const arm = box(side * temple, frame, lensZ - ARM_SIZE[2] / 2, ARM_SIZE, EYES, kinds, HEAD);
    return side < 0 ? [lens, arm] : [lens, arm, box(0, frame, surfaceZ(fit, 0, frame) + LENS_OUT, BRIDGE_SIZE, EYES, kinds, HEAD)];
  });
}

/** The wear of one build, on its own fitted body: cap, hair, dark glasses and moustache, then the garments. */
export function wearFor(build: number, fit: Fit): Shell[] {
  const head = measureHead(fit);
  const { top, chin } = head;
  const height = top - chin;
  const at = (share: number) => chin + share * height;
  const rim = at(RIM_AT);
  const crownYs = [...CROWN_DROPS.map((drop) => top - drop), rim];
  const crown = overHead(head, crownYs, CROWN_OUT, HAIR, () => 1);
  const edge = crown[crown.length - 1]!;
  const reach = 1 + PEAK_REACH / edge[2];
  const peakRing = (drop: number, frontShare?: number): Ring => [edge[0] - drop, edge[1], edge[2], edge[3], BRIM, frontShare];
  const onHead = (kinds: number, rings: readonly Ring[], poleTop?: number, poleBottom?: number): Shell => ({ x: 0, sides: TUBE_SIDES, kinds, bone: HEAD, rings, top: poleTop, bottom: poleBottom });
  const peak = { ...onHead(build | CAPPED, [peakRing(0), peakRing(PEAK_TOP_DROP, reach), peakRing(PEAK_DROP, reach), peakRing(PEAK_DROP)]), frontPower: PEAK_POWER };
  const emblem = { cell: PRINT_CELL.EMBLEM, centre: [0, rim + EMBLEM_RISE], size: EMBLEM_SIZE, along: "z", from: edge[3] + EMBLEM_FROM } as const;
  const shells: Shell[] = [{ ...onHead(build | CAPPED, crown, top + CROWN_OUT - crownYs[0]!), print: emblem }, peak];
  shells.push(...hairFor(build, fit, head));
  if (build === BUILD.WOMAN) shells.push(...womanWear(fit));
  else shells.push(...ears(head, build));
  shells.push(...shades(fit, head, at(EYES_AT), build | SHADES));
  const lip = at(LIP_AT) + MOUSTACHE_RISE;
  shells.push(box(0, lip, surfaceZ(fit, 0, lip) - MOUSTACHE_SINK, MOUSTACHE_SIZE, MUSTACHE, build | WHISKERS, HEAD));
  shells.push(...casualWear(build, fit), ...uniformWear(build, fit));
  return shells;
}
