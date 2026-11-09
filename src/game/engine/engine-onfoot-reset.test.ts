import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { RESET_HOLD } from "../hud/reset-hold.ts";
import { occluder, inside } from "../present/spectate-cam.ts";
import { blankPoint, blankProjection, pointOn, projectPath } from "../world/track.ts";
import { planBlocks } from "../world/openworld/openworld-blocks.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { OnFootRig } from "./engine-onfoot.test-util.ts";

/** The seconds of frames after a press that the reset needs (the tap acts on the release, a frame on). */
const TAP_S = 0.3;
/** The climb back in (`OnFootFlow`) and a frame's slack (s). */
const CLIMB_IN_S = 0.9;
/** The search's reach along the road (m): `roadSpotNear`'s seven steps of 6 m, a car's length and a gap each. */
const SEARCH_REACH_M = 42;
/** A car's half width (m) and a slack: the car's middle is at least this far inside any solid it is clear of. */
const CAR_CLEAR_M = 1.5;
/** The most a car's heading may be off along its road (the sine of the turn: the road's two ways are both along it). */
const ALONG_MAX = 0.2;

/** The first lawn of the open world: the park's open ground, where nothing stands between him and a car. */
const lawn = planBlocks(layOutLots().geometry).playable.find((block) => block.park)!.lawn!;
const lawnMiddle = new THREE.Vector3((lawn.x0 + lawn.x1) / 2, 0, (lawn.z0 + lawn.z1) / 2);

describe("given the real engine on the open world, the player's car on the park's lawn", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const car = () => rig.cars()[0]!;
  /** The distance (m) from (x, z) to the nearest road's centre line, and that road's direction there (x, z). */
  const nearestRoad = (x: number, z: number): { distance: number; tx: number; tz: number } => {
    const out = blankProjection();
    const at = blankPoint();
    let best = { distance: Infinity, tx: 0, tz: 1 };
    for (const path of rig.engine["race"]["track"]!.paths()) {
      projectPath(path, x, z, -1, out);
      if (Math.sqrt(out.dist2) >= best.distance) continue;
      pointOn(path, out.s, at);
      best = { distance: Math.sqrt(out.dist2), tx: at.tx, tz: at.tz };
    }
    return best;
  };
  const roadDistance = (x: number, z: number): number => nearestRoad(x, z).distance;

  beforeAll(async () => {
    rig = await OnFootRig.boot("#scene=openworld&seed=beef");
    rig.run(0.5);
  });
  beforeEach(() => {
    rig.normalTime();
    rig.engine["onFoot"].reset();
    rig.engine["ragdolls"].reset();
    car().spawnFacing(lawnMiddle.x, lawnMiddle.z, 0, 0);
    car().group.visible = true;
    // The rest of the field is put out of the way: a spot the traffic stands on would move the car along the road.
    for (let i = 1; i < rig.cars().length; i++) rig.cars()[i]!.group.visible = false;
    rig.sit(0);
    rig.run(0.3);
  });
  afterAll(() => rig.dispose());

  /** Out of the car, which is then wrecked as a crash leaves it. */
  function outAndWrecked(): THREE.Vector3 {
    rig.getOut();
    car().crashed = true;
    car().driverOut = "windshield";
    return rig.torso();
  }

  function expectFreshOnTheRoad(stood: THREE.Vector3, distanceToRoad: number): void {
    const own = car();
    const seat = rig.engine["seat"];
    expect(rig.phase(), "he is at the wheel").toBe("inCar");
    expect(rig.engine["ragdolls"].walker.active, "the walker is gone").toBe(false);
    expect(seat.mode === "drive" && seat.carIndex === 0, "the seat drives his car").toBe(true);
    expect(own.crashed || own.driverOut !== null, "the car is repaired, its driver in").toBe(false);
    expect(own.group.visible, "drawn").toBe(true);
    expect(own.velocity.length(), "at rest").toBeLessThan(0.5);
    const road = nearestRoad(own.group.position.x, own.group.position.z);
    expect(road.distance, `on the road: ${road.distance.toFixed(2)} m off its centre line`).toBeLessThan(1);
    const heading = own.group.getWorldDirection(new THREE.Vector3());
    const across = Math.abs(heading.x * road.tz - heading.z * road.tx) / Math.hypot(heading.x, heading.z);
    expect(across, `facing along the road: ${across.toFixed(2)} of a turn off it`).toBeLessThan(ALONG_MAX);
    const gone = Math.hypot(own.group.position.x - stood.x, own.group.position.z - stood.z);
    expect(gone, `near where he stood: ${gone.toFixed(1)} m, the road was ${distanceToRoad.toFixed(1)} m off`).toBeLessThan(distanceToRoad + SEARCH_REACH_M);
    const colliders = rig.engine["race"]["colliders"];
    const at = own.group.position;
    const clear = colliders.every((c) => !inside(occluder(c.x, c.z, c.yaw, c.hx, c.hz, c.kind === "circle", c.base, c.top), at.x, at.y + 0.5, at.z, CAR_CLEAR_M));
    expect(clear, "clear of every solid").toBe(true);
  }

  // mutation: sed -i 's/if (this.onFoot.resetsToCar) this.onFoot.resetIntoCar();/if (false) this.onFoot.resetIntoCar();/' src/game/engine/engine-scenes.ts
  it("when R is tapped on foot in the park, then he is at the wheel of a repaired car on the nearest road, facing along it, and the walker is gone", () => {
    const stood = outAndWrecked();
    const before = roadDistance(stood.x, stood.z);
    expect(before, "control: the road is not at his feet").toBeGreaterThan(8);
    rig.press("KeyR");
    rig.run(TAP_S);
    expectFreshOnTheRoad(stood, before);
  });

  // mutation: sed -i 's/const placed = out \&\& this.host.runsCars() \&\& this.host.freshCarNear(car, _torso.x, _torso.z, ragdolls.walker.facing);/const placed = false;/' src/game/engine/engine-onfoot.ts
  it("when R is held on foot, then he is put in the same repaired car on the same road", () => {
    const stood = outAndWrecked();
    const before = roadDistance(stood.x, stood.z);
    rig.hold("KeyR", RESET_HOLD + 0.3);
    rig.run(TAP_S);
    expectFreshOnTheRoad(stood, before);
  });

  // mutation: sed -i 's/if (e.car !== this.onFoot.away \&\& !this.onFoot.takeEjected(e)) this.ragdolls.launch(e, cars, true, release);/if (e.car !== this.onFoot.away) this.ragdolls.launch(e, cars, true, release);/' src/game/engine/engine.ts
  it("when the driver is thrown out of his car in the open world, then the walker is his and the camera is on him, and the empty car is a door he can climb back through", () => {
    rig.engine["seat"].mode = "drive";
    rig.engine["ejection"].throwDriverNow(rig.cars(), 0);
    rig.run(0.5);
    const seat = rig.engine["seat"];
    expect(rig.phase(), "on foot").toBe("onFoot");
    expect(rig.away(), "the car he left").toBe(0);
    expect(rig.engine["ragdolls"].walker.active, "he is the walker").toBe(true);
    expect(rig.walker().state, "limp from the throw").not.toBe("stand");
    expect(seat.mode, "the seat is not on the car").toBe("follow");
    expect(car().driverOut, "the car is driverless").not.toBeNull();
    const eye = rig.engine["camera"].position;
    const him = rig.torso();
    expect(Math.hypot(eye.x - him.x, eye.z - him.z), "the camera is on him").toBeLessThan(6);
    const where = car().group.position.clone();
    rig.getUp();
    expect(car().group.position.distanceTo(where), "the car stayed where it ended up").toBeLessThan(1);
    rig.engine["keys"].clear();
    rig.walkToDoor(car());
    rig.press("Enter");
    rig.run(CLIMB_IN_S);
    expect(rig.phase(), "he is back at the wheel").toBe("inCar");
    expect(seat.mode === "drive" && seat.carIndex === 0, "the seat drives his car").toBe(true);
    expect(car().driverOut, "his driver is in again").toBeNull();
  });
});
