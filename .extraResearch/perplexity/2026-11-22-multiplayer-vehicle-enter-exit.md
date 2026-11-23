> Question: In multiplayer open-world games and modifications where players get into and out of vehicles that other players or non-player characters may also use: which machine decides who gets a seat, what messages are exchanged, how are two players reaching for the same seat resolved, and how is the door and seating animation kept consistent on every machine? Cite source code or documentation.

The **server (or authoritative host)** should decide vehicle occupancy—not the client that reaches the vehicle first. A client sends a seat request; the authority validates and atomically reserves the seat, then replicates the resulting occupancy to everyone observing that vehicle. This design prevents two clients from independently claiming the same seat.

## Typical sequence

1. **Seat request**
   - The entering client sends a request containing the vehicle identifier and desired seat.
   - It should not commit the seat in its local network state first. Open77’s documentation explicitly describes the client as requesting the seat while the server checks the vehicle, proximity, routing bucket, locks, destruction state, and one-player-per-seat constraints.[1][3]

2. **Authoritative reservation**
   - The server performs an atomic check-and-reserve operation.
   - If two players request the same seat concurrently, the server’s serialized processing determines the winner. The losing request is rejected or receives the updated occupancy snapshot; clients must not resolve this through local timestamps or proximity.
   - The same principle appears in the documented “atomic seat transactions” used by another multiplayer implementation.[8]

3. **Replication**
   - The authority sends a reliable, ordered occupancy/state update to all clients that can see the vehicle. Open77 describes an “occupancy snapshot” containing the assigned player and seat, with durable flags such as `forcedEntry` and `forcedExit` retained until native confirmation.[1][3]
   - A late-joining or newly streaming client therefore reconstructs the current seat state rather than relying on an old one-shot event.

4. **Local realization**
   - Each client applies the authoritative state to its local player or remote-player proxy.
   - The selected seat determines the native enter/exit task or equivalent animation behavior; MTA-related documentation describes the selected seat being used to create the corresponding GTA vehicle-entry task after server confirmation.[2]
   - For an initial stream-in, a client may use an instantaneous placement/warp to avoid replaying an entrance that happened before the entity became visible. For a live entry, it can run the normal approach, door, and seating behavior.[1]

## What is actually synchronized?

Usually, the network protocol synchronizes **state and intent**, not every animation frame:

- Vehicle ID and authoritative seat occupancy.
- Player/ped ID assigned to each seat.
- Entry, exit, forced-entry, or forced-exit state.
- Vehicle transform and movement, generally from one authority—often the driver. In MTA’s documented pure-sync model, only the driver sends the full vehicle state, including position, rotation, velocity, turn speed, and health.[9]
- Animation/task state or enough information for observers to start the corresponding native task.

The clients then run the same game-native door and seating tasks locally. Because every client starts those tasks from the same authoritative seat/vehicle state—and receives correction or confirmation when necessary—the visual result converges without requiring continuous animation-pose streaming.

## Important distinction

The **server decides who owns the seat**; the **client renders the action**. A robust implementation therefore uses:

- Server-side atomic seat reservation.
- Reliable ordered occupancy updates.
- Explicit rejection or correction for stale requests.
- Durable entry/exit state until the target client confirms the native mount.
- Generation/entity checks so stream-out and stream-in cannot apply an old command.
- Driver or leased authority for vehicle movement, with other clients interpolating the replicated result.[1][6][9]

Thus, when two players reach the same passenger seat, whichever request the authoritative server accepts first gets the seat. Both clients then receive the same authoritative occupancy result, and each runs the appropriate local door/entry/seating task for that result rather than independently deciding what happened.

[1] vehicles.md (https://open2077.net/docs/vehicles.md)
[2] setPedEnterVehicle | MTA:SA Neon Documentation (https://mtasa-neon-wiki.vercel.app/neon/functions/setPedEnterVehicle/)
[3] Network vehicles — OPEN//77 — OPEN//77 (https://open2077.net/docs/vehicles)
[4] Changing seats inside a vehicle · 𝙊𝙋𝙀𝙉//𝟳𝟳 (https://open2077.net/docs/vehicle-seat-switching)
[5] GitHub - samuk190/mta-sa-neon-android: MTA SA ANDROID ( for San Andreas Online/MTA NEON ) (https://github.com/samuk190/mta-sa-neon-android)
[6] Networked vehicle AI · 𝙊𝙋𝙀𝙉//𝟳𝟳 (https://open2077.net/docs/vehicle-ai)
[7] GitHub - NightfallTogether/Nightfall-Together-Batman-Arkham ... (https://github.com/NightfallTogether/Nightfall-Together-Batman-Arkham-Knight-Multiplayer)
[8] GitHub - AliYa-chen/gtav-web-multiplayer-launcher: GTAV 网页版多人启动器 · Read-only browser game launcher and experimental shared-world server (https://github.com/AliYa-chen/gtav-web-multiplayer-launcher)
[9] deepwiki.com › multitheftauto › mtasa-blueEntity Synchronization | multitheftauto/mtasa-blue | DeepWiki (https://deepwiki.com/multitheftauto/mtasa-blue/2.3-entity-synchronization)
[10] FreeMode/docs/SYNC.md at master · SashaGoncharov19/FreeMode (https://github.com/SashaGoncharov19/FreeMode/blob/master/docs/SYNC.md)
