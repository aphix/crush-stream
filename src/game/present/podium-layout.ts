/** Canvas sizes (px): a block's face decal (a cup either side of the place's numeral), and the banner. */
export const DECAL_PX = { w: 512, h: 256 };
export const BANNER_PX = { w: 1536, h: 580 };

/** What a cup of size `s` covers about its centre, in tenths of `s` (`drawCup`'s unit), measured on its drawn path: placed by these, the handles stay on the canvas. */
const CUP_UNITS = { halfWidth: 5.6, up: 5, down: 5.4 };

type Box = { left: number; right: number; top: number; bottom: number };

/** The box a cup of size `s` centred at (`cx`, `cy`) covers. */
export function cupBox(cx: number, cy: number, s: number): Box {
  const u = s / 10;
  return { left: cx - CUP_UNITS.halfWidth * u, right: cx + CUP_UNITS.halfWidth * u, top: cy - CUP_UNITS.up * u, bottom: cy + CUP_UNITS.down * u };
}

/** The clear space kept between a cup and the edge of its canvas (px). */
export const EDGE_MARGIN_PX = 16;
const DECAL_CUP_SHARE = 0.56;
const DECAL_NUMERAL_SHARE = 0.8;
/** One digit of the numeral is this wide in fonts (bold sans-serif digits are 0.55 to 0.6 of their size). */
const DIGIT_WIDTH_EM = 0.62;

/** The face decal's layout: each cup's centre and size, the numeral's font size, and its widest extent about the middle. */
export function decalLayout(): { cupSize: number; cupY: number; leftX: number; rightX: number; numeralPx: number; numeralHalfWidth: number } {
  const cupSize = DECAL_PX.h * DECAL_CUP_SHARE;
  const halfWidth = cupBox(0, 0, cupSize).right;
  const numeralPx = Math.round(DECAL_PX.h * DECAL_NUMERAL_SHARE);
  return {
    cupSize,
    cupY: DECAL_PX.h * 0.5,
    leftX: EDGE_MARGIN_PX + halfWidth,
    rightX: DECAL_PX.w - EDGE_MARGIN_PX - halfWidth,
    numeralPx,
    numeralHalfWidth: (numeralPx * DIGIT_WIDTH_EM) / 2,
  };
}

/** The banner's gold frame (px): its cups are set in from it. */
export const BANNER_FRAME_PX = 56;
export function bannerLayout(): { cupSize: number; cupY: number; leftX: number; rightX: number } {
  const cupSize = BANNER_PX.h * 0.42;
  const halfWidth = cupBox(0, 0, cupSize).right;
  return { cupSize, cupY: BANNER_PX.h * 0.5, leftX: BANNER_FRAME_PX + EDGE_MARGIN_PX + halfWidth, rightX: BANNER_PX.w - BANNER_FRAME_PX - EDGE_MARGIN_PX - halfWidth };
}
