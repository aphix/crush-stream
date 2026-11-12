import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";
import { HOLD_MAX_SECONDS } from "../ai/openworld-auto/auto-constants.ts";
import { SUBJECT, type SubjectKind } from "../ai/openworld-auto/auto-director.ts";
import { newAutoPose, OpenWorldScan } from "../ai/openworld-auto/auto-scan.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { ChaseCamera, type CarPicker, RIDE_PAUSE } from "../present/engine-camera.ts";
import type { Sight } from "../present/spectate-cam.ts";
import type { PadState } from "../vehicle/gamepad.ts";
import { DriverSeat } from "../vehicle/car-drive.ts";
import { FLAT_GROUND } from "../world/ground.ts";
import { type AutoOrbit, autoOrbitOf, OpenWorldAuto } from "./engine-openworld-auto.ts";
import { type AutoScene, type SceneParts, sceneOf } from "./openworld-auto-world.test-util.ts";

const SEED = 33;
const DT = 1 / FRAME_HZ;
/** The owner's rule, stated here and not read from the code: a pick or a turn of the view keeps its subject this long (s) after the last one. */
const MANUAL_HOLD_S = 30;
const OPEN: Sight = { ground: FLAT_GROUND, path: null, wallTop: 0, rim: Infinity, occ: [] };
const NO_PICK: CarPicker = { at: () => -1, choose() {} };
const DRAG_PX = 60;
/** The whole of a 60 px drag is 0.3 rad of bearing round the subject; a fraction of it is plainly a turn. */
const TURNED_RAD = 0.15;

/** What each kind of subject needs in the scene for the camera to follow it, two of them so there is somewhere to cut to, the first the more interesting. */
const KINDS: readonly { it: string; kind: SubjectKind; parts: SceneParts }[] = [
  { it: "a person", kind: SUBJECT.civilian, parts: { civilians: [{ x: 0, z: 10 }, { x: 8, z: 10 }] } },
  { it: "a foot cop", kind: SUBJECT.cop, parts: { cops: [{ x: 0, z: 10, speed: 4 }, { x: 8, z: 10, speed: 0 }] } },
  { it: "a resident driving", kind: SUBJECT.driver, parts: { cars: [{ x: 0, z: 10, speed: 18, resident: true }, { x: 8, z: 10, speed: 4, resident: true }] } },
  { it: "a patrol car", kind: SUBJECT.driver, parts: { cars: [{ x: 0, z: 10, speed: 18, police: true }, { x: 8, z: 10, speed: 18, police: true }] } },
  { it: "the ambulance", kind: SUBJECT.driver, parts: { cars: [{ x: 0, z: 10, speed: 0, police: true }, { x: 8, z: 10, speed: 18, police: true }], ambulance: 0 } },
];

/** The Auto camera over `scene`, begun, and stepped until it has a subject. */
function autoOver(scene: AutoScene): OpenWorldAuto {
  const auto = new OpenWorldAuto(scene.world, scene.sizes, SEED);
  auto.begin();
  auto.step(DT);
  return auto;
}

/** An orbit camera that notes what it is asked and whether the player holds the view. */
class RecordedOrbit {
  holding = false;
  readonly looks: THREE.Vector3[] = [];
  orbited = 0;

  held(): boolean {
    return this.holding;
  }

  aim(look: THREE.Vector3): void {
    this.looks.push(look.clone());
  }

  orbit(): void {
    this.orbited++;
  }

  release(): void {}
}

function recorded(): RecordedOrbit {
  return new RecordedOrbit();
}

/** `seconds` of frames: the director steps, the camera is framed; whether the last frame was the Auto camera's (false: the regular camera had the view). */
function run(auto: OpenWorldAuto, camera: THREE.PerspectiveCamera, orbit: AutoOrbit, seconds: number): boolean {
  let framed = false;
  for (let frame = 0; frame < seconds * FRAME_HZ; frame++) {
    auto.step(DT);
    framed = auto.aim(camera, OPEN, DT, orbit);
  }
  return framed;
}

describe.each(KINDS)("given the Auto camera following $it", ({ kind, parts }) => {
  // mutation: sed -i 's/^    orbit.aim(_look);$//' src/game/engine/engine-openworld-auto.ts
  it("when the player does not touch the view, then the orbit is aimed at the subject's chest and the shot is the Auto camera's, not the orbit's", () => {
    const scene = sceneOf(parts);
    const auto = autoOver(scene);
    const camera = new THREE.PerspectiveCamera();
    const orbit = recorded();
    expect(run(auto, camera, orbit, 1), "the Auto camera has the view, not the regular camera's").toBe(true);
    const pose = newAutoPose();
    new OpenWorldScan(scene.world, scene.sizes.residents).poseOf(auto.subject!.kind, auto.subject!.id, pose);
    expect(auto.subject?.kind, "the kind of subject").toBe(kind);
    expect(orbit.looks.length, "frames the orbit was aimed in").toBeGreaterThan(0);
    expect(orbit.looks.at(-1)!.x, "where the orbit is aimed, across").toBeCloseTo(pose.x, 5);
    expect(orbit.looks.at(-1)!.z, "where the orbit is aimed, along").toBeCloseTo(pose.z, 5);
    expect(orbit.looks.at(-1)!.y, "the aim is over the subject's feet").toBeGreaterThan(pose.y + 0.5);
    expect(orbit.orbited, "frames the orbit placed the camera").toBe(0);
    expect(camera.position.distanceTo(new THREE.Vector3(pose.x, pose.y, pose.z)), "the camera stands a shot away from him (m)").toBeGreaterThan(2);
  });

  // mutation: sed -i 's/^      this.director.hold(MANUAL_HOLD_SECONDS);$//' src/game/engine/engine-openworld-auto.ts
  it("when the player holds the view past the longest hold of a subject, then the orbit has the camera, the Auto camera does not touch it, and the same subject is kept", () => {
    const scene = sceneOf(parts);
    const auto = autoOver(scene);
    const camera = new THREE.PerspectiveCamera();
    const orbit = recorded();
    run(auto, camera, orbit, 1);
    const subject = named(auto);
    orbit.holding = true;
    camera.position.set(100, 5, 100);
    expect(run(auto, camera, orbit, HOLD_MAX_SECONDS + 3), "the Auto camera has the view while he holds it").toBe(true);
    expect(named(auto), "still the subject he turned the view round").toBe(subject);
    expect(orbit.orbited, "frames the orbit placed the camera").toBe(Math.round((HOLD_MAX_SECONDS + 3) * FRAME_HZ));
    expect([camera.position.x, camera.position.y, camera.position.z].join(" "), "the Auto camera left the camera where the orbit put it").toBe("100 5 100");
  });

  // mutation: sed -i 's/^      this.cam.adopt(camera, _look);$/      this.cam.cut(0);/' src/game/engine/engine-openworld-auto.ts
  it(`when he lets go, then the shot eases back from where the camera stands, the subject is kept until ${MANUAL_HOLD_S} s after the last turn, and then the cuts go on`, () => {
    const scene = sceneOf(parts);
    const auto = autoOver(scene);
    const camera = new THREE.PerspectiveCamera();
    const orbit = recorded();
    run(auto, camera, orbit, 1);
    const subject = named(auto);
    orbit.holding = true;
    camera.position.set(100, 5, 100);
    run(auto, camera, orbit, 1);
    orbit.holding = false;
    run(auto, camera, orbit, DT);
    expect(camera.position.distanceTo(new THREE.Vector3(100, 5, 100)), "one frame after he lets go the camera has moved less than a metre: the shot eases, it does not cut").toBeLessThan(1);
    run(auto, camera, orbit, MANUAL_HOLD_S - 2);
    expect(named(auto), "the subject shortly before the hold is up").toBe(subject);
    run(auto, camera, orbit, 4);
    expect(named(auto), "the subject after the hold").not.toBe(subject);
  });
});

/** An orbit camera of the engine's own kind (`ChaseCamera`) with its canvas, in the driver's seat as the open world's player is. */
function realView() {
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  Object.assign(canvas, { style: {}, setPointerCapture: () => {}, releasePointerCapture: () => {} });
  const seat = new DriverSeat();
  seat.mode = "drive";
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 400);
  camera.position.set(4, 2, 6);
  const pad = { rx: 0, ry: 0 } as PadState;
  const view = new ChaseCamera(camera, canvas, seat, pad, false, NO_PICK);
  view.attach();
  return { canvas, camera, view, pad };
}

function pointer(canvas: HTMLCanvasElement, type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number): void {
  canvas.dispatchEvent(Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: x, clientY: y }));
}

/** The bearing (rad) of the camera round the subject's aim. */
function bearing(camera: THREE.Camera, look: THREE.Vector3): number {
  return detAtan2(camera.position.x - look.x, camera.position.z - look.z);
}

describe.each(KINDS)("given the engine's own orbit camera under the Auto camera, following $it", ({ parts }) => {
  // mutation: sed -i 's/    held: (wallDt) => view.rideHeld(true, wallDt),/    held: () => false,/' src/game/engine/engine-openworld-auto.ts
  it("when the mouse drags, then the camera turns round the subject and goes on following him as he moves, and when the drag has been over for the ride pause the Auto shot is back", () => {
    const scene = sceneOf(parts);
    const auto = autoOver(scene);
    const { canvas, camera, view } = realView();
    const orbit = autoOrbitOf(view);
    run(auto, camera, orbit, 1);
    const look = view.look.clone();
    const before = bearing(camera, look);
    pointer(canvas, "pointerdown", 100, 100);
    pointer(canvas, "pointermove", 100 - DRAG_PX, 100);
    run(auto, camera, orbit, 1);
    const turned = Math.abs(detAtan2(detSin(bearing(camera, view.look) - before), detCos(bearing(camera, view.look) - before)));
    expect(turned, "bearing turned by a drag (rad)").toBeGreaterThan(TURNED_RAD);
    const held = camera.position.clone();
    scene.shift(10);
    run(auto, camera, orbit, 1);
    expect(camera.position.x - held.x, "the camera moved with the subject (m)").toBeGreaterThan(5);
    pointer(canvas, "pointerup", 100 - DRAG_PX, 100);
    run(auto, camera, orbit, RIDE_PAUSE + 2);
    expect(view.rideHeld(true, DT), "the player no longer holds the view").toBe(false);
  });

  // mutation: sed -i 's/ || this.rideLooked || padTurn;/ || this.rideLooked;/' src/game/present/engine-camera.ts
  it("when the right stick is held, then the view turns round the subject, and once released for the ride pause the Auto shot is back", () => {
    const scene = sceneOf(parts);
    const auto = autoOver(scene);
    const { camera, view, pad } = realView();
    const orbit = autoOrbitOf(view);
    run(auto, camera, orbit, 1);
    const before = bearing(camera, view.look);
    pad.rx = 1;
    run(auto, camera, orbit, 1);
    const turned = Math.abs(detAtan2(detSin(bearing(camera, view.look) - before), detCos(bearing(camera, view.look) - before)));
    expect(turned, "bearing turned by the stick (rad)").toBeGreaterThan(TURNED_RAD);
    expect(view.rideHeld(true, DT), "the stick holds the view").toBe(true);
    pad.rx = 0;
    run(auto, camera, orbit, RIDE_PAUSE + 2);
    expect(view.rideHeld(true, DT), "the player no longer holds the view").toBe(false);
  });

  // mutation: sed -i 's/^    if (this.ride) this.rideLooked = true;$//' src/game/present/engine-camera.ts
  it("when the wheel turns one notch, then the view is held and the distance changes", () => {
    const scene = sceneOf(parts);
    const auto = autoOver(scene);
    const { canvas, camera, view } = realView();
    const orbit = autoOrbitOf(view);
    run(auto, camera, orbit, 1);
    const before = camera.position.distanceTo(view.look);
    canvas.dispatchEvent(Object.assign(new Event("wheel"), { deltaY: -200 }));
    run(auto, camera, orbit, 1);
    expect(view.rideHeld(true, DT), "the wheel holds the view").toBe(true);
    expect(camera.position.distanceTo(view.look), "distance to the subject (m)").not.toBeCloseTo(before, 0);
  });
});

/** A foot cop 5 m off, a resident driving at 10, a person (the one in a fight) at 20, a patrol car at 30 and the ambulance (car 2) at 40, along +x from where the camera is asked from: nearest first is not the order the world lists them in. */
const STREET: SceneParts = {
  civilians: [{ x: 20, z: 0 }],
  cops: [{ x: 5, z: 0, speed: 0 }],
  cars: [
    { x: 10, z: 0, speed: 5, resident: true },
    { x: 30, z: 0, speed: 5, police: true },
    { x: 40, z: 0, speed: 0, police: true },
  ],
  ambulance: 2,
};
/** Who stands where along it: the kind and the id of each, nearest first. */
const WALK: readonly { kind: SubjectKind; id: number }[] = [
  { kind: SUBJECT.cop, id: 0 },
  { kind: SUBJECT.driver, id: 0 },
  { kind: SUBJECT.civilian, id: 0 },
  { kind: SUBJECT.driver, id: 1 },
  { kind: SUBJECT.driver, id: 2 },
];

/** A subject as `OpenWorldAuto.subject` gives it, as text for a row's message. */
function named(auto: OpenWorldAuto): string {
  return auto.subject === null ? "nobody" : `${auto.subject.kind}:${auto.subject.id}`;
}

describe("given the Auto camera asked for the next and the previous subject on a street of every kind", () => {
  function pressed(dir: 1 | -1, auto: OpenWorldAuto): boolean {
    return auto.cycle(dir, 0, 0);
  }

  // mutation: sed -i 's/    while (into > 0 \&\& this.ringDistance\[into - 1\]! > distance) {/    while (false) {/' src/game/engine/engine-openworld-auto.ts
  it("when E is pressed from nowhere, then the camera goes to the nearest and on outward, to a foot cop, a driver, a person, a patrol car and the ambulance, and round to the first again", () => {
    const scene = sceneOf(STREET);
    const auto = new OpenWorldAuto(scene.world, scene.sizes, SEED);
    auto.begin();
    const visited: string[] = [];
    for (let press = 0; press < WALK.length + 1; press++) {
      expect(pressed(1, auto), `press ${press} went somewhere`).toBe(true);
      visited.push(named(auto));
    }
    const expected = [...WALK, WALK[0]!].map((who) => `${who.kind}:${who.id}`);
    expect(visited.join(" "), "who the presses went to").toBe(expected.join(" "));
  });

  // mutation: sed -i 's/if (this.ringAge > RING_STALE_SECONDS ||/if (true ||/' src/game/engine/engine-openworld-auto.ts
  it("when Q undoes E, then the camera comes back through the same subjects to where it began; and Q from nowhere goes to the farthest", () => {
    const scene = sceneOf(STREET);
    const auto = new OpenWorldAuto(scene.world, scene.sizes, SEED);
    auto.begin();
    pressed(1, auto);
    pressed(1, auto);
    pressed(1, auto);
    expect(named(auto), "after three presses on").toBe(`${WALK[2]!.kind}:${WALK[2]!.id}`);
    pressed(-1, auto);
    expect(named(auto), "one press back").toBe(`${WALK[1]!.kind}:${WALK[1]!.id}`);
    pressed(-1, auto);
    expect(named(auto), "two presses back").toBe(`${WALK[0]!.kind}:${WALK[0]!.id}`);
    const fresh = new OpenWorldAuto(scene.world, scene.sizes, SEED);
    fresh.begin();
    pressed(-1, fresh);
    expect(named(fresh), "Q from nowhere").toBe(`${WALK[4]!.kind}:${WALK[4]!.id}`);
  });

  // mutation: sed -i 's/^      if (!this.scan.watchable(kind, id)) continue;$//' src/game/engine/engine-openworld-auto.ts
  it("when a subject on the walk has gone, then the press goes past it", () => {
    const scene = sceneOf(STREET);
    const auto = new OpenWorldAuto(scene.world, scene.sizes, SEED);
    auto.begin();
    pressed(1, auto);
    scene.cars[0]!.group.visible = false;
    pressed(1, auto);
    expect(named(auto), "the press after the resident's car drove out of sight").toBe(`${WALK[2]!.kind}:${WALK[2]!.id}`);
  });

  // mutation: sed -i 's/if (this.manual || this.heldFor < HOLD_MIN_SECONDS/if (this.heldFor < HOLD_MIN_SECONDS/' src/game/ai/openworld-auto/auto-director.ts
  it("when a subject is picked, then Auto does not cut away for the manual hold, and then cuts on", () => {
    const scene = sceneOf(STREET);
    const auto = new OpenWorldAuto(scene.world, scene.sizes, SEED);
    auto.begin();
    const camera = new THREE.PerspectiveCamera();
    const orbit = recorded();
    pressed(1, auto);
    const picked = named(auto);
    run(auto, camera, orbit, MANUAL_HOLD_S - 2);
    expect(named(auto), "the pick after the longest hold of a cut and far into the interruptions' time").toBe(picked);
    run(auto, camera, orbit, 4);
    expect(named(auto), "the subject once the hold is up").not.toBe(picked);
  });

  // mutation: sed -i 's/tried < count; tried++/tried <= count; tried++/' src/game/engine/engine-openworld-auto.ts
  it("when there is nobody on the street, then nothing is gone to", () => {
    const scene = sceneOf({});
    const auto = new OpenWorldAuto(scene.world, scene.sizes, SEED);
    auto.begin();
    expect(pressed(1, auto), "E in an empty world").toBe(false);
    expect(pressed(-1, auto), "Q in an empty world").toBe(false);
    expect(auto.subject, "the subject").toBeNull();
  });
});
