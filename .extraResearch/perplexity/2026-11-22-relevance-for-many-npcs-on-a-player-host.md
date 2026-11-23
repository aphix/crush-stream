> Question: A multiplayer game is hosted on one player's machine, possibly a phone, and has hundreds of non-player characters of which only some are near any player. How do shipped games and open-source projects decide which characters' state to send to which player and how often, and what CPU and bandwidth figures have they published for that? Cite sources.

Shipped games and open-source networking stacks generally use **interest management** (also called area of interest, or AoI): each client receives only entities that are spatially nearby, visible, in the same zone/cell, or otherwise relevant. They then combine that filter with **per-entity update rates, delta compression, interpolation, and sometimes dead reckoning**.

## Common design

- **Spatial filtering:** Divide the world into grid cells, zones, or spatial trees. A player subscribes to the cell containing them plus neighboring cells; entities outside that set are not replicated. Relevance can also include visibility, team, quests, recent interaction, or combat state.[2][3]
- **Distance-based update tiers:** Nearby entities receive frequent, detailed snapshots; farther entities receive less frequent and smaller updates. One documented pattern uses 20–30 Hz for immediate entities, 10 Hz for an inner ring, and 2–5 Hz for an outer ring.[8]
- **Importance overrides:** Combatants, projectiles, vehicles, and recently interacted NPCs can bypass ordinary distance rules. Ambient NPCs can be updated infrequently or represented with coarse state.
- **Delta/state compression:** Send only changed properties or changes since the client’s last acknowledged state rather than complete NPC snapshots.[1]
- **Client interpolation/dead reckoning:** The receiver smooths movement between snapshots, allowing lower network rates without visibly discontinuous motion.[1][8]
- **Host-side simulation partitioning:** In peer-to-peer designs, NPC simulation can be assigned to participant machines according to available CPU, bandwidth, and interest-management cost rather than running every NPC on every peer.[4][10]

## Published figures

| Source or project | Reported technique or result |
|---|---|
| **Yggdrasil multiplayer library** | Reports 20–30 Hz for critical player state, about 10 Hz for NPC positions, and 1–2 Hz for ambient/environmental state. For an eight-player session, it reports reducing per-player traffic from roughly **150 KB/s** with naive replication to **under 15 KB/s** using interest management and deltas.[1] |
| **Dyconits research system** | Reports that adaptive interest management reduced mean bandwidth by **49%** under a low-inconsistency setting and by **85%** when larger but tolerable inconsistency was allowed.[6] |
| **Peer-to-peer MMO research** | One published P2P MMO design reports average peer bandwidth of **7.2 KB/s**, with peaks of **22.34 KB/s**.[7] This is a system-level figure, not specifically an NPC-only cost.[7] |
| **Assassin’s Creed Unity GDC material** | The presentation describes a crowd architecture in which peers use only one network object per peer, reporting “big gains” in bandwidth and CPU; the indexed material does not provide a precise CPU or bandwidth number.[9] |
| **P2P MMO research on NPC hosting** | Research prototypes explicitly treat CPU cycles and bandwidth as scarce resources for assigning NPC hosting and interest-management work, including experiments involving nearly **1,000 players**; the available result does not expose a comparable per-host CPU percentage.[4][10] |

## What is—and is not—published

The available public figures are mostly **bandwidth measurements or percentage reductions**, not complete CPU budgets. The sources do not provide a reliable, directly comparable number such as “X% of a phone CPU for Y NPCs.” CPU cost depends heavily on the spatial index, number of subscribed clients, serialization format, scripting/AI workload, and whether the host simulates all NPCs or delegates some of them.

A practical shipped-game policy therefore looks like:

- Simulate authoritative NPC state on the host.
- Maintain a spatial index of NPCs and players.
- Build a separate interest set for each player.
- Send nearby or important NPCs at roughly 10–30 Hz.
- Send distant ambient NPCs at roughly 1–5 Hz, often with reduced fields.
- Stop sending entities outside the interest set.
- Use deltas, quantization, batching, and interpolation.
- Measure traffic and serialization CPU on the target phone, because published aggregate figures vary too much to serve as universal limits.

[1] Godot Engine Multiplayer Architecture | Production Patterns Guide (https://progle.com/blog/godot-multiplayer-architecture.html)
[2] Multiplayer game servers: a system design guide (https://sysdesignprep.com/guides/multiplayer-game-servers)
[3] MMORPG game development: architecture, systems, cost (https://game-ace.com/blog/mmorpg-games-and-how-to-develop-them/)
[4] [PDF] Design Issues for Peer-to-Peer Massively Multiplayer Online Games (https://mmve-workshop.org/2009/papers/p2.pdf)
[5] Low-Cost Stable Multiplayer Deathmatch Netcode (https://www.scribd.com/document/1054892145/Low-Cost-Stable-Multiplayer-Deathmatch-Netcode-for-a-PlayCanvas-FPS-Zombie-Game-With-Colyseus)
[6] Dyconits: Scaling Minecraft-like Services through ... (https://atlarge-research.com/pdfs/icdcs21-dyconit-paper.pdf)
[7] Peer-to-Peer Support for Massively Multiplayer Games (https://www.cp.eng.chula.ac.th/~vishnu/gameResearch/network/peer-to-peer-support.pdf)
[8] Implementing MMO Interest Management Grids - game-development (https://salivity.github.io/game-development/article/implementing-mmo-interest-management-grids)
[9] Full text of "GDC 2015: Charles Lefebvre - "Networking Gameplay and AI in Assassin's Creed Unity"" (https://archive.org/stream/GDC2015Lefebvre/GDC2015-Lefebvre_djvu.txt)
[10] Deadline-Driven Auctions for NPC (https://mmve-workshop.org/2009/papers/p3.pdf)
