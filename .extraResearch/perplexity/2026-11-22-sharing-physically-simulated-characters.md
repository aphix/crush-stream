> Question: A multiplayer game has many non-player characters and players on foot whose bodies are physically simulated (ragdolls when knocked down, dragged or thrown) on every machine. How do shipped games and open-source projects share the state of such characters between machines: what is sent, how often, and how does a receiving machine bring its own simulation into line? What bandwidth figures, update rates and position-error figures are published? Cite sources.

Shipped games generally **do not continuously replicate every ragdoll bone**. The common designs are:

- **Replicate inputs/events, not poses, for ordinary characters.** A server or host sends movement inputs, aiming, hits, animation events, and periodic correction state; remote machines simulate or interpolate the character locally.[3]
- **Replicate an initial ragdoll condition.** For Halo: Reach, the reported approach was to transmit the exact death-time transform and impulse, then let each Xbox run the ragdoll locally. This reportedly eliminated continuous ragdoll traffic and saved roughly **10–12% of total bandwidth**.[1][2]
- **Replicate authoritative snapshots when determinism is insufficient.** A typical server-authoritative model sends inputs to the server, then snapshots containing selected object state—position, orientation, velocities and sometimes sleep/rest state—back to clients. Clients correct their local simulation toward the received state rather than requiring identical physics.[4][6]
- **Use lower-detail synchronization for distant bodies.** One documented design sends the impact parameters—bone, direction, force, velocity and random seed—rather than the whole skeleton; alternatives synchronize only the pelvis/root, then send a final settled pose.[5]

## What a receiving machine does

The receiver normally maintains a **buffer of timestamped snapshots**, renders slightly behind real time, and interpolates between known states. If packets are missing, it extrapolates briefly; when an authoritative state arrives, it blends or rewinds/resimulates toward it. A public example describes clients stepping physics with server-provided inputs and correcting received objects, allowing bandwidth to be allocated per object and per simulation step.[6]

For animation-driven characters, corrections can be smoothed rather than snapped: one published prototype performs a state check twice per second, applies a correction with a **0.1-second half-life**, caps correction speed at **0.5 m/s**, and inertializes the animation over **0.2 seconds**.[3] Its reported test target was under **2 cm and 2°** discrepancy at the feet and hands under 150 ms latency, although these are prototype measurements rather than a shipped-game guarantee.[3]

## Published rates and bandwidth figures

| System / report | Published figure | Interpretation |
|---|---:|---|
| Halo: Reach ragdolls | **10–12% total bandwidth saved** | Continuous ragdoll replication was replaced by a synchronized initial state.[1][2] |
| Halo: Reach ordinary player state | About **100 bits** for animation, position and travel direction | A rough compact representation for an alive running player, contrasted with the much larger cost of bone-by-bone ragdoll state.[1] |
| Halo: Reach networking example | **30 updates/s** sent, with only **10/s** arriving in one example | The client reconstructs/interpolates the current position and skips missing intermediate updates.[2] |
| PolygonHive performance report | Maximum **30 replication updates/s**; remote interpolation over **100 ms** | Approximately three updates are displayed in the interpolation window.[7] |
| PolygonHive performance report | Mover traffic reduced from **75.4 to 28.6 KB/s** in one test | This is an implementation-specific result, not a universal per-character budget.[7] |
| Animation-sync prototype | Drift check every **0.5 s** | Corrections were smoothed rather than snapped.[3] |
| Animation-sync prototype | **34 mm** drift after 10 lost ticks; maximum correction about **3.8 mm/tick** | Reported test behavior under that prototype’s loss scenario.[3] |

The key distinction is between **replicating a physical outcome** and **replicating the physical simulation**. If all machines can produce acceptably similar results from the same death event, an initial transform/impulse is vastly cheaper. If collisions, explosions, differing physics engines or nondeterminism cause visible divergence, the authoritative machine must periodically send snapshots—often only for the root or selected bodies—and the receiver must interpolate, reconcile, or snap after a threshold.

The figures above should not be treated as a standard protocol: the available public material mixes shipped-game reporting, open-source implementations and prototypes, and most commercial games do not publish per-ragdoll packet layouts or formal position-error budgets.

[1] Bungie Slashes Reach Bandwidth 80% by Rewriting Mechanics Over Code | Stream Reducer (https://reducer.xgoose.org/items/7579)
[2] Game Backend Deep Dive - Halo: Reach - Edgegap (https://edgegap.com/blog/game-backend-deep-dive-halo-reach-netcode-host-migration)
[3] Animation over the network: the graph's inputs and events, not poses · Issue #911 · aether-lang-dev/ae3d (https://github.com/aether-lang-dev/ae3d/issues/911)
[4] Synchronizing Rigid Body Physics in Multiplayer Games - game ... (https://salivity.github.io/game-development/article/synchronizing-rigid-body-physics-in-multiplayer-games)
[5] Synchronizing Multiplayer Ragdolls with Low Bandwidth - game ... (https://salivity.github.io/game-development/article/synchronizing-multiplayer-ragdolls-with-low-bandwidth)
[6] Multiplayer implementation of Glenn Fiedler's Network Physics ... (https://github.com/valverl/NetworkedPhysics)
[7] Performance report¶ (https://docs.polygonhive.com/gaspals/home/performance-report/)
[8] Interpo-what? Smoothing the Motion of Networked Objects (https://blog.haydz6.com/2012/04/interpo-what-smoothing-the-motion-of-networked-objects)
[9] Ragdoll physics in multiplayer does not work. (option to make it client side)Acknowledged, WishlistPublicActions (https://feedback.bistudio.com/T83414)
[10] Multiplayer Game Animation: How to Sync Animations | MCO (https://mocaponline.com/blogs/mocap-news/multiplayer-animation-sync-guide)
