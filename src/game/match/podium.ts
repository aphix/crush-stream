/** A racer on the podium: car id (its slot in the field), the name the standings show, and the place. */
export type PodiumPlace = { id: number; name: string; place: 1 | 2 | 3 };

/** One of the three blocks: its place, the x of its middle (m, the viewer's right is +), its height above the platform (m) and the yaw its car faces (rad; 0 faces the viewer, +z). */
type PodiumBlock = { place: 1 | 2 | 3; x: number; top: number; yaw: number };

/** The blocks' footprint (m): a car's length (4.5 m) turned a quarter radian inward still fits the depth, and its width leaves a margin either side. */
export const BLOCK_WIDTH = 4.2;
export const BLOCK_DEPTH = 5.6;
/** The gap between neighbouring blocks (m): a hairline, so the three read as one stand. */
export const BLOCK_GAP = 0.15;
/** The blocks' height above the platform (m), by place: the winner clearly above the second, the third lowest (owner: "1st place in middle being higher than 2nd on left and third on right lower than 2nd"). */
const BLOCK_TOPS: readonly [number, number, number] = [2.2, 1.6, 1.1];
/** How far the second and third cars turn in toward the winner (rad): a three-quarter pose, the nose toward the middle. */
const INWARD_YAW = 0.45;

/** The stand: the winner's block in the middle, the second's on the viewer's left, the third's on the right, each car's nose turned toward the winner. */
export const PODIUM_BLOCKS: readonly PodiumBlock[] = [
  { place: 1, x: 0, top: BLOCK_TOPS[0], yaw: 0 },
  { place: 2, x: -(BLOCK_WIDTH + BLOCK_GAP), top: BLOCK_TOPS[1], yaw: INWARD_YAW },
  { place: 3, x: BLOCK_WIDTH + BLOCK_GAP, top: BLOCK_TOPS[2], yaw: -INWARD_YAW },
];

/**
 * The podium of a classification: its first three rows in order (fewer when the field is smaller), each named as the standings name it.
 * `rows` are in classification order (a race's results, a campaign's standings); a row's own `place` is not read, so a campaign's rows need none.
 */
export function podiumPlaces(rows: readonly { id: number; name: string }[]): PodiumPlace[] {
  const places: PodiumPlace[] = [];
  for (let i = 0; i < PODIUM_BLOCKS.length && i < rows.length; i++) places.push({ id: rows[i]!.id, name: rows[i]!.name, place: PODIUM_BLOCKS[i]!.place });
  return places;
}
