import { FACING } from "./openworld-constants.ts";
import type { Side } from "./openworld-layout.ts";

/** The street trees' kinds: a big London plane, a medium linden, a young narrow tree and a flowering cherry; the park's: a bigger plane and a bigger linden in round beds. */
export const STREET_KINDS = ["plane", "linden", "young", "cherry"] as const;
export const PARK_KINDS = ["parkPlane", "parkLinden"] as const;
const STREET_TREE_KINDS = [...STREET_KINDS, ...PARK_KINDS] as const;
export type StreetKind = (typeof STREET_KINDS)[number];
export type StreetTreeKind = (typeof STREET_TREE_KINDS)[number];

/** What the track art draws a tree in: its kind, one draw group per kind whatever the tree's facing. */
export type StreetTreeSkin = `street-tree:${StreetTreeKind}`;
export const SKIN_PREFIX = "street-tree";

/** A tree's drawn turn off its street's facing: within this (rad) either way, in `TURN_STEPS` even steps. */
const TURN_SPREAD = 0.15;
const TURN_STEPS = 4;
/** A tree's drawn size against its kind's own. */
const TREE_SIZES = [0.88, 0.96, 1.04, 1.12] as const;
/** The variations a style's last field names: each turn at each size. */
export const VARIATIONS = TURN_STEPS * TREE_SIZES.length;

/** The kind a street tree's skin draws. */
export function streetTreeKindOf(skin: StreetTreeSkin): StreetTreeKind {
  return STREET_TREE_KINDS.find((kind) => skin === `${SKIN_PREFIX}:${kind}`) ?? STREET_TREE_KINDS[0];
}

const isSide = (name: string | undefined): name is Side => name !== undefined && Object.hasOwn(FACING, name);

export function isStreetTreeSkin(skin: string | null): skin is StreetTreeSkin {
  return skin !== null && STREET_TREE_KINDS.some((kind) => skin === `${SKIN_PREFIX}:${kind}`);
}

/** A street tree as drawn: its skin, the turn its canopy faces (the street's facing, give or take its own turn) and its size against its kind's. The prop's collider reads the kind and the size, never the turn. */
export type StreetTree = { skin: StreetTreeSkin; kind: StreetTreeKind; yaw: number; scale: number };

/** The street tree a tree prop's `style` names, null when it names none (a tree of any other course). */
export function streetTreeOf(style: string | undefined): StreetTree | null {
  if (style === undefined) return null;
  const [prefix, kind, side, variation] = style.split(":");
  const kindAt = STREET_TREE_KINDS.findIndex((candidate) => candidate === kind);
  const index = Number(variation);
  if (prefix !== SKIN_PREFIX || kindAt < 0 || !isSide(side) || !Number.isInteger(index) || index < 0 || index >= VARIATIONS) return null;
  const turn = -TURN_SPREAD + (2 * TURN_SPREAD * (index % TURN_STEPS)) / (TURN_STEPS - 1);
  const kindName = STREET_TREE_KINDS[kindAt]!;
  return { skin: `${SKIN_PREFIX}:${kindName}`, kind: kindName, yaw: FACING[side] + turn, scale: TREE_SIZES[Math.floor(index / TURN_STEPS)]! };
}
