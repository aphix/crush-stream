import { BENCH_STRIP_ID, TRACK_ID } from "../world/constants.ts";

/** Names and quantities several engine files share: the benches' page and the pages that start them, the spark threshold. */

/** The page query that asks for a bench (`?bench=city`): `benchPlan` reads it, the loop and the lab page look for it. The strip course's id is the same word, so a run's result id and the query read alike. */
export const BENCH_QUERY = BENCH_STRIP_ID;
/** The values of `?bench=`: the benches a page can run. The city bench races the campaign's `city` course. */
export const BENCH_KIND = { city: TRACK_ID.city, lab: "lab", strip: "strip" } as const;
/** The page query that adds a bench's Ultra arm (`?ultra=1`). */
export const ULTRA_QUERY = "ultra";
/** The page query that runs a bench with the epicenter activation on (`?epi=1`; absent or 0: `whole`): with the loop's Epicenter option on, the extended loop runs every map twice, off then on, same seed and car count, the quick one every map once with it. */
export const EPI_QUERY = "epi";
/** The step id suffix of a loop step that runs with the activation on (`city:epi`): the card's `loop.step` says which arm it is. */
export const EPI_STEP_SUFFIX = ":epi";
/** The page query that asks for the extended bench (`?extended=1`): the FX-tier sweep, the pacer, detail, FX and sky A/Bs and the replay after the window. Absent or 0: the quick bench, the window alone. */
export const EXTENDED_QUERY = "extended";
/** The page query that picks the city bench's course (`?course=dam-spine`). */
export const COURSE_QUERY = "course";
/** The page queries that shape the strip bench (`benchPlan`): a loop carries them onto every step. */
export const STRIP_QUERY = { cars: "cars", same: "same", len: "len", props: "props", traffic: "traffic" } as const;
/** The bench card's look (the card, the chooser before a loop): a dark panel top-left over the game. */
export const BENCH_CARD_STYLE =
  "position:fixed;left:8px;top:8px;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);overflow:auto;z-index:99999;padding:8px 10px;" +
  "background:rgba(8,10,14,.92);color:#e8f0ff;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;border-radius:8px;pointer-events:none";
/** A bench card's button. */
export const BENCH_BUTTON_STYLE = "margin:6px 6px 0 0;padding:6px 10px;font:inherit;border-radius:6px;border:1px solid #7ee787;background:#14301c;color:#e8f0ff";
/** The settings the bench reads off the HUD and the HUD's reset command names (`night`, `wet`, `sky`, `realism`, `fx`), the HUD's `celLook`, and the page query `?fx=` that pins the tier: one spelling for all. */
export const SETTING_KEY = { night: "night", wet: "wet", sky: "sky", realism: "realism", fx: "fx", celLook: "celLook" } as const;
/** A hit whose impulse is no more than this throws no sparks: a brush, not a crash. */
export const SPARK_MIN_IMPULSE = 1.2;
/** The impulse a guard's shot hit throws its spark shower at (the grind's shower for that impulse, `CrashEngine.sparkShower`: 26 sparks; guessed, by eye). */
export const SHOT_SPARK_IMPULSE = 10;
/** A clip's timeline steps the phase clock at this fixed wall rate (Hz): the same curve on every peer, whatever its frame rate. */
export const TIMELINE_HZ = 120;
/** A burning engine puffs smoke at this wall rate (Hz) whatever the refresh rate. */
export const SMOKE_PUFF_HZ = 60;
