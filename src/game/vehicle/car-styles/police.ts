import type { BodyStyle } from "../car-variants.ts";
import { SEDAN, SEDAN_MIRROR } from "./sedan.ts";
import { POLICE_DETAILS } from "./sedan-details.ts";

/** Black body and trim, white doors: the cop's two-tone; `present/cop-livery.ts` paints the white roof, pillars and door lettering in it. */
export const COP_LIVERY = { body: 0x0c0d0f, doors: 0xeef0f2, accent: 0x16171a } as const;

/** Police cruiser's own lamps and bumper lamps, read off its reference isos and side/top crops. */
const POLICE_LAMP_SHAPES = {
  head: {
    loops: [
      {
        points: [
          [0.44, 0.56, 1.975],
          [0.66, 0.56, 1.79],
          [0.66, 0.47, 1.79],
          [0.44, 0.47, 1.975],
        ],
      },
    ],
    lens: "lit",
    bezel: "chrome",
    cells: [
      {
        loop: {
          points: [
            [0.66, 0.56, 1.79],
            [0.76, 0.56, 1.66],
            [0.76, 0.47, 1.66],
            [0.66, 0.47, 1.79],
          ],
        },
        tone: "amber",
      },
    ],
    strips: [{ line: { points: [[0.44, 0.515, 1.975], [0.66, 0.515, 1.79]] }, width: 0.006, tone: "dark" }],
  },
  tail: {
    loops: [
      {
        points: [
          [0.42, 0.85, -2.12],
          [0.52, 0.85, -2.07],
          [0.62, 0.85, -2.0],
          [0.7, 0.85, -1.9],
          [0.72, 0.82, -1.88],
          [0.72, 0.67, -1.88],
          [0.7, 0.64, -1.9],
          [0.62, 0.64, -2.0],
          [0.52, 0.64, -2.07],
          [0.42, 0.64, -2.12],
        ],
      },
    ],
    // The cruiser's tail lamps are deep red with a lit band and dark ribs (rear iso): no amber top, no white reverse block.
    lens: "red",
    strips: [
      { line: { points: [[0.42, 0.745], [0.72, 0.745]] }, width: 0.022, tone: "lit" },
      { line: { points: [[0.42, 0.795], [0.72, 0.795]] }, width: 0.003, tone: "dark" },
      { line: { points: [[0.42, 0.695], [0.72, 0.695]] }, width: 0.003, tone: "dark" },
    ],
  },
  front: {
    loops: [{ points: [[0.52, 0.25], [0.66, 0.25], [0.66, 0.29], [0.52, 0.29]] }],
    lens: "dark",
  },
} as const;

/** The sedan as a black-and-white cruiser: livery, roof light bar, push bar and its own grille and lamp details. */
export const POLICE: BodyStyle = {
  ...SEDAN,
  id: "police",
  livery: COP_LIVERY,
  lightBar: true,
  pushBar: true,
  // The cruiser's head lamps are warm halogen reflectors (front iso).
  lamps: { head: [0.55, 0.515], tail: [0.596, 0.745], shapes: POLICE_LAMP_SHAPES, bulb: "halogen" },
  grille: { y: 0.44, size: [0.58, 0.21], kind: "bars", count: 6, badge: 0.025, finish: "black" },
  details: POLICE_DETAILS,
  /** The cruiser's mirrors are black plastic: a body-colour cap would take the white door paint. */
  door: { ...SEDAN.door, mirror: { ...SEDAN_MIRROR, finish: "black" } },
  /**
   * The cruiser's bumpers are black plastic, front and rear (both references). The sedan's seams frame its own lamps; the cop's sit lower,
   * inside its bumper corners, so its bumpers draw no seam of the sedan's, and no diffuser band on the black. Its plate sits on the lid's
   * tail face in its recess (y 0.6-0.745).
   */
  bumpers: {
    front: { ...SEDAN.bumpers.front, trim: "black", top: undefined, edge: undefined },
    rear: { ...SEDAN.bumpers.rear, trim: "black", top: undefined, edge: undefined, band: undefined, plate: 0.67 },
  },
  /** The cruiser's two small round tips under the black bumper, one each side (rear iso: |x| ~0.5; inboard 0.4 on the sedan body's narrower tail floor). */
  exhaust: { tips: 2, x: 0.4, y: 0.3, size: [0.1, 0.06], shape: "round" },
  /** The cruiser's rear window is black-tinted (rear iso), as the checklist's P1. */
  privacyGlass: { rear: true },
};
