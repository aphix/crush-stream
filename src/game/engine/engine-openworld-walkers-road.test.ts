import { describe, expect, it } from "vitest";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { FRAME_SECONDS } from "../ai/civilians/civilian-crowd.test-util.ts";
import type { OpenWorldTraffic } from "../ai/openworld-traffic/openworld-traffic.ts";
import { PERSON_GAP } from "../ai/openworld-traffic/traffic-constants.ts";
import { FakeField, STEP_SECONDS, HOLD } from "../ai/openworld-traffic/traffic-world.test-util.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { BODY_POSTURE, makeFootRecord } from "../net/body-codec.ts";
import { OpenWorldDirector, type OpenWorldPorts } from "./engine-openworld.ts";
import { idleOpenWorldPorts } from "./openworld-cull-ports.test-util.ts";

const map = buildFixtureMap();
const HOME = { x: -100, z: -45 };
const WORK = { x: 120, z: 60 };
/** The car is under way after this long (s), and a walker is put this far (m) ahead of it on its lane: before the signal that holds it at about 50 m on. */
const UNDER_WAY_S = 6;
const AHEAD_M = 20;
/** How long (s) the car has to stop short of the walker, or to go by his spot when nobody is there. */
const WAIT_S = 6;
const GUEST_CAR = 1;
/** A man steps out this far (m) ahead of the car's middle: inside its braking distance at cruise. The car's nose (a sedan's half length and a body's radius) touches him at this distance from its middle. */
const STEPS_OUT_M = 3;
const NOSE_REACH_M = 2.5;

/** A solo host's director whose traffic stands on a fake field, with a car of the traffic cruising down its lane, and the host's own walker where `walker` says (null: in a car). */
function laneWorld() {
  const field = new FakeField();
  const walker: { at: { x: number; z: number } | null } = { at: null };
  const ports: OpenWorldPorts = {
    ...idleOpenWorldPorts(),
    traffic: { ...field.ports, setFreeDrivers: () => {}, makeLights: () => ({ update: () => {}, dispose: () => {} }) },
    foot: (out) => {
      if (walker.at === null) return false;
      out.x = walker.at.x;
      out.z = walker.at.z;
      out.velocityX = 0;
      out.velocityZ = 0;
      return true;
    },
  };
  const director = new OpenWorldDirector(ports);
  director.startOpenWorld(map);
  director.frame(FRAME_SECONDS);
  const traffic = director["traffic"] as OpenWorldTraffic;
  const car = traffic.spawnDrivenCar(3, traffic.nearestSpot(HOME.x, HOME.z), traffic.nearestSpot(WORK.x, WORK.z))!;
  const body = field.cars[car.index]!;
  /** One sim step as the engine runs it: the cars move on the traffic's inputs, the director steps its crowd and its traffic, and a frame follows. */
  function step(): void {
    traffic.drive(field.cars);
    for (let id = 0; id < field.cars.length; id++) {
      const other = field.cars[id]!;
      if (!other.stored) other.run(field.seats.has(id) ? HOLD : (traffic.inputOf(id, STEP_SECONDS) ?? HOLD), STEP_SECONDS);
    }
    director.step(STEP_SECONDS);
    director.frame(STEP_SECONDS);
  }
  function run(seconds: number): void {
    for (let n = 0; n < seconds / STEP_SECONDS; n++) step();
  }
  /** The spot `AHEAD_M` m in front of the car now, on its lane. */
  function ahead(distance = AHEAD_M): { x: number; z: number; dirX: number; dirZ: number } {
    const dirX = detSin(body.yaw);
    const dirZ = detCos(body.yaw);
    return { x: body.group.position.x + dirX * distance, z: body.group.position.z + dirZ * distance, dirX, dirZ };
  }
  /** How far (m) the car is past `spot` along its lane's direction at the moment `ahead` was read: negative while it is short of it. */
  function past(spot: { x: number; z: number; dirX: number; dirZ: number }): number {
    return (body.group.position.x - spot.x) * spot.dirX + (body.group.position.z - spot.z) * spot.dirZ;
  }
  return { director, body, walker, run, ahead, past };
}

describe("given a car of the traffic under way on its lane and a player on foot ahead of it", () => {
  it("when nobody is on foot, then the car goes by the spot (control)", () => {
    const { body, run, ahead, past } = laneWorld();
    run(UNDER_WAY_S);
    expect(body.speed, "it is under way").toBeGreaterThan(3);
    const spot = ahead();
    run(WAIT_S);
    expect(past(spot), "metres past the spot").toBeGreaterThan(0);
  });

  it("when the host's own walker is in its lane (the foot port reads his torso, standing or lying), then the car stops short of him and waits, and goes by once he has gone", () => {
    const { body, walker, run, ahead, past } = laneWorld();
    run(UNDER_WAY_S);
    const spot = ahead();
    walker.at = spot;
    run(WAIT_S);
    expect(body.speed, "it waits for him").toBeLessThan(0.3);
    expect(past(spot), "metres past him: clear of him").toBeLessThan(-(PERSON_GAP - 1));
    walker.at = null;
    run(WAIT_S);
    expect(past(spot), "metres past his spot once he has gone").toBeGreaterThan(0);
  });

  for (const [name, posture] of [["stands", BODY_POSTURE.stand], ["lies", BODY_POSTURE.down]] as const) {
    it(`when a guest's walker ${name} in its lane on the host, then the car stops short of him and waits`, () => {
      const { director, body, run, ahead, past } = laneWorld();
      run(UNDER_WAY_S);
      const spot = ahead();
      const foot = makeFootRecord();
      foot.seq = 1;
      foot.x = spot.x;
      foot.z = spot.z;
      foot.posture = posture;
      director.hearFoot(GUEST_CAR, foot);
      run(WAIT_S);
      expect(body.speed, "it waits for him").toBeLessThan(0.3);
      expect(past(spot), "metres past him: clear of him").toBeLessThan(-(PERSON_GAP - 1));
    });
  }

  it("when the host's walker steps out 3 m ahead of the car at cruise, then the car cannot stop: its nose reaches him faster than the run-down rows' 5 m/s throw needs", () => {
    const { body, walker, run, ahead } = laneWorld();
    run(UNDER_WAY_S);
    walker.at = ahead(STEPS_OUT_M);
    let speedAtNose = -1;
    for (let n = 0; n < WAIT_S / STEP_SECONDS && speedAtNose < 0; n++) {
      run(STEP_SECONDS);
      if (hypot2(walker.at.x - body.group.position.x, walker.at.z - body.group.position.z) <= NOSE_REACH_M) speedAtNose = body.speed;
    }
    expect(speedAtNose, "the car's nose reached him").toBeGreaterThan(0);
    expect(speedAtNose, "its speed there (m/s): over the run-down rows' throw speed").toBeGreaterThan(5);
  });
});
