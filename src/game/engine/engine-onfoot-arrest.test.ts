import { hypot2 } from "../kernel/physics-core.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { stationOf } from "../ai/openworld-crime/arrests.ts";
import type { FootArrestPorts } from "../ai/openworld-crime/offence-source.ts";
import { must } from "../kernel/must.test-util.ts";
import { planBlocks } from "../world/openworld/openworld-blocks.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { OnFootRig } from "./engine-onfoot.test-util.ts";

/** A tap of R acts on the release, a frame on (s). */
const TAP_S = 0.3;
/** How far the law leads him (m), and the longest his walker takes to get there (s). */
const LED_M = 5;
const LED_WITHIN_S = 8;
/** He stands within this far (m) of where the law set him down, and has not moved more than this far (m) in a second of holding the keys he may not use. */
const SET_DOWN_M = 0.5;
const STAYS_M = 0.5;
/** The patrol car stands this far from his own car on the lawn (m). */
const PATROL_CAR_OFFSET_M = 60;
/** The car he left is on the road within this far of the station's door (m): `roadSpotNear`'s reach and a road's width. */
const KERB_WITHIN_M = 60;

/** The first lawn of the open world: the park's open ground, where nothing stands between him and a car. */
const lawn = planBlocks(layOutLots().geometry).playable.find((block) => block.park)!.lawn!;
const lawnMiddle = new THREE.Vector3((lawn.x0 + lawn.x1) / 2, 0, (lawn.z0 + lawn.z1) / 2);

describe("given the real engine on the open world, the player on foot on the park's lawn and a patrol car 60 m off", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const car = () => rig.cars()[0]!;
  const patrol = () => rig.cars()[1]!;
  /** What the engine's law ports are handed: the arrest's four calls, as the law makes them. */
  const law = (): FootArrestPorts => {
    const { law: ports } = rig.engine["openWorld"]["ports"];
    must(ports, "the engine gives law ports");
    return ports.footArrest;
  };

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
    rig.place(1, lawnMiddle.x + PATROL_CAR_OFFSET_M, lawnMiddle.z);
    rig.sit(0);
    rig.run(0.3);
  });
  afterAll(() => rig.dispose());

  /** Out of the car and busted: the law has him. */
  function busted(): THREE.Vector3 {
    rig.getOut();
    law().busted(0);
    return rig.torso();
  }

  // mutation: sed -i 's/    this.flow.arrest();//' src/game/engine/engine-onfoot.ts
  // mutation: sed -i 's/    this.seat.detached = this.view.flying || this.onFoot.active;/    this.seat.detached = this.view.flying;/' src/game/engine/engine-input.ts
  it("when the law has him, then no control of his acts: R does not put him in a car, and the walking keys do not move him", () => {
    const stood = busted();
    const where = car().group.position.clone();
    rig.press("KeyR");
    rig.run(TAP_S);
    rig.hold("KeyW", 1);
    expect(rig.phase(), "he is in custody").toBe("arrested");
    expect(rig.engine["ragdolls"].walker.active, "his walker is still out on the street").toBe(true);
    expect(rig.torso().distanceTo(stood), "the keys did not walk him").toBeLessThan(STAYS_M);
    expect(car().group.position.distanceTo(where), "R did not bring his car back").toBeLessThan(STAYS_M);
  });

  // mutation: sed -i '/Under arrest/d' src/game/engine/engine-onfoot.ts
  it("when the law has him, then the line under the view says he is under arrest, not that he may get in", () => {
    busted();
    rig.run(0.3);
    expect(rig.engine["onFoot"].prompt(), "the prompt").toBe("Under arrest");
  });

  // mutation: sed -i 's/    this.ledX = x;//' src/game/engine/engine-onfoot.ts
  it("when his cop leads him five metres from his car, then his walker walks there on its own", () => {
    busted();
    const target = rig.beside(car(), LED_M, 0);
    law().led(target.x, target.z);
    for (let t = 0; t < LED_WITHIN_S && hypot2(rig.torso().x - target.x, rig.torso().z - target.z) > SET_DOWN_M * 2; t += 0.5) rig.run(0.5);
    expect(hypot2(rig.torso().x - target.x, rig.torso().z - target.z), "he is where he was led").toBeLessThanOrEqual(SET_DOWN_M * 2);
    expect(rig.phase(), "still in custody").toBe("arrested");
  });

  // mutation: sed -i 's/    this.host.seat.focus(carIndex);//' src/game/engine/engine-onfoot.ts
  it("when a patrol car takes him, then his walker is gone and the camera is on that car", () => {
    busted();
    law().taken(1);
    rig.run(3);
    const seat = rig.engine["seat"];
    const eye = rig.engine["camera"].position;
    expect(rig.engine["ragdolls"].walker.active, "off the street").toBe(false);
    expect(rig.phase(), "still in custody").toBe("arrested");
    expect(seat.mode === "follow" && seat.carIndex === 1, "the seat follows the patrol car").toBe(true);
    expect(eye.distanceTo(patrol().group.position), "the camera is by the patrol car").toBeLessThan(eye.distanceTo(car().group.position));
  });

  // mutation (the reset has two guards, both go): sed -i 's/this.race.active && (!this.onFoot.active || this.onFoot.resetsToCar)/this.race.active/' src/game/engine/engine-input.ts && sed -i 's/\["Space", SEAT_KEYS.reset, /["Space", /' src/game/engine/engine-onfoot.ts
  it("when a patrol car has him and he presses R, then his car stays where it was left", () => {
    busted();
    const where = car().group.position.clone();
    law().taken(1);
    rig.run(0.3);
    rig.press("KeyR");
    rig.run(TAP_S);
    expect(rig.phase(), "still in custody").toBe("arrested");
    expect(car().group.position.distanceTo(where), "his car was not reset to its spawn").toBeLessThan(STAYS_M);
  });

  describe("and the law sets him down at the police station's door", () => {
    const door = () => {
      const map = rig.engine["openWorld"]["map"];
      must(map, "the open world's map");
      const station = stationOf(map);
      must(station, "the map has a police station");
      return station;
    };

    function delivered(): void {
      busted();
      law().taken(1);
      rig.run(0.3);
      law().delivered(door().x, door().z, Math.PI / 2);
      rig.run(0.5);
    }

    // mutation: sed -i 's/    if (ragdolls.startWalker(_spot, yaw, { cop: false, look: this.host.look() }) >= 0) {/    if (false) {/' src/game/engine/engine-onfoot.ts
    it("when he is set down, then his walker stands at the door on foot and the seat is back on his own car", () => {
      delivered();
      const seat = rig.engine["seat"];
      const at = rig.torso();
      expect(rig.phase(), "on foot").toBe("onFoot");
      expect(rig.engine["ragdolls"].walker.active, "his walker is out").toBe(true);
      expect(hypot2(at.x - door().x, at.z - door().z), "at the station's door").toBeLessThan(SET_DOWN_M * 2);
      expect(seat.carIndex, "the car he may get back into is his own").toBe(0);
      expect(rig.away(), "his own car").toBe(0);
    });

    // mutation: sed -i 's/    if (!this.host.freshCarNear(car, x, z, yaw)) this.host.respawn();//' src/game/engine/engine-onfoot.ts
    it("when he is set down, then his own car is repaired and on the road by the station", () => {
      car().crashed = true;
      delivered();
      const own = car().group.position;
      expect(car().crashed, "repaired").toBe(false);
      expect(hypot2(own.x - door().x, own.z - door().z), "by the station").toBeLessThan(KERB_WITHIN_M);
      expect(own.distanceTo(lawnMiddle), "not where it was left").toBeGreaterThan(SET_DOWN_M);
    });

    // mutation: sed -i 's/      this.flow.released();//' src/game/engine/engine-onfoot.ts
    it("when he is set down, then the controls are his again: he walks, and he gets back into his car", () => {
      delivered();
      const set = rig.torso();
      rig.hold("KeyW", 1);
      expect(rig.torso().distanceTo(set), "the walking keys walk him").toBeGreaterThan(STAYS_M);
      rig.engine["keys"].clear();
      rig.getIn();
      expect(rig.phase(), "back at the wheel").toBe("inCar");
    });
  });
});
