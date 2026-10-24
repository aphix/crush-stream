import { anyHeld, DRIVE_KEYS } from "../vehicle/drive-input.ts";
import { PAD_BUTTON, type PadState } from "../vehicle/gamepad.ts";

/** One frame of the walker's intent, in the player's view: forward is away from the camera, strafe toward its right. */
type WalkIntent = { forward: number; strafe: number; run: boolean };

export function blankWalkIntent(): WalkIntent {
  return { forward: 0, strafe: 0, run: false };
}

/** The throttle trigger pulled past this much runs, as the boost button does. */
const RUN_TRIGGER = 0.5;

/** The axis the player pushes harder, as driving merges a key and a stick. */
function stronger(key: number, stick: number): number {
  return Math.abs(stick) > Math.abs(key) ? stick : key;
}

function heldAxis(keys: ReadonlySet<string>, positive: readonly string[], negative: readonly string[]): number {
  return (anyHeld(keys, positive) ? 1 : 0) - (anyHeld(keys, negative) ? 1 : 0);
}

/**
 * The walker's intent this frame into `out`, from the controls that drive the car: the gas and brake keys (W / S, ↑ / ↓) or the left
 * stick's up and down walk forward and back, the steering keys (A / D, ← / →) or the stick's sides step left and right, and the
 * boost control (Shift, A / Cross) or the throttle trigger (RT) runs. Keyboard and pad merge as driving's do, the stronger wins.
 */
export function readWalkIntent(keys: ReadonlySet<string>, pad: PadState | null, out: WalkIntent): WalkIntent {
  const p = pad && pad.connected ? pad : null;
  out.forward = stronger(heldAxis(keys, DRIVE_KEYS.gas, DRIVE_KEYS.brake), p ? -p.ly : 0);
  out.strafe = stronger(heldAxis(keys, DRIVE_KEYS.right, DRIVE_KEYS.left), p ? p.lx : 0);
  out.run = anyHeld(keys, DRIVE_KEYS.boost) || (p !== null && ((p.held & (1 << PAD_BUTTON.south)) !== 0 || p.rt > RUN_TRIGGER));
  return out;
}
