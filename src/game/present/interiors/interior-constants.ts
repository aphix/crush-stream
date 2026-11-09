import { FACADE_OPEN_MAX } from "../facades.ts";

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
/** A door opens while someone stands within this of its doorway's middle (m), swings full open or shut in this long (s), and is animated only within this of the eye (m): the envelopes' range, past which a doorway is too small to read. */
export const DOOR_REACH = 1.2;
export const DOOR_SWING_SECONDS = 0.6;
export const DOOR_RANGE = SHELL_NEAR;
/** The player's walker within this of a street door (m) is given the vestibule's floor and walls while the room behind is not built: a stoop's run and a step. */
export const VESTIBULE_REACH = 3;
/** The rooms of a street's businesses are furnished for their windows while one of their fronts is in view within `INTERIOR_NEAR`; homes (a door open and seen, a player inside) are left this many slots of the facade's list of `FACADE_OPEN_MAX`, the businesses the rest. */
const HOME_OPEN_SLOTS = 6;
export const SHOPFRONT_ROOMS = FACADE_OPEN_MAX - HOME_OPEN_SLOTS;
/** Vertices each packed mesh starts with room for (a furnished house is 6k to 16k, an envelope 1k to 2k, a set's lamps and glass a few hundred): it doubles when a build needs more, so its storage stops being made once the busiest street has been driven. */
export const PACK_START_VERTICES = { shell: 8192, detail: 32768, glow: 2048, glass: 2048 } as const;
/** A building's windows open (and shut) over this long (s): the painted glass thins out over the room, and a room is not dropped until its windows have shut again. */
export const OPEN_FADE_SECONDS = 0.5;
/** A room's solids are drawn this share of the light they are given: its walls and ceiling are lit by the open sky like a street's, and a lit room read through a window would wash out to white. */
export const INTERIOR_DIM = 0.6;
/** How much of the light a window's glass lets through (opacity of the pane drawn). */
export const GLASS_OPACITY = 0.22;
