import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { houseKnocked, labDollRig, labRig, runLab, throwAt, type LabRig } from "./engine-lab.test-util.ts";
import type { LabShot } from "./engine-lab.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { FLICK, LabFlick } from "./lab-flick.ts";
import { LAB_SHOT, planLabShot } from "./lab-shot.ts";
import { heldPose } from "../scenes/lab.ts";
import { setGround } from "../world/ground.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/**
 * The Lab's flick (`LabFlick`), headless: a landscape 844 × 390 screen looking at the house of cards from a bearing off the
 * bench's long axis (side-on, oblique, or straight down it); a press and a swipe are client px with their times (ms), as the
 * canvas's pointer events give them. The swipe is read on the throw plane: the upright plane through the item holding the bench axis.
 * The last suite looks through the camera the Lab opens with on a 414 × 757 phone held upright (`LAB_SHOT.upright`: the same side
 * shot, fitted to the narrow width): a press off the cars and props is the camera's, and the picks take little of the screen.
 */

afterEach(() => setGround(null));

const SCREEN = { left: 0, top: 0, width: 844, height: 390 };
const PHONE_UPRIGHT = { left: 0, top: 0, width: 414, height: 757 };
const LOOK = new THREE.Vector3(-2, 2, 0);
const CAMERA_RADIUS = 28;
const CAMERA_PITCH = 0.12;
const SIDE_ON = 90;
const OBLIQUE = 35;
const DOWN_THE_BENCH = 0;
type Flick = { thing: number; velocity: THREE.Vector3 };
type Px = [number, number];
/** A car launched along the bench veers at most this fraction of its flight sideways: a stray sideways kick of that fraction of its speed would carry it as far. */
const LINE_DRIFT = 0.01;

function centreOfMass(car: DeformableCar, out: THREE.Vector3): THREE.Vector3 {
  return out.set(0, car.frame.comY, 0).applyQuaternion(car.group.quaternion).add(car.group.position);
}

/** A 60° camera `degrees` off the bench's long axis (90: side-on, 0: straight down it from behind the thrower), at `CAMERA_RADIUS` from `LOOK`. */
function cameraAt(degrees: number): THREE.PerspectiveCamera {
  const yaw = -Math.PI / 2 + (degrees * Math.PI) / 180;
  const cam = new THREE.PerspectiveCamera(60, SCREEN.width / SCREEN.height, 0.1, 400);
  cam.position.set(
    LOOK.x + CAMERA_RADIUS * Math.sin(yaw) * Math.cos(CAMERA_PITCH),
    LOOK.y + CAMERA_RADIUS * Math.sin(CAMERA_PITCH),
    LOOK.z + CAMERA_RADIUS * Math.cos(yaw) * Math.cos(CAMERA_PITCH),
  );
  cam.lookAt(LOOK);
  cam.updateMatrixWorld(true);
  return cam;
}

type View = { r: LabRig; flick: LabFlick; flicks: Flick[]; px: (v: THREE.Vector3) => Px; thrower: Px; along: Px; up: Px };

/** A rig of `preset`, settled, seen through the camera `aim` makes for it on `screen`, and a flick on that screen; `along` and `up`: the thrower's metre along the bench and its metre up, in px on that screen. */
function viewThrough(preset: "cards" | "pad" | "wall", aim: (r: LabRig) => THREE.PerspectiveCamera, screen: typeof SCREEN, rig: LabRig = labRig(preset)): View {
  const r = rig;
  runLab(r, 2);
  const cam = aim(r);
  const flicks: Flick[] = [];
  const flick = new LabFlick(cam, () => screen, r.lab, (thing, velocity) => flicks.push({ thing, velocity: velocity.clone() }));
  const px = (v: THREE.Vector3): Px => {
    const p = v.clone().project(cam);
    return [((p.x + 1) / 2) * screen.width, ((1 - p.y) / 2) * screen.height];
  };
  const centre = r.lab.centre(0, new THREE.Vector3());
  const thrower = px(centre);
  const along = px(centre.clone().add(new THREE.Vector3(1, 0, 0)));
  const up = px(centre.clone().add(new THREE.Vector3(0, 1, 0)));
  return { r, flick, flicks, px, thrower, along: [along[0] - thrower[0], along[1] - thrower[1]], up: [up[0] - thrower[0], up[1] - thrower[1]] };
}

/** The landscape screen, `preset` seen from `degrees` off the bench axis. */
function view(preset: "cards" | "pad", degrees: number): View {
  return viewThrough(preset, () => cameraAt(degrees), SCREEN);
}

/** The camera the Lab opens with on an upright screen (`LAB_SHOT.upright`, fitted to its width), placed on its orbit about the look point as the orbit rig places it. */
function openingCameraUpright(r: LabRig): THREE.PerspectiveCamera {
  const shot = LAB_SHOT.upright;
  const first = heldPose(r.lab.layout[0]!);
  const look = new THREE.Vector3();
  const aspect = PHONE_UPRIGHT.width / PHONE_UPRIGHT.height;
  const { bearing, radius } = planLabShot(new THREE.Vector3(first.x, first.y, first.z), r.lab.focus, r.lab.layout.map(heldPose), shot, aspect, false, look);
  const cam = new THREE.PerspectiveCamera(shot.fov, aspect, 0.1, 400);
  cam.position.set(
    look.x + Math.sin(bearing) * radius * Math.cos(shot.pitch),
    look.y + radius * Math.sin(shot.pitch),
    look.z + Math.cos(bearing) * radius * Math.cos(shot.pitch),
  );
  cam.lookAt(look);
  cam.updateMatrixWorld(true);
  return cam;
}

/** A swipe from (x0, y0) to (x1, y1) over `ms` in 8 ms steps (a 120 Hz screen), released there; false when the press was not taken. */
function swipe(flick: LabFlick, [x0, y0]: Px, [x1, y1]: Px, ms: number): boolean {
  if (!flick.down(x0, y0, 0)) return false;
  for (let t = 8; t < ms; t += 8) flick.move({ clientX: x0 + ((x1 - x0) * t) / ms, clientY: y0 + ((y1 - y0) * t) / ms, timeStamp: t });
  flick.up(x1, y1, ms, false);
  return true;
}

/** Where a swipe that moves the finger `alongM` m along the bench and `upM` m up on the throw plane, from the thrower, ends on this screen. */
function planeEnd(v: View, alongM: number, upM: number): Px {
  return [v.thrower[0] + alongM * v.along[0] + upM * v.up[0], v.thrower[1] + alongM * v.along[1] + upM * v.up[1]];
}

/** A swipe from the thrower at `speed` m/s along `degrees` over the bench axis on its throw plane, for `ms`. */
function planeSwipe(v: View, speed: number, degrees: number, ms: number): void {
  const metres = (speed * ms) / 1000;
  const a = (degrees * Math.PI) / 180;
  const end = planeEnd(v, metres * Math.cos(a), metres * Math.sin(a));
  expect(Math.hypot(end[0] - v.thrower[0], end[1] - v.thrower[1]), "the test's swipe is no longer than a tap").toBeGreaterThan(FLICK.tapPx);
  expect(swipe(v.flick, v.thrower, end, ms), "the press on the thrower was left to the camera").toBeTruthy();
}

/** The x (m) where a launched car comes back down to the height it left from (NaN: it never did). */
function landingX(shot: LabShot): number {
  let apex = 0;
  for (let k = 1; k < shot.pathN; k++) if (shot.path[k * 3 + 1]! > shot.path[apex * 3 + 1]!) apex = k;
  for (let k = apex + 1; k < shot.pathN; k++) if (shot.path[k * 3 + 1]! <= shot.path[1]! + 0.02) return shot.path[k * 3]!;
  return NaN;
}

describe("given the house of cards on the bench, its thrower swiped on the throw plane", () => {
  const launchCases = [
    { it: "when it is swiped 20° over the bench axis at 20 m/s on the plane, seen side-on, then it leaves 20° over the bench axis at 20 m/s", degrees: SIDE_ON, swipeDegrees: 20, speed: 20 },
    { it: "when it is swiped 70° over the bench axis at 20 m/s on the plane, seen side-on, then it leaves 70° over the bench axis at 20 m/s", degrees: SIDE_ON, swipeDegrees: 70, speed: 20 },
    { it: "when it is swiped 30° under the bench axis at 20 m/s on the plane, seen side-on, then it leaves 30° under the bench axis at 20 m/s", degrees: SIDE_ON, swipeDegrees: -30, speed: 20 },
    { it: "when it is swiped 20° over the bench axis at 20 m/s on the plane, seen obliquely, then it leaves 20° over the bench axis at 20 m/s", degrees: OBLIQUE, swipeDegrees: 20, speed: 20 },
    { it: "when it is swiped 70° over the bench axis at 20 m/s on the plane, seen obliquely, then it leaves 70° over the bench axis at 20 m/s", degrees: OBLIQUE, swipeDegrees: 70, speed: 20 },
    { it: "when it is swiped 30° under the bench axis at 20 m/s on the plane, seen obliquely, then it leaves 30° under the bench axis at 20 m/s", degrees: OBLIQUE, swipeDegrees: -30, speed: 20 },
  ] as const;
  for (const testCase of launchCases) {
    it(testCase.it, () => {
      const v = view("cards", testCase.degrees);
      planeSwipe(v, testCase.speed, testCase.swipeDegrees, 200);
      expect(v.flicks.length, "flicks").toBe(1);
      const a = (testCase.swipeDegrees * Math.PI) / 180;
      const out = v.flicks[0]!.velocity;
      expect(Math.abs(out.x - testCase.speed * Math.cos(a)), `along the bench ${out.x.toFixed(4)} m/s`).toBeLessThan(1e-6);
      expect(Math.abs(out.y - testCase.speed * Math.sin(a)), `up ${out.y.toFixed(4)} m/s`).toBeLessThan(1e-6);
      expect(out.z, "across the bench").toBe(0);
    });
  }

  it("when it is swiped sideways and toward the camera, seen obliquely, then it leaves with no velocity across the bench and stays on its line", () => {
    const v = view("cards", OBLIQUE);
    const centre = v.r.lab.centre(0, new THREE.Vector3());
    const towardCamera = v.px(centre.clone().add(new THREE.Vector3(0, 0, 3)));
    expect(Math.hypot(towardCamera[0] - v.thrower[0], towardCamera[1] - v.thrower[1]), "the test's swipe is no longer than a tap").toBeGreaterThan(FLICK.tapPx);
    expect(swipe(v.flick, v.thrower, towardCamera, 200), "the press on the thrower was left to the camera").toBeTruthy();
    expect(v.flicks.length, "flicks").toBe(1);
    expect(v.flicks[0]!.velocity.z, "across the bench").toBe(0);
    const from = centreOfMass(v.r.cars[0]!, new THREE.Vector3());
    v.r.lab.launch(0, v.flicks[0]!.velocity);
    runLab(v.r, 1);
    const to = centreOfMass(v.r.cars[0]!, new THREE.Vector3());
    const flown = to.distanceTo(from);
    expect(flown, "it never left").toBeGreaterThan(0.5);
    expect(Math.abs(to.z - from.z), `its centre of mass moved ${(to.z - from.z).toFixed(4)} m across the bench in ${flown.toFixed(2)} m of flight`).toBeLessThan(LINE_DRIFT * flown);
  });

  const reachCases = [
    { it: "when it is swiped, seen side-on, at the angle and speed a lob to the top card needs, then it knocks all three cars of the house down: off their places, or pinned under it with the roof crushed", degrees: SIDE_ON },
    { it: "when it is swiped, seen obliquely, at the angle and speed a lob to the top card needs, then it knocks all three cars of the house down: off their places, or pinned under it with the roof crushed", degrees: OBLIQUE },
  ] as const;
  for (const testCase of reachCases) {
    it(testCase.it, () => {
      const scratch = labRig("cards");
      runLab(scratch, 2);
      const lob = throwAt(scratch, 0, 3, 30).launch;
      const v = view("cards", testCase.degrees);
      planeSwipe(v, Math.hypot(lob.x, lob.y), (Math.atan2(lob.y, lob.x) * 180) / Math.PI, 200);
      expect(v.flicks.length, "flicks").toBe(1);
      const shot = v.r.lab.launch(v.flicks[0]!.thing, v.flicks[0]!.velocity);
      runLab(v.r, 4);
      expect(shot.contactS, "the flicked car never met the stack").not.toBe(null);
      expect(firstMismatch(houseKnocked(v.r, shot), [1, 2, 3])).toBeUndefined();
    });
  }

  const slowerCases = [
    { it: "when the same swipe 40° over the bench axis runs at 8 m/s instead of 16 m/s, seen side-on, then the car comes down nearer", degrees: SIDE_ON },
    { it: "when the same swipe 40° over the bench axis runs at 8 m/s instead of 16 m/s, seen obliquely, then the car comes down nearer", degrees: OBLIQUE },
  ] as const;
  for (const testCase of slowerCases) {
    it(testCase.it, () => {
      const landings: number[] = [];
      for (const speed of [8, 16]) {
        const v = view("pad", testCase.degrees);
        planeSwipe(v, speed, 40, 200);
        expect(v.flicks.length, `flicks at ${speed} m/s`).toBe(1);
        const shot = v.r.lab.launch(v.flicks[0]!.thing, v.flicks[0]!.velocity);
        runLab(v.r, 4);
        landings.push(landingX(shot));
      }
      expect(landings[0]!, `slow landed at x = ${landings[0]!.toFixed(2)} m, fast at x = ${landings[1]!.toFixed(2)} m`).toBeLessThan(landings[1]!);
    });
  }

  it("when a swipe is shorter than a tap, then nothing leaves, and when a few px longer on the same screen, then it does", () => {
    const v = view("cards", SIDE_ON);
    const [x, y] = v.thrower;
    swipe(v.flick, v.thrower, [x + FLICK.tapPx - 2, y], 80);
    expect(v.flicks.length, "flicks from the short swipe").toBe(0);
    swipe(v.flick, v.thrower, [x + FLICK.tapPx + 2, y], 80);
    expect(v.flicks.length, "flicks from the longer swipe").toBe(1);
  });

  it("when the camera looks straight down the bench, then a swipe past a tap throws nothing, and from the side it does", () => {
    const along = view("cards", DOWN_THE_BENCH);
    expect(swipe(along.flick, along.thrower, [along.thrower[0] + 30, along.thrower[1] - 60], 120), "the press on the thrower was left to the camera").toBeTruthy();
    expect(along.flicks.length, "flicks looking down the bench").toBe(0);
    const side = view("cards", SIDE_ON);
    expect(swipe(side.flick, side.thrower, [side.thrower[0] + 30, side.thrower[1] - 60], 120), "the press on the thrower was left to the camera").toBeTruthy();
    expect(side.flicks.length, "flicks seen side-on").toBe(1);
  });

  it("when a swipe's moves of its last 112 ms reach the page together in one late event, then it leaves as fast as when they came one by one", () => {
    const v = view("cards", OBLIQUE);
    const [x0, y0] = v.thrower;
    const [x1, y1] = planeEnd(v, 4, 1);
    const ms = 240;
    const at = (t: number) => ({ clientX: x0 + ((x1 - x0) * t) / ms, clientY: y0 + ((y1 - y0) * t) / ms, timeStamp: t });
    // Moves every 8 ms to 232 ms, and the release 8 ms later where the last move left the finger (as a pointerup reports it).
    const last = at(ms - 8);
    v.flick.down(x0, y0, 0);
    for (let t = 8; t < ms; t += 8) v.flick.move(at(t));
    v.flick.up(last.clientX, last.clientY, ms, false);
    v.flick.down(x0, y0, 0);
    for (let t = 8; t < ms - 112; t += 8) v.flick.move(at(t));
    // The browser held the rest back (a long frame): one pointermove at the last of them carries them all.
    const held = Array.from({ length: 14 }, (_, i) => at(ms - 112 + 8 * i));
    v.flick.move({ ...last, getCoalescedEvents: () => held });
    v.flick.up(last.clientX, last.clientY, ms, false);
    expect(v.flicks.length).toBe(2);
    const [oneByOne, together] = [v.flicks[0]!.velocity, v.flicks[1]!.velocity];
    expect(together.x, `along the bench: one by one ${oneByOne.x.toFixed(2)} m/s, held back ${together.x.toFixed(2)} m/s`).toBe(oneByOne.x);
    expect(together.y, `up: one by one ${oneByOne.y.toFixed(2)} m/s, held back ${together.y.toFixed(2)} m/s`).toBe(oneByOne.y);
  });

  it("when a swipe is faster than the cap, then it leaves at the cap in the swipe's direction", () => {
    const v = view("cards", SIDE_ON);
    planeSwipe(v, 3 * FLICK.max, 25, 120);
    const out = v.flicks[0]!.velocity;
    expect(Math.abs(Math.hypot(out.x, out.y) - FLICK.max), `speed ${Math.hypot(out.x, out.y).toFixed(3)} m/s`).toBeLessThan(1e-6);
    expect(Math.abs(Math.atan2(out.y, out.x) - (25 * Math.PI) / 180), `angle ${((Math.atan2(out.y, out.x) * 180) / Math.PI).toFixed(3)}°`).toBeLessThan(1e-6);
  });

  it("when a finger presses the empty sky above the board and swipes, then the press is left to the camera", () => {
    const v = view("cards", SIDE_ON);
    expect(swipe(v.flick, [SCREEN.width / 2, 5], [SCREEN.width / 2, 300], 120)).toBe(false);
    expect(v.flicks.length).toBe(0);
  });

  it("when the system takes the pointer mid-swipe, then nothing is flicked", () => {
    const v = view("cards", SIDE_ON);
    const [x1, y1] = planeEnd(v, 4, 1);
    v.flick.down(v.thrower[0], v.thrower[1], 0);
    v.flick.move({ clientX: (v.thrower[0] + x1) / 2, clientY: (v.thrower[1] + y1) / 2, timeStamp: 60 });
    v.flick.up(x1, y1, 120, true);
    expect(v.flicks.length).toBe(0);
  });
});

describe("given the Lab opened on a 414 × 757 phone held upright, its side shot", () => {
  const screenSwipeMs = 120;
  const screenSwipeSpeedPx = 600;
  const minDegreesOffUp = 70;
  /** The most of the screen (its share of its area) the picks of every item may take: the rest is the camera's to orbit with one finger. */
  const maxPickedShare = 0.2;
  const gridColumns = 41;
  const gridRows = 75;

  /** The unit screen direction from the thrower to the roof car of the stack. */
  function towardStack(v: View): Px {
    const roof = v.px(v.r.lab.centre(3, new THREE.Vector3()));
    const length = Math.hypot(roof[0] - v.thrower[0], roof[1] - v.thrower[1]);
    return [(roof[0] - v.thrower[0]) / length, (roof[1] - v.thrower[1]) / length];
  }

  /** The share of the screen's grid of presses `view`'s flick takes (every press is let go again, cancelled). */
  function pickedShare(v: View): number {
    let taken = 0;
    for (let row = 0; row < gridRows; row++) {
      for (let column = 0; column < gridColumns; column++) {
        const x = ((column + 0.5) / gridColumns) * PHONE_UPRIGHT.width;
        const y = ((row + 0.5) / gridRows) * PHONE_UPRIGHT.height;
        if (v.flick.down(x, y, 0)) {
          taken++;
          v.flick.up(x, y, 0, true);
        }
      }
    }
    return taken / (gridRows * gridColumns);
  }

  it("when the stack is looked for on the screen, then it lies at least 70° off straight up from the thrower, so a throw toward it is a sideways swipe", () => {
    const v = viewThrough("cards", openingCameraUpright, PHONE_UPRIGHT);
    const direction = towardStack(v);
    const degreesOffUp = (Math.atan2(Math.abs(direction[0]), -direction[1]) * 180) / Math.PI;
    expect(degreesOffUp, `the stack reads ${degreesOffUp.toFixed(1)}° off straight up`).toBeGreaterThanOrEqual(minDegreesOffUp);
  });

  it("when the thrower is swiped straight toward the stack on the screen, then it leaves along the bench toward the stack at the swipe's own velocity on the throw plane, lifted by the swipe's upward part and never across the bench", () => {
    const v = viewThrough("cards", openingCameraUpright, PHONE_UPRIGHT);
    const direction = towardStack(v);
    const distancePx = (screenSwipeSpeedPx * screenSwipeMs) / 1000;
    const end: Px = [v.thrower[0] + direction[0] * distancePx, v.thrower[1] + direction[1] * distancePx];
    expect(swipe(v.flick, v.thrower, end, screenSwipeMs), "the press on the thrower was left to the camera").toBeTruthy();
    expect(v.flicks.length, "flicks").toBe(1);
    expect(v.flicks[0]!.thing, "the flicked item is the thrower").toBe(0);
    const out = v.flicks[0]!.velocity;
    expect(out.x, `along the bench toward the stack ${out.x.toFixed(3)} m/s`).toBeGreaterThan(0);
    expect(out.y > 0 && out.y < out.x, `lifted by the upward part of the swipe, still a throw and not a lob: up ${out.y.toFixed(3)} m/s over along ${out.x.toFixed(3)} m/s`).toBeTruthy();
    expect(out.z, "across the bench").toBe(0);
    const screenX = out.x * v.along[0] + out.y * v.up[0];
    const screenY = out.x * v.along[1] + out.y * v.up[1];
    expect(Math.abs(screenX - direction[0] * screenSwipeSpeedPx), `the launch on the screen x ${screenX.toFixed(3)} px/s, the swipe's ${(direction[0] * screenSwipeSpeedPx).toFixed(3)} px/s`).toBeLessThan(1e-6);
    expect(Math.abs(screenY - direction[1] * screenSwipeSpeedPx), `the launch on the screen y ${screenY.toFixed(3)} px/s, the swipe's ${(direction[1] * screenSwipeSpeedPx).toFixed(3)} px/s`).toBeLessThan(1e-6);
  });

  it("when a finger presses the screen away from every car and swipes, then the press is left to the camera, so one finger turns the view", () => {
    const v = viewThrough("cards", openingCameraUpright, PHONE_UPRIGHT);
    for (const y of [0.15, 0.3, 0.85]) {
      expect(swipe(v.flick, [PHONE_UPRIGHT.width / 2, y * PHONE_UPRIGHT.height], [PHONE_UPRIGHT.width / 4, y * PHONE_UPRIGHT.height], 120), `a press ${y * 100} % down the screen`).toBe(false);
    }
    expect(v.flicks.length).toBe(0);
  });

  it("when the grid of presses over the cards' screen is tried, then the picks of the cars take at most a fifth of it", () => {
    const share = pickedShare(viewThrough("cards", openingCameraUpright, PHONE_UPRIGHT));
    expect(share > 0 && share <= maxPickedShare, `${(share * 100).toFixed(1)} % of the screen is picked`).toBeTruthy();
  });

  it("when the grid of presses over the wall's screen is tried, then the picks of the cars and the knockable props take at most a fifth of it", async () => {
    const share = pickedShare(viewThrough("wall", openingCameraUpright, PHONE_UPRIGHT, await labDollRig("wall")));
    expect(share > 0 && share <= maxPickedShare, `${(share * 100).toFixed(1)} % of the screen is picked`).toBeTruthy();
  });
});
