import { fileURLToPath } from "node:url";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import { defineConfig } from "vitest/config";

/**
 * Every test process reads and writes Node's compile cache (V8 code and the type-stripped source of each module), so it loads the engine's modules
 * much faster and the first processes of a run fill it for the rest. Portable: a copy of the tree at another path (a worktree, a CI checkout) finds the
 * entries a sibling wrote. A caller's own `NODE_COMPILE_CACHE` wins and keeps its mode.
 */
if (!process.env.NODE_COMPILE_CACHE) {
  process.env.NODE_COMPILE_CACHE = fileURLToPath(new URL("./node_modules/.cache/node-compile", import.meta.url));
  process.env.NODE_COMPILE_CACHE_PORTABLE = "1";
}

/**
 * Defaults of every test process. One forked process per test file (`isolate`: a global, a timer or a WASM singleton one
 * file sets never reaches the next), run by Node's own module loader: no Vite transform, so the sim's hot code runs as
 * written (through Vite's import indirection the heavy files ran 40-50% slower). The command line is these `execArgv`.
 */
const defaults = {
  pool: "forks" as const,
  isolate: true,
  experimental: { viteModuleRunner: false },
  /** Heap cap per test process (MB): about twice the heaviest file's peak heap, so a runaway aborts there, not at the box's memory. The warning is Node's note that Rapier loads through an experimental `.wasm` import. */
  execArgv: ["--max-old-space-size=1536", "--disable-warning=ExperimentalWarning"],
  /** Node's own test runner had none: a slow file is a number in the report, not a failure. */
  testTimeout: 0,
  hookTimeout: 0,
  restoreMocks: true,
  /** A failing compare prints and diffs both sides whole: two 75k-float arrays took one machine down. The diff keeps this many lines of each side. */
  diff: { truncateThreshold: 60 },
};

/** The parity file is the longest single file of a run; queued behind the suites it would run alone at the end of the pool. */
class ParityFirst extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    const sorted = await super.sort(files);
    return [...sorted.filter((f) => f.project.name === "parity"), ...sorted.filter((f) => f.project.name !== "parity")];
  }
}

/** WASM skin kernel loaded first, as in the browser (`scripts/test-setup.mjs`). */
const appSetup = ["./scripts/test-setup.mjs"];

export default defineConfig({
  test: {
    reporters: ["default", "./scripts/test-reporter.mjs"],
    sequence: { sequencer: ParityFirst },
    projects: [
      /** The JS skin against the kernel, which must not be loaded yet: no setup file, and every file is its own process. Queued first, runs beside the suites; a red there cancels the run (`scripts/test-reporter.mjs`). */
      { test: { ...defaults, name: "parity", include: ["src/**/*.parity.ts"] } },
      {
        test: {
          ...defaults,
          name: "app",
          include: ["src/game/**/*.test.ts", "src/lib/multiplayer/**/*.test.ts", "src/lib/submissions/**/*.test.ts", "src/lib/deploy/**/*.test.ts"],
          setupFiles: appSetup,
        },
      },
      { test: { ...defaults, name: "scripts", include: ["scripts/**/*.test.mjs"] } },
      { test: { ...defaults, name: "ai-long-run", include: ["src/game/**/*.ai-long-run.ts"], setupFiles: appSetup } },
    ],
  },
});
