import { epicenterValues } from "./epicenter.ts";

/** The activation's values at module load, before a test moves any: `loadEpicenter(EPICENTER_AT_LOAD)` puts the defaults back. Not a test file itself. */
export const EPICENTER_AT_LOAD: readonly number[] = epicenterValues();
