import type { Collider } from "../landmarks.ts";
import { streetTreeOf, type StreetTreeKind } from "./openworld-tree-style.ts";

/**
 * A street tree's one solid at drawn size 1: its trunk's root (m, the drawn trunk's own radius, which the street-trees row holds it to) and a post up the trunk and limbs to the top of its canopy's lumps (m).
 * A car meets the post and never the leaves; the post stands as high as the crown so nothing coming down through the leaves lands on its tip.
 */
const TRUNKS: Readonly<Record<StreetTreeKind, { root: number; height: number }>> = {
  plane: { root: 0.26, height: 12.6 },
  linden: { root: 0.2, height: 10.4 },
  young: { root: 0.1, height: 6.6 },
  cherry: { root: 0.15, height: 6.3 },
  parkPlane: { root: 0.26 * 1.3, height: 12.6 * 1.3 },
  parkLinden: { root: 0.2 * 1.3, height: 10.4 * 1.3 },
};

/** How far (m, at size 1) a tilted leaf card's corner stands past the top of the lump its centre is in. */
const CARD_OVERHANG = 0.6;

/** The collider of the street tree `style` names, for a placement `scale` times the prefab's size and the tree's own drawn size; null for a tree of any other course, whose crown stays solid. */
export function streetTrunk(style: string | undefined, scale: number): readonly Collider[] | null {
  const tree = streetTreeOf(style);
  if (tree === null) return null;
  const trunk = TRUNKS[tree.kind];
  return [{ kind: "circle", r: (trunk.root * tree.scale) / scale, y1: ((trunk.height + CARD_OVERHANG) * tree.scale) / scale }];
}
