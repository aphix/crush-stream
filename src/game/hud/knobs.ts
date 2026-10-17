import { CHASE_KNOBS, chaseValues, type ChaseKnob, type ChaseKnobId } from "../present/drive-cam.ts";
import { EPICENTER_KNOBS, type EpicenterKnob, type EpicenterKnobId } from "../deform/epicenter.ts";

/** Every Debug-panel slider: its id is its HUD field, its settings entry and its share-URL key (`cam.pos.lon`, `epi.relockHold`). */
export type KnobId = ChaseKnobId | EpicenterKnobId;
type Knob = ChaseKnob | EpicenterKnob;

/** The camera's knobs, then the epicenter activation's. */
export const KNOBS: readonly Knob[] = [...CHASE_KNOBS, ...EPICENTER_KNOBS];

/** Every knob's live value by id (the HUD fields and share-state keys). */
export function knobValues(): Record<KnobId, number> {
  const out = { ...chaseValues() } as Record<KnobId, number>;
  for (let i = 0; i < EPICENTER_KNOBS.length; i++) out[EPICENTER_KNOBS[i]!.id] = EPICENTER_KNOBS[i]!.get();
  return out;
}

/** The knobs' values at module load, before anything mutates them: the defaults of `INITIAL_HUD`, the settings and the share URL. */
export const KNOB_DEFAULTS = knobValues();
