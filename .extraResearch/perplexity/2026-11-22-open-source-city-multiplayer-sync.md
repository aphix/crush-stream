> Question: Which open-source multiplayer projects for open-world city games synchronize pedestrians, players on foot and vehicles between machines? For each, where in its source code is that synchronization implemented, what does it send and how often, and which machine is the authority for a pedestrian? Cite the repositories and documentation.

The search results identify **two projects with enough explicit synchronization information to answer reliably**: SA:COOP and `pedSyncer`. Other results mention multiplayer city simulation but do not document the required code paths, update frequency, or pedestrian authority.

| Project | Where synchronization is implemented | What it sends | How often | Pedestrian authority |
|---|---|---|---|---|
| **SA:COOP** — cooperative GTA: San Andreas mod | The repository’s multiplayer synchronization code; the available repository result confirms synchronized world entities but does not expose file- or function-level paths in the indexed material. | Shared pedestrians, players, vehicles, police, cars, interiors, time, weather, pedestrian dialogue, and police roadblocks. The project claims that all players see the same pedestrians and vehicles, and that nearby entities can transfer as a player moves away.[1] | **Not documented in the available repository result.** | **Not explicitly documented.** The description implies distributed proximity-based ownership—nearby pedestrians and cars move to another player when the first player drives away—but does not state a formal authority rule.[1] |
| **`pedSyncer`** — experimental Alt:V pedestrian synchronizer | The repository’s C# entity-sync resource, using Alt:V’s server/entity synchronization; the search result identifies the project as an Alt:V resource and says it uses C# entity sync.[5] | The server stores pedestrians and streams them to clients; pedestrian changes are transferred to all clients. Pedestrian vehicle wandering is also synchronized through Alt:V vehicle sync.[5] | **Not stated in the available documentation.** | **Primarily the server.** The project explicitly says pedestrians are managed mostly server-side, with the server storing, synchronizing, and streaming them. For a pedestrian’s vehicle wandering, one client performs the wandering and Alt:V synchronizes it to everyone else.[5] |

## Projects that do not meet all requested documentation criteria

- **CoopAndreas** claims synchronization of pedestrians, vehicles, weapons, NPCs, animations, and environmental interactions, but the indexed result does not provide source-code locations, update rates, or an authority model.[2]
- **LEXTOWN-01** states that riders are synchronized while scooters and ambient traffic are local to each client, but the indexed result does not document synchronization code paths, tick rates, or pedestrian authority.[3]
- **Civitas** describes an authoritative TypeScript simulation server and interpolation between server ticks, including citizens and vehicles, but the available result does not give the requested source locations, exact payloads, or pedestrian-specific authority details.[4]

Consequently, **`pedSyncer` is the clearest match for a documented pedestrian-authority model**, while **SA:COOP is the clearest match for a GTA-style open-world city game synchronizing pedestrians, on-foot players, and vehicles**, but its indexed documentation is insufficient for exact packet contents and frequencies.

[1] GitHub - Karimov-Akbar/sa-coop: Cooperative mod for GTA: San ... (https://github.com/Karimov-Akbar/sa-coop/tree/main)
[2] CoopAndreas for GTA San Andreas (https://libertycity.net/files/gta-san-andreas/230164-coopandreas.html)
[3] LEXTOWN-01 — open-source multiplayer block simulator ... (https://github.com/paul-codes-1/lextown)
[4] Civitas: a browser-based multiplayer city builder in three.js and TypeScript ... (https://github.com/reneodlt/civitas)
[5] GitHub - KWMSources/pedSyncer: Experimental resource for AltV to sync peds (https://github.com/KWMSources/pedSyncer)
[6] 2026-10-09-living-crowd-and-world-tools.md (https://open2077.net/devblog/2026-10-09-living-crowd-and-world-tools.md)
[7] GitHub - stateloop-connected/source-courier-city: Stateloop ... (https://github.com/stateloop-connected/source-courier-city)
[8] github.com-citybound-citybound_-_2019-04-05_18-38-25 (https://archive.org/details/github.com-citybound-citybound_-_2019-04-05_18-38-25)
[9] How I keep a multiplayer browser city alive with zero players online (https://dev.to/balakcity/how-i-keep-a-multiplayer-browser-city-alive-with-zero-players-online-5073)
[10] GitHub - connysamp/Pedestrians: A highly optimized, open.mp ... (https://github.com/connysamp/Pedestrians)
