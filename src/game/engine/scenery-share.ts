import type { FxTier } from "../present/engine-post.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-course.ts";

/** The share of a course's scenery kept by the FX tier it is first entered at. */
const SCENERY_SHARE: Record<FxTier, number> = { off: 0.3, minimal: 0.3, low: 0.6, high: 1, ultra: 1 };

/** The open world is first entered at `minimal` (the tier is not settled yet), so its share goes by the device, not the tier. */
export function sceneryShare(courseId: string, tier: FxTier, desktop: boolean): number {
  return courseId === OPENWORLD_ID ? (desktop ? 1 : 0.6) : SCENERY_SHARE[tier];
}
