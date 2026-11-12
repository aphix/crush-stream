import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOLD_MAX_SECONDS } from "../ai/openworld-auto/auto-constants.ts";
import { SUBJECT, type SubjectKind } from "../ai/openworld-auto/auto-director.ts";
import { newAutoPose } from "../ai/openworld-auto/auto-scan.ts";
import { RIDE_PAUSE } from "../present/engine-camera.ts";
import { OnFootRig } from "./engine-onfoot.test-util.ts";
import { detAtan2, detCos, detSin } from "../kernel/physics-core.js";

const LINK = "#scene=openworld&seed=beef";
/** Seconds the crowd and the foot cops need to be out and shown. */
const SETTLE_S = 3;
/** A shot's first seconds: the camera is framed and the subject is on screen. */
const FRAMED_S = 1;
/** A drag or a mouse look this long (px) is 0.8 rad of bearing, far over `TURNED_RAD` even where a wall at his back turns the camera short of it. */
const DRAG_PX = 160;
const TURNED_RAD = 0.15;
/** Mouse look and the settling after a drag run this many frames of this length (s) each. */
const MOUSE_LOOK_FRAMES = 30;
const MOUSE_LOOK_FRAME_S = 1 / 30;
/** Presses of E that go once round every person, foot cop and driver the world shows at this moment, with room to spare. */
const PRESSES_ROUND = 400;

describe("given the real engine in the open world with the Auto camera on, the player at the wheel of his car", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let rig: OnFootRig;
  const world = () => rig.engine["openWorld"];
  const view = () => rig.engine["view"];
  const auto = () => world()["auto"]!;

  /** The kind and id of the subject on screen, as text for a message. */
  const subjectText = () => `${auto().subject?.kind}:${auto().subject?.id}`;

  /** The first person or foot cop (`kind`) the world shows. */
  function shown(kind: SubjectKind): number {
    const poses = kind === SUBJECT.cop ? world()["law"]!.copPoses : world()["crowd"]!.poses;
    for (let id = 0; id < poses.count; id++) if (poses.shown[id] === 1) return id;
    return expect.fail(`nobody of kind ${kind} is shown`);
  }

  /** The director cuts to (`kind`, `id`) as it would to any subject of its own choosing, and the camera is framed on it. */
  function cutTo(kind: SubjectKind, id: number): void {
    auto()["director"]["go"](kind, id);
    rig.run(FRAMED_S);
    expect(subjectText(), "the subject on screen").toBe(`${kind}:${id}`);
  }

  /** The bearing (rad) of the camera round the subject on screen. */
  function bearing(): number {
    const pose = newAutoPose();
    auto()["scan"].poseOf(auto().subject!.kind, auto().subject!.id, pose);
    const eye = rig.engine["camera"].position;
    return detAtan2(eye.x - pose.x, eye.z - pose.z);
  }

  /** The turn (rad, 0 to pi) between two bearings. */
  const turnBetween = (from: number, to: number) => Math.abs(detAtan2(detSin(to - from), detCos(to - from)));

  const pointer = (type: "pointerdown" | "pointermove" | "pointerup", x: number, y: number) => {
    Object.assign(view()["canvas"], { setPointerCapture() {}, releasePointerCapture() {}, style: {} });
    const press = Object.assign(new Event(type), { button: 0, pointerId: 1, clientX: x, clientY: y }) as PointerEvent;
    if (type === "pointerdown") view()["onPointerDown"](press);
    else if (type === "pointermove") view()["onPointerMove"](press);
    else view()["onPointerUp"](press);
  };

  beforeAll(async () => {
    rig = await OnFootRig.boot(LINK);
    rig.run(SETTLE_S);
  });
  beforeEach(() => {
    view().locked = false;
    world().setAuto(false);
    rig.sit(0);
    rig.engine["seat"].view = "first";
    rig.press("KeyV");
    rig.run(0.2);
    expect(world().autoOn, "V from the hood view is the Auto camera").toBe(true);
  });
  afterAll(() => rig.dispose());

  describe.each([
    { it: "a person", kind: SUBJECT.civilian },
    { it: "a foot cop", kind: SUBJECT.cop },
  ])("while it follows $it", ({ kind }) => {
    // mutation: sed -i 's/      this.director.hold(MANUAL_HOLD_SECONDS);//' src/game/engine/engine-openworld-auto.ts
    it("when the mouse drags the view past the longest hold of a shot, then the camera has turned round him, and the same subject is on screen after the drag and the ride pause", () => {
      cutTo(kind, shown(kind));
      const before = bearing();
      const cuts = auto().cuts;
      pointer("pointerdown", 300, 300);
      pointer("pointermove", 300 - DRAG_PX, 300);
      let widest = 0;
      for (let frame = 0; frame < MOUSE_LOOK_FRAMES; frame++) {
        rig.run(MOUSE_LOOK_FRAME_S);
        widest = Math.max(widest, turnBetween(before, bearing()));
      }
      expect(widest, "the widest the camera's bearing round him turned by the drag (rad)").toBeGreaterThan(TURNED_RAD);
      rig.run(HOLD_MAX_SECONDS);
      pointer("pointerup", 300 - DRAG_PX, 300);
      rig.run(RIDE_PAUSE + 1);
      expect(auto().cuts, "the director made no cut while he held the view and after it").toBe(cuts);
    });

    // mutation: sed -i 's/      this.rideLooked = true;//' src/game/present/engine-camera.ts
    it("when pointer-lock mouse look turns the view, then the camera turns round him the same way a drag does", () => {
      cutTo(kind, shown(kind));
      const before = bearing();
      view().locked = true;
      let widest = 0;
      for (let frame = 0; frame < MOUSE_LOOK_FRAMES; frame++) {
        view().lookBy(DRAG_PX / MOUSE_LOOK_FRAMES, 0);
        rig.run(MOUSE_LOOK_FRAME_S);
        widest = Math.max(widest, turnBetween(before, bearing()));
      }
      expect(widest, "the widest the camera's bearing round him turned by mouse look (rad)").toBeGreaterThan(TURNED_RAD);
    });
  });

  // mutation: sed -i 's/    return this.showOpenWorld \&\& this.openWorld.cycleAuto(dir);/    return false;/' src/game/engine/engine.ts
  it("when E and Q are pressed, then the camera goes to the next and back to the previous person, and the driven car's seat stays where it was", () => {
    const first = shown(SUBJECT.civilian);
    cutTo(SUBJECT.civilian, first);
    const seat = rig.engine["seat"];
    const carIndex = seat.carIndex;
    rig.press("KeyE");
    expect(subjectText(), "after E the camera is on somebody else").not.toBe(`${SUBJECT.civilian}:${first}`);
    rig.press("KeyQ");
    expect(subjectText(), "after Q it is back on the first").toBe(`${SUBJECT.civilian}:${first}`);
    expect(seat.carIndex, "the driven car's seat did not step to another car").toBe(carIndex);
    expect(seat.mode, "and is still at the wheel").toBe("drive");
  });

  // mutation: sed -i 's/const WALKED: readonly SubjectKind\[\] = \[SUBJECT.civilian, SUBJECT.cop, SUBJECT.driver\];/const WALKED: readonly SubjectKind[] = [SUBJECT.civilian];/' src/game/engine/engine-openworld-auto.ts
  it("when E is pressed once round everybody the world shows, then it has stopped on people and on foot cops", () => {
    cutTo(SUBJECT.civilian, shown(SUBJECT.civilian));
    const kinds = new Set<number>();
    for (let press = 0; press < PRESSES_ROUND; press++) {
      rig.press("KeyE");
      kinds.add(auto().subject!.kind);
    }
    expect(kinds.has(SUBJECT.civilian), "the walk stopped on a person").toBe(true);
    expect(kinds.has(SUBJECT.cop), "the walk stopped on a foot cop").toBe(true);
  });
});
