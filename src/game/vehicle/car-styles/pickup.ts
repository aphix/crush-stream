import type { BodyStyle } from "../car-variants.ts";
import { PLATFORM_HARDPOINTS, pullHandle, st } from "./platform.ts";

const { bumpers } = PLATFORM_HARDPOINTS;
/** Flat chrome bar over a black valance: the bar 13 cm tall and 9 cm proud, the valance 7 cm under it ([y, out] m, top to bottom). */
const TRUCK_FRONT_FASCIA = [
  [0.14, -0.07],
  [0.14, 0.03],
  [0.13, 0.08],
  [0.06, 0.09],
  [0, 0.09],
  [-0.04, 0.088],
  [-0.06, 0.07],
  [-0.07, 0.06],
  [-0.14, 0.05],
  [-0.14, -0.07],
] as const;
/** The rear step bumper's section ([y, out] m, top to bottom): a flat top step rolling onto a plain vertical face, no ribs (reference rear iso). */
const TRUCK_REAR_FASCIA = [
  [0.1, -0.07],
  [0.1, 0.06],
  [0.094, 0.082],
  [0.084, 0.088],
  [-0.084, 0.088],
  [-0.094, 0.082],
  [-0.1, 0.07],
  [-0.1, -0.07],
] as const;

/** The trucks' tall gloss-black tow-style mirror housing on the door glass's front corner, read off their isos ([out from the door, height, length along the car] m). */
export const TOW_MIRROR = { cap: "box", finish: "black", size: [0.07, 0.22, 0.16], mount: "glass" } as const;
/** The pickup mirror head's lift (m) over its foot, as the side plate's head stands. */
const PICKUP_MIRROR_LIFT = 0.02;
/** The pickup's mirror (side plate): a rounded black head about 13 cm tall, centred 1.22 m up on a short arm to the glass sill. */
const PICKUP_MIRROR = { ...TOW_MIRROR, cap: "rounded", size: [0.07, 0.135, 0.15], lift: PICKUP_MIRROR_LIFT, neck: 0.04, stalk: 0.045 } as const;
/** The trucks' cab roofs roll onto their rear glass's and windshield's tops (reference isos: no flat cap overhanging either; run m), the rear
 *  corners tucking flush over the posts along the C-posts' chamfered tops (quarter glass to rear glass, 15-17 cm), no ear past them. */
export const TRUCK_ROOF_ENDS = { rear: 0.17, front: 0.09, flush: { rear: 1 } } as const;
/** The trucks' cab roofs are one smooth crown rolling into the side glass (owner, reference rear iso), no flat cap over a lip; square
 *  over the windshield's top as the front iso, so its flat pane's corners stay under the roof (a pane bent with the dome mirrors the key light). */
export const TRUCK_ROOF_SECTION = { crown: 0.55, blend: 0.6, squareFront: 0.15 } as const;
/** The cab door's slim black pull, 15 x 4 cm, 6 cm ahead of the door's rear cut (z -0.38) as the reference isos place it. */
const DOOR_PULL = pullHandle(-0.17, -0.32, 0.995, 0.04, 0.8);
/** Pickup's own lamps and bumper lamps, read off its reference isos and side/top crops. */
const PICKUP_LAMP_SHAPES = {
  head: {
    loops: [
      { points: [[0.415, 0.8625], [0.585, 0.8625], [0.585, 0.9625], [0.415, 0.9625]] },
      { points: [[0.415, 0.7375], [0.585, 0.7375], [0.585, 0.8375], [0.415, 0.8375]] },
    ],
    lens: "lit",
    bezel: "chrome",
    recess: 0.015,
    // The amber corner lamp sits beside the lower head lamp only, as the reference's front iso shows: one cell, met from the side (a twin met from the front drew 4.5 mm over the same skin and z-fought).
    cells: [
      { loop: { side: true, points: [[1.915, 0.75], [1.84, 0.75], [1.84, 0.85], [1.915, 0.85]] }, tone: "amber" },
    ],
  },
  tail: {
    loops: [
      { points: [[0.6, 0.73], [0.66, 0.73], [0.66, 1.13], [0.6, 1.13]] },
      { side: true, points: [[-2.155, 0.73], [-2.065, 0.73], [-2.065, 1.13], [-2.155, 1.13]] },
    ],
    lens: "lit",
    bezel: "black",
    recess: 0.01,
    cells: [{ loop: { points: [[0.6, 0.87], [0.66, 0.87], [0.66, 0.95], [0.6, 0.95]] }, tone: "clear" }],
  },
  front: {
    // Its bumper lamps sit in the black valance under the chrome bar.
    loops: [{ points: [[0.585, 0.44], [0.655, 0.44], [0.655, 0.5], [0.585, 0.5]] }],
    lens: "dark",
  },
} as const;


/** 80s regular-cab long-bed pickup (Toyota Pickup proportions): boxy cab, flat hood, open bed; the trunk part is the tailgate. */
export const PICKUP: BodyStyle = {
  id: "pickup",
  dims: { wheelbase: 2.575, overhang: { front: 0.683, rear: 0.93 }, track: 1.3, width: 1.584, height: 1.691, rideHeight: 0.34, wheel: { radius: 0.38, width: 0.24 } },
  ...PLATFORM_HARDPOINTS,
  // The side plate's windshield edge: z .913 at its foot (y 1.248), .713 at y 1.39.
  windshield: { base: [1.21, 0.957], wBase: 1.36, wTop: 1.18 },
  belt: { x: 0.73, y: [[0, 1.12]] },
  rocker: { y: 0.45 },
  underside: [[-2.17, 0.52], [-1.96, 0.42], [-1.75, 0.38], [-1.5, 0.34], [1.6, 0.34], [1.76, 0.35], [1.93, 0.38]],
  door: { hingeX: 0.74, hingeY: 0.785, hingeZ: 0.7, length: 1.09, halfHeight: 0.335, mirrorY: 0.405, mirrorZ: 0.19, mirrorReach: 0.15, mirrorHalfDepth: 0.08, aperture: [-0.38, 0.69], mirror: PICKUP_MIRROR },
  // The side plate's door glass starts .60 back at the belt and .33 at the roof, a sail filling up to the A-post.
  aPillarFoot: 0.6,
  aPillarTop: 0.34,
  bPillar: { rear: -0.33, front: -0.29 },
  // The regular cab's door runs back to the side plate's seam; its glass ends at the plate's -0.29 / -0.265 behind a slim 4 cm post band; the C-post's foot meets the cab-back shoulder, as the hatchback's.
  pillars: { b: { z: [-0.31, -0.275], width: [0.04, 0.04] }, rearFoot: [0.718, 1.173] },
  arch: { radius: 0.46, lip: { flare: 0.024, width: 0.065, square: true } },
  hood: { z0: 1.03, z1: 1.92, origin: [1.2, 1.01], nose: [0.034, 0.02] },
  bumpers: {
    front: { ...bumpers.front, seat: { y: 0.55, z: 1.88 }, span: 0.73, wrap: { from: 0.55, back: 0.12 }, fascia: TRUCK_FRONT_FASCIA, trim: "chrome", band: [0.41, 0.51] },
    // The tailgate drops onto the step: its top is a black rubber pad (band over the step's rows), the face plain chrome.
    rear: { ...bumpers.rear, seat: { y: 0.57, z: 2.13 }, span: 0.74, wrap: { from: 0.65, back: 0.05 }, fascia: TRUCK_REAR_FASCIA, trim: "chrome", hitch: true, band: [0.66, 0.68] },
  },
  profile: [
    st(-2.16, 0.66, 1.18),
    st(-2.05, 0.74, 1.185),
    st(-1.6, 0.739, 1.18),
    st(-0.95, 0.739, 1.18),
    st(-0.58, 0.749, 1.18),
    // The cab's roof edge and side-glass tops stand at the top plate's 0.585 m half-width (cabinHw + the lip), the glass leaning in under it.
    st(-0.5, 0.759, 1.2, 1.665, 0.505, 1),
    st(-0.1, 0.759, 1.2, 1.66, 0.51, 1),
    st(0.38, 0.759, 1.2, 1.625, 0.505, 1),
    st(0.98, 0.759, 1.19, 1.22, 0.58, 0.3),
    st(1.2, 0.749, 1.17),
    st(1.5, 0.746, 1.12),
    st(1.75, 0.736, 1.08),
    st(1.86, 0.72, 1.04),
    st(1.92, 0.62, 0.96),
  ],
  roofZ: [-0.46, 0.45],
  roofEnds: TRUCK_ROOF_ENDS,
  // A flatter crown and a tighter edge roll, as the top plate's flat roof panel runs to 5 cm inside the edge.
  roofSection: { ...TRUCK_ROOF_SECTION, crown: 0.75, blend: 0.8 },
  roofDrip: 0,
  windshieldTop: [1.6, 0.45],
  // The cab back stands near upright, the glass's bowed top just ahead of the roof's rolled end and inside its chamfered corners (rear iso),
  // so none shows past the roof in side view; set further back, the crushed cab's dummy-world roof stood 8-15 cm off the drawn one.
  rearGlass: { base: [1.24, -0.55], top: [1.635, -0.44], wBase: 1.3, wTop: 0.96 },
  privacyGlass: { rear: true },
  quarter: { zRearBot: -0.33, zRearTop: -0.295 },
  midPillarZ: null,
  rearBulkhead: { z: -0.56, yTop: 1.2 },
  tubs: [[-0.55, 0.85, 0.5], [-2.12, -0.62, 0.8]],
  bayFloor: 0.34,
  bayFront: 1.78,
  wheelTub: { rise: 0.19, length: 0.55, width: 0.22 },
  tubWall: 0.04,
  // Its cage's hood tops stand 1.04-1.23 m and its bed rim 1.18-1.20 m, its roof from 1.62 m: the cabin starts 7 cm over the highest
  // of them (as the cars' 1 m stands 9 cm over theirs), so its hood and bed are columns, not roof slabs floating over the bed floor.
  proxyBelt: 1.3,
  rearDoorSeam: -0.41,
  boot: { kind: "tailgate", y0: 0.6, origin: [1.18, -2.15], pivot: [0.6, -2.15] },
  // The high-mount stop lamp sits on the rear glass's top just under the roof's lip (rear iso), recessed so it stands no nub past the cab in side view.
  lamps: { head: [0.5, 0.85], tail: [0.63, 0.93], shapes: PICKUP_LAMP_SHAPES, bulb: "halogen", brake: { at: [0, 1.6], size: [0.25, 0.04], inset: 0.014 } },
  // The reference's grille fills the face between its head lamps (inner edges x .415), four bars deep.
  grille: { y: 0.85, size: [0.79, 0.225], kind: "bars", count: 4, finish: "black", rim: "chrome" },
  camera: { hood: [1.42, 1.25], third: { dist: 6.4, height: 2.3, aimUp: 1.2 }, far: { dist: 10.3, height: 3.62, aimUp: 1.35 } },
  details: {
    lines: [
      { view: "side", points: [[0.706, 1.128], [0.699, 0.461]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[0.699, 0.462], [-0.374, 0.462]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-0.388, 0.462], [-0.556, 0.462]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-0.592, 1.142], [-0.599, 0.446]], width: 0.025, depth: -0.006, profile: "v", cavity: 0.95 },
      { view: "side", points: [[0.627, 1.121], [-0.342, 1.121]], width: 0.021, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[0.328, 1.562], [-0.314, 1.569], [-0.314, 1.142], [0.57, 1.128], [0.513, 1.276]], closed: true, width: 0.016, depth: 0.0015, profile: "u", cavity: 0.3 },
      { view: "side", points: [[0.913, 1.248], [0.713, 1.39], [0.471, 1.604], [0.328, 1.619]], width: 0.016, depth: 0.0015, profile: "u", cavity: 0.3 },
      { view: "side", points: [[0.67, 1.177], [0.328, 1.59]], width: 0.014, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[0.627, 1.191], [0.299, 1.576]], width: 0.014, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[0.585, 1.205], [0.271, 1.562]], width: 0.014, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[0.285, 1.576], [-0.314, 1.576]], width: 0.025, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[0.827, 0.649], [-0.086, 0.656], [-0.87, 0.663]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "side", points: [[-1.825, 0.692], [-2.182, 0.706]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "side", points: [[1.626, 0.763], [1.583, 0.849], [1.483, 0.906], [1.312, 0.934], [1.084, 0.927], [0.941, 0.877], [0.884, 0.791], [0.841, 0.692]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "side", points: [[1.597, 0.72], [1.512, 0.806], [1.341, 0.841], [1.055, 0.849], [0.941, 0.791], [0.898, 0.734]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "side", points: [[-0.955, 0.777], [-0.998, 0.863], [-1.084, 0.927], [-1.226, 0.963], [-1.597, 0.963], [-1.74, 0.906], [-1.797, 0.806], [-1.84, 0.734]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "side", points: [[-0.998, 0.72], [-1.112, 0.82], [-1.255, 0.849], [-1.597, 0.849], [-1.711, 0.791], [-1.768, 0.692]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "side", points: [[-0.685, 0.863], [-0.87, 0.863], [-0.87, 0.734], [-0.685, 0.734]], closed: true, width: 0.012, depth: -0.003, profile: "v", cavity: 0.7 },
      { view: "side", points: [[1.954, 0.606], [1.669, 0.606]], width: 0.025, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[-0.613, 1.142], [-2.125, 1.142]], width: 0.025, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[-2.089, 1.114], [-2.089, 0.635]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[1.768, 1.071], [1.341, 1.114], [0.913, 1.142], [0.713, 1.135]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "top", points: [[1.843, 0], [1.052, 0]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "top", points: [[1.74, 0.388], [1.374, 0.396], [1.037, 0.403]], width: 0.03, depth: 0.006, profile: "u", cavity: 0.3 },
      { view: "top", points: [[1.858, 0.403], [1.447, 0.418], [1.008, 0.432]], width: 0.03, depth: 0.006, profile: "u", cavity: 0.3 },
      { view: "top", points: [[-0.514, 0], [-0.514, 0.564], [0.395, 0.564], [0.395, 0]], width: 0.025, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "top", points: [[-0.641, 0], [-0.641, 0.726]], width: 0.025, depth: -0.006, profile: "v", cavity: 0.95 },
      { view: "top", points: [[-2.056, 0], [-2.056, 0.579], [-0.678, 0.579], [-0.678, 0]], width: 0.012, depth: -0.003, profile: "v", cavity: 0.7 },
      { view: "top", points: [[-0.634, 0.66], [-2.085, 0.66]], width: 0.025, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "top", points: [[-2.085, 0], [-2.085, 0.667]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      // The bed floor's ribs, 7.3 cm apart as the reference's rear iso reads.
      ...[0.44, 0.367, 0.293, 0.22, 0.147, 0.073, 0].map((x) => ({ view: "top", points: [[-0.707, x], [-2.041, x]], width: 0.02, depth: 0.003, profile: "u", cavity: 0 }) as const),
      { view: "top", points: [[1.931, 0], [1.931, 0.623]], width: 0.025, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "top", points: [[1.623, 0.711], [0.788, 0.711]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "top", points: [[-1.059, 0.74], [-1.968, 0.74]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "front", points: [[0, 0.95], [0.6, 0.95]], width: 0.008, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "front", points: [[0, 0.52], [0.76, 0.52]], width: 0.008, depth: -0.003, profile: "v", cavity: 0.6 },
      ...DOOR_PULL.lines,
    ],
    patches: [
      ...DOOR_PULL.patches,
      { view: "side", points: [[0.841, 0.891], [0.777, 0.891], [0.777, 0.863], [0.841, 0.863]], depth: -0.002, rim: 0.003, cavity: 0.3 },
      { view: "front", points: [[0.15, 0.42], [0.35, 0.42], [0.35, 0.48], [0.15, 0.48]], depth: -0.005, rim: 0.004, cavity: 0.7 },
      { view: "front", points: [[0.62, 0.43], [0.7, 0.43], [0.7, 0.49], [0.62, 0.49]], depth: -0.004, rim: 0.003, cavity: 0.6 },
      { view: "rear", points: [[0, 0.99], [0.11, 0.99], [0.11, 1.05], [0, 1.05]], depth: -0.006, rim: 0.004, cavity: 0.85 },
      { view: "rear", points: [[0, 0.5], [0.38, 0.5], [0.38, 0.64], [0, 0.64]], depth: -0.002, rim: 0.004, cavity: 0.6 },
    ],
  },
  seats: { front: [0.36, 0.64, 0.05], rear: null },
};
