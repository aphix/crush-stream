# Guests acting on anyone: seats, hooks, police, hits, ownership and message sizes

Asked 2026-11-22 for the open world's netplay work (every player treated the same; the host decides). It continues
`netplay-shared-people-and-guest-acts.md`. Twelve Perplexity answers are in `perplexity/2026-11-22-*.md` (listed at
the end). The answers were leads: each claim used below was checked in its source, by opening the cited page or by
reading the project's own source at a named commit. Status is VERIFIED (with the quote), NOT VERIFIED, or REJECTED.

Source trees read (shallow clones, commit in brackets):
`github.com/multitheftauto/mtasa-blue` [68bba17a39], `github.com/openmultiplayer/open.mp` [2b4a69dd60],
`github.com/Tornamic/CoopAndreas` [118bb37029], `github.com/gta-reversed/gta-reversed` [e2785bf7ff].

## 1. Verified findings

### 1.1 Getting into a car: the authority picks the seat and tells everyone (Multi Theft Auto)

VERIFIED in `Server/mods/deathmatch/logic/CGame.cpp`, `CGame::Packet_Vehicle_InOut`, case `VEHICLE_REQUEST_IN`:
- The server checks the asker before anything else: "He musn't already be doing something", "He musn't already be in
  a vehicle", and a distance cutoff (`float fCutoffDistance = 50.0f;`, 10 for a few craft entered by warp).
- A taken seat is not a refusal: "Grab a free passenger spot in the vehicle" (`ucSeat = pVehicle->GetFreePassengerSeat();`).
- A grant goes to every joined player, with the seat and the door: "Tell everyone he can start entering the vehicle
  from his current position" (`CVehicleInOutPacket Reply(PedID, VehicleID, ucSeat, VEHICLE_REQUEST_IN_CONFIRMED, ucDoor); m_pPlayerManager->BroadcastOnlyJoined(Reply);`).
- A refusal goes to the asker alone, with a reason: "He can't get in" (`VEHICLE_ATTEMPT_FAILED`, `Reply.SetFailReason(...)`;
  reasons `FAIL_SEAT`, `FAIL_DISTANCE`, `FAIL_IN_VEHICLE`, `FAIL_ACTION`, `FAIL_TRAILER`, `FAIL_SCRIPT`, `FAIL_JACKED_ACTION`);
  for `FAIL_DISTANCE` the reply also corrects the asker's idea of where the vehicle is (`Reply.SetCorrectVector(pVehicle->GetPosition());`).

### 1.2 Door and seat are separate, and the game itself slides a player across (San Andreas, reversed)

VERIFIED in `source/game_sa/Tasks/TaskTypes/TaskComplexEnterCar.cpp`: the task holds a door and a seat apart
(`m_TargetDoor = tGoToDoor->m_TargetDoor; m_TargetSeat = tGoToDoor->m_TargetSeat;`), seats a pedestrian by role
(`TASK_SIMPLE_CAR_SET_PED_IN_AS_DRIVER` / `..._AS_PASSENGER`), and a player who came in as driver by the far front
door of a car with no driver is slid over: `if (!m_Car->m_pDriver) { return C(TASK_SIMPLE_CAR_SHUFFLE); }`
(`new CTaskSimpleCarShuffle{ m_Car, m_TargetDoor, m_LineUpUtility }`). The condition before it reads
`m_TargetDoor != 8 || !m_Car->IsAutomobile() || m_Car->m_pHandlingData->m_bTandemSeats` for the direct case, so the
shuffle is for door 8 of an ordinary car.

### 1.3 Who owns a pedestrian

- Multi Theft Auto, VERIFIED in `Server/mods/deathmatch/logic/CPedSync.cpp`: the server re-checks owners every
  500 ms (`if (m_UpdateSyncerTimer.Get() > 500)`); an owner is kept while "close enough, and in the right dimension"
  (`IsPointNearPoint3D(..., (float)g_TickRateSettings.iPedSyncerDistance)`); a new one is the joined player within
  `iPedSyncerDistance - 20.0f` who owns the fewest ("Return the player we found that syncs the least number of peds");
  start and stop are told with `CPedStartSyncPacket` / `CPedStopSyncPacket`; an update from anyone but the owner is
  dropped (`if (pPed->GetSyncer() != pPlayer || !pPed->CanUpdateSync(Data.ucSyncTimeContext)) continue;`).
- CoopAndreas, VERIFIED in `client/src/CNetworkPedManager.cpp` and `CNetworkPed.h`: a pedestrian's id is made of the
  local player's id and a counter (`return pedid_t(CNetworkPlayerManager::m_localPlayerId, ms_nNextPedId++);`), a
  machine marks the ones it made (`CreateHosted`, `m_bSyncing`), and `AssignHost()` has its whole body commented out.
  So the machine that made a pedestrian keeps it; this code moves no ownership.
- Assassin's Creed Unity (peer to peer, 1 to 4 players), VERIFIED in the GDC 2015 slide text
  (`archive.org/stream/GDC2015Lefebvre/GDC2015-Lefebvre_djvu.txt`): "Simulation bubble around each player: 80 meters";
  "Around 900 stations loaded, and up to 600 spawned NPCs non-replicated entities: bulk crowd members."; for crowd
  stations "(+) Only 1 net object per peer = big gains on bandwidth/CPU", "(-) Data is broadcast on all peers even if
  they don't need it"; conflicts between peers go to whoever asked first ("NetTokens are time based: the first one
  that has requested the token is the winner."); the whole game stays "Below TRC of 92 kbps per peer (around 30 kbps
  outside fight)".

### 1.4 What a pedestrian update carries, and how often (Multi Theft Auto)

VERIFIED in `Server/mods/deathmatch/logic/packets/CPedSyncPacket.cpp`: one flags byte says which parts follow:
position (0x01), rotation (0x02), velocity (0x04), health (0x08), armour (0x10), on fire (0x20), in water (0x40),
plus a camera rotation behind a second flags byte. No pose and no joint is in it.

VERIFIED in `Shared/mods/deathmatch/logic/CTickRateSettings.h` (the defaults in code) and `mtaserver.conf`:
`iPureSync = 100; iLightSync = 1500; iPedSync = 400; iPedFarSync = 2000; iUnoccupiedVehicle = 400; iPedSyncerDistance = 100; iUnoccupiedVehicleSyncerDistance = 130; iVehicleContactSyncRadius = 30;`
("Ped sync interval. Default: 400"). The project's wiki page, which the first write-up quoted, says 500 ms for
`ped_sync_interval`; the code at this commit says 400.

### 1.5 A remote player's shot

- Multi Theft Auto, VERIFIED in `Server/mods/deathmatch/logic/packets/CBulletsyncPacket.h`: the shooter's packet
  holds the weapon, the shot's start and end, and optionally what it damaged (`m_weapon`, `m_start`, `m_end`,
  `m_damage`, `m_zone`, `m_damaged`). The shooter's machine names its victim; how the server checks that claim was
  not read (NOT VERIFIED).
- open.mp, VERIFIED in `Server/Source/core_impl.hpp`: `{ "game.lag_compensation_mode", LagCompMode_Enabled }`,
  `{ "network.on_foot_sync_rate", 30 }`, `{ "network.in_vehicle_sync_rate", 30 }`, `{ "network.aiming_sync_rate", 30 }`
  (milliseconds). VERIFIED in `open.mp/docs/server/LagCompensation`: "Lag compensation for fired bullets is enabled
  by default"; "Setting it to 0 will disable lag compensation completely and players will have to lead their shots
  (fired ahead of targets)." With it off the server drops bullet packets (`player_pool.hpp`:
  `if ((isLagCompEnabled && *isLagCompEnabled == LagCompMode_Disabled) || !bulletSync.read(bs))`).
  What mode 2 changes was not read in the source (NOT VERIFIED).

### 1.6 Tethers between machines (Just Cause 3: Multiplayer)

VERIFIED in the developers' blog (`moddb.com/mods/just-cause-3-multiplayer/news/jc3mp-11-development-blog-6`,
22 November 2017): "dual tethers have now been completely implemented! We are now working on getting the pull
mechanic implemented." and, under a clip of it, "the pull mechanic sync needs some work." On people: "pedestrians and
enemies are hard to sync properly, pretty much nearly impossible, as we can't load the game on the server." Nothing
published says which machine owns a tether or at what rate it is sent.

### 1.7 Message size on a WebRTC data channel

VERIFIED in RFC 8831, section 6.6: "As long as message interleaving is not supported, the sender SHOULD limit the
maximum message size to 16 KB to avoid monopolization." Its use cases name this game's split: "A real-time game where
position and object state information are sent via one or more unreliable data channels" and "critical state
information ... such as control information" on a reliable one.

## 2. Claims not verified or rejected (do not repeat as fact)

- REJECTED: "JC2-MP sends 20 snapshots a second on a 15 ms tick." The answer's source for those numbers is Valve's
  Source engine networking page, not a Just Cause document.
- NOT VERIFIED: that the source of JC2-MP or JC3:MP is not public (no source for it was opened; none was found either).
- NOT VERIFIED: FiveM OneSync's 424-unit relevance radius, `onesync_forceMigration` on by default, and how a
  ragdolling pedestrian is sent (the answer itself says no source documents the last).
- NOT VERIFIED: "atomic seat transactions" and the seat documents of the project the vehicle answer cites first; 1.1
  above is the checked source for seats.
- NOT VERIFIED: keep an unreliable message under 1,200 bytes; 20-30 Hz near and 2-5 Hz far tiers; 150 KB/s falling to
  under 15 KB/s with interest management; 49 % and 85 % bandwidth cuts (Dyconits); 7.2 KB/s a peer in a peer-to-peer
  design.
- NOT VERIFIED: a server-side arrest state machine in any shipped game; the police answer cites FiveM community
  scripts only.
- NOT FOUND: how Grand Theft Auto Online or Red Dead Online send a ragdoll (the answer says nothing is published).
- NOT FOUND in the reversed San Andreas source at this commit: how a punch decides its hit.
  `TaskSimpleFight.cpp` is 71 lines of calls into the original binary by address.

## 3. How this repo's design compares

| Question | Others (verified above) | This repo |
|---|---|---|
| Who seats a player | The server: checks state and distance, falls back to a free seat, tells everyone seat and door, refuses the asker with a reason (1.1) | The host: `ACT.getIn` with the car, the host fills a seat by row, `MSG.seats` to everyone, a refusal flag to the asker |
| Door versus seat | Separate; a player in by the far front door of a driverless car is slid over (1.2) | The same: the nearest door is the way in, the seat is filled by row, a scoot when they differ |
| Who owns a pedestrian | The nearest player with the fewest (MTA), the machine that made it (CoopAndreas), or nobody: the bulk crowd is not sent at all (AC Unity) (1.3) | The host owns every person; the crowd is computed on each machine from the seed and the event log, and only people with bodies are sent |
| What a pedestrian update holds | Position, rotation, velocity, health; no pose (1.4) | One 20-byte record a person; no joint angles |
| How often | Pedestrians every 400 ms near and 2000 ms far; players every 100 ms (MTA); players every 30 ms (open.mp) (1.4, 1.5) | The frame at 15 Hz |
| A remote shot | The shooter names its victim (MTA); the server rewinds targets by default (open.mp) (1.5) | The host casts the guest's ray when it arrives, with no rewind |
| Tethers | Built, with the pull "needing work" across machines (1.6) | The host owns every cable and solves it; guests send fire, cut and reel as acts and draw what the host holds |
| Message size | 16 KB at most without interleaving (1.7) | The largest message must stay under it: 32 bodies of 20 bytes are 640 bytes |

## 4. What follows for this repo

1. Seats as built match the checked practice. Keep the refusal private to the asker and the grant public; say why in
   the refusal (the row is full, too far) so the guest's text can differ.
2. A guest's shot at a moving target is the open risk: this repo neither rewinds (open.mp's default) nor lets the
   shooter name the victim (MTA). The miss is to be measured after the merge. If it shows in play, the smaller change
   is MTA's: the guest's act names what its own ray met, and the host accepts it when that target is within a bound of
   the ray on the host.
3. A host that owns every person needs no ownership hand-over, which is the part MTA, FiveM and CoopAndreas spend
   their code on. The cost is that the host's machine runs every body; AC Unity's figure (under 92 kbit/s a peer for
   four players, the bulk crowd unsent) says the bandwidth side of this shape is small.
4. Pose records can go far slower than the frame: a shipped project sends a near pedestrian every 400 ms. The 5 Hz
   trial already on the list is inside that practice.
5. No published design exists for a pulling tether between machines; the host-solved cable is this repo's own, and
   its feel on a guest (the car he reels moves through snapshots, 1/30 s apart plus latency) is for the owner to judge.
6. Every new message is checked against 16 KB when its layout is fixed.

## 5. Raw answers

`perplexity/2026-11-22-multiplayer-vehicle-enter-exit.md`, `-coopandreas-ped-and-task-sync.md`,
`-fivem-onesync-ped-ownership.md`, `-gta-online-ragdoll-and-ped-sync.md`,
`-gta-sa-decompilation-melee-and-knockdown.md`, `-just-cause-multiplayer-sync.md`,
`-mta-ped-syncer-and-bullet-sync-source.md`, `-multiplayer-ropes-and-grappling-hooks.md`,
`-relevance-for-many-npcs-on-a-player-host.md`, `-samp-openmp-onfoot-sync-and-lag-compensation.md`,
`-multiplayer-police-and-wanted-state.md`, `-webrtc-datachannel-many-entities.md` (each name prefixed
`perplexity/2026-11-22`).
