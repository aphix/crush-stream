> Question: For the multiplayer modifications of Just Cause 2 and Just Cause 3: what has been published (source code, developer blogs, talks, documentation) about how they share players on foot, the grappling hook and tethers, vehicles and non-player characters between machines, which machine is the authority for each, and at what rates? Say whether their source code is public, and cite sources.

The public record is **much stronger for JC3-MP than for JC2-MP**, but neither project appears to have published a complete, authoritative networking specification covering every entity and exact per-entity rate. The available material supports the following picture.

| Feature | JC2-MP | JC3-MP |
|---|---|---|
| **Players on foot** | Server-authoritative multiplayer simulation is documented in general networking material: clients send input, while the server has final authority and corrects client positions. The commonly documented snapshot default is **20 updates/s**, with a default server simulation timestep of **15 ms**—about **66.7 ticks/s**—although mods can choose another tick rate.[1] | JC3-MP’s public documentation describes players and authoritative events, and later project announcements say the player-replication system was substantially rewritten and re-architected. However, the cited public material does not specify a separate player update rate or provide a full authority diagram.[2][7] |
| **Grappling hook** | The mod retained the grappling hook, but no located primary technical publication specifies whether the hook simulation, rope endpoints, or pull forces were server- or client-authoritative, nor gives a dedicated transmission rate. General server snapshots should not be mistaken for a published grapple-specific rate.[4] | The developers published a development blog stating that **dual tethers had been implemented**, while the **pull-mechanic synchronization still needed work**. This establishes that tether state was being networked, but does not publish an exact rate or a definitive authority split for rope physics.[9] |
| **Tethers** | No public source located here documents tether replication in sufficient technical detail. | Dual-tether networking is explicitly discussed in the developer blog; the pull mechanic was not yet synchronized reliably at the time of that post.[9] |
| **Vehicles** | Vehicles were part of the shared multiplayer world, and server configuration exposed vehicle-related synchronization settings. The general networking model indicates server snapshots and server authority, but no JC2-specific public source in the available material gives a vehicle-specific rate or says precisely which side simulated vehicle physics.[4][1] | Vehicles are listed among the entities supported by the public documentation, and the project later described improvements to player and vehicle replication. No exact vehicle update frequency or complete authority specification is provided in the cited material.[2][7] |
| **NPCs / pedestrians / enemies** | The available material does not establish a functioning, fully synchronized NPC system. A contemporary community description says NPCs did not work, but that is not a formal technical specification.[8] | The developers explicitly said pedestrians and enemies were extremely difficult to synchronize because the game could not be loaded on the server. They described NPC/AI synchronization as a future possibility rather than an already completed system.[9] |

## Authority and rates

The clearest published networking numbers come from the general multiplayer networking documentation rather than from a JC2-MP or JC3-MP entity specification:

- Server simulation: default **15 ms timestep**, approximately **66.7 ticks/s**.[1]
- Client world snapshots: default **20 snapshots/s**, approximately one update every **50 ms**.[1]
- The server cannot send more than one snapshot per simulation tick, and client-requested rates are constrained by server tick rate and bandwidth.[1]
- The server retains final authority over client movement and corrects client-side prediction.[1]

Those figures describe a snapshot-based client/server model, but they **do not prove that every JC2-MP or JC3-MP entity was transmitted at 20 Hz**. In particular, the located sources do not publish separate rates for player transforms, vehicles, grapples, tether forces, or NPC state.

## Is the source code public?

- **JC2-MP:** No public source repository or complete source-code release is identified by the available material. The project is described as a mod with server-side Lua scripting, but scriptability is not the same as publication of the engine/mod source.[4]
- **JC3-MP:** No complete public source-code release is identified by the available material. The public documentation exposes APIs, entities, events, and networking interfaces, but those are developer-facing interfaces rather than the mod’s underlying source code.[2][3]

## Bottom line

The defensible conclusion is that both projects used a **server-mediated replication model**, with the server authoritative at least for ordinary multiplayer state and player correction, and with snapshots commonly documented at **20 Hz** over a server simulation running at roughly **66.7 Hz** by default.[1] JC3-MP publicly documented the difficult parts—dual-tether synchronization and the inability to run the game’s NPC logic on the server—but did **not** publish a complete per-entity authority/rate specification.[9] For JC2-MP, the available public record is even less specific: it confirms shared players, vehicles, and the retained grapple feature, but not the detailed replication design or exact rates.[4]

[1] source_multiplayer_networking.md (https://gist.github.com/CoolOppo/fe0586836de3fb2f90f9)
[2] JC3MP | Just Cause 3 Multiplayer (https://just-cause.mp/docs)
[3] JC3MP | Just Cause 3 Multiplayer (https://just-cause.mp/)
[4] Just Cause 2: Multiplayer Mod Server Hosting - JC2-MP ... (https://physgun.com/games/just-cause-2-multiplayer-mod-server-hosting/)
[5] Just Cause 3 Multiplayer (https://justcause.fandom.com/wiki/Just_Cause_3_Multiplayer)
[6] Just Cause 2 Cheats, Codes, Secrets and Easy Money Tips (https://www.cheatbook.de/files/justcause2.htm)
[7] Steam Community :: Just Cause™ 3: Multiplayer Mod (https://steamcommunity.com/app/619910/)
[8] Just Cause 2 Multiplayer mod back in development (https://www.reddit.com/r/Games/comments/v5eeg/just_cause_2_multiplayer_mod_back_in_development/)
[9] JC3:MP - 1.1 Development Blog #6 news - Just Cause 3: Multiplayer mod for Just Cause 3 (https://www.moddb.com/mods/just-cause-3-multiplayer/news/jc3mp-11-development-blog-6)
[10] Just Cause 2 Controls & MP Commands (https://steamcommunity.com/sharedfiles/filedetails/?l=brazilian&id=520894849)
