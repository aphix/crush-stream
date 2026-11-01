> Question: In video games with AI pursuers (police chases, vehicular combat, survival-against-pursuers driving games: Driver series, Need for Speed, GTA, Burnout, Smuggler's Run, Pursuit Force, Driver: San Francisco, Mad Max 2015 convoys, Carmageddon, Wreckfest, Twisted Metal, Hot Wheels Unleashed, indie roguelike driving games), which games implement these specific pursuer behaviors, and how: (1) pack coordination with roles (one blocks, one flanks, one rams; formations that adapt to the arena), (2) pursuers that predict the player's escape route and wait ahead or cut the player off at an exit, (3) sneaky approaches (lights/sirens off, approaching from blind spots, hiding behind cover then ambushing), (4) fake-outs or feints (a pursuer that baits the player into dodging then hits on the real line), (5) handbrake/e-brake swipes (a pursuer that spins its rear into the target, hitting with the rear quarter to protect its own front/engine), (6) pursuer self-preservation or morale (backing off when damaged, getting angrier after a teammate is wrecked), (7) the player turning pursuers against each other. Concrete examples, how they work, and sources; and which of these players found fun vs frustrating.

The clearest, well-documented examples are **Need for Speed III: Hot Pursuit**, **Burnout 2/3**, several **GTA** titles, **Driver: San Francisco**, and **Pursuit Force**. However, most games simulate sophisticated pursuit tactics through scripted spawning, target selection, and navigation helpers rather than fully emergent squad AI.

## Behavior-by-behavior comparison

| Behavior | Strong examples | How it works |
|---|---|---|
| **1. Pack coordination and roles** | *Need for Speed III: Hot Pursuit*; later *Need for Speed* games; *Burnout 2/3*; *Pursuit Force* | *Hot Pursuit III* explicitly added multiple police cars, blocking behavior, collective ambushes, roadblocks, and spike strips.[3][5] In practice, the “roles” are usually functional rather than persistent personalities: one unit pressures from behind, another appears alongside or ahead, and a roadblock closes a route. |
| **2. Predictive interception** | *Need for Speed III: Hot Pursuit*; *GTA IV/V*; *Driver: San Francisco*; *Pursuit Force* | Roadblocks and police units are placed ahead of the player rather than simply following the player’s current position. *Hot Pursuit III* is the clearest documented early example: police can form walls across roads and collectively ambush the racer.[3][5] In open-world games, this is often a mixture of navigation prediction and pre-positioned response units, so it can feel predictive even when the AI is not forecasting a complete route. |
| **3. Sneaky approaches** | *GTA IV/V*; *Driver: San Francisco*; some *Mad Max* encounters; selected indie pursuit games | This is much less common as a systemic behavior. Police may approach from side streets, arrive outside the camera view, or use terrain and traffic as concealment, but “lights off, deliberate blind-spot stalking, then ambush” is rarely a consistently documented AI rule. Many apparent stealth approaches are actually off-screen spawning or delayed activation. |
| **4. Feints and fake-outs** | *Burnout 3*; *Pursuit Force*; some *Twisted Metal* and modern roguelike driving games | Deliberate bait-and-switch behavior is rare. Most games produce accidental feints through multiple pursuers choosing different steering targets: one appears to force a dodge while another occupies the escape lane. That can be fun when readable, but frustrating when the player cannot distinguish intentional deception from collision randomness. |
| **5. Handbrake/e-brake rear-quarter swipes** | *Burnout 3*; *Driver: San Francisco*; *GTA IV/V*; *Pursuit Force* | Pursuers commonly attempt PIT-style contact or side-swipes, aiming at the player’s rear quarter. A true handbrake maneuver—rotating the rear of the pursuing car into the target while protecting its own front—is less common and is usually an emergent driving maneuver rather than a named tactical state. The result is most convincing in games with strong vehicle physics and deliberate pursuit steering. |
| **6. Self-preservation or morale** | *Need for Speed* series; *GTA*; *Burnout*; *Pursuit Force* | Damage-based withdrawal is common: a disabled or heavily damaged vehicle falls behind, despawns, or ceases attacking. Persistent morale—such as becoming angrier after a teammate is destroyed—is uncommon. Escalation generally comes from a wanted-level or event system, not emotional state. *Hot Pursuit III* has an especially interesting systemic twist: police may abandon the player and pursue a more dangerous AI racer instead.[5] |
| **7. Turning pursuers against each other** | *Need for Speed III: Hot Pursuit*; *GTA*; *Burnout*; *Carmageddon*; *Wreckfest*; *Twisted Metal* | This is usually an indirect mechanic. The player can bait police into traffic, environmental hazards, rival racers, or each other. In *Hot Pursuit III*, police can switch targets when an AI racer behaves more dangerously than the player, creating genuine target competition rather than merely using police as obstacles.[5] In *GTA*, traffic and police collisions can produce temporary chaos, but police generally remain allied and do not conduct a persistent “police versus police” fight. |

## Particularly good concrete examples

### Need for Speed III: Hot Pursuit

This is one of the strongest matches for the requested design space. Its pursuit system added multiple police cars, blocking behavior, collective ambushes, roadblocks, and spike strips.[3][5]

The important design distinction is that the police do not need to possess sophisticated long-term planning for the chase to feel coordinated:

- The pursuing car pressures the player from behind.
- Another car can block or approach from an offset angle.
- A roadblock creates a forward interception threat.
- Spike strips force route selection rather than merely demanding faster driving.
- Gaps in roadblocks remain exploitable, giving the player a readable counterplay option.[5]

Its most unusual feature is target reassignment: if an AI racer drives more dangerously than the player, police may switch to that racer.[5] That creates a limited form of emergent faction interaction and lets the player exploit the police’s priorities.

### Burnout 2 and Burnout 3

The *Burnout* games are strong examples of **kinetic pursuit behavior**, especially side pressure, traffic manipulation, takedowns, and aggressive collision selection. They are weaker examples of explicit role-based coordination or morale.

Their best-feeling behavior is usually the e-brake-like side attack: an opponent changes angle, exposes a rear quarter, and tries to turn the player into traffic or a wall. Because the cars are designed around spectacular crashes, the maneuver reads immediately and produces a satisfying risk/reward decision.

The limitation is that the AI often appears to be optimizing for collision opportunities rather than maintaining a coherent squad formation. That makes attacks exciting but sometimes mechanically arbitrary.

### GTA IV and GTA V

These games provide broad examples of pursuit escalation:

- Police units approach from multiple directions.
- Roadblocks and helicopters alter the player’s available routes.
- Cars attempt side impacts and PIT-like contact.
- The player can use traffic, narrow streets, ramps, alleys, and environmental hazards to cause police crashes.
- Damaged units may become ineffective or withdraw from the immediate engagement.

The apparent intelligence is partly systemic: dispatch escalation, unit spawning, wanted-area searches, navigation, and vehicle behavior combine to create the impression of prediction. The games generally do not expose stable “blocker,” “flanker,” and “rammer” roles as explicit squad members.

They are also a good illustration of the fun/frustration boundary. A pursuit feels fair when the player sees the roadblock forming and has several escape routes. It feels unfair when a unit appears directly in front of the vehicle, a helicopter removes hiding options without clear feedback, or a police car performs an unavoidable high-speed hit.

### Driver: San Francisco

*Driver: San Francisco* is notable because its **Shift** mechanic lets the player move between vehicles. That makes turning pursuers against each other unusually accessible:

- The player can jump into traffic to create collisions.
- A civilian or rival vehicle can be placed in the path of police.
- The player can select a more advantageous vehicle during the pursuit.
- Pursuers can be made to collide with environmental geometry or other traffic.

The AI does not need elaborate deception because the player’s ability to manipulate vehicle ownership supplies the deception. The resulting chases are often more playful and systemic than traditional police pursuits.

### Pursuit Force

*Pursuit Force* emphasizes aggressive police interception in a highly scripted arcade format. Its design includes multiple pursuers, road positioning, vehicle-to-vehicle attacks, and rapid transitions between cars.

It is a strong example of **designed tactical spectacle** rather than autonomous planning. The game can make an enemy appear to flank, block, or set up a hit because encounter scripting controls where threats enter the scene. That produces clear action beats, but players may recognize the behavior as authored rather than emergent.

### Mad Max, Smuggler’s Run, Carmageddon, Wreckfest, and Twisted Metal

These games generally emphasize different parts of the requested list:

- **Mad Max:** convoy enemies, vehicle weak points, escort formations, and environmental positioning. Pursuit behavior is more convoy-combat oriented than police-interception oriented.
- **Smuggler’s Run:** pursuit pressure and route survival, but usually less explicit squad role differentiation.
- **Carmageddon:** chaotic collision behavior and factional interference; reliable tactical coordination is not the central design.
- **Wreckfest:** strong emergent crashes and opportunistic AI contact, but not usually persistent pursuit formations or morale systems.
- **Twisted Metal:** target selection, arena positioning, ambush-like attacks, and faction combat. The player can sometimes exploit enemies attacking one another, but dedicated feints and squad roles vary significantly by game and enemy archetype.
- **Hot Wheels Unleashed:** opponents can obstruct and collide, but the behavior is primarily racing competition rather than a pursuit simulation.
- **Indie roguelike driving games:** often use spawning, escalating enemy tiers, and procedural route pressure. Their unpredictability can imitate prediction or stealth without implementing those behaviors literally.

## What players generally find fun

Players tend to enjoy pursuit AI when it provides:

- **Readable intent:** the player can tell whether a car is blocking, ramming, flanking, or retreating.
- **Counterplay:** braking, changing lanes, taking a side road, using traffic, or baiting a collision can defeat the tactic.
- **Escalation:** the chase becomes more organized over time instead of beginning with unavoidable omniscience.
- **Physical commitment:** a pursuer that misses a PIT attempt or crashes into traffic remains disadvantaged.
- **Factional chaos:** police, rivals, traffic, and hazards can interfere with one another.
- **Recoverability:** a mistake creates danger without instantly ending the chase.

A design discussion of chase AI similarly characterizes good pursuit behavior as flanking, roadblocks, and communication that box the player in, while warning against every unit mindlessly ramming from behind.[2]

## What players tend to find frustrating

The same behaviors become frustrating when:

- A roadblock spawns with no warning directly at the only viable exit.
- Pursuers appear from outside the simulation rather than arriving through plausible routes.
- Several cars execute nearly simultaneous unavoidable hits.
- A “feint” cannot be distinguished from random steering.
- The AI ignores damage while the player’s vehicle suffers permanent consequences.
- Pursuers have perfect route knowledge while the player lacks equivalent information.
- A damaged pursuer continues making suicidal attacks instead of yielding.
- The game uses rubber-banding or teleporting units to imitate coordination.

The central lesson is that **coordination is more enjoyable than raw aggression when it is legible and imperfect**. *Need for Speed III: Hot Pursuit* remains a useful model because its roadblocks and ambushes create organized pressure while leaving exploitable gaps.[5] By contrast, a pursuit system that only teleports blockers into the player’s route may technically implement interception but usually feels scripted and unfair.

## Overall assessment

Across the listed games, the behaviors rank roughly as follows:

- **Common:** blocking, roadblocks, side-swipes, PIT-like attacks, target switching, damage-based loss of effectiveness.
- **Moderately common:** flanking, multi-car pressure, environmental ambushes, indirect use of pursuers against one another.
- **Rare:** true role-based formations that adapt continuously to arena geometry.
- **Very rare:** genuine route prediction with persistent interception planning, deliberate stealth approaches, intentional feints, and morale that changes after a teammate is destroyed.
- **Mostly emergent rather than explicitly programmed:** handbrake rear-quarter swipes and players turning pursuers against each other.

The strongest practical pursuit AI therefore tends to be a hybrid: scripted or semi-scripted interception points, navigation-based flanking, physics-driven collisions, damage-based retreat, and enough randomness to prevent every chase from becoming a memorized sequence.

[1] The automated driving that happens when you enter a pursuit got me busted (https://www.reddit.com/r/needforspeed/comments/8y2cak/the_automated_driving_that_happens_when_you_enter/)
[2] What Makes a Great Police Car Chase Game Experience? (http://cement.or.kr/news/the-key-elements-of-a-police-car-chase-game.html)
[3] Need for Speed III: Hot Pursuit - Wikipedia (https://en.wikipedia.org/wiki/Need_for_Speed_III:_Hot_Pursuit)
[4] GTA 6 Wanted System Overhaul — Six Stars, Police AI & Pursuit ... (https://gamecryst.com/gta-6/news/gta-6-wanted-system-six-stars-extended-look/)
[5] Need for Speed III: Hot Pursuit (https://en-academic.com/dic.nsf/enwiki/11787231)
[6] Army Ranger: Mogadishu (https://retro-replay.com/db/windows/army-ranger-mogadishu/)
[7] Mastering Car Chase Game Design Principles (https://ir.msu.ac.zw/car-chase-game)
[8] BattleTanks II (https://retro-replay.com/db/windows/battletanks-ii/)
[9] Armored Warfare - Wikipedia (https://en.wikipedia.org/wiki/Armored_Warfare)
[10] Tank Commander (https://retro-replay.com/db/dos/tank-commander/)
