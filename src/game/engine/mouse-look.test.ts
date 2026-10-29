import { describe, expect, it } from "vitest";
import { MouseLook, type LockCanvas, type LockDoc } from "./mouse-look.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** A document whose pointer lock the test drives: the browser grants it, or takes it away (Esc, tab hide, alt-tab). */
function stage(refuse: "none" | "reject" | "error" = "none") {
  const doc: LockDoc = Object.assign(new EventTarget(), {
    pointerLockElement: null as unknown,
    exitPointerLock() {
      doc.pointerLockElement = null;
      doc.dispatchEvent(new Event("pointerlockchange"));
    },
  });
  const canvas: LockCanvas = {
    ownerDocument: doc,
    requestPointerLock() {
      if (refuse === "reject") return (rejected = Promise.reject(new Error("exited lock recently")));
      if (refuse === "error") doc.dispatchEvent(new Event("pointerlockerror"));
      else {
        doc.pointerLockElement = canvas;
        doc.dispatchEvent(new Event("pointerlockchange"));
      }
      return Promise.resolve();
    },
  };
  const calls = { lost: 0, changed: 0, moves: [] as [number, number][] };
  /** The promise `requestPointerLock` last rejected with (the "reject" refusal), which the mode's own `catch` was attached to first. */
  let rejected: Promise<never> | null = null;
  const look = new MouseLook({ move: (dx, dy) => calls.moves.push([dx, dy]), changed: () => calls.changed++, lost: () => calls.lost++ });
  const browserDrops = (): void => {
    doc.pointerLockElement = null;
    doc.dispatchEvent(new Event("pointerlockchange"));
  };
  const mouse = (dx: number, dy: number): void => void doc.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: dx, movementY: dy }));
  return { doc, canvas, calls, look, browserDrops, mouse, refusal: () => rejected };
}

describe("given mouse look (the pointer-lock camera control), where losing the lock by the browser's doing pauses the game once", () => {
  it("when the browser grants the lock, then the mode turns on and raw mouse movement reaches the camera", () => {
    const s = stage();
    s.look.request(s.canvas);
    expect(s.look.on).toBe(true);
    s.mouse(3, -2);
    expect(s.calls.moves, "moves reaching the camera").toHaveLength(1);
    expect(firstMismatch(s.calls.moves[0], [3, -2]), "the move reaching the camera").toBeUndefined();
  });

  it("when the browser drops the lock (Esc, tab hide, alt-tab), then the lock-lost report fires exactly once, the mode turns off, and later movement and stray repeat events do nothing", () => {
    const s = stage();
    s.look.request(s.canvas);
    s.browserDrops();
    expect(s.calls.lost).toBe(1);
    expect(s.look.on).toBe(false);
    s.browserDrops(); // a stray repeat of the event: nothing listens any more
    expect(s.calls.lost).toBe(1);
    s.mouse(5, 5);
    expect(s.calls.moves.length, "movement after the drop does not look round").toBe(0);
  });

  it("when the player leaves on purpose (toggle, menu, scene change), then no lock-lost report fires, so the game never pauses, the mode is off and the lock is released", () => {
    const s = stage();
    s.look.request(s.canvas);
    s.look.exit();
    expect(s.calls.lost).toBe(0);
    expect(s.look.on).toBe(false);
    expect(s.doc.pointerLockElement).toBe(null);
  });

  it("when the player exits with Esc and the mode asks again and the lock is dropped again, then each drop gives its own lock-lost report (one Esc, one report)", () => {
    const s = stage();
    for (let i = 1; i <= 2; i++) {
      s.look.request(s.canvas);
      s.browserDrops();
      expect(s.calls.lost).toBe(i);
    }
  });

  it("when Chrome refuses the lock after a recent exit (a rejected promise or a pointer-lock error), then the mode stays off with no lock-lost report and no throw, and asking again is allowed", async () => {
    for (const how of ["reject", "error"] as const) {
      const s = stage(how);
      s.look.request(s.canvas);
      const refusal = s.refusal();
      if (refusal !== null) await expect(refusal, how).rejects.toThrow(/exited lock recently/);
      expect(s.look.on, how).toBe(false);
      expect(s.calls.lost, how).toBe(0);
      s.look.request(s.canvas); // asking again after the refusal is allowed
    }
  });

  it("when a second request is made while one is pending or held, then it does nothing, so one drop gives one lock-lost report", () => {
    const s = stage();
    s.look.request(s.canvas);
    s.look.request(s.canvas);
    s.browserDrops();
    expect(s.calls.lost).toBe(1);
  });
});
