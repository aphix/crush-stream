> Question: What did Bungie's David Aldridge publish in the GDC 2011 talk 'I Shot You First: Networking the Gameplay of Halo: Reach' about how the game networked ragdolls and other physically simulated objects: what was sent, when, to whom, and what figures were given? Cite the talk, its slides or its transcript.

Aldridge’s key point was that **Halo: Reach stopped continuously networking ragdolls**. The host sent only the corpse’s **initial physical state at the instant of death**—its starting transform and the impulse/velocities needed to begin the simulation—to the other relevant peers; each Xbox then simulated the ragdoll locally from that common starting point. This preserved a roughly matching corpse location without transmitting every bone’s subsequent motion.[1][2][5]

The talk’s broader networking model was relevance- and priority-based: object state was sent to each client at a rate appropriate to that client’s interest in the object. A combat-relevant object could be updated frequently, while an unimportant ragdoll—such as one rolling behind the player—could be updated much less often.[3] Reach’s design avoided that recurring traffic altogether for ragdolls, rather than trying to compress and replicate their many independently moving bones.[2]

The associated figures reported for Reach’s networking included:

- **16 players** in a hosted-client game, with one player’s Xbox acting as the server.[8]
- About **250 kbit/s minimum total upstream** for the host in a solid 16-player game.[8]
- About **675 kbit/s maximum total upstream** from a single peer.[8]
- About **45 kbit/s maximum bandwidth sent by the host to one client**.[8]
- About **1 kbit/s** of host upstream to replicate one biped to one client during combat, at **10 Hz**.[8]
- **10 Hz** as the minimum packet rate cited for solid gameplay.[8]
- Ragdolls had been synchronized in earlier Halo games, whereas in *Reach* only their **initial state** was synchronized.[8]
- Eliminating ongoing ragdoll replication was described in later summaries as saving roughly **10–12% of total bandwidth**.[2]

There were two gameplay accommodations behind the approach. Dead bodies were made effectively irrelevant to projectile collision—bullets and grenades could over-penetrate them—so divergent local ragdoll motion would not create inconsistent hit results. The initial synchronization still kept bodies approximately aligned for visual continuity and for interactions such as players standing or crouching over corpses.[1][2]

The primary source is David Aldridge’s GDC 2011 session, **“I Shot You First: Networking the Gameplay of HALO: REACH,”** listed by GDC Vault as a Bungie programming talk.[5] Bungie also published the presentation slides, including a lightweight version.[4][7]

[1] Game Backend Deep Dive - Halo: Reach - Edgegap (https://edgegap.com/blog/game-backend-deep-dive-halo-reach-netcode-host-migration)
[2] Bungie Slashes Reach Bandwidth 80% by Rewriting Mechanics Over Code | Stream Reducer (https://reducer.xgoose.org/items/7579)
[3] GDC Session Summary: Halo networking (https://www.wolfire.com/blog/2011/03/GDC-Session-Summary-Halo-networking/)
[4] Ten Years of Keeping People Working at Bungie (https://bnetarchive.haloman30.com/news/content7a82.html?type=news&cid=28776)
[5] I Shot You First: Networking the Gameplay of HALO - GDC Vault (https://www.gdcvault.com/play/1014346/I-Shot-You-First-Networking)
[6] Bungie: Massively multiplayer action game GDC slide was a "joke" (https://www.vg247.com/bungie-massively-multiplayer-action-game-gdc-slide-was-a-joke)
[7] Bungie.net : Publications (http://bnetarchive.haloman30.com/inside/publications.html)
[8] How to Run at 60Hz (https://networkedgraphics.org/2011/05/13/halo-reach/)
[9] GDC: Bungie's Next Game Is An MMO (https://www.ign.com/articles/2011/03/04/gdc-bungies-next-game-is-an-mmo)
[10] GitHub - gafferongames/GameNetworkingResources: A ... (https://github.com/gafferongames/GameNetworkingResources)
