> Question: For the open-source cooperative modification CoopAndreas for GTA: San Andreas (and similar cooperative mods with published source): how are pedestrians and their tasks, players' melee attacks and weapons, and vehicles synchronized between the two machines, and which machine owns each pedestrian? Name the files and packets and cite the repository.

The public CoopAndreas repository documents the feature set, but the available indexed material does **not expose enough source detail to verify the exact packet names, file paths, or ownership rules** requested. The README confirms that pedestrian, on-foot combat/weapon, and vehicle synchronization exist, while NPC task synchronization was still listed as unfinished in the project description.[1][2][6]

What can be established from the repository material:

- **Pedestrians:** CoopAndreas has “separate ped sync” and streams pedestrians in and out, but the indexed README does not identify the implementation files or a pedestrian packet format.[1][2]
- **Pedestrian tasks:** The project documentation describes synchronization of NPC tasks as an open/unfinished item, so it should not be assumed that arbitrary pedestrian tasks are fully synchronized.[6]
- **Players’ melee attacks and weapons:** On-foot synchronization includes hit/fight, weapon holding, aiming, lag-shot synchronization, and per-bullet shot synchronization.[1][2] The README distinguishes input-based lag-shot synchronization—sending key presses, which can produce differing results—from outcome-based shot synchronization, where every bullet’s result is synchronized.[6]
- **Vehicles:** Vehicle synchronization covers spawning/deletion, entering/exiting, controls, position, velocity, orientation, health, damage, doors, locks, engine state, colors, paint jobs, tuning, aircraft features, turret aim/shots, and related state.[1][2]
- **Ownership:** The available repository excerpts do not state which machine owns each pedestrian. They only establish that the project supports separate pedestrian synchronization and entity streaming.[1][2]

Therefore, naming specific files and packets—or asserting a per-pedestrian owner—would require inspecting the repository source directly rather than relying on the indexed README excerpts. The relevant upstream repository identified by the search is **topoll113/coopandreas** on GitHub.[1]

[1] GitHub - topoll113/coopandreas: Cooperative multiplayer mod ... (https://github.com/topoll113/coopandreas)
[2] CoopAndreas/README.md at main · NoPressF/CoopAndreas · GitHub (https://github.com/NoPressF/CoopAndreas/blob/main/README.md)
[3] github.com › sametozbalkan › project_gta_sa_coopproject_gta_sa_coop/CLAUDE.md at main - GitHub (https://github.com/sametozbalkan/project_gta_sa_coop/blob/main/CLAUDE.md)
[4] CoopAndreas - GitHub (https://github.com/Tornamic/CoopAndreas/diffs/0?base_sha=235b1545b5607e55e5d56182e285648f2ee9b8e9&head_user=LYZENCORE-9&name=main&pull_number=89&sha1=90abbf7643720d023022dc8d12a8bd913d61099d&sha2=b06ae612527390598736dd36da6bf45c738c32cb&short_path=b335630&w=false)
[5] CoopAndreas for GTA San Andreas (https://libertycity.net/files/gta-san-andreas/230164-coopandreas.html)
[6] CoopAndreas: cooperative multiplayer for GTA San Andreas (https://hysenlabs.com/projects/tornamic-coopandreas)
[7] Tornamic/CoopAndreas: Cooperative multiplayer mod ... (https://github.com/Tornamic/CoopAndreas)
[8] Tornamic (https://github.com/Tornamic)
[9] CoopAndreas/README.md at main · Tornamic/CoopAndreas · GitHub (https://github.com/Tornamic/CoopAndreas/blob/main/README.md)
[10] CoopAndreas - Total Conversions - GTAForums (https://gtaforums.com/topic/1001417-coopandreas/)
