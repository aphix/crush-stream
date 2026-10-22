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
          [0.44, 0.6, 1.975],
          [0.66, 0.6, 1.79],
          [0.66, 0.48, 1.79],
          [0.44, 0.48, 1.975],
        ],
      },
    ],
    // The halogen glow fills the reflector's middle, its chrome rim round it, the hood's edge right over the lamp (front iso).
    lens: "chrome",
    bezel: "chrome",
    cells: [
      {
        loop: {
          points: [
            [0.66, 0.6, 1.79],
            [0.74, 0.58, 1.68],
            [0.74, 0.48, 1.68],
            [0.66, 0.48, 1.79],
          ],
        },
        tone: "amber",
      },
      { loop: { points: [[0.46, 0.585, 1.958], [0.64, 0.585, 1.807], [0.64, 0.495, 1.807], [0.46, 0.495, 1.958]] }, tone: "lit" },
    ],
  },
  tail: {
    loops: [
      {
        points: [
          [0.52, 0.64, -2.07],
          [0.55, 0.72, -2.06],
          [0.59, 0.8, -2.03],
          [0.63, 0.86, -1.99],
          [0.68, 0.895, -1.93],
          [0.72, 0.9, -1.88],
          [0.74, 0.885, -1.83],
          [0.75, 0.85, -1.79],
          [0.755, 0.77, -1.76],
          [0.755, 0.69, -1.76],
          [0.75, 0.65, -1.78],
          [0.73, 0.64, -1.85],
          [0.62, 0.64, -2.0],
        ],
      },
    ],
    // The cruiser's tail lamps are deep red with a lit band and dark ribs (rear iso): a rounded wedge a little taller than wide, its
    // inner edge leaning in to the tail's top corner, wrapping 10 cm onto the quarter.
    lens: "red",
    strips: [
      { line: { points: [[0.58, 0.745, -2.04], [0.62, 0.745, -2.0], [0.72, 0.745, -1.87], [0.755, 0.745, -1.77]] }, width: 0.022, tone: "lit" },
      { line: { points: [[0.61, 0.795, -2.01], [0.63, 0.795, -1.99], [0.72, 0.795, -1.87], [0.755, 0.795, -1.77]] }, width: 0.003, tone: "dark" },
      { line: { points: [[0.56, 0.695, -2.05], [0.62, 0.695, -2.0], [0.72, 0.695, -1.87], [0.755, 0.695, -1.77]] }, width: 0.003, tone: "dark" },
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
  /** The cruiser's A-posts take the livery's white. */
  blackout: { ...SEDAN.blackout, a: false },
  /** The cruiser's rear window is black-tinted (rear iso), as the checklist's P1. */
  privacyGlass: { rear: true },
};
