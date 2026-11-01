> Question: How does the police AI work in the Survival mode of Driver 2 (PlayStation, 2000, Reflections) and Driv3r / Driver 3 (2004)? Describe what is known (developer interviews, reverse engineering of the Driver 2 source / REDRIVER2 project, FAQs, wikis) about: how cop cars choose to ram the player (aim at the player's predicted position, head-on, T-bone), how aggressive they are and whether they deliberately crash into the player at full speed, how many cops spawn and how fast new ones arrive, whether they avoid each other or pile up, how they react when the player is slow, cornered or boxed in, whether they slow down or keep ramming, the 'felony' meter and its effect on cop aggression, how the player loses (car destroyed vs arrested), and why Driver 2's Survival was considered so relentless and fun. Cite sources; say what is from code or developers and what is player observation.

Driver 2’s Survival and Driv3r’s Survival use deliberately unfair pursuit behavior rather than ordinary traffic-police AI. The broad design is clear from player-facing documentation and reviews; the precise steering and spawn rules are less well documented publicly, and should not be stated as proven unless confirmed in code.

## Driver 2

### What the cops are doing

The surviving REDRIVER2 project is a reverse-engineered C reconstruction of the PlayStation game, not an emulator. Its repository includes separate AI modules such as `ai.c`, `civ_ai.c`, and `cop_ai.c`, and says that its variables, types, and function names were recovered from debugging symbols and other game data.[5][6] That makes the project the strongest available source for exact Driver 2 behavior.

The public material available here does **not**, however, expose a readable, specific explanation proving that Survival cops:

- aim at a predicted future position;
- select a deliberate head-on collision;
- calculate a T-bone intercept;
- or use a particular “ramming” subroutine.

The safest description is that they steer aggressively toward the player’s current pursuit target, with the game’s special Survival parameters making collisions much more likely. Reports that they appear to “lead” the player or set up side impacts are consistent with pursuit steering and road geometry, but are **player observation**, not established developer documentation.

Survival is commonly described as using cops that are approximately twice as fast, invulnerable, and heavier than normal vehicles.[4] Those properties explain much of the apparent brutality: a cop can recover from impacts that would remove an ordinary traffic vehicle, close distance rapidly, and retain enough momentum to hit the player hard.

### Aggression and collisions

Player observation consistently describes the cops as willing to continue attacking at speed rather than treating a near-stop as a reason to brake and regroup. They can therefore:

- hit the player head-on when the two vehicles meet on a narrow road;
- strike from the side when their pursuit line intersects the player’s route;
- continue pushing into the player after an initial collision;
- crash into scenery or traffic while attempting to maintain contact.

That is an observation of the resulting behavior, not proof that the AI has a high-level instruction saying “ram at full speed.” The available sources do not establish whether the collision is intentionally selected as such or is an emergent result of target-seeking steering plus Survival’s speed and mass modifiers.

There is likewise no reliable public evidence in the supplied sources for a universal rule such as “cops never slow down when the player is boxed in.” In practice, the game’s collision-heavy pursuit often makes them keep trying to reach the target, producing pileups, repeated shoves, and spectacular mutual crashes rather than careful spacing.

### Numbers and arrivals

The frequently quoted Survival description says “several” police cars, but the supplied sources do not provide a verified Driver 2 spawn table, exact maximum simultaneous count, or a documented interval for replacement cops.[4] The available Reflections interview result says that Survival involved “4 cops against your own vehicle” for the series context, but it does not establish every Driver 2 platform, mode variant, or replacement timing as a code-level fact.[9]

Accordingly:

- **Initial cops:** four is the developer-interview figure associated with the mode, but the exact Driver 2 implementation should be checked against the REDRIVER2 spawning code before treating it as definitive.[9]
- **Replacement speed:** player experience suggests that destroyed or lost pursuers are replenished rapidly, but no verified interval is given in the supplied material.
- **Avoidance:** the pileups players see indicate that cop-to-cop avoidance is weak or subordinate to pursuit. No cited developer statement says that the AI deliberately coordinates to avoid one another.

### Slow, cornered, or boxed-in players

When the player slows down or becomes trapped, the pursuit does not appear to switch to a cautious containment tactic. Instead, cops commonly continue closing and colliding. This is principally **player observation**. The design favors immediate physical pressure: a trapped player may be shoved, pinned, or hit repeatedly, while a cop may itself become stuck against a wall, another cop, or an obstacle.

That behavior is one reason Survival can feel less like a realistic police chase and more like a moving collision puzzle. Escaping often depends on exploiting road width, traffic, sharp turns, barriers, or terrain rather than simply outrunning the police.

## Felony meter

The felony meter belongs to the normal Driver 2 law-enforcement system, where illegal driving and collisions increase police attention. A gameplay transcript describes felony being generated by such actions as hitting vehicles, walls, pedestrians, and props, and notes that it remains active even when not displayed in some missions.[8]

The important distinction is that Survival is already a dedicated police-attack mode. The supplied evidence does not demonstrate that increasing felony during Survival changes the cops’ ramming algorithm, their maximum speed, or their spawn rate. It is therefore safer to say:

- **Known:** felony represents escalating lawbreaking and can affect police pursuit in ordinary gameplay.[8]
- **Not established here:** a precise Survival-specific mapping from felony value to cop aggression.
- **Likely but unproven:** Survival either begins at a high pursuit state or bypasses much of the ordinary escalation system, because cops attack immediately.

## How the player loses in Driver 2

In Driver 2 Survival, the player cannot leave the vehicle; the objective is to survive until the car is totaled.[4] The loss condition is therefore vehicle destruction, not an arrest sequence. That differs from normal chase logic, where arrest or being stopped can matter. Survival turns the car’s damage state into the timer’s effective health bar.

## Why Driver 2 feels so relentless and fun

The appeal comes from several interacting choices:

- **Immediate pressure:** there is little downtime; the player is attacked rather than gradually being searched for.
- **Asymmetric physics:** faster, heavier, invulnerable cops can take risks the player cannot.[4]
- **Unpredictable collisions:** cops frequently miss, crash, rebound, or accidentally block one another, so every escape route can change suddenly.
- **Constant tactical decisions:** the player must choose between speed, tight turns, traffic, alleys, open roads, and risky counter-steering.
- **Spectacle:** pileups and full-speed impacts create memorable emergent moments even when the AI is not realistic.
- **A clear objective:** the car’s destruction provides an immediate, comprehensible fail state.

The mode was therefore “relentless” not because the cops necessarily possessed sophisticated interception logic, but because speed advantages, heavy collision behavior, rapid pursuit, and weak avoidance kept physical danger continuously present. That same crash-happy design was later criticized as poor AI in Driv3r, while reviews still described Survival as a fun diversion.[1][2][7]

## Driv3r / Driver 3

Driv3r continues the same broad Survival formula: survive as long as possible while several police vehicles pursue the player, with the player remaining in the vehicle and losing when it is totaled.[1][4] It also adds the possibility of gunfire damaging the vehicle further.[4]

The strongest documented difference is the use of apparent **“doublespeed”** or rubber-band behavior. Player-facing descriptions say that pursuing cops can suddenly double their speed, making escape difficult or impossible, and that they tend to catch and remain with the player regardless of the selected vehicle.[1] This is an observation/report about the game’s behavior; the supplied sources do not identify the exact variable or function implementing it.

Driv3r’s police AI was widely criticized as inconsistent and unintelligent:

- Reviews describe Survival as involving “crash-happy” police AI.[7]
- Police could repeatedly drive into an obstacle instead of finding a route around it.[7]
- A review reports that police detection could trigger when the player crossed a radar cone even when the apparent physical line of sight was implausible.[2]
- Players could sometimes escape by forcing police onto sidewalks or into posts, trees, or other vehicles.[1]

These examples suggest that Driv3r’s cops were aggressive but not sophisticated. They often pursue through direct target-seeking and rubber-band speed rather than through reliable prediction, coordinated interception, or robust obstacle avoidance.

The available sources do not prove a specific Driv3r decision tree for head-ons, T-bones, or predicted-position targeting. The practical result, as observed by players, is similar to Driver 2 but less elegant: cops close unnaturally quickly, crash frequently, may get stuck repeating an action, and can be escaped by exploiting environmental weaknesses.

## Bottom line

- **Driver 2:** Survival appears to combine aggressive target-seeking with exceptional cop speed, mass, and invulnerability. The cops often ram because the pursuit system keeps steering them into the player, but the supplied evidence does not prove a dedicated predicted-position, head-on, or T-bone-selection algorithm.
- **Driv3r:** The same collision-oriented concept is supplemented by conspicuous rubber-band or “doublespeed” behavior and weaker obstacle handling.[1]
- **Spawn count:** four cops is the developer-interview figure, while exact Driver 2 spawn/replacement timing remains unverified in the available material.[9]
- **Felony:** clearly tracks lawbreaking in ordinary play, but its precise effect inside Survival is not established.[8]
- **Loss:** the player loses when the vehicle is totaled; Driv3r can additionally suffer vehicle damage from gunfire.[1][4]
- **Why Driver 2 works:** its unfairness is highly interactive. The cops are relentless enough to create pressure, but imperfect enough that traffic, corners, terrain, pileups, and lucky impacts produce constantly changing escape opportunities.

[1] Game modes (https://driver.fandom.com/wiki/Driv3r)
[2] DRIV3R Review - GameRevolution (https://www.gamerevolution.com/review/33364-driv3r-review)
[3] Driv3r Cheats, Unlock All Missions, Vehicles and Weapons (https://www.cheatbook.de/files/driv3r.htm)
[4] Survival (game mode) | Driver Wiki - Fandom (https://driver.fandom.com/wiki/Survival_(game_mode))
[5] REDRIVER2/src_rebuild/Game/C/main.c at 006c759afbe8be398d666cb18af958a895db420c · OpenDriver2/REDRIVER2 (https://github.com/OpenDriver2/REDRIVER2/blob/006c759a/src_rebuild/Game/C/main.c)
[6] OpenDriver2/REDRIVER2: Driver 2 Playstation game reverse ... (https://github.com/OpenDriver2/REDRIVER2)
[7] DRIV3R Review - GameSpot (https://www.gamespot.com/reviews/driv3r-review/1900-6101203/)
[8] Driver 2 All Missions by the_surviv0r in 1:26:02 (https://www.youtube.com/watch?v=fwXqPYY0jQg)
[9] Driv3r: Interview with Reflections (https://games.kikizo.com/news/200401/002.asp)
[10] [Driver 2] The cops in Survival Mode are absolute maniacs (https://www.reddit.com/r/GamePhysics/comments/q4tgem/driver_2_the_cops_in_survival_mode_are_absolute/)
