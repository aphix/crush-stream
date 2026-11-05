# Survival (Driver 2 Havana)

Driver 2's Survival mode on a course of its own, Havana's Plaza de la Revolución or the National Mall: one car, a pack of cops that grows, and a
stopwatch that is the score. Survive as long as possible while more and more cops try to wreck you.

## The mode

- **Entry:** the scene bar's **Survival** button (desktop dock and phone picker) or the **-** (minus) key (no driving key picks a scene)
  open **Survival's own setup menu** first ("Pick a course", `RaceMenu` `"survival"`, `components/survival-hud.tsx`
  `SurvivalMenu`): the Survival courses as cards (`RaceField.survivalCourses`, every course with `survival` anchors: Havana, Washington DC; the same
  `CourseCard` as Race's menu), the rows that apply to a run (the car and driver, the time of day, the sound; nothing race-only: no laps, AI cars, wrecks
  or police), **Start survival** and **Back** to the fleet. The field is parked on the picked course's start behind it and nothing runs until Start
  (`RaceDirector.enter(true, false, true)`; commands `survivalCourse`, then `start`). Race's own setup menu has no Survival row or button: Survival is its own
  mode, not a race option. The pick starts as Havana until the player picks the Mall and is kept for the next entry. A link starts the run at once instead:
  `#scene=survival&track=<id>` boots straight into a run on that course (`scene=survival` alone, on the picked one, Havana at boot), and the `#` follows the
  run's course (`engine-share.ts`, [`CONTROLS.md`](CONTROLS.md)); editing `track=` in the open page restarts the run on it.
- **Single player or a team.** A room's host may run it, public or private (the hosting panel's game pick: [`MULTIPLAYER.md`](MULTIPLAYER.md) "Hosting and joining"): every peer seated at the
  run's start plays it as one team (see **Co-op** below). A room runs the game it was hosted as, so the scene bar's Survival button does nothing in a public
  room (`EngineScenes.setScene`), a guest cannot pick it (it follows its host's scene), and a guest's own run ends when it joins a room
  (`EngineScenes.stepSceneFade`).
- **A run:** the player starts at `survival.start` of the course file, four to six cops in `survival.formation` behind it.
  The race's grid and red-yellow-green countdown run first (`RaceSession`); the cops are held on the brake until the green.
  The stopwatch counts up from the green. The best time per course is kept in `localStorage` (`crush.survival.best.<course>`,
  `engine/survival-store.ts`); blocked storage keeps nothing and the run still ends with its result.
- **Busted:** the race's rule (`RaceSession.busting`: within 20 m of a chasing cop, under 20 km/h, unbroken) held for
  `SURVIVAL.bustTime` = 12 s (`match/survival.ts`). The pursuit strip (`components/race-status.tsx`, bottom centre,
  "Chased by N cops") shows the hold running out.
- **Wrecked:** the race's `judge` (driver thrown out, engine dead, upside down for 2.5 s). Survival is a no-reset run: either
  ends it.
- **Results:** the BUSTED / WRECKED banner (`race-busted.tsx`) and the race's crash reel come first, then the results card
  (`components/survival-hud.tsx`: time, best with a *New best* mark, cops wrecked, the cause) with Retry, **Change course** and Leave. Retry
  restarts through the race's `start` on the same course; Change course (`RaceCommand` `survivalMenu`, not offered in a room: its course is the lobby gate's) drops the run for Survival's menu to pick another; Leave and the pause menu's Quit go to the fleet.
- The run is a `RaceDirector` in survival mode (`enter(true)`, or `enter(true, false, true)` for the menu before it): `session.noReset`, `session.endless` (no gates, laps or
  finish), no traffic, the hunters instead of the police brain. The crash cinematic, slow-mo and the loop's auto-reset are
  off, as in a race.

## Havana's map

`world/tracks/havana.json` (id `havana`), exported as `HAVANA` from `world/tracks/havana.ts`. It is in `OFF_MENU`
(`world/tracks/index.ts`), not in `TRACKS`: the race menu, the campaign and the per-course sweeps do not list it, and
`RaceField.load` resolves it by id. Plan, +z up (`docs/shots/havana-top.webp`; the owner's reference is the Driver 2
Havana minimap):

- **The island.** A D: flat side north, round side south. The ring road round it is the track's closed main loop: 12 m of
  asphalt, 3 m of concrete sidewalk each side, kerbs, 32 nodes, 4 checkpoints, the start gantry on the east leg. The lawn
  inside it is `environment.paint` (grass over bare concrete terrain); the rest of the ground is concrete.
- **The grid.** Traffic routes with `count: 0` (they put roads in `Track.paths()` and nothing on them): `boulevard`,
  `north-st`, the cross streets, `avenue-east/west` (x ±110), `paseo` (south), `alley`. Pastel stucco blocks in seven tints
  along them; palms along the boulevard, the paseo and the island's east and west edges.
- **The approach.** The boulevard: 20 m wide, 424 m long from (0, 476) to the ring, straight at the hill, palms beyond each
  edge, blocks 11 m beyond that. The monument is in view from the start (`docs/shots/havana-start.webp`). From rest at full
  throttle a sedan reaches about 91 % of its top speed at the foot (`havana-fit.test.ts`).
- **The face and the plaza.** The plateau's near side rises 4 m over a nominal 16 m (14°), 24 m wide, grass
  (`havana-face-side.webp`). The plaza on top is 24 × 36 m of concrete with the monument at (4.5, 0): a star-plan stone
  tower 55 m tall, its collider the star itself (`starPlan`: per step and per arm a box over the core and a few boxes along the tip, turned to the arm, within 0.35 m of the drawn stone) and three circles for its spire; 12 m of plaza is clear on its left.
- **The crest and beyond.** The top meets the face in a parabola 6 m either side of the nominal edge, so a car leaves the
  ground over it at about 25 m/s and up (`havana-mid-air.webp`). The far side falls 4 m over 18 m to the ring's south leg;
  past it the landing area is the paseo between two lawns, 150 m long, with no solid prop within 60 m of the line.
- **The escape alley.** A cobbled street 5.5 m wide at x −36.5 along the plaza's left side, a stucco wall along its west
  side, a stub wall across it at z −12 and a dumpster behind the stub (`havana-alley.webp`).
- **The rim.** The city is closed: one row of 184 stucco blocks (12 m, 14 m tall, overlapping) stands round the whole grid,
  inner faces at x ±176, z −221 and 482, 6 m past the end of every street. There is no out-of-bounds rule: a flood fill over
  the solids from the start reaches no edge cell, and 20 launches at 60 m/s (each side's seams, a block centre, the four
  corners) all stop inside the faces (`world/survival-chase.test.ts`).
- **Light.** `environment.light`: a warm sun, a cool sky hemisphere and a warm fill; sky and fog `#a8cfe3`, fog 0.0012.

**Anchors.** `Track.survival: SurvivalSpec | null` (`world/track-schema.ts`): `start {x, z, yaw}` and `formation`, 4–6 cop
slots behind it. Havana: start (0, 426) yaw π (facing −z, at the hill); five slots at z 437–459, ±2.6 m, staggered 4–7 m.

**Terrain** (`world/terrain.ts`): Gaussian hills cannot make a crest, so the heightfield takes `environment.plateaus`
after the roads are stamped: a flat top at `height`, each side a plane down over its `run`, corners as cones, crest and foot
rounded over `round` m (a parabola). A bare crest would hang two of a car's four tyres at once; `round` must be 3 or more
(the drop matrix fails at 0). `checkPlateaus` rejects a plateau whose footprint touches a road. Havana's: half-size 12 × 18,
height 4, run [10, 10, 18, 16], round 6.

## The National Mall

`world/tracks/national-mall.json` (the race course, `TRACKS`) carries `survival` anchors, so it is a Survival course too. The race's own course and props are the run's city:

- **Start.** The player stands on the race's pole slot (-3.6, -284) on 3rd Street and faces the Washington Monument (yaw -1.5995: toward the obelisk at (-910, -310), 2.4 km down the open lawn of the Mall); the five cops queue behind it,
  14 to 36 m east of the start on the grass across 3rd Street, staggered ±2.6 m, facing the same way (`survival-mall.test.ts`).
- **Roads.** The race loop and the side streets (`traffic.routes`, no cars in Survival) are the drop-in roads (`HunterBrain` reads `Track.paths()`), so cops come in on a street out of sight among the museums and trees.
- **The rim.** The city is open ground, so Survival closes it: 154 `building` blocks (12 m thick, 20 m tall, 60 m long, overlapping) stand round it with inner faces at x -2140 and 790, z -1290 and 190, 70 to 100 m outside the last street and prop. A flood fill of a car-sized
  disc over the solids from the start reaches 800 000 2 m cells and no edge cell (994 000 and 4 750 edge cells without the rim), and 12 launches at 60 m/s (each side's block middle and seam, the four corners) all stop inside the faces. The race meets the rim too (it is in the course file).
- **The guards stay on duty.** The White House's lawn guards (`scenes/lawn-guard.ts`) fire in a Survival run as in the race: a car on the lawn is shot dead in seconds, which `judge` counts a wreck, so the lawn is a place that ends a run (and a cop that chases onto it is wrecked and dropped in again). Nothing in the pack's rules needs
  them off, and the course's Konami secret works in a run (the guards stand down, the VIP rides along); a Retry puts it all back (`RaceDirector.stowSecret`).
- **Best time.** Per course (`crush.survival.best.national-mall`).

## The cops (`ai/hunter.ts`)

`HunterBrain` (extends `CopBrain`, shared with the race police) drives cars `first … first + HUNT.units − 1` over open
ground: up the embankment and across the plaza, not along a road. It shares the police code: `attackTarget` (PIT, slam,
block, head-on within `ATTACK` = 35 m), `pursuitSteer`, `Backoff` (back off when wedged) and `CATCH_UP` (boost when more
than 20 m behind).

- **Pack guard.** Every hunter's drive ends with `guardMates` (`ai/pack-guard.ts`, as `PoliceBrain.think` does): it steers
  away from, and brakes for, the pack-mate it would reach soonest within 3 s ([`RACE_DESIGN.md`](RACE_DESIGN.md), "Pack guard"). It reads a slow mate as pulling out (moving at 8 m/s along its nose) only while that unit hunts (`HunterBrain.pulling`): a knocked-out unit is the stopped obstacle it is, so a cop brakes and swerves for a wreck (read as pulling out, a wreck 12 m ahead of a cop at 20 m/s was reached at 1 s, not 0.6 s, so the cop only lifted the throttle and never braked).
- **Queueing.** A target faster than `PIT_MAX` = 20 m/s is queued behind (a lane `TAIL_LANE` = 2.6 m either side, a row every
  `ROW` = 8 m), and a unit closing faster than it can brake goes straight on.
- **Ram when the box squirms.** A player sitting still or creeping under the bust's 20 km/h in the ring is busted, not rammed (a
  unit within `SETTLE` = 12 m of a player car under `BLOCKABLE` eases to a creep). Each human has a squirm clock
  (`HunterBrain.pinned`): the human is boxed in when units (wrecks too) and solids stand within `SETTLE` m on at least 5 of the 8
  compass headings round it, units on at least 2 of them; the clock grows while a boxed-in human is at 20 km/h or over, up to
  `ESCAPED` = 14 m/s (its hold keeps breaking), holds while it sits still, and starts over when it leaves the box or drives off.
  At `RAM_AFTER` = 6 s every unit after that human rams it: it backs off along the line out from the human until it is
  `RUN_UP` = 60 m off, then charges flat out and boosting (28 m/s and over is what kills), and backs off again once within
  `RAM_HIT` = 10 m. Once the wait is up, leaving the box no longer clears the clock (the units backing off for their run-up are
  the ones that boxed the human in); only a drive-off over `ESCAPED`, the human's hunt ending, or `CALM_END` = 3 s of sitting
  still clears it: the human has stopped squirming, the pack is back to PIT, slam and queue, and the bust gets its chance.
  On the aggression ramp (below) only the units that seek a hit ram, from a run-up of 15 m at the floor of a (`RUN_UP` at full), turning back once they touch (5.5 m; `RAM_HIT` at full), closing no faster than the ramp's cap.
- **Beyond `ATTACK`** it aims at where the player will be, bent round solid props on a 16 m grid.
- **Grip.** A hunter reads the surface under it and its class's tyre there as a racer does (`race-ai.ts`: `turnRate` for its
  steering, `arcSpeed` for the arc to its aim, the racer's brake latch `brakeOver` over that speed), so it corners on grass
  within its grip. It does not lift for the plateau's crest: the pack flying it is the set piece.
- **Escalation:** `copsWanted(time, formation, humans)` = the formation plus, every `HUNT.every` = 12 s, one more weighted by the aggression a(t) (**The aggression ramp** below), up to `HUNT.cap` = 12
  hunting at once, for one human (more humans scale it: see **Co-op**). `HUNT.units` = 16 cars are built; the rest are wrecks
  waiting to be put away. One drop-in per `HUNT.gap` = 1.5 s.
- **Drop-in:** a cop wrecked (`judge`), crashed (it drives no more once crashed, so it is down for the pack too) or lost (more than `HUNT.far` = 140 m from the player and hidden for `HUNT.farTime` =
  5 s) is put away, and a new one is dropped onto a road 70–120 m from the player, ahead of its travel first, 12 m clear of
  every car, where the camera cannot see it (outside the view frustum by 8 m, or behind a solid). The spot must stay
  `HUNT.dropMin` = 70 m from the player's straight-on path over the next `HUNT.lag` = 0.07 s. A wreck is put away only after
  `HUNT.wreckStore` = 6 s and only while hidden; when no unit is in storage, the next drop-in reuses the longest-lying wreck
  (past `wreckStore`) the camera still sees, so a pile of wrecks in view cannot leave the pack empty (measured: with every cop
  in view wrecked and the humans parked, the pack went 78 s without a drop-in for one human before, 1.5 s now).
- Cops are as tough as the race's police (`police` class, durability 1.3).

## The aggression ramp (`ai/hunter.ts`: `RAMP`, `aggression`)

Owner's design: the pack starts mean enough to feel dangerous and get the player damaged, by reasons the player caused, and *probably* lets it survive 30 s at about
a quarter as mean or ram-seeking; then it eases in, cubically, to today's full aggression. One number a(t) per run, read from the green on the hunters' clock
(`HunterBrain.update`), that every choice making the pack mean reads; no physics is scaled, only what the AI chooses.

- **Schedule.** a = `RAMP.floor` = 0.25 until `RAMP.hold` = 30 s; then a = 0.25 + 0.75 × u³, u = (t − 30) / `RAMP.full`, reaching 1 at 30 + `RAMP.full` = 90 s and
  staying there: 0.26 at 45 s, 0.34 at 60 s, 0.51 at 72 s, 0.79 at 84 s, 1 at 90 s. a = 1 is the pack as it was before the ramp (the opening rows' mutation
  is `RAMP.hold` pushed far into the past: the old pack, measured below).
- **Why `RAMP.full` = 60 s.** The old schedule reaches its cap of 12 cops at 84 s (5 in the formation and one more every 12 s), so full aggression at 90 s arrives with
  the full pack. A cubic is flat at the start: a stays under 0.35 for the first minute, so the pack grows and bites for a minute before its lethal choices open (a ≥ 0.5, at
  72 s). Shorter would make the pack lethal inside the minute the owner wants it forgiving; longer would put the full pack past the 2 minutes a real player rarely outlasts.
- **What a scales** (`ramped(a, floor, full)` is linear in a between its values at 0.25 and at 1):

| Choice | a = 0.25 | a = 1 | How a scales it |
|---|---|---|---|
| cops wanted (`copsWanted`) | the formation, none added before 48 s | one more every `HUNT.every` = 12 s up to `HUNT.cap` | the added cops are floor(a × floor(t / 12)) |
| units that seek a hit (`pickSeekers`) | 2 of 5, the nearest to the human (pick held 3 s) | every unit | the nearest ceil(a × n) of the n hunting a human; a stopped or creeping human is contained by every unit whatever a is, so the bust is as before |
| units that do not seek (`shadow`) | hold a slot 12 m behind a moving human, 7 m more for each unit queued nearer, close on it at 8 m/s over its pace at most | none | the rest of the units |
| the formation's opening flight (`HUNT.opening` = 13 s) | the units of the formation that do not seek a hit, split off once at the green, drive the launch up the boulevard and over the crest at full aggression: tight behind the player, airborne together at the crest (the set piece) | none | whatever a is, until 13 s after the green (the crest is at about 11.5 s), then every unit follows a(t) |
| attack reach (`ATTACK` = 35 m, and the head-on's `RAM_TIME` and `PULL_OUT` reach) | × 0.5 | × 1 | linear |
| lethal choices: head-on ram, brake-check block ahead, the slam roles of the pack | off: every unit lines up for the rear-quarter PIT; `attackTarget`'s alongside turn-in stays, held to the closing cap | on | from a ≥ 0.5 (`LETHAL_FROM`) |
| closing speed into a hit (`CLOSE_FLOOR`…`CLOSE_FULL`) | 9 m/s | 60 m/s (no limit) | linear; a unit driving at its target lifts and brakes from `HIT_ZONE` = 6 m plus its braking distance so it meets it no faster, a ram's charge included; a unit moving away from it (a human closing from behind) never brakes for it |
| the squirm ram (`RUN_UP`, `RAM_HIT`) | run-up 15 m, turns back once it has touched (5.5 m) | 60 m, 10 m | linear: at the floor it is a shove, at full the 28 m/s hit that kills |
| the bump (`BUMP_ABOVE` = 20 m/s) | a seeker behind a target faster than the police's PIT cap drives on into its tail boosting, held to the closing cap | queues behind it as the police do | on under a = 0.5 |

  Not scaled: the cars and their grip, the bust rule (12 s within 20 m under 20 km/h), the settle ring round a stopped player, the drop-in's hiding, spacing and pace, the pack guard.
- **Driver 2's version** (REDRIVER2 `Game/C/cop_ai.c`, `felony.c`): the pack's power and desired speed are the base 4596/4096 (about 1.12 ×) plus the felony meter × `autoMaxPowerScaleLimit` / 4096,
  up to another 25 % (`cop_ai.c` 286–294 sets the Survival scales and limits, 713 applies them); the meter rises by 1 every 32 frames while a cop sees the player, as long as it is over the pursuit minimum
  (`felony.c` 257–266, `FelonyIncreaseTime` = 31 at 426), so the pack's pace climbs smoothly with the time the player survives in sight, no switch; the wanted count steps with the meter (`InitCopData`, triggers 0x333 apart,
  `cop_ai.c` 237–255); a lost cop is replaced at once (`gCopRespawnTime` = 0, 282–284). The ramp is that shape with a softer start and a count that follows it.
- **Measured** (worker, on the ramp with the formation's opening flight; `evade` unless said). Real course from the green, five scripted players (the player that keeps running, the ring tour, flat out, straight, held): first cop contact and dent (crumple compression of 0.2 m or more within 2 s of a powered contact) at 3.0–3.1 s in all five,
  the run still going at 10 s, crush 0.29–0.39 m and engine health 0.92; the pack at full aggression from the green (a = 1) first touches the player that keeps running at 13.3–14.7 s and dents it at 20–45 s or never (seeds 1–12), the ring tour at 15.6 s, and flat out, straight and held not at all before they wreck on the monument at 15.5 s.
  Still going at 30 s: ramp 5 of 5 (seeds 13, 5, 20, 9, 17) and 12 of 12 (seeds 1–12); a = 1 from the green 10 of 12 (seeds 3 and 4 wrecked at 18.5 and 19.9 s). Closed arena, ends in seconds after the release (seeds 13, 5, 20, 9, 17): ramp 42.1 busted, 75.8, 94.1 and 88.3 wrecked and 49.1 busted; a = 1 from the release 10.2, 10.1, 15.0 and 13.0 s (all wrecked) and seed 5 not within 40 s. Over arena seeds 1–24 at a = 1 from the release the pack ends 22 runs within 40 s (mean 19.2 s) and wrecks 236 cops (79 against each other), against 21 (22.6 s) and 269 (98) when a knocked-out cop is read as pulling out: one contact between two cops sends a whole run elsewhere, so a single seed's catch time moves with any change to the pack, which is why the full-aggression row is one scripted runner, not five evading seeds.

## Co-op

A private room's host may run Survival ([`MULTIPLAYER.md`](MULTIPLAYER.md), Co-op). Everything is the host's: it seats the humans, simulates the
cops, decides the busts. Rules, all in the existing per-car machinery:

- **Spawn:** every human the room has seated at the run's start, abreast on the start anchor (`humanSlot`: 4 m apart, four to a
  row, a row 8 m ahead of the last; the cops' formation stays behind the anchor).
- **Targets:** each cop hunts the nearest human still free (`HunterBrain`: `aim` per unit, recomputed every step). A drop-in aims
  at the free human with the fewest cops after it, and lands at least `HUNT.dropMin` from every free human, not only its target.
- **Busted or wrecked:** by today's per-car rules (`RaceSession.busting`, `judge`). A fallen human spectates (the camera follows the
  field after the banner); the rest play on.
- **The team loses when no human is free.** The run time is the team's: the race clock at the last fall. A lone player's run is as it was.
- **The result card is the host's:** its cause (busted, wrecked, ended) is why the run ended for the host's own car, sent in the snapshot's `pack.cause` (NET 24); a guest's card reads it instead of its own car's fall, so every peer's card agrees (`net/race-net.test.ts`).
- **Pack size:** `HUNT.perHuman` = 1 more of everything (the cops wanted, the cap, the units) per human beyond the first, so each
  human meets the pack a lone player meets, within the car list (`MAX_CARS` = 32: units are at most the cars left after the humans,
  and the cap keeps the 4 wrecks' share; 4 humans hunt at most 24 cops, 6 each). More cops, not stronger ones.
- **Joining and leaving:** a peer who joins mid-run spectates; Retry seats the peers the room has then. A car whose peer is gone
  (the room's seats have a hole) is nobody's: it is parked off the course and never hunted or counted.
- **Host leaves:** no migration; the guests' run ends with the host.
- **The course:** the host picks it in the lobby panel while Survival is the game Go starts (`NetPlay.setLobbyCourse`, the same `survivalCourse` pick); the lobby is on that course for every peer (the lobby message's `trackId`), and a guest that joins later, or mid-run, loads the run's course from the snapshot's `trackId` (`net/lobby.test.ts`).

Measured (probe `scratch-CoopModes/probe.ts`: the scripted fleers straight, flee, ring and held on seeds 1–6, two humans each driving a
script from the start slots, 200 s cap; fall = race second a human was busted or wrecked, 200 for one still free). One human: mean fall
18.8 s, median 17.2 s. Two humans: `perHuman` 0 → mean 41.1 s, median 20.4 s; 0.5 → 43.8 s, 19.7 s; **1 → 33.7 s, 16.0 s**; 1.5 and 2 →
27.3 s, 16.1 s each (the same runs: the pack is limited by one drop-in per `HUNT.gap` = 1.5 s, not by what it wants, so more than 1 adds
nothing). Four humans at 1: mean 42.0 s, median 18.1 s. The median is the pressure on a typical human: 1 is the least that holds
it at the lone player's. The means carry the runs where one human escapes while the pack is busy with the other.

Not built: rescue (ramming the cop that is busting a teammate cancels the bust) is a second pass.

## Tests

| Rule | Test |
|---|---|
| bust at 12 s held, not a step before; 20 m, 20 km/h; the hold restarts; no laps | `match/survival.test.ts` |
| the schedule at full aggression, drop-ins only where hidden, wreck / lost put away only unseen and replaced, drop spot on a road in the band, steering round a wall, attack geometry, wedge back-off; a real police car turning on grass within 2 m of the arc to its quarry; a cop at 20 m/s brakes for a knocked-out mate lying on its line 12 m ahead (a driving one may be pulling out and is braked for less) | `ai/hunter.test.ts` |
| the aggression ramp: `aggression(t)` is 0.25 to 30 s and eases in cubically to 1 at 90 s; the cops wanted on it (none added in the first 48 s, then a of the old steps, the cap at 90 s); ceil(a × units) seek a hit; a seeker lifts and brakes for a hit over the closing cap and goes straight on at full aggression, and a unit moving away from a faster human never brakes for it; under a = 0.5 a seeker drives on into the tail of a player over 20 m/s boosting; a unit that does not seek holds off a moving player; the formation's units that do not seek fly the opening at full aggression until 13 s and follow a(t) after; at the floor a squirm ram's run-up is short and it arrives under the kill bar | `ai/hunter.test.ts` |
| a player boxed in by walls and wrecks (the pack at full aggression): squirming over 20 km/h for `RAM_AFTER`, a real police car backs off to the run-up and charges in at 28 m/s or more, and before it the car comes in under 28 m/s; a player sitting still is never rammed, a drive-off over 14 m/s starts the wait over, and a squirm on open ground is not rammed; the clock: once the wait is up, a unit leaving the box leaves it running, mid-wait the wait starts over, `CALM_END` s of sitting still after the wait ends the ram; a cop's next ram starts with a back-off even if its last one ended mid-charge | `ai/hunter.test.ts` |
| start, countdown, bust through the real stack (the hold shortened to 3 s), wrecked ends the run, best-time store (new / worse / blocked), Retry, Quit, schedule on the HUD at full aggression (first two steps) | `world/survival.test.ts` |
| a cop dropped in with the chase camera at 12 places round the course, the player driving on at 16 m/s: never in the camera's view, never within `dropMin` | `world/survival.test.ts` |
| `scene=survival` round trip, never with a room; `scene=survival&track=national-mall` decodes and encodes back | `hud/share-url.test.ts` |
| the real engine booted on `#scene=survival&track=national-mall` is in a Survival run on the Mall with no menu; the scene bar's Survival opens Survival's menu with no run, no clock, a pick moving the course behind it and Start running the picked course; Change course from a run (and its results card) is the menu again; the address follows the pick and the run; an edited `track=` restarts the run on it | `engine/engine-survival-pick.test.ts` |
| the map is closed: no gap in the solids, no seam of the rim lets a car at 60 m/s through | `world/survival-chase.test.ts` |
| a fleeing player's run ends. In the closed arena, with the formation held to each seed's release second (seeds 13, 5, 20, 9 and 17), a runner lapping the arena on a fixed path at 8 m/s (`orbit`, seed 3) is wrecked by the pack at full aggression within 20 s of the release (8.9 s; main's pack 10.4 s; 32.4 s with the lethal choices off; hunters with no aim never touch it in 20 s), and the pack ends an evading player on the ramp within 120 s of its release (30 s after the ramp's full aggression: 42.1, 75.8, 94.1, 88.3 and 49.1 s), wrecked with a cop touching or busted by the bust's own hold; hunters with no aim (they never steer, and each drop-in faces along its road away from the player) end none of them, in either; the evading player stops short of a wall and creeps round it, and lifts for a crest or a bump it would fly, so its run never ends on its own crash; a player cornered at 3 m/s is busted by the pack released at 9.7 s (seed 10), and by cops that never move it is not; a player flat out for 120 s stays on the map (the full-sanity suite, `npm run test:ai-long-run`) | `world/survival-pursuit.ai-long-run.ts`, `world/survival-bust.ai-long-run.ts`, `world/survival-chase.ai-long-run.ts` |
| the opening of a run on the real course (five scripted players): within 10 s of the green a cop has hit the player and dented it (3.0–3.1 s on the ramp, 14.7 s or never with the pack at full aggression from the green) and the run is still going; the player that keeps running is still going at 30 s in at least 4 of 5 situations (seeds 13, 5, 20, 9, 17; 5 of 5 measured) | `world/survival-opening.ai-long-run.ts` |
| the opening set piece on the real course, on the ramp (seed 1): the nearest two cops (the seekers) tap the player first, and the formation's other three, the flyers (`HUNT.opening`), all reach the foot behind the player (10.5, 10.7 and 11.1 s after the green: two of them within half a second of each other, the three together span 0.6 s), three cops of the pack within half a second (the two flyers and the surviving seeker, at 10.5, 10.7 and 10.7 s), four leave the ground at the crest, the player is not shoved more than 6 m off its line; a player that brakes hard near the crest's left makes three cops overshoot and fly past (three take off). A cop put away and dropped in again elsewhere is not counted: its car is out of the scene | `world/survival-setpiece.test.ts` |
| wheels on the grass and the crest: drop matrix and drive matrix over the face, plaza, crest and alley | `vehicle/havana-fit.test.ts` |
| a team's pack: the cops wanted, the cap and the units grow with the humans (1, 2, 4), never past the car list; each cop's quarry is the nearest free human; no drop-in within `dropMin` of any human | `ai/hunter-team.test.ts` |
| a hosted run with several humans: they start on their own slots, the run goes on while one is free and ends when none is, its time is the last fall, a car nobody drives is parked, Retry seats the peers the room has now; a client reads the pack, the team and the run's time as the host does | `world/survival-coop.test.ts`, `net/race-net.test.ts` |
| with every cop in view wrecked and the humans parked (1, 2 and 4 of them), a drop-in still comes every `HUNT.gap`, a wreck in view reused once no unit is stored | `ai/hunter-team.test.ts` |
| the Survival menu's course list (Havana, Washington DC) with no run behind it, the Mall's start on the pole slot facing the monument with the cops behind, drop-ins out of view at 12 places along the streets, the White House guards ending a run on the lawn, the Mall closed (flood fill, 12 launches at the rim) | `world/survival-mall.test.ts` |
| the lobby's Survival course picked by the host, followed by a guest present, joining and joining mid-run | `net/lobby.test.ts` |

Harnesses: `world/survival-run.test-util.ts` (the director in survival mode, a scripted player, the chase camera),
`world/survival-players.test-util.ts` (the scripted fleeing players and `chase(...)`), `world/survival-arena.test-util.ts`
(the closed arena for the pursuit measurement, not a shipped course).
