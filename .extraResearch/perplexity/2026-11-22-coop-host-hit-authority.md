> Question: In cooperative (player versus environment) multiplayer games where one player's machine hosts the session, which machine decides whether a joining player's shot or melee attack hit a non-player character? What reasons and measurements have developers published for their choice? Cite sources.

In a **host-based cooperative game**, the host machine normally decides whether a joining player’s shot or melee attack hit an NPC. The joining player sends inputs or an attack request; the host simulates or validates the attack, applies damage, and replicates the result.

## Why developers choose host authority

- **Consistency:** A single simulation prevents different machines from independently deciding that an NPC was hit, avoiding divergent health and world state. An OpenCE networking design, for example, describes the host checking players’ shots and grenades before reporting the result.[1]
- **Trust and cheat resistance:** The client should generally report intent—such as “I fired”—rather than an unquestioned result—such as “this NPC took damage.” Host-side validation can check attack timing, range, line of sight, and whether the target is still valid.
- **Low infrastructure cost:** A listen host avoids the expense of a dedicated server and is commonly considered adequate for cooperative PvE, where cheating has less competitive impact.[8]
- **Authoritative physics:** A published co-op implementation explicitly states that damage is decided by host physics: client-fired shots are recreated as host-side bullets, and resulting damage is sent back to clients.[2]

## The main trade-off: latency

The host’s decision may arrive after a network round trip. That can make a joining player’s hit feel delayed, particularly for melee. Developers therefore sometimes let the attacking client detect the immediate contact and have the host validate it.

One published multiplayer combat framework uses this compromise: the attacking machine detects the hit immediately, while the server checks the report before applying damage. It says this default is suitable for co-op and PvE because the attacker sees contact without waiting for a round trip; fully server-authoritative detection is recommended for competitive PvP, where the attacker instead sees the hit after the round trip.[6][7]

The framework’s validation rules provide concrete measurements: a reported hit must occur during the server’s copy of the attack window, be within weapon reach plus a latency allowance, and target only entities permitted by that attack window.[6][7]

## A notable alternative

Not every host-based design makes the host’s first collision result final. In *Ship of Fools*, the host initially detects a projectile collision, but waits for the other client’s reaction—for example, whether that player dodged or reflected it—before finalizing the outcome. The developer describes the cost as a delay under high ping, followed by correction if the client’s response disagrees with the host’s initial view.[5]

**Bottom line:** for ordinary host-based co-op PvE, the **host is the final authority** on whether an NPC was damaged. Some games improve responsiveness by having the joining player detect the hit locally, but the host still validates or confirms the result; fully client-authoritative damage is generally avoided because it is inconsistent and easy to falsify.

[1] OpenCE/port/linux/NETCODE.md at main · bitmoda/OpenCE (https://github.com/bitmoda/OpenCE/blob/main/port/linux/NETCODE.md)
[2] coop-anything/games/kill-the-crows at main · cranebeaker/coop-anything (https://github.com/cranebeaker/coop-anything/tree/main/games/kill-the-crows)
[3] Very interested, but 1 question about hit-reg before I buy :: Windrose General Discussions (https://steamcommunity.com/app/3041230/discussions/0/802345327968434130/)
[4] OpenCE/port/linux/NETCODE.md at main - GitHub (https://github.com/OpenCommunityEdition/OpenCE/blob/main/port/linux/NETCODE.md)
[5] How Fika Productions set sail with their peer-to- ... (https://unity.com/blog/games/couch-co-op-multiplayer-ship-of-fools)
[6] Multiplayer (https://rigbak.com/docs/universal-combat-framework/player/multiplayer)
[7] Multiplayer (https://rigbak.com/docs/universal-player-combat/multiplayer)
[8] Gamedev Multiplayer (Grade A) - Claude Skill (https://www.skillsdirectory.com/skills/lza6-gamedev-multiplayer)
[9] godot-superpowers/skills/networking-foundation/SKILL.md at 9fe9026722ae6cccd941dc3de7d33b90d8886ee4 · Simone-Tarantino/godot-superpowers (https://github.com/Simone-Tarantino/godot-superpowers/blob/9fe9026722ae6cccd941dc3de7d33b90d8886ee4/skills/networking-foundation/SKILL.md)
[10] LuauAISkill/handbook/roblox/15-combat.md at main · adaybekovt-boop/LuauAISkill (https://github.com/adaybekovt-boop/LuauAISkill/blob/main/handbook/roblox/15-combat.md)
