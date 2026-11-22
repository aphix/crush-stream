> Question: Developers of open-world and crowd-heavy games (city or town settings) have given talks and written postmortems on how they made their streets feel alive with ambient pedestrians: what the pedestrians do, how they react to the player and to events, how many are simulated or drawn, and what it cost on their target hardware. What do those sources say, with what numbers? Cite the talks (GDC vault etc.), papers and postmortems.

The sources point to a consistent architecture: **simulate a relatively small, high-fidelity bubble around the player; represent the rest with cheaper animation, navigation, or impostors; and use schedules and event rules to create the impression of a persistent population.** However, the available search results contain few game-specific primary sources with verified console/PC budgets, so the numerical evidence below distinguishes game-development reports from academic crowd-rendering benchmarks.

## What the systems generally simulate

- **Local navigation and avoidance.** Real-time crowd systems commonly preprocess the environment into navigation graphs, plan individual trajectories, and divide characters into rendering tiers ranging from billboards to animated meshes. One published system reports real-time crowds of up to **35,000 pedestrians** using this approach.[6]

- **Level-of-detail representation.** Crowd-rendering research separates close actors from distant ones: nearby pedestrians use full geometry and animation, while distant actors use simplified meshes, point representations, or image-based impostors. A hybrid geometry/impostor system maintained interactive frame rates for crowds of up to **30,000 individuals**.[4]

- **Time-sliced or rule-based population simulation.** The search results for *Kingdom Come: Deliverance* describe the practical solution as combining time-slicing, world-state management, and rules that make characters appear persistent without running every NPC at full fidelity continuously.[1] The result does not provide a verified NPC count or hardware budget, so it should be treated as a qualitative summary rather than a quantified postmortem.

- **Spatial activation around players.** The OpenMW/Open-world population documentation gives an explicit example of a player-centered activation model: it targets pedestrians within **65 m** of each player, with configurable limits of **200 walkers near one player**, **600 walkers per zone cluster**, and **16,000 active walkers across a server**.[2] These figures describe that project’s multiplayer population system, not necessarily the original single-player game.

## Quantitative results from papers

| Source | Reported scale | Reported performance or cost |
|---|---:|---|
| *Real-time navigating crowds: scalable simulation and rendering* | Up to **35,000 pedestrians** | Real-time performance using navigation preprocessing, scalable simulation, and three visual-fidelity tiers.[6] |
| Dobbyn et al., *Geopostors* | Up to **30,000 individuals** | Interactive frame rates; distant people use impostor representations layered over full geometric characters.[4] |
| GPU crowd-simulation paper | **20,000 agents** | Stable **60 FPS or more** on a “mid-range” personal computer, according to the result summary.[3] |
| Open-world population documentation | **200 walkers within 65 m** of one player; **600 per cluster**; **16,000 active walkers** globally | Configuration limits for a server-owned civilian population.[2] |
| Open-world multiplayer stress profile | About **25,000 server entities**: **11,500 walkers**, **13,200 seated entities**, and **300 players** | Mean server tick of **8.7 ms** at **30 ticks/s** in the stated test profile.[9] |

The academic figures are best understood as **capacity demonstrations**, not as direct evidence that a shipped open-world game ran 30,000 fully simulated pedestrians. The papers typically rely on simplified behavior, lower-detail rendering, or both.[4][5][6]

## What pedestrians do

Across the cited material, pedestrian “life” is produced by several layers rather than by one universal AI model:

- **Locomotion and path following:** navigation graphs and individualized routes let people move through streets without visibly colliding.[6]
- **Animation and visual variation:** crowd-rendering work emphasizes animation fidelity, level-of-detail switching, palette skinning, key-pose caching, and instancing as ways to make many characters appear varied at acceptable cost.[5]
- **World-state persistence:** game systems can preserve the appearance of continuity through schedules and state rules even when an NPC is not being simulated at full resolution.[1]
- **Population placement:** the Open-world documentation uses lane or street fragments with time-of-day population data, then fills areas around players toward configured density targets.[2]
- **Different activity states:** the multiplayer profile distinguishes walkers from seated entities, indicating that crowd population is not only a count of moving pedestrians but also includes cheaper ambient states such as people sitting or remaining in place.[9]

The search results do **not** expose reliable, source-level numbers for specific reactions such as “how many NPCs flee when the player fires,” “how many investigate a disturbance,” or “how many switch behavioral states per frame.” Those details usually appear in full conference slides, technical postmortems, or proprietary talks rather than in the indexed summaries.

## What reactions and events cost

The practical implication of these systems is that reactions are normally prioritized by relevance:

- Actors close to the player can receive detailed animation, navigation, collision avoidance, and event reactions.
- Distant actors can remain on schedules, simplified paths, animation loops, or impostors.
- Rendering cost is reduced through geometry LOD, billboards/impostors, instancing, and animation caching.[4][5][6]
- Simulation cost is reduced by spatial activation, population caps, and time-sliced updates.[1][2]

The cited sources provide **scale and architecture**, but not a uniform breakdown such as “AI = X ms, animation = Y ms, rendering = Z ms” for a shipped city game. One GPU paper reports a stress-test result of **20,000 agents at at least 60 FPS**, but the available summary also contains an apparently inconsistent figure of **2,445.1 ms per frame**, so that number should not be interpreted without checking the original paper’s figure and measurement definition.[3]

## Bottom line

The strongest defensible conclusion is:

- A convincing street crowd does **not** require every visible pedestrian to run full AI.
- Published real-time systems have demonstrated **30,000–35,000 visible or simulated pedestrians** by combining navigation simplification and visual LOD.[4][6]
- A concrete player-centered population design uses only **up to 200 walkers within 65 m**, while allowing much larger cheaper populations elsewhere.[2]
- A multiplayer stress profile reports roughly **25,000 population entities** and an **8.7 ms mean server tick at 30 Hz**, but it is a project-specific configuration rather than a general industry benchmark.[9]
- The game-development evidence available here supports **time-slicing, scheduling, spatial activation, and event prioritization**, but does not supply enough verified primary-source detail to make precise claims about reaction counts or console CPU/GPU budgets for specific commercial games.[1]

[1] Supporting Thousands of NPCs in 'Kingdom Come ... (https://gamedev.net/news/5526-supporting-thousands-of-npcs-in-kingdom-come-deliverance-kingdom-come/)
[2] World population: pedestrians and traffic · 𝙊𝙋𝙀𝙉//𝟳𝟳 (https://open2077.net/docs/population)
[3] Massive Crowd Simulation With Parallel Computing on GPU (https://air.unimi.it/retrieve/8fab3501-af71-4faf-966f-bfbfb10cd5eb/Massive_Crowd_Simulation_With_Parallel_Computing_on_GPU.pdf)
[4] Copyright © 2005 by the Association for Computing Machinery, Inc. (https://ics-websites.science.uu.nl/docs/vakken/mcrws/papers_new/Dobbyn%20et%20al%20-%202005%20-%20Geopostors.pdf)
[5] [PDF] A Survey of Real-Time Crowd Rendering (https://www.cs.upc.edu/~npelechano/abstract_prePrintCGF2015Survey.pdf)
[6] Real‐time navigating crowds: scalable simulation and ... (https://onlinelibrary.wiley.com/doi/abs/10.1002/cav.147)
[7] Designing Kuttenberg City Around Design Constraints | KCD 2 (https://gamedev.net/news/4891-designing-kuttenberg-city-around-design-constraints-kcd-2/)
[8] A history of crowd simulation: the past, evolution, and new perspectives (https://pmc.ncbi.nlm.nih.gov/articles/PMC8339167/pdf/371_2021_Article_2252.pdf)
[9] World population: pedestrians and traffic (https://open2077.net/docs/population.md)
[10] Crowd Simulation: | Guide books | ACM Digital Library (http://dl.acm.org/doi/10.5555/2392685)
