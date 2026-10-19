import { fitted, type Take } from "./dummy-garments.ts";
import { RIM_AT, type Head } from "./dummy-head.ts";
import { BARE, BUILD, CAPPED, HEAD, ROLE, smooth, type Fit, type Ring, type Shell } from "./dummy-rig.ts";

/** The people's hair, lofted on each build's head: the body's own section at each height, then the style's volume off it. */

/** Directions (rad from straight ahead) a style's values are given at: the forehead, the temple, the sideburn, over the ear, behind it, the nape. */
const KNOTS = [0, 0.7, 1.2, 1.75, 2.35, Math.PI] as const;
type Round = readonly [front: number, temple: number, sideburn: number, ear: number, behind: number, back: number];

/** `round` at `away` rad from straight ahead, eased between its knots. */
function along(round: Round, away: number): number {
  let k = 0;
  while (k + 2 < KNOTS.length && away > KNOTS[k + 1]!) k++;
  return round[k]! + (round[k + 1]! - round[k]!) * smooth(KNOTS[k]!, KNOTS[k + 1]!, away);
}

/**
 * A short hairstyle by direction: its hairline (the share of the head's height over the chin it comes down to), how far (m)
 * it stands off the scalp just over the hairline (`edge`), and how far over the top of the head (`top`).
 */
type HairStyle = { hairline: Round; edge: Round; top: Round };
/** The men's (the reference's man and cop): close at a high hairline, lifting to full over the top, sideburns, the ears clear, down to the nape. */
const SHORT_HAIR: HairStyle = {
  hairline: [0.82, 0.8, 0.56, 0.64, 0.42, 0.3],
  edge: [0.006, 0.008, 0.004, 0.008, 0.008, 0.006],
  top: [0.03, 0.024, 0.018, 0.018, 0.018, 0.016],
};
/** The president's: a full front swept up and over the brow, the sides combed back over the tops of the ears. */
const SWEPT_HAIR: HairStyle = {
  hairline: [0.78, 0.79, 0.56, 0.58, 0.4, 0.3],
  edge: [0.014, 0.012, 0.006, 0.018, 0.014, 0.01],
  top: [0.046, 0.038, 0.03, 0.03, 0.024, 0.018],
};
/** Hair rises from the hairline to its edge's depth over this share of the head's height. */
const RISE = 0.05;
/** Where it has not grown it lies this far (m) under the skin, or over the face (within `FACE_AWAY` rad of straight ahead, under `FACE_TOP` of the head's height) at this share of the scalp's radius: a ring's hull bridges the face's hollows. */
const TUCK = 0.01;
const SINK_SHARE = 0.5;
const FACE_AWAY = [0.9, 1.3] as const;
const FACE_TOP = [0.66, 0.74] as const;
/** Rings this far (m) apart, the top one this far under the crown; a section any nearer the top is a few points. */
const RING_STEP = 0.01;
const TOP_GAP = 0.006;
/** 24 sides: 6 clumps round the head, each 4 sides wide, `CLUMP_DEPTH` m proud. */
const SIDES = 24;
const CLUMPS = 6;
const CLUMP_DEPTH = 0.0025;
/** The clumps sweep round this far (rad) per metre down: combed, not ribbed. */
const CLUMP_TWIST = 18;
/** The scalp's axis (x, z): inside every build's head, so each side's ray leaves it once. */
const AXIS = [0, 0] as const;

/** The share of the head's height over the chin above which the scalp is painted hair, `away` rad from straight ahead: under the men's hair's edge, so no paint shows below it. */
export function scalpHairline(away: number): number {
  return along(SHORT_HAIR.hairline, away) + RISE;
}

/** Side `k` of `sides`' angle round the axis (from +x toward +z, the loft's). */
const angleOf = (k: number, sides: number): number => ((k + 0.5) * 2 * Math.PI) / sides;

/** Rings over a crown's top ring (share of the rise to its pole, share of that ring's radii, on a quarter ellipse): a round top, not a cone. */
const DOME = [[0.8, 0.6], [0.5, 0.87]] as const;

/** `shell` under a round top `rise` m over its first ring. */
function domed(shell: Shell, rise: number): Shell {
  const first = shell.rings[0]!;
  const dome = DOME.map(([up, scale]): Ring => [first[0] + up * rise, first[1], first[2], first[3], first[4], first[5], first[6]!.map((radius) => radius * scale), first[7]]);
  return { ...shell, rings: [...dome, ...shell.rings], top: (1 - DOME[0][0]) * rise };
}

/** `style`'s hair over `head`, riding the head bone, drawn on `kinds`. */
function shortHair(fit: Fit, head: Head, style: HairStyle, kinds: number): Shell {
  const height = head.top - head.chin;
  const lowest = head.chin + (Math.min(...style.hairline) - RISE) * height;
  const ys: number[] = [];
  for (let y = head.top - TOP_GAP; y > lowest; y -= RING_STEP) ys.push(y);
  const scalp = fitted(fit, (vertex) => fit.neckWeight[vertex] === 1, ys.map((y) => ({ y, out: 0, role: ROLE.HAIR })), { bone: HEAD, kinds, sides: SIDES, axis: AXIS });
  const rings = scalp.rings.map((ring): Ring => {
    const share = (ring[0] - head.chin) / height;
    const radii = ring[6]!.map((under, k) => {
      const angle = angleOf(k, SIDES);
      const away = Math.acos(Math.sin(angle));
      const line = along(style.hairline, away);
      const edge = along(style.edge, away);
      const depth = edge + (along(style.top, away) - edge) * smooth(line + RISE, 1, share);
      const clump = CLUMP_DEPTH * Math.sin(CLUMPS * angle + CLUMP_TWIST * (head.top - ring[0]));
      const sunk = under - TUCK - (under * (1 - SINK_SHARE) - TUCK) * smooth(FACE_AWAY[1], FACE_AWAY[0], away) * smooth(FACE_TOP[1], FACE_TOP[0], share);
      return sunk + (under + depth + clump - sunk) * smooth(line, line + RISE, share);
    });
    return [ring[0], 1, 1, ring[3], ring[4], 1, radii, ring[7]];
  });
  return domed({ ...scalp, rings }, TOP_GAP + style.top.reduce((sum, depth) => sum + depth, 0) / style.top.length);
}

/**
 * Her hair's outline (m) by height over her chin: half width, and reach ahead of and behind its axis; eased between rows.
 * The widths are the reference's front view's; it rests on her shoulders `HAIR_END` m up.
 */
const OUTLINE: readonly (readonly [over: number, halfWidth: number, ahead: number, behind: number])[] = [
  [0.235, 0.065, 0.07, 0.07],
  [0.206, 0.092, 0.085, 0.085],
  [0.174, 0.106, 0.095, 0.095],
  [0.13, 0.115, 0.095, 0.1],
  [0.086, 0.116, 0.09, 0.1],
  [0.048, 0.112, 0.085, 0.105],
  [0, 0.128, 0.075, 0.11],
  [-0.08, 0.13, 0.065, 0.11],
];
const HAIR_END = 1.42;
/** It lies at least this far (m) off her head and neck, and this far over the top of her head. */
const HAIR_THICK = 0.012;
const CROWN_THICK = 0.022;
/** It thickens to the crown's over the top of her head, from this share of its height. */
const CROWN_FROM = 0.8;
/** Under a cap it stands this far (m) off her head over the cap's rim (the cap's crown is 0.022 out), and is whole again by `JOIN_AT` of her head's height. */
const CAPPED_OUT = 0.018;
const JOIN_AT = 0.62;
/** It falls about this z (m): inside her head and her neck (the throat's front is near z = 0), so every side's ray leaves her once. */
const HAIR_AXIS_Z = -0.03;
const HAIR_SIDES = 32;
const HAIR_STEP = 0.012;
/** Her face shows through it within this half width (m) in front, up to her hairline (a share of her head's height), her throat within `THROAT_HALF` under the chin; the opening's edge eases over `OPEN_SOFT` m across and `HAIRLINE_SOFT` of her head's height at the top. */
const FACE_HALF = 0.058;
const THROAT_HALF = 0.05;
const HER_HAIRLINE = 0.8;
const OPEN_SOFT = 0.012;
const HAIRLINE_SOFT = 0.04;
/** Her side parting sweeps a fringe this share of her head's height down over the right of her forehead (x under `FRINGE_X` m), as the reference's. */
const FRINGE_DROP = 0.07;
const FRINGE_X = [0.02, -0.04] as const;
/** Over the face it dives to this share of the head's radius. */
const OPEN_SINK_SHARE = 0.5;
/** Its ends curl in onto her shoulders over the last `END_BAND` m, `TUCK_UNDER` m under the skin; the pole under them sits inside her. */
const END_BAND = 0.05;
const TUCK_UNDER = 0.008;
const END_POLE = 0.01;
/** Its waves: `WAVES` strands round, `WAVE_DEPTH` m deep, twisting a whole turn every `WAVE_TURN` m down. */
const WAVES = 8;
const WAVE_DEPTH = 0.006;
const WAVE_TURN = 0.16;
/** Her head and neck under the hair: off the arms, within this |x| (m) of her middle (her trapezius under the ends, not her shoulders). */
const UNDER_HAIR_X = 0.1;

/** Her outline's (half width, ahead, behind) at `over` m over her chin. */
function outlineAt(over: number): readonly [number, number, number] {
  const k = OUTLINE.findIndex((row) => row[0] <= over);
  if (k <= 0) return k === 0 ? [OUTLINE[0]![1], OUTLINE[0]![2], OUTLINE[0]![3]] : [OUTLINE.at(-1)![1], OUTLINE.at(-1)![2], OUTLINE.at(-1)![3]];
  const [high, low] = [OUTLINE[k - 1]!, OUTLINE[k]!];
  const t = smooth(low[0], high[0], over);
  return [low[1] + t * (high[1] - low[1]), low[2] + t * (high[2] - low[2]), low[3] + t * (high[3] - low[3])];
}

/** Her hair's radius about its axis on side `k` over `under` (her body's) at `y`, bare or under a cap. */
function longRadius(under: number, k: number, y: number, head: Head, capped: boolean): number {
  const share = (y - head.chin) / (head.top - head.chin);
  const angle = angleOf(k, HAIR_SIDES);
  const [across, ahead] = [Math.cos(angle), Math.sin(angle)];
  const x = under * across;
  const hairline = HER_HAIRLINE - FRINGE_DROP * smooth(FRINGE_X[0], FRINGE_X[1], x);
  const open = THROAT_HALF + (FACE_HALF - THROAT_HALF) * smooth(head.chin - OPEN_SOFT, head.chin + OPEN_SOFT, y);
  const openness = ahead > 0 ? smooth(open + OPEN_SOFT, open - OPEN_SOFT, Math.abs(x)) * smooth(hairline + HAIRLINE_SOFT, hairline - HAIRLINE_SOFT, share) : 0;
  const [halfWidth, front, back] = outlineAt(y - head.chin);
  const volume = 1 / Math.sqrt((across / halfWidth) ** 2 + (ahead / (ahead > 0 ? front : back)) ** 2);
  const wave = WAVE_DEPTH * Math.sin(WAVES * angle + (2 * Math.PI * (head.top - y)) / WAVE_TURN);
  const bare = Math.max(under + HAIR_THICK + (CROWN_THICK - HAIR_THICK) * smooth(CROWN_FROM, 1, share), volume) + wave;
  const hair = capped ? under + CAPPED_OUT + (bare - under - CAPPED_OUT) * smooth(RIM_AT, JOIN_AT, share) : bare;
  const shown = under - TUCK_UNDER + (hair - under + TUCK_UNDER) * smooth(HAIR_END, HAIR_END + END_BAND, y);
  return shown + (under * OPEN_SINK_SHARE - shown) * openness;
}

/** Her long wavy hair: a crown bare and one under a cap, each down to `JOIN_AT` of her head's height, then the fall to her shoulders. */
function longHair(fit: Fit, head: Head): Shell[] {
  const join = head.chin + JOIN_AT * (head.top - head.chin);
  const crownYs: number[] = [];
  for (let y = head.top - TOP_GAP; y > join; y -= HAIR_STEP) crownYs.push(y);
  crownYs.push(join);
  const falls = Math.ceil((join - HAIR_END) / HAIR_STEP);
  const fallYs = Array.from({ length: falls + 1 }, (_, k) => join - (k * (join - HAIR_END)) / falls);
  const underHair: Take = (vertex) => fit.shoulderWeight[vertex]! < 1 && fit.hipWeight[vertex] === 0 && Math.abs(fit.tpose[vertex * 3]!) < UNDER_HAIR_X;
  const shell = (ys: readonly number[], kinds: number, capped: boolean): Shell => {
    const body = fitted(fit, underHair, ys.map((y) => ({ y, out: 0, role: ROLE.LOCKS })), { bone: HEAD, kinds, sides: HAIR_SIDES, axis: [0, HAIR_AXIS_Z] });
    return { ...body, rings: body.rings.map((ring): Ring => [ring[0], 1, 1, ring[3], ROLE.LOCKS, 1, ring[6]!.map((under, k) => longRadius(under, k, ring[0], head, capped)), ring[7]]) };
  };
  return [
    domed(shell(crownYs, BUILD.WOMAN | BARE, false), TOP_GAP + CROWN_THICK),
    { ...shell(crownYs, BUILD.WOMAN | CAPPED, true), top: TOP_GAP + CAPPED_OUT },
    { ...shell(fallYs, BUILD.WOMAN, false), bottom: END_POLE },
  ];
}

/** The hair of `build` over its fitted `head`. */
export function hairFor(build: number, fit: Fit, head: Head): Shell[] {
  if (build === BUILD.MAN) return [shortHair(fit, head, SHORT_HAIR, BUILD.MAN | BARE)];
  if (build === BUILD.PORTLY) return [shortHair(fit, head, SWEPT_HAIR, BUILD.PORTLY | BARE)];
  return longHair(fit, head);
}
