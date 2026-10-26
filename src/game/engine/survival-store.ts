import { load, save } from "./minigame-store.ts";

/** `localStorage` key of a course's best Survival time (seconds, as text). Preferences only: nothing here picks a scene or a room (engine-share.ts). */
const KEY = "crush.survival.best.";

/** The best time kept for course `trackId` (s), null when none, or when the browser's storage is off or holds something else. */
export const loadBest = (trackId: string): number | null => load(KEY + trackId);

/** Keep `time` as the course's best. A blocked or full storage keeps nothing: the HUD still shows the run's own result. */
export const saveBest = (trackId: string, time: number): void => save(KEY + trackId, time);
