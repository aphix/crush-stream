import type { RefObject } from "react";
import type { CrashEngine } from "@/game/engine/engine";
import type { CrashHudState } from "@/game/hud/hud-store";
import { SCENE, SOLO_SCENES, type SceneId } from "@/game/scenes/scene-id";

/** `tone`: the mode's accent (a `--tone` variable), so the richer game modes carry a ring and a tinted fill; `quiet`: a test rig, muted until picked. */
type SceneDef = { id: SceneId; label: string; aria: string; tone?: string; quiet?: boolean };

/**
 * Every scene the player can pick, the one list behind the desktop dock's chips and the phone's Home sheet. Fleet is "none of the others":
 * the engine keeps derby, race, press, pistons, doors, corkscrew, stack, range, the Lab and the garage mutually exclusive. The showcase (by
 * link only) has no button: the bar lights Fleet there. Richer game modes first, then the test rigs.
 */
const SCENES: SceneDef[] = [
  { id: SCENE.fleet, label: "Fleet", aria: "Fleet scene" },
  { id: SCENE.derby, label: "Derby", aria: "Demolition derby scene", tone: "[--tone:var(--color-scene-derby)]" },
  { id: SCENE.race, label: "Race", aria: "Race scene", tone: "[--tone:var(--color-scene-race)]" },
  { id: SCENE.range, label: "Range", aria: "Ejection range scene", tone: "[--tone:var(--color-scene-range)]" },
  { id: SCENE.survival, label: "Survival", aria: "Survival scene: how long can you last", tone: "[--tone:var(--color-scene-survival)]" },
  { id: SCENE.garage, label: "Garage", aria: "Garage: pick your car's and driver's colours and spray-paint them", tone: "[--tone:var(--color-scene-garage)]" },
  // A test bench for flings and crash forces, not a game mode: muted with the rigs so the menu does not point at it.
  { id: SCENE.lab, label: "Lab", aria: "Lab scene: flick a toy car at a stack of cars on a workbench", quiet: true },
  { id: SCENE.press, label: "Press", aria: "Car compactor scene", quiet: true },
  { id: SCENE.pistons, label: "Pistons", aria: "Piston rig scene", quiet: true },
  { id: SCENE.doors, label: "Doors", aria: "Door and mirror knock scene", quiet: true },
  { id: SCENE.corkscrew, label: "Corkscrew", aria: "Corkscrew ramp scene", quiet: true },
  { id: SCENE.stack, label: "Stack", aria: "Roof-crush stack scene", quiet: true },
];

export const sceneLabel = (id: SceneId): string => SCENES.find((scene) => scene.id === id)?.label ?? id;

/** The phone's Home sheet leads with these six, in this order; Fleet is its own "Free play" row and the test rigs fold away. */
const HOME_MODE_ORDER: readonly SceneId[] = [SCENE.race, SCENE.derby, SCENE.survival, SCENE.range, SCENE.garage];

/** The scenes a netplay room cannot be in (the single-player ones) drop out of the pickers while the browser is in a room. */
export const scenesFor = (inRoom: boolean): SceneDef[] => SCENES.filter((scene) => !(SOLO_SCENES[scene.id] && inRoom));

/** The game-mode cards of the Home sheet, in order, for a room or not. */
export const homeModes = (inRoom: boolean): SceneDef[] => HOME_MODE_ORDER.flatMap((id) => scenesFor(inRoom).filter((scene) => scene.id === id));

/** The test rigs, folded away on the phone's Home sheet. */
export const TEST_RIGS: SceneDef[] = SCENES.filter((scene) => scene.quiet);

/** The scene in play: Fleet is "none of the others". */
export function sceneInPlay(state: CrashHudState): SceneId {
  if (state.race) return state.race.survival ? SCENE.survival : SCENE.race;
  if (state.derby) return SCENE.derby;
  if (state.showCompactor) return SCENE.press;
  if (state.showPistons) return SCENE.pistons;
  if (state.showDoors) return SCENE.doors;
  if (state.range) return SCENE.range;
  if (state.showCorkscrew) return SCENE.corkscrew;
  if (state.stack) return SCENE.stack;
  if (state.garage) return SCENE.garage;
  return state.lab ? SCENE.lab : SCENE.fleet;
}

/** Every scene but Fleet has an engine toggle; Fleet is what is left when the scene in play toggles off. */
const TOGGLES: Record<Exclude<SceneId, typeof SCENE.fleet>, (engine: CrashEngine) => void> = {
  derby: (engine) => engine.toggleDerby(),
  race: (engine) => engine.toggleRace(),
  press: (engine) => engine.toggleCompactor(),
  pistons: (engine) => engine.togglePistons(),
  doors: (engine) => engine.toggleDoors(),
  range: (engine) => engine.toggleRange(),
  survival: (engine) => engine.toggleSurvival(),
  corkscrew: (engine) => engine.toggleCorkscrew(),
  stack: (engine) => engine.toggleStack(),
  lab: (engine) => engine.toggleLab(),
  garage: (engine) => engine.toggleGarage(),
  showcase: (engine) => engine.toggleShowcase(),
};

/** Toggles scene `id` (the engine does nothing before it has booted). */
function sceneToggle(engine: RefObject<CrashEngine | null>, id: Exclude<SceneId, typeof SCENE.fleet>): void {
  if (engine.current) TOGGLES[id](engine.current);
}

/** A scene button's press: the scene already in play does nothing, Fleet toggles the scene in play off, any other scene toggles itself on. */
export function pickScene(engine: RefObject<CrashEngine | null>, inPlay: SceneId, picked: SceneId): void {
  if (picked === inPlay) return;
  const toggled = picked === SCENE.fleet ? inPlay : picked;
  if (toggled !== SCENE.fleet) sceneToggle(engine, toggled);
}
