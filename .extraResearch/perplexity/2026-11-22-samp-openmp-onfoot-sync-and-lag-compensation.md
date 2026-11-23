> Question: For San Andreas Multiplayer and its open-source successor open.mp: what does a player-on-foot synchronization packet contain, how often is it sent, how are remote players' shots and melee hits decided, and what lag-compensation modes exist and how do they work? Quote setting names and defaults and cite the repositories and documentation.

For SA-MP and open.mp, the player-on-foot update is the **PlayerFootSync** packet (packet ID **207**). It is sent by the client at the configured on-foot interval—**30 ms by default** in open.mp, approximately 33 updates per second.[1][10]

## On-foot synchronization contents

The packet represents the sending player’s current on-foot state. In the open.mp network implementation, the corresponding structure contains:

- Player position: \(X,Y,Z\)
- Movement velocity: \(X,Y,Z\)
- Facing angle
- Health and armour
- Current weapon
- Special action
- Animation data
- Player keys/input state
- Surfing entity and surfing offsets
- Fighting style
- Seat/action-related state where applicable

The packet’s purpose is to synchronize the player’s position and state; it is distinct from the aim and bullet packets, which separately carry aiming and shooting information.[10]

The precise wire layout is inherited from the SA-MP protocol and can vary slightly between protocol revisions, but the important distinction is that **ordinary on-foot movement is not the same packet as weapon aiming or bullet-hit reporting**. open.mp identifies separate `PlayerAimSync` (203) and `PlayerBulletSync` (206) packets.[10]

## How often it is sent

The open.mp setting is:

```text
network.on_foot_sync_rate 30
```

The value is in milliseconds: a client sends new on-foot data every **30 ms by default**.[1]

The legacy `server.cfg` name is:

```text
onfoot_rate 30
```

open.mp documents the same default and meaning for the legacy setting.[3] Lowering the interval increases update frequency and bandwidth consumption.[1][3]

While firing, a separate weapon/aiming update rate applies:

```text
network.aiming_sync_rate 30
weapon_rate 30
```

Both are documented with a 30 ms default; they are not substitutes for the ordinary on-foot packet.[1][3]

## Who decides remote-player shots?

For ordinary bullet weapons, the **shooter’s client reports the shot**, but the server applies lag compensation and validates the result. With lag compensation enabled, the server rewinds the target’s recorded position to the appropriate historical point, so the shooter generally aims at where the target appeared on that client rather than leading the target by network latency.[6]

The relevant server callback is `OnPlayerWeaponShot`; open.mp states that disabling lag compensation prevents this callback from being called.[6] The separate bullet synchronization packet is identified as `PlayerBulletSync` (ID 206).[10]

Thus, the remote player’s local visual position does not by itself decide the hit. The server’s lag-compensation mode, historical player state, weapon rules, and validation determine whether the reported shot becomes damage.

## Who decides melee hits?

Melee attacks are not handled like lag-compensated firearm shots. The client supplies movement, facing, weapon, and animation/input state through synchronization, but the **server performs the authoritative game-side damage decision** using the synchronized state. There is no equivalent general “rewind the target and ray-test the punch” mechanism documented for firearm lag compensation.

Consequently, melee can feel more latency-sensitive than hitscan firearms: the server must receive a sufficiently current attack state and determine whether the synchronized players are in a valid melee relationship. The documented lag-compensation modes specifically describe firearm/player-position compensation, not a separate melee-hit rewind system.[2][6]

## Lag-compensation modes

The setting names and defaults are:

| Configuration | Default | Meaning |
|---|---:|---|
| `lagcompmode` | `1` | Fully enable lag compensation.[3] |
| `game.lag_compensation_mode` | `1` | open.mp `config.json` equivalent.[1] |

The modes are:

- **`0` — Fully disabled.** The server does not rewind targets for compensated bullet shots; players must lead shots according to the target’s movement and latency. open.mp also documents that `OnPlayerWeaponShot` is not called in this mode.[6]
- **`1` — Fully enabled; default.** Both the target’s historical position and rotation are compensated for firearm hit detection.[1][3]
- **`2` — Position-only compensation.** Historical target position is used, but target rotation is not lag-compensated.[1][3]

The legacy `lagcomp` setting is a read-only status indicator: open.mp documents it as automatically becoming **`On`** or **`Off`** according to `lagcompmode`, rather than as the primary mode-selection setting.[3]

In short: **on-foot movement arrives through `PlayerFootSync` about every 30 ms by default; firearm shots use separate aim/bullet synchronization and server-side lag compensation; and melee is resolved from synchronized gameplay state rather than through the documented firearm rewind modes.**

[1] config.json (https://open.mp/docs/server/config.json)
[2] wootguy/LagCompensator: Sven Co-op plugin (https://github.com/wootguy/LagCompensator)
[3] server.cfg (https://open.mp/docs/server/server.cfg)
[4] SA-MP server.cfg Explained: Every Setting and Default (https://help.freakhosting.com/games/samp/samp-server-cfg-explained)
[5] samp-weapon-config/README.md at 049f7f2f76b3a3d03367769f2fec5ae715b4f412 · oscar-broman/samp-weapon-config (https://github.com/oscar-broman/samp-weapon-config/blob/049f7f2f/README.md?plain=1)
[6] Lag Compensation | open.mp (https://open.mp/docs/server/LagCompensation)
[7] github.com › San-Andreas-Online › openopen.mp-web/frontend/docs/server/LagCompensation.md ... - GitHub (https://github.com/San-Andreas-Online/open.mp-web/blob/master/frontend/docs/server/LagCompensation.md)
[8] sampctl/docs/runtime-configuration-reference.md at master (https://github.com/Southclaws/sampctl/blob/master/docs/runtime-configuration-reference.md)
[9] Whitetigerswt/lagcomp-spoof: Hack client side SA-MP to ... (https://github.com/Whitetigerswt/lagcomp-spoof)
[10] Network Architecture | openmultiplayer/open.mp | DeepWiki (https://deepwiki.com/openmultiplayer/open.mp/2.4-network-architecture)
