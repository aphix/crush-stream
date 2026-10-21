import type { BodyStyle } from "../car-variants.ts";
import { SEDAN } from "./sedan.ts";
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
    lens: "lit",
    cells: [
      { loop: { points: [[0.42, 0.775], [0.72, 0.775], [0.72, 0.85], [0.42, 0.85]] }, tone: "amber" },
      { loop: { points: [[0.42, 0.64], [0.52, 0.64], [0.52, 0.7], [0.42, 0.7]] }, tone: "clear" },
    ],
    strips: [{ line: { points: [[0.42, 0.775], [0.72, 0.775]] }, width: 0.003, tone: "dark" }],
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
  lamps: { head: [0.55, 0.515], tail: [0.596, 0.745], shapes: POLICE_LAMP_SHAPES },
  grille: { y: 0.47, size: [0.6, 0.12], kind: "bars", count: 3, finish: "black" },
  details: POLICE_DETAILS,
};
