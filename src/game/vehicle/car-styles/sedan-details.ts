import type { BodyStyle } from "../car-variants.ts";
import { pullHandle } from "./platform.ts";

type Details = NonNullable<BodyStyle["details"]>;
type Line = Details["lines"][number];
type Patch = Details["patches"][number];

const GAP = { width: 0.01, depth: -0.004, profile: "v", cavity: 0.85 } as const;
const CREASE = { width: 0.02, depth: 0.003, profile: "u", cavity: 0 } as const;
const SEAL = { width: 0.012, depth: 0.002, profile: "u", cavity: 0.3 } as const;
const TRIM = { width: 0.01, depth: -0.003, profile: "u", cavity: 0.4 } as const;
const VENT = { depth: -0.005, rim: 0.006, pattern: { kind: "hslats", pitch: 0.012, bar: 0.004, depth: 0.003 }, cavity: 0.7 } as const;
const BADGE = { depth: 0.002, rim: 0.003, cavity: 0 } as const;

const SHARED_LINES: readonly Line[] = [
  // The hood's side shut line on the drawn lid's edge (hw - 0.07, CarGreenhouse3's ca1dce92) from its rear edge (0.99) to the nose; the lid's straight rear edge is its own seam.
  { view: "top", points: [[0.99, 0.72], [1.235, 0.72], [1.481, 0.695], [1.642, 0.679], [1.734, 0.676], [1.82, 0.622], [1.898, 0.504], [1.96, 0.435]], ...GAP },
  { view: "front", points: [[0.4, 0.345], [0.55, 0.345], [0.62, 0.345]], ...GAP, width: 0.008 },
  { view: "side", points: [[0.71, 0.245], [0.4, 0.25], [0, 0.25], [-0.22, 0.25]], ...GAP },
  { view: "side", points: [[-1.05, 0.95], [-1.086, 0.86], [-1.085, 0.8], [-1.056, 0.75], [-1, 0.66], [-0.94, 0.59], [-0.9, 0.505], [-0.84, 0.4], [-0.795, 0.3], [-0.77, 0.26]], ...GAP },
  { view: "side", points: [[-0.77, 0.255], [-0.5, 0.252], [-0.22, 0.25]], ...GAP },
  { view: "side", points: [[1.52, 0.7], [1.37, 0.742], [1.2, 0.786], [1.02, 0.816], [0.84, 0.83], [0.73, 0.835]], ...CREASE },
  // The shoulder along both doors: the reference's highlight peaks at y ~0.82, level from the front door to the rear one (silver-sedan-1.png,
  // 70.1 px/m), 8 cm under the glass; it meets the front fender's crease at the door's front edge and the quarter's behind the rear door.
  { view: "side", points: [[0.73, 0.835], [0.4, 0.828], [0, 0.822], [-0.5, 0.825], [-0.9, 0.84], [-1.09, 0.855]], ...CREASE },
  { view: "side", points: [[-1.06, 0.945], [-1.3, 0.94], [-1.5, 0.935], [-1.7, 0.94], [-1.9, 0.95], [-2, 0.955]], ...CREASE },
  { view: "side", points: [[-1.09, 0.855], [-1.3, 0.85], [-1.5, 0.85], [-1.7, 0.855]], ...CREASE },
  { view: "side", points: [[0.72, 0.405], [0.4, 0.395], [0, 0.385], [-0.22, 0.385], [-0.5, 0.385], [-0.75, 0.39]], ...CREASE, profile: "step", depth: -0.003 },
  { view: "side", points: [[1.61, 0.16], [1.605, 0.335], [1.593, 0.427], [1.557, 0.513], [1.501, 0.586], [1.428, 0.642], [1.342, 0.678], [1.25, 0.69], [1.158, 0.678], [1.073, 0.642], [0.999, 0.586], [0.943, 0.513], [0.907, 0.427], [0.895, 0.335], [0.89, 0.16]], ...CREASE },
  { view: "side", points: [[-0.89, 0.16], [-0.895, 0.335], [-0.907, 0.427], [-0.943, 0.513], [-0.999, 0.586], [-1.073, 0.642], [-1.158, 0.678], [-1.25, 0.69], [-1.342, 0.678], [-1.428, 0.642], [-1.501, 0.586], [-1.557, 0.513], [-1.593, 0.427], [-1.605, 0.335], [-1.61, 0.16]], ...CREASE },
  { view: "top", points: [[0.28, 0.52], [0.1, 0.505], [-0.2, 0.5], [-0.5, 0.495], [-0.8, 0.495], [-1, 0.495], [-1.1, 0.49]], ...CREASE, depth: -0.003 },
  { view: "side", points: [[0.66, 0.885], [0.6, 0.93], [0.52, 0.985], [0.43, 1.04], [0.32, 1.1], [0.21, 1.16], [0.1, 1.2], [0, 1.225], [-0.12, 1.235], [-0.285, 1.24], [-0.4, 1.24], [-0.67, 1.235], [-0.885, 1.2], [-1, 1.18], [-1.12, 1.13], [-1.205, 1.085], [-1.26, 1.045]], ...SEAL },
  { view: "side", points: [[0.66, 0.885], [0.4, 0.895], [0, 0.905], [-0.22, 0.915], [-0.5, 0.93], [-0.9, 0.945], [-1.02, 0.965], [-1.12, 0.99], [-1.2, 1.02], [-1.26, 1.045]], ...SEAL },
  { view: "side", points: [[-0.265, 0.89], [-0.31, 1.235], [-0.385, 1.235], [-0.35, 0.92]], closed: true, ...SEAL },
  { view: "side", points: [[-0.915, 0.945], [-0.89, 1.2]], ...SEAL },
  { view: "side", points: [[-0.89, 1.2], [-1, 1.18], [-1.12, 1.13], [-1.205, 1.085], [-1.26, 1.045], [-1.2, 1.02], [-1.12, 0.99], [-1.02, 0.965], [-0.915, 0.945]], closed: true, ...SEAL },
  { view: "top", points: [[1.04, 0], [1.03, 0.19], [1, 0.36], [0.915, 0.55], [0.81, 0.66], [0.27, 0.535], [0.29, 0.42], [0.31, 0.22], [0.32, 0]], ...SEAL },
  { view: "top", points: [[-1.157, 0], [-1.14, 0.25], [-1.11, 0.49], [-1.62, 0.52], [-1.66, 0.47], [-1.7, 0.36], [-1.73, 0.19], [-1.74, 0]], ...SEAL },
  { view: "top", points: [[0.56, 0.69], [0.2, 0.7], [0, 0.7], [-0.5, 0.7], [-0.9, 0.69], [-1.26, 0.63]], ...SEAL },
  { view: "side", points: [[0.64, 0.905], [0.52, 0.885], [0.55, 0.84], [0.62, 0.845]], closed: true, ...TRIM },
  { view: "side", points: [[0.8, 0.245], [0, 0.245], [-0.8, 0.245], [-0.8, 0.175], [0, 0.175], [0.8, 0.175]], closed: true, ...TRIM },
  { view: "side", points: [[0.78, 0.23], [0.62, 0.23]], ...TRIM },
  { view: "top", points: [[2.02, 0], [2.01, 0.25], [1.955, 0.4]], ...GAP },
  { view: "top", points: [[2, 0.3], [1.86, 0.36], [1.7, 0.42], [1.5, 0.47], [1.25, 0.52], [1, 0.56], [0.9, 0.57]], ...CREASE, profile: "step" },
  { view: "front", points: [[0, 0.195], [0.3, 0.195], [0.45, 0.19], [0.58, 0.185], [0.66, 0.18], [0.72, 0.175]], ...TRIM },
  { view: "top", points: [[-2.08, 0], [-2.075, 0.25], [-2.05, 0.45], [-1.99, 0.58]], ...CREASE },
  { view: "top", points: [[-2.03, 0], [-2.03, 0.25], [-2.015, 0.5]], ...CREASE, depth: -0.003 },
  { view: "rear", points: [[0, 0.755], [0.26, 0.755], [0.26, 0.63], [0, 0.63]], ...TRIM },
  { view: "side", points: [[-1.65, 0.285], [-1.8, 0.31], [-1.95, 0.35], [-2.06, 0.385], [-2.12, 0.41]], ...CREASE },
];

const SEDAN_LINES: readonly Line[] = [
  { view: "top", points: [[-0.88, 0], [-0.88, 0.027], [-1.03, 0.027], [-1.03, 0]], ...TRIM },
  { view: "top", points: [[2.03, 0], [2.015, 0.25], [1.97, 0.4]], ...SEAL },
  { view: "front", points: [[0, 0.205], [0.2, 0.205], [0.4, 0.205]], ...SEAL },
];

const POLICE_LINES: readonly Line[] = [
  { view: "front", points: [[0, 0.29], [0.2, 0.29], [0.45, 0.29], [0.6, 0.29], [0.7, 0.29], [0.74, 0.29]], ...TRIM },
  { view: "top", points: [[-0.978, 0], [-0.984, 0.016], [-1, 0.022], [-1.016, 0.016], [-1.022, 0]], ...TRIM },
  { view: "rear", points: [[0, 0.745], [0.15, 0.745], [0.15, 0.6], [0, 0.6]], ...TRIM },
  { view: "rear", points: [[0, 0.4], [0.45, 0.4], [0.66, 0.4], [0.76, 0.4]], ...TRIM },
];

const SHARED_PATCHES: readonly Patch[] = [
  { view: "side", points: [[0.9, 0.655], [0.9, 0.69], [0.775, 0.69], [0.775, 0.655]], ...VENT },
  { view: "top", points: [[-1.96, 0], [-1.96, 0.04], [-2.03, 0.04], [-2.03, 0]], ...BADGE },
  { view: "rear", points: [[0, 0.41], [0.4, 0.41], [0.64, 0.41], [0.6, 0.32], [0.58, 0.235], [0.3, 0.23], [0, 0.228]], depth: -0.004, rim: 0.008, pattern: { kind: "vslats", pitch: 0.06, bar: 0.01, depth: 0.004 }, cavity: 0.5 },
];

const SEDAN_PATCHES: readonly Patch[] = [
  { view: "top", points: [[1.99, 0], [1.984, 0.014], [1.97, 0.02], [1.956, 0.014], [1.95, 0]], ...BADGE },
  { view: "front", points: [[0, 0.3], [0.3, 0.298], [0.46, 0.296], [0.47, 0.27], [0.4, 0.216], [0.2, 0.213], [0, 0.212]], depth: -0.005, rim: 0.006, cavity: 0.7 },
  { view: "side", points: [[1.79, 0.5], [1.745, 0.5], [1.73, 0.31], [1.775, 0.31]], ...VENT },
  { view: "rear", points: [[0, 0.88], [0.035, 0.88], [0.035, 0.93], [0, 0.93]], ...BADGE },
];

const POLICE_PATCHES: readonly Patch[] = [
  { view: "front", points: [[0, 0.27], [0.38, 0.27], [0.38, 0.21], [0, 0.21]], ...VENT },
  { view: "rear", points: [[0, 0.82], [0.025, 0.795], [0, 0.77]], ...BADGE },
  // The roof's black antenna dome on the centre line (cop isos; R ~22 mm at z -1.0): a raised dark disc in the roof's height map.
  { view: "top", points: [[-0.978, 0], [-0.984, 0.0156], [-1.0, 0.022], [-1.016, 0.0156], [-1.022, 0]], depth: 0.006, rim: 0.012, cavity: 0.9 },
];

/** The door pull handles at the reference's places (gridded side, 430 px/m): front z +0.08..-0.11 at y 0.762, rear -0.742..-0.932 at 0.777. */
const HANDLES = [pullHandle(0.08, -0.11, 0.762, 0.04), pullHandle(-0.742, -0.932, 0.777, 0.035)];

/** Every sedan flank, top, nose and tail detail the two measurement scouts reported. */
export const SEDAN_DETAILS: Details = {
  lines: [...SHARED_LINES, ...SEDAN_LINES, ...HANDLES.flatMap((h) => h.lines)],
  patches: [...SHARED_PATCHES, ...SEDAN_PATCHES, ...HANDLES.flatMap((h) => h.patches)],
};

/** The sedan body with the cop's own front fascia and tail lamps swapped in for the sedan's (exhaust tips are geometry: `exhaust`). */
export const POLICE_DETAILS: Details = {
  lines: [...SHARED_LINES, ...POLICE_LINES, ...HANDLES.flatMap((h) => h.lines)],
  patches: [...SHARED_PATCHES, ...POLICE_PATCHES, ...HANDLES.flatMap((h) => h.patches)],
};
