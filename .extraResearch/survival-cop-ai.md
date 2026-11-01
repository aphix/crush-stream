# Survival cop AI: Driver 2's code, real police practice, and what to adopt

Research only; nothing in `src/` was edited. Written for the owner and for whoever builds the next `HunterBrain` pass (`src/game/ai/hunter.ts`, `cop-brain.ts`, `pack-guard.ts`, `docs/SURVIVAL.md`).

## 0. How to read this

Every claim carries a tag saying where it comes from. Weigh them in this order.

| Tag | Meaning |
|---|---|
| **[code]** | REDRIVER2 source at `b2d8857426f815007486def9bd23f9a6007a2c64` (OpenDriver2/REDRIVER2 master, 2026-06-26; local clone `/home/aphix/github/REDRIVER2`, verified identical). Paths are under `src_rebuild/Game/`. Function bodies are tagged `[D] [T]` in the repo = decompiled from the original PSX symbols and tested; `[A]` = added by the REDRIVER2 authors. The Survival flag `gBatterPlayer` is in the original symbol dump (`git show eba0bbff:dump.h`, line 5081, `0xAA218`), so it is original; only `batterTimer` (cop_ai.c:372-393) is a REDRIVER2 addition and does not apply to Survival. |
| **[dev]** | A developer said it (Reflections interview). |
| **[rev]** | Third-party reverse-engineering notes (NFS Most Wanted encyclopedia, byte-verified by its author). |
| **[policy]** | Published police policy / training document, as quoted in the saved Perplexity answers (URLs in section 12). |
| **[player]** | Fan wiki, review or forum observation. Weakest. |
| **[est]** | My own arithmetic or physics estimate. Shown with the working so it can be redone. |
| **[inf]** | Inference from the above; marked so nobody mistakes it for fact. |
| **[ours]** | Our code, `file:line`. |

**Units.** Driver 2 runs one physics step and one `CopControl` call per frame, 30 frames/s (`C/main.c:808` `PsyX_SetSwapInterval(2)` on a 60 Hz sync; `C/main.c:1025,1139`). Position integrates as `fposition += linearVelocity >> 8` with `fposition` in 1/16 unit (`C/handling.c:367,856`), so `hd.speed` is world units per frame. The world-unit-to-metre scale is not defined anywhere. Two independent anchors agree on **1 unit ≈ 6 mm**: gravity `GRAVITY_FORCE = -7456` (`C/wheelforces.c:17`) is 1.82 units/frame², which is 9.81 m/s² only at 6.0 mm/unit; and a Driver 2 car's half-length is about 375 units (Redriver_ReExtended developer notes, E75 fork), so 750 units for a 4.5 m car is 6.0 mm/unit (4.8 m gives 6.4 mm). The lane width of 512 units (`C/civ_ai.c:3439`) points to 7 mm. **Treat every metre figure below as ±10 %.** Conversions used: 1 unit = 0.006 m; 1 unit/frame = 0.18 m/s = 0.65 km/h = 0.40 mph. Sanity check: the civilian speed limits `speedLimits = {56, 97, 138}` (`C/civ_ai.c:29`) come out at 22/39/56 mph, i.e. 25/40/55-ish signs.

## 1. Summary

1. **Driver 2 Survival has no tactics menu.** `cop_ai.c` is one steering loop (`CopControl1`) with a mode flag, not a set of ram / PIT / block routines. What players see as "T-bones" and "head-ons" is that loop aiming at the player's predicted position at full throttle. [code]
2. **The Survival switches are few and blunt:** difficulty forced to the hardest (`gCopDifficultyLevel = 2`, `glaunch.c:233`); `gBatterPlayer = 1` (aim at the player's flank, never match speed); `gCopData.immortal = 1` (cops cannot die, `mission.c:617`); cops always see the player (`cop_ai.c:776`); desired speed and drive force x1.122 (4596/4096, `cop_ai.c:289-290`) plus up to +25 % with the felony meter (`cop_ai.c:292-293`); zero respawn delay (`cop_ai.c:288`). [code]
3. **Cops are all-wheel-drive with 2.1x the tyre-friction scale of the player car** (`hndType` 4 = friction 68 against 32, `wheelforces.c:27-37`, `cop_ai.c:90-95`) and the cop engine force is computed from a table of 10240-16384 units against the player's `powerRatio x 4915/4096`. Roughly 2-3.5x the player's drive force [est]; the wiki's "twice as fast, invincible, heavier" [player] is consistent with the first two points, and the "heavier" part is data (car mass table), not code.
4. **The aim point is the player's predicted position at closest approach, 0.5 m to the player's right** (`cop_ai.c:512-542`): time of closest approach from the *relative* velocity, clamped to 0-2 s. All cops use the same point, so the pack converges on one flank.
5. **Slow, stopped or cornered player: no containment at all.** With `doBatter` the speed-matching branch is skipped (`cop_ai.c:694`), so a cop at full thrust pushes. A cop that is stuck (speed under 1.1 m/s for 11 frames, 0.33 s) reverses for 22 frames (0.73 s) and comes back: a **re-ram cycle of about 1.07 s** (`cop_ai.c:480-497`). Pinning does no damage by itself (see 8); the cycle does.
6. **Cops never avoid each other and never avoid traffic in steering**; the path field treats only civilians as obstacles, not pursuers (`pathfind.c:817-858`). Pile-ups are the design, not a bug. [code]
7. **The pack is small and constant: about 4 cops** (felony triggers 1-4, `cop_ai.c:237-255`, and the Survival header branch `mission.c:591-598`; 4 is also the developer figure for Driv3r, [dev] Kikizo 2004). There is no growth over time. One new cop is requested the frame one is lost, on a ring about 123 m round the player (`civ_ai.c:1871,1980-1991`); a cop more than 144 m away is removed at once (`civ_ai.c:1626-1635`, called from `cop_ai.c:1215`).
8. **The player loses on damage only:** 22 000 points (`mission.c:262-263`), 236-640 per hit at 5-50 m/s closing speed, nothing below about 4.9 m/s normal closing speed (`bcollide.c:383-395,421-427`, `handling.c:494-504`). Twenty hits at the per-hit maximum; about 50-80 typical. Upside-down for 6 s also kills (`mission.c:2893-2903`). There is no bust in Survival. [code]
9. **Driv3r** keeps the mode (4 cops [dev]), adds gunfire, and is reported to use "doublespeed" catch-up [player]. No Driv3r police code is public (section 3).
10. **Real police do not "just ram".** A boxed-in suspect is contained by stationary or low-speed, non-striking contact; once he drives, officers disengage, reposition and reassess, and a PIT is a trained technique capped at 35-40 mph (15.6-17.9 m/s), FLETC teaching it at 25-35 mph; ramming is deadly force. [policy] Our owner-chosen Survival PIT cap of about 30 m/s is 1.7-1.9x the real limit and 2.8-3.7x the energy: a game choice, not a police one.
11. **A PIT is not a T-bone** (section 5): matched speed, front corner on the rear quarter behind the rear wheel, gentle progressive steer, drive kept on, release when yaw starts, straighten and brake away, backups box the spun car. Our `attackTarget` PIT branch (`cop-brain.ts:180-183`) does roughly the opposite on four of those points.
12. **What to adopt, in priority order:** a faithful PIT state machine; an escalation meter for a player who squirms while surrounded; closest-approach lead; heat-scaled pace; a reverse-turn when the target is beside the nose; then the novel ideas (section 9), each built from pieces that already exist.

## 2. Driver 2's Survival cop AI, from code

### 2.1 What Survival changes

| Switch | Value | Where |
|---|---|---|
| Cop difficulty | forced to `2` (hardest) | `glaunch.c:232-233` (`gSurvivalCopSettingsBackup` restores it, 141, 166) |
| Mission slot | 292 + city x 8 + night x 4 + sub (1 player); 324 + ... (2 players) | `glaunch.c:235-240` |
| Cop handling type | `hndType = 4` at level 2: friction scale 68, 4WD, aggressive braking | `cop_ai.c:82-96`, `wheelforces.c:27-37` |
| Batter flag | `gBatterPlayer = 1` when the mission's `cops.max == 4`, else 0 | `mission.c:591-609`, `mission.c:1914-1938` |
| Immortal cops | `gCopData.immortal = 1` | `mission.c:615-618`; read at `cop_ai.c:395-396` |
| Cops see the player | `CopsCanSeePlayer = (GameType == GAME_SURVIVAL)` every frame | `cop_ai.c:776` |
| Respawn time | `gCopRespawnTime = 0` (Getaway 10000, missions 320 minus 4 x mission number) | `cop_ai.c:282-301` |
| Speed / power scale | `gCopDesiredSpeedScale = gCopMaxPowerScale = 4596` (1.122), `autoMaxPowerScaleLimit = autoDesiredSpeedScaleLimit = 1024` | `cop_ai.c:286-294` |
| Header cops (`speed`, `power`, `min`, `max`) | read from mission data at `mission.c:588-613`, then **overwritten** by `InitCops` (`main.c:664`, after `LoadMission`) | the data is not in the repo [inf] |
| Player cannot leave the car | `MRRequestCar` refuses in Survival; the player is `TannerStuckInCar` | `mission.c:2636`, `mission.c:2883-2884` |

`maxCopCars == 4` is the game's default marker; for every other mode it means "no dynamic cops" (`gDontPingInCops = 1`, `mission.c:601`), and in Survival it switches on batter and ping-in. So the Survival mission headers have `cops.max = 4`. [inf]

### 2.2 The decision loop (`CopControl1`, `cop_ai.c:327-747`, once per cop per frame)

1. **Gate.** `CopsAllowed == 0` -> thrust 0, handbrake on (357-363). `gStopCops` zones freeze cops in a radius (410-422).
2. **Batter flag.** `doBatter = gBatterPlayer` (367-370) = 1 in Survival.
3. **Dying** (395-408): only if `totalDamage > 27000 && !immortal`. Never runs in Survival.
4. **Look-ahead probes, every 8th frame** (424-473): two `CellAtPositionEmpty(pos, 80)` probes 400 units (2.4 m) ahead and +-150 units (0.9 m) to each side, stored as `frontLClear` / `frontRClear`. They read static scenery cells, not cars.
5. **Stuck detection** (480-497): `hd.speed < 6` (1.1 m/s) while `desiredSpeed != 0` for more than 10 frames -> `recoveryTimer = 22`, desired speed set to -200 (or +200 if already reversing), steer -384 (about 34 degrees; `lastRecoverStrategy` is never changed anywhere, so it is always the same side).
6. **Relative position and cost** (499-504): `dvx,dvz` = target velocity - own velocity; `dist = FindCost(...)` (105-140), an octagonal distance approximation to the target's position **16 frames ahead along the relative velocity** (`dv/256`). `close_pursuit = dist < 2800` (16.8 m).
7. **Target point** (508-582), only when not in recovery:
   - `dist < 8400` (50 m): `dd` = time of closest approach `(dx*idvx - dz*idvz) / (idvx^2 + idvz^2 + 1)` (the swapped-looking axes are the original's naming), clamped to **0-60 frames (0-2 s)**, x3/4 when not batter. The predicted point is the target's position plus its velocity x `dd`.
   - Batter: `CarTail = predicted + right_vector x 80 units` (0.5 m to the player's right, inside the car's 0.95 m half-width). Non-batter: `predicted - forward x 160 units` (1 m behind its tail), the "follow" aim.
   - `dist >= 8400`: the target's current position.
   - **Far (`close_pursuit == 0`)**: the steering target is `WibbleDownTheRoad(self, speed*10 + 680, ...)` (147-215), four steps of `getHeadingToPlayer` each a quarter of that distance: 4 m at rest, 17 m at 39 m/s of lookahead. `getHeadingToPlayer` (`pathfind.c:1067-1126`) follows the gradient of a distance field seeded at the player's position + 8 frames of its velocity (`pathfind.c:970-972`), falls back to the last known position beyond 61 440 field units, and goes straight at the player when the field distance is under 1536 (the field's own scale, roughly 10-20 m [inf]). `pathStraight` (heading change under +-17 degrees across the four samples, 211-214) selects the faster speed table.
   - **Near**: the target is `CarTail` (555-557).
8. **Zone choice** (591-686). In the cop's own frame, `t` = forward distance to the target point, `n` = lateral offset (+ right), `slidevel/140` of side-slip subtracted. See 2.3.
9. **Desired speed shaping** (693-702): only when `!doBatter` and `dist < 4096` (25 m): blend toward `max(playerSpeed - 20, 20)` units/frame so a normal cop tails politely. **Skipped in Survival.**
10. **Thrust** (704-728): `maxPower = (level + 8) x 1024 = 10240` (+ `(level + 4) x 1024 = 6144` on a straight), x `(4596 + felony/4)/4096`; thrust is full when 50 units/frame (9.0 m/s) or more below the desired speed, proportional inside +-50; x`(speed+80)/128` below 48 units/frame (8.6 m/s) as a launch softener; /2 for 4WD; x0.7. Pursuers drive **all four wheels** (`wheelforces.c:453-457`: front wheels get `thrust` too).
11. **Steering** (731-738): `desiredSteerAngle` slewed at most 200/4096 of a turn per frame.

### 2.3 The only "tactics": four zones

| Zone (condition, cop frame) | Desired speed | Steer | Notes |
|---|---|---|---|
| **Front**: target within about +-27 degrees of the nose (`2*abs(n) < t`) and that front side clear | `speed1[2] = 217` or `speed2[2] = 294` units/frame, x1.122, + felony/4 (see 2.4) | `steerDif x 512 / t` (proportional to bearing) | Full thrust always: the desired speed is far above what the car reaches [inf] |
| **Back**: target ahead but 27-76 degrees to one side, and close (`close_pursuit`) | -70 (-12.6 m/s reversing) | +-284 (25 degrees), sign flipped when going backwards | A **reverse K-turn**: back up with the wheel over so the nose swings round to the target |
| **Left/Right**: target far to the side (over 76 degrees) or behind | +110 (19.8 m/s) | +-512 (45 degrees) | **`wheelspin = 1`** when not already rotating (`cop_ai.c:675-679`): thrust forced to `powerRatio x 5000/4096` and front friction +600 with rear = 1920 - front (`wheelforces.c:107-108,130-135`), so **the tail breaks loose**: a deliberate power-slide turn. Both sides blocked -> reverse at -120 (-21.6 m/s) |
| **Recovery** (stuck) | +-200 | -384 once, then 0 | 22 frames |

There is no PIT, no block, no head-on selection and no handbrake in the cop code (the handbrake is only used to freeze a cop, 357-363, 410-422). What reads as a head-on is the closest-approach lead of 7 meeting an oncoming player; what reads as a T-bone is a crossing path. [inf]

### 2.4 Numbers (converted)

| Constant | Raw | Converted | Where |
|---|---|---|---|
| `speed1[]` (curves) | 203 / 210 / 217 | 36.5 / 37.8 / **39.1** m/s (level 0/1/**2**) | cop_ai.c:48 |
| `speed2[]` (straights) | 238 / 266 / 294 | 42.8 / 47.9 / **52.9** m/s | cop_ai.c:49 |
| Survival scale | 4596/4096 | x1.122; felony 0 -> 43.8 / 59.4 m/s (level 2 speed1 / speed2) | cop_ai.c:289 |
| Felony term | `felony x 1024 >> 12` = felony/4 | felony 659 (pursuit min) -> x1.162; 2457 -> x1.272; 4096 (max) -> x1.372 = 53.6 / 72.6 m/s | cop_ai.c:639, 713 |
| These are **targets**, not top speeds | | The car's real top speed is set by drag and thrust data not in the repo [inf] | |
| `close_pursuit` | 2800 | 16.8 m | 504 |
| Lead / intercept range | 8400 | 50 m | 510 |
| Polite-follow band (unused in Survival) | 4096 | 24.6 m | 694 |
| Stuck threshold | speed < 6, > 10 frames | 1.1 m/s, 0.33 s | 480-485 |
| Recovery | 22 frames, -200, -384 steer | 0.73 s reverse | 487-496 |
| Turn zone / back zone / both-blocked | +110 / -70 / -120 | 19.8 / -12.6 / -21.6 m/s | 669-673 |
| Wibble lookahead | `speed x 10 + 680` units | 4.1 m + 10 frames of travel | 552 |
| Closest-approach clamp | 0-60 frames | 0-2 s | 525-528 |
| Batter offset | 80 units right | 0.5 m | 540-541 |
| Ping-out | 24 000 | 144 m | civ_ai.c:1635 |
| Ping-in ring | `PINGIN_DIST_WANTED_MULT 10 x 2048` | about 123 m (coarse 12 m lattice) | civ_ai.c:1871, 1980-1991 |
| Roadblock ring | `PINGIN_DIST_MULT 8 x 2048` | about 98 m ahead of the player's heading | civ_ai.c:3318-3333 |
| Sight (not used in Survival) | 2720 / 5440 surround, 7820 / 16320 front | 16 / 33 m, 47 / 98 m | cop_ai.c:225-232 |
| Cap on all cars | `MAX_CARS 20` | player + cops + traffic | dr2limits.h:20 |
| Default civilian count | 14 | cops need a free civilian slot | mission.c:104, main.c:910 |

Engine force for the comparison in the summary [est]: cop thrust after step 10 = 4021 (felony 0, curves) to 6434 (straights) per wheel pair share, x4 driven wheels (the /2 is for 4WD), so 16 100-25 700 total; the player gets `powerRatio x 4915/4096` at the rear pair only (`handling.c:1311`; `powerRatio` is car data, the code's own threshold is 3050, `handling.c:1331`) = about 3 700 per wheel, 7 300 total. Ratio 2.2-3.5. The unit of "thrust" is the original's; the ratio, not the absolute, is what matters.

### 2.5 A slow, stopped or cornered player

- **Nothing in the code switches to containment.** The polite tail (`dist < 4096`, blend to the player's speed minus 20 units/frame, floor 3.6 m/s) exists but needs `doBatter == 0` (`cop_ai.c:694`); Survival forces batter on.
- A stopped player: `dd` is the time to reach him, the aim is `player + 0.5 m right`, desired speed stays at full: the cop drives into the player's right flank at full thrust until it stalls, 10 frames later reverses 0.73 s, then re-aims. **All cops pick the same flank**, so a stopped player is hit on his right side by a stream of cops. [inf from 7]
- A player beside the nose and close: the reverse K-turn (zone Back) or the power-slide turn (Left/Right), so cops do swing round to face a player who has slipped past. [code]
- A cop that reaches the player and finds him stationary does **not** slow to avoid a bust (there is no bust). Damage only comes from impacts of 5 m/s or more (2.8), which is exactly what the 1.07 s back-off-and-return produces.
- When the target is over 50 m away the cop follows the distance field; a cornered player behind scenery is reached by whichever route the field gives, and the 400-unit probes only steer round static cells.

### 2.6 Cop-to-cop and obstacle avoidance

- No cop-to-cop steering of any kind: `CopControl1` reads the target and static cells only. The distance field marks **civilian** cars as obstacles (`pathfind.c:817-858` loops `CONTROL_TYPE_CIV_AI` only), not pursuers.
- Cop-vs-cop and cop-vs-traffic impulses are softened: `strikeVel x (7 - gCopDifficultyLevel)/8` = 5/8 at level 2, applied when the pursuer is the first car of the pair and the other car is not the player (`hndType != 0`) (`handling.c:599-606, 638-645`). So collisions between cops and traffic are damped; collisions with the player are full strength.
- Cop collision boxes **against scenery and buildings** are 13/16 as wide as the box of a 2WD car (`bcollide.c:645-649`: `fourWheelDrive == 1` -> half-width x13/16): cops fit through gaps the player's car does not. [code]

### 2.7 Count, spawning, loss

- **How many are wanted** (`ControlNumberOfCops`, 987-1067): felony triggers `{0, 819, 1638, 2457}` (`InitCopData`, 237-255) give 1, 2, 3, 4 cops; floored at `gMinimumCops` and capped at `maxCopCars` (1011-1015). With `maxCopCars = 4` the pack never exceeds 4. [code + inf]
- **How fast a new one comes:** `respawnTime x FIXED(4096 - ...) < cop_respawn_timer + 1` with `respawnTime = 0` is always true, so `requestCopCar = 1` the same frame a cop is missing (1017-1030). `main.c:910-918` tries `PingInCivCar` five times per frame.
- **Where:** a ring of `10 x 2048` units round the player, stepping the angle by 1/56 of a turn per attempt until the cell is a road (`civ_ai.c:1980-1991, 2002-2068`). Not "ahead first", not out of view (there is no view test in this code path), always on a road lane, facing along the lane. The spawned car is a civilian-controlled cop that **turns into a pursuer the same frame** if felony > 658 (`PassiveCopTasks`, `cop_ai.c:965-984`), which means the Survival mission sets the felony above that [inf].
- **Loss:** a pursuer more than 144 m from the player is removed (`CheckPingOut` via `CopControl`, `cop_ai.c:1211-1221`, `civ_ai.c:1626-1635`) and replaced at once; a hidden-for-50-frames removal exists but runs only when cops cannot see the player (`cop_ai.c:910-932`), never in Survival. The "rubber-band down" for surplus cops (`cutOffPowerScale = 2048`, half desired speed past the wanted count, 634-635, 1040-1064) is **dead code in Survival**: it reads `DistanceToPlayer`, which is only written inside the `!CopsCanSeePlayer` loop (`cop_ai.c:802-863`, write at 817).
- **Cops never wreck:** `immortal` means a cop's damage is cosmetic (the dents show, `bcollide.c:304-331` still adds damage) and nothing removes it. [code]

### 2.8 Damage and how the player loses

- Budget `MaxPlayerDamage[] = 22000` (`mission.c:262-263`; a mission header can override, 523-526). Death at `totalDamage >= max`, or **upside down (`m[1][1] < 100`) for more than 180 frames = 6 s**, then `dying > 40` frames (1.3 s) ends it (`mission.c:2888-2941`). Drowning counts too (`main.c:2184-2188`).
- Per hit: `howHard = (v/256) x (normal/32)` = 2048 x closing speed along the normal in units/frame (`handling.c:494-496`); each car takes `howHard >> 1` (500-504); `strikeVel = (howHard>>1) x 375 >> 8`; **below 40 960 nothing is damaged** (`bcollide.c:383-395`); otherwise `value = ((strikeVel/350 + 512) x 3) >> 3`, capped at **1143** (421-427), x `gPlayerDamageFactor` (4096 = x1, `mission.c:246`).

| Closing speed along the normal | 4 | 5 | 6 | 10 | 15 | 20 | 30 | 40 | 50 m/s |
|---|---|---|---|---|---|---|---|---|---|
| Damage to the player [est from the formula, 6 mm/unit] | 0 | 236 | 245 | 281 | 325 | 370 | 459 | 549 | 638 |

The threshold is **4.9 m/s (11 mph)** of closing speed; the cap of 1143 would need 106 m/s. So: at 30 m/s about 48 hits, at 15 m/s about 68, and the absolute best case is 20 hits. **Sustained pushing at matched speed deals zero damage**; it is the back-off-and-return that kills. [est]
- Cops also take damage but are never removed; non-player cars use `value x 2` and, for pursuers at level 2, `x7/16` (`bcollide.c:310-322`).

### 2.9 Felony in Survival

- `CopsCanSeePlayer` is permanently 1, so the whole sight model is idle (`cop_ai.c:776`; `UpdateCopSightData`, 218-234, still sets the radii).
- Felony still moves: it grows +1 per 32 frames (1.07 s) while it is above 658 and the cops see you (`felony.c:255-266`, `InitFelonySystem` sets 31, 424-432), and jumps by 659-1318 per offence (`felony.c:21-35`, `NoteFelony` 157-170; x0.73 once above the pursuit minimum, `pursuitFelonyScale` 3000/4096, `cop_ai.c:266`; per-type recurrence delays 0-256 frames, `felony.c:15-16`). Hitting a *pursuer* adds none (`CarHitByPlayer`, `felony.c:449`). Passive growth from 659 to 4096 would take about 61 minutes, so offences against traffic and scenery are what raise it.
- What it changes in Survival: **desired speed and drive force +0 to +25 %** (`autoDesiredSpeedScaleLimit`, `autoMaxPowerScaleLimit` = 1024), the wanted count (1-4), and roadblocks above 1318 (`felony.c:228-234`, `main.c:877-898`). It does **not** change batter, spawn delay (`autoRespawnScaleLimit` stays 0) or aim. [code]
- The mission script may set the starting felony (`MRSetVariable`/SetPlayerFelony command, `mission.c:831-835, 1570-1579`); the Survival scripts are data and are not in the repo. [inf]

### 2.10 Roadblocks and sleeping cops (in the code; whether Survival fires them is unverified)

- `main.c:877-897`: when felony > 1318, cops are in pursuit and no roadblock exists, `roadblockCount` runs down (`roadblockDelayDiff = {1500, 1000, 800}` frames + 0-255, `cop_ai.c:56`, `civ_ai.c:3561`; level 2 = 27-35 s), then `requestRoadblock` -> `CreateRoadblock` (`civ_ai.c:3275-3565`).
- Placement: on the first road found on a ring `8 x 2048` units (about 98 m) from the player, **starting from the player's direction of travel** and sweeping the angle if no road is there (`MainPlayer.dir`, 3308-3365); cars across every lane (`laneNo` from 256 to `numLanes x 512`, 3436-3481), plus a second staggered row on levels above 0 (3484-3558).
- The cars are **civilian cops flagged `CONTROL_FLAG_COP_SLEEPING`** (`dr2types.h:484`, `IS_ROADBLOCK_CAR` `cars.h:7`): parked, **sirens lit** (`cars.c:1636-1645`), woken by touching the player (`handling.c:518-531`, only while `numCopCars < 4`) or by `PassiveCopTasks` once the player is seen.
- These are the code's only "waiting ahead" behaviour. There is no evidence in the repo that Survival's mission data enables them (needs felony > 1318 and free civilian slots).

### 2.11 What Driver 2's cop code does *not* contain

Roles or formations; a PIT, block or brake-check routine; a handbrake turn (the nearest thing is the `wheelspin` power-slide, 2.3); feints or timing games; hiding, lights-off or blind-side approaches (the cop siren light is drawn for every pursuer, `cars.c:1636-1645`; spawns have no view test); self-preservation (cops are immortal); squad communication beyond the radio phrases (`CopSay`); any use of the felony meter to change tactics (it only scales pace and count). Everything a player calls "smart" comes from the closest-approach lead, the 2.1x grip and 2-3x thrust, the K-turn and the power-slide turn. [code]

### 2.12 Not in the repo

The mission data (header `cops.speed/power/min/max`, the Survival felony start, `maxCivCars`), car `mass`, `powerRatio`, drag and top speeds, and the `MaxPlayerDamage` override. Claims that depend on them are marked [inf] or [est].

## 3. Driv3r

- **Same mode, 4 cops** [dev]: Martin Edmondson (Reflections founder), Kikizo 8 Jan 2004: the driving games "include the 'survival' mode for Driver 1 - 4 cops against your own vehicle". The manual: "Survive as long as possible while manic cops ram and try to wreck you." [dev]
- **Gunfire** [player]: the Driver wiki: the player must "dodge pursuing police vehicles and dodge bullets flying at them"; vehicles take significant damage only when the engine is hit.
- **"Doublespeed"** [player]: the Driver wiki's Driv3r page: "a pursuing cop would suddenly double its speed making it hard (if not impossible) for the player to escape ... No matter what vehicles players can pick (either fast or slow or even a police car), the police AI seems to always catch up and stay with the player", and that escape comes from forcing cops "on to a sidewalk and crashing into a post, trees, or even vehicles". It attributes this to the series' "rubberband AI". Not an observed number: no threshold, duration or trigger distance is documented.
- **Crude navigation** [player]: GameSpot and GameRevolution call the police AI "crash-happy" and poor at obstacles (saved in `perplexity/2026-11-01-driver-survival-cop-ai.md`).
- **No code** [code check]: the only public Driv3r decompilation (`ibtr54/Driv3r-Decompilation`) has 109 tree entries (one 5 700-line `main.cpp`, menu, car sim, physics, damage) and no cop, pursuit or Survival logic (`main.cpp` only lists the Survival menu entry, lines 4416, 5020, 5277). Nothing here is a code-level Driv3r finding.
- **Versus Driver 2's code:** Driver 2 has no catch-up *boost*. Its rubber band runs the other way (surplus cops slowed to half, `cutOffPowerScale`, dead in Survival) and its felony scaling is a smooth +25 %. If Driv3r's doublespeed is real it is a new mechanism, not an inherited one. Our `CATCH_UP` boost (`cop-brain.ts:22`) is closest to the Driv3r report.

## 4. Real police: a boxed-in suspect who tries to break out, PIT and ram limits

All [policy], from `perplexity/2026-11-01-police-box-in-escalation.md` and `...pit-maneuver-technique.md` (they cite St. Paul 443.13 and 443.00, Fargo 307, Albuquerque 2-12 and 2-45, DOJ COPS Use-of-Force, Franklin WI, Illinois State Police OPS-003, FLETC 2017-1, NM State Police). Those answers flag that agencies differ and that the distance and angle advice is general training principle rather than one national rule.

- **Containment / blocking** is a slow-speed, coordinated manoeuvre to hold a **stopped or parked** vehicle, by trained officers, usually for serious offenders (Fargo). **Pinning / "pinching"** is preplanned, low-speed, intentional **non-striking** contact to keep a car immobile, trained specialist units and command approval only (DOJ example); St. Paul defines it as contact with a **stationary** vehicle and separates it from ramming.
- **A suspect who starts driving changes the analysis.** It is no longer ordinary pinning. Officers should not wait for speed to build; they brake, steer away, reposition or disengage, call the movement out and re-assess, or move to an authorised intervention or a deadly-force analysis. Trying to move a car is not by itself grounds for deadly force; the test is an imminent threat of death or serious injury.
- **Officer self-protection:** never stand between vehicles or in a crush zone; keep reaction space so there is room to brake or steer out; angle the cars rather than presenting a flat side; use these tactics only when trained.
- **Speed limits.** Albuquerque: no PIT above 35 mph (15.6 m/s) unless deadly force is justified; DOJ example: PIT at or under 40 mph (17.9 m/s) is intermediate force, above it deadly force; Illinois State Police: 40 mph or less; FLETC student lessons: about 25 and 35 mph (11 and 15.6 m/s). Even under the limit a PIT can be deadly force (motorcycles, roll-prone vehicles, deflated tyres, crowds, roadside hazards).
- **Ramming:** deliberate high-speed impact is classed as deadly force, allowed only when deadly force is justified and no reasonable alternative exists (Fargo, St. Paul, DOJ).

What this gives the game: a three-rung ladder the owner's "escalation once the player squirms while surrounded" can follow: **contain** (stationary or creeping contact, today's `SETTLE`/`CREEP`), **PIT** (matched speed, readable, capped), **ram** (the deadly-force rung, kept for a player who is clearly forcing out hard). Arcade licence applies to the numbers, not to the order.

## 5. The PIT: what is taught, why it works, where our cops differ

### 5.1 The taught technique ([policy] `pit-maneuver-technique.md`: ISP OPS-003, FLETC, Albuquerque 2-12, NM State Police)

1. **Authorise and assess**: seriousness, traffic, pedestrians, road width, slopes, barriers, vehicle type, escape path; policies bar it near drop-offs, crowds, opposing traffic, roll-over hazards.
2. **Match the suspect's speed.** Close the gap with little speed difference.
3. **Offset position:** alongside or slightly behind, the police car's **front corner (bumper or fender) against the suspect's rear quarter panel, just behind the rear wheel**. No agency teaches one number of inches; it is a contact zone.
4. **Gentle steer into the suspect**, deliberate, not a swerve or a T-bone; keep enough throttle that the bumper stays engaged.
5. **Keep the drive on through contact**, and steer only long enough to start the rotation; **release once the yaw begins**.
6. **Follow-through:** reduce contact, **straighten the wheel, brake away** from the rotating car so the police car is not pulled into the spin; watch the spin's likely path (shoulder, median, barrier), not the contact point.
7. **Backups do not enter the spin**; they box the stopped car afterwards at safe angles.

### 5.2 Why it works

- The push acts laterally **behind the target's centre of mass**, so the force makes a yaw moment, `tau = r F`, with `r` the distance from the centre of mass to the line of the force. The rear tyres are shoved sideways **past their lateral grip** and slide while the front tyres keep guiding the car along its old line; that difference gives the rotation, commonly toward 180 degrees. ([policy] FLETC wording.)
- **My arithmetic** [est], 1 500 kg target, yaw inertia about 2 500 kg m^2 (radius of gyration 1.3 m), 1 800 kg police car, 1.5 m/s lateral closing speed, restitution 0.2: a push at the rear quarter (`r` = 2.0 m) gives a yaw impulse of about 1 300 N m s (0.5 rad/s); the same push at the door (`r` = 0.3 m) gives 0.17 rad/s and about twice the sideways shove. Contact at the **rear axle line only has to saturate the rear axle** (about half the lateral grip budget, roughly 6 kN for a 1.5 t car at mu 0.8), while the front axle still grips: that is what turns a push into a spin. A push at the centre of mass loads both axles equally, so the car **slides sideways** instead of rotating, which is the "T-bone" outcome and the one that trips and rolls tall vehicles at speed.
- **The direction matters for the police car.** A push at the target's tail swings its **nose toward the police car** (tail pushed away from the cop, nose swings round to the cop's side). That is why steps 5-6 exist: the car that just did the PIT must be moving away from where the nose is going.
- **Energy:** `E = 1/2 m v^2`; low relative speed is what keeps the contact short of a crash. The policy ceiling (35-40 mph) is where outcomes stop being predictable (rolls, trips).

### 5.3 Common errors ([policy])

Contact too far forward (door / front half): more direct side impact, less yaw, injury and entanglement risk. Too far back or glancing: the bumper slides off, little rotation, the police car goes to the shoulder. **Too much speed difference:** the impact becomes a ram and the trajectory is unpredictable. **Over-steering:** pulls the cop into the target, destabilises both, the officer follows the spin. Insufficient forward drive: contact lost before enough yaw. Ignoring the environment. Poor coordination: backups enter too early and hit a car or take the escape room.

### 5.4 What our `attackTarget` does (`cop-brain.ts:136-207`)

Cars are 1.9 x 4.6 m (`pack-guard.ts:14`); a car's nose is 2.3 m from its centre. "Along" is metres ahead of the target's centre, "side" is lateral.

| PIT step | Faithful | `attackTarget` PIT branch (`cop-brain.ts:180-183`, `28-30`, `151`, `199`, `204-206`) | Error it matches |
|---|---|---|---|
| Speed | match, relative 0-2 m/s | `want = tv + 8` (151); throttle 1 until `speed > want + 2` (204-205), i.e. **up to +10 m/s** along the target's flank; boost on when `along < -6` (206) | "too much speed difference"; at 8 m/s the nose passes a 2 m quarter panel in 0.25 s [est], so the push never lasts the 0.3-0.6 s a rear axle needs to slide |
| Contact point | cop centre at along about -4.1, nose at the rear quarter (-1.8) | the alongside branch (180-183) aims the cop's *centre* at **along +1 (or +1.5), side -0.5 (or -1.5): 1 m ahead of the target's centre and across its centreline**; the "behind" role (`role % 3 === 0`, 184-187) lines up at `fwd = -PIT_BACK = -2`, `lat = 1.7`: cop centre at -2, so its nose is at **+0.3, the target's door** | "contact too far forward": a lever of about 0-0.5 m, not 2 m |
| Steering | gentle, progressive, capped | `pursuitSteer(alpha, hypot(aim - self))` (199): proportional to bearing to an aim point a few metres away *inside* the target, so the wheel goes toward full lock as it closes | "over-steering" |
| Drive through contact | hold speed | throttle full (204-205) | too much drive, climbing up the flank |
| Release on yaw | steer straight, brake away | **none**: no state, no yaw read of the target. After the target yaws, `along` and `side` change and the branch order re-selects [inf]: `block && along > AHEAD_OF` (168-173) would then turn the cop to cut *in front of* the spinning car, into its swing path | "follows the spin" |
| Backups | hold off, box the stopped car afterwards | every unit is in the same function; roles `role % 3` put a PIT, a slam and a side hit on at the same time (184-193), no token | "poor coordination"; also GTA V's "several nearly simultaneous unavoidable hits" [player] |
| Preconditions | environment check on the spin side | speed gate only (`tv > PIT_MAX`, 174, `PIT_MAX = 20`, 37); the dodge for solids runs in `HunterBrain.dodge` (`hunter.ts:342-349`) toward the target, not away from the spin | "ignoring the environment" |
| Speed cap | 15.6-17.9 m/s | 20 m/s in code; the owner has chosen about 30 m/s for Survival | a game choice (see section 1, point 10) |

Predicted outcome [est]: from a cop 3-4.5 m behind and 1.7-3.4 m beside the target at matched speed, the cop converges at a lateral rate of about 4 m/s with its nose landing between the target's centre and front axle, so the typical result is a door/front-wheel shove at 4 m/s lateral and +8 m/s along-track, not a yaw. Measure it (section 10) rather than trusting this paragraph.

### 5.5 What a faithful PIT changes (all in `attackTarget`'s alongside/behind branches plus one per-unit state next to `role`/`since`/`wedge` in `CopBrain`)

A proposal; the numbers are starting points to be tuned in the headless test, in the target's frame, metres and m/s:

1. **A state per unit** `pit[u]` in `CopBrain`: `none -> align -> engage -> clear -> contain`, with a token so **one PIT driver per target at a time**; the rest keep their row/lane (`slot()`, `hunter.ts:325-339`) until the token is released.
2. **Entry gate:** `tv <= PIT_MAX` (owner's 30 m/s for Survival; the race police keep a lower cap through a parameter), a clear run on the **spin side** (`Obstacles.run` from the target along the direction its nose will swing, 12 m; the grid exists, `hunter.ts:98-159`), and the cop within `ATTACK` and roughly parallel (heading within 0.12 rad).
3. **Align:** cop centre to (along -4.1, side +-2.6): nose at -1.8, 0.7 m off the flank. `want = tv + clamp(0.5 x (along_slot - along), 0, 3)`: close at most 3 m/s, at the slot within 1. **Replaces** `want = tv + 8` and the `fwd`/`lat` of lines 182-187.
4. **Engage** (|along - slot| < 0.6, |speed - tv| < 1.5): slide the aim lateral from 2.6 to 1.6 (contact is at 1.9) at no more than 1.2 m/s; cap the steer at 0.35 of lock, ramped over 0.4 s; `want = tv + 1` (drive on, no acceleration through the contact). Replaces the `pursuitSteer` of line 199 for this state.
5. **Release** when the target's yaw rate exceeds 0.5 rad/s, or its heading differs from its velocity by more than 0.25 rad, or 0.8 s have passed with no yaw (the bumper slid off: abort and re-align).
6. **Clear** (1 s): steer parallel to the pre-contact heading, brake 0.4-0.6 until relative closing is zero, aim lane shifted 3 m away from the swing side; the existing pack guard stays on (`guardMates`). While in `clear` the unit **never** takes the `block` branch.
7. **Contain:** when the target is under 8 m/s or has turned past 90 degrees, the other units switch to settle slots at 6-8 m (the `SETTLE`/`CREEP` logic, `hunter.ts:83-85, 307-313`) so the bust hold (12 s at 20 m, 20 km/h) can run on a spun player.
8. **Same function serves the race police** (`police.ts` calls `attackTarget`): add the cap and the new behaviour as parameters and rerun `police.test.ts` and `hunter.test.ts` (the existing PIT test is `hunter.test.ts:291-304`: "10 m/s presses on with its PIT", which this changes to "matched speed, steer capped").

For the player this matters because the PIT's value in a game is **readability**: a cop that matches speed beside you, hangs there for half a second and then leans in is a hit you can see coming and counter (brake, accelerate, steer into it). The current shove arrives at +10 m/s relative with no warning. [inf; NFS and GTA V commentary in section 6 says the same of fair hits]

## 6. Other games, distilled (all from the saved Perplexity answers; reliability stated)

- **NFS Most Wanted 2005** [rev] (TsyVM/MWEncyclopedia, "byte-verified" per the author; I read C48.4, C49.3 and C14.1): bust is an **envelope, not vision**: inside radius 15.0 (90.0 when a cop is *engaged*; units not stated, metres [inf]), below `BustSpeed`, bust meter fill `dt x 0.25` (**`dt x 4.0` when engaged = 16x**), drain `dt x 0.5`, flagged at 5.0, then a **3.0 s** hold. Dispatch is two Heat-indexed tables (`CopCountRecord`, `CopFormationRecord`, "flanking, boxing, pincering", which its author marks "reasoned", not verified) and reinforcement gates Leader -> Heavy -> AirSupport. The count table **tops the pack up to a target**. Evasion is "fast, far, or out of the search phase", not hiding.
- **NFS MW / Hot Pursuit roles** [player + wiki]: primary chasers, interceptors, blockers, Rhinos, support; "units in position" radio; roadblocks have gaps, spike strips cover one side; pursuit breakers. Fair because counterplay is readable.
- **GTA IV/V/SA** [player + mod data]: rear-ramming and PIT are separate parameters (a realistic-dispatch mod removes rear ramming and keeps PIT); units spawn ahead; pile-ups come from convergence, not intent; GTA V criticised for rapid reacquisition, spawns ahead in view, near-simultaneous unavoidable hits and no feedback on why the search continues.
- **Burnout 3 / Revenge / Hot Pursuit 2010** [player + reviews]: side shunts and rear-quarter slams, attack angle and timing as the skill; an e-brake-like side attack is "emergent, not a named state"; a Revenge marker as a cheap memory system; takedown camera as confirmation.
- **Novel pursuit tactics** (`novel-pursuit-tactics.md`, [player + wiki, unevenly sourced]): coordination is usually scripted spawns and targeting; predictive interception and "wait ahead" are real but mostly spawn placement; sneaky approaches ("lights off, blind spots") are rare and often just off-screen spawning; feints are rare and usually accidental; NFS III Hot Pursuit lets cops switch to a more dangerous AI racer; players like **readable intent, counterplay, escalation, physical commitment (a missed PIT leaves the cop exposed), recoverability**, and dislike unreadable feints, spawns at the only exit, suicidal damaged pursuers, rubber-banding and teleporting.

## 7. Mapping: each behaviour, Driver 2, ours today, what to adopt

`[ours]` figures are from `hunter.ts`, `cop-brain.ts`, `pack-guard.ts`, `docs/SURVIVAL.md`.

| # | Behaviour | Driver 2 (code) | Ours today | Adopt |
|---|---|---|---|---|
| 1 | Pack size and growth | about 4, flat; felony 1-4 (`cop_ai.c:237-255`) | 4-6 formation, +1 per `HUNT.every` = 12 s to `HUNT.cap` = 12 (`hunter.ts:13-47`) | **Keep**. Ours is a design extension; D2 is flat. Note the loss: with 12 cops, per-cop clarity drops (section 9.1). |
| 2 | Replacement speed | same frame (`gCopRespawnTime = 0`) | one drop-in per `HUNT.gap` = 1.5 s | Keep; it is the stated limiter (`SURVIVAL.md` Co-op measurement). |
| 3 | Spawn place | ring about 123 m, any road, no view test, no "ahead first" (`civ_ai.c:1980-2068`) | road spots 70-120 m, ahead first, out of view, 70 m clear of the player's path (`hunter.ts:508-538`) | **Keep** (strictly better). Do not copy the pop-in. |
| 4 | Lost cop | removed at 144 m at once | 140 m and 5 s hidden (`HUNT.far`, `farTime`) | Keep. |
| 5 | Cop death | immortal | wrecked cops stay 6 s, then replaced (`wreckStore`) | Keep; see row 17. |
| 6 | Perception | omniscient (`cop_ai.c:776`) | omniscient (`nearestHunted`, `hunter.ts:469-485`) | Keep. Ours matches D2 and differs from NFS/GTA, which have an evade phase; an optional evade phase is a mode, not a fix. |
| 7 | Lead / prediction | closest-approach time from **relative** velocity, 0-2 s, within 50 m (`cop_ai.c:512-531`); direct beyond | `attackTarget` lead `clamp(dist/max(4, speed), 0, 0.5)` s (`cop-brain.ts:148`), `chase` `min(2, dist/max(8, speed))` s (`hunter.ts:353`) | **Adopt** closest-approach `dd` in both: `dd = clamp(-dot(r, dv) / (dot(dv, dv) + eps), 0, 2)` with `r` = target - self, `dv` = target velocity - own. Three lines; crossing targets get intercepted instead of tail-chased. |
| 8 | Aim point at close range | player's flank 0.5 m right of predicted centre; all cops the same | per role: behind PIT/slam lanes, block ahead, head-on (`attackTarget`) | Keep ours (varied, role-based); fix the PIT geometry (section 5). Do **not** copy the single flank; it is what makes D2 packs queue on one side. |
| 9 | Close-range speed | full thrust, no matching (`cop_ai.c:694`) | settle to a 3 m/s creep within 12 m of a stopped player (`hunter.ts:307-313`) | Keep for the bust path; **escalate** on squirm (section 8). |
| 10 | Stuck recovery | 10 frames stuck (0.33 s), reverse 22 frames (0.73 s), steer fixed | 1.2 s no progress (`STUCK_FOR`), back 0.9 s (`BACK_FOR`, `cop-brain.ts:58-60`), steer opposite | **Adopt** a shorter window for a unit that is *in contact* with the player (D2's 1.07 s re-ram cycle is what kills a pinned player); keep 1.2 s for open-ground wedges. |
| 11 | Target beside the nose | reverse K-turn (zone Back) and power-slide turn (`cop_ai.c:658-685`) | pure pursuit with `turnRate` grip limit; `chase` drops to 0.2 throttle when the aim is over 1.3 rad off the nose and speed is over 6 m/s (`hunter.ts:361`) | **Adopt** the K-turn for a *close* target 0.5-1.3 rad off the nose (reverse at -12 m/s, counter-steer) and consider the power-slide (rear breakaway) for targets behind; both are data-light. |
| 12 | Cop-to-cop avoidance | none; pursuers are not path obstacles (`pathfind.c:817-858`) | `guardMates` 3 s horizon, steer and brake (`pack-guard.ts`) | **Keep** ours. D2's pile-ups are a lack of this; ours already keeps the crashes player-caused. |
| 13 | Scenery avoidance | two 400-unit probes and a distance field | `Obstacles` 16 m grid, swath 1.6 m, `openHeading`, `dodge` (`hunter.ts:98-159, 342-397`) | Keep (richer). |
| 14 | Handling advantage | friction x2.1, drive force about 2-3.5x, narrower scenery box x13/16 | the `police` vehicle class, durability 1.3 (`SURVIVAL.md`) | **Decide**: the `CATCH_UP` boost (`cop-brain.ts:22`) is the only advantage. If Survival needs D2's "unfair" feel, raise police-class grip and thrust, not the boost. |
| 15 | Heat scaling | +0..25 % desired speed and force with felony | none by time or heat except count | **Adopt** a smooth pace/force scale on run time or on the cop count (`copsWanted`), x1.0 -> x1.2 over a few minutes: cheap, D2-faithful. |
| 16 | Slow-down for surplus cops | dead in Survival | none | Skip. |
| 17 | Cop damage / self-preservation | none (immortal) | none in hunters; the derby brain has it (`derby-ai.ts:511-513`: `brawl`, `tailSpent`) | **Optional**: front damage over about 0.7 -> tail swing or peel off (section 9.5). |
| 18 | Contain a stationary suspect | none | creep, bust after 12 s within 20 m under 20 km/h (`SURVIVAL.md`) | Keep; it is the real-police rung and NFS MW's envelope. Consider NFS's **engaged** scaling (meter x16 with an engaged cop, radius x6) as a dial. |
| 19 | Escalation when the suspect forces out | batter always | none | **Adopt** (section 8). |
| 20 | PIT | none | `attackTarget` PIT (section 5.4) | **Adopt** the faithful PIT (5.5). Cap 30 m/s owner-chosen. |
| 21 | Ram / head-on | emergent from closest-approach lead at full throttle | `headOn` from `RAM_TIME` = 3 s, `HEAD_ON` = 0.7 (`hunter.ts:299-301`) | Keep; make it the third rung of the ladder (section 4). |
| 22 | Block ahead | none | `block && along > AHEAD_OF` brake-check (`cop-brain.ts:168-173`) | Keep; stop it from firing during `clear`. |
| 23 | Queue behind a fast target | none | `tv > PIT_MAX` lane/row queue (`hunter.ts:325-339`) | Keep. A cap of about 30 m/s shrinks the queue to players faster than that (the boulevard run that set the 20 m/s cap was 40 m/s, `cop-brain.ts:31-36`); re-measure the 30 s end-of-run test (`SURVIVAL.md` tests table). |
| 24 | Roadblock / wait ahead | sleeping civilian-cops across the road about 98 m ahead of the heading, woken by contact or sight (`civ_ai.c:3275-3565`; Survival use unverified) | none in hunters; `PoliceBrain` stakeouts exist for races (`police.ts:22-40, 76-91`) | **Adopt** as an ambusher state (9.2). |
| 25 | Sirens | always lit for pursuers (`cars.c:1636-1645`) | on at `deploy` (`hunter.ts:495`) | Keep; "dark cop" only as a deliberate optional unit (9.3). |
| 26 | Handbrake swing | none (the `wheelspin` turn is a rear breakaway) | none in hunters; derby has `T_SWING` (`derby-ai.ts:550-557`) | **Adopt** a limited version (9.5). |
| 27 | Roles | none; a count only | `role[u] = u` fixed at deploy (`hunter.ts:492`), `role % 3` | **Adopt** dynamic role assignment (9.1). |

## 8. Escalation when the player squirms while surrounded

Real police: a suspect trying to force out of a box is not "pinned" any more; the response is disengage and re-position or a trained intervention, and force rises with the threat, not with resistance alone. Driver 2: no rungs, always batter. NFS MW: an *engaged* cop multiplies the bust rate and radius. The proposal below makes our cops follow the police order and gives the owner's wish; every number is a tunable default [proposal].

**Detector** (per human, per patrol beat, in `HunterBrain.update`), a decayed score `S` in [0, 1], rate 0.5/s down:

- boxed = at least 2 hunters within 10 m and the player's speed below `BLOCKABLE` = 6 m/s (`hunter.ts:82`) for at least 0.5 s;
- while boxed, each of these adds to `S`: player speed rising through 3 m/s (1.0 per m/s gained within 1 s, capped), a contact with a hunter at closing speed over 2 m/s, a reversal of travel direction, steer reversals above 2 Hz at throttle, the player's displacement over 3 m from where the box formed within 2 s.

**Rungs** (with hysteresis, 0.6 up / 0.3 down):

| `S` | Behaviour | Maps to |
|---|---|---|
| < 0.3 | **Contain:** today's `settled` creep; the bust runs | stationary containment |
| 0.3-0.6 | **Brace and close the exit:** the unit nearest the player's escape heading moves to a 4-6 m blocker slot across it (existing `attackTarget` block branch, speed cap `CREEP`), others hold their slots, no hits above 2 m/s | "reposition, maintain space, do not stand in the gap" |
| over 0.6 | **Intervene:** a low-speed shove (closing 2 m/s or less, the "pin") while the player is under `BLOCKABLE`; the PIT token (section 5) once he is moving, up to the cap; the head-on ram rung only above it | contain -> PIT -> ram |

`S` also drives the HUD (an "escape attempt" tell for the player, in the spirit of NFS's busted bar: readable escalation). One new float array in `HunterBrain` next to `settled`; the reads (`nearestHunted`, `closing`, `tv`, `dist`) are already computed in `drive` (`hunter.ts:291-313`).

Test: a scripted player boxed by 4 hunters (the `survival-players.test-util.ts` fleers include "held"; add "break-out" that holds still 3 s then floors it). Expect: before the break-out no hunter exceeds 3 m/s closing and the bust meter fills; within 1 s of the break-out `S > 0.6`, a PIT token is taken by exactly one unit; the player's run ends (bust or wreck) within N s in a majority of seeds; the existing "cornered at 3 m/s is busted by the pack at 9.7 s" (`SURVIVAL.md` tests) is unchanged.

## 9. Novel ideas: what Driver 2 has, what we can build, how to test

The owner's five themes. Guardrails from the research for all of them: telegraph, leave gaps, one hit at a time, never spawn in view, damaged pursuers yield [player: GTA V and NFS commentary].

### 9.1 Pack coordination: roles, formations, who blocks and who rams

- **Driver 2:** none. Every cop aims at the same flank point; the only pack-level thing is the wanted count (2.7). [code]
- **Others:** NFS MW: Heat-indexed count and formation tables, roles chaser / interceptor / blocker, "units in position". Mostly dispatch-driven. [rev, player]
- **Ours:** `role[u] = u` assigned once at deploy (`hunter.ts:492`) and `role % 3` in `attackTarget` (184-193) pick behind / slam / opposite-side; `slot()` already assigns lane and row from the pack's order (325-339); `guardMates` keeps them apart.
- **Build:** each beat compute, in the target's frame, a small set of **slots**: `driver` (behind-left or right quarter, the PIT token), `flank_l`, `flank_r` (alongside 3-4 m, shaving the lanes), `cutter` (ahead on the predicted line, 20-30 m, matched pace x0.8, brake-checks), `anchor` rows behind. Greedy assignment by time-to-slot with hysteresis (a unit keeps its slot unless another is 2 s closer). Changes: replace `role` by a slot enum in `CopBrain`; the slots feed `attackTarget` (`lane`, `row`, the block and PIT branches). Legible: only one driver strikes, flankers hold at 3-4 m until the token passes.
- **Reuse:** `slot()`, `attackTarget` branches, `Obstacles` for slot validity, `guardMates`.
- **Test:** the `rig()` pack (`hunter-rig.test-util.ts`) with a scripted fleer at 15 and 25 m/s: every unit within `ATTACK` holds a distinct slot; at most one unit is in `engage` at any step; a unit changes slot at most once per 2 s; the pack ends the run no later than today's 30 s bound (`survival-chase` tests).

### 9.2 Waiting ahead: predict the escape line and park in the exit

- **Driver 2:** the roadblock: sleeping cop cars across the road about 98 m ahead of the player's heading, found by sweeping the angle from the direction of travel until a road is hit; wake on contact or sight; a second row on level 1 or 2 (2.10). Not a predicted *escape*; just the heading extended. [code]
- **Ours:** `PoliceBrain` stakeouts (`police.ts:22-40`): cops parked out of every racer's sight ahead (`PAST_SIGHT` 10 m past what a racer sees, `AHEAD_SPAN` 60 m), never on the racing line, the second one facing the oncoming racer as a head-on rammer, woken when the racer passes (`PASSED` 30 m), then a 2 s lead-in; `RacerSight` in `cop-sight.ts`. The hunters have `dropSpot()`'s ahead pass (`hunter.ts:515-536`, 0.3 cosine ahead, hidden via `world.hidden`).
- **Build:** an **ambusher** state for one hunter in the pack (not a drop-in): when a unit is lost or wrecked, the replacement takes the ahead drop-in, then holds braked with sirens on until the player is within 30 m or has passed it, then wakes into `chase`. Which exit: extend the player's velocity 4-6 s and, if a known choke is on the line (the plaza crest, the alley), park beside the choke's mouth rather than on the line (fairness: never the only exit). The `pullsOut` read in `pack-guard` already treats a parked unit as a stopped obstacle; add the state to `pullsOut` exactly as `PoliceBrain` does (`police.ts:97`).
- **Reuse:** `dropSpot`, `world.hidden`, `PoliceBrain`'s wake and lead-in code (move to `CopBrain` if shared), `pullsOut`.
- **Test:** a drop-in on the ahead pass is never seen in the `world.hidden` test (`hunter.test.ts:66-95` pattern); the ambusher wakes only inside 30 m or after the pass; with the player holding a line through it, the ambusher contact happens within a window of the line (not on it) in most seeds; a measured "player cannot be forced onto a single path" check: at least two of three headings from the player remain free of an ambusher.

### 9.3 Being sneaky: lights and sirens off, blind sides, props

- **Driver 2:** none; the siren light is drawn for every pursuer and pings have no view test (2.11). Real police: low-profile tailing is real, but the saved answers find it "rarely a consistently documented AI rule"; most apparent stealth is off-screen spawning. [player]
- **Ours:** `world.sirens(id, on)` exists (`cop-brain.ts:219-220`); `hidden()` is the camera test; `Obstacles` knows the props; `pack-guard` already models a woken stakeout.
- **Build (small):** one unit in the pack runs **dark** (sirens off) and approaches on the target's rear-quarter blind arc (target frame, 120-240 degrees behind, hidden from the camera if it can), then lights up at 25 m. Cost: a boolean per unit and one hook. Risk: fairness; the player has to learn the siren is a tell, so it only ever *adds* a siren-on moment before contact (a 1 s warning).
- **Test:** a dark unit's siren turns on at or before 25 m and at least 1 s before first contact; it is never in the camera's view while dark (`world.hidden` fake); the rest of the pack's behaviour is unchanged.

### 9.4 Fake-outs: feints that bait a dodge, then the real hit

- **Driver 2:** none (the K-turn and power-slide look like feints only by accident). Others: "rare, usually accidental" and disliked when unreadable. [player]
- **Ours:** `attackTarget`'s `lead` and the `block` branch (a unit ahead braking) are the natural pieces.
- **Build:** a **feint**: a flanker closes to 3 m on the player's side at matched speed with steer toward him (a visible PIT approach), then at 0.4-0.6 s lifts and falls back while the other flanker, on the opposite side, takes the token. A readable bait: it is a PIT approach the player has seen before; the feint is a *timing* change, not hidden information. At most once per 10 s per target, never above `PIT_MAX`.
- **Reuse:** the PIT state machine (5.5) with an `abort` transition on a timer; the token handoff of 9.1.
- **Test:** the feinting unit aborts without contact; the second unit takes the token within 1 s; the bait-then-hit sequence yields a contact in more seeds than a straight PIT against a player scripted to dodge toward the bait.

### 9.5 E-brake swipes: handbrake spin that hits with the rear

- **Driver 2:** no handbrake. The nearest is the `wheelspin` power-slide in the turn zones (rear breaks away, front friction +600, rear down by the same: `wheelforces.c:107-108,130-135`), used to rotate toward the player, not to strike. [code]
- **Real police and derby:** officer self-preservation puts the damage-tolerant end toward the contact, and derby drivers hit with the rear to protect the engine (`perplexity/40-derby-driver-techniques.md`).
- **Ours (derby):** `DerbyBrain` has it in three places: `T_SWING` (`derby-ai.ts:550-557`: nose of a rival beside our rear wheel, ours slower than 13 m/s, `ebrake` plus steer away at 0.85 for 0.45 s, throttle 0, whipping the tail into its radiator, `applyMove` 576-583); `T_JTURN`/`T_REVERSE` (`attackReverse`, 658-710: a handbrake J-turn to bring the tail round for a tail-first hit on a front wheel); `chooseMode` (511-513): **tail-first is the default** and nose-first is chosen only when the car's front is under 30 % spent and it is in a brawling mood, or its tail is spent (rear over 0.7). Tested in `derby-ai.test.ts:12-21` (`brain.tacticOf(0)` is `swing`, `input.ebrake && throttle === 0 && steer < -0.5`).
- **Hunters:** `out.ebrake = false` always (`hunter.ts:279`); they hit nose-first, head-on from 3 s out (`RAM_TIME`).
- **Build:** extract the geometry test of `T_SWING` into a pure function `tailSwing(self, other, out)` (in `ai/`), call it from `attackTarget` when a hunter is **ahead of or level with the target and the target is overtaking it** (the "nose beside our rear wheel" condition) with the `13 m/s` gate lifted to a parameter (`tv + 6`), cap the swing to targets under the owner's PIT speed, and add a cool-down; add a second use, a **retreat swing** when `front` damage is high (`AiCar.front`, `derby-ai.ts:27-28`). It makes a cop that is being passed hit with the rear rather than the nose and is the "e-brake swipe" as a counter-attack, not a stand-alone tactic.
- **Reuse:** `DerbyBrain.opening()` geometry, `DriveInput.ebrake`, the derby test harness (`car()`, `decide()`).
- **Test:** copy `derby-ai.test.ts:12-21`'s geometry for a hunter and assert `out.ebrake && throttle === 0`; a full-physics pair test (the `police-rig.test-util.ts` harness): a cop at the target's flank swings and the *target's* peak yaw rate is within [0.3, 2] rad/s and the cop's rate is under `GRIP_YAW_CAP`; a cop that has used the swing does not use it again for 3 s.

## 10. Order of work and how to test each

1. **Faithful PIT (5.5)**: biggest quality gain, mostly `cop-brain.ts`. Tests: unit (`hunter.test.ts:291` rewritten), then a headless **two-car** measurement with the real vehicle stack: sweep target speeds 10-30 m/s and starting geometries; record contact point (target frame), relative speed at contact, peak target yaw rate, whether it reaches 90 degrees, peak cop yaw rate, cop lateral deviation. Pass: contact along in [-2.3, -1.0] on at least 80 % of runs, relative speed at contact under 2.5 m/s, target yaw over 0.5 rad/s within 0.8 s, the cop never rotates more than 40 degrees.
2. **Escalation meter (8):** scripted break-out as above.
3. **Closest-approach lead (row 7):** replace two expressions; test with a crossing target: hunters reach within 5 m in fewer seconds than today (`hunter.test.ts` "closes" pattern).
4. **Contact-aware stuck window (row 10)**: tiny; test: a unit pressed against the player under throttle backs off within 0.5 s; an open-ground wedge still waits 1.2 s.
5. **Heat-scaled pace (row 15)** and **K-turn (row 11)**: small, measurable (pace x1.0 at 0 s, x1.2 at the cap; K-turn fires only inside 20 m and at 0.5-1.3 rad).
6. **Role slots (9.1)**, **ambusher (9.2)**, **tail swing (9.5)**, then the optional **dark unit (9.3)** and **feint (9.4)**.

Full sanity after any of these: `npm run test:ai-long-run` (the 120 s flat-out player stays on the map; the pack ends an evader within 30 s).

## 11. Open questions

- Survival mission data (cops min/max/speed/power, the felony start) is not in REDRIVER2; the "about 4 cops" and "felony above 658" claims are inferences from code branches and the Kikizo figure.
- Whether Survival's mission scripts allow roadblocks is unknown.
- Absolute top speeds and the `mass`/`powerRatio` of the Survival cop car are data; "twice as fast" stays a [player] figure with a code-consistent [est] on force.
- The 6 mm/unit scale is ±10 %.
- The PIT numbers in 5.5 and the escalation numbers in 8 are starting points, not research findings; the yaw and grip arithmetic in 5.2 is my estimate.
- Driv3r's doublespeed has no code source.

## 12. Sources

Code and primary
- REDRIVER2 `b2d8857` (local `/home/aphix/github/REDRIVER2`; `git show eba0bbff:dump.h` for the original symbols): `C/cop_ai.c`, `C/civ_ai.c`, `C/mission.c`, `C/glaunch.c`, `C/main.c`, `C/handling.c`, `C/wheelforces.c`, `C/bcollide.c`, `C/felony.c`, `C/felony.h`, `C/pathfind.c`, `C/cars.c`, `dr2types.h`, `dr2limits.h`.
- Redriver_ReExtended developer notes (car half-length 375 units): https://github.com/E75/Redriver_ReExtended/blob/main/docs/DEVELOPER_NOTES.md
- Kikizo, "Driv3r: Interview with Reflections" (Martin Edmondson), 8 Jan 2004: https://games.kikizo.com/news/200401/002.asp
- Driver Wiki, Driv3r (game modes, "doublespeed"): https://driver.fandom.com/wiki/Driv3r ; Survival (game mode): https://driver.fandom.com/wiki/Survival_(game_mode) (blocked, 403, read only through the saved answer)
- Driv3r manual ("manic cops ram"): https://oldgamesdownload.com/wp-content/uploads/Driv3r_Manual_Win_EN.pdf ; Driv3r decompilation: https://github.com/ibtr54/Driv3r-Decompilation
- NFS MW encyclopedia C48.4, C49.3, C14.1: https://github.com/TsyVM/MWEncyclopedia
- Policy documents (via the saved answers): St. Paul 443.13 https://www.stpaul.gov/sites/default/files/2024-10/443.13%20Vehicle%20Containment%20Techniques%20and%20Tire-Deflation%20Devices%20Redacted%20-%20publish%20to%20public%209.20.24.pdf ; Fargo 307 https://download.fargond.gov/0/307-vehicle_pursuits_06.08.2023.pdf ; Albuquerque 2-12 https://documents.cabq.gov/police/standard-operating-procedures/2-12-pursuit-intervention-technique-pit.pdf ; DOJ COPS https://cops.usdoj.gov/pdf/Use-of-Force.pdf ; Illinois State Police OPS-003 https://isp.illinois.gov/StaticFiles/docs/DepartmentDirectives/OPS-003%20DIR.pdf ; FLETC ARB newsletter 2017-1 https://www.fletc.gov/sites/default/files/ARB%20Newsletter-2017-1%20PrintVersion10-030317%20(002).pdf ; NM State Police https://www.dps.nm.gov/wp-content/uploads/2022/07/ABMOPR.05_SpikeBelt_StopSticks.pdf

Saved Perplexity answers in `.extraResearch/perplexity/` (treated as leads; their own source lists apply): `2026-11-01-police-box-in-escalation.md`, `2026-11-01-pit-maneuver-technique.md`, `2026-11-01-driver-survival-cop-ai.md`, `2026-10-03-driver2-survival.md`, `2026-11-01-nfs-most-wanted-pursuit-ai.md`, `2026-11-01-gta-wanted-police-ai.md`, `2026-11-01-burnout-takedowns-pursuit.md`, `2026-11-01-novel-pursuit-tactics.md`, `40-derby-driver-techniques.md`.

Our code: `src/game/ai/hunter.ts`, `cop-brain.ts`, `pack-guard.ts`, `police.ts`, `cop-sight.ts`, `derby-ai.ts`, `derby-ai.test.ts`, `hunter.test.ts`, `hunter-rig.test-util.ts`, `docs/SURVIVAL.md`, `docs/RACE_DESIGN.md`.
