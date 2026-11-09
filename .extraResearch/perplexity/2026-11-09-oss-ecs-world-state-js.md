> Question: A browser game written in TypeScript with three.js (WebGL2) and the Rapier physics engine (WASM) has a small open-world city: a few hundred simulated pedestrians with homes, jobs, moods and daily schedules (simulated deterministically on a host and synced to multiplayer peers), about 30 traffic cars on a street graph with traffic lights, police, building interiors, and instanced street props, running on desktops and phones. Which open-source libraries exist in JavaScript or TypeScript for organising game world state and per-frame logic (entity component systems, state machines, behaviour trees, utility AI, deterministic simulation and netcode helpers)? For each: what it does, licence, how maintained it is, and measured performance where published. Cite sources.

For this project, the strongest architecture is usually **ECS for high-volume simulation**, **state machines for explicit lifecycle modes**, and either **utility AI or behaviour trees for pedestrian decisions**. Deterministic simulation and rollback should be treated separately from rendering and Rapier, because Rapier/WASM physics may not provide identical results across all browsers and platforms.

## ECS and world-state libraries

| Library | What it does | Licence | Maintenance / performance |
|---|---|---|---|
| **bitecs** | Minimal, data-oriented TypeScript/JavaScript ECS using typed arrays; suitable for hundreds of pedestrians, cars, schedules and spatial queries. | MIT | Widely used and relatively mature, but verify current repository activity before adopting. Published benchmarks have historically measured very high entity-operation throughput, though results depend heavily on component layout and query shape. |
| **Miniplex** | Lightweight TypeScript ECS with ergonomic entities, components, queries and relations. Easier to integrate than a fully opinionated engine. | MIT | Actively used in the Three.js ecosystem; performance is generally intended for gameplay-scale ECS rather than maximum data-oriented throughput. |
| **ECSY** | Entity-component-system framework originally associated with Mozilla/Three.js-oriented web games. | MIT | Mature but largely maintenance-oriented compared with newer ECS options. Good API and integration history, but less attractive for a new performance-critical simulation unless its API is preferred. |
| **ecsy-three** | Three.js integration layer for ECSY, connecting ECS entities to Three.js objects. | MIT | Useful when ECS entities directly represent render objects; less necessary when simulation and rendering are deliberately separated. |
| **ESEngine** | TypeScript ECS plus optional behaviour trees, finite-state machines, timers, AI and networking modules. | MIT | The project describes itself as high-performance and engine-agnostic, supporting Cocos, Laya, Phaser, PixiJS and other engines.[1] Public search results did not expose a trustworthy standardized benchmark, so test it against bitecs or Miniplex with your workload. |
| **Lagless** | Deterministic TypeScript ECS for multiplayer, with state stored in a preallocated `ArrayBuffer`, snapshots, rollback/resimulation and deterministic math packages. | Confirm the repository/package licence before adoption | Particularly relevant to deterministic host/client simulation. Its documentation describes rollback, late-join transfer, reconnect testing and cross-client divergence hashing.[3] Public results did not provide a comparable entities-per-second benchmark. |

**Practical choice:** use **bitecs** for maximum control and data-oriented simulation, **Miniplex** for a more ergonomic general-purpose ECS, or **Lagless** if rollback and deterministic state replication are central requirements. ESEngine is appealing if one integrated framework is preferable to composing separate libraries.

## State machines and orchestration

| Library | What it does | Licence | Maintenance / performance |
|---|---|---|---|
| **XState** | Finite-state machines, hierarchical statecharts, actors, event-driven orchestration, guards, timers and visual modelling. Suitable for pedestrian modes such as `AtHome`, `Commuting`, `Working`, `Shopping`, `Fleeing` and `Arrested`. | MIT | Mature and actively documented. XState is explicitly a JavaScript/TypeScript state-management and orchestration library.[2][7] It prioritizes correctness and modelling over raw per-frame throughput; do not create one heavyweight actor with extensive subscriptions for every pedestrian unless profiling supports it. |
| **javascript-state-machine** | Small finite-state-machine implementation with transitions, guards and lifecycle hooks. | MIT | Lightweight and stable, appropriate for compact stateful gameplay objects. Less suitable than XState for hierarchical schedules or complex concurrent workflows. |
| **ESEngine FSM** | FSM module included in the broader ESEngine framework. | MIT | Convenient if ESEngine is already used; benchmark and inspect module activity as an integrated dependency.[1] |

For hundreds of agents, store the active state as an ECS component or integer enum and reserve XState for **complex supervisory workflows**, debugging tools or player/police systems. A hand-written transition table will usually be cheaper for simple per-agent modes.

## Behaviour trees

| Library | What it does | Licence | Maintenance / performance |
|---|---|---|---|
| **mistreevous** | JavaScript/TypeScript behaviour-tree construction and execution library for game AI. | Verify repository licence | Public repository listings show roughly 145 stars, indicating meaningful community visibility, but stars are not a maintenance metric.[4][6] No reliable standardized benchmark was found. |
| **fluent-behavior-tree** | TypeScript/JavaScript fluent API for composing selectors, sequences, conditions and actions. | Verify repository licence | Smaller project; public listings show roughly 73 stars.[4][6] Suitable for simple agent logic, but assess recent commits, open issues and TypeScript compatibility before depending on it. |
| **AsyncBehaviorTree** | Behaviour trees emphasizing asynchronous actions, useful for workflows that wait on events or promises. | Verify repository licence | Public listings show limited adoption; asynchronous execution should not be placed directly in a deterministic fixed-tick simulation without carefully controlling completion order.[6] |
| **ESEngine Behaviour Tree** | Behaviour-tree module integrated with ESEngine and its visual tooling. | MIT for ESEngine | Useful when the accompanying ECS/FSM/editor workflow is valuable.[1] No independent benchmark was exposed. |

Behaviour trees are a good fit for **police investigation, emergency response and scripted civilian reactions**. For hundreds of pedestrians, evaluate trees only on scheduled decision ticks—for example, 2–10 times per second—instead of rebuilding or traversing every tree every render frame.

## Utility AI

There is no single dominant, mature, widely benchmarked TypeScript utility-AI package comparable to XState. Common options include small GitHub packages implementing scores, considerations, curves and action selectors, but their licences and maintenance vary substantially.

For this city simulation, a compact in-house utility layer is often safer:

```ts
type Consideration = (agent: Agent, world: World) => number;
type Action = {
  score: Consideration[];
  execute(agent: Agent, world: World): void;
};

function utility(action: Action, agent: Agent, world: World): number {
  return action.score.reduce((product, score) =>
    product * Math.max(0, Math.min(1, score(agent, world))), 1);
}
```

Evaluate actions such as `goToWork`, `goHome`, `eat`, ` fleePolice` and `socialise` at decision intervals, seed any random tie-breaking, and store the selected action in deterministic ECS state. This avoids adding an unverified dependency and makes replay testing straightforward.

## Deterministic simulation

| Library / approach | What it does | Licence | Maintenance / performance |
|---|---|---|---|
| **Lagless** | Deterministic ECS, rollback, snapshots, deterministic math and multiplayer synchronization. | Confirm current package licence | The most directly aligned option found: its documentation states that simulation state resides in a preallocated `ArrayBuffer` and that late inputs trigger rollback and resimulation.[3] It provides determinism tests involving seeded randomness, entity lifecycle, late joins and divergence hashes.[3] No independent throughput benchmark was published in the available result. |
| **deterministic-math libraries** | Replace platform-sensitive floating-point math with deterministic implementations, often for trigonometry and seeded randomness. | Varies | Useful for lockstep simulation, but deterministic math alone does not make physics, iteration order, timers or serialization deterministic. Lagless identifies a WASM deterministic-math package in its stack.[3] |
| **Custom fixed-tick simulation** | Integer or fixed-point positions, seeded PRNG, stable entity ordering, explicit input logs and periodic state hashes. | Your project licence | Usually the most controllable option. Keep rendering interpolation, Three.js objects and effects outside the authoritative state. |

A host-authoritative design can avoid full lockstep: the host simulates schedules and moods, sends compact state changes or snapshots, and clients interpolate. If peers must independently reproduce the city, use fixed ticks, deterministic PRNG streams per subsystem, stable iteration order, integer or fixed-point gameplay quantities, and hash-based divergence checks.

## Multiplayer and netcode helpers

| Library | What it does | Licence | Maintenance / performance |
|---|---|---|---|
| **Colyseus** | Authoritative multiplayer server framework for JavaScript/TypeScript with rooms, state synchronization, matchmaking and client SDKs. | MIT | Mature and widely adopted in browser multiplayer. It is a strong fit for a host-authoritative city, though bandwidth and serialization costs depend on schema design. |
| **Nakama JavaScript/TypeScript client** | Client integration for an authoritative multiplayer backend, matchmaking, presence, storage and RPC. | Apache-2.0 for the server; check SDK terms | Better suited when backend services, accounts and matchmaking matter; less lightweight than a bespoke WebSocket host. |
| **PeerJS** | WebRTC data-channel abstraction for peer-to-peer connections. | MIT | Useful for transport prototyping, but it does not provide deterministic simulation, rollback, state replication or authority rules. |
| **Yjs / Automerge** | Conflict-free replicated data types for collaborative state. | MIT for Yjs; Automerge uses an open-source licence—verify the current version | Excellent for collaborative documents and eventually consistent metadata, but generally inappropriate for authoritative real-time physics or traffic simulation. |
| **Lagless netcode** | Simulation-oriented synchronization with rollback, snapshots and deterministic state transfer. | Confirm current package licence | More directly aligned with lockstep/rollback than generic networking libraries; available results describe reconnect, late join and divergence testing.[3] |

For the described game, **Colyseus or a custom WebSocket protocol** is appropriate for host-authoritative state replication. Use a compact schema: pedestrians should generally replicate identifiers, coarse positions/velocities, current schedule state and exceptional events—not every internal mood variable every frame.

## Published performance evidence

The available search results expose few apples-to-apples benchmarks. One deterministic multiplayer case study reports simulation timings of roughly **26.5–58.2 microseconds per tick on V8** and **21.7–36.9 microseconds per tick on JavaScriptCore**, depending on the tested build and simulation version.[10] Those figures are for that specific simulation, not a general ECS benchmark.

ESEngine is described as high-performance but the available result does not show a reproducible benchmark methodology or comparative numbers.[1] Lagless documents determinism and rollback tests but does not expose a comparable throughput figure in the available result.[3] GitHub star counts for behaviour-tree projects indicate visibility, not speed or maintenance quality.[4][6]

## Recommended combination

- **Simulation data:** bitecs or Lagless.
- **Schedules:** deterministic tick-based schedule system using integer time-of-day and seeded events.
- **Simple agent modes:** ECS enum/state-transition tables.
- **Complex workflows:** XState for police, missions, interiors and scripted sequences.
- **Pedestrian decisions:** utility scoring evaluated periodically; behaviour trees for exceptional or reactive behaviours.
- **Networking:** host-authoritative snapshots/events through Colyseus or a custom protocol.
- **Determinism:** fixed tick, stable ordering, seeded PRNG, explicit quantization/fixed-point values, state hashes and replay tests.
- **Rendering:** Three.js instances and interpolation as a separate presentation layer, never as the authoritative world state.

Before committing, benchmark a representative workload—300 pedestrians, 30 cars, traffic-light updates, schedule transitions and snapshot serialization—on desktop Chrome, mobile Safari and mobile Chrome. This will be more meaningful than generic ECS benchmark numbers because query density, allocations, Rapier calls and network serialization will dominate the actual frame budget.

[1] ESEngine - High-performance TypeScript ECS Framework for ... (https://github.com/esengine/esengine)
[2] Quick start - Stately.ai (https://stately.ai/docs/quick-start)
[3] @lagless/physics-shared 0.0.48 on npm - Libraries.io - Libraries.io (https://libraries.io/npm/@lagless%2Fphysics-shared)
[4] behaviour-trees · GitHub Topics (https://github.com/topics/behaviour-trees)
[5] xstate - UNPKG (https://app.unpkg.com/xstate@5.32.5/files/README.md)
[6] Build software better, together (https://github.com/topics/behavior-tree?l=typescript)
[7] XState - Stately.ai (https://stately.ai/docs/xstate)
[8] JavaScript (https://bryan-guner.gitbook.io/my-docs/javascript/untitled)
[9] behavior-trees · GitHub Topics (https://github.com/topics/behavior-trees)
[10] How to protect JavaScript game source code: a multiplayer case study (https://www.afterpack.dev/blog/protect-javascript-game-source-code)
