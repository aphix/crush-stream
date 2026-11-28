// Prints the world digest of the audio crash scenario with audio off, for the real-engine audio row to compare against (a second engine cannot boot in one process).
// node --disable-warning=ExperimentalWarning --import ./scripts/test-setup.mjs scripts/audio-crash-digest.mjs
import { runCrash } from "../src/game/engine/engine-audio-crash.test-util.ts";

const run = await runCrash(false);
console.log(run.digest);
process.exit(0);
