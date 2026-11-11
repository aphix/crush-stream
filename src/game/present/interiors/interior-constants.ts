import type { InteriorKind } from "../../world/openworld/walk-graph.ts";
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
export const PACK_START_VERTICES = { shell: 65536, detail: 32768, glow: 2048, glass: 2048 } as const;
/** A building's windows open (and shut) over this long (s): the painted glass thins out over the room, and a room is not dropped until its windows have shut again. */
export const OPEN_FADE_SECONDS = 0.5;
/** Lamps and screens show this share of their light in the day, all of it at night. */
export const LAMP_DAY = 0.9;
/** A shut shop's lamps and screens glow this share of their light: off but for a faint standby. */
export const CLOSED_GLOW = 0.08;
/** How much of the light a window's glass lets through (opacity of the pane drawn). */
export const GLASS_OPACITY = 0.22;
/** The side (m) of a floor, ceiling or wall cell: the grid the baked light is sampled on. */
export const ROOM_CELL = 0.75;
/** How much of its lamps' baked light a room shows by day, and the gain on its windows' daylight. */
export const LAMP_ROOM_DAY = 0.75;
export const DAY_SKY_GAIN = 1.6;
/** Lamp colour, lamp power and the ambient floor of a room, by kind: a bar is dim and amber, an office bright and cool. */
export const ROOM_LIGHT: Record<InteriorKind, { color: readonly [number, number, number]; power: number; ambient: number }> = {
  bar: { color: [1, 0.55, 0.3], power: 7, ambient: 0.04 },
  coffee: { color: [1, 0.8, 0.52], power: 12, ambient: 0.06 },
  office: { color: [0.95, 1, 1.05], power: 20, ambient: 0.08 },
  store: { color: [1, 0.97, 0.9], power: 18, ambient: 0.08 },
  rowhome: { color: [1, 0.82, 0.55], power: 11, ambient: 0.06 },
};
