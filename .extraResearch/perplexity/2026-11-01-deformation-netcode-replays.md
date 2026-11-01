> Question: How do multiplayer games with deformable or damageable cars share deformation state between players, and how do they store it in replays? Cover BeamNG.drive multiplayer (BeamMP: what node/beam data is synced, rate, bandwidth), Wreckfest online (soft-body damage sync: impact events vs mesh state, determinism), Forza Motorsport/Horizon and Gran Turismo damage in online races and replays, Burnout Paradise online, Rocket League and Trackmania replays (input recording vs state snapshots), and Next Car Game/Bugbear's approach. Concrete specifics: whether they send per-vertex or per-node deltas, compressed damage zones or crush depths per region, impact events (position, normal, impulse) that each client re-applies, or rely on deterministic lockstep simulation; bandwidth numbers per car; how cosmetic detail (normal-map dents, scratches, decals) is reconstructed on remote clients and in replay playback from compact data; keyframe-plus-delta replay formats and typical replay sizes per minute. Cite developer posts, GDC talks and modding/netcode documentation; mark facts vs estimates.

There is **no public, authoritative specification covering all of these games**, and the available evidence does not support a single universal pattern. The clearest distinction is:

- **BeamNG/BeamMP:** synchronizes physics state at the vehicle/node level rather than sending rendered mesh vertices.
- **Wreckfest/Bugbear:** appears to synchronize compact collision/damage outcomes rather than a continuously deforming mesh.
- **Forza, Gran Turismo, Burnout Paradise:** public technical detail is sparse; online games generally replicate damage outcomes or authoritative vehicle state, not per-vertex geometry.
- **Rocket League and Trackmania:** primarily replay inputs/events or compact simulation state, with no deformable-car state to preserve.

## BeamNG.drive and BeamMP

BeamNG’s vehicle physics model consists of **nodes** connected by **beams**. The nodes carry positions, velocities, and related physical state; beams define structural constraints. The visible vehicle mesh is attached to that simulation structure. Consequently, a network implementation does not need to transmit every render-vertex position.

BeamMP documentation confirms that it synchronizes vehicle locations and supports smoothing of received position updates. It also separately synchronizes vehicle parts/configuration, either automatically or through a manual part-sync action.[3] Public documentation does **not** provide a complete packet schema stating that all node positions, beam strains, or deformation deltas are transmitted.

The commonly reported BeamMP server setting is a **30 Hz default send rate**, with configurable lower or higher rates in third-party hosting documentation.[1] That is a server update frequency, not proof that every vehicle sends a complete node array at 30 Hz.

A useful engineering estimate is:

\[
B \approx R \times \left(N \times q_{\text{node}} + q_{\text{metadata}} + q_{\text{overhead}}\right)
\]

where \(N\) is the number of replicated nodes and \(R\) is the update rate. If 100–300 nodes were sent as quantized position/velocity records at 12–24 bytes per node, the uncompressed physics payload would be roughly **1.2–7.2 kB per update**, or **36–216 kB/s per car at 30 Hz**, before delta compression and interest management. These are **estimates, not published BeamMP measurements**.

BeamMP’s public documentation does not establish that it sends:

- Per-render-vertex deformation.
- Per-beam strain values.
- A compressed “damage zone” representation.
- Impact events that every client deterministically reapplies.

The safest conclusion is that BeamMP replicates sufficiently detailed vehicle physics/state data for remote clients to reconstruct the visible vehicle, while smoothing/interpolating received updates. The exact division between node positions, velocities, beam state, and collision events remains undocumented publicly.

For replays, BeamNG/BeamMP-specific public format documentation is insufficient to claim a particular keyframe-plus-delta design or a fixed replay size per minute. A replay that preserves arbitrary BeamNG deformation would need either node-state snapshots or deterministic re-simulation from inputs plus collision/environment state; ordinary input-only playback would be fragile because floating-point physics, contacts, and multiplayer timing can diverge.

## Wreckfest and Next Car Game

Bugbear markets Wreckfest as having soft-body car damage that works online, but that marketing description does not reveal the network representation.[7] Public observations indicate that Wreckfest’s deformation is substantially more event-driven and coarser than BeamNG’s continuously simulated node-and-beam structure. Damage may appear to arrive in visible steps rather than as an independently changing mesh every render frame.[5][9]

The most plausible model is:

1. The authoritative simulation determines an impact and damage result.
2. The result is represented compactly—likely through vehicle damage/deformation parameters, damaged components, or localized deformation data.
3. Remote clients apply the result to their local vehicle representation.
4. The game continues simulating rigid-body motion and subsequent impacts.

That model is **not confirmed by a public Bugbear packet specification**. There is no reliable public evidence establishing that Wreckfest sends per-vertex deltas, per-node coordinates, crush depth per region, or a full soft-body state every tick.

Wreckfest’s visual damage can therefore be separated conceptually into:

- **Structural or collision-relevant damage:** compact simulation state or impact-derived deformation.
- **Cosmetic damage:** scratches, paint wear, detached parts, and other visual effects reconstructed from damage flags, material masks, procedural effects, or predefined deformation assets.

The game’s replays are likewise undocumented at the packet-format level. A replay can store collision/input events and damage outcomes more economically than full mesh snapshots. However, exact replay determinism cannot be inferred merely from the presence of a replay feature. If physics is not bitwise deterministic across platforms, replays need periodic correction snapshots or recorded damage events.

Recent public discussion around Wreckfest also describes improved multiplayer collision synchronization and replay chunking in later development versions, but that does not amount to a documented format or bandwidth specification.[10]

## Forza Motorsport and Forza Horizon

Forza’s public developer material does not expose a per-car deformation synchronization format or bandwidth budget. The games use visible damage systems with limited gameplay implications compared with BeamNG. Online clients therefore have little reason to exchange a complete deforming-body simulation.

The likely architecture is:

- Replicate authoritative vehicle transforms, velocities, and gameplay state.
- Replicate collision/damage state or damage events.
- Reconstruct visual dents and scratches locally using damage masks, predefined deformation regions, decals, normal-map changes, and damaged-part visibility.
- Keep cosmetic detail separate from collision state.

There is no public evidence that Forza transmits per-vertex or per-node mesh deltas during online racing. Nor is there a published figure for bandwidth per car or a documented replay size per minute. Claims such as “Forza sends crush depths for each body region” should therefore be treated as **speculation unless supported by an official engineering source**.

Forza replays are best understood as recordings of race/simulation data rather than raw rendered frames. Whether a given title uses input streams, state snapshots, or a hybrid varies by game and platform; public documentation does not establish a universal Forza replay format.

## Gran Turismo

Gran Turismo’s online damage is similarly not documented at the node/vertex-packet level. Its damage model is generally presented as a gameplay and visual feature rather than a fully deformable structural simulation comparable with BeamNG.

A practical network design would replicate:

- Vehicle pose and motion.
- Collision results and damage flags.
- Detached or damaged component state.
- Possibly compact body-region damage parameters.

Remote clients could then reconstruct dents, scratches, and panel appearance using local geometry, blend shapes, material masks, decals, and normal-map changes. There is no authoritative public source establishing that Gran Turismo sends mesh vertices, crush-depth fields, or impact normals and impulses for every collision.

Gran Turismo replay files are not publicly documented in enough detail to state a standard keyframe interval, delta format, or bytes-per-minute figure. Input/event replay with periodic state correction is more plausible than storing every rendered frame, but that is an **architectural inference**, not a confirmed format fact.

## Burnout Paradise

Burnout Paradise predates the current generation of publicly documented online vehicle-netcode disclosures, and Criterion has not published a detailed deformation replication specification.

Its crash and takedown presentation is highly event-oriented. A likely representation is:

- Authoritative collision/takedown event.
- Vehicle transforms and velocities.
- Damage or wreck-state flags.
- Locally triggered crash animation, deformation, particles, glass, and debris.

That is much cheaper than synchronizing a deforming body mesh. Cosmetic crash detail can be generated from deterministic animation states, predefined crash poses, damage materials, and local effects. No public source found here establishes per-vertex deltas, per-node damage, or a fixed bandwidth cost.

Replay behavior is also not sufficiently documented to claim that Burnout Paradise stores input streams, impact events, or periodic snapshots in a particular format.

## Rocket League

Rocket League cars are not deformable in the BeamNG sense. The important replicated state is normally the ball, cars’ rigid transforms and velocities, boost, game events, and match timing—not a damage mesh.

Replay systems in this class can be compact because they record gameplay state, inputs, and events rather than video. Rocket League replay files are commonly treated as structured gameplay recordings, but the public information available here does not justify a precise statement such as “X bytes per car per minute” or a confirmed keyframe interval.

The relevant contrast is:

- **No deformable-car state:** no vertex/node damage data is required.
- **Physics-sensitive objects:** ball and vehicle motion may require snapshots, corrections, or deterministic re-simulation.
- **Cosmetics:** car appearance is reconstructed from player loadout and asset identifiers, not recorded as changing mesh geometry.

## Trackmania

Trackmania’s cars are also not damageable deformable bodies. Replays can therefore focus on:

- Driver inputs.
- Timing and race progression.
- Vehicle state needed for deterministic playback.
- Checkpoints, respawns, and environmental interactions.

Trackmania has historically emphasized deterministic or highly reproducible time-trial simulation, making input-oriented replay especially attractive. Nevertheless, a precise public specification for all replay versions, keyframe cadence, and file size per minute should not be asserted without version-specific documentation.

Because there is no car deformation, Trackmania does not need to store cosmetic dents, scratches, per-vertex deltas, or impact damage events.

## Impact events versus state replication

The alternatives can be summarized as follows:

| Approach | Data sent/stored | Advantages | Main weakness |
|---|---|---|---|
| Full mesh state | Vertex positions or deltas | Exact visual reconstruction | Very expensive; usually unnecessary |
| Node/constraint state | Physics nodes, velocities, beam/constraint state | Preserves deformable simulation | Still expensive and difficult to version |
| Damage-region state | Region IDs, deformation amount, damaged-part flags | Compact and visually adequate | Cannot reproduce arbitrary physical deformation |
| Impact events | Position, normal, impulse, damage magnitude | Very compact | Requires deterministic or compatible reapplication |
| Input/event replay | Inputs plus game events | Small files; good for deterministic games | Diverges if physics or contacts differ |
| Keyframe-plus-delta | Periodic full state plus changes | Corrects drift while remaining compact | More complex; snapshot size depends on state |

For deformable vehicles, the most bandwidth-efficient practical design is usually **authoritative impact events plus compact damage state**, with periodic correction snapshots. Full per-vertex synchronization is generally reserved for cases where the deformation itself is gameplay-critical and cannot be reconstructed reliably.

## Cosmetic reconstruction

Cosmetic damage is normally cheaper than physical state:

- **Dents:** blend shapes, local cage deformation, predefined damaged meshes, or region-based offsets.
- **Scratches and paint wear:** decals, material masks, render-target damage maps, or procedural masks.
- **Normal-map dents:** a normal-map or material parameter indexed by damage region.
- **Detached parts:** replicated component IDs and transforms.
- **Glass and particles:** event-triggered local effects.
- **Replay playback:** reapply the same damage flags/events at the recorded simulation time, rather than storing rendered textures or every changed vertex.

This explains why a game can show apparently detailed remote damage without transmitting the full visible mesh.

## Bandwidth and replay-size figures

No authoritative source in the available material provides verified per-car bandwidth or replay-size numbers for the named games. The only concrete rate found is a third-party BeamMP hosting reference describing **30 Hz as a standard/default send rate**, with 15 Hz and 60 Hz presented as configuration choices.[1] BeamMP’s own documentation confirms smoothing and vehicle-part synchronization but does not publish a full payload schema or bytes-per-car figure.[3]

Accordingly:

- **Published fact:** BeamMP has configurable synchronization behavior and documented vehicle-part synchronization.[3]
- **Reported third-party configuration:** 30 Hz is described as a standard BeamMP send rate.[1]
- **Engineering estimate:** a detailed node-state stream could range from tens to hundreds of kilobytes per second per car before compression, depending on node count and fields.
- **Unsupported claim:** exact BeamMP bytes/car, Wreckfest bytes/car, Forza bytes/car, or any named game’s replay bytes/minute.
- **Unsupported claim:** that any of these games universally transmits per-render-vertex deformation.

The defensible overall conclusion is that BeamMP is the closest of the listed systems to **physics-state replication**, while Wreckfest and mainstream racing games more likely use **compact impact/damage state and local visual reconstruction**. Rocket League and Trackmania avoid the problem because their cars do not carry deformable damage state.

[1] lag-compensation-settings (https://help.freakhosting.com/games/beammp/lag-compensation-settings)
[2] How to Optimize Bandwidth in BeamMP - FREAKHOSTING (https://help.freakhosting.com/games/beammp/optimizing-bandwidth-for-beammp)
[3] github.com · BeamMP · DocsDocs/docs/en/game/multiplayer-settings.md at main · BeamMP/Docs (https://github.com/BeamMP/Docs/blob/main/docs/en/game/multiplayer-settings.md)
[4] BeamMP - GitHub (https://github.com/pterodactyl/game-eggs/tree/main/beamng/beammp)
[5] Does Wreckfest even have soft-body physics? (https://www.reddit.com/r/Wreckfest/comments/1jdbwcd/does_wreckfest_even_have_softbody_physics/)
[6] BeamMP v4.22.1 (#946) · BeamMP/BeamMP@cce1695 (https://github.com/BeamMP/BeamMP/commit/cce169525caeb6270ff33a104aa8e310c5e1848f)
[7] Wreckfest (Global) (https://www.yuplay.com/product/wreckfest/)
[8] Mastering Daily Payouts Through Race Replay Optimization (https://ir.msu.ac.zw/guide-daily-payouts-race-replays)
[9] Another Boring Driving Sim? - Wreckfest 2 (https://steamcommunity.com/app/1203190/discussions/0/4522262088838292948/?l=latam&ctp=2)
[10] Wreckfest 2 (https://steamcommunity.com/app/1203190/allnews/)
