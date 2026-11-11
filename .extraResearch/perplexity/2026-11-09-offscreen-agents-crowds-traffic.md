> Question: In open-world games with simulated pedestrians and traffic, how is the work for agents the player cannot see (behind buildings or outside the view) reduced, and how is their state brought back when they come into view without visible jumps, and in multiplayer without peers disagreeing? What has been measured? Cite sources.

The usual solution is **simulation LOD plus interest management**: agents near a player run detailed navigation, collision, animation, and avoidance; distant agents are represented by cheaper models, aggregate flows, scheduled updates, or compact “records.” When an area becomes relevant, the engine promotes those records back into full entities and reconciles elapsed time, then renders interpolated states rather than snapping directly to the new result.

## How off-screen work is reduced

- **Spatial relevance:** Divide the world into cells, streaming zones, or observer-centered interest regions. Only nearby entities receive full updates; remote entities may be unloaded or simulated coarsely.
- **Temporal LOD:** Run distant agents less often—e.g., scheduled “ticks” or time-compressed updates—instead of every frame.
- **Behavioral LOD:** Replace individual pedestrian decisions and collision avoidance with route progress, destination changes, aggregate traffic flow, or statistical population summaries.
- **Representation LOD:** Keep a compact state such as position along a road, route, speed, schedule, and random seed rather than a complete animated character. A documented traffic system, for example, turns out-of-range cars into dormant records that continue along the road network and wake at their current progress.[6]
- **No work when irrelevant:** Systems can omit crowd steps entirely when no agents need them, while using coarse steering or scheduled transitions for intermediate tiers.[4]

A useful architecture treats LOD as a property of each simulation system, with explicit operations such as **demote, summarize, fast-forward, promote, and materialize**.[2]

## Bringing agents back without a visible jump

The engine normally preserves a **canonical lightweight state** even when the visual entity is absent. On re-entry:

1. Determine elapsed simulation time.
2. Advance or reconstruct the compact state—route position, traffic-light phase, schedule, destination, and other persistent variables.
3. Promote it to a full pedestrian or vehicle.
4. Place it at a valid navmesh or road-network location and resolve overlaps.
5. Blend animation, velocity, camera-facing orientation, and sometimes position over a short interval.

Rendering is generally decoupled from simulation and interpolates between fixed-step states, which prevents a one-frame discontinuity even when simulation updates occur at different rates.[2] Hysteresis in zone assignment—requiring an agent to cross separate enter and exit thresholds—also prevents rapid repeated spawning and despawning at a boundary.[2]

This does not guarantee that an unseen pedestrian follows every microscopic event. Instead, games preserve the variables that matter when the agent becomes observable and reconstruct the rest plausibly. The documented dormant-car approach illustrates this principle: the car is not simply respawned at an arbitrary point; it wakes where its road-network progress says it should be.[6]

## Multiplayer consistency

Multiplayer adds a separate requirement: **the simulation must have one authority and a controlled replication policy**.

- A host or server usually owns authoritative pedestrian and traffic state.
- Clients receive only entities inside their interest areas, with update frequency based on relevance.
- State is sent as snapshots or deltas; unchanged objects need little or no bandwidth.[7][9]
- Clients interpolate received states and may predict short-term motion, but authoritative corrections reconcile disagreement.
- For deterministic or lockstep designs, all peers run the same fixed-step simulation from the same inputs and random seeds; state hashes or rollback can detect and repair divergence.[2][4]
- Ownership and interest management determine who simulates an entity and which peers need to know about it.[4]

Thus, two players can see different subsets of the population without creating two different worlds: the authoritative state remains shared, while each client materializes only the agents relevant to its own view. A host-authoritative traffic implementation, for example, transmits vehicle states at a higher rate while they change and a lower idle rate, rather than continuously sending full state at maximum frequency.[6]

## What has actually been measured

Public technical documentation tends to measure **system cost and network behavior**, not the perceptual quality of every hidden-agent reconstruction. Reported measurements include:

- **Network cadence and payload:** one traffic implementation reports roughly 20 Hz for changing vehicle state, 5 Hz while idle, and about 60 bytes per bus.[6]
- **Bandwidth reduction:** delta compression sends unchanged objects using minimal representation, while priority accumulation sends the most important states first under a packet budget.[9]
- **Determinism:** a simulation architecture describes fixed-step, seeded execution and continuous checks for identical state hashes across replays.[2]
- **Simulation scaling:** documented LOD plans distinguish full avoidance, coarse steering, scheduled transitions, and summarized records, with no crowd step when no agents require it.[4]
- **Streaming performance:** open-world streaming documentation attributes visible pop-in and hitches to memory and bandwidth limits and reports a measured 10.6-second stall on a test PC under a blocking streaming case.[10]

The key limitation is that these measurements do not establish a universal “no visible pop” threshold. Studios usually evaluate that through frame-time traces, entity counts, CPU time per simulation tier, memory use, network bandwidth, correction frequency, and user-facing tests for pop-in or rubber-banding. The general pattern is consistent: **simulate nearby agents precisely, summarize distant agents, preserve enough state to fast-forward them, and use authoritative or deterministic replication so promotion is a presentation event rather than a new random decision.**

[1] openOMSI/docs/ARCHITECTURE.md at main (https://github.com/openOMSI-org/openOMSI/blob/main/docs/ARCHITECTURE.md)
[2] game_engine/docs/adr/0010-deterministic-sim-and-lod-contract ... (https://github.com/marcmicalizzi/game_engine/blob/main/docs/adr/0010-deterministic-sim-and-lod-contract.md)
[3] gta5-under-the-hood/docs/performance/graphics-settings.md at main · Goodvibes74/gta5-under-the-hood (https://github.com/Goodvibes74/gta5-under-the-hood/blob/main/docs/performance/graphics-settings.md)
[4] game_engine/docs/plan/05-simulation.md at main · marcmicalizzi/game_engine (https://github.com/marcmicalizzi/game_engine/blob/main/docs/plan/05-simulation.md)
[5] gta5-under-the-hood/docs/entities/spawning/population.md at main · Goodvibes74/gta5-under-the-hood (https://github.com/Goodvibes74/gta5-under-the-hood/blob/main/docs/entities/spawning/population.md)
[6] openOMSI/docs/HISTORY.md at main (https://github.com/openOMSI-org/openOMSI/blob/main/docs/HISTORY.md)
[7] Godot-Open-World-Database/readme.md at main ... - GitHub (https://github.com/DigitallyTailored/Godot-Open-World-Database/blob/main/readme.md)
[8] openOMSI/crates/omsi-app/src/app.rs at main - GitHub (https://github.com/openOMSI-org/openOMSI/blob/main/crates/omsi-app/src/app.rs)
[9] coop-anything/playbook/networking.md at main · cranebeaker/coop-anything (https://github.com/cranebeaker/coop-anything/blob/main/playbook/networking.md)
[10] gta5-under-the-hood/docs/core/streaming.md at main · Goodvibes74/gta5-under-the-hood (https://github.com/Goodvibes74/gta5-under-the-hood/blob/main/docs/core/streaming.md)
