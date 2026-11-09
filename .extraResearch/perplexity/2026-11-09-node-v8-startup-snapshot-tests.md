> Question: Many test files in a Node.js 24 test suite each repeat the same expensive setup before their assertions run. What ways exist to avoid paying that setup cost again in every file or worker process, and what are each one's limits? Cite documentation and measurements.

The main choices are **one process for all files**, **one-time global setup plus per-worker communication**, or **moving the expensive work outside Node’s test runner**. They trade isolation and correctness for startup savings.

## 1. Disable process isolation

Run:

```bash
node --test --test-isolation=none
```

With process isolation disabled, all matching test files execute in the current process rather than one child process per file.[1][2]

This lets top-level module initialization and an ordinary singleton run once:

```js
// expensive-fixture.js
export const fixture = await buildExpensiveFixture();
```

Every test file importing that module can reuse the same in-process module instance, provided the module cache is not deliberately bypassed.

**Limits**

- Tests share globals, module state, environment variables, mocks, timers, open handles, and other mutable state.
- A test that mutates shared state can affect later tests, making ordering and cleanup important.
- A failing or crashing test can affect the whole process.
- It is unsuitable when files require genuine process isolation.
- The documentation states that the default is process isolation, where each test file runs in a separate child process; `--test-isolation=none` changes that to one process.[1][4]

This is usually the largest direct saving when the setup is pure or safely resettable.

## 2. Use `globalSetup` and `globalTeardown`

Node 24 supports a setup module selected with:

```bash
node --test --test-global-setup=./test/global-setup.mjs
```

The module may export `globalSetup` and `globalTeardown`; `globalSetup` runs once before tests and teardown runs once after all tests.[1][4]

Use it for shared **external resources**, for example:

```js
// global-setup.mjs
export async function globalSetup() {
  const server = await startServer();
  process.env.TEST_SERVER_URL = server.url;

  return async function globalTeardown() {
    await server.close();
  };
}
```

**Limits**

- It does not magically share JavaScript objects across isolated child processes. A database connection, server, or fixture created in the setup process must be made reachable through an external interface, environment variables, files, sockets, or another IPC mechanism.
- Per-file imports and top-level initialization still occur in each isolated worker.
- Setup failure prevents tests from running, and teardown is only useful if the resource can be represented and cleaned up across the process boundary.[1]
- A shared external database or server introduces cross-test interference unless tests isolate their data.

This is the best built-in option for “start one server/database/container once,” but not for directly sharing an in-memory object.

## 3. Keep process isolation but use an external persistent fixture

Create the expensive artifact once in global setup, then let each test process connect to it. Typical examples include:

- A temporary database schema or database server.
- A local HTTP service.
- A generated fixture directory.
- A Unix/TCP socket service.
- A cache or content-addressed artifact keyed by configuration.

The test workers receive only a connection string, path, or identifier. This preserves process isolation while amortizing the expensive construction.

**Limits**

- Serialization, IPC, network/database access, locking, and cleanup add overhead.
- The shared resource must support concurrent clients.
- Per-test mutable state still needs transactions, namespaces, snapshots, or explicit reset.
- A single shared resource can become a contention bottleneck, so “setup once” does not necessarily mean “fastest.”

Node’s runner can execute files concurrently, with the maximum number of child processes controlled by `--test-concurrency`.[2][3] Thus a shared resource must be safe for that concurrency level.

## 4. Run related tests in one file

If isolation between files is not required, combine many test cases into a single test file. The file’s top-level setup then runs once, while `node:test` subtests organize the cases.

This avoids file-level worker startup and makes a shared fixture straightforward.

**Limits**

- It reduces isolation and can make failures or ordering dependencies harder to diagnose.
- A test file is still executed as one script/application thread; the runner’s file-level concurrency does not split tests inside that file into separate application threads.[4]
- Large files can reduce parallelism, so this may lose time when tests themselves are CPU- or I/O-parallelizable.

## 5. Cache or precompute the setup artifact

Instead of sharing a live object, make setup reproducible and cacheable:

- Generate a fixture once and reuse it by content hash.
- Build a database snapshot once, then restore or clone it.
- Persist compiled output or downloaded data in a CI cache.
- Use copy-on-write filesystem snapshots where available.

This works with either isolation mode because each worker can load the same artifact.

**Limits**

- Loading or cloning still costs time.
- Cache invalidation must account for Node version, platform, dependencies, configuration, and fixture version.
- A mutable live object cannot safely be reused merely by caching its serialized form.
- CI workers or containers may not share the cache unless it is explicitly persisted.

## 6. Use a custom coordinator or worker pool

A coordinator process can create the expensive resource once and expose operations to test workers through IPC, HTTP, or a database. Alternatively, tests can be scheduled into a smaller number of long-lived worker processes.

Node documents that process-isolated test files receive worker IDs and that `--test-concurrency` controls the number of concurrent workers.[1][4] Those mechanisms can help size a coordinator’s connection pool or namespace allocation.

**Limits**

- This is custom infrastructure, not a transparent shared-memory fixture.
- IPC protocol design, lifecycle management, retries, and failure propagation become test-framework code.
- A coordinator can serialize requests and erase the benefit of parallel execution.
- Worker processes are still separate V8 heaps; ordinary JavaScript references cannot cross them.

## Practical selection

| Requirement | Prefer | Main limitation |
|---|---|---|
| Tests can safely share state | `--test-isolation=none` | Weak isolation |
| One server/database/container per run | `globalSetup`/`globalTeardown` | Objects are not shared across processes |
| Strong file isolation plus amortized infrastructure | Global setup plus external service | IPC/contention/reset complexity |
| Deterministic immutable data | Precomputed or cached artifacts | Cache invalidation and load cost |
| Maximum simplicity | Combine tests into fewer files | Less parallelism and isolation |

## Measurements to make

Measure at least these configurations on the same machine and concurrency:

```bash
time node --test --test-isolation=process
time node --test --test-isolation=none
time node --test --test-isolation=process --test-global-setup=./test/global-setup.mjs
```

Also measure cold and warm runs, because module and artifact caches can make the second run misleading. Record:

- Total wall-clock time.
- Setup time per file and total setup time.
- Peak CPU and memory.
- Number of worker processes.
- External-service startup time.
- Test execution time after setup.
- Cleanup time.

The Node documentation confirms the relevant execution models—separate child processes by default versus one process with `--test-isolation=none`—but the search results do not provide a controlled benchmark quantifying the savings for a particular suite.[1][2][4] Consequently, the correct choice depends on whether the repeated cost is process startup, module initialization, external-resource creation, or fixture generation; each responds to a different strategy.

[1] nodejs.org › release › v24Test runner | Node.js v24.19.0 Documentation (https://nodejs.org/download/release/v24.19.0/docs/api/test.html)
[2] Node.js — Run JavaScript Everywhere (https://nodejs.org/api/test.json)
[3] Test runner | Node.js v26.13.0 Documentation (https://nodejs.org/api/test.html)
[4] Test runner | Node.js v24.18.0 Documentation (https://nodejs.org/download/release/v24.18.0/docs/api/test.html)
[5] Isolation and concurrency · Cloudflare Workers docs (https://developers.cloudflare.com/workers/testing/vitest-integration/isolation-and-concurrency/)
[6] Using Node.js's test runner (https://nodejs.org/learn/test-runner/using-test-runner)
[7] Node.js 24 (LTS) - What's New, Support Lifecycle & EOL (https://versionlog.com/nodejs/24/)
[8] Worker threads | Node.js v26.12.0 Documentation (https://nodejs.org/api//worker_threads.html)
[9] Benchmark runner | Node.js 26.12.1 Documentation (https://beta.docs.nodejs.org/bench)
[10] nodesource.com · pages · content-node-performance-report-wbFull Content: The Node.js Performance Report - NodeSource (https://nodesource.com/pages/content-node-performance-report-wb.html)
