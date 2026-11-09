/** Furniture, partitions, stairs and upper floors are built for an interior whose door is within this of the eye (m), and dropped once it is past `INTERIOR_FAR` for `INTERIOR_LINGER`. */
export const INTERIOR_NEAR = 35;
export const INTERIOR_FAR = 45;
/** The envelope (the walls and floor seen through a door or a shopfront window) is kept this near (m), and dropped past `SHELL_FAR`. */
export const SHELL_NEAR = 110;
export const SHELL_FAR = 130;
/** How long an interior must stay out of range before it is dropped (s), so walking along a street does not build and drop one at a boundary. */
export const INTERIOR_LINGER = 3;
/** Envelopes built in one frame (a few quads: cheap), and furnished interiors (thousands of vertices to merge: one hitch at most). */
export const SHELL_BUILDS_PER_FRAME = 8;
export const DETAIL_BUILDS_PER_FRAME = 1;
/** An interior's solids are handed to the physics while its door is within this of the eye (m): a walker meets walls and furniture only near a player. */
export const SOLIDS_NEAR = 25;
