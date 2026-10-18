import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHASE_KNOBS, type ChaseKnobId } from "../present/drive-cam.ts";
import { activeCameraPreset, CAMERA_PRESETS, cameraPresetValues } from "./camera-presets.ts";
import { INITIAL_HUD } from "./hud-store.ts";

const knobOf = (id: ChaseKnobId) => CHASE_KNOBS.find((k) => k.id === id)!;

describe("given the camera presets", () => {
  it("when Default's values are read, then every camera knob is at today's value, the HUD's own default", () => {
    const [def] = CAMERA_PRESETS;
    assert.equal(def!.label, "Default");
    for (const k of CHASE_KNOBS) assert.equal(cameraPresetValues(def!)[k.id], INITIAL_HUD[k.id], `${k.id} drifted from today's value`);
  });

  it("when each variant's overrides are read, then every one is in its slider's range and moves its knob off the default, and the variant sets several", () => {
    for (const p of CAMERA_PRESETS.slice(1)) {
      const ids = Object.keys(p.values) as ChaseKnobId[];
      assert.ok(ids.length >= 4, `${p.label} sets ${ids.length}: a preset changes several together`);
      for (const id of ids) {
        const k = knobOf(id);
        const v = p.values[id]!;
        assert.ok(v >= k.min && v <= k.max, `${p.label}: ${id} ${v} outside ${k.min}–${k.max}`);
        assert.notEqual(v, INITIAL_HUD[id], `${p.label}: ${id} claims to set ${v}, which is the default`);
      }
    }
  });

  it("when the presets are compared, then each reads back as itself and no two share every value", () => {
    for (const p of CAMERA_PRESETS) assert.equal(activeCameraPreset(cameraPresetValues(p)), p, p.label);
    assert.equal(activeCameraPreset({ ...cameraPresetValues(CAMERA_PRESETS[0]!), "cam.shake": 0.1 }), null, "a slider moved off a preset is no preset");
    assert.equal(new Set(CAMERA_PRESETS.map((p) => p.label)).size, CAMERA_PRESETS.length);
  });
});
