> Question: In GTA Online (GTA V) and Red Dead Online, do players see the same vehicle damage as each other? Concrete specifics from Rockstar's netcode as documented by FiveM/RAGE Multiplayer/alt:V developers and reverse engineers (CNetObjVehicle, CVehicleDamageStatusDataNode, CVehicleHealthDataNode, sync trees): what vehicle damage state is synced (deformation per bone/zone, broken windows, doors off, bumpers hanging, tyres burst, dirt level, scratches/paint wear, decals, bullet holes), how deformation is encoded (a small set of deformation zones or a deformation texture/vertex offsets; the 'damage vectors'), whether it is sent as events or state, how often, how ownership/migration works when the owning player leaves, and what is purely client-side cosmetic and can differ between players (scratch decals, dirt, minor dents). Also how GTA V's Rockstar Editor replays store vehicle damage. Then summarise the general industry pattern: which damage is authoritative/shared vs local-only cosmetic, and why. Cite FiveM docs, GitHub sources, developer forums; mark facts vs inference.

The short answer is **partly**. GTA Online does synchronize important, gameplay-relevant vehicle damage, but it does **not** guarantee pixel-identical vehicle appearance for every player. Public reverse-engineering material documents GTA V much better than Red Dead Online; RDO’s corresponding proprietary structures are not comparably documented in the cited material, so claims about exact RDO fields should be treated as unverified.

## What GTA V synchronizes

FiveM’s network-object terminology distinguishes vehicle damage-related nodes such as `CNetObjVehicle`, `CVehicleDamageStatusDataNode`, and `CVehicleHealthDataNode`. Those names indicate that vehicle health and damage status are replicated as network state, rather than being exclusively local effects. However, the public documentation does not establish that every visual damage attribute is transmitted as a complete per-vertex model. [No search result supplied here directly documents these structures.]

The safest technical distinction is:

- **Vehicle health and mechanical state:** authoritative/shared.
- **Major component state:** generally shared when represented by GTA’s network damage state.
- **Exact visual presentation:** potentially reconstructed differently by each client.

In practical terms, players should normally agree about consequential effects such as:

- Vehicle health or engine/body damage.
- Destroyed or burst tyres.
- Major detachable components, where the vehicle model supports them.
- Doors or other components that have become detached.
- Broken windows when represented by the replicated vehicle damage state.
- Whether a vehicle is sufficiently damaged to smoke, fail, or become undriveable.

That does **not** mean every client necessarily has identical geometry at every moment. GTA’s synchronization model transmits compact state and lets each game instance apply local vehicle simulation and rendering.

## Deformation encoding

The available public nomenclature does **not** support the claim that GTA V sends a full deformation texture or arbitrary vertex-offset mesh over the network. The usual reverse-engineering interpretation is that vehicle damage is represented by a relatively small set of damage/deformation values or vectors associated with predefined vehicle regions, often described informally as “damage vectors” or deformation zones.

That means the likely model is:

1. A collision or weapon hit changes local vehicle damage data.
2. The owner’s game updates the vehicle’s damage/deformation state.
3. A compact damage-state update is replicated.
4. Other clients apply the state to their own copy of the vehicle.

The exact internal mapping—how many zones exist, their coordinate basis, quantization, and whether particular vectors represent offsets, normals, or accumulated impulses—varies by title and has not been established by the supplied sources. It would therefore be inaccurate to state categorically that GTA sends either “one value per bone” or “a deformation texture.” The public evidence supports **compact component/zone deformation data**, not a complete damaged mesh.

## Events versus state

Vehicle damage is best understood as **state synchronization with event-like triggers**, not as a reliable permanent stream of every collision event.

A collision can cause an immediate local event, but the network needs to communicate the resulting persistent state. A client joining later, or receiving a vehicle after ownership migration, must be able to reconstruct the current condition without replaying every historical impact. That favors synchronized snapshots or deltas of:

- Health.
- Damage-status flags.
- Component states.
- Deformation values.
- Tyre and window state where supported.

Thus, “a bumper was hit at time \(t\)” may be an event internally, while “the bumper is now detached and the vehicle has this damage state” is the replicated result. This is an inference from the purpose of network object state and not a directly quoted Rockstar protocol specification.

## Ownership and migration

GTA Online uses network ownership of entities. The owner is generally responsible for authoritative simulation and for producing synchronization updates for the vehicle. If that owner leaves, loses relevance, or ownership migrates, another client can become the vehicle’s network owner.

The important consequence is that ownership migration should preserve the vehicle’s **replicated persistent state**, but it cannot guarantee preservation of every transient local rendering detail. A newly authoritative client reconstructs the vehicle from the networked state available to it, then continues simulating it.

This explains common observations such as:

- Major damage remaining visible after the original driver leaves.
- A vehicle’s physics or damage behavior changing slightly after migration.
- Minor dents, scratches, dirt, or deformation looking different between observers.
- A late-joining player seeing the current damage but not necessarily the exact historical sequence that produced it.

## What may differ between players

The following categories are commonly local or partially local, although exact behavior can depend on the vehicle, platform, game mode, and implementation:

- Scratch marks and impact decals.
- Dirt accumulation and mud presentation.
- Fine paint wear.
- Small dents that are not part of the replicated deformation state.
- Bullet-hole decals or their lifetime.
- Debris, sparks, smoke density, and other transient effects.
- Rendering-level differences caused by level of detail, streaming, frame timing, or damage reapplication.
- The precise interpolation path while a damage update is arriving.

A useful rule is that **gameplay-relevant damage is shared; decorative damage is often reconstructed locally**. “Shared” also does not necessarily mean “identical pixels.” Two clients can receive the same damage status while displaying slightly different decal placement, dirt, or small deformation.

## Rockstar Editor replays

Rockstar Editor clips are replay data rather than ordinary video files: the game records gameplay state and actions, then reconstructs the scene during editing. The available material describes the system as recording game state around the player and allowing later camera and playback manipulation.[1][2]

Consequently, vehicle damage in an Editor clip is not best understood as a raw video capture of every rendered pixel. It is reconstructed from recorded gameplay/replay data. The replay can preserve enough vehicle state and actions to reproduce major damage, but the sources supplied here do not document the exact binary fields used for:

- Per-zone deformation.
- Damage vectors.
- Decals.
- Dirt.
- Bullet holes.
- Damage-state transitions.
- Network-owner changes.

The replay system’s reconstruction model also means that a clip may not reproduce every transient or purely renderer-local detail exactly. Historical descriptions of replay systems explicitly note that replays reconstruct scenes from available gameplay data and are not necessarily exact recreations.[3]

## Red Dead Online

The same high-level conclusion is plausible for Red Dead Online: damage that affects gameplay or the persistent state of a vehicle or mount must be synchronized sufficiently for other players to simulate it, while cosmetic effects can be local. But the cited public material does not provide equivalent RDO structures for vehicle damage, nor does it establish RDO’s exact deformation fields, update cadence, ownership rules, or replay representation.

Accordingly:

- **Fact:** the supplied public results do not document RDO’s equivalent of GTA V’s vehicle damage nodes.
- **Inference:** RDO likely follows the same broad authoritative-state/local-rendering split used by networked games.
- **Not established:** that RDO uses the same node names, damage vectors, zone count, or serialization format as GTA V.

## General industry pattern

Networked games normally synchronize the smallest state needed to preserve gameplay consistency:

| Damage category | Usually authoritative/shared? | Reason |
|---|---:|---|
| Health, engine state, destruction | Yes | Affects movement, combat, missions, and failure conditions |
| Tyres, doors, major detachable parts | Usually | Other players must see and interact with the same functional state |
| Large deformation affecting collision or gameplay | Often | Prevents visibly contradictory physical results |
| Small dents and deformation details | Sometimes or partially | Expensive to synchronize and often not gameplay-critical |
| Dirt, scratches, paint wear | Often local or approximate | Primarily cosmetic and tolerant of visual divergence |
| Bullet-hole and impact decals | Often local or selectively replicated | High event volume with limited gameplay value |
| Smoke, sparks, dust, debris | Commonly local effects | Can be regenerated from shared state and saves bandwidth |
| Exact vertex mesh or texture history | Rarely | Too much data for little gameplay benefit |

This design saves bandwidth and avoids requiring every client to receive a complete history of every impact. The authoritative state answers **what condition the vehicle is in**; each client is then free to render that condition with local interpolation, decals, effects, and cosmetic accumulation.

The strongest defensible conclusion is therefore: **players generally see the same major, gameplay-relevant vehicle damage in GTA Online, but not necessarily the same complete visual damage—including every scratch, dent, decal, dirt layer, or transient effect.** The supplied sources support the replay/state distinction, but they do not provide enough primary protocol documentation to claim a definitive field-by-field map for GTA V, and especially not for Red Dead Online.

[1] blog.eklipse.gg · streaming-tips-2 · rockstar-editorRockstar Editor Tutorial: Record, Edit and Export GTA 5 Videos (https://blog.eklipse.gg/streaming-tips-2/rockstar-editor.html)
[2] Rockstar Editor - GTA 5 Guide - IGN (https://www.ign.com/wikis/gta-5/Rockstar_Editor)
[3] Rockstar Editor Wiki | GTA BOOM (https://www.gtaboom.com/rockstar-editor-2de1)
[4] gta.wiki · w · Rockstar_EditorRockstar Editor - GTA Wiki (https://gta.wiki/w/Rockstar_Editor)
[5] www.rockstaruniverse.co.uk › gta-v-rockstar-editor-pcGTA V Rockstar Editor & PC Director Mode | Rockstar Universe (https://www.rockstaruniverse.co.uk/gta-v-rockstar-editor-pc-director-mode/)
[6] gta5-under-the-hood/docs/performance/graphics-settings.md at main · Goodvibes74/gta5-under-the-hood (https://github.com/Goodvibes74/gta5-under-the-hood/blob/main/docs/performance/graphics-settings.md)
[7] GTA V Rockstar Editor & Director Mode Guide - GTA Base (https://www.gtabase.com/grand-theft-auto-v/rockstar-editor/)
[8] Guide :: Rockstar Editor Bulletpoints - Steam Community (https://steamcommunity.com/sharedfiles/filedetails/?id=1167305820)
[9] Getting the best out of GTA V's Rockstar Editor | PC Gamer (https://www.pcgamer.com/getting-the-best-out-of-gta-vs-rockstar-editor/)
[10] Playback/Editing (https://gta.fandom.com/wiki/Replay)
