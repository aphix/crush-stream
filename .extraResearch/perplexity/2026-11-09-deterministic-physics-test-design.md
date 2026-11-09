> Question: How do physics-engine and game-engine projects design automated tests for simulation behaviour so that they stay fast and deterministic? What practices are documented, and with what results? Cite sources.

Physics- and game-engine projects generally keep simulation tests fast and deterministic by separating **headless, fixed-step replay tests** from slower stress and fuzz campaigns. The strongest documented pattern is: control every input and source of randomness, run without rendering, assert invariants or state hashes, and retain small failing scenarios for replay.

## Core practices

- **Use a fixed physics timestep.** Configure a constant \(dt\), rather than allowing frame rate or wall-clock timing to drive integration. This makes each run execute the same sequence of solver steps; the determinism study specifically recommends a fixed physics timestep and gives \(0.05\) seconds as an example setting in CARLA.[1][5]

- **Make inputs and actor paths explicit.** Hard-code actor paths or record input/event streams, assign stable identifiers, and replay the same scenario. The documented replay design is “input log + event log,” with CI comparing persistent-state hashes after replay.[1][3]

- **Run headlessly and accelerate time.** Omit rendering, audio, and UI so test workers spend their resources on simulation. A documented practice combines headless execution with fixed timesteps and accelerated time scales, reporting test speeds of roughly \(10\text{x}\)–\(100\text{x}\) real time.[2]

- **Control pseudo-randomness.** Seed random-number generators, keep engine and asset versions fixed, and control external conditions such as CPU/GPU load where possible. The determinism methodology treats each possible nondeterminism source as a separately varied experimental factor while holding the others constant.[1][5]

- **Compare meaningful state, not only screenshots.** Record transforms, velocities, orientations, contacts, events, or persistent-state hashes at fixed simulation times. Hash comparisons are useful for exact replay checks; tolerances are more appropriate when floating-point or platform differences make bitwise identity unrealistic.[1][2][3]

- **Assert invariants every tick.** Tests commonly detect NaNs and infinities, excessive energy or velocity, invalid transforms, broken joint limits, tunneling, and constraint explosions. Continuous invariant monitoring catches corruption near its source instead of only detecting a final bad position.[2]

- **Use analytical and reference benchmarks.** Physics-engine validation guidance recommends defining what is measured, identifying an analytical or reference solution, running the scenario, and exporting plots and results for review.[6]

- **Separate deterministic regression tests from fuzzing and soak tests.** Small replay tests run on every build; randomized perturbations and long-duration scenarios run in dedicated jobs. Physics fuzzing can mutate valid initial states and use forward/backward simulation oracles to find erroneous behavior.[8]

## What results have been documented?

- In a controlled game-engine determinism study, fixing engine settings, actor paths, timing, and resource conditions reduced the maximum observed trajectory deviation to **0.98 cm**, within the study’s \(1\)-cm target.[1]

- The same study recommends repeating experiments multiple times, increasing sample size empirically, and recording timestamped positions and engine/resource metrics so variance can be measured rather than assumed to be zero.[1][5]

- In physics-engine fuzzing, a seed-scheduling method increased the number of uncovered errors by **30%–40% typically**, with a maximum reported improvement of **195%**; scheduling overhead was usually minutes compared with fuzzing campaigns lasting hours to dozens of hours.[8]

- Long-running soak tests are used for failures that short deterministic replays miss, including drift, stale collision state, and performance degradation over many hours. One documented approach runs unattended scenarios for **24–72 virtual hours** while monitoring collision pairs, spatial queries, and performance.[2]

## Practical test layout

A useful CI split is:

1. **Per-commit unit and micro-simulation tests:** tiny scenes, fixed seed, fixed \(dt\), headless execution, invariant assertions.
2. **Replay regression tests:** recorded inputs/events, deterministic state or hash comparison, stored failure artifacts.
3. **Tolerance-based cross-platform tests:** compare trajectories and energies within explicit tolerances rather than requiring identical floating-point bits.
4. **Nightly fuzz tests:** mutate valid states and inputs, retain seeds and minimal reproductions.
5. **Nightly or release soak tests:** run long scenarios while tracking NaNs, contacts, constraints, memory, and timing.

The key design distinction is that **determinism is an experimental property to verify**, not merely a configuration claim: repeat the same scenario, measure variance, isolate one nondeterminism source at a time, and define acceptable tolerances for the target platform.[1][5]

[1] [2104.06262] On Determinism of Game Engines used for ... - ar5iv (https://ar5iv.labs.arxiv.org/html/2104.06262)
[2] Automated Physics Stability Testing in Games - game-development (https://salivity.github.io/game-development/article/automated-physics-stability-testing-in-games)
[3] game_engine/docs/plan/05-simulation.md at main · marcmicalizzi/game_engine (https://github.com/marcmicalizzi/game_engine/blob/main/docs/plan/05-simulation.md)
[4] Know Your Bugs: A Survey of Issues in Automated Game Testing ... (https://iris.polito.it/bitstream/11583/2989151/1/1570998348%20final%20(1).pdf)
[5] On Determinism of Game Engines Used for Simulation-Based ... (https://research-information.bris.ac.uk/ws/portalfiles/portal/331516996/Full_text_PDF_final_published_version_.pdf)
[6] Validation toolbox for a Physics Engine - Umeå University - DiVA ... (https://umu.diva-portal.org/smash/get/diva2:935814/FULLTEXT01.pdf)
[7] Characterizing Virtual Reality Software Testing (https://arxiv.org/html/2211.01992)
[8] PhyFu: Fuzzing Modern Physics Simulation Engines (https://ar5iv.labs.arxiv.org/html/2307.10818)
[9] POLITECNICO DI TORINO (https://webthesis.biblio.polito.it/27719/1/tesi.pdf)
[10] [PDF] Automated Testing of Robotic and Cyberphysical Systems (http://reports-archive.adm.cs.cmu.edu/anon/isr2021/CMU-ISR-21-105.pdf)
