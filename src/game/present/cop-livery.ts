import { carSprayLayout, SPRAY_FACE, SPRAY_PALETTE, type SprayLayout, type SprayPaint } from "../match/look-data.ts";
import { beltY } from "../vehicle/car-lines.ts";
import { COP_LIVERY } from "../vehicle/car-styles/police.ts";
import type { BodyStyle } from "../vehicle/car-variants.ts";
import { SprayBitmap } from "./spray.ts";

/**
 * A cop's black-and-white livery as spray paint: white roof, pillars and doors over the black body and POLICE across both
 * doors, drawn from the style's own tables into its spray layout. It rides the paint's spray patch, so it links no program a
 * sprayed car does not.
 */

/** The AI cops' bitmap: 512 texels a side stand a door letter ~12 texels tall (the 256 garage bitmap gives 6). */
const COP_LAYOUT = carSprayLayout(512);
const WHITE = 1;
const BLACK = 2;
/** The presets with the livery's own white and black on their inks, so the letters and panels match the body and door paint. */
const PALETTE = SPRAY_PALETTE.map((colour, ink) => (ink === WHITE ? COP_LIVERY.doors : ink === BLACK ? COP_LIVERY.body : colour));
/** Letter cap height, stroke width and the gap between letters (m): bold condensed caps about a door and a half long. */
const CAP = 0.16;
const STROKE = 0.03;
const GAP = 0.035;
/** The white door panels stop this far (m) above the rocker line: the sill stays black. */
const SILL = 0.035;

/** A letter's stroke centre lines in cap heights: x from the letter's left, y up from the baseline; `w` its width. */
type Glyph = { w: number; strokes: readonly (readonly (readonly [number, number])[])[] };
const POLICE: readonly Glyph[] = [
  { w: 0.62, strokes: [[[0, 0], [0, 1], [0.42, 1], [0.62, 0.86], [0.62, 0.64], [0.42, 0.5], [0, 0.5]]] },
  { w: 0.7, strokes: [[[0.2, 0], [0.5, 0], [0.7, 0.2], [0.7, 0.8], [0.5, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]]] },
  { w: 0.55, strokes: [[[0, 1], [0, 0], [0.55, 0]]] },
  { w: 0, strokes: [[[0, 0], [0, 1]]] },
  { w: 0.66, strokes: [[[0.66, 0.8], [0.48, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0], [0.48, 0], [0.66, 0.2]]] },
  { w: 0.55, strokes: [[[0.55, 1], [0, 1], [0, 0], [0.55, 0]], [[0, 0.5], [0.45, 0.5]]] },
];
const WORD_LENGTH = POLICE.reduce((sum, g) => sum + g.w * CAP + STROKE, 0) + GAP * (POLICE.length - 1);

const paints = new Map<string, SprayPaint>();
const sprays = new Map<BodyStyle, SprayBitmap>();

/** Style `style`'s livery as paint of `layout` (cached), or null for a car that is no cop: a style with a light bar is a cop's. */
export function copPaint(style: BodyStyle, layout: SprayLayout): SprayPaint | null {
  if (!style.lightBar) return null;
  const key = `${style.id} ${layout.w}`;
  let paint = paints.get(key);
  if (!paint) paints.set(key, (paint = drawLivery(style, layout)));
  return paint;
}

/** What a cop with no player's look wears: one mipmapped bitmap per style, shared and never disposed; null for a car that is no cop. */
export function copSpray(style: BodyStyle): SprayBitmap | null {
  const paint = copPaint(style, COP_LAYOUT);
  if (!paint) return null;
  let spray = sprays.get(style);
  if (!spray) {
    spray = new SprayBitmap(COP_LAYOUT, true);
    spray.load(paint);
    sprays.set(style, spray);
  }
  return spray;
}

function drawLivery(style: BodyStyle, layout: SprayLayout): SprayPaint {
  const texels = new Uint8Array(layout.w * layout.h);
  const [, yMin, zMin] = layout.min;
  const [, yMax, zMax] = layout.max;
  const sill = style.rocker.y + SILL;
  const [doorCut, doorFront] = style.door.aperture;
  const doorRear = style.rearDoorSeam ?? doorCut;
  const glassFront = style.windshield.base[1];
  const glassRear = style.rearGlass.base[1];
  const wordMid = (style.bPillar.rear + style.bPillar.front) / 2;
  const baseline = (beltY(wordMid, style) + sill - CAP) / 2;
  for (const face of [SPRAY_FACE.left, SPRAY_FACE.right, SPRAY_FACE.top]) {
    const [fx, fy, fw, fh] = layout.faces[face]!;
    for (let ty = 0; ty < fh; ty++) {
      for (let tx = 0; tx < fw; tx++) {
        const z = zMin + ((tx + 0.5) / fw) * (zMax - zMin);
        const y = yMin + ((ty + 0.5) / fh) * (yMax - yMin);
        const greenhouse = z > glassRear && z < glassFront;
        let ink = 0;
        if (face === SPRAY_FACE.top) ink = greenhouse ? WHITE : 0;
        else {
          if (y > beltY(z, style) ? greenhouse : y > sill && z > doorRear && z < doorFront) ink = WHITE;
          // The word reads left to right to someone facing each flank: front to rear on the +x face, rear to front on the −x face.
          const along = face === SPRAY_FACE.right ? wordMid + WORD_LENGTH / 2 - z : z - (wordMid - WORD_LENGTH / 2);
          if (onWord(along, y - baseline)) ink = BLACK;
        }
        texels[(fy + ty) * layout.w + fx + tx] = ink;
      }
    }
  }
  return { texels, palette: PALETTE };
}

/** Whether the point `along` m into the word and `up` m above its baseline lies on a letter's stroke. */
function onWord(along: number, up: number): boolean {
  if (up < -STROKE || up > CAP + STROKE || along < 0 || along > WORD_LENGTH) return false;
  let left = STROKE / 2;
  for (const glyph of POLICE) {
    for (const line of glyph.strokes) {
      for (let k = 1; k < line.length; k++) {
        const [ax, ay] = line[k - 1]!;
        const [bx, by] = line[k]!;
        if (nearSegment(along - left, up, ax * CAP, ay * CAP, bx * CAP, by * CAP, STROKE / 2)) return true;
      }
    }
    left += glyph.w * CAP + STROKE + GAP;
  }
  return false;
}

function nearSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy) <= r;
}
