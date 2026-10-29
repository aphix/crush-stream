import { defineConfig } from "vitest/config";

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

/** WASM skin kernel loaded first, as in the browser (`scripts/test-setup.mjs`). */
const appSetup = ["./scripts/test-setup.mjs"];

export default defineConfig({
  test: {
    reporters: ["default", "./scripts/test-reporter.mjs"],
    projects: [
      /** Runs before everything else (`npm run test:parity`): the JS skin against the kernel, which must not be loaded yet. */
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
