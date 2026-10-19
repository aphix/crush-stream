import { EYES_AT, headAt, LIP_AT, measureHead, RIM_AT, type Head } from "./dummy-head.ts";
import { box, overHead, surfaceZ, TUBE_SIDES } from "./dummy-loft.ts";
import { casualWear } from "./dummy-garments.ts";
import { BARE, BUILD, CAPPED, HEAD, ROLE, SHADES, WHISKERS, type Fit, type Ring, type Shell } from "./dummy-rig.ts";
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
 * A hairstyle: metres out of the head, the share the crown's front half swells forward (a quiff, a swept front), then its rings
 * down the head: the fraction of the head's height above the chin, the share of the face half's depth kept (under 1: under the
 * skin, so the shell ends in a hairline), and how far its sides tuck in over the ears (1: not at all).
 */
type HairStyle = { out: number; swell: number; rings: readonly (readonly [at: number, front: number, tuck: number])[] };
/** The men's short hair (the reference's man and cop): a little lift over a high hairline, the ears clear, down to the nape. */
const SHORT_HAIR: HairStyle = { out: 0.012, swell: 1.12, rings: [[0.8, 0.8, 1], [0.68, 0.45, 1], [0.56, 0.45, 0.86], [0.42, 0.45, 0.82]] };
/** The president's: fuller, swept up and back from a front that overhangs the brow, the sides combed back over the tops of the ears. */
const SWEPT_HAIR: HairStyle = { out: 0.024, swell: 1.35, rings: [[0.82, 1.12, 1], [0.7, 0.5, 1], [0.58, 0.42, 0.92], [0.44, 0.42, 0.86]] };
/** A tube side's |cos| (round the head, 1 at the ears) past which a low hair ring tucks in. */
const EAR_SIDE = 0.9;
const SIDE_ANGLES = Array.from({ length: TUBE_SIDES }, (_, k) => Math.PI / TUBE_SIDES + (2 * Math.PI * k) / TUBE_SIDES);
/**
 * Dark glasses: two flat oval lenses (rings: m above the eye line, half width) `LENS_HALF_DEPTH` thick at `LENS_X` either side,
 * `LENS_OUT` in front of the brow, a bridge over the nose and arms back to the ears.
 */
const LENS_X = 0.034;
const LENS_RINGS = [[0.013, 0.012], [0.009, 0.021], [0, 0.025], [-0.008, 0.021], [-0.013, 0.01]] as const;
const LENS_HALF_DEPTH = 0.003;
const LENS_OUT = 0.006;
const BROW_RISE = 0.015;
const BRIDGE_SIZE = [0.024, 0.005, 0.004] as const;
const ARM_SIZE = [0.004, 0.005, 0.08] as const;
const FRAME_RISE = 0.006;
/** The moustache: a bar on the upper lip, sunk `MOUSTACHE_SINK` into the face. */
const MOUSTACHE_SIZE = [0.04, 0.008, 0.012] as const;
const MOUSTACHE_SINK = 0.002;

/** `style`'s hair over `head`, riding the head bone. */
function hairOver(head: Head, style: HairStyle, kinds: number): Shell {
  const at = (share: number) => head.chin + share * (head.top - head.chin);
  const crown = overHead(head, CROWN_DROPS.map((drop) => head.top - drop), style.out, HAIR, () => style.swell);
  const down = style.rings.map(([share, front, tuck]): Ring => {
    const [halfWidth, halfDepth, middleZ] = headAt(head, at(share));
    const radii = SIDE_ANGLES.map((angle) => (Math.abs(Math.cos(angle)) > EAR_SIDE ? tuck : 1));
    return [at(share), halfWidth + style.out, halfDepth + style.out, middleZ, HAIR, front, radii];
  });
  return { x: 0, sides: TUBE_SIDES, kinds, bone: HEAD, rings: [...crown, ...down], top: style.out + CROWN_DROPS[0]! };
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
  if (build === BUILD.MAN) shells.push(hairOver(head, SHORT_HAIR, BUILD.MAN | BARE));
  if (build === BUILD.PORTLY) shells.push(hairOver(head, SWEPT_HAIR, BUILD.PORTLY | BARE));
  if (build === BUILD.WOMAN) shells.push(...womanWear(fit, head, crownYs));
  shells.push(...shades(fit, head, at(EYES_AT), build | SHADES));
  shells.push(box(0, at(LIP_AT), surfaceZ(fit, 0, at(LIP_AT)) - MOUSTACHE_SINK, MOUSTACHE_SIZE, MUSTACHE, build | WHISKERS, HEAD));
  shells.push(...casualWear(build, fit), ...uniformWear(build, fit));
  return shells;
}
