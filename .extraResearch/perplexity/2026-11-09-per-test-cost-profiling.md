> Question: In a large Vitest test suite, how can a team find out which individual tests and test files consume the most CPU time and the most memory, and what the time inside them is spent on? Cite documentation and examples.

Use a two-level approach:

1. **Find slow test files and individual tests with Vitest’s built-in timings.**
2. **Use Node.js CPU and heap profilers to determine what those tests spend time and memory on.**

## 1. Identify expensive test files and tests

Vitest prints the duration of each test file and each individual test:

```text
✓ test/prime-number.test.ts (1) 4517ms
  ✓ generate prime number 4517ms

Test Files  1 passed (1)
Tests       1 passed (1)
Duration    4.80s (transform 44ms, setup 0ms, import 35ms, tests 4.52s, environment 0ms)
```

The file and test durations reveal the initial “top offenders.” The summary also separates time into:

- `transform`: Vite transformation
- `setup`: `setupFiles`
- `import`: evaluating test files and dependencies, including test collection
- `tests`: executing test cases
- `environment`: creating environments such as JSDOM

[1]

For large suites, save the reporter output or run subsets of files so the team can sort durations and investigate the slowest files first. A high `tests` value indicates time spent in test bodies/hooks; a high `import`, `transform`, `setup`, or `environment` value indicates file-level overhead rather than an individual assertion.

Vitest’s performance guidance also notes that its duration phases may run in parallel workers, so their sum can exceed wall-clock duration. It reports phases as percentages to help identify whether the bottleneck is test execution, imports, transformations, setup, or environments.[2]

## 2. Profile CPU usage

Run Vitest through Node’s CPU profiler by adding Node options to `execArgv`:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    execArgv: [
      '--cpu-prof',
      '--cpu-prof-dir=test-runner-profile',
    ],
  },
})
```

Then execute the suite:

```bash
npx vitest run
```

Node writes a `.cpuprofile` file under `test-runner-profile`. Open it in Chrome or Chromium DevTools:

1. Open DevTools.
2. Go to **Performance**.
3. Load the `.cpuprofile` file.
4. Inspect the **Bottom-up** and **Call tree** views.

These views show which functions consume CPU and how their time is distributed through the call stack—for example, whether a slow test is spending time in application code, serialization, a mock, a database client, a matcher, or a setup hook.[1]

For a lower-level V8 profile, Node’s `--prof` option is also supported:

```ts
execArgv: [
  '--prof',
  '--logfile=test-runner-profile/v8.log',
]
```

Vitest documents `--cpu-prof`, `--heap-prof`, and `--prof` as the Node profiling options that can be passed to its test runner.[1]

## 3. Profile memory usage

Add Node’s heap profiler:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    execArgv: [
      '--heap-prof',
      '--heap-prof-dir=test-runner-profile',
    ],
  },
})
```

Run the suite:

```bash
npx vitest run
```

This produces a `.heapprofile` file. Load it in Chrome DevTools under **Memory** and inspect:

- Allocation call trees
- Retained objects
- Constructor types
- Allocation hotspots

Example configuration combining CPU and heap profiling:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    execArgv: [
      '--cpu-prof',
      '--cpu-prof-dir=test-runner-profile',
      '--heap-prof',
      '--heap-prof-dir=test-runner-profile',
    ],
  },
})
```

Vitest’s documentation states that the resulting files are typically `*.cpuprofile` and `*.heapprofile` files in the configured profile directory.[1]

This profiles the Node test-runner processes, so it is most useful after narrowing the run to the slow or memory-heavy files. For example:

```bash
npx vitest run test/parser.test.ts
```

or:

```bash
npx vitest run --testNamePattern="large input"
```

Profiling a focused subset makes the call tree easier to attribute to a particular test. When tests run concurrently, repeat the investigation with reduced worker parallelism if attribution is ambiguous; Vitest notes that additional workers increase both CPU and memory usage.[6]

## 4. Find slow imports and modules

If the summary shows that `import` dominates, enable import-duration collection:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    experimental: {
      importDurations: true,
    },
  },
})
```

This helps identify modules that take the most time to import and evaluate. It is particularly useful when every isolated test file repeatedly loads a large dependency graph or barrel file. Vitest’s performance documentation distinguishes import time from transform time: import time covers evaluating test files and modules, while transform time covers Vite’s module transformation work.[1][2]

## Practical workflow

- Run the full suite and record Vitest’s per-file and per-test durations.
- Sort or collect the slowest files and individual tests.
- Compare the summary phases: `tests`, `import`, `transform`, `setup`, and `environment`.
- Re-run the worst offenders with `--cpu-prof` and inspect the CPU call tree.
- Re-run memory-heavy offenders with `--heap-prof` and inspect allocation and retention.
- Enable `experimental.importDurations` when imports or test collection are the bottleneck.
- Temporarily reduce concurrency when worker contention or cross-test attribution makes profiles difficult to interpret.

This combination answers both **“which tests/files are expensive?”** and **“which functions, modules, hooks, or dependencies account for that cost?”**

[1] Profiling Test Performance | Vitest (https://vitest.dev/guide/profiling-test-performance.html)
[2] Improving Performance (https://vitest.dev/guide/improving-performance)
[3] benchmarks - vitest-dev - GitHub (https://github.com/vitest-dev/benchmarks)
[4] Testing in Practice | Guide | Vitest (https://main.vitest.dev/guide/learn/testing-in-practice)
[5] docs: add Profiling Test Performance guide by AriPerkkio · Pull Request #6555 · vitest-dev/vitest (https://github.com/vitest-dev/vitest/pull/6555/files)
[6] Parallelism | Guide (https://vitest.dev/guide/parallelism)
[7] Improving Performance - vitest - Tangled (https://tangled.org/vitest.dev/vitest/blob/7827363bdaeeb5d82d486f99b301dcea3a010568/docs/guide/improving-performance.md)
[8] feat: report the duration breakdown as percentages (#10820) · vitest-dev/vitest@c67d296 (https://github.com/vitest-dev/vitest/commit/c67d296f4)
[9] Test Run Lifecycle | Guide (https://vitest.dev/guide/lifecycle)
[10] Features | Guide | Vitest (https://vitest.dev/guide/features.html)
