/**
 * The driven car's controls as the HUD's key line (" · " separated, outside a race), for the keyboard or a controller. The Long jump's
 * boost control is its bail, which its card names, so the line has no boost there (`boostable` false).
 */
const WEAPON_KEYS_HINT = ["1 Fists", "2 Pistol", "3 Shotgun", "4 Rifle"] as const;

/**
 * The walker's controls as the HUD's key line, behind `prompt` (what the control does now, or why it refused) when there is one: the same keys and
 * sticks that drive the car, and the control that gets him out and in. `arms`: the weapon in hand, marked `▸` on a keyboard; with it on a pad, RT fires and A alone runs.
 */
export function footKeys(pad: boolean, prompt: string | null, arms: { slot: number } | null = null): string {
  const parts = pad
    ? ["left stick walk", arms === null ? "A or RT run" : "A run", "right stick look", "Y get in at your car's driver door"]
    : ["W/A/S/D walk", "Shift run", "drag look", "; mouse look", "Enter get in at your car's driver door"];
  const weapons = arms === null ? [] : pad ? ["LB/RB weapon", "LT aim", "RT fire"] : WEAPON_KEYS_HINT.map((hint, slot) => (slot === arms.slot ? `▸${hint}` : hint));
  const all = [...parts, ...weapons];
  return (prompt === null ? all : [prompt, ...all]).join(" · ");
}

export function driveKeys(pad: boolean, boostable: boolean): string {
  const boost = boostable ? [pad ? "A boost" : "Shift boost"] : [];
  const parts = pad
    ? ["RT gas", "LT brake, then reverse", "left stick steer", "X handbrake", ...boost, "B view", "R3 look back", "right stick look", "LB/RB car", "D-pad ↓ recover", "Back watch"]
    : ["W gas", "S brake, then reverse", "A/D steer", "Space handbrake", ...boost, "drag look", "V view", "` look back", "R recover", "Esc watch"];
  return parts.join(" · ");
}

/** The showcase's number keys (`Showcase.key`: `THROWN_KINDS` in key order, then a man and a woman, then 0 to clear): each throws at the point under the cursor. */
export const SHOWCASE_THROW_KEYS = "1 cone · 2 crate · 3 tyres · 4 hay bale · 5 bumper · 6 monster wheel · 7 wheel · 8 man · 9 woman: thrown at the cursor · 0 clears them";

/** `keys` (a seat's key line) with the showcase's throw keys after it: only in the showcase, and only for a keyboard (a controller has no number keys). */
export function withShowcaseKeys(keys: string, showcase: boolean, pad: boolean): string {
  return showcase && !pad ? `${keys} · ${SHOWCASE_THROW_KEYS}` : keys;
}
