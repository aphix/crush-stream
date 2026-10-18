import { CHASE_KNOBS, type ChaseKnobId } from "../present/drive-cam.ts";
import { KNOB_DEFAULTS } from "./knobs.ts";

/** What a preset overrides: every camera knob it does not name keeps its default, so a preset is the same picture whatever was set before it. */
type Overrides = Partial<Record<ChaseKnobId, number>>;

type CameraPreset = { label: string; values: Overrides };

/** Today's camera, exactly: every knob at its module-load value (`KNOB_DEFAULTS`), so Default restores whatever a variant moved. */
const PRESET_DEFAULT: CameraPreset = { label: "Default", values: {} };

/** Tight: stiff springs and critical damping hold the eye close behind the car with no overshoot; short look-ahead and a light shake keep the picture still. */
const PRESET_TIGHT: CameraPreset = {
  label: "Tight",
  values: {
    "cam.pos.lon": 13, "cam.pos.lat": 9, "cam.pos.up": 11,
    "cam.zeta.up": 1,
    "cam.aheadVel": 0.1, "cam.aheadMax": 1.5,
    "cam.fovSlide": 2,
    "cam.landing.zetaUp": 0.9, "cam.landing.wobble": 0.3,
    "cam.shake": 0.6,
  },
};

/** Cinematic: soft springs let the eye trail the car and swing past its target (low damping on every axis), with a long look-ahead, a wide slide, a long bouncy landing and strong shake. */
const PRESET_CINEMATIC: CameraPreset = {
  label: "Cinematic",
  values: {
    "cam.pos.lon": 5, "cam.pos.lat": 3.5, "cam.pos.up": 4.5,
    "cam.zeta.lon": 0.7, "cam.zeta.lat": 0.7, "cam.zeta.up": 0.5,
    "cam.aheadVel": 0.3, "cam.aheadMax": 6,
    "cam.fovSlide": 7, "cam.driftTilt": 1.5,
    "cam.landing.zetaUp": 0.35, "cam.landing.hold": 1, "cam.landing.wobble": 1.4, "cam.landing.wobbleHz": 7,
    "cam.shake": 1.3,
  },
};

/** Drift: everything that sells a slide turned up (field of view, roll, the body's lean) with a loose lateral spring that swings the view into the corner and a long look-ahead that leads it. */
const PRESET_DRIFT: CameraPreset = {
  label: "Drift",
  values: {
    "cam.pos.lat": 3.5,
    "cam.zeta.lat": 0.6,
    "cam.aheadVel": 0.3, "cam.aheadMax": 7,
    "cam.fovSlide": 8, "cam.driftTilt": 3, "cam.driftLean": 1,
  },
};

/** Steady: for judging a crash or a course, not the ride: a speed cap on the eye, critical damping everywhere, no landing wobble, no slide effects and little shake or gear-change kick. */
const PRESET_STEADY: CameraPreset = {
  label: "Steady",
  values: {
    "cam.pos.lon": 7, "cam.pos.lat": 4.5, "cam.pos.up": 5.5,
    "cam.zeta.up": 1,
    "cam.maxSpeed": 12,
    "cam.fovSlide": 0, "cam.driftLean": 0.2,
    "cam.landing.zetaUp": 1, "cam.landing.wobble": 0,
    "cam.shake": 0.3, "cam.shiftKick": 0.3,
  },
};

/** The camera presets in panel order, Default first. */
export const CAMERA_PRESETS: readonly CameraPreset[] = [PRESET_DEFAULT, PRESET_TIGHT, PRESET_CINEMATIC, PRESET_DRIFT, PRESET_STEADY];

/** The camera knobs a preset covers: every chase knob (the epicenter's are not the camera's). */
const CAMERA_IDS: readonly ChaseKnobId[] = CHASE_KNOBS.map((k) => k.id);

/** What the preset sets: all of the camera's knobs, the defaults under its own overrides. */
export function cameraPresetValues(p: CameraPreset): Record<ChaseKnobId, number> {
  const out = {} as Record<ChaseKnobId, number>;
  for (const id of CAMERA_IDS) out[id] = p.values[id] ?? KNOB_DEFAULTS[id];
  return out;
}

/** Numbers match at the share URL's precision (4 decimals), as `isChanged` does: a link carries the preset back exactly. */
const MATCH_EPS = 1e-4;

/** The preset the camera knobs in `s` are exactly at (the choice follows the knobs, so a link, a reset or a slider drag moves it), or null once they are none of them. */
export function activeCameraPreset(s: Readonly<Record<ChaseKnobId, number>>): CameraPreset | null {
  return CAMERA_PRESETS.find((p) => CAMERA_IDS.every((id) => Math.abs(s[id] - cameraPresetValues(p)[id]) < MATCH_EPS)) ?? null;
}
