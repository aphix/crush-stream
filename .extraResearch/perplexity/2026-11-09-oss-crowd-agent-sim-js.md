> Question: A browser game written in TypeScript with three.js (WebGL2) and the Rapier physics engine (WASM) has a small open-world city: a few hundred simulated pedestrians with homes, jobs, moods and daily schedules (simulated deterministically on a host and synced to multiplayer peers), about 30 traffic cars on a street graph with traffic lights, police, building interiors, and instanced street props, running on desktops and phones. Which open-source libraries, engines or reference projects exist for simulating many autonomous agents (pedestrians, traffic) in JavaScript or TypeScript, for behaviour selection, schedules, needs, steering, path following, crowd avoidance or traffic? For each: what it does, licence, how maintained it is, and whether it runs in a browser or Web Worker. Cite sources.

For this architecture, the strongest approach is usually to combine a **deterministic simulation layer**—schedules, needs, utility scores, traffic rules—with specialized libraries for **behavior trees, pathfinding, steering, and local avoidance**. The JavaScript ecosystem has useful pieces, but few mature, all-in-one “The Sims plus traffic” engines.

## Most relevant projects

| Project | Best fit | Licence | Maintenance | Browser / Worker |
|---|---|---|---|---|
| **Behavior3JS** | Behavior trees for pedestrians, police, service workers, and vehicles; supports reusable trees and JSON serialization | MIT | The upstream repository appears largely inactive, with its latest visible activity dating to 2015[3] | Plain JavaScript; browser-compatible. It should be usable in a Worker if the application avoids DOM APIs |
| **CrowdSim** | 2D crowd simulation and low-level crowd-agent behavior | Licence should be checked in the repository before adoption | Very old project: the visible repository activity dates to 2014[9] | Designed as a web application and therefore browser-oriented; Worker use would require checking its module and rendering assumptions |
| **PathFinding.js** | Grid-based A*, Dijkstra, BFS, best-first search, and related navigation for pedestrians or vehicles | MIT | The original project is mature but relatively old; an actively maintained fork also appears in search results[6] | Explicitly supports Node.js and browsers[6]; suitable for a Worker because pathfinding is computationally isolated |
| **@cetfox24/pathfinding-js** | TypeScript grid pathfinding with BFS, Dijkstra, and A* | Licence should be verified in its repository/package metadata | Described as an early-stage TypeScript library, so it is less established[10] | Node/npm and browser-oriented; likely Worker-compatible if bundled without DOM dependencies |
| **@crowdedjs/behavior-tree-js** | Fluent behavior trees for decision logic | Licence should be verified from package metadata | Search metadata reports a recent package update, but the visible result does not establish long-term project health[1] | JavaScript package; appropriate for browser code and likely Workers if it has no DOM dependency |
| **Three.js traffic-simulation projects** | Reference implementations for traffic lights, road networks, cars, pedestrians, and Three.js visualization | Varies by repository | Quality varies substantially. The TypeScript traffic-simulation topic includes small experimental projects as well as more substantial simulators[4] | Generally browser-based; Worker suitability depends on whether simulation and rendering are separated |

### Behavior3JS

Behavior3JS is particularly relevant for **qualitative decisions**: choosing “go to work,” “eat,” “sleep,” “flee,” “investigate,” or “respond to a traffic signal.” Its documentation specifically describes using one behavior-tree instance to control hundreds of agents and supports saving/loading trees as JSON[3].

It is not a schedule, needs, navigation, or steering system. A practical integration would be:

- Host-owned deterministic daily schedule selects the current goal.
- A utility or rule layer selects the immediate intention.
- Behavior3JS executes the intention.
- A separate navigation layer supplies the route.
- Rapier handles physical contacts only where physical simulation is needed.

Because the project is old, it is better treated as a stable reference or vendored dependency than as a foundation expected to receive active fixes[3].

### CrowdSim

CrowdSim is a JavaScript 2D crowd simulator with a low-level simulation library and a web demo[9]. It may be useful for studying simple crowd movement or extracting ideas, but its age makes it a poor default for a modern TypeScript/WebGL2 production game.

It also should not be confused with a complete pedestrian AI system: the search result identifies it as a crowd simulator, not a package providing schedules, needs, animation, semantic goals, or production navigation meshes[9].

### PathFinding.js

PathFinding.js is the most immediately useful listed component for a small city with a street graph or tiled pedestrian navigation layer. It targets web games and explicitly runs in both Node.js and the browser[6].

Good uses include:

- Computing pedestrian routes over a low-resolution sidewalk graph.
- Computing vehicle routes over a road graph.
- Running expensive or infrequent route searches in a Web Worker.
- Caching routes by origin, destination, and graph revision.
- Replanning only when a route becomes invalid.

It is a **global path planner**, not a local avoidance system. It will not by itself prevent two pedestrians from occupying the same space, model lane-following, obey traffic lights, or produce natural steering.

### TypeScript pathfinding alternatives

The TypeScript `pathfinding-js` project provides common graph-search algorithms and TypeScript types, but its own description characterizes it as early-stage[10]. It may be convenient if type safety and a small API matter more than ecosystem maturity.

For a deterministic multiplayer simulation, the critical issue is less the particular A* implementation than deterministic ordering:

- Use stable node IDs.
- Tie-break equal-cost nodes consistently.
- Avoid unordered object-key iteration in simulation-critical decisions.
- Quantize or integerize costs where possible.
- Keep route calculation authoritative or verify route requests on the host.

## Traffic and city references

The search results show a TypeScript traffic-simulation category containing projects with Three.js, OpenStreetMap data, cars, trams, buses, bicycles, pedestrians, traffic signals, and agent-based models[4]. These are valuable as **reference implementations**, especially for:

- Road-network representation.
- Signal phases.
- Vehicle-following logic.
- Multimodal movement.
- Three.js visualization.
- Separating simulation state from rendering.

However, the result describes a collection of repositories rather than one established library, and many entries are small experiments[4]. Licence, determinism, performance, and maintenance must therefore be checked individually before copying code.

A browser driving-simulator example also advertises AI traffic, traffic lights, a generated city, and mobile controls[7]. Such projects are useful for integration patterns but generally should be treated as gameplay demonstrations rather than reusable simulation engines unless their repository exposes a clean, documented simulation API.

## What is missing from the JavaScript ecosystem

None of the listed projects appears to provide all of the following as a mature TypeScript package:

- Needs and mood modeling.
- Daily schedules and interruptions.
- Goal selection or utility AI.
- Navigation meshes.
- Local pedestrian avoidance.
- Vehicle car-following and lane changing.
- Traffic-light compliance.
- Deterministic lockstep or host-authoritative synchronization.
- Web Worker-ready simulation orchestration.
- Three.js animation and instancing integration.

For that reason, a custom layered design is likely more maintainable than trying to adapt a general-purpose “agent engine.”

## Recommended stack for this game

- **Schedules and needs:** custom deterministic finite-state or utility system.
- **Behavior selection:** Behavior3JS or a small custom utility/behavior-tree implementation; Behavior3JS supports hundreds of agents conceptually but is old[3].
- **Global pedestrian and vehicle routing:** PathFinding.js or a custom A* implementation over your existing sidewalk and street graphs[6].
- **Pedestrian local motion:** custom grid/spatial-hash neighborhood queries plus simple separation, obstacle avoidance, and route-corridor following.
- **Traffic:** custom lane graph, signal state machine, car-following model, and reservation/priority rules.
- **Physics:** keep Rapier for collisions and selected dynamic bodies, rather than using it as the planner for every pedestrian.
- **Workers:** run route searches, schedule advancement, and low-frequency crowd updates in Workers; keep rendering, Three.js objects, and most WebGL state on the main thread.
- **Networking:** synchronize discrete decisions and compact state—current goal, route ID/version, lane/edge, schedule phase, mood seed—rather than continuously synchronizing every steering vector.

For a few hundred pedestrians and approximately 30 cars, this hybrid approach should be considerably simpler and more deterministic than adopting a full continuous crowd solver.

[1] crowdedjs/behavior-tree-js (https://www.npmjs.com/package/@crowdedjs/behavior-tree-js)
[2] Three.js - GitHub (https://github.com/threejs)
[3] GitHub - behavior3/behavior3js: Behavior3 client library for Javascript (Behavior Trees for Javascript) (https://github.com/behavior3/behavior3js/)
[4] traffic-simulation (https://github.com/topics/traffic-simulation?l=typescript&o=desc&s=updated)
[5] a2aproject/a2a-js: Official JavaScript SDK for the ... (https://github.com/a2aproject/a2a-js)
[6] GitHub - goldenJet/PathFinding.js: A comprehensive path-finding library for grid based games (https://github.com/goldenJet/PathFinding.js)
[7] driving-simulator · GitHub Topics (https://github.com/topics/driving-simulator?l=javascript&o=desc&s=stars)
[8] BehaviorTree (https://github.com/BehaviorTree)
[9] Jacq/crowd-sim (https://github.com/Jacq/crowd-sim)
[10] GitHub - Casper64/pathfinding-js: A library for pathfinding ... (https://github.com/Casper64/pathfinding-js)
