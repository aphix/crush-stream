# Toolchain measurements and decisions

Measured on WSL2 (14 cores, 23 GB), with the box shared with another project's cargo builds (load average 25–58 during runs), so wall times are noisy. Every number is the median of 3 runs under `flock /tmp/crash-gate.lock`, measured with `/usr/bin/time -f "wall=%es rss_kb=%M"` (peak RSS of the largest process).

| Tool | Before | After | Wall before → after | Peak RSS before → after | Decision |
|---|---|---|---|---|---|
| Lint | `eslint .` 9.39 | `oxlint` 1.86 | 7.8 s (25.4 s under heavier load) → 1.2 s | 606 MB → 239 MB | **Cut over** |
| Typecheck | `tsc --noEmit` 5.7 | `tsrs --noEmit --fast` 0.20.0 (oxc-project, Rust) | cold 10.6-11.2 s → 0.26-0.35 s; warm (tsc's incremental cache) 2.2-3.1 s → 0.10-0.25 s | cold 1,338-1,359 MB, warm 937-941 MB → 242-417 MB | **Cut over** (2026-10-28) |

## oxlint (replaces ESLint)

`npm run lint` runs `oxlint` with `.oxlintrc.json`; it replaced ESLint with the same rule set. Two things the config does on purpose: `no-undef` for `.js`/`.mjs` files comes from `oxlint-plugin-eslint` (the typecheck covers TS files), and `.js` files get `no-warning-comments` and `eslint-js/no-restricted-syntax` where oxlint's `ban-ts-comment` and `no-this-alias` run on TS only. No rule is type-aware, so `oxlint-tsgolint` is not needed.

## tsrs (replaces tsc for the typecheck)

`npm run typecheck` runs `tsrs`, oxc-project's Rust port of the TypeScript 7 checker, pinned at `0.20.0-ts7.1.0-beta` (2 days old when added, so it clears pnpm's release-age check without an exclusion). Both checkers list the same 1,743 files under `src`; seeded errors came out identical from both, file, line, column and code: five across three TS files (TS2322, TS2339, TS2344, one a `.tsx`), a `checkJs` error in `scripts/migration-plan.mjs` (reached through `src/lib/db.ts`) and a missing `@/` import (TS2307); main checks clean under both. TypeScript 7 removed `baseUrl`, so `tsconfig.json` drops it (`paths` were already relative; tsc 5.7 checks clean without it, and Vite's `resolve.tsconfigPaths` resolves `@/` without it). `typescript` 5.x stays installed: `scripts/check-boundaries.mjs` and `scripts/dup-scan.mjs` parse with its compiler API, and editors' language service uses it.

## Speed audit (2026-10-07)

Aim: shorter test, typecheck, build and deploy waits, and a faster game; bundle size for its own sake is not a goal. Numbers are
wall seconds on this 14-core WSL box under normal lane load (load average 5-14, logged with `LOADLOG` on every run), paired
and interleaved where the effect is small; "n" is the number of pairs.

### Adopted

| Item | Before | After | Measured | Side effects |
|---|---|---|---|---|
| Test file order (`scripts/run-tests.mjs`, `scripts/test-cost.json`) | `node --test` sorts files by path; the 204 s `world/survival-chase` starts last | the files in `test-cost.json` start first, longest first | 12 gate logs: 421-527 s (median 470 s), 637 s on a red run. Simulated from the same per-test costs: 479 s in path order (matches the gates), 331 s longest first, which is the floor (1325 CPU-s / 4) | none to the tests: same files, same one-process-per-file isolation, same spec output, summary lines and exit code (checked on a passing, a failing and a missing file). A stale table only costs speed; `--learn` rewrites it |
| tsc `incremental` (`.cache/tsc.tsbuildinfo`, ignored by git) | 6.4-9.3 s | cold 6.1 s, warm 1.8-1.9 s, after editing the hub file `vehicle/car.ts` 5.0 s | warm -75% | a cached error is reported again on the next run (checked with a seeded error: exit non-zero until fixed; the exit code is 1 on a warm run, 2 on the run that wrote the file) |
| Deploy: skip `corepack pnpm install` when `package.json`, the lockfile, the workspace file and `node -v` are unchanged (`state/deps-key`) | an install on every deploy | skipped | `npm ci` 8.9-9.6 s here with a warm npm cache vs 2.8-3.4 s for the whole `build:node`: 72% of the build phase. The VPS number is Main's | the key is removed before an install starts and written after it finishes, so a killed install is never trusted (10 stubbed cases in `.bench`, incl. failed and killed installs). The deploy log now prints the seconds of each phase |
| Rapier SIMD build (`@dimforge/rapier3d-simd` 0.19.3, same API) for the ragdoll world | plain wasm build | SIMD wasm build | Node A/B at the ragdoll's settings (4 dummies, 1/480 s steps), 10 interleaved process pairs: p50 0.159 -> 0.163 ms (unresolved), p90 0.623 -> 0.519 (SE 0.010), p99 0.747 -> 0.636 (SE 0.007), mean 0.311 -> 0.274 ms (-11.7%, SE 0.006); 221 of 221 tests in the 17 Rapier-touching files pass. V8 profile of the production build in Chromium, 3 s of sim at 1/120 s with render, 2 dummies tumbling, 2 interleaved pairs (n too small to resolve): Rapier wasm self time 33.0 -> 19.7 ms and 24.0 -> 13.1 ms, against 691 and 563 ms of three.js self time in the same profiles (4.8% -> 4.1% and 4.3% -> 3.7% of it); in this light scene Rapier is under 2.5% of the frame's CPU, so the gain there is about 0.04 ms a frame | the bits differ from the plain build, so reels with dummies or knocked props change (REPLAY bump); ragdolls are cosmetic (nothing reaches the sim or netplay). WebAssembly SIMD needs Chrome 91, Firefox 89, Safari 16.4: inside Vite's default target. The wasm is 52 KB larger |

### Measured, not adopted

| Item | Result | Verdict |
|---|---|---|
| Cache headers on `assets/**` | Nitro's Vite integration already sends `Cache-Control: public, max-age=31536000, immutable` on every file under `assets/` (the unmodified baseline build, 25 requests in a production browser run: all 25 carry it; the second visit takes 20 of 23 requests from the cache) | nothing to add |
| tsgo (`@typescript/native-preview` 7.0.0-dev.20260707.2) and `oxlint-tsgolint` | tsgo 1.0-1.1 s wall, 4.2 s CPU vs tsc 6.4-9.3 s, 11-14 s CPU (n = 5 pairs, load 14); same 4 diagnostics on 4 seeded errors; needed `baseUrl` out of tsconfig (TS 7 removed it). `oxlint --type-aware` finds nothing new (no type-aware rule is enabled); `--type-check` adds 2 false positives | both are Go (microsoft/typescript-go): the repo allows no Go. Superseded 2026-10-28 by tsrs (Rust; see above) |
| Node compile cache for the test children | user CPU of the 174 files' imports 184.8 -> 142.9 s warm (-23%); a cache filled from one worktree hits from another (209.9 -> 148.3 s); 15 MB | `capped` exports `NODE_COMPILE_CACHE` now, so nothing to add |
| Startup of a test file | 0.7-1.4 s CPU per file, 145-196 CPU-s per suite (11-13% of all test CPU). In a profile: amaro's type strip 21-24%, V8 module compile 10-12%, `new Track(...)` at module level 15-25% in track-heavy files | a strip cache would save about 35 CPU-s (9 s wall): not worth a loader hook |
| Why the slow files are slow | CPU profiles of `race-eject-false` and `reel-view`: `world/track.ts` ground queries are 30% / 16% of self time (`heightAt` 9.4%, `stampPath` 7%, `projectPath` 6%, `deckAt` 3%), `ai/race-ai.ts` `plan` 9%, Rapier-in-wasm 15% in reel-view; GC 1-1.5% | the cost is the sim itself, which is also the game's per-step cost: a sim-perf item, not a toolchain flag. GC is so small that `--max-semi-space-size` cannot help |
| Splitting the 209 s `it` in `survival-chase` | with longest-first the wall is already at the 4-slot floor | no |
| Test concurrency above 4 | one test process peaks at 430-630 MB, so 4 fit the 4 GB cap with room; 6 would sit at the cap | no |
| `oxlint --type-aware` | runs (0.6 s), finds nothing new: no type-aware rule is enabled | enabling rules is a policy change |
| `oxlint --type-check` as the typecheck | adds 2 false positives (`vite.config.ts` TS2578 x2) that tsc does not report | no |
| Minifier on the same unminified chunks (12 files, 2.26 MB min) | oxc (Vite's) 2,263,822 B, 0.28 s; terser (2 passes) +0.9%, 13.4 s; esbuild +1.3%, 0.56 s. Brotli: oxc 570,909, terser 565,891, esbuild 586,717 | keep oxc. Its `mangle.toplevel` and `compress.target` change nothing (ES module mode, nothing to lower) |
| Vite `build.target` | the default `baseline-widely-available` is Chrome 111, Edge 111, Firefox 114, Safari 16.4: all above ES2022, which is what the source is written in | nothing is lowered, nothing to gain |
| `define` dead-code removal of debug paths | `import.meta.env.DEV` is not used; `window.__crush` is unconditional and the probes need it in the built game | nothing to remove |
| Source maps in production | off by default; `.map` files are not served or compressed by Nitro | keep off |
| Brotli + gzip copies of public files (Nitro `compressPublicAssets`) | wire size: Rapier wasm 573 -> 420 KB, three 150 -> 122 KB, engine 185 -> 155 KB; build 3.4-3.6 -> 7.3-7.6 s wall (+4 s, +6.7 s CPU, 4 pairs) | size only: left off |
| Chunk split | the first-load set is `index` (React, router: 740 KB rendered), `preload-helper` (zod, 154 KB: the game's codec and matchmaking schemas need it too), `routes`, then `engine`/`three`/`rapier`/`lab` on game start. `lab` is code shared by `routes` and `engine`, not a lazy scene | no rarely used scene to split off |
| Skin kernel (`kernels/skin`) | the release profile already has opt-level 3, LTO, codegen-units 1, panic abort, strip. 10 interleaved process pairs x 5 reps x 240 frames of the 10-car pile-up, all variants bit-identical (one digest over all 300 runs): wasm vs JS skin -23.3% (-17.3 ms per 240 frames, SE 1.7); `wasm-opt -O3` -1.2% (SE 1.1), `-O4` +2.4% (SE 1.3), `+simd128` +1.5% (SE 1.6), both +0.1% (SE 1.4): not resolved. `wasm-opt -O3` makes the file 153 B smaller (2768 -> 2615), `+simd128` 91 B larger | no change: the loop is branchy gathers over short inner loops, nothing for SIMD to vectorize |
| Tyre hold in the skin kernel (`kernels/skin/src/tyre.rs`) | `--cpu-prof` of the city bench race (32 cars, 6 s warm then 20 s timed, nothing drawn), main and the lane run side by side on the loaded worker (load 14-22), drawn and sim hashes equal in every run. `liftSaggingTriangles` + `planGrid` own time on main 17.3 + 5.5 s of 125 s (18.1 %); with the kernel, `liftSaggingTriangles` + `planOver` inclusive (copies counted) 12.5 + 2.6 s of 117 s (12.9 %): sag -28 %, plan grid -53 %, both -34 %, the run's CPU 110.5 -> 101.5 s (-8 %); the pair before: -36 % together. 247k sag passes in the 20 s window, a third to a half of them ending at the early-out | kept: the module keeps nothing between calls (a pass copies about 115 KB in, 43 KB when it ends at the early-out), so no state leaks across races. The wasm sag pass is about half the JS pass's time (7.1 s against 13.4 s in the pair before); the rest of the kernel path is copies and the early-out's own loop |
| Tyre hold's lift in the skin kernel (`needOver`, `carryLift`, `cornersRose` as `need_over` / `carry_lift` / `corners_rose`, the pass loop driving them with the skin's points, lift and dirty marks resident in the arena from `loadHold` to one copy out) | same city bench race and probe as the row above, bit-identical (drawn and sim hashes equal in all 12 runs). 12 profile runs ABBA x3 on the loaded box (load 2.0-2.7) against the JS hold with `needOver` / `carryLift` / `cornersRose` already cut: the lift path (`liftSaggingTriangles` + `needOver` + `carryLift` + `cornersRose` inclusive) 6947 ms mean (6767-7131) in JS, `holdLift` inclusive 6819 ms (6727-6957) in the kernel: -128 ms, 0.4 % of the 34.5 s profile, inside the runs' spread; the run's CPU 33842 -> 34082 ms (+0.7 %). In the kernel `need_over` took 336 ms against the JS `needOver`'s 398 (34.6M points, bound by the `sqrt` chain either way), `carry_lift` 180 ms, and the one copy in per hold (`loadHold`, ~110 KB: points, welds, edges, lift, triangles) 290-366 ms, which is what the five per-pass copies of `sagPass` (297 ms) cost | not adopted. The JS hold is cut instead (`needOver` over the resting points, `carryLift` over words of `dirty`, `cornersRose` over one corner a point): needOver 1130 -> 379 ms, carryLift 640 -> 314 ms, cornersRose 220 -> 60 ms. A kernel hold would pay only with the edge tables kept placed between holds (content-keyed like `SkinTables`), which the no-state-between-calls rule above refuses |
| Tyre sag pass stops reading once a sample is not short (`sag_pass`: a sample's cell scan ends at the first triangle standing at the sample's own height; a triangle's record is filled when a sample first reads it) | same city bench race and probe as the rows above; counts over its 26 s: 165k passes past the look, 687 triangles and 180 in-grid samples a pass; the full scan met 566M filed entries and 302M in-box triangles, 218M of them after the sample already stood at its height, and built 113M records of which 14.2M were read before their sample settled; with the cut 162M entries, 84M in-box, 14.2M records. 4 profile runs ABBA (load 2.8-3.6), drawn and sim hashes equal in all | kept: `sag_pass` self 4882 / 4698 ms -> 1970 / 1986 ms (12.9 / 13.3 % -> 5.8 / 6.0 % of the profile); the sag functions together (`sag_pass`, `sag_look`, `plan_grid`, `loadPlan`, `planGrid`, `sagPass` self) 21.6 / 23.0 % -> 16.2 / 16.5 %. A sample's best height only rises while every corner height is finite (`sag_look` reports it: `LOOK_FINITE`; otherwise the pass reads on as the JS does), so a sample at its height cannot be left short. A scratch shadow of the full scan found 0 samples the cut stopped that the full scan would have lifted, over the probe (165,203 passes) and the parity scenarios (51,876 passes) |
| Tyre sag pass reads first the triangle that settled the sample a step back on its line (`sag_pass`, `read_triangle`) | same probe; the samples lie 5 across the tyre by 39 ahead, a step ahead is 1.75 cm, so neighbours on a line mostly share a triangle: 24.7M tries over the 26 s, 15.5M of them settled the sample (63 % of the 25.3M samples that settle; the scan settled the other 9.8M); parity scenarios 4.6M of 7.7M. 4 profile runs ABBA (load 3.1-4.7), drawn and sim hashes equal in all | kept: `sag_pass` self 2210 / 1980 ms -> 1499 / 1449 ms (5.4 / 5.8 % -> 4.4 / 4.3 % of the profile); the sag functions together 14.9 / 16.2 % -> 15.1 / 14.6 %. Replaying 236 captured loaded passes (real car skins from the probe): `sag_pass` 12.5 -> 9.8 us, the whole `sagPass` call 28.4 -> 23.9 us, results digest-equal. A hint that stands at the sample's height settles it as the scan would (the scan's best height only rises), so the sample is left as the full scan leaves it; the shadow of the full scan found 0 samples settled by a hint that the full scan would have lifted, over the probe (165,203 passes) and the parity scenarios (51,876 passes) |
| Tyre plan cell 3 cm -> 6 cm (`PLAN_CELL`, `tyre.rs` and `car-tyre-skin.ts`) | same probe. A sample reads every triangle whose plan box holds it, in triangle order, at any cell width (filing is by the box's cell range, the read floors alike), so the cell only sets how many boxes a sample tests. Replay of the captured passes, `plan_grid` 39.7 / 32.1 / 28.1 / 23.8 us and `sag_pass` 9.9 / 10.6 / 11.0 / 12.0 us at 3 / 4.5 / 6 / 9 cm. 4 profile runs ABBA (load 2.3-3.6), drawn and sim hashes equal in all | kept at 6 cm: `plan_grid` 1277 / 1276 ms -> 897 / 893 ms, `loadPlan` 744 / 796 -> 393 / 452 ms, `planGrid` (TS) 319 / 322 -> 212 / 214 ms, `sag_pass` 1520 / 1443 -> 1641 / 1679 ms; the sag functions together 15.0 / 15.0 % -> 13.5 / 12.4 % of the profile. Outputs bit-equal to the 3 cm grid: a scratch build ran every sag pass on both grids (one shared wasm, the cell set per call) and compared the return, `lift`, `dirty` and `sagRead` byte for byte: 0 mismatches in 201,845 probe passes (165,203 past the look, 65,526 lifting) and 59,992 parity passes (28,290 lifting); a brute-force count of the triangles whose box holds each sample against the grid's read (and its ascending order): 0 disagreements over 32.2M probe samples and 10.1M parity samples. The kernel's plan grid against the JS `planGrid` (`car-tyre-skin.test.ts`) is red with the kernel's cell alone at 5 cm |
| `vite-plus` 1.1.0 (VoidZero) | a `vp` CLI and package that bundles Vite (as an alias of their fork `@voidzero-dev/vite-plus-core`), Vitest 5, Oxlint 1.87, Oxfmt 0.72, tsgolint, Rolldown, tsdown and a cached task runner (`vp run`) behind one `vite.config.ts` | swaps `vite` for a fork and the test runner for Vitest across ~12 open lanes; no runtime effect. No |
| Engine voice cost (`public/audio/motor-worklet.js`, `GameAudio` voice slots) | desktop Chromium on this WSL box, `OfflineAudioContext` 10 s at rpm 4000, 1 voice vs 8 (about 0.7 s of each run is context and module setup): an I4 voice costs 129 ms per 10 s (1.3% of one realtime core), a V8 voice 341 ms (3.4%); 8 parked voices (rpm 0, silent fast path) render in 670 ms, no dearer than the setup alone. Six desktop voices are 8-20% of a core at worst. Phone: not measured (no reachable device; an insecure LAN page has no AudioWorklet either) | phone slots stay at 3 (the plan's range is 2-4): re-measure on a phone over HTTPS and set `PHONE_VOICES` in `game-audio.ts` to `clamp(floor(0.30 / per-voice share), 2, 4)` |

### Open

- A test-result cache keyed by the import closure would skip unchanged files outright; tests would have to be proven hermetic first.

## Test memory guards (2026-10-21)

A failing `node:assert` comparison of two big values (a texture, a geometry) took the whole WSL VM from 9 GB free to 0 in
18 s. Node builds the failure message by printing both sides whole (`maxArrayLength: Infinity`, one line per element) and,
for `strictEqual` / `deepStrictEqual`, diffing those lines with a trace that is a typed array per diff step: off the V8 heap,
so `--max-old-space-size` does not stop it (measured: heap held at 1315 MB of a 1536 MB cap while RSS climbed to 4 GB).

- **`scripts/assert-guard.mjs`**, imported first by every test process (`test-setup.mjs`, and `--import` in `test` /
  `test:parity`): when a comparison fails and its sides would print past `MAX_DIFF_LINES` lines (array elements, keys and
  long strings counted), the error carries a bounded print (`util.inspect`, 20 elements, depth 4) as its message, `actual`
  and `expected`. Covers `strictEqual` / `deepStrictEqual` of `assert/strict` (default and named imports) and `t.assert`;
  the other comparisons build no diff, and every `throws` / `rejects` in the repo checks a small value. Passing comparisons
  and failures on small values are Node's own: same message, fields and stack (checked on 25 small cases, identical with
  and without the guard). `scripts/assert-guard.test.mjs` pins it.
- **`--max-old-space-size=1536`** on every test process (`run-tests.mjs` `HEAP_MB`, `test`, `test:parity`): a runaway
  held on the heap aborts there. The heaviest of the 400+ suite files peaks at 711 MB of heap (`present/ground-overlap`).
- Failing compare of two objects holding a 4096² `Float32Array`, under a 2-3 GB memory cap: before, OOM-killed at the cap
  after 8-10 s on each of `assert.equal`, `deepStrictEqual` and `t.assert.deepStrictEqual`; after, each fails in 40 ms at
  184 MB RSS with a 2.7 KB report.

## Headless frame (`scripts/headless-frame.mjs`, 2026-10-21)

The real `CrashEngine` drawing in node, for shots, counts and link checks without a browser. `engine-headless.test-util.ts`
boots it; the script swaps in a real WebGL2 context (`@kmamal/gl` 10.0.0-2, a BSD-2 fork of headless-gl: ANGLE over the
host's GL), Skia canvases (`@napi-rs/canvas` 1.0.11) for the game's procedural textures, and the page's files from
`public/`. A pinned-seed derby 8 s past its start is drawn through the engine's own frame (`tickInner`, then `PostFX` at
the tier) and written as a PNG, with one JSON line on stdout. `--hash <share link #>` boots another scene instead (e.g.
`scene=garage&car=sedan`), `--camera radius,pitch,angle` frames the orbit camera by hand (readme-shots' `frame()`), and
`--at <s>` sets the sim seconds before the drawn frames. The counts are the last frame whole: the script holds
`renderer.info.autoReset` off and resets it before each drawn frame, as the bench does.

- **For:** shots and before/after diffs (`--root <other checkout>`: same seed, same clock, and three's object uuids draw from a stream of their own, so a tree that builds fewer objects does not move the cosmetic draws of the frame; two runs of one tree give
  byte-identical PNGs, and so do two checkouts of one commit), the frame's counts per tier (`renderer.info`: calls,
  triangles, programs, textures, geometries), and link checks: exit 1 on a program that fails to link or a GL error.
- **Not for:** frame-time verdicts; the browser is the perf judge ([`PERF_BENCH.md`](PERF_BENCH.md)). `yardstickMs`, a
  fixed full-screen shader synced by a 1 px read on a context of its own, only tells a GPU (0.35-0.49 ms at 1280x800 on
  the RTX 4080 Laptop through Mesa d3d12) from a CPU rasterizer (55 ms on llvmpipe); `renderer` names which.
- **GPU:** on WSL the script sets `GALLIUM_DRIVER=d3d12` when `/dev/dxg` exists, so Mesa reaches the GPU; elsewhere Mesa
  picks its own driver. No timer queries and no `KHR_parallel_shader_compile` (three warns once).
- **Install:** pnpm never runs `@kmamal/gl`'s install script (`allowBuilds: "@kmamal/gl": false` in `pnpm-workspace.yaml`),
  which downloads the native binary from GitHub releases: the Lux deploy installs dev dependencies too, and stays
  registry-only. Fetch the binary once per `node_modules` with `node node_modules/@kmamal/gl/scripts/install.mjs`; the
  script exits 2 with that line while it is missing. `@napi-rs/canvas` ships its binaries as npm packages.
- **Built-in ids count as attributes:** the bundled ANGLE (2.1.24078) counts `gl_VertexID` and `gl_InstanceID` against
  `MAX_VERTEX_ATTRIBS` (16), as some GLES drivers do; Chrome 149's ANGLE does not. The dummy's lit program once declared
  16 slots and read both, and failed to link here ("Too many attributes (print)"); its attributes are now packed to 14
  slots with `gl_InstanceID` (`ragdoll-mesh.test.ts` pins it), so dummies draw. A failed program that links once those
  built-ins read as 0 is listed under `builtinQuirk`, its meshes under `notDrawn`; every other failure is in `linkFailures`.
- **Cost:** about 11 s wall, 6.6 s of it to `ready`; runs inside a 2 GB memory cap.
