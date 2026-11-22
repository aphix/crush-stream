> Question: In a multiplayer game one player's machine is the authority for the world and the other players send it their actions. A remote player aims and fires (or swings a melee attack) against a view of the world that is older than the authority's by the network delay plus the interpolation delay his machine draws with. How do shipped games and open-source projects handle a remote player's shots and melee hits in that situation? What has been measured or published about the hit-registration error, the limits they place on it, and how players experience it? Cite sources.

The standard solution is **server-side lag compensation**: the authority keeps a short history of player poses and hitboxes, estimates the instant represented by the shooter’s view, rewinds the relevant targets to that instant, performs the hit test, then restores the current state. Without this, the server tests against the present and systematically rejects shots that were visually valid on the shooter’s machine.[1][3]

## How shipped games handle it

- **Source-engine games** expose the classic model. The server stores historical player positions and rewinds hitboxes when processing a fire command. The rewind is based on the shooter’s latency and interpolation delay; Source also exposes a maximum-unlag limit so clients cannot validate hits arbitrarily far in the past.[10]
- This deliberately favors the shooter’s view. A player can therefore be hit shortly after reaching cover—the familiar **“shot around the corner”** effect—because the attacker’s rewind places the victim back in the exposed position.[7]
- The tradeoff is bounded. Published discussions commonly describe practical rewind windows around **200–350 ms**, with values above roughly **400 ms** becoming problematic; one study summarized in the available material found **250 ms** reasonable for a target moving at \(4\ \mathrm{m/s}\).[1][7]
- Unreal projects generally implement the same pattern rather than relying on the client’s hit report: snapshot hitboxes each server tick, send a shot time or frame plus interpolation information, interpolate between historical snapshots, and perform authoritative box/capsule or trace intersection tests.[2]

For melee, the principle is the same, but games often use a server-authoritative attack event with a rewinded overlap or swept-volume test. The server may rewind only the candidate victim(s), rather than the entire world, to reduce cost; an open-source Unreal implementation explicitly describes rewinding the character identified by the client-side trace and checking its historical hitboxes.[2]

## What has been measured or published

The strongest quantitative result in the supplied material comes from an open-source deterministic testbed. It compared the shooter’s local verdict with the server’s verdict under simulated network conditions:

- With no lag compensation—testing against the server’s current world—the agreement rate fell from **92.6% to 52.9%** as latency increased.
- With server-side rewind, agreement remained between **88.2% and 100.0%** across the tested profiles.[4]

That is agreement with the client’s intended hit or miss, not proof that every hit is physically fair: the rewind can still produce outcomes inconsistent with what the victim currently sees. The principal measurable residual is spatial error during the rewind interval. If the target’s relative speed is \(v\), and the uncorrected time difference is \(\Delta t\), the apparent position discrepancy is approximately

\[
e \approx v\Delta t.
\]

Thus a \(4\ \mathrm{m/s}\) target displaced by \(250\ \mathrm{ms}\) is about \(1\ \mathrm{m}\) from its current position. This explains why a 250-ms cap can be considered usable for ordinary movement but visibly unfair in fast encounters.[7]

## Limits and failure cases

Implementations typically impose several limits:

- **Maximum rewind time:** commonly a few hundred milliseconds in competitive designs; Source’s documented/default-style limit is much more generous—up to about one second in some discussions—but that permits more conspicuous corner shots and is not a universal recommendation.[10]
- **History duration:** only a finite ring buffer is retained. An open-source Unreal implementation stores approximately **three seconds** of snapshots, though its acceptable validation window can be much shorter.[2]
- **Timestamp clamping:** the server clamps a reported shot time to the permitted rewind window, preventing a client from inventing an old timestamp.[1]
- **Interpolation-aware timestamps:** the relevant instant is not merely packet arrival time; it approximates the state the shooter displayed, including one-way network delay and the shooter’s interpolation buffer.[3][10]
- **Uncompensated high latency:** players beyond the permitted window either receive reduced hit-registration quality or are not compensated fully. A survey of game behavior cited a **250-ms** cutoff for Battlefield 4 and Overwatch, with that threshold judged reasonable for the stated movement speed.[7]

## How players experience it

Players generally perceive two opposite errors:

- **Shooter-side misses without compensation:** “I was clearly on target” shots fail because the server sees the target after it has moved. The testbed’s fall to 52.9% agreement under increasing latency illustrates how severe this can become.[4]
- **Victim-side retroactive hits with compensation:** a player reaches cover, then dies because the attacker’s valid historical view still showed them exposed—the “shot around the corner” effect.[7]

Consequently, lag compensation does not eliminate networking error; it **chooses whose view receives priority** and bounds the resulting disagreement. Shipped games usually prioritize the shooter for responsive gunplay, cap the rewind to limit abuse and corner deaths, and accept that high-latency players—and players fighting high-latency opponents—will occasionally see visibly inconsistent hits. Melee attacks face the same compromise, often more noticeably because a few tens of milliseconds can move a target across the edge of a short-range sweep.

[1] Server-Authoritative Game Logic to Prevent Cheating in Multiplayer ... (https://accelbyte.io/blog/server-authoritative-logic-to-prevent-cheating)
[2] github.com · fromEON · Unreal_Server-Side-Rewind-UE5Hit detection using Server Side Rewind Unreal Engine 5 (https://github.com/fromEON/Unreal_Server-Side-Rewind-UE5)
[3] Real-time Gaming (https://system-design.space/en/chapter/real-time-gaming-case/)
[4] GitHub - kienpt91/snapshot-netcode: Clean-room C# netcode building blocks for Unity multiplayer: client prediction and reconciliation, snapshot interpolation, lag compensation, bounded bit-packing, with a seeded network simulator (https://github.com/kienpt91/snapshot-netcode)
[5] A Game Server's Latency Budget Is Four Lines, and Ping Is the Smallest (https://www.surfercloud.com/blog/game-server-latency-budget-not-ping)
[6] Unreal Engine 5 Network Prediction, Lag Compensation, and ... (https://www.cosmiclearn.com/ue5/network-prediction-lag.php)
[7] Hitscan (https://www.edgepedia.org/hitscan)
[8] Hit Can’t Miss — dalerank (https://dalerank.github.io/en/articles/lag-compensation.html)
[9] GitHub - ToddyTreaks/TPS-Multi_ServerRewind: A third person ... (https://github.com/ToddyTreaks/TPS-Multi_ServerRewind)
[10] Game Dev: Multiplayer Networking | Andrews Notebook (https://andrewaltimit.github.io/Documentation/docs/gamedev/multiplayer-networking.html)
