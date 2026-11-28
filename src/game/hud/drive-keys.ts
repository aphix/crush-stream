import { PAD_BUTTON, padButtonName, type PadFamily } from "../vehicle/gamepad.ts";

const WEAPON_KEYS_HINT = ["1 Fists", "2 Pistol", "3 Shotgun", "4 Rifle", "0 Hook"] as const;

/** The shoulder, trigger and View buttons as each pad family names them (the face buttons come from `padButtonName`); a generic pad is named as the standard mapping's Xbox layout. */
const XBOX_PARTS = { lb: "LB", lt: "LT", rt: "RT", view: "View" };
const PAD_PARTS: Record<PadFamily, { lb: string; lt: string; rt: string; view: string }> = {
  xbox: XBOX_PARTS,
  playstation: { lb: "L1", lt: "L2", rt: "R2", view: "Create" },
  generic: XBOX_PARTS,
};

/**
 * The walker's controls as the HUD's key line, behind `prompt` (what the control does now, or why it refused) when there is one: GTA's on-foot layout.
 * `pad`: the connected pad's family (null: keyboard and mouse), named in its own glyphs. `arms`: the weapon in hand, marked `▸` on a keyboard; with it
 * RT fires, hold LB opens the weapon wheel and A alone runs. `cables`: the hook's cables out, shown on the marked hook.
 */
export function footKeys(pad: PadFamily | null, prompt: string | null, arms: { slot: number } | null = null, cables = 0): string {
  const names = pad === null ? null : PAD_PARTS[pad];
  const sprint = pad === null ? "" : padButtonName(pad, PAD_BUTTON.south);
  const getIn = pad === null ? "" : padButtonName(pad, PAD_BUTTON.north);
  const parts = names
    ? ["left stick walk", arms === null ? `${sprint} or ${names.rt} run` : `${sprint} run`, "left stick click walk slowly", "right stick look", `${names.view} camera`, `${getIn} get in at your car's driver door`]
    : ["W/A/S/D walk", "Shift run", "Space walk slowly", "drag look", "; mouse look", "V camera", `${arms === null ? "Enter" : "F"} get in at your car's driver door`];
  const marked = WEAPON_KEYS_HINT.map((hint, slot) => (slot === arms?.slot ? `▸${hint}` : hint)).map((hint) => (hint === "▸0 Hook" ? `▸0 Hook ${cables}/6` : hint));
  const weapons = arms === null ? [] : names ? [`hold ${names.lb} weapon wheel`, `tap ${names.lb} arm / put away`, `${names.lt} aim`, `${names.rt} fire`] : [...marked, "scroll or hold Tab weapons", "right button aim", "left click fire"];
  const all = [...parts, ...weapons];
  return (prompt === null ? all : [prompt, ...all]).join(" · ");
}

/**
 * The driven car's controls as the HUD's key line (" · " separated, outside a race), for the keyboard or a controller. The Long jump's
 * boost control is its bail, which its card names, so the line has no boost there (`boostable` false).
 */
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
