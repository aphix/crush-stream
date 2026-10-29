import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { INITIAL_HUD, KNOB_RANGES, squashForStroke, strokeAt56 } from "./hud-store.ts";
import { StreamedDeformation } from "../deform/streamed-deform.ts";
import { KNOBS, type KnobId } from "./knobs.ts";

// The engine seeds and resets its knobs from INITIAL_HUD and pushes them into every car's
// deformer (`dressCar`); headless cars and tests use the deformer's own field defaults.
describe("given the calibrated crash knob defaults (squash, buckle and realism)", () => {
  it("when a fresh deformer is built, then it starts at the HUD defaults, so Defaults reproduces the headless car", () => {
    const d = new StreamedDeformation(new THREE.BoxGeometry(1.7, 1.3, 4.3, 3, 2, 6));
    expect(d.squash).toBe(INITIAL_HUD.squash);
    expect(d.buckle).toBe(INITIAL_HUD.buckle);
  });

  it("when each default is compared with its slider range, then it sits inside the range", () => {
    for (const k of ["squash", "buckle", "realism", "musicVolume", "engineVolume"] as const) {
      const r = KNOB_RANGES[k];
      expect(r.min, `${k} range ${r.min}–${r.max}`).toBeLessThan(r.max);
      expect(INITIAL_HUD[k] >= r.min && INITIAL_HUD[k] <= r.max, `${k} ${INITIAL_HUD[k]} outside ${r.min}–${r.max}`).toBeTruthy();
    }
  });

  it("when each camera slider's default is compared with its range, then it sits inside the range, and every slider has its own row", () => {
    for (const k of KNOBS) {
      expect(k.min, `${k.id} range ${k.min}–${k.max}`).toBeLessThan(k.max);
      expect(INITIAL_HUD[k.id] >= k.min && INITIAL_HUD[k.id] <= k.max, `${k.id} ${INITIAL_HUD[k.id]} outside ${k.min}–${k.max}`).toBeTruthy();
    }
    expect(new Set(KNOBS.map((k) => k.id)).size, "no two rows share an id").toBe(KNOBS.length);
    // `Record<KnobId, true>` fails tsc when an id is missing here or unknown to the type; the rows must be exactly these ids.
    const ids: Record<KnobId, true> = {
      "cam.pos.lon": true, "cam.pos.lat": true, "cam.pos.up": true,
      "cam.zeta.lon": true, "cam.zeta.lat": true, "cam.zeta.up": true,
      "cam.maxSpeed": true, "cam.aheadVel": true, "cam.aheadMax": true,
      "cam.fovSlide": true, "cam.driftTilt": true, "cam.driftLean": true,
      "cam.landing.fall": true, "cam.landing.zetaUp": true, "cam.landing.hold": true, "cam.landing.wobble": true, "cam.landing.wobbleHz": true,
      "cam.shake": true, "cam.shiftKick": true,
      "epi.on": true, "epi.relockHold": true, "epi.settleMps": true, "epi.settleSpin": true, "epi.presentSkip": true, "epi.nearPrune": true, "epi.frozenCheck": true, "epi.thawHold": true, "epi.feedMin": true, "epi.holdWakes": true, "epi.wreckTops": true, "epi.preClear": true, "epi.storedSkip": true,
    };
    expect(KNOBS.map((k) => k.id).sort().join(" "), "the rows are exactly the KnobId union").toBe(Object.keys(ids).sort().join(" "));
  });

  it("when a stroke is written to the stroke slider and read back (stroke → squash → stroke), then it reads back what was written", () => {
    for (const m of [0.4, 0.47, 0.51, 0.62, 0.75]) {
      expect(Math.abs(strokeAt56(squashForStroke(m)) - m), `${m} m`).toBeLessThan(1e-12);
    }
  });

  it("when the default squash sets the 56 km/h stroke, then the stroke sits in the real dynamic-crush band (0.35–0.55 m)", () => {
    const m = strokeAt56(INITIAL_HUD.squash);
    expect(m >= 0.35 && m <= 0.55, `default stroke ${m.toFixed(3)} m`).toBeTruthy();
  });
});
