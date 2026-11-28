#!/usr/bin/env node
/**
 * Build `public/audio/motor-worklet.js`, the engine-sound worklet the game loads, and the repo commits.
 *
 *   npm run build:motor
 *
 * Upstream's prebuilt module (`kernels/motor/engine_sound_generator_worklet_webassembly.js`, MIT, wasm inlined) ends with
 * its stock AudioWorkletProcessor. Everything from that processor's copyright header on is replaced by
 * `kernels/motor/motor-layers.js` (our voice layers) followed by `kernels/motor/motor-processor.js` (no per-block allocation, lazy init,
 * silent fast path). The emscripten part is untouched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREBUILT = join(ROOT, "kernels/motor/engine_sound_generator_worklet_webassembly.js");
const LAYERS = join(ROOT, "kernels/motor/motor-layers.js");
const PROCESSOR = join(ROOT, "kernels/motor/motor-processor.js");
const OUT = join(ROOT, "public/audio/motor-worklet.js");
const UPSTREAM_POST_JS =
  "/*\n * Copyright (c) 2021-2022 Antonio-R1\n * License: https://github.com/Antonio-R1/engine-sound-generator/blob/main/LICENSE | MIT\n */\n\nvar SoundGeneratorWasm = Module;";

const prebuilt = readFileSync(PREBUILT, "utf8");
const offset = prebuilt.indexOf(UPSTREAM_POST_JS);
if (offset < 0 || prebuilt.indexOf(UPSTREAM_POST_JS, offset + 1) >= 0) {
  console.error(`build-motor-worklet: expected exactly one upstream processor header in ${PREBUILT}`);
  process.exit(1);
}
writeFileSync(OUT, prebuilt.slice(0, offset) + readFileSync(LAYERS, "utf8").replace(/^\n/, "") + readFileSync(PROCESSOR, "utf8").replace(/^\n/, ""));
console.log(`wrote ${OUT}`);
