> Question: A Vitest suite's run summary attributes about 90% of its time to the tests themselves, which run CPU-bound simulation code, and about 9% to importing modules. What do projects do to reduce the cost of the tests themselves while keeping what they check? What has been measured? Cite sources.

If roughly 90% of the run is spent inside CPU-bound test bodies, import optimization will have little effect. The main opportunities are to **do less simulation work per test**, **move repetitive performance measurement out of correctness tests**, and **parallelize only when the workload scales well**.

## What projects commonly change

- **Use smaller, representative scenarios in the default suite.** Keep a few carefully chosen edge cases, boundary values, failure cases, and deterministic regression fixtures; move exhaustive combinations, large inputs, and long simulations to a slower scheduled or pre-release suite.
- **Replace repeated full simulations with targeted checks.** Test invariants, conservation rules, state transitions, and known outputs rather than rerunning the same expensive trajectory for many nearly identical inputs.
- **Use property-based testing with a bounded budget.** Generate many cases during dedicated runs, but use a fixed, relatively small number of examples for ordinary pull-request tests. Preserve failures by recording the random seed and minimizing/shrinking the failing input.
- **Precompute or fixture expensive inputs.** Generate large datasets once, serialize them, and test the implementation against stable fixtures instead of regenerating them in every test.
- **Use a faster reference model or oracle.** For simulation code, compare the optimized implementation against a simple model on small cases, while reserving large-scale accuracy checks for fewer tests.
- **Avoid duplicate coverage across layers.** If a behavior is already checked by a focused unit test, avoid repeatedly exercising it through many integration or end-to-end simulations.
- **Separate correctness from benchmarking.** Performance tests should use Vitest’s benchmark facilities or a dedicated benchmark job, rather than making every correctness test run many timed iterations. Vitest’s benchmark support reports operations per second, mean time, and percentiles, which is more appropriate for performance measurement than ordinary assertions.[6]
- **Profile the test body before changing architecture.** Vitest reports “tests” separately from importing, transforming, setup, and environment work; CPU profiling can produce `.cpuprofile` and heap-profile files for identifying hot functions.[1]
- **Parallelize test files when possible.** Increase workers or choose an appropriate pool if files are independent, but measure it: for CPU-bound workloads, scheduling and worker configuration—not import optimization—are the relevant variables.[3]

## What has been measured

Vitest’s own example reports a 4.80-second run divided into 4.52 seconds of test execution, 35 milliseconds of importing, and 44 milliseconds of transformation.[1] That is qualitatively similar to a suite where the test body dominates: reducing module imports cannot remove most of the elapsed time.

Vitest’s CPU-bound benchmark contains 30 files performing hashing, sieving, and matrix multiplication; its documentation says that because the tests dominate the run, changing scheduling parameters such as `maxWorkers` and the pool is what affects results.[3] The published benchmark shows only small version-level changes—for example, about 4% cold-run improvement in one comparison and roughly 2% warm-run improvement under Istanbul—so runner upgrades alone should not be expected to eliminate a test-body bottleneck.[3]

Vitest also documents that a high-CPU-count machine can encounter a main-thread bottleneck when the main thread must handle requests from many worker threads.[2] Consequently, “use more workers” is not universally beneficial: benchmark worker counts and pool choices on the project’s hardware, and cap them when contention or oversubscription makes each simulation slower.

The practical conclusion is that the largest measured gains usually come from reducing the amount of simulation performed in the default test set—fewer iterations, smaller fixtures, less duplication, and bounded generated cases—then using profiling and benchmarks to verify that the shortened suite still exercises the same behavioral invariants and regression boundaries.

[1] Profiling Test Performance | Vitest (https://vitest.dev/guide/profiling-test-performance.html)
[2] Improving Performance | Vitest (https://vitest.dev/guide/improving-performance.html)
[3] benchmarks - vitest-dev - GitHub (https://github.com/vitest-dev/benchmarks)
[4] docs: add Profiling Test Performance guide by AriPerkkio · Pull Request #6555 · vitest-dev/vitest (https://github.com/vitest-dev/vitest/pull/6555/files/999502d7b8df1360ca9bcc76d1616e64d0f1940d)
[5] Vitest 5.0 is out! | Vitest (https://vitest.dev/blog/vitest-5)
[6] Benchmarking | Guide | Vitest (https://main.vitest.dev/guide/benchmarking)
[7] vitest-tspack/docs/guide/profiling-test-performance.md at ... (https://github.com/yuechen-li-dev/vitest-tspack/blob/main/docs/guide/profiling-test-performance.md)
[8] Vitest (websites/main_vitest_dev) (https://context7.com/websites/main_vitest_dev)
[9] feat: report the duration breakdown as percentages (#10820) · vitest-dev/vitest@c67d296 (https://github.com/vitest-dev/vitest/commit/c67d296f4)
[10] benchmarks/README.md at main · vitest-dev/benchmarks (https://github.com/vitest-dev/benchmarks/blob/main/README.md)
