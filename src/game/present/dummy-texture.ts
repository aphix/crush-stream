import * as THREE from "three";
import { FACE, FACE_TEXELS, FACES } from "./dummy-faces.ts";
import { EYE_U, EYES_AT, FACE_SPAN, LIP_AT } from "./dummy-head.ts";
import { smooth } from "./dummy-rig.ts";

/**
 * The print atlas every dummy samples (`print` attribute: u, v, cell, weight): the reference's faces, then the small pictures
 * shells carry (a cop's badge and shoulder patch, the cap's star, a sneaker's laces). One column of `FACE_TEXELS`-square cells, cell 0 at the
 * bottom, each cell's v up. sRGB, mipmapped; alpha is how much of the print shows over the vertex's role colour.
 */

export const PRINT_CELL = { ...FACE, BADGE: FACES.length, PATCH: FACES.length + 1, EMBLEM: FACES.length + 2, LACES: FACES.length + 3, TOE_CAP: FACES.length + 4 } as const;
export const PRINT_CELLS = FACES.length + 5;
/** Texels on a side of one cell. */
export const PRINT_TEXELS = FACE_TEXELS;

type Ink = readonly [number, number, number, number];
const CLEAR: Ink = [0, 0, 0, 0];
/** Samples a side per texel when a picture is painted: its edges come out smooth. */
const SUPERSAMPLE = 3;

/**
 * The face's mask (cell u, v): an oval over the features that fades out at the cheeks and the jaw, and under the hairline so
 * the reference's hair never paints the forehead (the hair is the head's own).
 */
const FACE_MIDDLE = [0.5, 0.45] as const;
const FACE_RADII = [0.27, 0.52] as const;
const FACE_FEATHER = 0.12;
const BROW_FADE = [0.82, 0.92] as const;

function faceAlpha(u: number, v: number): number {
  const du = (u - FACE_MIDDLE[0]) / FACE_RADII[0];
  const dv = (v - FACE_MIDDLE[1]) / FACE_RADII[1];
  const distance = Math.sqrt(du * du + dv * dv);
  return (1 - smooth(1 - FACE_FEATHER, 1, distance)) * (1 - smooth(BROW_FADE[0], BROW_FADE[1], v));
}

/** A star of `points` arms (outer radius `outer`, inner `inner`) round (cx, cy), turned so an arm points up. */
function inStar(u: number, v: number, cx: number, cy: number, outer: number, inner: number, points: number): boolean {
  const angle = Math.atan2(u - cx, v - cy);
  const sector = (2 * Math.PI) / points;
  const along = Math.abs((((angle % sector) + sector) % sector) - sector / 2) / (sector / 2);
  return Math.sqrt((u - cx) ** 2 + (v - cy) ** 2) < inner + (outer - inner) * along ** 2;
}

/** A shield: straight sides down from a flat top, curving in to a point at the bottom. */
function inShield(u: number, v: number, top: number, bottom: number, halfWidth: number): boolean {
  if (v > top || v < bottom) return false;
  const shoulder = bottom + (top - bottom) * 0.45;
  const reach = v >= shoulder ? halfWidth : halfWidth * Math.sqrt((v - bottom) / (shoulder - bottom));
  return Math.abs(u - 0.5) <= reach;
}

const SILVER: Ink = [196, 201, 208, 255];
const SILVER_DARK: Ink = [118, 124, 134, 255];
const PATCH_FIELD: Ink = [143, 162, 196, 255];
const PATCH_BORDER: Ink = [28, 38, 66, 255];
const STAR_WHITE: Ink = [236, 236, 230, 255];
/** The badge: an eight-pointed silver star plate with a darker ring and star struck into it (the reference's police badge). */
function badge(u: number, v: number): Ink {
  if (!inStar(u, v, 0.5, 0.5, 0.47, 0.38, 8)) return CLEAR;
  const ring = Math.abs(Math.sqrt((u - 0.5) ** 2 + (v - 0.5) ** 2) - 0.26) < 0.035;
  return ring || inStar(u, v, 0.5, 0.5, 0.2, 0.09, 5) ? SILVER_DARK : SILVER;
}

/** The cop's shoulder patch: a grey-blue shield with a navy border and a white star. */
function patch(u: number, v: number): Ink {
  if (!inShield(u, v, 0.94, 0.04, 0.42)) return CLEAR;
  if (!inShield(u, v, 0.88, 0.12, 0.35)) return PATCH_BORDER;
  return inStar(u, v, 0.5, 0.58, 0.2, 0.08, 5) ? STAR_WHITE : PATCH_FIELD;
}

/** The cap's emblem: a white six-armed star with a ball on each arm (the reference's cap). */
function emblem(u: number, v: number): Ink {
  if (inStar(u, v, 0.5, 0.5, 0.36, 0.16, 6)) return STAR_WHITE;
  for (let k = 0; k < 6; k++) {
    const angle = (k * Math.PI) / 3;
    if ((u - 0.5 - 0.4 * Math.sin(angle)) ** 2 + (v - 0.5 - 0.4 * Math.cos(angle)) ** 2 < 0.06 ** 2) return STAR_WHITE;
  }
  return CLEAR;
}

/** The laces print's size (m across, m up) over a sneaker's instep. */
export const LACES_SIZE = [0.042, 0.08] as const;
/** The reference's cream laces: lighter than the grey canvas, darker than the white rubber. */
const LACE: Ink = [214, 206, 190, 255];
/** Crosses up the tongue, as on the reference's high-tops. */
const LACE_CROSSES = 5;
/** The eyelet rows' inset (a share of the width) and the lace's half width (m). */
const EYELET_U = 0.12;
const LACE_HALF_WIDTH = 0.0018;
/** Clear rows (a share of the height) at the top and bottom, past the lace's half width, so a point clamped to the cell's edge shows no lace. */
const LACE_PAD = 0.06;
/** A sneaker's laces: crossed between two eyelet rows, `LACE_CROSSES` crosses up the tongue. */
function laces(u: number, v: number): Ink {
  const step = (1 - 2 * LACE_PAD) / LACE_CROSSES;
  const cross = Math.floor((v - LACE_PAD) / step);
  if (cross < 0 || cross >= LACE_CROSSES) return CLEAR;
  const [y0, y1, y] = [(LACE_PAD + cross * step) * LACES_SIZE[1], (LACE_PAD + (cross + 1) * step) * LACES_SIZE[1], v * LACES_SIZE[1]];
  const x = u * LACES_SIZE[0];
  for (const [from, to] of [[EYELET_U, 1 - EYELET_U], [1 - EYELET_U, EYELET_U]] as const) {
    const [x0, x1] = [from * LACES_SIZE[0], to * LACES_SIZE[0]];
    const along = Math.min(1, Math.max(0, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)));
    if ((x - x0 - along * (x1 - x0)) ** 2 + (y - y0 - along * (y1 - y0)) ** 2 < LACE_HALF_WIDTH ** 2) return LACE;
  }
  return CLEAR;
}

/** The toe cap print's size (m across, m up): over the toe from the sole's top, narrower than the foot at its ball so the sides stay canvas. */
export const TOE_CAP_SIZE = [0.09, 0.03] as const;
/** The sneaker's cream rubber (sRGB): its sole's palette colour and the toe cap's ink; the reference's #b2a092 under the showcase light. */
export const RUBBER_WHITE = 0xa29995;
const RUBBER: Ink = [(RUBBER_WHITE >> 16) & 255, (RUBBER_WHITE >> 8) & 255, RUBBER_WHITE & 255, 255];
/** The cap's crown (a share of the height) at its middle, falling to the sole at its sides; clear columns (a share of the width) at each side so a clamped point shows none. */
const CAP_CROWN = 0.9;
const CAP_INSET = 0.04;
/** A sneaker's toe cap: white rubber under a half-ellipse arc, highest over the middle of the toe, the reference's rounded cap. */
function toeCap(u: number, v: number): Ink {
  const across = (u - 0.5) / (0.5 - CAP_INSET);
  return Math.abs(across) < 1 && v < CAP_CROWN * Math.sqrt(1 - across * across) ? RUBBER : CLEAR;
}

/** Paint `picture` into cell `cell`, supersampled; a clear texel keeps the picture's colour so mips do not darken its edge. */
function paint(px: Uint8Array, cell: number, picture: (u: number, v: number) => Ink, base: Ink): void {
  for (let y = 0; y < PRINT_TEXELS; y++) {
    for (let x = 0; x < PRINT_TEXELS; x++) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const ink = picture((x + (sx + 0.5) / SUPERSAMPLE) / PRINT_TEXELS, (y + (sy + 0.5) / SUPERSAMPLE) / PRINT_TEXELS);
          const shown = ink[3] > 0 ? ink : base;
          for (let c = 0; c < 3; c++) sum[c]! += shown[c]! * (ink[3] / 255) + base[c]! * (1 - ink[3] / 255);
          sum[3]! += ink[3];
        }
      }
      const i = ((cell * PRINT_TEXELS + y) * PRINT_TEXELS + x) * 4;
      for (let c = 0; c < 4; c++) px[i + c] = Math.round(sum[c]! / (SUPERSAMPLE * SUPERSAMPLE));
    }
  }
}

/** Face `face`'s cell: the baked picture (rows from the top) under its mask. */
function paintFace(px: Uint8Array, face: number): void {
  const rgb = Uint8Array.from(atob(FACES[face]!.rgb), (char) => char.charCodeAt(0));
  for (let y = 0; y < PRINT_TEXELS; y++) {
    for (let x = 0; x < PRINT_TEXELS; x++) {
      const from = ((PRINT_TEXELS - 1 - y) * PRINT_TEXELS + x) * 3;
      const i = ((face * PRINT_TEXELS + y) * PRINT_TEXELS + x) * 4;
      px.set(rgb.subarray(from, from + 3), i);
      px[i + 3] = Math.round(255 * faceAlpha((x + 0.5) / PRINT_TEXELS, (y + 0.5) / PRINT_TEXELS));
    }
  }
}

function buildAtlas(): THREE.DataTexture {
  const px = new Uint8Array(PRINT_TEXELS * PRINT_TEXELS * PRINT_CELLS * 4);
  for (let face = 0; face < FACES.length; face++) paintFace(px, face);
  paint(px, PRINT_CELL.BADGE, badge, SILVER);
  paint(px, PRINT_CELL.PATCH, patch, PATCH_BORDER);
  paint(px, PRINT_CELL.EMBLEM, emblem, STAR_WHITE);
  paint(px, PRINT_CELL.LACES, laces, LACE);
  paint(px, PRINT_CELL.TOE_CAP, toeCap, RUBBER);
  const texture = new THREE.DataTexture(px, PRINT_TEXELS, PRINT_TEXELS * PRINT_CELLS);
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const atlas = buildAtlas();

/** The shared print atlas. One texture for every slot; the vertex's cell (or the slot's face) picks the cell. */
export function printMap(): THREE.DataTexture {
  return atlas;
}

/** The face's relief (m, crest over hollow): brow ridges, eye sockets, the lips and the chin a few millimetres proud. */
export const FACE_RELIEF = 0.005;
/** The features' rows in a face cell's v: the eyes, the brows 4 texels over them, the nose's tip half way to the mouth, and the mouth. */
const EYE_V = EYES_AT / FACE_SPAN;
const BROW_V = EYE_V + 4 / FACE_TEXELS;
const MOUTH_V = LIP_AT / FACE_SPAN;
const NOSE_V = (EYE_V + MOUTH_V) / 2;

/** A bump of `height` at (u0, v0) over radii (ru, rv) in the cell. */
function bump(u: number, v: number, u0: number, v0: number, ru: number, rv: number, height: number): number {
  return height * Math.exp(-(((u - u0) / ru) ** 2) - ((v - v0) / rv) ** 2);
}

/** The face's height (-1 hollow to 1 crest) at cell (u, v), one shape for every face: they all have their features on the same rows. */
function faceHeight(u: number, v: number): number {
  const side = Math.abs(u - 0.5);
  const eyes = bump(side, v, EYE_U, EYE_V, 0.075, 0.05, -0.8) + bump(side, v, EYE_U, EYE_V, 0.035, 0.022, 0.5);
  const brows = bump(side, v, EYE_U, BROW_V, 0.11, 0.03, 0.7);
  const nose = bump(side, v, 0.06, NOSE_V - 0.02, 0.03, 0.03, 0.4) + bump(side, v, 0.035, NOSE_V - 0.05, 0.015, 0.012, -0.5);
  const mouth = bump(side, v, 0, MOUTH_V + 0.022, 0.08, 0.018, 0.6) + bump(side, v, 0, MOUTH_V - 0.026, 0.07, 0.02, 0.7) + bump(side, v, 0, MOUTH_V, 0.09, 0.008, -0.7);
  const folds = bump(side - 0.07 - (0.04 * (NOSE_V - v)) / (NOSE_V - MOUTH_V), v, 0, (NOSE_V + MOUTH_V) / 2, 0.012, 0.09, -0.4);
  const chin = bump(side, v, 0, MOUTH_V - 0.14, 0.09, 0.05, 0.5) + bump(side, v, 0, MOUTH_V - 0.07, 0.06, 0.012, -0.3);
  const cheeks = bump(side, v, 0.24, EYE_V - 0.1, 0.08, 0.06, 0.4);
  return Math.max(-1, Math.min(1, eyes + brows + nose + mouth + folds + chin + cheeks));
}

function buildRelief(): THREE.DataTexture {
  const px = new Uint8Array(FACE_TEXELS * FACE_TEXELS);
  for (let y = 0; y < FACE_TEXELS; y++) {
    for (let x = 0; x < FACE_TEXELS; x++) px[y * FACE_TEXELS + x] = Math.round(127.5 + 127.5 * faceHeight((x + 0.5) / FACE_TEXELS, (y + 0.5) / FACE_TEXELS));
  }
  const texture = new THREE.DataTexture(px, FACE_TEXELS, FACE_TEXELS, THREE.RedFormat);
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

const relief = buildRelief();

/** The faces' shared relief, one face cell's u and v, linear (0.5: flat): the shader's bump over the face print. */
export function faceReliefMap(): THREE.DataTexture {
  return relief;
}
