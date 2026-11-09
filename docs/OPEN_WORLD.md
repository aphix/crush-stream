# Open World

A 3x3-block neighbourhood ("Moore Park") with a city-scale society behind it: named residents with homes, jobs, moods and a
life log walk the sidewalks, animals trot between yards, and the player's car can run them down. The scene runs solo
(`#scene=openworld`) and as a room's game (kind `openworld`), where every peer sees the same crowd and the proximity voice works
as everywhere. Nothing here is a replay concern: civilians and their hits live in this scene's course only.

## The brain (`ai/civilians`)

One society and its crowd, both pure functions of (seed, crowd clock, host events), computed by modules the main thread and a
Web Worker both import.

- **Macro: the society.** Every resident has a name, gender, age, a home, a job at a workplace, a partner and children, a mood and a
  life log ring. A society tick per game hour applies due events; at each game-day boundary the daily chances run (jobs,
  retirement, firing, promotion, courtship, babies, moving, injury, death and replacement), each drawn from a stream keyed by
  (seed, resident, day).
- **Micro: the crowd.** Needs (rest, food, work, social, errand, solitude) rise over the day and fall while dwelling; at the end of a
  dwell a resident picks a place by urgency x time-of-day weight / distance, plans a path on the walk graph (A*, edge costs raised by
  the city's fear of a corner) and walks it. A leg is (depart tick, place, node path, speed, lateral offset).
- **Clock.** Decisions fall on a 2 Hz grid of crowd time (`DECISION_HZ`); a crowd second is a game minute, a day is 24 real minutes,
  and the start hour comes from the seed.
- **Feedback.** Host events change the society: a `knock` (a civilian run down: hospital for half a game day, hurt, the corner
  feared), a `wreck` (a building hit hard: its place closes for two game days, its staff are laid off), and the street's own `crime`,
  `bust`, `push` and `fight` (see "Interactions, crime and seats"). An event at time `t` changes the civilian it names at once, everyone
  drawn into it (witnesses, a fight's two, a crime's victims) `EVENT_LEAD_TICKS` after it, and the rest of the society at the first hour
  tick after that, so a peer that hears it up to that late applies it on the same tick as the host.

`CivilianRemote` is the main thread's end: it posts one plan per tick `PLAN_LEAD_TICKS` ahead to the worker and mirrors the city;
a tick whose answer is not back when due is computed inline by the same step.

## The crowd on the main thread (`CivilianCrowd`)

`CivilianCrowd(map, seed, playableResidents, remote)` owns a `CrowdPoses` (what the drawing reads: position, yaw, stride phase,
speed, look word, shown flag). `step(crowdSeconds, cars, authority)` runs once per sim step on the host and solo player and once
per frame on a client:

1. every decision tick passed is advanced through the brain;
2. each resident on a leg is placed by `legPositionAt` at the crowd time (a pure function of the rows and the time: any frame rate,
   no integration, no allocation); the stride phase is the metres walked, so it needs no state;
3. with `authority`, every shown person is tested against every car (`runsDown` within `CAR_REACH`, `looseRunsDown` for a car with
   a torn part flying): a hit hides them at once, logs a `knock` event and queues a strike for the ragdoll throw, dressed as the drawn crowd dresses
   them (`dressOfLook` of their look word, the same dress the near dummy wears).

Cats and dogs live in the brain (they decide, walk and keep a life log) but the crowd shows none until there is animal art: a
resident of species other than person has `shown = 0` in every pose, so none is drawn and none can be run down.

A civilian's **look word** (`LOOK` in `civilian-crowd-constants.ts`) is a hash of who they are (bits 0-28), their gender (bit 29,
so a drawn Rosa is a woman) and their species (bits 30-31: person, cat, dog). The drawing dresses from it; the species bits are there for the animal art to
read.

**Wrecks.** The cheapest existing signal is the course's solid-prop hit, `RaceField.onWallHit(car, closing, x, z)` (every
solid a car meets, with its closing speed and contact point). The open world wraps it: a hit at `WRECK_SPEED` or more whose point
lies on the footprint (grown by `WRECK_MARGIN`) of a place inside the walls is a `wreck` event for that place, at most one per
`WRECK_LOCKOUT_SECONDS` per place. The wrap is let go when the course is left.

## Determinism split

| Piece | Where it is decided |
|---|---|
| Society rows, needs, decisions, legs | deterministic: seed + crowd clock + event log; the worker computes, the main thread mirrors and computes any tick whose answer is late |
| A civilian's position at time `t` | pure function of the leg and `t` on the main thread |
| Knock, wreck | host-authoritative events: the host detects in its sim step, gives them to its brain at once and sends them |
| Game clock and seed | the host's: a client runs the host's crowd time on its own clock |
| The ragdoll of a knocked civilian | local presentation, thrown from the strike (the host's own, a client's from the car nearest the civilian when its clock reaches the knock) |
| Stride, look word | local presentation (still a pure function of the rows) |

The twin row (`civilian-crowd-twin.test.ts`) steps one crowd with the real worker, one with none and one whose answers all come after
their ticks were taken, with a knock and a wreck heard at fixed frames: poses and society rows are bit for bit equal at every frame.

## Wire

`MSG.crowd` (`net/crowd-codec.ts`) carries `{seed, hostTime, crowdTime, events}`, reliably, with every keyframe and at once when the
host's log grew. The **seed** is the crowd's key: the population tier (phone 60, desktop 150, ultra 300 residents, `POPULATION`) above
the 24-bit scene seed, so a client builds the host's city size without a new field. The event log is the newest 512 (kind, subject,
crowd seconds) triples (`EVENT_LOG_CAPACITY`, equal to the wire's cap). A push or fight names its victim, and a civilian on the other side
in an `alongside` triple of the same seconds right after it (none: a player's walker or car), so a subject stays under 16 bits.

A client has no crowd until it hears a message. It runs the host's crowd time on its own clock the way the snapshot clock does (the
least local-minus-host gap seen, a 1 ms creep up per message), `INTERP_DELAY` behind, where the cars it draws are. A client that
joins late replays the log's events at the ticks they happened in, so its society equals the host's; an event ahead of its clock waits
for it. The brain is told of a heard event by posting it with the next plan tick not yet asked of the worker.

## Look-at

`lookAtOf` (`civilian-look.ts`) names what the eye rests on: the shown civilian whose chest the eye's forward ray passes within
`LOOK_RADIUS`, up to `LOOK_REACH` ahead (their line: name, age, job at workplace, need and place, mood; then their life log), else the
building whose box the ray enters first (its kind and name, who lives or works there, the latest comings and goings), whichever is
nearer along the ray. The director recomputes it `LOOK_HZ` times a second and keeps the same object while the text is the same; the
HUD's look panel shows it.

## Interactions, crime and seats (`ai/civilians/society-*.ts`)

**The table** (`society-table.ts`, `INTERACTIONS`) answers what a resident does where, from mood x job x place x hour. A row applies when the
resident has one of its jobs (employed, jobless, broke, retired, adult, criminal, wanted), all its traits (coffee fan, drinker), a mood
it lists, stands where it says (home, or at work after a shift's dwell), in its hours, with its need high enough. It is a candidate beside
the needs, worth `strength` times the need's level, falling with distance and fear like any destination. Rows: coffee on the way to work
and after waking out of work, a drink after a shift when tired and a drink to forget when sad or angry, sitting out on the stoop (evening;
by day for the retired and jobless), a chat with a neighbour (who comes out to their own door when the visitor arrives), a row with one
when angry, loitering at a shop door when broke, lifting from a shop, mugging someone sitting out, trying parked cars, lying low while wanted.
Named residents keep their stories and are not in the table; children and animals are not either.

**Venues and hours** (`society-venues.ts`): a place is a coffee shop, bar, diner, shop, supermarket, office, home, park or stop, from its
`interior`, its facade style or its kind. Opening hours come from the map (`Place.hours`), else a default by venue (coffee 6-15, bars from
16, shops 7-22, supermarket 8-21); an hour outside them weighs `CLOSED_HOURS_WEIGHT`, so coffee is chosen in the morning, shops by day, bars
at dusk and night. Every destination, a need's or a row's, is ranked by that weight over distance.

**Seats** (`society-seats.ts`): a customer at a coffee shop, bar or diner takes a free seat from `Place.seats` (one holder per seat, held from
the moment they set out, freed when they leave or are knocked, busted or die); a resident sitting out takes one of the home's leading
`stoopSeats`. The holder is in their row (`seat`); the owner table is derived and kept equal by the mirror.

**Activity** (`society-activity.ts`): `readActivity` is a pure function of the row and the time that says what the drawing animates
(`civilian-activity.ts`'s codes), since when and until when, with whom, the surface they sit at, and, for someone the brain places (seated,
at a counter, at a door, fighting), where. A drive leg is nobody on foot; a door clip runs on the first and last second of a walk into
a building.

**Drives** (`civilian-plan.ts`): about a third of adults own a car, standing at the kerb of the last place they drove to. A leg for work, home,
an errand or a meal that starts where the car is and is longer than `DRIVE_MIN_METRES` is a drive: `legPurpose` is `PURPOSE.drive` (the reason is
in `legReason`), the leg runs at `DRIVE_SPEED`, and the car follows (`carPlace`). `fillCommuterFeed` lists drivers and parked cars for the traffic.

**Crime** (`society-crime.ts`, `society-reactions.ts`): each game day a working-age resident's chance of turning to crime adds a base, being out of
work, broke (three jobless days), angry and young (`CRIME_LEAN`); criminals give it up at `REFORM_CHANCE` a day (twice with a job), and a city starts
at the share those chances settle to. A criminal's table row takes them to a shop, a stoop sitter or a parked car; the brain commits nothing there
by itself: the host's `CrimeDesk` lists those who have been at the place `CRIME_LAG_TICKS`, and the host raises `EVENT_KIND.crime`. It makes the criminal
wanted a game day from the tick it happened, fears the corner, angers the clerk or owner, and sends witnesses at their doors to report it or run home.
`EVENT_KIND.bust` (raised by the police) takes the wanted or fighting resident off the street for `JAIL_TICKS` and home, and clears their crime and fight.
Rows (`crimeTick`, `crimeKind`, `crimePlace`, `crimeVictim`, `fightTick`, `fightPartner`, flags) carry it all to peers and the police.

**Fights**: `EVENT_KIND.push` rolls a seeded chance (`FIGHT_CHANCE`, times `FIGHT_ANGRY_FACTOR` when either is angry) that two civilians, or a civilian and a player,
come to blows; `EVENT_KIND.fight` makes it so. Fighters stop at the nearest door for `FIGHT_TICKS` (civilians against each other are wanted for it), and a
civilian run down may be taken on by a bystander standing at a door.

## Cost

Measured by a node probe on the fixture neighbourhood (45 places, 8 cars parked beyond every street), per frame on the main thread
(step + pose fill + hit tests), and per answer in the brain (what the worker computes per tick):

| Residents | Main thread, inside a tick (us/frame) | Whole run with a worker (us/frame) | Frame that takes a tick (us) | Worst frame (ms) | Brain per tick, mean / p99 / max (ms) | Worker traffic (KB/s) |
|---|---|---|---|---|---|---|
| 50 | 4.9 | 4.7 | 7.5 | 0.38 | 0.004 / 0.05 / 0.85 | 0.01 up, 0.13 down, 2 messages/s each way |
| 150 | 13.0 | 12.5 | 15.0 | 0.24 | 0.002 / 0.013 / 0.40 | 0.01 up, 0.26 down |
| 300 | 26.6 | 23.9 | 27.3 | 0.37 | 0.004 / 0.020 / 0.43 | 0.01 up, 0.50 down |

The crowd's step allocates nothing between ticks (`civilian-crowd-alloc.test.ts`; its HOT rows are in `scripts/check-boundaries.mjs`).
A tick, twice a second, allocates what the brain's answer carries.

## Drawing

`CivilianArt(nearSlots, capacity).update(poses, eyeX, eyeZ)`: the nearest `nearSlots` civilians within 40 m are posed dummies dressed
from their look; every other civilian within 120 m is an instance of a 132-triangle figure whose limbs swing in the vertex shader;
nothing past 120 m. Draw calls do not grow with the crowd.

## Where it lives

| Piece | File |
|---|---|
| The brain, its worker and remote | `ai/civilians/civilian-{state,tick,plan,events,remote,worker,wire}.ts`, `society*.ts`, `needs.ts` |
| Interaction table, venues, seats, crime, activity | `ai/civilians/society-{table,venues,seats,crime,reactions,activity,commuters}.ts` |
| The crowd, its constants | `ai/civilians/civilian-crowd.ts`, `civilian-crowd-constants.ts` |
| The look-at | `ai/civilians/civilian-look.ts` |
| The engine's end: crowd, link, look-at, wall hook | `engine/engine-openworld.ts` (`OpenWorldDirector`, held by `CrashEngine`) |
| Drawing | `present/civilian-art.ts`, `civilian-dress.ts`, `civilian-pose.ts`, `civilian-figure.ts` |
| Map and course | `world/openworld/` |

The director is made with the engine; the crowd is made on the first frame the open world's course is up and a map is known
(`CrashEngine.startOpenWorld(map)`), rebuilt when the key changes (a new seed, a host's other tier) and dropped, with its drawing, its
wall hook and its worker, as the course is left.
