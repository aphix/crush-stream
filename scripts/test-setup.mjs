/**
 * Imported into every `app` test process by `vitest.config.ts`: the WASM skin kernel is loaded before the file runs, so headless
 * engines and cars skin as the browser does (the engine's own fetch of a file URL fails under Node). The JS skin it replaces
 * is checked against the kernel by `src/game/deform/skin-kernel.parity.ts` (the `test:parity` script), in a process that has no setup file.
 */
import { loadSkinKernelForTest } from "../src/game/deform/skin-kernel.test-util.ts";

await loadSkinKernelForTest();
