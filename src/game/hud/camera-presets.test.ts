import { describe, expect, it } from "vitest";
import { CHASE_KNOBS, type ChaseKnobId } from "../present/drive-cam.ts";
import { activeCameraPreset, CAMERA_PRESETS, cameraPresetValues } from "./camera-presets.ts";
import { INITIAL_HUD } from "./hud-store.ts";

const knobOf = (id: ChaseKnobId) => CHASE_KNOBS.find((k) => k.id === id)!;

describe("given the camera presets", () => {
  it("when Default's values are read, then every camera knob is at today's value, the HUD's own default", () => {
    const [def] = CAMERA_PRESETS;
    expect(def!.label).toBe("Default");
    for (const k of CHASE_KNOBS) expect(cameraPresetValues(def!)[k.id], `${k.id} drifted from today's value`).toBe(INITIAL_HUD[k.id]);
  });

  it("when each variant's overrides are read, then every one is in its slider's range and moves its knob off the default, and the variant sets several", () => {
    for (const p of CAMERA_PRESETS.slice(1)) {
      const ids = Object.keys(p.values) as ChaseKnobId[];
      expect(ids.length, `${p.label} sets ${ids.length}: a preset changes several together`).toBeGreaterThanOrEqual(4);
      for (const id of ids) {
        const k = knobOf(id);
        const v = p.values[id]!;
        expect(v >= k.min && v <= k.max, `${p.label}: ${id} ${v} outside ${k.min}–${k.max}`).toBeTruthy();
        expect(v, `${p.label}: ${id} claims to set ${v}, which is the default`).not.toBe(INITIAL_HUD[id]);
      }
    }
  });

  it("when the presets are compared, then each reads back as itself and no two share every value", () => {
    for (const p of CAMERA_PRESETS) expect(activeCameraPreset(cameraPresetValues(p)), p.label).toBe(p);
    expect(activeCameraPreset({ ...cameraPresetValues(CAMERA_PRESETS[0]!), "cam.shake": 0.1 }), "a slider moved off a preset is no preset").toBe(null);
    expect(new Set(CAMERA_PRESETS.map((p) => p.label)).size).toBe(CAMERA_PRESETS.length);
  });
});
