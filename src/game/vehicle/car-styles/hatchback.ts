import type { BodyStyle } from "../car-variants.ts";
import { pullHandle, st } from "./platform.ts";

/** Hatchback's own lamps and bumper lamps, read off its reference isos and side/top crops. */
const HATCHBACK_LAMP_SHAPES = {
  head: {
    loops: [{ points: [[0.4, 0.48], [0.68, 0.48], [0.7, 0.6], [0.4, 0.61]] }],
    lens: "lit",
    bezel: "black",
    recess: 0.01,
    // The amber at the lens's outer end, round the corner (the lens's edge at z 1.649 foot, 1.631 top).
    cells: [{ loop: { side: true, points: [[1.675, 0.48], [1.652, 0.48], [1.635, 0.598], [1.66, 0.6]] }, tone: "amber" }],
  },
  // A slim band split at the gate's outline (the gate's piece inboard of x .43) and again at the infill's step wall (x .621 → .635 up the
  // band): the outer lens starts on the wall's top edge and falls down it in front of the wall, then wraps the corner onto the quarter.
  tail: {
    loops: [
      {
        points: [
          [0.445, 0.74, -1.9], [0.6, 0.74, -1.9], [0.6154, 0.74, -1.9], [0.617, 0.76, -1.9],
          [0.619, 0.78, -1.9], [0.621, 0.8, -1.9], [0.6244, 0.815, -1.9], [0.6254, 0.82, -1.9], [0.6, 0.815, -1.9], [0.445, 0.785, -1.9],
        ],
      },
      {
        points: [
          [0.6243, 0.74, -1.9], [0.665, 0.74, -1.9],
          [0.85, 0.74, -1.67], [0.85, 0.75, -1.6], [0.85, 0.8, -1.58], [0.85, 0.82, -1.63],
          [0.665, 0.815, -1.9], [0.638, 0.82, -1.9], [0.6347, 0.82, -1.9], [0.6337, 0.815, -1.9], [0.6303, 0.8, -1.9], [0.6283, 0.78, -1.9],
          [0.6263, 0.76, -1.9],
        ],
      },
      { points: [[0.27, 0.75], [0.42, 0.742], [0.42, 0.79], [0.27, 0.79]] },
    ],
    lens: "lit",
    bezel: "black",
    recess: 0.01,
    // The outer lens's 5 cm fill chords cut 6 mm inside the tail corner's roll (the skin showed through as a notch): 3.5 cm ones follow it.
    fill: 0.035,
    strips: [
      { line: { points: [[0.28, 0.775], [0.41, 0.772]] }, width: 0.02, tone: "lit" },
      { line: { points: [[0.455, 0.772], [0.59, 0.8], [0.616, 0.8]] }, width: 0.02, tone: "lit" },
      { line: { points: [[0.634, 0.8], [0.66, 0.8]] }, width: 0.02, tone: "lit" },
    ],
    cells: [
      { loop: { points: [[0.27, 0.75], [0.35, 0.746], [0.35, 0.78], [0.27, 0.78]] }, tone: "clear" },
    ],
  },
  front: {
    loops: [{ points: [[0.575, 0.305], [0.665, 0.305], [0.665, 0.335], [0.575, 0.335]] }],
    lens: "amber",
    onBody: true,
  },
  // The black diffuser band across the rear bumper's foot (matte: a glossy one mirrors the ground on its down-facing lip), its red reflector in it.
  rear: {
    loops: [{ points: [[0.006, 0.295], [0.64, 0.295], [0.64, 0.365], [0.006, 0.365]] }],
    lens: "black",
    cells: [{ loop: { points: [[0.48, 0.3], [0.64, 0.3], [0.64, 0.33], [0.48, 0.33]] }, tone: "red" }],
  },
} as const;

/** The door pull handles at the reference's places: front z 0..-0.18, rear -0.8..-0.97, both at y 0.7575. */
const HANDLES = [pullHandle(0, -0.18, 0.7575, 0.025), pullHandle(-0.8, -0.97, 0.7575, 0.025)];

/** Compact five-door: boxy face, near-vertical hatch under a roof spoiler. */
export const HATCHBACK: BodyStyle = {
  id: "hatchback",
  dims: { wheelbase: 2.225, overhang: { front: 0.6975, rear: 0.6775 }, track: 1.37, width: 1.621, height: 1.309, rideHeight: 0.15, wheel: { radius: 0.29, width: 0.17 } },
  windshield: { base: [0.891, 0.883], wBase: 1.38, wTop: 1.03 },
  bPillar: { rear: -0.27, front: -0.19 },
  belt: { x: 0.75, y: [[-1.174, 0.881], [-0.939, 0.877], [-0.935, 0.856], [0.128, 0.838], [0.381, 0.809], [0.58, 0.824], [0.584, 0.852], [0.88, 0.852]] },
  rocker: { y: 0.2 },
  arch: { radius: 0.35, lip: { flare: 0.009, width: 0.035 } },
  hood: { z0: 0.86, z1: 1.66, origin: [0.75, 0.84] },
  bumpers: {
    front: {
      seat: { y: 0.38, z: 1.7245 },
      fascia: [[0.09, -0.07], [0.09, 0.02], [0.079, 0.062], [0.045, 0.08], [0.016, 0.074], [-0.011, 0.062], [-0.045, 0.064], [-0.063, 0.088], [-0.09, 0.075], [-0.09, -0.07]],
      span: 0.7,
      wrap: { from: 0.25, back: 0.19 },
      trim: "body",
      top: [[0, 0.462], [0.4, 0.462], [0.62, 0.462]],
      edge: [[1.72, 0.462], [1.45, 0.462], [1.485, 0.38], [1.5, 0.3]],
    },
    rear: {
      seat: { y: 0.41, z: 1.702 },
      fascia: [[0.15, -0.07], [0.15, 0.02], [0.132, 0.062], [0.075, 0.08], [0.027, 0.074], [-0.018, 0.062], [-0.075, 0.064], [-0.105, 0.088], [-0.15, 0.075], [-0.15, -0.07]],
      span: 0.66,
      wrap: { from: 0.46, back: 0.1 },
      trim: "body",
      top: [[0, 0.555], [0.4, 0.56], [0.64, 0.57]],
      edge: [[-1.69, 0.565], [-1.66, 0.5], [-1.44, 0.5], [-1.48, 0.4], [-1.5, 0.3]],
      plateless: true,
    },
  },
  // The reference's mirror: a body-colour head tapering to its nose, standing clear over the belt on a black sail in the glass's front corner, about 3 cm past the body side.
  door: { hingeX: 0.76, hingeY: 0.53, hingeZ: 0.63, length: 0.905, halfHeight: 0.3, mirrorY: 0.27, mirrorZ: 0.185, mirrorReach: 0.075, mirrorHalfDepth: 0.07, aperture: [-0.255, 0.62], mirror: { cap: "nose", finish: "body", size: [0.065, 0.12, 0.14], lift: 0.075, neck: 0.03, stalk: 0.1, round: 0.48 } },
  aPillarFoot: 0.73,
  aPillarTop: 0.212,
  glassTop: 0.045,
  camera: { hood: [1.09, 1.0], third: { dist: 5.4, height: 1.85, aimUp: 0.95 }, far: { dist: 8.8, height: 3.1, aimUp: 1.1 } },
  underside: [[-1.791, 0.456], [-1.759, 0.278], [-1.705, 0.225], [-1.652, 0.207], [-1.57, 0.214], [-1.559, 0.203], [-0.625, 0.168], [-0.611, 0.153], [0.577, 0.153], [0.591, 0.168], [0.687, 0.168], [1.618, 0.15], [1.682, 0.164], [1.729, 0.21], [1.782, 0.3], [1.8, 0.367]],
  profile: [
    st(-1.7, 0.66, 0.62),
    st(-1.62, 0.708, 0.905),
    st(-1.556, 0.738, 0.895, 1.072, 0.5, 0.47),
    st(-1.491, 0.755, 0.888, 1.238, 0.5, 0.45),
    st(-1.391, 0.765, 0.882, 1.238, 0.501, 0.53),
    st(-1.22, 0.78, 0.881, 1.286, 0.516, 0.83),
    st(-1.115, 0.785, 0.88, 1.258, 0.525, 1),
    st(-0.996, 0.789, 0.878, 1.27, 0.536, 1),
    st(-0.8, 0.79, 0.854, 1.28, 0.544, 1),
    st(-0.001, 0.792, 0.84, 1.284, 0.55, 1),
    st(0.131, 0.792, 0.838, 1.272, 0.541, 0.97),
    st(0.331, 0.792, 0.815, 1.273, 0.516, 0.848),
    st(0.391, 0.792, 0.81, 1.273, 0.508, 0.735),
    st(0.463, 0.792, 0.815, 1.245, 0.499, 0.646),
    st(0.573, 0.792, 0.823, 1.21, 0.493, 0.523),
    st(0.645, 0.792, 0.852, 0.982, 0.489, 0.367),
    st(0.779, 0.79, 0.852, 0.872, 0.481, 0.25),
    st(0.987, 0.79, 0.846),
    st(1.072, 0.787, 0.828),
    st(1.215, 0.785, 0.807),
    st(1.49, 0.75, 0.746),
    st(1.563, 0.735, 0.719),
    st(1.639, 0.69, 0.703),
    st(1.7, 0.61, 0.67),
    st(1.74, 0.45, 0.618),
  ],
  // The windshield reaches the roof's flat front (the reference's glass top), its corners flush with the dome's edge.
  roofZ: [-1.151, 0.245],
  // The glass top sits 7 mm under the crown: the crown rolls down onto it. The rear end's side lip tucks in over the D-pillars' tops;
  // its run is under 2 cm, so its near roll station merges into the roof's end ring and the body stays within its vertex budget.
  roofEnds: { front: 0.12, rear: 0.019, flush: { rear: 1 } },
  windshieldTop: [1.245, 0.245],
  rearGlass: { base: [0.905, -1.61], top: [1.277, -1.15], wBase: 1.174, wTop: 0.9, frame: [0.05, 0.06, 0.11] },
  // The quarter glass's rear edge leans forward as the reference's, leaving a broad D-pillar at the roof.
  quarter: { zRearBot: -1.15, zRearTop: -0.96 },
  midPillarZ: -0.86,
  rearBulkhead: { z: -0.95, yTop: 0.8 },
  tubs: [[-1.56, 0.7, 0.27]],
  rearDoorSeam: -0.88,
  boot: {
    kind: "tailgate",
    y0: 0.57,
    origin: [0.905, -1.615],
    z0: -1.75,
    pivot: [1.277, -1.15],
    // The gate's top edge rolls forward onto the rear glass's base (it stood 8-10 mm proud of it: a shelf across the iso).
    lip: { rise: -0.01, depth: 0.06 },
    // The reference's gate seam: ±.62-.66 above the tail lamps, stepping in to ±.43 between them.
    outline: [[0.58, 1.24], [0.64, 1.05], [0.66, 0.92], [0.62, 0.84], [0.43, 0.8], [0.43, 0.6]],
  },
  // The high brake lamp: a thin strip on the spoiler's trailing edge (2 cm tall there); the amber side repeater on the front fender, as the reference's.
  lamps: {
    head: [0.545, 0.545],
    tail: [0.603, 0.76],
    shapes: HATCHBACK_LAMP_SHAPES,
    bulb: "halogen",
    brake: { at: [0, 1.231], size: [0.34, 0.012] },
    sideMarkers: [{ at: [0.62, 0.8], size: [0.045, 0.022] }],
  },
  // A flush band on the nose's flat front (skin z 1.74), as the reference's: no box side showing.
  grille: { y: 0.575, z: 1.748, size: [0.72, 0.11], kind: "bars", count: 4, badge: 0.025, finish: "black" },
  seats: { front: [0.35, 0.41, -0.1], rear: [0.47, -0.7] },
  // The D-pillar's foot on the shoulder's top beside the gate's corner (x .680, y .895 at z -1.61): at the glass's corner it left the
  // cabin's opening open between its bottom edge and the shoulder, a dark wedge up to 4 cm wide at z -1.5.
  pillars: { b: { width: [0.08, 0.08] }, divider: { width: [0.056, 0.045], z: [-0.92, -0.87] }, rearFoot: [0.68, 0.895] },
  blackout: { b: true, divider: true },
  privacyGlass: { rear: true, quarter: true },
  // The spoiler spans the roof's rear end out to its side lip, its side ends sloping down over the lip's tuck onto the D-pillars' tops.
  roof: { spoiler: { z: [-1.24, -1.12], y: [1.22, 1.28], halfWidth: 0.6, ends: [0.08, 0.04] } },
  exhaust: { tips: 2, x: 0.5, y: 0.24, size: [0.1, 0.045], shape: "round" },
  details: {
    lines: [
      { view: "top", points: [[1.68, 0], [1.69, 0.36], [1.64, 0.62], [1.55, 0.68]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "top", points: [[1.55, 0.68], [1.22, 0.7], [1.0, 0.69], [0.82, 0.66]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "top", points: [[0.8, 0.66], [0.79, 0.5], [0.86, 0.31], [0.89, 0]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "top", points: [[1.66, 0.38], [1.35, 0.39], [1.05, 0.41], [0.88, 0.42]], width: 0.03, depth: 0.003, profile: "u", cavity: 0 },
      { view: "top", points: [[0.72, 0.6], [0.89, 0]], width: 0.006, depth: -0.004, profile: "step", cavity: 0.85 },
      { view: "side", points: [[0.58, 0.87], [0.64, 0.76], [0.645, 0.5], [0.63, 0.28]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "side", points: [[0.63, 0.28], [0.2, 0.27], [-0.26, 0.27]], width: 0.01, depth: -0.005, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-0.26, 0.88], [-0.26, 0.75], [-0.26, 0.5], [-0.27, 0.28]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-0.27, 0.28], [-0.6, 0.27], [-0.83, 0.3], [-1.06, 0.57]], width: 0.01, depth: -0.005, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-1.06, 0.88], [-1.07, 0.75], [-1.07, 0.6]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-0.89, 0.875], [-0.86, 1.2]], width: 0.03, depth: 0.002, profile: "u", cavity: 0.7 },
      { view: "side", points: [[0.6, 0.47], [-0.2, 0.46], [-0.8, 0.45]], width: 0.02, depth: 0.003, profile: "u", cavity: 0 },
      { view: "side", points: [[0.74, 0.25], [-0.1, 0.23], [-0.82, 0.22]], width: 0.02, depth: -0.004, profile: "step", cavity: 0 },
      { view: "side", points: [[1.62, 0.62], [1.35, 0.68], [0.95, 0.75], [0.65, 0.77], [0, 0.78], [-0.6, 0.79], [-1.1, 0.8], [-1.45, 0.81], [-1.62, 0.8]], width: 0.02, depth: 0.003, profile: "u", cavity: 0 },
      { view: "side", points: [[1.4225, 0.27], [1.381, 0.425], [1.2675, 0.538], [1.1125, 0.58], [0.9575, 0.538], [0.844, 0.425], [0.8025, 0.27]], width: 0.02, depth: 0.006, profile: "u", cavity: 0 },
      { view: "side", points: [[-0.8025, 0.27], [-0.844, 0.425], [-0.9575, 0.538], [-1.1125, 0.58], [-1.2675, 0.538], [-1.381, 0.425], [-1.4225, 0.27]], width: 0.02, depth: 0.006, profile: "u", cavity: 0 },
      { view: "side", points: [[-1.28, 0.8], [-1.43, 0.8], [-1.43, 0.64], [-1.28, 0.64]], closed: true, width: 0.01, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-1.595, 0.82], [-1.6, 0.72], [-1.6, 0.62]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "side", points: [[0.56, 0.875], [-0.26, 0.875], [-0.89, 0.875], [-1.17, 0.875]], width: 0.015, depth: 0.003, profile: "u", cavity: 0.7 },
      { view: "side", points: [[0.52, 0.875], [0.37, 1.05], [0.22, 1.21], [0, 1.23], [-0.26, 1.23], [-0.26, 0.875]], width: 0.02, depth: 0.003, profile: "u", cavity: 0.7 },
      { view: "side", points: [[-0.31, 0.875], [-0.31, 1.22], [-0.8, 1.21], [-0.86, 1.2], [-0.89, 0.875]], width: 0.02, depth: 0.003, profile: "u", cavity: 0.7 },
      { view: "side", points: [[-0.92, 1.215], [-0.96, 1.215], [-1.15, 0.89], [-0.92, 0.88]], closed: true, width: 0.02, depth: 0.003, profile: "u", cavity: 0.7 },
      { view: "side", points: [[-0.25, 0.88], [-0.25, 1.23]], width: 0.08, depth: 0.002, profile: "u", cavity: 0.7 },
      { view: "top", points: [[0.7, 0.62], [0.79, 0.5], [0.86, 0.31], [0.89, 0]], width: 0.02, depth: 0.003, profile: "u", cavity: 0.7 },
      { view: "top", points: [[0.24, 0.58], [0.22, 0]], width: 0.02, depth: 0.003, profile: "u", cavity: 0.7 },
      { view: "side", points: [[0.2, 1.26], [-0.5, 1.27], [-1.05, 1.26]], width: 0.015, depth: -0.005, profile: "v", cavity: 0.85 },
      { view: "front", points: [[0, 0.64], [0.38, 0.64], [0.38, 0.5], [0, 0.5]], closed: true, width: 0.015, depth: 0.005, profile: "step", cavity: 0.85 },
      { view: "side", points: [[1.62, 0.62], [1.48, 0.6], [1.5, 0.47]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "front", points: [[0.78, 0.47], [0.7, 0.47], [0.4, 0.49], [0.4, 0.64], [0.66, 0.64], [0.76, 0.62]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "side", points: [[1.78, 0.31], [1.55, 0.31]], width: 0.01, depth: 0.004, profile: "step", cavity: 0.7 },
      { view: "top", points: [[-1.1, 0.57], [-1.09, 0]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "top", points: [[-0.97, 0.52], [-1.0, 0]], width: 0.12, depth: 0.006, profile: "u", cavity: 0 },
      { view: "rear", points: [[0, 1.25], [0.57, 1.24], [0.64, 1.05], [0.66, 0.92]], width: 0.03, depth: 0.003, profile: "u", cavity: 0.7 },
      { view: "rear", points: [[0.5, 1.22], [0.576, 1.05], [0.624, 0.92], [0.631, 0.9]], width: 0.01, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "rear", points: [[0.58, 1.24], [0.64, 1.05], [0.66, 0.92], [0.62, 0.84]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      { view: "rear", points: [[0.62, 0.84], [0.43, 0.8], [0.43, 0.6], [0, 0.56]], width: 0.01, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "rear", points: [[0, 0.98], [0.17, 0.98]], width: 0.02, depth: 0.006, profile: "u", cavity: 0.7 },
      { view: "rear", points: [[0.58, 0.5], [0.6, 0.5]], width: 0.01, depth: -0.006, profile: "v", cavity: 0.85 },
      ...HANDLES.flatMap((h) => h.lines),
    ],
    patches: [
      { view: "side", points: [[0.8025, 0.6175], [0.7575, 0.6175], [0.7575, 0.6425], [0.8025, 0.6425]], depth: 0.004, rim: 0.004, cavity: 0 },
      { view: "top", points: [[-0.815, 0], [-0.815, 0.0225], [-0.945, 0.0225], [-0.945, 0]], depth: 0.006, rim: 0.004, cavity: 0 },
      { view: "front", points: [[0, 0.63], [0.36, 0.63], [0.36, 0.52], [0, 0.52]], depth: -0.006, rim: 0.004, pattern: { kind: "hslats", pitch: 0.02, bar: 0.008, depth: -0.006 }, cavity: 0.8 },
      { view: "front", points: [[0, 0.6], [0.0225, 0.57], [0, 0.54]], depth: 0.006, rim: 0.004, cavity: 0 },
      { view: "front", points: [[0.41, 0.5], [0.52, 0.5], [0.52, 0.62], [0.41, 0.62]], depth: -0.006, rim: 0.004, cavity: 0.85 },
      { view: "front", points: [[0.53, 0.5], [0.62, 0.5], [0.62, 0.62], [0.53, 0.62]], depth: -0.006, rim: 0.004, cavity: 0.85 },
      { view: "front", points: [[0.64, 0.5], [0.74, 0.5], [0.74, 0.62], [0.64, 0.62]], depth: -0.006, rim: 0.004, cavity: 0 },
      { view: "front", points: [[0.4, 0.34], [0.58, 0.34], [0.58, 0.39], [0.4, 0.39]], depth: -0.004, rim: 0.004, cavity: 0 },
      { view: "side", points: [[1.71, 0.32], [1.78, 0.32], [1.78, 0.38], [1.71, 0.38]], depth: 0.003, rim: 0.004, cavity: 0 },
      { view: "front", points: [[0, 0.18], [0.5, 0.18], [0.5, 0.3], [0, 0.3]], depth: -0.006, rim: 0.004, pattern: { kind: "hslats", pitch: 0.012, bar: 0.006, depth: -0.006 }, cavity: 0.85 },
      { view: "front", points: [[0.515, 0.235], [0.645, 0.235], [0.645, 0.305], [0.515, 0.305]], depth: -0.006, rim: 0.004, cavity: 0.7 },
      { view: "rear", points: [[0.43, 0.74], [0.55, 0.74], [0.55, 0.76], [0.43, 0.76]], depth: -0.006, rim: 0.004, cavity: 0 },
      // The model badge under the right lamp: a plain raised plate.
      { view: "rear", points: [[0.26, 0.6], [0.355, 0.6], [0.355, 0.625], [0.26, 0.625]], depth: 0.002, rim: 0.003, cavity: 0 },
      // The gate's top edge seats in the glass's black frit, as the reference's: no painted ledge catching the sky.
      { view: "top", points: [[-1.57, 0], [-1.57, 0.62], [-1.62, 0.62], [-1.62, 0]], depth: 0, rim: 0.004, cavity: 0.9 },
      { view: "rear", points: [[0, 0.865], [0.055, 0.8], [0, 0.735]], depth: 0.004, rim: 0.004, cavity: 0 },
      { view: "rear", points: [[0, 0.2], [0.62, 0.2], [0.62, 0.3], [0, 0.3]], depth: -0.006, rim: 0.004, pattern: { kind: "hslats", pitch: 0.02, bar: 0.008, depth: -0.006 }, cavity: 0.85 },
      { view: "rear", points: [[0.36, 0.27], [0.39, 0.235], [0.51, 0.235], [0.54, 0.27], [0.51, 0.305], [0.39, 0.305]], depth: -0.006, rim: 0.004, cavity: 0.7 },
      { view: "rear", points: [[0.55, 0.31], [0.74, 0.31], [0.74, 0.35], [0.55, 0.35]], depth: -0.003, rim: 0.004, cavity: 0 },
      ...HANDLES.flatMap((h) => h.patches),
    ],
  },
};
