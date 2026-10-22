import type { BodyStyle } from "../car-variants.ts";
import { DECK_RISE } from "../constants.ts";
import { CABIN_TUB, PLATFORM_CAMERA, PLATFORM_HARDPOINTS, PLATFORM_WHEEL, st } from "./platform.ts";
import { SEDAN_DETAILS } from "./sedan-details.ts";

/** Sedan's own lamps and bumper lamps, read off its reference isos and side/top crops. */
const SEDAN_LAMP_SHAPES = {
  head: {
    loops: [
      {
        points: [
          [0.42, 0.575, 1.97],
          [0.52, 0.572, 1.92],
          [0.62, 0.576, 1.84],
          [0.7, 0.585, 1.7],
          [0.75, 0.605, 1.6],
          [0.78, 0.65, 1.54],
          [0.785, 0.7, 1.515],
          [0.76, 0.69, 1.6],
          [0.73, 0.682, 1.66],
          [0.7, 0.675, 1.72],
          [0.65, 0.665, 1.8],
          [0.58, 0.645, 1.88],
          [0.5, 0.62, 1.93],
          [0.42, 0.6, 1.97],
        ],
      },
    ],
    // The reference's lamp reads dark inside (front iso): a smoked lens under its lit DRL strip, in a bright rim, not a white-filled eye.
    lens: "smoked",
    bezel: "chrome",
    recess: 0.012,
    strips: [
      {
        line: {
          points: [
            [0.43, 0.583, 1.965],
            [0.62, 0.584, 1.835],
            [0.7, 0.593, 1.7],
            [0.75, 0.612, 1.6],
            [0.78, 0.655, 1.54],
            [0.785, 0.695, 1.52],
          ],
        },
        width: 0.01,
        tone: "lit",
      },
      { line: { points: [[0.66, 0.668, 1.81], [0.715, 0.668, 1.67]] }, width: 0.004, tone: "dark" },
      { line: { points: [[0.66, 0.652, 1.81], [0.715, 0.652, 1.67]] }, width: 0.004, tone: "dark" },
      { line: { points: [[0.66, 0.636, 1.81], [0.715, 0.636, 1.67]] }, width: 0.004, tone: "dark" },
    ],
    rounds: [{ at: [0.56, 0.597, 1.89], r: 0.02, tone: "lit" }],
  },
  tail: {
    loops: [
      {
        points: [
          [0.745, 0.855, -1.72],
          [0.725, 0.864, -1.81],
          [0.69, 0.87, -1.88],
          [0.63, 0.87, -1.96],
          [0.55, 0.866, -2.05],
          [0.45, 0.855, -2.1],
          [0.4, 0.842, -2.12],
          [0.4, 0.776, -2.12],
          [0.45, 0.772, -2.1],
          [0.55, 0.765, -2.05],
          [0.63, 0.757, -1.96],
          [0.69, 0.756, -1.88],
          [0.725, 0.768, -1.81],
          [0.745, 0.8, -1.74],
        ],
      },
    ],
    // The reference's tail lens is deep red; only its LED strip glows (the strip below stays `lit`).
    lens: "red",
    bezel: "chrome",
    strips: [
      {
        line: {
          points: [
            [0.74, 0.842, -1.73],
            [0.69, 0.855, -1.88],
            [0.55, 0.851, -2.05],
            [0.41, 0.828, -2.115],
          ],
        },
        width: 0.012,
        tone: "lit",
      },
      { line: { points: [[0, 0.809], [0.4, 0.809]] }, width: 0.006, tone: "chrome" },
    ],
  },
  // The fog pods in the bumper's corners, and the wide dark lower intake between them (front iso), its ends off the centre line's seam:
  // near as tall as the reference's (5 cm, against the grille's 26), 2.5 cm of body colour under the grille, down to the chin's tuck
  // (under 0.225 the fascia faces the road: no skin for a lamp). Met on the body too: the fascia's wrapped corner is held inside it.
  front: {
    loops: [
      { points: [[0.5, 0.26], [0.66, 0.26], [0.66, 0.35], [0.5, 0.35]] },
      { points: [[0.006, 0.275], [0.3, 0.273], [0.45, 0.27], [0.47, 0.255], [0.4, 0.232], [0.2, 0.228], [0.006, 0.226]] },
    ],
    lens: "dark",
    bezel: "black",
    rounds: [{ at: [0.58, 0.305], r: 0.018, tone: "clear" }],
    onBody: true,
  },
  // The reference's rear reflectors: thin red strips low on the bumper's corners (rear iso; side y ~0.49), not blocks.
  rear: {
    loops: [{ points: [[0.48, 0.47], [0.63, 0.47], [0.63, 0.5], [0.48, 0.5]] }],
    lens: "red",
    onBody: true,
  },
} as const;

/**
 * The reference's mirror: a long, slim, rounded body-colour housing on a stalk at the door glass's front corner. Off the gridded side
 * (430 px/m along z, 421 up): the housing runs z 0.42-0.565 (0.145 along the car) and stands about 0.095 tall over its stalk; off the
 * top it reaches |x| 0.88 from the skin at 0.752: the door's mirrorReach 0.128. Its 0.12 width leaves the cap's inner face 8 mm off the
 * seat, over the foot (a cap wider than reach - 0.005 buries itself in the door).
 */
export const SEDAN_MIRROR = { cap: "tear", finish: "body", size: [0.12, 0.095, 0.145] } as const;

export const SEDAN: BodyStyle = {
  id: "sedan",
  dims: { wheelbase: 2.5, overhang: { front: 0.804, rear: 0.925 }, track: 1.36, width: 1.64, height: 1.337, rideHeight: 0.165, wheel: { radius: 0.342, width: PLATFORM_WHEEL.width } },
  /** wTop stays 1.16: the top view's 1.06 header narrowed the roof cage the house-of-cards stack rests on (its roofs gave 94 mm, bar 15). */
  windshield: { base: [0.95, 0.93], wBase: 1.4, wTop: 1.16 },
  bPillar: { rear: -0.31, front: -0.21 },
  /**
   * The sill's half-width narrows behind the B-pillar as the reference's (top grid: the side glass's outer line at |x| ~0.70 along the
   * rear door, tapering to ~0.63 where the rear pillar's foot meets the haunch at z -1.2): one 0.74 stood the rear pillar's foot on the
   * body side where the tail narrows to hw 0.72-0.76.
   */
  /**
   * The belt (the side glass's sill) runs at 0.90 to the door glass's front edge, then down to the cowl's corner at 0.86 by the
   * windshield's foot, as the reference's A-pillar foot meets its fender (the crowned hood's fender line).
   */
  belt: {
    x: [[-1.2, 0.64], [-0.88, 0.7], [-0.5, 0.72], [0.4, 0.74]],
    y: [[-1.23, 1.0], [-1.15, 0.98], [-0.9, 0.948], [-0.5, 0.913], [0.4, 0.9], [0.66, 0.9], [0.95, 0.86]],
  },
  rocker: { y: 0.21 },
  /** The wheel opening about its hub as the reference's: 26 px of silver-sedan-1.png (70.1 px/m) is .371, its top at .685 over the ground. */
  arch: { radius: 0.375, lip: { flare: 0.008, width: 0.035 } },
  /** The flank under the feature line lifts onto the front arch's flare hardest over z 1.39-1.58, between 9-10 cm stations: split those two gaps. */
  ringSplit: [1.4, 1.57],
  /**
   * The hood's rear edge stands ahead of the windshield's foot (0.95), as the reference's: in its top view the bonnet ends ~1.0 on
   * the centre line, the dark cowl and wipers (`blackout.cowl`) between it and the glass. Hinged 2 cm behind that edge, as before.
   * Crowned as the reference's, one soft dome falling 6 cm from the centre line to |x| 0.66: the stations under it sit the fenders that
   * much under the centre line, which stays on the reference's side silhouette (yBelt = old + 0.021 - 0.06 ((hw - 0.07) / 0.66)^2).
   * Its shut lines run onto the fender tops as the reference's: 9 cm inside the side at the nose, 18 at the cowl (top view, front iso).
   */
  hood: { z0: 0.99, z1: 1.97, origin: [0.81, 0.97], crown: [0.06, 0.66], inset: [0.09, 0.18] },
  // Body-colour fascias, as the reference's: its black is the lower intake, grille and diffuser (`details`, grille, tail trim), not the
  // bumper. Seams off the gridded side reference: the front bumper up to the head lamp's lower edge and round to the front arch, the rear
  // one up to the tail lamp's lower edge (under the lid, its shut line) and round the quarter to the rear arch; both follow their arch's lip.
  bumpers: {
    front: {
      ...PLATFORM_HARDPOINTS.bumpers.front,
      seat: { y: 0.34, z: 1.965 },
      /**
       * The reference's nose profile (silver-sedan-1.png pixels, 70.1 px/m): its face stands near upright, most forward (2.054, the dims'
       * nose) at y 0.39-0.43, which is its grille's face (the grille's own 2.055, the bumper's loose box front), 2.035-2.045 down to
       * 0.25, tucks back to 1.99 at 0.205 and closes at 0.20 on the body's underside; no splitter lip standing proud at 0.27. The shell's
       * nose (2.054) stands under the grille's bottom rim (y 0.29); behind its backing (1.2 cm behind its face, from y 0.322) the fascia
       * stands at 2.039: at 2.054 it showed between the slats.
       */
      fascia: [
        [0.1, -0.07],
        [0.1, 0.03],
        [0.095, 0.06],
        [0.08, 0.072],
        [-0.02, 0.074],
        [-0.05, 0.089],
        [-0.09, 0.07],
        [-0.115, 0.055],
        [-0.135, 0.025],
        [-0.14, -0.07],
      ],
      span: 0.74,
      wrap: { from: 0.33, back: 0.242 },
      trim: "body",
      top: [[0, 0.545], [0.42, 0.558], [0.52, 0.555], [0.62, 0.559]],
      edge: [[1.7, 0.568], [1.61, 0.583], [1.66, 0.5], [1.683, 0.42], [1.69, 0.32], [1.67, 0.22]],
    },
    rear: {
      ...PLATFORM_HARDPOINTS.bumpers.rear,
      seat: { y: 0.52, z: 2.088 },
      /**
       * The reference's rear bumper, one smooth face from under the lid down to its diffuser (silver-sedan-1.png, 70.1 px/m): leaning out
       * from 2 cm behind the tail panel at its top (0.62) to its rearmost (2.175, the dims' tail) at y 0.45-0.50, 2 cm forward by 0.41
       * where the dark diffuser band starts (rows at its edges, y 0.41 and 0.23, for the band's crisp edges), tucking 8 cm forward to its
       * bottom at 0.23; flat across to |x| 0.42, then its corner turns onto the body side and runs along it (`wrap.end`): the plain wrap
       * shrank its section into a pill. Its band rows (0.41-0.23) are the reference's black diffuser; its plate sits on the lid's tail face
       * in the lid's recess (y 0.63-0.755), its inner face on the face's 2.109 at |x| 0.18.
       */
      fascia: [
        [0.1, -0.07],
        [0.1, 0.02],
        [0.075, 0.048],
        [0.035, 0.072],
        [-0.02, 0.087],
        [-0.07, 0.084],
        [-0.11, 0.07],
        [-0.2, 0.045],
        [-0.29, 0.008],
        [-0.29, -0.07],
      ],
      span: 0.76,
      wrap: { from: 0.42, back: 0.24, end: { corner: 0.12, stand: 0.007 } },
      trim: "body",
      band: [0.23, 0.41],
      plate: 0.685,
      plateFace: { out: 0.041 },
      top: [[0, 0.61], [0.46, 0.61], [0.5, 0.738], [0.6, 0.738]],
      edge: [[-1.83, 0.738], [-1.81, 0.7], [-1.8, 0.665], [-1.76, 0.625], [-1.71, 0.595], [-1.62, 0.58], [-1.66, 0.5], [-1.683, 0.42], [-1.69, 0.32]],
    },
  },
  door: { hingeX: 0.815, hingeY: 0.57, hingeZ: 0.74, length: 0.98, halfHeight: 0.33, mirrorY: 0.33, mirrorZ: 0.2, mirrorReach: 0.128, mirrorHalfDepth: 0.08, aperture: [-0.26, 0.74], mirror: SEDAN_MIRROR },
  aPillarFoot: 0.66,
  aPillarTop: 0.08,
  /** The door glass's front edge rises from the foot to the A-post at y 1.0 (the mirror cap's top), as the reference's: only the foot's small triangle below is the black sail. */
  aPillarKnee: 1.0,
  glassTop: 0.05,
  underside: [
    [-2.14, 0.35],
    [-2.04, 0.275],
    [-1.94, 0.253],
    [-1.84, 0.235],
    [-1.74, 0.221],
    [-1.62, 0.19],
    [-1.5, 0.165],
    [1.55, 0.165],
    [1.71, 0.17],
    [1.81, 0.182],
    [1.91, 0.185],
    [2.0, 0.2],
  ],
  profile: [
    st(-2.095, 0.58, 0.925),
    st(-2.06, 0.62, 0.955),
    st(-2.034, 0.641, 0.958),
    st(-1.948, 0.7, 0.962),
    st(-1.884, 0.715, 0.971),
    st(-1.755, 0.74, 0.986),
    st(-1.649, 0.725, 0.99, 1.06, 0.48, 0.25),
    st(-1.159, 0.765, 0.99, 1.212, 0.5, 1),
    st(-1.018, 0.785, 0.974, 1.262, 0.511, 1),
    st(-0.872, 0.805, 0.954, 1.29, 0.521, 1),
    st(-0.629, 0.81, 0.942, 1.302, 0.525, 1),
    st(-0.4, 0.812, 0.935, 1.311, 0.525, 1),
    st(-0.169, 0.812, 0.92, 1.306, 0.525, 1),
    st(0.03, 0.812, 0.911, 1.282, 0.52, 1),
    st(0.15, 0.802, 0.905, 1.262, 0.52, 1),
    st(0.358, 0.802, 0.895, 1.265, 0.5, 1),
    st(0.572, 0.815, 0.89, 1.17, 0.5, 1),
    st(0.751, 0.808, 0.9, 1.085, 0.5, 1),
    st(0.886, 0.795, 0.904, 1.03, 0.5, 0.5),
    st(0.986, 0.79, 0.856, 0.922, 0.5, 0.25),
    st(1.235, 0.79, 0.823),
    st(1.481, 0.765, 0.787),
    st(1.642, 0.749, 0.748),
    st(1.734, 0.746, 0.716),
    st(1.82, 0.692, 0.68),
    st(1.898, 0.574, 0.66),
    st(1.995, 0.467, 0.604),
  ],
  roofZ: [-1.159, 0.15],
  windshieldTop: [1.285, 0.15],
  rearGlass: { base: [1.02, -1.68], top: [1.235, -1.159], wBase: 1.05, wTop: 1.0 },
  quarter: { zRearBot: -0.88, zRearTop: -0.88 },
  midPillarZ: null,
  /**
   * The reference's B-pillar is gloss black and leans: 0.165 wide at the belt (z -0.21..-0.375), 0.105 at the roof (-0.27..-0.375), its
   * rear edge upright, its front edge the front door frame's leaning rear edge. The sail by the mirror is black too; the A-post and the
   * rear pillar are body colour.
   */
  pillars: { b: { width: [0.165, 0.105], z: [-0.2925, -0.3225] } },
  blackout: { sail: true, b: true, cowl: true },
  /** The side window's line ends at the belt here, behind the quarter glass (reference side view); the C-pillar sails onto the haunch. */
  cPillar: { tip: [0.99, -1.23] },
  rearBulkhead: { z: -0.72, yTop: 0.84 },
  tubs: [CABIN_TUB],
  rearDoorSeam: -1.06,
  /**
   * The owner's sedan lid: hinged at the rear glass's base, it wraps the tail (deck plus the upper rear face). The reference's lid seam
   * (rear iso) runs down the tail face through each tail lamp's inner third (|x| ~0.53 at the lamps) to the plate recess's bottom
   * (y ~0.62), its bottom corners at |x| ~0.45; the face stands on the tail at -2.10. The ducktail: the deck dips into a shallow groove
   * and kicks up into the lip at its rear edge (gridded side: crest y 0.955 over z -2.0..-2.09, ~1.2 cm proud of the deck line). Its
   * crown 2 cm over the edge at |x| 0.6: at CarPanels3's 3 cm its centre line stood up to 3.9 cm over the side reference's deck
   * (side IoU .977 -> .9759).
   */
  boot: { kind: "lid", z0: -1.65, z1: -2.1, origin: [0.97, -1.62], pivot: [1.02, -1.68], drop: { y: 0.62, w: 0.45 }, lip: { rise: DECK_RISE, depth: 0.06 }, crown: [0.02, 0.6], edgeRoll: 0.015 },
  lamps: { head: [0.637, 0.631], tail: [0.599, 0.815], shapes: SEDAN_LAMP_SHAPES },
  // The reference's shield: 0.74 across at the top, tapering to 0.66 at its rounded bottom corners (S08: (0.30, 0.308), (0.34, 0.33)),
  // its top up under the hood's front edge (~0.60, level with the head lamps' inner ends, front iso) as far as the bumper's loose box
  // holds it: 0.30-0.585, its chrome rim (3 mm proud) inside that, so its face 3 mm behind the box's front at 2.055. Black: its slats and
  // backing read dark under the thin rim; all-chrome read as a light block (owner's front slice).
  grille: { y: 0.443, z: 2.052, size: [0.74, 0.264], bottom: 0.66, round: 0.05, kind: "slats", count: 19, finish: "black", bezel: 0.01 },
  /**
   * The reference's twin wide oval tips in the diffuser (gridded rear iso and side: |x| 0.47-0.64, y 0.27-0.33, ~3 cm proud), on the rear
   * bumper's face now that it reaches down over the diffuser (to 0.23).
   */
  exhaust: { tips: 2, x: 0.555, y: 0.3, size: [0.17, 0.06], shape: "round" },
  seats: PLATFORM_HARDPOINTS.seats,
  details: SEDAN_DETAILS,
  camera: { ...PLATFORM_CAMERA, hood: [1.08, 1.2] },
};
