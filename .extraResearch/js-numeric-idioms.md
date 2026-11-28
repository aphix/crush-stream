# Number idioms in hot loops: what V8 and SpiderMonkey make of them

Asked by the owner (2026-11-27): are there cheap low-level number forms, like asm.js's `~~x`, that would speed the sim's loops? Measured here in both engines, with
two Perplexity answers as leads (`perplexity/2026-11-27-js-numeric-idioms-jit.md`, `perplexity/2026-11-27-js-negative-zero-nan-jit.md`).

## Measured (this repo, 2026-11-27)

`node .extraResearch/js-numeric-idioms.bench.mjs` (V8, Node 24.15) and `~/.jsvu/bin/spidermonkey .extraResearch/js-numeric-idioms.bench.mjs` (SpiderMonkey 162, installed
with `npx jsvu --os=linux64 --engines=spidermonkey`; no sudo). Each form is its own loop over the same 1,048,576-element input for its category, best of 15 runs, ns per element. The
inputs are random, so a data-dependent branch mispredicts about half the time: that is what the 4 ns rows are.

| Operation | Form | V8 | SpiderMonkey | Same answer? |
|---|---|---|---|---|
| NaN test | `x !== x` | 1.08 | 0.86 | |
| | `Number.isNaN(x)` | 0.98 | 0.80 | yes |
| | `isNaN(x)` | 0.83 | 0.63 | coerces a non-number |
| -0 to +0 | none (baseline sum) | 0.42 | 0.42 | |
| | `x + 0` | 0.48 | 0.41 | yes: free |
| | `x === 0 ? 0 : x` | 0.97 | 0.71 | yes |
| Toward zero | `Math.trunc(x)` | 0.48 | 1.64 | |
| | `x \| 0`, `~~x`, `x >> 0` | 0.86-1.06 | 0.59-0.81 | only inside ±2^31; NaN and ±Infinity become 0 |
| Floor, x ≥ 0 | `Math.floor(x)` | 1.28 | 1.01 | |
| | `x \| 0` | 0.98 | 0.76 | only for 0 ≤ x < 2^31 |
| Floor as an index | `t[Math.floor(x)]` | 1.10 | 0.82 | |
| | `t[x \| 0]` | 0.86 | 0.64 | only for 0 ≤ x < 2^31 |
| Round, x ≥ 0 | `Math.round(x)` | **5.89** | 0.78 | |
| | `(x + 0.5) \| 0` | 0.89 | 0.67 | only for 0 ≤ x < 2^31 (and not 0.49999999999999994) |
| Max | `Math.max(a, b)` | 4.62 | **0.87** | |
| | `a > b ? a : b` | 4.31 | 4.09 | differs on NaN and ±0 |
| Min | `Math.min(a, b)` | 4.39 | **0.58** | |
| | `a < b ? a : b` | 4.12 | 3.87 | differs on NaN and ±0 |
| Clamp to 0..1 | `Math.min(1, Math.max(0, x))` | 4.84 | **0.67** | |
| | `x < 0 ? 0 : x > 1 ? 1 : x` | 4.37 | 4.40 | differs on NaN |
| Absolute value | `Math.abs(x)` | **0.50** | **0.43** | |
| | `x < 0 ? -x : x` | 3.78 | 3.53 | differs on -0 |
| Sign | `Math.sign(x)` | 4.97 | 4.01 | |
| | `(x > 0) - (x < 0)` | **1.27** | **0.95** | 0 where `Math.sign` gives -0 or NaN |
| | `x > 0 ? 1 : x < 0 ? -1 : 0` | 4.24 | 3.86 | same caveat |
| Length | `Math.hypot(x, y)` | 14.72 | 10.63 | |
| | `Math.sqrt(x * x + y * y)` | 1.42 | 1.31 | last bit may differ; overflows where hypot does not |
| To float32 | `Math.fround(x)` | 0.68 | 0.52 | |
| Square | `x * x`, `x ** 2`, `Math.pow(x, 2)` | 0.43 | 0.42 | all the same code |
| x mod 8, x ≥ 0 | `(x \| 0) % 8` / `(x \| 0) & 7` | 1.20 / 1.03 | 1.02 / 0.85 | yes |
| x / 8 floored, x ≥ 0 | `Math.floor(x / 8)` / `(x \| 0) >> 3` | 1.15 / 0.95 | 0.85 / 0.64 | for ints in range |

## What it means for this repo

- **Never hand-roll abs, min, max or a clamp with a ternary.** `Math.abs` is 7-8 times faster in both engines; `Math.min`/`Math.max` are 4.7-6.7 times faster in
  SpiderMonkey and 6-11 % slower in V8, wherever the data does not predict the branch: the SpiderMonkey gain is far larger than the V8 loss.
- **`Math.hypot` stays banned** in hot code (8-10 times the cost of the square root; `CODING_STANDARDS.md` already says so, and the kernel's `hypot2`/`hypot3` give
  every engine the same bits). No use is left in game code outside tests (`check:boundaries` C6 enforces it); one remains in `touch-steer.tsx`'s pointer handler,
  which is not hot, plus some in offline scripts.
- **`Math.sign` costs four times `(x > 0) - (x < 0)`** in both engines; the cheap form answers 0 for -0 and NaN. 98 uses outside tests: one in the JS skin
  fallback's per-vertex wrinkle branch (`streamed-deform.ts:628`, not run when the WASM kernel is loaded), none in a hot path otherwise (the busiest:
  `car-drive.ts` 7, per car per step: about a microsecond a frame). Not worth a sweep; use the cheap form in a new hot loop.
- **`Math.round` is 6.6 times slower than `(x + 0.5) | 0` in V8 only**, and the cheap form is right only for 0 ≤ x < 2^31. 279 uses outside tests, mostly bench
  text, net codecs and one-off builds. Same verdict.
- **`x | 0` for a floor** buys 0.2-0.3 ns and is wrong for negatives: `surfaces.ts` floors signed world coordinates 68 times, so it stays `Math.floor`.
- **NaN tests are all the same cost**; `x !== x` and `Number.isNaN(x)` are both fine. **`x + 0` clears a -0 for free.**
- **-0 and NaN are not a deopt source here.** V8 has the reasons (VERIFIED: `V(LostPrecisionOrNaN, "lost precision or NaN")`, `V(MinusZero, "minus zero")`,
  `V(NaN, "NaN")` in `src/deoptimizer/deoptimize-reason.h`, v8 346c5c56), but `--trace-deopt` over a 20 s 22-car race logged 0 "minus zero", 0 "NaN", 11-12
  "lost precision" and 49 "not a Smi" against 857 OSR exits and 680 wrong maps.

So there is no further win from number forms in today's hot paths: the expensive builtins were already out of them. The table is the rule for new hot code.

## Perplexity's answers (leads; nothing in them was measured)

- General advice matching the table: use `Math.abs`/`floor`/`min`/`max` directly; `| 0`, `>> 0`, `>>> 0` are 32-bit conversions asm.js used to state a type, not a
  rounding; `Math.imul` exists for C-like 32-bit multiply (MDN, cited); `Math.hypot` does more work than a square root. NOT VERIFIED beyond the deopt reasons above:
  its statements about what each compiler inlines are not tied to a source line.
- Contradicted by the measurement: "`Math.round` usually inlines to a short sequence" (5.9 ns in V8) and "`Math.sign` may inline to comparisons" (4-5 ns in both).
- It names no published measurement of these forms in current engines.
