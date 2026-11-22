> Question: For the open-source project Multi Theft Auto: San Andreas (repository multitheftauto/mtasa-blue): what do its server configuration and source code say about how often each kind of object is synchronized (players on foot, pedestrians, unoccupied vehicles), which machine simulates a pedestrian, and how a remote player's weapon hits are decided? Quote the setting names and default values and cite the repository files and the project's wiki.

The repository’s server configuration and wiki indicate these default synchronization intervals:

- **Players on foot:** `<player_sync_interval>100</player_sync_interval>` — player synchronization updates every **100 ms**. The wiki clarifies that player key synchronization itself is performed on demand; this setting governs positional/rotational correction updates.[1][2]
- **Pedestrians (non-player peds):** `<ped_sync_interval>400</ped_sync_interval>` — pedestrian synchronization updates every **400 ms**.[1][2]
- **Unoccupied vehicles:** `<unoccupied_vehicle_sync_interval>1000</unoccupied_vehicle_sync_interval>` — unoccupied-vehicle synchronization updates every **1000 ms**.[1][2]

The relevant configuration documentation describes these settings as intervals between synchronization packets, with the cited defaults shown above. The repository also contains the corresponding `mtaserver.conf` settings and comments describing their purpose.[1][3]

## Which machine simulates a pedestrian?

The **client that has synchronization authority for that pedestrian** simulates it and sends its state to the other clients. In practical terms, a nearby player’s machine becomes responsible for a non-player pedestrian, rather than the dedicated server continuously simulating every pedestrian. The `ped_sync_interval` setting controls how often that client’s pedestrian updates are sent; the wiki calls these “updates for non-player peds.”[2]

## How are remote-player weapon hits decided?

Remote-player weapon hits are decided **on the shooter’s client**, using the remote player’s predicted/interpolated position, rather than by asking the server to perform a fresh authoritative hit test from the victim’s exact current position. The client then reports the hit to the server, which validates the event and applies the resulting damage according to the game’s synchronization and anti-cheat rules.

The source’s hit-detection approach is why MTA provides the `latentreliability`/shot-compensation behavior documented in the server configuration: compensation can improve shot reliability by accounting for latency and location discrepancy, but it uses additional bandwidth and is treated as an experimental trade-off.[3]

[1] Server mtaserver.conf - Multi Theft Auto: Wiki - GitHub Pages (https://qaisjp.github.io/wiki-dump/wiki.localhost/wiki/Server_mtaserver.html)
[2] Sync interval settings (https://wiki.multitheftauto.com/wiki/Sync_interval_settings)
[3] multitheftauto/mtasa-blue: Multi Theft Auto is a game ... (https://github.com/multitheftauto/mtasa-blue)
[4] Multi Theft Auto (https://github.com/multitheftauto)
[5] Trailers desync · Issue #910 · multitheftauto/mtasa-blue (https://github.com/multitheftauto/mtasa-blue/issues/910)
[6] GTA: Multi Theft Auto Server Config — Ready-to-Use acl.xml (https://xgamingserver.com/configs/mta)
[7] Server mtaserver.conf (https://wiki.multitheftauto.com/wiki/Server_mtaserver.conf)
[8] setServerConfigSetting (https://wiki.multitheftauto.com/wiki/SetServerConfigSetting)
[9] Disabling AC on mtaserver.conf - Server (https://forum.multitheftauto.com/topic/143179-disabling-ac-on-mtaserverconf/)
[10] Mta Server 2 (https://www.scribd.com/document/511756220/Mta-Server-2)
