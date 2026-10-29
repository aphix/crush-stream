import { afterEach, describe, expect, it } from "vitest";
import { setImmediate as nextTurn } from "node:timers/promises";
import { GamepadInput, playRumble, type HapticSource, type Rumble } from "../vehicle/gamepad.ts";
import { LANDING } from "./landing.ts";
import { impactRumble, landingRumble, slideRumble } from "./rumble.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const near = (a: number, b: number, msg: string): void => expect(Math.abs(a - b), `${msg}: ${a} vs ${b}`).toBeLessThan(1e-9);
const fx = (): Rumble => ({ weak: 0, strong: 0, ms: 0 });

describe("given a hit's closing speed", () => {
  it("when it is under the camera's jolt floor (2 m/s), then there is no effect and `out` is untouched", () => {
    const out = fx();
    expect(impactRumble(1.9, out)).toBe(false);
    expect(out.weak, "weak").toBe(0);
    expect(out.strong, "strong").toBe(0);
    expect(out.ms, "ms").toBe(0);
  });

  it("when it is 11 m/s, half way to a full hit (20 m/s), then the heavy motor runs at 0.5, the light at 0.7, for 240 ms", () => {
    const out = fx();
    expect(impactRumble(11, out)).toBe(true);
    near(out.strong, 0.5, "strong");
    near(out.weak, 0.7, "weak");
    near(out.ms, 240, "ms");
  });

  it("when it is 20 m/s or a 60 m/s pile-up, then both motors are full for 400 ms and no more", () => {
    for (const closing of [20, 60]) {
      const out = fx();
      impactRumble(closing, out);
      expect(out.weak, `${closing} m/s weak`).toBe(1);
      expect(out.strong, `${closing} m/s strong`).toBe(1);
      expect(out.ms, `${closing} m/s ms`).toBe(400);
    }
  });

  it("when two hits differ in speed, then the harder one is never weaker or shorter", () => {
    const a = fx();
    const b = fx();
    for (let s = 2.5; s < 25; s += 0.5) {
      impactRumble(s, a);
      impactRumble(s + 0.5, b);
      expect(b.strong >= a.strong && b.weak >= a.weak && b.ms >= a.ms, `${s} → ${s + 0.5} m/s`).toBeTruthy();
    }
  });
});

describe("given a landing's fall speed", () => {
  it("when it falls just past the camera's landing floor, then it is a 0.3 / 0.3 thud for 120 ms, and 10 m/s past it a full 1 / 0.8 one for 380 ms", () => {
    const out = fx();
    landingRumble(LANDING.fall, out);
    expect(firstMismatch([out.strong, out.weak, out.ms], [0.3, 0.3, 120])).toBeUndefined();
    landingRumble(LANDING.fall + 10, out);
    near(out.strong, 1, "strong");
    near(out.weak, 0.8, "weak");
    near(out.ms, 380, "ms");
    landingRumble(LANDING.fall + 50, out);
    near(out.strong, 1, "a longer fall adds nothing");
  });
});

describe("given a slide", () => {
  it("when it is under 0.3, then there is no effect, and above it a light buzz of the weak motor alone that grows to 0.25", () => {
    const out = fx();
    expect(slideRumble(0.3, out)).toBe(false);
    expect(slideRumble(0, out)).toBe(false);
    expect(slideRumble(1, out)).toBe(true);
    expect(firstMismatch([out.strong, out.ms], [0, 150])).toBeUndefined();
    near(out.weak, 0.25, "full slide");
    slideRumble(0.65, out);
    near(out.weak, 0.1 + 0.15 * 0.5, "half way");
  });
});

describe("given a pad's haptic actuator", () => {
  it("when an effect is played, then the browser gets a dual-rumble with the magnitudes and the duration", () => {
    const calls: { type: string; params: { startDelay: number; duration: number; weakMagnitude: number; strongMagnitude: number } }[] = [];
    const actuator: HapticSource = {
      playEffect: (type, params) => {
        calls.push({ type, params: { ...params } });
        return Promise.resolve("complete");
      },
    };
    expect(playRumble(actuator, { weak: 0.4, strong: 0.9, ms: 250 })).toBe(true);
    expect(calls, "effects sent").toHaveLength(1);
    expect(calls[0]?.type, "effect type").toBe("dual-rumble");
    expect(calls[0]?.params.startDelay, "startDelay").toBe(0);
    expect(calls[0]?.params.duration, "duration").toBe(250);
    expect(calls[0]?.params.weakMagnitude, "weakMagnitude").toBe(0.4);
    expect(calls[0]?.params.strongMagnitude, "strongMagnitude").toBe(0.9);
  });

  it("when there is no actuator (no pad, or a browser without haptics), then nothing is sent and it does not throw", () => {
    expect(playRumble(null, { weak: 1, strong: 1, ms: 100 })).toBe(false);
    expect(playRumble(undefined, { weak: 1, strong: 1, ms: 100 })).toBe(false);
    expect(playRumble({} as HapticSource, { weak: 1, strong: 1, ms: 100 })).toBe(false);
  });

  it("when the browser throws, or the effect's promise rejects (a pad pulled mid-effect), then it does not throw and leaves no unhandled rejection", async () => {
    const stray: unknown[] = [];
    const onStray = (e: unknown): void => void stray.push(e);
    process.on("unhandledRejection", onStray);
    try {
      expect(playRumble({ playEffect: () => { throw new TypeError("dual-rumble unsupported"); } }, { weak: 1, strong: 1, ms: 100 })).toBe(false);
      expect(playRumble({ playEffect: () => Promise.reject(new Error("gone")) }, { weak: 1, strong: 1, ms: 100 })).toBe(true);
      // One turn of the event loop: Node reports an unhandled rejection after the microtasks drain, so nothing longer is needed.
      await nextTurn();
      expect(stray).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onStray);
    }
  });
});

describe("given the engine's gamepad reader", () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const stub = (pads: unknown[]): void => {
    Object.defineProperty(globalThis, "navigator", { value: { getGamepads: () => pads }, configurable: true });
  };
  afterEach(() => {
    if (real) Object.defineProperty(globalThis, "navigator", real);
    else Reflect.deleteProperty(globalThis, "navigator");
  });

  const pad = (actuator: HapticSource | undefined) => ({
    index: 0,
    id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)",
    connected: true,
    mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    vibrationActuator: actuator,
  });

  it("when no pad is connected, then rumble sends nothing", () => {
    stub([null, null]);
    const input = new GamepadInput();
    input.poll();
    expect(input.rumble({ weak: 1, strong: 1, ms: 100 })).toBe(false);
  });

  it("when a pad with haptics is connected, then rumble plays on it, and once it is unplugged nothing is sent", () => {
    let played = 0;
    const actuator: HapticSource = { playEffect: () => (played++, Promise.resolve(null)) };
    stub([pad(actuator)]);
    const input = new GamepadInput();
    input.poll();
    expect(input.rumble({ weak: 0.5, strong: 0.5, ms: 100 })).toBe(true);
    expect(played).toBe(1);
    stub([null]);
    input.poll();
    expect(input.rumble({ weak: 0.5, strong: 0.5, ms: 100 })).toBe(false);
    expect(played).toBe(1);
  });

  it("when the pad has no haptics (Firefox), then rumble sends nothing", () => {
    stub([pad(undefined)]);
    const input = new GamepadInput();
    input.poll();
    expect(input.rumble({ weak: 1, strong: 1, ms: 100 })).toBe(false);
  });
});
