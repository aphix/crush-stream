import { LID } from "../vehicle/constants.ts";

/**
 * A player's look as data, the same on every peer and in storage: the colours picked in the garage (`CarPick`,
 * `PersonPick`, as their URL text) and the spray paint, a small paletted bitmap per car and per driver wrapped round the
 * thing as a box. A point on its rest shape (the car's frame before any dent, the driver standing) and its normal pick one
 * of five faces (left, right, top, front, back; the underside takes none) and the point's place across that face picks the
 * texel (`sprayFace`; the shader in `present/spray.ts` runs the same formula). A texel is an ink, an index into the
 * bitmap's own palette (`SprayPaint`): the can's presets unless a colour of the player's own took an ink. 4 bits a texel on
 * the wire while it uses 15 inks or fewer (`packSpray`).
 */

/** The can's quick colours (sRGB), every bitmap's first palette; index 0 is bare (no paint). */
export const SPRAY_PALETTE: readonly number[] = [
  0, 0xf4f4f0, 0x141414, 0x808080, 0xd62828, 0xf77f00, 0xf5d300, 0x8ac926, 0x2a9d3f, 0x2ec4d6, 0x1d6fe0, 0x1b2a6b, 0x7b2cbf, 0xff5fa2, 0x7a4a24,
  0xd9b98c,
];

/** A bitmap's paint: an ink per texel (0 bare) and each ink's colour (sRGB): `SPRAY_PALETTE`, with any colour sprayed that is not a preset on an ink no texel showed, else the nearest ink (16 inks, 4 bits a texel on the wire). */
export type SprayPaint = { readonly texels: Uint8Array; readonly palette: readonly number[] };

/** Face order in a layout's `faces` and in the shader's `sprayFaces`. */
export const SPRAY_FACE = { left: 0, right: 1, top: 2, front: 3, back: 4 } as const;

/** A face's texels: x, y (from the bitmap's first row), width, height. */
type Face = readonly [number, number, number, number];
/** A bitmap's size, the rest-frame box it wraps (m) and its five faces (in `SPRAY_FACE` order). */
export type SprayLayout = { readonly w: number; readonly h: number; readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number]; readonly faces: readonly Face[] };

/** The faces are packed on a square grid this many cells a side; a bitmap of any side scales the grid, so every size wraps the box alike. */
const GRID = 128;
/** Bitmap side (texels): two a grid cell, 256 x 256. A save from when it was one a cell loads doubled (`PlayerLooks`). */
const SIDE = 2 * GRID;

/** A layout `side` texels square round the box `min`..`max`, its `faces` given in grid cells. */
function gridLayout(side: number, min: SprayLayout["min"], max: SprayLayout["max"], faces: readonly Face[]): SprayLayout {
  const k = side / GRID;
  return { w: side, h: side, min, max, faces: faces.map(([x, y, w, h]) => [x * k, y * k, w * k, h * k] as const) };
}

/** A car in its own frame (+z forward, y up from the tyre plane), `side` texels square: in grid cells, sides 128 x 30, roof 128 x 40, nose and tail 64 x 28. */
export function carSprayLayout(side: number): SprayLayout {
  const half = GRID / 2;
  return gridLayout(side, [-0.95, 0, -2.35], [0.95, 1.6, 2.35], [
    [0, 0, GRID, 30],
    [0, 30, GRID, 30],
    [0, 60, GRID, 40],
    [0, 100, half, 28],
    [half, 100, half, 28],
  ]);
}

export const CAR_SPRAY = carSprayLayout(SIDE);

/** A driver standing (`PARTS` at rest, feet at y 0, facing +z): in grid cells, front and back 40 x 92, sides 24 x 92, the head's top 25 x 36. */
export const PERSON_SPRAY = gridLayout(SIDE, [-0.4, 0, -0.25], [0.4, 1.85, 0.25], [
  [80, 0, 24, 92],
  [104, 0, 24, 92],
  [0, 92, 25, 36],
  [0, 0, 40, 92],
  [40, 0, 40, 92],
]);

/**
 * The face (`SPRAY_FACE`) rest point (px, py, pz) with normal (nx, ny, nz) is painted on, and its place across that face
 * (0..1 each) into `uv`; -1 for the underside, which takes no paint. The shader's `sprayTexel` is this, line for line.
 */
export function sprayFace(layout: SprayLayout, px: number, py: number, pz: number, nx: number, ny: number, nz: number, uv: Float64Array): number {
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  const tx = across(px, layout.min[0], layout.max[0]);
  const ty = across(py, layout.min[1], layout.max[1]);
  const tz = across(pz, layout.min[2], layout.max[2]);
  if (ax >= ay && ax >= az) {
    uv[0] = tz;
    uv[1] = ty;
    return nx < 0 ? SPRAY_FACE.left : SPRAY_FACE.right;
  }
  if (ay >= az) {
    if (ny < 0) return -1;
    uv[0] = tz;
    uv[1] = tx;
    return SPRAY_FACE.top;
  }
  uv[0] = tx;
  uv[1] = ty;
  return nz > 0 ? SPRAY_FACE.front : SPRAY_FACE.back;
}

function across(v: number, min: number, max: number): number {
  return Math.min(1, Math.max(0, (v - min) / (max - min)));
}

/** `packSpray`'s first byte: the texels as nibbles, two to a byte, or as runs (length 1-255, then the ink); `INKS` set when the bitmap's own inks follow (a count, then ink, r, g, b each). */
const PACKED = 0;
const RUNS = 1;
const INKS = 2;
const MAX_RUN = 255;

/** A bitmap's paint for the wire and for storage: runs when they come out shorter than the nibbles (a mostly bare bitmap); a bitmap of presets alone packs as before own inks existed. */
export function packSpray({ texels, palette }: SprayPaint): Uint8Array {
  const own: number[] = [];
  for (let ink = 1; ink < SPRAY_PALETTE.length; ink++) if (palette[ink] !== SPRAY_PALETTE[ink]) own.push(ink);
  const lead = own.length > 0 ? 2 + own.length * 4 : 1;
  let runs = 0;
  for (let i = 0; i < texels.length; runs++) i += runLength(texels, i);
  const asRuns = runs * 2 < texels.length / 2;
  const out = new Uint8Array(lead + (asRuns ? runs * 2 : Math.ceil(texels.length / 2)));
  out[0] = (asRuns ? RUNS : PACKED) | (own.length > 0 ? INKS : 0);
  out[1] = own.length;
  for (const [k, ink] of own.entries()) {
    const c = palette[ink]!;
    out.set([ink, c >> 16, (c >> 8) & 0xff, c & 0xff], 2 + k * 4);
  }
  if (!asRuns) {
    for (let i = 0; i < texels.length; i++) out[lead + (i >> 1)]! |= (texels[i]! & 0xf) << ((i & 1) * 4);
    return out;
  }
  let o = lead;
  for (let i = 0; i < texels.length; ) {
    const n = runLength(texels, i);
    out[o++] = n;
    out[o++] = texels[i]!;
    i += n;
  }
  return out;
}

function runLength(texels: Uint8Array, at: number): number {
  let n = 1;
  while (n < MAX_RUN && at + n < texels.length && texels[at + n] === texels[at]) n++;
  return n;
}

/** `packSpray`'s bytes back into a paint of `count` texels; null when they are not one (untrusted: a peer's or storage's). */
export function unpackSpray(bytes: Uint8Array, count: number): SprayPaint | null {
  const head = bytes[0];
  if (head === undefined || head > (RUNS | INKS)) return null;
  const palette = [...SPRAY_PALETTE];
  let o = 1;
  if (head & INKS) {
    const n = bytes[o++] ?? 0;
    if (n === 0 || o + n * 4 > bytes.length) return null;
    for (let k = 0; k < n; k++, o += 4) {
      const ink = bytes[o]!;
      if (ink === 0 || ink >= palette.length) return null;
      palette[ink] = (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!;
    }
  }
  const texels = head & RUNS ? readRuns(bytes.subarray(o), count) : readNibbles(bytes.subarray(o), count);
  return texels && { texels, palette };
}

function readNibbles(bytes: Uint8Array, count: number): Uint8Array | null {
  if (bytes.length !== Math.ceil(count / 2)) return null;
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = (bytes[i >> 1]! >> ((i & 1) * 4)) & 0xf;
  return out;
}

function readRuns(bytes: Uint8Array, count: number): Uint8Array | null {
  if (bytes.length % 2 !== 0) return null;
  const out = new Uint8Array(count);
  let at = 0;
  for (let o = 0; o < bytes.length; o += 2) {
    const n = bytes[o]!;
    const ink = bytes[o + 1]!;
    if (n === 0 || ink >= SPRAY_PALETTE.length || at + n > count) return null;
    out.fill(ink, at, at + n);
    at += n;
  }
  return at === count ? out : null;
}

/** The car's parts a colour can be picked for, in text order. */
export const CAR_PARTS = ["body", "doors", LID.hood, LID.trunk, "bumpers", "rims", "glass"] as const;
export type CarPart = (typeof CAR_PARTS)[number];
export type CarPick = Record<CarPart, number | null>;

/** The driver's colours in text order, after the build slot; `hat` null is no cap. */
const PERSON_COLOURS = ["shirt", "pants", "hair", "hat"] as const;
export type PersonPick = { woman: boolean | null; shirt: number | null; pants: number | null; hair: number | null; hat: number | null; mustache: boolean };

export const NO_CAR_PICK: CarPick = { body: null, doors: null, hood: null, trunk: null, bumpers: null, rims: null, glass: null };
export const NO_PERSON_PICK: PersonPick = { woman: null, shirt: null, pants: null, hair: null, hat: null, mustache: false };

/** Colour `c` (sRGB) as 6 hex digits: a pick's slot, and after a "#" a colour input's value. */
export const hexOf = (c: number): string => c.toString(16).padStart(6, "0");

/** One slot's colour, null when empty; undefined when it is not 6 hex digits. */
function colourOf(slot: string): number | null | undefined {
  if (slot === "") return null;
  return /^[0-9a-f]{6}$/i.test(slot) ? parseInt(slot, 16) : undefined;
}

export function carPickText(pick: CarPick): string {
  return CAR_PARTS.map((part) => (pick[part] === null ? "" : hexOf(pick[part]))).join(".");
}

/** The pick `text` names; null when it is not one (untrusted: a link's or a peer's). */
export function parseCarPick(text: string): CarPick | null {
  const slots = text.split(".");
  if (slots.length !== CAR_PARTS.length) return null;
  const pick = { ...NO_CAR_PICK };
  for (const [i, part] of CAR_PARTS.entries()) {
    const colour = colourOf(slots[i]!);
    if (colour === undefined) return null;
    pick[part] = colour;
  }
  return pick;
}

export function personPickText(pick: PersonPick): string {
  const build = pick.woman === null ? "" : pick.woman ? "w" : "m";
  return [build, ...PERSON_COLOURS.map((key) => (pick[key] === null ? "" : hexOf(pick[key]))), pick.mustache ? "1" : ""].join(".");
}

/** The pick `text` names; null when it is not one (untrusted: a link's or a peer's). */
export function parsePersonPick(text: string): PersonPick | null {
  const slots = text.split(".");
  if (slots.length !== PERSON_COLOURS.length + 2) return null;
  const build = slots[0];
  const mustache = slots.at(-1);
  if ((build !== "" && build !== "w" && build !== "m") || (mustache !== "" && mustache !== "1")) return null;
  const pick: PersonPick = { ...NO_PERSON_PICK, woman: build === "" ? null : build === "w", mustache: mustache === "1" };
  for (const [i, key] of PERSON_COLOURS.entries()) {
    const colour = colourOf(slots[i + 1]!);
    if (colour === undefined) return null;
    pick[key] = colour;
  }
  return pick;
}
