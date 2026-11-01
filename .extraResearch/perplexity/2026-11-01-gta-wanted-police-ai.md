> Question: How do police behave across Grand Theft Auto wanted levels in GTA IV and GTA V (and GTA San Andreas)? Concrete specifics: the search area / line-of-sight cone system and how evasion works, what each star adds (units, aggression, ramming, roadblocks, SWAT, helicopters, spike strips), whether cops deliberately ram or PIT the player and when, how many units chase at once, how they avoid or pile into each other, and design commentary on why GTA V's police were considered too aggressive or unfair. Cite Rockstar documentation, game-file analysis by modders, and reviews; mark what is from game data vs player observation.

The games use three different pursuit philosophies: **San Andreas** uses largely direct, escalating spawns and interception; **GTA IV** makes evasion a spatial stealth problem built around a visible search radius; **GTA V** combines a search zone with much more persistent, aggressive pursuit behavior. The exact unit counts and some vehicle tactics are not consistently documented in official Rockstar material, so those points below are marked as **game-file analysis**, **player observation**, or **design interpretation** rather than hard canon.

## GTA IV

**Documented/game behavior**

- GTA IV has six wanted levels. When the police first detect the player, a flashing search radius appears on the radar; its size increases with wanted level.[4]
- While police can see the player, the search area follows the player. After line of sight is broken, it remains centered on the last sighting location.[4]
- The player loses the wanted level by leaving that radius and remaining undetected for several seconds. Seeing the player again recenters the radius and restores active pursuit.[4]
- White stars indicate active police sighting; gray stars indicate that police have lost sight; blinking gray stars indicate that the search is close to ending.[4]
- Changing cars, using alleys, and taking side streets reduce the chance of reacquisition.[4]

**Star escalation**

The broad progression is:

| Level | Practical change |
|---|---|
| 1 star | A small local search, usually ordinary patrol officers; arrest is the main threat. |
| 2 stars | More patrol cars and more active pursuit; police become more willing to use firearms if the chase continues. |
| 3 stars | Heavier armed response, including tactical police/SWAT involvement. |
| 4 stars | FBI/FIB-style federal response and substantially denser pursuit. |
| 5 stars | More federal units and heavier weapons. |
| 6 stars | Maximum response, including the military. |

The six-star structure and the search-radius system are documented in the wanted-level descriptions, but the precise number of simultaneously active vehicles varies with location, mission state, and available spawn points rather than representing a fixed global quota.[4]

**Ramming and PIT behavior**

- Police vehicles do not merely follow: they attempt to overtake, block, and spin the player, and collisions are common during these attempts. **Player observation/gameplay behavior.**
- GTA IV’s pursuit driving is comparatively systemic: police try to reach the player’s predicted route and can collide with one another, but there is no reliable evidence in the cited material for a clean, published “one ram per star” rule.
- The game generally feels less like every unit has a scripted permission to attack than like several pursuit vehicles are independently navigating toward the same target. **Interpretation from observed behavior.**

**Why evasion feels distinctive**

GTA IV makes “losing the cops” depend on **breaking visual contact and exiting the last-known-position circle**, not simply creating distance. A fast car can remain ineffective if it is still visible, while a slower vehicle can escape through cover, alleys, and route changes.[4]

## GTA V

**Documented/game behavior**

GTA V retains a search-area model, but it is less transparent and less forgiving than GTA IV’s. Police can lose visual contact while still maintaining a pursuit, and helicopters can make hiding difficult. The game also uses police spawning and repositioning to keep pressure on the player. **Game behavior/player observation.**

Its usual escalation is:

| Level | Typical response |
|---|---|
| 1 star | Nearby patrol officers; police usually attempt arrest rather than immediately using lethal force. |
| 2 stars | Multiple patrol cars, more active pursuit, and greater willingness to shoot. |
| 3 stars | SWAT response, heavier gunfire, and more aggressive vehicle interception. |
| 4 stars | Helicopter support and stronger tactical pressure; roadblocks and spike strips become more likely. |
| 5 stars | Very dense police/SWAT/FIB response, repeated air support, and sustained pursuit. |
| 6 stars | No standard free-roam six-star tier in the GTA IV sense; GTA V’s normal maximum is five stars. |

The commonly reported five-star maximum and the progression from patrol units to SWAT, helicopters, roadblocks, and spike strips are **gameplay observations and game-file/mod configuration evidence**, not a single Rockstar-published specification. Mods explicitly alter wanted-response vehicle sets, wanted radii, evasion timers, SWAT deployment, and roadblock behavior, showing that these systems are data-driven and configurable.[9]

**Ramming and PIT behavior**

- GTA V police frequently use deliberate contact: rear-end hits, side-swipes, boxing-in, and PIT-like turns. **Player observation/gameplay behavior.**
- The behavior is not limited to high wanted levels. Ordinary patrol cars may attempt contact during a low-star chase, while higher levels increase the number of pursuing vehicles and the frequency of coordinated interception.
- Police also appear to spawn or reposition ahead of the player, creating apparent ambushes or sudden roadblocks. Some of this is dispatch spawning rather than an individual officer intelligently predicting the route. **Game-file/mod analysis and player observation.**
- Mod authors specifically distinguish rear ramming from PIT maneuvers: one realistic-dispatch modification removes rear-end ramming while retaining PIT attempts, indicating that these are separate vehicle-behavior parameters rather than one indivisible pursuit action.[7]

**How many units chase**

There is no dependable universal number such as “three cars at two stars.” Active units depend on wanted level, terrain, mission status, vehicle availability, and streaming/spawn rules. GTA V often maintains several visible cars plus additional units that approach from ahead or behind; at higher levels, SWAT vehicles, helicopters, and interception units can join simultaneously. **Game-file behavior/player observation.**

The important distinction is between:

- **Active visible pursuers**, which may be limited by AI and performance considerations.
- **Dispatch/spawn units**, which can be created near the player or along the route.
- **Ambient law-enforcement units**, which may exist in the world but not count as dedicated pursuit vehicles.

## GTA San Andreas

San Andreas is less of a stealth-search simulation than GTA IV. At one star, nearby police begin pursuing the player; additional officers may remain passive until the active pursuer is killed or the player moves out of range.[1]

| Level | Typical escalation |
|---|---|
| 1 star | Local police pursue, generally trying to arrest or stop the player. |
| 2 stars | More police vehicles and more persistent pursuit. |
| 3 stars | Police begin spawning in more locations; officers use shotguns, and road interception becomes more common. |
| 4 stars | SWAT units replace or supplement ordinary police, with heavier weapons and more forceful pursuit. |
| 5 stars | FBI agents join the response, with faster and more dangerous vehicles. |
| 6 stars | Army units, tanks, and military hardware join the pursuit. |

The three-star escalation is particularly concrete: police may spawn at intersections and attempt to block or intercept the player, while officers spawned from that level onward shoot even when the player is unarmed or carrying only a melee weapon.[1][2]

**Ramming and PIT behavior**

San Andreas police vehicles aggressively chase and attempt to overtake, spin, or intercept the player rather than merely following behind.[1] Their contact tactics are less nuanced than GTA V’s: there is less apparent distinction between a deliberate PIT, a scripted interception, and an ordinary collision caused by pursuit driving. **Game behavior/player observation.**

At higher levels, the danger comes increasingly from **spawned blockers and converging agencies**, not from sophisticated coordinated vehicle tactics. Police, SWAT, FBI, and army units can appear around the player’s route, producing sudden pileups and unavoidable-looking road closures.[1][2]

## Unit collision and pileups

Across all three games, police AI is not a fully coordinated convoy system.

- Units generally receive the same broad target and navigation goal.
- They avoid one another imperfectly, often using normal traffic/pathfinding logic rather than a dedicated pursuit formation.
- A unit that reaches the player may slow, turn, block, or collide while units behind continue toward the same position.
- Spawned interceptors can arrive from awkward angles, causing police cars to hit one another, civilian traffic, or the player.
- GTA V’s larger response and more aggressive contact make pileups especially conspicuous; mod authors note that police “tend to crash into things while responding or chasing.”[7]

Thus, a pileup is usually not evidence that every cop has independently chosen to ram. It is often the combined result of pursuit steering, vehicle collision physics, route convergence, and dispatch spawning. **Interpretation supported by mod behavior and observation.**

## Why GTA V was criticized as too aggressive or unfair

The main criticism was not simply that police were difficult. It was that GTA V often undermined the player’s ability to understand or control the evasion rules.

- **Rapid reacquisition:** breaking line of sight did not always feel sufficient because another unit, a helicopter, or a newly spawned vehicle could regain contact.
- **Predictive or artificial spawning:** police could appear ahead of the player rather than plausibly arrive from the surrounding road network.
- **Frequent forced contact:** patrol cars commonly rear-ended or side-swiped the player even at low wanted levels.
- **Disproportionate escalation:** relatively minor incidents could produce persistent gunfire, repeated vehicle attacks, or a large response.
- **AI collision behavior:** police sometimes caused their own pileups yet continued spawning, making the chase feel like an endlessly replenished system rather than a finite group that could be outdriven.
- **Weak player feedback:** compared with GTA IV’s clearly visible last-known-position circle and white/gray star states, GTA V gave less reliable information about why the search was continuing.

These are primarily **player/reviewer observations and design criticism**, not Rockstar’s stated design rationale. The strongest data-side evidence is that mods routinely rebalance wanted radii, evasion timers, vehicle sets, ramming, boxing-in, and response density—precisely the variables players identified as excessive.[3][7][9]

A useful design reading is that GTA V prioritized **spectacle and continuous action** over GTA IV’s legible stealth-like evasion. GTA IV asks, “Can the player break contact and disappear?” GTA V more often asks, “Can the player survive a continuously regenerated pursuit?” That makes V more cinematic, but also makes failures feel less attributable to the player’s route choice and more attributable to spawning, helicopter visibility, or unavoidable AI contact.

**Evidence labels:** search-radius and star-state descriptions are documented gameplay references.[4] San Andreas escalation details are documented in the wanted-level and police-department analyses.[1][2] Configurable response variables and anti-ramming/PIT distinctions come from modder analysis and modified game data.[7][9] Claims about unfairness, pileups, and perceived aggression are player observation and design interpretation, not official Rockstar statements.

[1] Wanted Level in Grand Theft Auto: San Andreas - GTA Wiki (https://gta.wiki/w/Wanted_Level_in_GTA_San_Andreas)
[2] San Andreas Police Department - GTA Wiki (https://gta.wiki/w/San_Andreas_Police_Department_(3D_Universe))
[3] Wanted Level Density - GTA5-Mods.com (https://www.gta5-mods.com/misc/wanted-level-density)
[4] Wanted Level in Grand Theft Auto IV - GTA Wiki (https://gta.wiki/w/Wanted_Level_in_GTA_IV)
[5] Mod to make the police act toward npcs like to you :: Grand Theft Auto V 傳承版 綜合討論 (https://steamcommunity.com/app/271590/discussions/0/481115363877616787/?l=tchinese)
[6] GTA IV in Minecraft (https://melty.gg/m/gta-iv-in-minecraft?from=game)
[7] Realistic Dispatch Mod (Modified Crime and Police ... (https://es.gta5-mods.com/misc/realistic-dispatch-mod-modified-crime-and-police-rebalance-mod)
[8] GTA Wanted Levels, Police & Escape Guide: Every Game Compared (https://www.gamemall.org/en/games/gta-wiki/wanted)
[9] Harder Police/Wanted Levels mod [tags - GTA5-Mods.com (https://www.gta5-mods.com/misc/harder-police-wanted-levels-mod)
[10] Download Realistic behavior of the Police for GTA San Andreas (https://libertycity.net/files/gta-san-andreas/64997-realistic-behavior-of-the-police.html)
