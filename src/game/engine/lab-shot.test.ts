import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { Lab } from "./engine-lab.ts";
import { LAB_SHOT, planLabShot } from "./lab-shot.ts";
import { heldPose, LAB_PRESETS } from "../scenes/lab.ts";

/**
 * The Lab's opening shot (`planLabShot`, `LAB_SHOT`), headless: from the side of the throw on every set, on a wide screen and on
 * phones held upright, and on a narrow screen fitted to its width.
 */

const WIDE = { width: 844, height: 390 };
const PHONES_UPRIGHT = [
  { name: "a 414 × 757 phone", width: 414, height: 757 },
  { name: "a 412 × 839 phone", width: 412, height: 839 },
  { name: "a 390 × 664 phone", width: 390, height: 664 },
] as const;
/** The farthest a car's body reaches from its middle along the bench (m): the thrower's drawn half length, a sedan's. */
const CAR_HALF_LENGTH = 2.2;
/** How square to the throw's axis the eye must stand (the cosine of the angle between the eye's offset and the axis, in plan). */
const SIDE_COSINE = 1e-6;

type Planned = { lab: Lab; look: THREE.Vector3; bearing: number; radius: number; thrower: THREE.Vector3 };

/** Preset `preset` on a screen `width` × `height`: the shot the Lab opens with (`upright` under 1 wide for 1 tall), as `frameLab` plans it. */
function openOn(preset: (typeof LAB_PRESETS)[number], screen: { width: number; height: number }): Planned {
  const lab = new Lab();
  lab.load(preset);
  const first = heldPose(lab.layout[0]!);
  const thrower = new THREE.Vector3(first.x, first.y, first.z);
  const aspect = screen.width / screen.height;
  const shot = aspect < 1 ? LAB_SHOT.upright : LAB_SHOT.wide;
  const look = new THREE.Vector3();
  const { bearing, radius } = planLabShot(thrower, lab.focus, lab.layout.map(heldPose), shot, aspect, false, look);
  return { lab, look, bearing, radius, thrower };
}

/** The camera the orbit rig places for `planned` on `screen`, as the orbit places it about the look point. */
function cameraFor(planned: Planned, screen: { width: number; height: number }): THREE.PerspectiveCamera {
  const aspect = screen.width / screen.height;
  const shot = aspect < 1 ? LAB_SHOT.upright : LAB_SHOT.wide;
  const camera = new THREE.PerspectiveCamera(shot.fov, aspect, 0.1, 400);
  camera.position.set(
    planned.look.x + Math.sin(planned.bearing) * planned.radius * Math.cos(shot.pitch),
    planned.look.y + planned.radius * Math.sin(shot.pitch),
    planned.look.z + Math.cos(planned.bearing) * planned.radius * Math.cos(shot.pitch),
  );
  camera.lookAt(planned.look);
  camera.updateMatrixWorld(true);
  return camera;
}

describe("given the Lab's sets on a wide screen and on phones held upright", () => {
  for (const preset of LAB_PRESETS) {
    for (const screen of [WIDE, ...PHONES_UPRIGHT]) {
      const name = "name" in screen ? screen.name : "a wide screen";
      it(`when ${preset} opens on ${name}, then the eye stands square to the throw's axis, never behind the thrower`, () => {
        const planned = openOn(preset, screen);
        const axis = new THREE.Vector2(planned.lab.focus.x - planned.thrower.x, planned.lab.focus.z - planned.thrower.z).normalize();
        const eye = new THREE.Vector2(Math.sin(planned.bearing), Math.cos(planned.bearing));
        assert.ok(Math.abs(axis.dot(eye)) < SIDE_COSINE, `the eye is ${Math.abs(axis.dot(eye)).toFixed(6)} along the throw's axis`);
      });
    }
  }

  it("when the thrower is on the left of the bench, then the camera sees the thrower on the left of the screen and the targets on the right, on both shapes", () => {
    for (const screen of [WIDE, PHONES_UPRIGHT[0]]) {
      const planned = openOn("cards", screen);
      const camera = cameraFor(planned, screen);
      const thrower = planned.thrower.clone().project(camera);
      const stack = new THREE.Vector3(10, 0, 0).project(camera);
      assert.ok(thrower.x < stack.x, `thrower at ${thrower.x.toFixed(2)}, stack at ${stack.x.toFixed(2)} (screen ${screen.width} × ${screen.height})`);
    }
  });

  it("when the same set opens on a phone upright and on a wide screen, then both look from the same side", () => {
    const upright = openOn("wall", PHONES_UPRIGHT[0]);
    const wide = openOn("wall", WIDE);
    assert.ok(Math.abs(upright.bearing - wide.bearing) < 1e-9, `${upright.bearing} against ${wide.bearing}`);
  });
});

describe("given a phone held upright", () => {
  for (const preset of LAB_PRESETS) {
    for (const screen of PHONES_UPRIGHT) {
      it(`when ${preset} opens on ${screen.name}, then the thrower and every item of the set fit its width, a car's length to spare`, () => {
        const planned = openOn(preset, screen);
        const camera = cameraFor(planned, screen);
        for (const item of planned.lab.layout) {
          const at = heldPose(item);
          for (const along of [-CAR_HALF_LENGTH, CAR_HALF_LENGTH]) {
            const onScreen = new THREE.Vector3(at.x + along, at.y, at.z).project(camera);
            assert.ok(Math.abs(onScreen.x) <= 1, `${item.kind} at x ${at.x.toFixed(1)} m is at ${onScreen.x.toFixed(2)} of the half width`);
          }
        }
      });
    }
  }

  it("when the set is the long house of cards, then the set sits in the band of the screen the road zone allows, below the panel at the top", () => {
    const screen = PHONES_UPRIGHT[1];
    const planned = openOn("cards", screen);
    const camera = cameraFor(planned, screen);
    const thrower = planned.thrower.clone().project(camera);
    const downFromTop = (1 - thrower.y) / 2;
    assert.ok(downFromTop > 0.3 && downFromTop < 0.7, `the thrower is ${(downFromTop * 100).toFixed(0)} % down the screen`);
  });
});
