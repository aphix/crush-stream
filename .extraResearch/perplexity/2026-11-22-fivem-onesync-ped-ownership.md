> Question: For FiveM's OneSync (open-source, GTA V): how is the state of pedestrians, players on foot and vehicles shared between machines, which machine owns a pedestrian and how does ownership move, what ranges and update rates are used, and how is a ragdolling pedestrian handled? Cite the repository files and documentation.

OneSync uses a **server-aware, client-simulated** model: the server tracks networked entities and routes synchronization data, but the client that owns an entity normally performs its GTA V simulation and submits synchronization nodes. Other clients receive the server-forwarded state while the entity is relevant to them.[3]

## What is synchronized

- **Players on foot and pedestrians:** Their network entity state is sent through synchronization nodes. OneSync’s documentation describes sync nodes as the data structures used to transmit state for networked entities, including player/game-event data.[3]
- **Vehicles:** Vehicles are likewise networked entities with synchronization nodes. Their position, movement and other GTA networking state are authored by the current owner and forwarded through the server to relevant clients.[3]
- **Server routing:** With OneSync enabled, the server has full state awareness and determines which clients receive which entities; it is not simply an unaware peer-to-peer relay.[4]

The exact fields are GTA V’s synchronization-node data rather than a single generic “pedestrian packet.” The repository implementation is organized around entity sync nodes and player sync data; the public documentation identifies the architecture, but does not provide one stable, exhaustive field-by-field protocol specification.[3]

## Ownership and migration

Each networked entity has one current **owning client**—the client responsible for simulating it and sending its authoritative sync updates. Ownership generally follows relevance/proximity rather than being permanently tied to the creator.[1]

Ownership changes when the current owner becomes irrelevant, leaves the relevant area, or disconnects. The server can force migration in those cases; `onesync_forceMigration` is documented as enabled by default.[4] If no relevant client remains, the entity can become server-owned/orphaned depending on its creation and orphan mode; server ownership does not necessarily mean that the server is running normal GTA physics or pedestrian AI.[7]

For scripts, `NetworkGetEntityOwner(entity)` returns the current owner, while `NetworkGetFirstEntityOwner(entity)` identifies the original owner/creator. Ownership should therefore be queried immediately before an operation that requires control rather than cached.[7]

## Range and update frequency

The standard OneSync relevance/culling radius is approximately **424 GTA units around each player**.[1][7] Entities outside that scope are locally removed from a client’s view; they remain tracked by the server and may be streamed back when relevant again.[7]

Synchronization frequency is distance-sensitive when `onesync_radiusFrequency` is enabled: nearby entities receive more frequent state updates, while distant relevant entities are updated less often.[4] The documentation does not define this as one universal fixed tick rate for every entity type; the effective rate depends on the entity’s distance and the applicable sync-node/update path.[4]

`onesync_distanceCulling` additionally removes entities that are beyond the relevant distance and outside the client’s view matrix.[4]

## Ragdolling pedestrians

A ragdolling pedestrian remains a networked pedestrian entity; ragdoll is represented as part of the pedestrian’s synchronized game state rather than by transferring ownership specially. The owner continues simulating the ped and sends its state, while the server routes that state to clients for which the ped is relevant.[3]

When the owner becomes irrelevant or disconnects, normal ownership migration applies—even while the ped is ragdolling—subject to the server’s migration/orphan rules.[4][7] Thus ragdolling does not make the ped permanently client-local or server-owned; it is an ordinary state of an entity whose simulation authority can move.

The public OneSync documentation specifies the sync-node and ownership architecture, but it does **not** document a special ragdoll-specific range, rate, or ownership exception. Any claims of a dedicated ragdoll packet or fixed ragdoll update frequency would therefore go beyond the documented behavior.[3]

[1] State bags, OneSync and entity ownership | fivemad Docs (https://fivemad.com/docs/development/state-bags-onesync)
[2] FiveM OneSync: Scope, Ownership and Routing Buckets (https://fivemdocs.com/ops/onesync)
[3] OneSync | FiveM Documentation (https://docs-backend.fivem.net/docs/scripting-reference/onesync/)
[4] Server Commands - Cfx Documentation (https://docs.fivem.net/docs/server-manual/server-commands/)
[5] Migrating from Other GTAV Multiplayer Platforms (https://docs.fivem.net/docs/scripting-manual/migrating-from-other-platforms/)
[6] OneSync and OneSync Infinity Explained (FiveM) (https://fivem-minimaps.com/guides/fivem-onesync-infinity)
[7] fivem-skills/skills/fivem-development/references/onesync-entities.md at main · aggus19/fivem-skills (https://github.com/aggus19/fivem-skills/blob/main/skills/fivem-development/references/onesync-entities.md)
[8] FiveM OneSync Infinity Guide — Enable OneSync & Fix ... - YourScript (https://www.your-script.com/guides/fivem-onesync-infinity-guide)
[9] FiveM OneSync Explained 2026: Legacy vs Infinity, Slots and How It Works (https://space-node.net/blog/fivem-onesync-explained-2026)
[10] How to Enable OneSync on FiveM (2026) | ESAGAMES (https://esagames.ro/how-to-enable-onesync-on-fivem/)
