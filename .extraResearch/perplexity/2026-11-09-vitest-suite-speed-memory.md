> Question: A Vitest test suite of about 620 TypeScript files on Node 24 runs physics-simulation tests and takes about 28 minutes on 4 workers (about 6000 CPU-seconds). How do projects make suites like this faster and lighter on memory? What has been measured, and with what results? Cite sources.

A 28-minute run consuming about 6,000 CPU-seconds is spending roughly **10 CPU-seconds per wall-clock second**. With four workers, that suggests substantial CPU-bound work, worker overhead, or both—not merely slow test discovery. The highest-value approach is to measure the breakdown first, then reduce simulation work and avoid unnecessary process/isolation overhead.

## What projects typically change

### 1. Profile the test phases before changing worker count

Vitest reports separate timings for transformation, setup, collection, tests, environment setup, and worker preparation. In one Vitest comparison, `threads` took 16.17 seconds versus 28.68 seconds for `forks`; most of the difference was collection and preparation rather than test execution itself.[1]

For this suite, capture at least:

- Per-file wall time and CPU time
- Time spent in `collect` versus `tests`
- Number of tests and simulations per file
- Peak RSS for the parent and each worker
- Garbage-collection time
- Queue utilization: whether workers are continuously busy
- Duplicate module initialization and physics-world construction

If `tests` dominates, optimize the simulation. If `collect`, `prepare`, or `environment` dominates, optimize the test runner configuration and file structure.

### 2. Use worker threads instead of child processes when compatible

Vitest documents that `threads` runs tests in worker threads, while `forks` uses child processes; `forks` is generally more compatible with native modules and problematic process behavior, but can be slower for larger projects.[2] The Vitest performance guide specifically notes that `forks` may be slightly slower than `threads` on large suites.[3]

A reasonable benchmark matrix is:

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    pool: 'threads',
    maxWorkers: 4,
    isolate: true,
  },
})
```

Compare it against:

```ts
pool: 'forks'
pool: 'threads'
pool: 'vmThreads'
pool: 'vmForks'
```

Do not assume more workers are faster. For CPU-heavy physics, four workers may already saturate the machine. More workers can increase context switching, memory pressure, and cache contention.

### 3. Try VM pools only after measuring memory behavior

Vitest’s VM pools can reuse compiled scripts across contexts, which may reduce startup and transformation overhead. However, VM contexts can retain memory; when `vmMemoryLimit` is reached, workers are recycled. Vitest notes that repeated VM teardowns can accumulate and slow remaining workers, while `vmForks` can reclaim memory more completely when the child process exits.[4]

For a large suite, test:

```ts
pool: 'vmThreads',
vmMemoryLimit: '512MB'
```

and:

```ts
pool: 'vmForks',
vmMemoryLimit: '512MB'
```

The better choice depends on whether the suite is dominated by startup overhead or by retained simulation state. A VM pool is not automatically lighter: physics engines, native bindings, large typed arrays, and module-level caches can make retained contexts expensive.

### 4. Reduce test isolation only for genuinely clean tests

Disabling isolation can substantially reduce worker setup and module reinitialization, but it is safe only if tests reliably reset all mutable state. A third-party monorepo benchmark reported the following for 1,000 tests:

| Configuration | Average time | Peak RSS |
|---|---:|---:|
| `threads`, isolation enabled | 42.5 s | 850 MB |
| `threads`, isolation disabled | 14.2 s | 380 MB |
| `forks`, isolation enabled | 54.1 s | 1.4 GB |
| Single thread | 22.8 s | 290 MB |

These are not universal results, but they illustrate the possible magnitude: roughly **3× faster and 55% lower peak RSS** when isolation is removed in a suite that can safely share workers.[5]

Use it selectively:

- Put pure deterministic unit tests in a no-isolation project.
- Keep tests involving global state, timers, native resources, or singleton physics engines isolated.
- Split configurations rather than weakening isolation across the entire repository.

### 5. Make the physics tests cheaper

For CPU-bound simulations, runner tuning cannot compensate for unnecessarily expensive scenarios. Common reductions include:

- Test a small number of simulation steps in unit tests.
- Use fewer bodies, particles, contacts, solver iterations, or substeps.
- Move long stability and convergence runs to a separate integration/performance suite.
- Replace repeated full-world setup with reusable fixtures where safe.
- Test collision/contact algorithms with focused unit cases rather than full scenes.
- Use deterministic seeds and record/replay trajectories.
- Assert sampled invariants instead of comparing every timestep.
- Avoid allocating vectors, matrices, contact objects, or snapshots inside inner loops.
- Reuse typed-array buffers and object pools.
- Keep debug rendering, logging, tracing, and expensive assertions disabled.
- Avoid serializing complete worlds on every assertion.

A useful split is:

- **Fast correctness suite:** small worlds, short runs, every commit.
- **Regression suite:** representative scenarios, run on pull requests or a schedule.
- **Stress/performance suite:** long simulations, benchmarked separately.

### 6. Reduce TypeScript and module overhead

For test execution, avoid invoking a full type-check for every run. Run Vitest’s fast transpilation path during tests and run `tsc --noEmit` separately in CI. Also reduce repeated setup work:

- Keep global setup minimal.
- Avoid importing large application barrels from every test.
- Import focused modules instead of package-wide entry points.
- Cache or prebuild stable test fixtures.
- Use a lightweight Node environment rather than `jsdom` unless browser APIs are required.
- Group very tiny tests so that hundreds of files do not each pay setup and module-loading costs.

Vitest’s own benchmark work shows that large isolated suites can benefit materially from runner improvements: a 1,280-module “enterprise monolith” improved from 7.24 seconds to 5.83 seconds, a **19% reduction**; a long-running DOM suite improved by **25%**; and a CPU-bound suite improved by **8%** in the cited version comparison.[6] These results indicate that runner overhead matters, but a 28-minute physics workload is likely dominated by simulation unless profiling shows otherwise.

### 7. Use project-level sharding rather than excessive local parallelism

If the suite is consistently CPU-bound, run independent shards across CI machines:

```bash
vitest run --shard=1/4
vitest run --shard=2/4
vitest run --shard=3/4
vitest run --shard=4/4
```

Each machine should use a worker count appropriate to its physical cores and memory. Sharding often scales better than increasing workers inside one process because it avoids severe contention and gives each shard a bounded memory budget.

## A practical experiment plan

Run the same fixed test subset under these configurations and record wall time, total CPU time, peak RSS, and failures:

| Trial | Pool | Isolation | Workers |
|---|---|---:|---:|
| A | `forks` | enabled | 1, 2, 4, 8 |
| B | `threads` | enabled | 1, 2, 4, 8 |
| C | `vmThreads` | enabled | 1, 2, 4 |
| D | `threads` | disabled | 1, 2, 4 |
| E | best runner configuration | enabled | reduced simulation size |

Interpretation:

- Wall time falls nearly linearly with workers: parallelism is available.
- CPU time rises sharply with workers: contention or duplicated work is limiting scaling.
- RSS rises linearly with workers: reduce workers, use threads, or shard.
- `collect`/`prepare` dominates: change pool, imports, setup, or file granularity.
- `tests` dominates: optimize the physics workload and allocations.
- No-isolation helps dramatically: split clean unit tests from stateful tests.
- VM pools are fast initially but RSS grows: impose a memory limit or prefer `vmForks`/threads.

The most likely high-impact combination for this workload is **shorter physics scenarios, fewer allocations in the simulation loop, `threads` rather than `forks` if native compatibility permits, and separate low-cost unit tests from long-running physics regressions**. The available published measurements show that pool choice can range from modest gains to large differences, while removing safe isolation can produce multi-fold improvements—but only suite-specific measurements can establish which effect dominates here.[1][3][5]

[1] benchmarks - vitest-dev - GitHub (https://github.com/vitest-dev/benchmarks)
[2] pool | Config | Vitest (https://vitest.dev/config/pool)
[3] benchmarks/README.md at main · vitest-dev/benchmarks (https://github.com/vitest-dev/benchmarks/blob/main/README.md)
[4] Vitest vs Jest vs node:test in 2026: Benchmarked on a Real TypeScript Project (https://dev.to/fabwaseem/vitest-vs-jest-vs-nodetest-in-2026-benchmarked-on-a-real-typescript-project-4bj5)
[5] Improving Performance | Vitest (https://vitest.dev/guide/improving-performance.html)
[6] Vitest 5.1 is out! (https://vitest.dev/blog/vitest-5-1)
[7] Vitest 5.0 is out! (https://vitest.dev/blog/vitest-5.html)
[8] Vitest Monorepo Unit Testing & Performance Optimization ... (https://www.locionic.com/en/blog/vitest-monorepo-unit-testing-performance)
[9] Why Vitest? (https://cookbook.marmicode.io/angular/testing/why-vitest)
[10] perf: improve performance of forks pool by sheremet-va · Pull Request #5592 · vitest-dev/vitest (https://github.com/vitest-dev/vitest/issues/5592)
