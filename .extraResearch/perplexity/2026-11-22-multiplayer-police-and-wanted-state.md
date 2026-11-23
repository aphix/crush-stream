> Question: In multiplayer open-world games and modifications with police or other non-player characters that pursue and arrest players: how is it decided which player they pursue, which machine runs their pursuit, and how do all machines come to show the same arrest? Cite source code, documentation or developer write-ups.

There is no single universal rule: commercial games often keep police AI proprietary, while multiplayer frameworks typically separate the problem into **target selection**, **network ownership**, and **authoritative state replication**.

## 1. Which player gets pursued?

A pursuit normally begins when a crime, wanted-state change, or dispatch event is attributed to a particular player. The dispatch system stores that player as the incident’s target and assigns responding units to them. A useful open-source FiveM example says its entities are “recorded against the player they were spawned for,” and that its units can chase other players across the session.[1]

The important distinction is between:

- **The pursuit target:** the player identified by the crime or dispatch event.
- **The nearest visible player:** potentially relevant for perception, pathfinding, or ownership, but not necessarily the wanted suspect.
- **The unit’s current controller:** the machine simulating the police ped or vehicle.

Thus, a police unit may be physically closest to Player B while still pursuing Player A. A robust implementation carries an explicit suspect/player identifier rather than inferring the target from proximity.

## 2. Which machine runs the pursuit?

In a peer-assisted network model, each networked NPC is generally simulated by one machine at a time. The owner runs the entity’s movement, vehicle physics, and often local AI, then sends state to the server and other clients. OneSync documentation describes this as one client simulating each networked entity while the server retains an authoritative state copy and controls routing.[2]

Ownership is commonly proximity-based and migrates:

- The nearest relevant client may become the NPC’s owner.
- Ownership can move as players approach or leave.
- If the owner disconnects or leaves the relevant area, another client can take over.[2][3]

That means **the player being pursued does not necessarily simulate the pursuing police**. The police may be controlled by a nearby third player’s machine, by the suspect’s machine, or—depending on the framework and entity state—by the server.

FiveM examples illustrate both design choices:

- Fenix Police Response spawns police server-side, sends network IDs to the requesting client, and attempts to keep that client responsible for controlling the units.[1]
- OneSync-style ownership can later migrate control according to proximity, so “spawned by” and “currently simulated by” are distinct concepts.[2][3]

A server-created NPC is therefore not automatically server-simulated forever. The implementation must explicitly account for ownership migration, culling, and reassignment.

## 3. How do all machines show the same arrest?

The arrest should be treated as a **networked state transition**, not merely as an animation that each client independently guesses.

A typical sequence is:

1. The controlling client detects that the suspect satisfies arrest conditions—such as being incapacitated, restrained, stopped, or within an arrest interaction range.
2. It sends an arrest request containing stable network identifiers: suspect player ID, police entity ID, incident/pursuit ID, and possibly a sequence number.
3. The server validates the request against authoritative state—identity, distance, entity existence, permissions, and whether the pursuit is still active.
4. The server commits an idempotent result such as `Arrested`, `Cuffed`, or `PursuitEnded`.
5. The server broadcasts that result to every relevant client.
6. Each client applies the same state locally: stop pursuit behavior, play synchronized restraint/arrest effects, update wanted status, and prevent duplicate completion.

Network IDs are the key mechanism for referring to the same NPC or player on every machine. The FiveM material describes network IDs as the shared identifier for an entity across the session and recommends converting entities to network IDs before sending them in events.[4]

The arrest event should be **server-authoritative** because client-reported animations alone are vulnerable to races and cheating. For example, two clients might simultaneously claim an arrest, or an old owner might report an arrest after ownership has migrated. A server-side state machine can accept only the first valid transition:

\[
\text{Pursuing} \rightarrow \text{Arrested}
\]

and reject later or conflicting transitions. The broadcast then makes all clients converge on the same committed result, even though each machine may render the animation slightly differently.

## 4. What should be synchronized?

A practical pursuit record would contain at least:

- `incidentId`
- `suspectPlayerId`
- `policeEntityNetId`
- `currentOwner`
- `pursuitState`
- `arrestState`
- `stateVersion` or sequence number
- server timestamp or tick

The **server should replicate facts and state**, while clients handle presentation. For example, the server should decide that a suspect is arrested; clients can independently play the cuffing animation, attach the officer’s escort behavior, and display UI.

This also handles late joiners and relevance culling: a newly relevant client receives the current pursuit/arrest state rather than trying to reconstruct the entire history from local AI.

## 5. Source-backed implementation examples

- Fenix Police Response states that police units are spawned server-side and their network IDs are sent to the requesting client so they can be controlled and synchronized across clients.[1]
- Its later documentation says helicopters and planes are created server-side with ownership recorded directly, while some ground units are created client-side and registered through server-issued authorization.[1]
- OneSync entity documentation states that one owner simulates a networked entity, the server holds the authoritative copy, and ownership can migrate when relevance changes.[2]
- FiveM entity-ownership guidance identifies `NetworkGetEntityOwner(entity)` as the way to determine which client currently owns an entity for actions requiring that owner.[3]
- The same guidance emphasizes using network IDs when passing entities between machines.[4]

The concise answer is: **the crime or dispatch system chooses the suspect; an ownership system chooses which machine currently simulates each police entity; and a server-authoritative, replicated arrest state makes every client converge on the same outcome.**

[1] GitHub - Geckomacabre/fenix-police: AI Police Dispatch Mod for FiveM (https://github.com/Geckomacabre/fenix-police)
[2] github.com · FenixPK · fenix-policeGitHub - FenixPK/fenix-police: AI Police Dispatch Mod for FiveM (https://github.com/FenixPK/fenix-police)
[3] GitHub - DaemonAlex/dps-badpeds: Police NPC interaction ... (https://github.com/DaemonAlex/dps-badpeds)
[4] Progress on our GTA:SA multiplayer project: showing shared wanted level and police AI (https://www.reddit.com/r/sanandreas/comments/1wtmnxi/progress_on_our_gtasa_multiplayer_project_showing/)
[5] FiveM Network IDs & Entity Ownership: NetToVeh, Request ... (https://fivesecured.com/guides/fivem-entity-ownership)
[6] FiveM OneSync Infinity Guide — Enable OneSync & Fix ... - YourScript (https://www.your-script.com/guides/fivem-onesync-infinity-guide)
[7] fivem-skills/skills/fivem-development/references/onesync-entities.md at main · aggus19/fivem-skills (https://github.com/aggus19/fivem-skills/blob/main/skills/fivem-development/references/onesync-entities.md)
[8] ExternalPoliceComputer - Page 3 - Script Modifications & ... (https://www.lcpdfr.com/downloads/gta5mods/scripts/45400-externalpolicecomputer/page/3/)
[9] [FREE] Fenix Police Response (AI Police) - Page 2 - FiveM Releases (https://forum.cfx.re/t/free-fenix-police-response-ai-police/5251341?page=2)
[10] GTA 5's Police Could Use Some Tweaking (https://www.gtaboom.com/GTA_5's_Police_Could_Use_Some_Tweaking)
