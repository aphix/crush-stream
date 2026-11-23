> Question: In the source code of Multi Theft Auto: San Andreas (multitheftauto/mtasa-blue): how is the syncer of a pedestrian chosen and changed, what does a pedestrian sync packet contain, and how does bullet sync decide whether a remote player's shot hit, including any compensation for latency? Name the files and functions and cite them.

The relevant implementation is split between server-side `CPedSync` and client/server bullet-sync code.

## Pedestrian syncer selection and changes

In `Server/mods/deathmatch/logic/CPedSync.cpp`:

- `CPedSync::FindSyncer(CPed* pPed)` selects a syncer by calling `FindPlayerCloseToPed(...)`, using the configured pedestrian-syncer distance (`g_TickRateSettings.iPedSyncerDistance - 20.0f`). It then sends `CPedStartSyncPacket`, assigns the player with `pPed->SetSyncer(pPlayer)`, and fires `onElementStartSync`.[1][6]
- `CPedSync::StopSync(CPed* pPed)` sends `CPedStopSyncPacket` to the old syncer, clears the association with `pPed->SetSyncer(NULL)`, resets persistence, and fires `onElementStopSync`.[1][6]
- `CPedSync::OverrideSyncer(CPed* pPed, CPlayer* pPlayer, bool bPersist)` explicitly changes the syncer. If another player currently owns synchronization, it first calls `StopSync`; if a replacement is supplied, it makes that player the syncer and can mark the choice persistent.[6]
- The system periodically reevaluates synchronization—DeepWiki describes a roughly 500-ms pulse for updating syncers and validating synchronization.[1]

Thus, ordinary selection is proximity-based, while scripts or server logic can override it; changing ownership is represented by stop-sync/start-sync packets and the corresponding element events.

## What a pedestrian sync packet contains

`PACKET_ID_PED_SYNC` is processed by `CPedSync::ProcessPacket` in `Server/mods/deathmatch/logic/CPedSync.cpp`.[1][6] The client-side pedestrian-sync implementation in `Client/mods/deathmatch/logic/CPedSync.cpp` applies the synchronized state, including:

- position;
- rotation;
- movement speed;
- health;
- armor;
- burning state;
- water state; and
- camera rotation.[1]

The packet is therefore a state update for the synchronized pedestrian rather than merely a position message. Its surrounding start/stop packets identify when a client begins or ceases to be responsible for a pedestrian.[1][6]

## How bullet sync determines whether a remote shot hit

The client-side implementation is `Client/multiplayer_sa/multiplayer_shotsync.cpp`.[2] Its bullet-sync path evaluates the remote shot’s trajectory and impact against the locally represented entities, and the source explicitly distinguishes the normal impact calculation from the case where lag-compensation movement has already been performed: the relevant routine documents that returning `false` stops local bullet-impact calculation and assumes “lag compensation movement has not been performed.”[2]

The practical sequence is:

1. The firing player sends a bullet-sync packet containing the shot/projectile trajectory and, where applicable, impact or damage information; `CBulletsyncPacket` is described as carrying projectile weapon-fire trajectories plus optional damage data.[1]
2. The receiving side checks the trajectory against the remote player/ped and determines whether the shot intersects a valid target.[1][2]
3. Before that test, the target can be moved using the lag-compensation path. This compensates for the shooter having seen remote entities in an older network state; the hit test is then performed against that compensated position rather than only the receiver’s current position.[2]
4. If compensation has already moved the entities, the ordinary impact calculation is skipped, as indicated by the `multiplayer_shotsync.cpp` comment.[2]

In short, bullet sync does not decide a hit solely from the receiver’s present-time positions: it tests the reported shot against the relevant target state after latency compensation, while avoiding a second local calculation when the compensated path has already handled the impact.[2]

The principal files/functions are therefore:

- `Server/mods/deathmatch/logic/CPedSync.cpp`: `FindSyncer`, `OverrideSyncer`, `StopSync`, and `ProcessPacket`.[6]
- `Client/mods/deathmatch/logic/CPedSync.cpp`: application of pedestrian state fields.[1]
- `Client/multiplayer_sa/multiplayer_shotsync.cpp`: remote bullet-impact evaluation and the lag-compensation control path.[2]
- `CBulletsyncPacket`: bullet trajectory and optional damage payload.[1]

[1] deepwiki.com › multitheftauto › mtasa-blueEntity Synchronization | multitheftauto/mtasa-blue | DeepWiki (https://deepwiki.com/multitheftauto/mtasa-blue/2.3-entity-synchronization)
[2] mtasa-blue/Client/multiplayer_sa/multiplayer_shotsync.cpp ... (https://github.com/multitheftauto/mtasa-blue/blob/master/Client/multiplayer_sa/multiplayer_shotsync.cpp)
[3] Bullet sync may be broken · Issue #4408 (https://github.com/multitheftauto/mtasa-blue/issues/4408)
[4] Lag Compensation: What You See Is What You Hit (https://docs.colyseus.io/netcode/lag-compensation)
[5] multitheftauto/mtasa-blue: Multi Theft Auto is a game ... (https://github.com/multitheftauto/mtasa-blue)
[6] mtasa-blue/Server/mods/deathmatch/logic/CPedSync.cpp at 7b71c76e55b9275aa522318571ec788f9fa4e546 · multitheftauto/mtasa-blue (https://github.com/multitheftauto/mtasa-blue/blob/7b71c76e/Server/mods/deathmatch/logic/CPedSync.cpp)
[7] Make onPlayerWeaponFire cancellable (consistency with onWeaponFire) · Issue #5133 · multitheftauto/mtasa-blue (https://github.com/multitheftauto/mtasa-blue/issues/5133)
[8] Multi Theft Auto (https://github.com/multitheftauto)
[9] Stop element sync on demand · Issue #3245 · multitheftauto/mtasa-blue (https://github.com/multitheftauto/mtasa-blue/issues/3245)
[10] Bullet sync / onPlayerWeaponFire is still broken #4497 (https://github.com/multitheftauto/mtasa-blue/issues/4497)
