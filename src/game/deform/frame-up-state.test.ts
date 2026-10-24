import { describe, it } from "node:test";
import * as THREE from "three";
import { StreamedDeformation } from "./streamed-deform.ts";
import { assertSameNumbers, dummyGeom, mass, MODES } from "../vehicle/test-support.ts";

/**
 * The body's up as the last structure step took it (`frameUp`) decides whether a wreck's hubs stand planted (`hubsPlanted`: a body lying
 * on its side stands on none). A wreck that rides its body takes no structure step, so a car rolled over and quiet carries the up of the
 * step it rolled in; a keyframe that left it out put a restored wreck's up back at upright, and the replay clamped a lying wreck as a
 * planted one the step a touch woke it (engine-replay.ai-long-run seeds 7 and 9: masses 1e-14 m off the live sim's, a metre by the end of the clip).
 */
const LYING = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
/** A wreck quiet past `PLANT_QUIET`, its last structure step taken with the body rolled onto its side. */
function lyingWreck(mode: "lattice" | "shape"): { d: StreamedDeformation; group: THREE.Group } {
  const d = new StreamedDeformation(dummyGeom());
  d.mode = mode;
  const group = new THREE.Group();
  group.updateMatrixWorld();
  d.beginCrush(new THREE.Vector3(0, 0.36, 2.06), new THREE.Vector3(0, 0, -1), 10, 10, group, new THREE.Vector3(0, 0, 10), new THREE.Vector3());
  d.stepStructure(0.35, LYING);
  return { d, group };
}

/** `d`'s solver state. */
function stateOf(d: StreamedDeformation): Float64Array {
  const out = new Float64Array(d.simSize());
  d.simState(out, false);
  return out;
}

for (const mode of MODES) {
  describe(`given a wreck whose last structure step was taken lying on its side, in ${mode} deform mode`, () => {
    it("when its solver state is restored into another and a touch then makes both re-measure their frame, then the two clamp alike and hold every number the same", () => {
      const live = lyingWreck(mode);
      const state = stateOf(live.d);
      const restored = lyingWreck(mode);
      restored.d.stepStructure(0.004, new THREE.Quaternion());
      restored.d.simState(state, true);
      for (const w of [live, restored]) {
        const m = mass(w.d, "bumperFL");
        m.world.x += 0.2;
        m.world.z -= 0.1;
        w.d.followGroup(w.group, new THREE.Vector3(), new THREE.Vector3(), 0);
      }
      assertSameNumbers(stateOf(restored.d), stateOf(live.d), "the solver state after the re-measure");
    });
  });
}
