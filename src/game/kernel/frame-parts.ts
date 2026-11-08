/**
 * Where a rendered frame's main-thread ms goes, by named part, and what work each part did. Parts tile the frame: each `lapPart` adds the time since the
 * previous lap to its slot, so the slots sum to the frame with one clock read per boundary. Off (every run but a bench's) a lap is one branch.
 */
export const PART = { rest: 0, input: 1, sim: 2, skin: 3, paint: 4, scenery: 5, fx: 6, camera: 7, hud: 8, audio: 9, ragdoll: 10, matrices: 11, batches: 12, marks: 13, shadow: 14, main: 15, post: 16 } as const;
// The names are the keys, in slot order: no second list of the same words to keep in step.
export const PART_NAMES = Object.keys(PART) as (keyof typeof PART)[];
export const PART_COUNT = PART_NAMES.length;

/** Work counters, plain adds kept always; a window reads differences. The skin kernel's two are read off the kernel each frame, not added. */
export const COUNT = { skinnedCars: 0, skinKernelCalls: 1, skinVerts: 2, wearRedraws: 3, wearUploads: 4, wearUploadBytes: 5, dentRedraws: 6, spatterStamps: 7, propsMoved: 8, plantTests: 9, leavesLive: 10, callsShadow: 11, callsMain: 12, programsAdded: 13, geometriesAdded: 14, texturesAdded: 15 } as const;
export const COUNT_NAMES = Object.keys(COUNT) as (keyof typeof COUNT)[];
export const COUNT_COUNT = COUNT_NAMES.length;

class FrameParts {
  on = false;
  last = 0;
  readonly ms = new Float64Array(PART_COUNT);
  readonly count = new Float64Array(COUNT_COUNT);
}

export const frameParts = new FrameParts();

/** Opens a frame at `now` (the frame's own first clock read): laps count until `endParts`, and not between frames (a warm-up draw there is no part of one). */
export function startParts(now: number): void {
  frameParts.on = true;
  frameParts.last = now;
}

/** Adds the time since the last lap (or `startParts`) to `slot`. */
export function lapPart(slot: number): void {
  const p = frameParts;
  if (!p.on) return;
  const now = performance.now();
  p.ms[slot] = p.ms[slot]! + (now - p.last);
  p.last = now;
}

/** Closes the frame at `now`: what is left since the last lap goes to `rest`, and the laps stop. */
export function endParts(now: number): void {
  const p = frameParts;
  if (!p.on) return;
  p.ms[PART.rest] = p.ms[PART.rest]! + (now - p.last);
  p.on = false;
}

/** `n` more of counter `slot`. */
export function countPart(slot: number, n: number): void {
  frameParts.count[slot] = frameParts.count[slot]! + n;
}
