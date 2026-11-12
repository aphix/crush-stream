import { hypot2 } from "../../kernel/physics-core.js";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../../engine/engine-headless.test-util.ts";
import { TrafficLightArt } from "../../present/traffic-lights.ts";
import { PREFAB } from "../constants.ts";
import { propColliders } from "../placements.ts";
import { parseTrack } from "../track-schema.ts";
import { LAYOUT } from "./openworld-constants.ts";
import { openWorldCourse } from "./openworld-course.ts";
import { openWorldGeometry } from "./openworld-layout.ts";
import { fixtureLots } from "./openworld-lots.test-util.ts";
import { buildRoadNetwork } from "./openworld-roads.ts";
import { SIGNAL_POLE, signalPoleProps } from "./openworld-signal-poles.ts";

/** A solid pole stands where its drawn one does: within this (m), a float32 of the network's junctions. */
const SAME_SPOT = 1e-4;
/** A bumper's height (m): a pole's solid must reach it to stop a car. */
const BUMPER_HEIGHT = 0.5;

const network = buildRoadNetwork(openWorldGeometry(LAYOUT));
const solid = signalPoleProps(network);

/** Where each pole of the drawing stands (the plan x, z of its instance). */
function drawnPoles(): { x: number; z: number }[] {
  stubBrowser();
  const art = new TrafficLightArt(network);
  const poles = art.group.children[0] as THREE.InstancedMesh;
  const matrix = new THREE.Matrix4();
  const spots = Array.from({ length: poles.count }, (_, index) => {
    poles.getMatrixAt(index, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  });
  art.dispose();
  return spots;
}

describe("given the open world's traffic lights", () => {
  const drawn = drawnPoles();

  // mutation: sed -i 's/ + ((heading + 2) % HEADING_COUNT)\]! < 0) continue;/ + ((heading + 2) % HEADING_COUNT)]! < -1) continue;/' src/game/world/openworld/openworld-signal-poles.ts
  // mutation: sed -i 's/fromCurb: 0.6,/fromCurb: 0.7,/' src/game/world/openworld/openworld-signal-poles.ts
  it("when the poles are drawn, then a solid of the pole's size stands at every one, and at no other spot", () => {
    expect(drawn.length, "poles drawn").toBeGreaterThan(30);
    expect(solid.length, "solid poles").toBe(drawn.length);
    for (const spot of drawn) expect(solid.filter((pole) => hypot2(pole.x - spot.x, pole.z - spot.z) < SAME_SPOT).length, `solid poles at the drawn one at ${spot.x.toFixed(2)}, ${spot.z.toFixed(2)}`).toBe(1);
  });

  // mutation: sed -i 's/...signalPoleProps(buildRoadNetwork(geometry)), //' src/game/world/openworld/openworld-course.ts
  it("when the course is placed, then every pole is a solid prop a car meets, reaching a bumper's height", () => {
    const course = parseTrack(openWorldCourse(fixtureLots(LAYOUT.wallReach)));
    const poles = course.props.filter((prop) => prop.prefab === PREFAB.invisibleWall && prop.size?.[0] === SIGNAL_POLE.width && prop.size[1] === SIGNAL_POLE.poleHeight);
    expect(poles.length, "solid poles in the course").toBe(drawn.length);
    const pieces = propColliders(poles.map((pole) => ({ prefab: pole.prefab, x: pole.x, y: 0, z: pole.z, yaw: pole.yaw, sx: pole.size![0], sy: pole.size![1], sz: pole.size![2] })));
    expect(pieces.length, "one box a pole").toBe(poles.length);
    for (const piece of pieces) {
      expect(piece.body, "what a car meets").toBe("solid");
      expect(piece.top - piece.base, "the pole's solid height (m)").toBeGreaterThanOrEqual(BUMPER_HEIGHT);
      expect(piece.hx, "half the pole's width (m)").toBeCloseTo(SIGNAL_POLE.width / 2, 6);
    }
  });
});
