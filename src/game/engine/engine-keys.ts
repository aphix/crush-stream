import type { SceneId } from "../scenes/scene-id.ts";

/**
 * Keys with a job while a car is driven, followed or raced, beside the pedals, wheel, handbrake and boost in `DRIVE_KEYS`
 * (`KeyboardEvent.code`s). A scene key must be none of these or of `DRIVE_KEYS` (`engine-keys.test.ts`).
 */
export const SEAT_KEYS = {
  camera: ["KeyV", "KeyT", "KeyC"],
  previousCar: "KeyQ",
  nextCar: "KeyE",
  reset: "KeyR",
  /** Get out of the car, and into one: the walker's control (the pad's is Y). */
  onFoot: "Enter",
  stepOut: "Escape",
  lookBack: "Backquote",
  mouseLook: "Semicolon",
  raceView: "KeyH",
  /** The open world's clock and light to the previous or next game hour, solo only (the number pad's minus and plus; the scene keys are the top row's `-` and `=`). */
  dayBack: "NumpadSubtract",
  dayForward: "NumpadAdd",
  /** The free view's up and down: every letter already has a job, so the page keys (the WASD and arrow keys fly it, Shift is fast). */
  flyUp: "PageUp",
  flyDown: "PageDown",
};

/**
 * The grappling tether's keys (`KeyboardEvent.code`s): fire (hook a target; fire again for a second one), retract (held), cut every cable. Every letter already has a job,
 * so they are punctuation and the Delete key. The pad's are the D-pad's up, right (held) and left. Like the seat keys, no scene key may be one of them (`engine-keys.test.ts`).
 */
export const TETHER_KEYS = {
  fire: "Quote",
  retract: "BracketRight",
  cut: "Delete",
};

/** The scene picks by key: the code, the label the key list shows, and the scene. The same key again goes back to the fleet. */
export const SCENE_KEY_BINDINGS: readonly { code: string; label: string; scene: SceneId }[] = [
  { code: "Equal", label: "=", scene: "derby" },
  { code: "KeyZ", label: "Z", scene: "race" },
  { code: "Minus", label: "-", scene: "survival" },
  { code: "BracketLeft", label: "[", scene: "press" },
  { code: "KeyI", label: "I", scene: "pistons" },
  { code: "KeyN", label: "N", scene: "doors" },
  { code: "Comma", label: ",", scene: "corkscrew" },
  { code: "Slash", label: "/", scene: "stack" },
];

export const SCENE_KEY_SCENES: Readonly<Partial<Record<string, SceneId>>> = Object.fromEntries(SCENE_KEY_BINDINGS.map((binding) => [binding.code, binding.scene]));
