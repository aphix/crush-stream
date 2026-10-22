import type { BodyStyle } from "../car-variants.ts";
import { PLATFORM_HARDPOINTS, st } from "./platform.ts";

const { bumpers } = PLATFORM_HARDPOINTS;
/** Chrome bar bumper over a black air dam: a flat face 9 cm proud with rounded top and bottom edges, 17 cm tall, the dam 4 cm lower and 6 cm behind it ([y, out] m, top to bottom). */
const MUSCLE_FRONT_FASCIA = [
  [0.083, -0.07],
  [0.083, 0.062],
  [0.078, 0.082],
  [0.068, 0.09],
  [-0.052, 0.09],
  [-0.062, 0.084],
  [-0.07, 0.072],
  [-0.083, 0.07],
  [-0.083, 0],
  [-0.135, -0.03],
  [-0.135, -0.07],
] as const;

/** Coupe's own lamps and bumper lamps, read off its reference isos and side/top crops. */
const COUPE_LAMP_SHAPES = {
  head: {
    loops: [{ points: [[0.4, 0.51], [0.6, 0.51], [0.6, 0.67], [0.4, 0.67]] }],
    lens: "lit",
    bezel: "chrome",
    recess: 0.008,
  },
  tail: {
    // Rear iso: deep red lenses out to the corner in rounded chrome bezels, three segments each, a black centre band between them edged in chrome.
    loops: [
      { points: [[0.285, 0.58], [0.575, 0.58], [0.592, 0.587], [0.6, 0.605], [0.6, 0.745], [0.592, 0.763], [0.575, 0.77], [0.285, 0.77], [0.268, 0.763], [0.26, 0.745], [0.26, 0.605], [0.268, 0.587]] },
      { side: true, points: [[-2.045, 0.58], [-2.0, 0.58], [-2.0, 0.77], [-2.045, 0.77]] },
    ],
    lens: "red",
    bezel: "chrome",
    recess: 0.015,
    cells: [{ loop: { points: [[0, 0.58], [0.26, 0.58], [0.26, 0.77], [0, 0.77]] }, tone: "dark" }],
    strips: [
      { line: { points: [[0.373, 0.59], [0.373, 0.76]] }, width: 0.004, tone: "dark" },
      { line: { points: [[0.487, 0.59], [0.487, 0.76]] }, width: 0.004, tone: "dark" },
      { line: { points: [[0, 0.772], [0.26, 0.772]] }, width: 0.006, tone: "chrome" },
      { line: { points: [[0, 0.578], [0.26, 0.578]] }, width: 0.006, tone: "chrome" },
    ],
  },
} as const;

/** Chrome rear bar right under the tail lamps: 19 cm tall, 6 cm proud, rounded top and bottom, no splitter ([y, out] m, top to bottom). */
const MUSCLE_REAR_FASCIA = [
  [0.095, -0.06],
  [0.095, 0.02],
  [0.08, 0.05],
  [0.04, 0.06],
  [-0.04, 0.06],
  [-0.08, 0.05],
  [-0.095, 0.02],
  [-0.095, -0.06],
] as const;

/** Bullet mirror in the body colour on a slim dark stalk, as the reference's side view and iso: an 8.5 cm long, 6.5 cm tall head standing 6 cm over its seat on the door top, the stalk 2.5 cm along the car ([out, height, length] m). */
const COUPE_MIRROR = { cap: "rounded", finish: "body", size: [0.09, 0.065, 0.085], lift: 0.06, stalk: 0.025 } as const;

/** Late-70s notchback muscle coupe (Celica Supra A40 proportions): long flat hood, flat roof, sloped rear glass, short ducktail deck. */
export const COUPE: BodyStyle = {
  id: "coupe",
  dims: { wheelbase: 2.385, overhang: { front: 0.823, rear: 0.915 }, track: 1.32, width: 1.571, height: 1.294, rideHeight: 0.182, wheel: { radius: 0.33, width: 0.2 } },
  ...PLATFORM_HARDPOINTS,
  windshield: { base: [0.93, 0.7], wBase: 1.32, wTop: 1.0, bow: { base: 0.015, top: 0.035 } },
  belt: { x: [[-1.5, 0.6], [-0.96, 0.65], [-0.5, 0.665], [0.5, 0.675]], y: [[-0.95, 0.885], [-0.45, 0.888], [0.25, 0.892], [0.4, 0.905], [0.7, 0.93]] },
  rocker: { y: 0.22 },
  underside: [[-2.114, 0.41], [-2.06, 0.31], [-1.96, 0.28], [-1.829, 0.282], [-1.818, 0.267], [-1.744, 0.267], [-1.729, 0.253], [-1.665, 0.257], [-1.644, 0.239], [-1.576, 0.242], [-1.572, 0.225], [-1.548, 0.225], [-1.533, 0.207], [-0.86, 0.182], [-0.835, 0.196], [0.381, 0.196], [0.399, 0.182], [0.723, 0.182], [1.689, 0.21], [1.782, 0.242], [1.893, 0.239], [1.985, 0.285], [2.014, 0.36], [2.017, 0.431]],
  door: { hingeX: 0.74, hingeY: 0.555, hingeZ: 0.61, length: 1.1, halfHeight: 0.335, mirrorY: 0.325, mirrorZ: 0.3, mirrorReach: 0.105, mirrorHalfDepth: 0.08, aperture: [-0.49, 0.6], mirror: COUPE_MIRROR, hingeTop: 0.866 },
  aPillarFoot: 0.5,
  aPillarTop: 0.11,
  bPillar: { rear: -0.54, front: -0.48 },
  arch: { radius: 0.38, lip: { flare: 0.012, width: 0.05, band: true } },
  hood: { z0: 0.7, z1: 1.945, origin: [0.8, 0.68], bulge: { z0: 0.74, z1: 1.71, width: 0.56, cowlWidth: 0.68, rise: 0.025, round: 0.04, cowlRamp: 0.3, scoop: { inlets: 2, z: 1.69, width: 0.48, height: 0.05 } }, groove: [0.004, 0.0016] },
  bumpers: {
    // Ends lofted round the corner and on along the side (reference: 24 cm on the fender, 20 cm on the quarter), standing off the skin.
    front: { ...bumpers.front, seat: { y: 0.405, z: 1.925 }, span: 0.66, wrap: { from: 0.3, back: 0.24, end: { corner: 0.15, stand: 0.03 } }, fascia: MUSCLE_FRONT_FASCIA, trim: "chrome" },
    rear: { ...bumpers.rear, seat: { y: 0.425, z: 2.0475 }, span: 0.72, wrap: { from: 0.45, back: 0.2, end: { corner: 0.1, stand: 0.03 } }, fascia: MUSCLE_REAR_FASCIA, trim: "chrome", plate: 0.29, plateFace: { out: 0.015, color: 0x1c1e22 } },
  },
  profile: [
    st(-2.054, 0.62, 0.857),
    st(-1.979, 0.67, 0.869),
    st(-1.899, 0.7, 0.882),
    st(-1.761, 0.72, 0.904),
    st(-1.662, 0.733, 0.917),
    st(-1.587, 0.74, 0.928),
    st(-1.49, 0.745, 0.96),
    st(-1.43, 0.745, 0.953, 1.011, 0.42, 0.25),
    st(-1.359, 0.745, 0.945, 1.038, 0.43, 0.25),
    st(-1.277, 0.745, 0.937, 1.079, 0.44, 0.25),
    st(-1.216, 0.745, 0.93, 1.193, 0.45, 0.357),
    st(-1.148, 0.745, 0.923, 1.233, 0.46, 0.414),
    st(-1.088, 0.745, 0.917, 1.259, 0.47, 0.623),
    st(-1.023, 0.744, 0.912, 1.215, 0.48, 1),
    st(-0.825, 0.744, 0.904, 1.252, 0.52, 1),
    st(-0.109, 0.747, 0.868, 1.268, 0.53, 1),
    st(-0.043, 0.748, 0.866, 1.265, 0.53, 1),
    st(0.064, 0.749, 0.863, 1.254, 0.53, 1),
    st(0.13, 0.75, 0.862, 1.268, 0.53, 0.926),
    st(0.208, 0.751, 0.862, 1.253, 0.52, 0.82),
    st(0.306, 0.752, 0.864, 1.273, 0.51, 0.729),
    st(0.381, 0.752, 0.866, 1.291, 0.505, 0.591),
    st(0.459, 0.752, 0.868, 1.233, 0.5, 0.517),
    st(0.641, 0.752, 0.874, 1.056, 0.49, 0.25),
    st(0.734, 0.752, 0.88),
    st(0.95, 0.752, 0.87),
    st(1.2, 0.752, 0.848),
    st(1.45, 0.751, 0.824),
    st(1.62, 0.748, 0.8),
    st(1.76, 0.733, 0.785),
    st(1.84, 0.708, 0.768),
    st(1.9, 0.68, 0.7495),
    st(1.93, 0.662, 0.735),
    st(1.945, 0.652, 0.728),
    st(1.957, 0.64, 0.57),
  ],
  roofZ: [-1.04, 0.1],
  windshieldTop: [1.255, 0.12],
  // Round corners: the reference rear iso's four, about a sixth of the 0.53 m slant.
  rearGlass: { base: [0.975, -1.5], top: [1.23, -1.04], wBase: 1.02, wTop: 0.96, bow: { base: -0.02, top: -0.04 }, round: 0.09 },
  quarter: { zRearBot: -0.96, zRearTop: -0.74 },
  /** A body-colour sail from the quarter glass's rear edge onto the quarter's shoulder (reference rear iso), no dark triangle. */
  cPillar: { flush: true },
  midPillarZ: null,
  windowTrim: "chrome",
  chromeStrips: [
    { points: [[-0.79, 0.305], [-0.495, 0.305]], width: 0.016 },
    { points: [[-0.485, 0.305], [0.05, 0.3], [0.595, 0.305]], width: 0.016 },
    { points: [[0.605, 0.305], [0.8, 0.305]], width: 0.016 },
    { points: [[-0.44, 0.745], [-0.3, 0.745]], width: 0.022 },
  ],
  rearBulkhead: { z: -0.9, yTop: 0.89 },
  tubs: [[-0.9, 0.7, 0.3]],
  rearDoorSeam: null,
  boot: { kind: "lid", z0: -1.5, z1: -2.04, origin: [0.975, -1.5], lip: { rise: 0.02, depth: 0.08 }, flush: true },
  lamps: {
    head: [0.5, 0.59],
    tail: [0.37, 0.675],
    shapes: COUPE_LAMP_SHAPES,
    sideMarkers: [
      { at: [0.51, 1.665], size: [0.065, 0.07] },
      { at: [0.54, -1.73], size: [0.08, 0.035] },
    ],
  },
  grille: { y: 0.585, size: [0.75, 0.14], kind: "bars", count: 6, badge: 0.03, finish: "black", bezel: 0.015 },
  exhaust: { tips: 2, x: 0.45, y: 0.24, size: [0.085, 0.06], shape: "round" },
  camera: { hood: [1.12, 1.0], third: { dist: 6.1, height: 1.95, aimUp: 0.95 }, far: { dist: 9.9, height: 3.25, aimUp: 1.1 } },
  details: {
    lines: [
      { view: "side", points: [[0.592, 0.848], [0.592, 0.606], [0.606, 0.321]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[-0.506, 0.891], [-0.506, 0.606], [-0.506, 0.321]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[0.606, 0.307], [0.05, 0.299], [-0.506, 0.307]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "side", points: [[0.506, 0.895], [0.25, 0.894], [-0.45, 0.89], [-0.962, 0.905]], width: 0.021, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[0.791, 0.292], [-0.007, 0.285], [-0.82, 0.278]], width: 0.021, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[0.763, 0.242], [-0.036, 0.235], [-0.777, 0.228]], width: 0.012, depth: -0.003, profile: "v", cavity: 0.7 },
      { view: "side", points: [[1.889, 0.72], [1.732, 0.741], [1.504, 0.763], [1.219, 0.77], [0.934, 0.777], [0.606, 0.784], [0.05, 0.791], [-0.506, 0.798], [-0.991, 0.813], [-1.49, 0.841], [-1.975, 0.863]], width: 0.02, depth: 0.0025, profile: "u", cavity: 0 },
      { view: "side", points: [[0.506, 0.895], [0.307, 1.048], [0.107, 1.19], [-0.207, 1.19], [-0.506, 1.176], [-0.506, 0.89]], closed: true, width: 0.016, depth: 0.0015, profile: "u", cavity: 0.3 },
      { view: "side", points: [[0.52, 0.848], [0.421, 0.948], [0.307, 1.062], [0.192, 1.148], [0.107, 1.205]], width: 0.021, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[-0.506, 1.176], [-0.506, 0.891]], width: 0.025, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[-0.535, 1.162], [-0.74, 1.162], [-0.962, 0.905], [-0.948, 0.891], [-0.535, 0.891]], closed: true, width: 0.016, depth: 0.0015, profile: "u", cavity: 0.3 },
      { view: "side", points: [[0.691, 0.92], [0.535, 1.005], [0.335, 1.119], [0.093, 1.233]], width: 0.014, depth: 0.0015, profile: "u", cavity: 0.3 },
      { view: "side", points: [[-0.834, 1.148], [-0.977, 1.105], [-1.148, 1.048], [-1.319, 0.977], [-1.433, 0.934]], width: 0.016, depth: 0.0015, profile: "u", cavity: 0.3 },
      { view: "side", points: [[0.107, 1.205], [-0.207, 1.19], [-0.634, 1.183], [-0.848, 1.162], [-0.977, 1.133]], width: 0.014, depth: 0.002, profile: "u", cavity: 0.1 },
      { view: "side", points: [[-1.433, 0.991], [-1.461, 0.948], [-1.49, 0.891]], width: 0.012, depth: -0.004, profile: "v", cavity: 0.85 },
      { view: "top", points: [[1.64, 0], [0.84, 0]], width: 0.008, depth: -0.002, profile: "v", cavity: 0.4 },
      { view: "rear", points: [[0, 0.74], [0.75, 0.74]], width: 0.012, depth: 0.002, profile: "u", cavity: 0.1 },
    ],
    patches: [
      { view: "side", points: [[-0.307, 0.756], [-0.435, 0.756], [-0.435, 0.727], [-0.307, 0.727]], depth: -0.004, rim: 0.004, cavity: 0.5 },
      { view: "side", points: [[0.734, 0.435], [0.663, 0.435], [0.663, 0.406], [0.734, 0.406]], depth: 0.0015, rim: 0.002, cavity: 0.1 },
      { view: "side", points: [[1.689, 0.535], [1.618, 0.535], [1.618, 0.478], [1.689, 0.478]], depth: -0.002, rim: 0.003, cavity: 0.3 },
      { view: "side", points: [[-1.661, 0.556], [-1.746, 0.556], [-1.746, 0.52], [-1.661, 0.52]], depth: -0.002, rim: 0.003, cavity: 0.3 },
      { view: "rear", points: [[0, 0.6], [0.31, 0.6], [0.31, 0.72], [0, 0.72]], depth: -0.002, rim: 0.003, cavity: 0.8 },
      { view: "rear", points: [[0, 0.63], [0.035, 0.64], [0.05, 0.66], [0.035, 0.68], [0, 0.69]], depth: 0.0015, rim: 0.002, cavity: 0.1 },
      { view: "rear", points: [[0, 0.3], [0.16, 0.3], [0.16, 0.42], [0, 0.42]], depth: -0.005, rim: 0.004, cavity: 0.6 },
      { view: "front", points: [[0, 0.32], [0.7, 0.32], [0.7, 0.38], [0, 0.38]], depth: 0.003, rim: 0.003, cavity: 0.2 },
    ],
  },
  seats: { front: [0.36, 0.44, -0.15], rear: [0.46, -0.6] },
};
