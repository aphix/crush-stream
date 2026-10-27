import { anyHeld, DRIVE_KEYS } from "../vehicle/drive-input.ts";
import { PAD_BUTTON, type PadState, type TouchPad } from "../vehicle/gamepad.ts";

/** One frame of the walker's intent, in the player's view: forward is away from the camera, strafe toward its right; `sprint` is the boost control, `walk` the handbrake's. */
export type WalkIntent = { forward: number; strafe: number; sprint: boolean; walk: boolean };

export function blankWalkIntent(): WalkIntent {
  return { forward: 0, strafe: 0, sprint: false, walk: false };
}

/** The throttle trigger pulled past this much sprints, as the boost button does. */
const SPRINT_TRIGGER = 0.5;

/** The axis the player pushes harder, as driving merges a key and a stick. */
function stronger(key: number, stick: number): number {
  return Math.abs(stick) > Math.abs(key) ? stick : key;
}

function heldAxis(keys: ReadonlySet<string>, positive: readonly string[], negative: readonly string[]): number {
  return (anyHeld(keys, positive) ? 1 : 0) - (anyHeld(keys, negative) ? 1 : 0);
}

/**
 * The walker's intent this frame into `out`, from the controls that drive the car: the gas and brake keys (W / S, ↑ / ↓) or the left
 * stick's up and down go forward and back, the steering keys (A / D, ← / →) or the stick's sides step left and right (a key is a full push, the
 * stick as far as it goes, so the keys run and the stick walks up to a run), the boost control (Shift, A / Cross) or the throttle trigger (RT) sprints,
 * and the handbrake's (Space, X / Square) holds him to a walk. Keyboard and pad merge as driving's do, the stronger wins.
 * On a touch screen the pedals (strip, Brake) or the disc's up and down go forward and back, and only Boost sprints: the pad's RT then carries the touch gas.
 */
export function readWalkIntent(keys: ReadonlySet<string>, pad: PadState | null, touch: TouchPad, out: WalkIntent): WalkIntent {
  const p = pad && pad.connected ? pad : null;
  const touchForward = stronger(touch.gas - touch.brake, -touch.y);
  out.forward = stronger(heldAxis(keys, DRIVE_KEYS.gas, DRIVE_KEYS.brake), p ? stronger(-p.ly, touchForward) : 0);
  out.strafe = stronger(heldAxis(keys, DRIVE_KEYS.right, DRIVE_KEYS.left), p ? p.lx : 0);
  out.sprint = anyHeld(keys, DRIVE_KEYS.boost) || (p !== null && ((p.held & (1 << PAD_BUTTON.south)) !== 0 || p.rt > Math.max(SPRINT_TRIGGER, touch.gas, -touch.y)));
  out.walk = anyHeld(keys, DRIVE_KEYS.handbrake) || (p !== null && (p.held & (1 << PAD_BUTTON.west)) !== 0);
  return out;
}
