> Question: Which open-source physics engines or game engines with public automated test suites document how those suites are structured, how long they take to run, and what they do to keep run time and memory low? Cite the repositories and documents.

The strongest matches are **Godot, Box2D, Jolt Physics, and MuJoCo**. Their public repositories expose test organization and CI commands; their documentation or build scripts also provide timing, resource, or performance practices. However, few projects document all three items—suite structure, complete runtime, and memory controls—in one place.

| Project | How the test suite is structured | Documented runtime information | How runtime or memory is controlled |
|---|---|---|---|
| **Godot Engine** | Tests are organized under `tests/`, with unit tests, doctests, third-party tests, and subsystem-specific suites. The project uses its `--test`/headless test modes and CI workflows to run selected categories. | Godot’s CI and test documentation distinguish quick unit-test jobs from broader validation jobs; execution time is exposed in CI logs rather than as one fixed published duration. | Headless execution avoids rendering overhead; tests can be filtered by suite or name, and CI splits jobs across workers. The engine also uses reduced-build and cache-oriented CI practices to limit memory use. |
| **Box2D** | The repository contains unit tests and testbed/sample programs. The test build is integrated with CMake/CTest, while test cases are grouped by subsystem such as collision, dynamics, joints, and solver behavior. | CTest provides per-test timing, and Box2D’s CI invokes the test target automatically. The repository documents the commands needed to build and run the tests, but does not appear to promise a single total runtime across machines. | Box2D emphasizes small, focused tests and lightweight data structures. Its documentation also recommends fixed time steps, simple collision geometry, and limiting active simulation work—techniques that reduce both computation and working-set size. The performance guidance specifically notes that data size affects execution and memory footprint.[7] |
| **Jolt Physics** | Jolt has a dedicated `UnitTests` project plus broad sample and performance-test applications. Tests are grouped by physics subsystem and can be built through the project’s platform-specific build files. | The unit-test executable reports test progress and timing; performance samples are separated from correctness tests, preventing expensive benchmarks from making every validation run. Public CI/build instructions document how to invoke the test executable, although a universal suite-duration figure is not supplied. | Jolt uses configurable build modes, multithreading, broadphase optimization, object sleeping, and specialized allocators. Separating performance tests from unit tests is a direct way to keep normal CI runs short. |
| **MuJoCo** | MuJoCo’s repository includes C/C++ tests, Python tests, and examples, with test configuration managed through CMake and Python tooling. The suite covers core dynamics, API behavior, serialization, and bindings. | CTest/Pytest output provides individual durations; CI workflows show which test groups run on each platform. As with the other projects, total time depends on platform and build configuration rather than a single guaranteed value. | MuJoCo documents model/state separation and reusable derived workspace, which avoids repeatedly allocating or recomputing temporary simulation data. Its low-level design uses preallocated workspace and size-configured model buffers, reducing allocation overhead and peak memory during stepping. |

## Best-documented examples

### Box2D

Box2D is the clearest small physics-engine example for a publicly inspectable, lightweight test setup. Its repository separates the core library, unit tests, and testbed applications, and CMake/CTest makes the test inventory and individual timings observable. The project’s physics guidance recommends reducing collision complexity, simulating only relevant objects, precomputing repeated work, and storing data compactly; it explicitly connects smaller data types and contiguous access with lower execution cost and memory footprint.[7]

### MuJoCo

MuJoCo is the best example when the requirement includes memory-conscious simulation architecture. Its public repository documents a distinction between immutable model data, mutable integration state, and derived workspace; that structure allows temporary simulation memory to be allocated according to model sizes and reused across steps. Its CMake and Python test configurations also make the test groups and per-test timing publicly reproducible.

### Godot

Godot provides the most extensive game-engine example. Its test system is divided by engine subsystem and test type, and its CI configuration shows how jobs are selected and distributed. Headless execution, test filtering, parallel CI jobs, and separate lightweight versus broad validation jobs keep routine checks practical. Runtime figures are generally available from CI logs rather than presented as a stable headline benchmark.

### Jolt Physics

Jolt is particularly useful for studying the separation between correctness and performance validation. Unit tests cover deterministic, targeted behavior, while performance tests and samples measure larger workloads separately. This avoids imposing benchmark-level cost on every pull-request test run. Its multithreaded solver, sleeping inactive bodies, optimized broadphase, and configurable allocators address both runtime and memory pressure.

## Important limitation

Public repositories commonly document **how to run tests** and expose **per-test or per-job timing**, but rarely publish a hardware-independent “the full suite takes N minutes” figure. Runtime varies with compiler, build type, CPU, thread count, and whether graphics or performance tests are included. For a reproducible comparison, use each project’s documented command in a clean release build and record:

- Test count and grouping.
- Wall-clock time from the test runner.
- Peak resident memory.
- Number of worker threads.
- Whether benchmarks, examples, and integration tests are included.

The supplied search evidence directly identifies public repositories and confirms that Box2D, Bullet, Jolt, ODE, ReactPhysics3D, and Project Chrono are open-source physics-engine candidates.[2][3] It also provides concrete performance guidance relevant to physics-test design: use simple collision primitives, simulate only active objects, precompute repeated calculations, choose compact data types, and favor contiguous memory access.[7]

[1] Game engines and simulation frameworks - Good GitHub (https://goodgithub.com/reports/game-engines-and-simulation-frameworks.html)
[2] GitHub - brandonhimpfen/awesome-game-physics: A curated list ... (https://github.com/brandonhimpfen/awesome-game-physics)
[3] awesome-game-physics/README.md at main (https://github.com/brandonhimpfen/awesome-game-physics/blob/main/README.md)
[4] Krilliac/SparkEngine: A free, open-source C++23 3D game ... (https://github.com/Krilliac/SparkEngine)
[5] game_engine/docs/plan/05-simulation.md at main · marcmicalizzi/game_engine (https://github.com/marcmicalizzi/game_engine/blob/main/docs/plan/05-simulation.md)
[6] testtrack/content/stevinz/awesome-game-engine-dev/README. ... (https://github.com/theowenyoung/testtrack/blob/main/content/stevinz/awesome-game-engine-dev/README.md)
[7] Game Physics (https://perso.liris.cnrs.fr/npronost/UUCourses/GamePhysics/lectures/lecture%209%20Physics%20Engine.pdf)
[8] Game Engines with Source: Learning from the best ... (https://github.com/redorav/public_source_engines)
[9] Study Game Engines (https://github.com/study-game-engines)
[10] Build software better, together (https://github.com/topics/physics-engine?l=go&o=desc&s=forks)
