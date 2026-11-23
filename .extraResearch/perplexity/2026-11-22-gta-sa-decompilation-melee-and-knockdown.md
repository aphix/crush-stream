> Question: Decompilation and reverse-engineering projects exist for Grand Theft Auto: San Andreas and the earlier 3D games. What do their published sources show about how a punch or other melee attack is decided to have hit a pedestrian (reach, timing, who can be hit), what happens to the pedestrian that is hit, and how a pedestrian is knocked down by a car? Name the repositories, files and functions, and cite them.

The published sources support a fairly clear division of responsibility, although the San Andreas repositories do not expose every original routine as readable C++: many methods remain address-bound wrappers into the original game binary.

## San Andreas

The principal repositories are **gta-reversed/gta-reversed** and **DK22Pac/plugin-sdk**.

- `source/game_sa/Entity/Ped/PlayerPed.cpp` defines or binds player targeting and attack-related routines. `CPlayerPed::FindPedToAttack()` constructs a horizontal search direction from the camera and considers space extending roughly 100 game units forward; the file binds the original routine at `0x60C5F0`.[1]
- `plugin_sa/game_sa/CPlayerPed.cpp` contains the corresponding SDK wrapper for `CPlayerPed::FindPedToAttack()`, confirming that this part of the published project is an address-level reconstruction rather than a complete source implementation.[4]
- `PlayerPed.h` lists the related target-selection methods, including `FindPedToAttack`, `EvaluateTarget`, `EvaluateNeighbouringTarget`, `FindTargetPriority`, and `DoesTargetHaveToBeBroken`. These names show that reach is only one stage: target priority, neighbouring-target evaluation, weapon type, and target eligibility also participate.[7]
- The public `eMeleeCombo` and `eMeleeCommand` definitions distinguish idle, movement, block, and multiple attack phases (`MCOMBO_UNARMED_1`–`4`, plus weapon-specific attacks; `MCMD_ATTACK_1`–`4`). Thus the animation/command phase is represented separately from target selection, and a hit is not simply “the attack button was pressed.”[5]

For the victim, the relevant published component is `source/game_sa/PedDamageResponseCalculator.cpp`. Its `CPedDamageResponseCalculator::AccountForPedDamageStats(CPed*, CPedDamageResponse&)` function accounts for the victim’s damage state and fills a `CPedDamageResponse`; this is the damage/reaction layer reached after an attack has selected and connected with a ped.[2] The repository also exposes `PedGeometryAnalyser.cpp`, where `ComputePedHitSide` is used with the physical movement vector, indicating that the victim’s orientation and incoming direction affect the resulting reaction.[6]

The sources therefore show this conceptual path:

1. Player/AI attack command selects an attack phase.
2. Target-selection code finds an eligible nearby ped, using direction, distance, priority, and weapon/target rules.
3. The attack’s active animation or weapon phase determines when contact can occur.
4. The damage-response calculator records the hit and chooses the corresponding victim response.
5. Geometry analysis determines directional details such as which side was struck.

They do **not**, in the cited published files, provide a complete readable implementation of the exact unarmed collision test—for example, a single explicit radius, bone list, or exact animation timestamp. Those details remain inside address-bound original routines or other portions of the reverse-engineering project not exposed by these snippets.

## Earlier 3D games: re3/reVC

For the earlier games, the relevant repositories are **re3** and **reVC**, whose class and virtual-method structure is also used as a reference point by later reverse-engineering work. The available search results do not expose the specific re3/reVC source files or function bodies needed to cite their melee and vehicle-collision implementations, so exact file/function claims for those repositories cannot be verified here.

At a high level, the earlier-game code is organized around the same engine layers:

- `CPed`/`CPlayerPed` attack and collision processing decides whether an attack can reach a ped.
- Ped damage/animation response code changes the victim’s state—stagger, fall, death, or other reaction—based on weapon, damage, direction, and existing state.
- Vehicle collision processing applies impact velocity and collision geometry to the pedestrian, then invokes ped damage/knockdown handling.

The cited San Andreas material confirms the architecture, but it would be inaccurate to name exact re3/reVC files and functions without the repository source results themselves.

[1] gta-reversed/source/game_sa/Entity/Ped/PlayerPed.cpp at e80afe41b7fed5c2f9f8bb2d87e0cc2466d5e1c1 · gta-reversed/gta-reversed (https://github.com/gta-reversed/gta-reversed/blob/e80afe41/source/game_sa/Entity/Ped/PlayerPed.cpp)
[2] gta-reversed/source/game_sa/PedDamageResponseCalculator.cpp at e80afe41b7fed5c2f9f8bb2d87e0cc2466d5e1c1 · gta-reversed/gta-reversed (https://github.com/gta-reversed/gta-reversed/blob/e80afe41/source/game_sa/PedDamageResponseCalculator.cpp)
[3] bully-re/README.md at ce2d429573b2318d8d8a2dbcb9756742ea4a1f38 · LiquidSnake0/bully-re (https://github.com/LiquidSnake0/bully-re/blob/ce2d429573b2318d8d8a2dbcb9756742ea4a1f38/README.md)
[4] plugin-sdk/plugin_sa/game_sa/CPlayerPed.cpp at master (https://github.com/DK22Pac/plugin-sdk/blob/master/plugin_sa/game_sa/CPlayerPed.cpp)
[5] GTASA Reversed (gta-reversed/gta-reversed) (https://context7.com/gta-reversed/gta-reversed)
[6] gta-reversed/source/game_sa/PedGeometryAnalyser.cpp at e80afe41b7fed5c2f9f8bb2d87e0cc2466d5e1c1 · gta-reversed/gta-reversed (https://github.com/gta-reversed/gta-reversed/blob/e80afe41/source/game_sa/PedGeometryAnalyser.cpp)
[7] plugin-sdk/plugin_sa/game_sa/CPlayerPed.h at master (https://github.com/DK22Pac/plugin-sdk/blob/master/plugin_sa/game_sa/CPlayerPed.h)
[8] GTASA/Engine/CPed.h at master - GitHub (https://github.com/jte/GTASA/blob/master/Engine/CPed.h)
[9] gta-reversed/source/game_sa/Entity/Ped/PlayerPed.h at e80afe41b7fed5c2f9f8bb2d87e0cc2466d5e1c1 · gta-reversed/gta-reversed (https://github.com/gta-reversed/gta-reversed/blob/e80afe41/source/game_sa/Entity/Ped/PlayerPed.h)
[10] Native Database (https://nativedb.dotindustries.dev/gta5/natives/0x1913FE4CBF41C463)
