# Test suite speed and memory (2026-11-09)

Goal (owner): cut wasted time and memory from `npm run test:app`; "share setups, snapshot v8 states, optimize the hell out of test resources"; "a test that requires AI analysis is not a test".

Perplexity answers were leads only. Every claim kept below was checked against its source (quoted) or against this repo. Raw answers: `perplexity/2026-11-09-*.md` (all asked in neutral form).

## This suite, measured

- Last full gate (`union-15`, worker, 4 workers): `Duration 1696.42s (tests 91%, import 9%)`; parity project alone `Duration 55.82s (tests 98%, import 2%)` (`/home/aphix/crash-wt/gate-u15b.log`).
- 620 app files, about 6000 CPU-seconds. The 30 slowest files hold 2473 s; files 31-137 another 2303 s (`/home/aphix/crash-wt/suite-times.txt`).
- Config (`vitest.config.ts`): `pool: "forks"`, `isolate: true`, `experimental.viteModuleRunner: false` (tests run through Node's own module loader: no Vite transform), `--max-old-space-size=1536` per file process. Vitest 5.0.5, Vite 8.2.2 (Rolldown), Node 24.

## Verified findings

1. **Config can only reach the import share.** Vitest's guide: the `tests` phase is "running the tests themselves. A run dominated by this phase has little to gain from configuration changes." (vitest.dev/guide/improving-performance). Here that is 91%, so most of the gain must come from what the tests do.
2. **Isolation is the configurable cost.** Same guide: `import` covers evaluating test files and modules, and "isolation re-evaluates that shared graph for every file"; `isolate: false` "will improve the speed of your tests" for projects that "don't rely on side effects and properly cleanup their state"; it can be set per project (`projects` with split `include`). Table in the guide: `isolate: false` is "once per worker" with "none" isolation; "Prefer `isolate: false` with `threads` if the tests tolerate shared state: it is the fastest option".
3. **`vitest doctor` measures it for us.** The guide: "`vitest doctor` measures the alternative configurations instead of estimating them: it runs the suite under each candidate and reports the comparison, including whether the tests pass with `isolate: false`." Present in our installed 5.0.5 (`node_modules/vitest/dist/chunks/doctor.*.js`; it needs a green, stable suite).
4. **Pool.** Guide: default `forks` "may be slightly slower than `pool: 'threads'` in larger projects". The Vitest benchmarks repo's cpu-bound app (30 CPU-heavy files): "The tests dominate, so only scheduling (`maxWorkers`, pool choice) changes anything", with small deltas (e.g. forks 25%: 1.55 s -> 1.43 s, -8%, 4.1.10 vs 5.0.0) (github.com/vitest-dev/benchmarks README). Expect single-digit percent from pool alone.
5. **V8 startup snapshots cannot hold our engine.** Node CLI docs (`--build-snapshot`): "The snapshot currently only supports loading a single entrypoint during the snapshot building process, which can load built-in modules, but not additional user-land modules." So "snapshot the V8 state" of the engine + built fixtures is not available in Node 24. The workable equivalents: (a) build fixture data once and store it on disk as plain data/typed arrays, loaded per file; (b) share built fixtures in-process across files under `isolate: false`.
6. **Compile cache applies to our own source.** Node module docs: once enabled, "whenever Node.js compiles a CommonJS, an ECMAScript Module, or a TypeScript module, it will use on-disk V8 code cache"; written at process exit; "caches are invalidated when the absolute paths of the modules being cached are changed" unless `portable` (`NODE_COMPILE_CACHE_PORTABLE=1`, added v24.12.0). Our tests use Node's loader, so all source qualifies. Catch for the worker: `worker.sh` copies each run to a new `/tmp` path, so it needs the portable mode and a cache dir that outlives the run copy. Vitest's guide also documents `NODE_COMPILE_CACHE` (it propagates to workers; worth it only when the dir survives between runs). Bounded by the 9% import share.
7. **Shared setup across files, as Vitest supports it.** `globalSetup` runs once in a separate scope; tests get only "serializable data ... via `provide`" and `inject` (vitest.dev/config/globalsetup). Live objects (worlds, cars, WASM instances) cannot be passed; `setupFiles` "runs before every test file". So sharing built fixtures means serialized data or `isolate: false`.
8. **Finding the cost inside a file.** Vitest profiling guide: `execArgv: ['--cpu-prof', '--cpu-prof-dir=...', '--heap-prof', ...]` writes per-worker `.cpuprofile`/`.heapprofile`; `experimental.importDurations` (CLI `--experimental.importDurations.print`) lists the slowest imports (vitest.dev/guide/profiling-test-performance). Its example run: `Duration 4.80s (transform 44ms, setup 0ms, import 35ms, tests 4.52s ...)`.
9. **Very many cores: the main thread can bottleneck.** Guide: "in 32 CPU machine the main thread is responsible to handle load coming from 31 test threads"; sharding across processes splits that load. Not our case at 4 workers.

## Checked and rejected (or not usable)

- "threads 16.17 s vs forks 28.68 s" (attributed to the Vitest benchmarks): NOT IN SOURCE.
- "Vitest 5.1 blog: 19% / 25% / 8%": the numbers exist, but in the benchmarks README's 4.1.10 vs 5.0.0 table (enterprise-monolith 7.24 -> 5.83 s; long-haul vmForks 5.43 -> 4.06 s; cpu-bound 1.55 -> 1.43 s), not the blog.
- "isolate:false: 42.5 s -> 14.2 s, 850 -> 380 MB peak RSS": present in a vendor blog (locionic.com) with no method or project; not used as evidence.
- Godot/Box2D/Jolt/MuJoCo test-suite descriptions (one answer): generic and uncited per claim; not verified. Follow-up: read the actual test trees of engines with public suites (e.g. Rapier, our physics engine) before citing any practice from them.
- "headless at 10x-100x real time", "24-72 virtual hours soak" (salivity.github.io): unverified secondary blog; not used.
- Determinism study (arXiv 2104.06262): VERIFIED but about CARLA/Unreal variance (Test 2 restricted max deviation 9.8e-3 m), not suite speed; our sim is already bit-identical by test.
- Rust/compiled toolchain swaps: the repo already uses oxlint and tsrs (`tsrs --noEmit --fast`), and Vite 8 already bundles with Rolldown. Tests bypass Vite (Node loader), so bundler/transformer swaps do not touch test time. No compiled drop-in for the Vitest runner was found; Bun's test runner is not drop-in (different runtime semantics; answer's own caveat). No other straight swap applies to the test path today.

## Comparison of the answers

All answers agree that a CPU-bound suite is won in the test bodies (smaller staged scenarios, shared fixtures, splitting long runs to a separate suite) and that runner config moves only startup/import cost. They differ on how much isolation costs; only the Vitest docs and `vitest doctor` give a defensible way to measure it here. None offers a way to snapshot user-land JS state in Node; the Node docs rule it out.

## Plan for this repo (ranked)

1. **Test bodies (the 91%)**: the speed lanes, file by file, from the measured slowest list and the scouts' waste census: memoize identical runs (runWall/runPair repeats, same race twice), stop fixed-length loops once the read state is final, stage the moment a row is about instead of driving a long run up to it, build a fixture once per describe, take per-element `expect` out of hot loops (millions of calls). Never shrink a list a row's claim is about; never loosen a bound; each changed row keeps a mutation that turns it red.
2. **Shared fixtures**: build-once data shared through a test-util module cache (per process) and, where builds are large, serialized to disk once per run (typed arrays) and loaded per file. A file that mutates a fixture gets its own copy.
3. **Isolation (part of the 9%)**: run `vitest doctor` on a fixed subset on the worker; if most files pass with `isolate: false`, split them into a non-isolated project and keep isolation for files with globals/WASM singletons/timers. Measure wall time, CPU time and peak RSS before and after.
4. **Compile cache (part of the 9%)**: `NODE_COMPILE_CACHE` + `NODE_COMPILE_CACHE_PORTABLE=1` with a persistent directory on the worker and locally; measure import share on a second run.
5. **Profiling**: `--cpu-prof`/`--heap-prof` via `execArgv` on single slow files to find the cost inside them before cutting.
6. **Render-dependent rows**: no test may need an AI or a person to judge an image. Rows whose pass/fail is a machine check of GL output (program link, GL error codes, exact pixel values) stay, made cheaper (one shared context, fewer frames); any check judged by looking at an image is replaced by the same claim checked on geometry/rig numbers.

## Sources (read by Main)

- https://vitest.dev/guide/improving-performance.html
- https://vitest.dev/guide/profiling-test-performance.html
- https://vitest.dev/config/isolate , https://vitest.dev/config/globalsetup
- https://github.com/vitest-dev/benchmarks (README)
- https://nodejs.org/api/cli.html#--build-snapshot , https://nodejs.org/api/module.html#module-compile-cache
- https://ar5iv.labs.arxiv.org/html/2104.06262
- https://www.locionic.com/en/blog/vitest-monorepo-unit-testing-performance (rejected as evidence)
