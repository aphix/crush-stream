import { EPICENTER_KNOBS } from "../deform/epicenter.ts";
import { KNOBS } from "./knobs.ts";

/** The Debug views' collapsible sub-sections: the camera's sliders (and presets) and the epicenter activation's tuning sliders. */
export type DebugSubsection = "camera" | "epicenter";

/** The stored value of an open sub-section: any other (the "" nothing is stored as) is closed, so each starts closed. */
export const SUBSECTION_OPEN = "1";

/** Where each sub-section keeps its open state (the HUD's preference store, `useStoredString`). */
export const SUBSECTION_STORAGE_KEY: Record<DebugSubsection, string> = { camera: "crush.hud.camera", epicenter: "crush.hud.epicenter" };

/** The sub-section a knob's slider sits in: every `epi.*` knob in the epicenter's, every other (the camera's) in the camera's. */
export function subsectionOf(knob: (typeof KNOBS)[number]): DebugSubsection {
  return EPICENTER_KNOBS.some((k) => k.id === knob.id) ? "epicenter" : "camera";
}
