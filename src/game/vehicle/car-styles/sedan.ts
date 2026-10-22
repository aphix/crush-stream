import type { BodyStyle } from "../car-variants.ts";
import { CABIN_TUB, PLATFORM_CAMERA, PLATFORM_HARDPOINTS, PLATFORM_WHEEL, st } from "./platform.ts";
import { SEDAN_DETAILS } from "./sedan-details.ts";

/**
 * The reference's mirror: a rounded body-colour housing seated on the door. Off the gridded side and top: the cap stands y 0.85-0.975 (h 0.12),
 * runs about 0.10 along the car, and reaches |x| 0.88 from the skin at 0.752: the door's mirrorReach 0.128. Its 0.12 width leaves the cap's
 * inner face 8 mm off the seat, over the foot (a cap wider than reach - 0.005 buries itself in the door).
 */
export const SEDAN_MIRROR = { cap: "rounded", finish: "body", size: [0.12, 0.12, 0.1] } as const;

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
  belt: {
    x: [[-1.2, 0.64], [-0.88, 0.7], [-0.5, 0.72], [0.4, 0.74]],
    y: [[-1.23, 1.0], [-1.15, 0.98], [-0.9, 0.948], [-0.5, 0.913], [0.4, 0.9], [0.92, 0.9]],
  },
  rocker: { y: 0.21 },
  arch: { radius: 0.405, lip: { flare: 0.008, width: 0.035 } },
  /**
   * The hood's rear edge stands ahead of the windshield's foot (0.95), as the reference's: in its top view the bonnet ends ~1.0 on
   * the centre line, the dark cowl and wipers (`blackout.cowl`) between it and the glass. Hinged 2 cm behind that edge, as before.
   */
  hood: { z0: 0.99, z1: 1.97, origin: [0.81, 0.97] },
  /** Body-colour fascias, as the reference's: its black is the lower intake, grille and diffuser (`details`, grille, tail trim), not the bumper. */
  bumpers: {
    front: { ...PLATFORM_HARDPOINTS.bumpers.front, seat: { y: 0.34, z: 1.965 }, span: 0.74, wrap: { from: 0.33, back: 0.242 }, trim: "body" },
    rear: { ...PLATFORM_HARDPOINTS.bumpers.rear, seat: { y: 0.52, z: 2.088 }, span: 0.76, wrap: { from: 0.3, back: 0.25 }, trim: "body" },
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
    st(0.986, 0.79, 0.906, 0.922, 0.5, 0.25),
    st(1.235, 0.79, 0.873),
    st(1.481, 0.765, 0.832),
    st(1.642, 0.749, 0.79),
    st(1.734, 0.746, 0.758),
    st(1.82, 0.692, 0.712),
    st(1.898, 0.574, 0.674),
    st(1.995, 0.467, 0.605),
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
  rearBulkhead: { z: -0.72, yTop: 0.84 },
  tubs: [CABIN_TUB],
  rearDoorSeam: -1.06,
  /**
   * The owner's sedan lid: hinged at the rear glass's base, it wraps the tail (deck plus the upper rear face). The reference's lid seam
   * (rear iso) runs down the tail face through each tail lamp's inner third (|x| ~0.53 at the lamps) to the plate recess's bottom
   * (y ~0.62), its bottom corners at |x| ~0.45; the face stands on the tail at -2.10. The ducktail: the deck dips into a shallow groove
   * and kicks up into the lip at its rear edge (gridded side: crest y 0.955 over z -2.0..-2.09, ~1.2 cm proud of the deck line).
   */
  boot: { kind: "lid", z0: -1.65, z1: -2.1, origin: [0.97, -1.62], pivot: [1.02, -1.68], drop: { y: 0.62, w: 0.45 }, lip: { rise: 0.012, depth: 0.06 } },
  lamps: { head: [0.26, 0.575], tail: [0.34, 0.8] },
  /**
   * The reference's twin wide oval tips in the diffuser (gridded rear iso and side: |x| 0.47-0.64, y 0.27-0.33, ~3 cm proud). Ours sit
   * inboard at |x| 0.36: the body's tail floor only reaches |x| 0.48 (0.8 hw) and the bumper face sweeps back from 0.33, so wider tips
   * hung in the air past both.
   */
  exhaust: { tips: 2, x: 0.36, y: 0.31, size: [0.14, 0.055], shape: "round" },
  seats: PLATFORM_HARDPOINTS.seats,
  details: SEDAN_DETAILS,
  camera: { ...PLATFORM_CAMERA, hood: [1.08, 1.2] },
};
