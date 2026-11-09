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
- **Feedback.** Two host events change the society: a `knock` (a civilian run down: hospital for half a game day, hurt, the corner
  feared) and a `wreck` (a building hit hard: its place closes for two game days, its staff are laid off). An event at time `t`
  changes the knocked civilian at once and the rest of the society at the first hour tick at least `EVENT_LEAD_TICKS` later, so a
  peer that hears it up to that late applies it on the same tick as the host.

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
   a torn part flying): a hit hides them at once, logs a `knock` event and queues a strike for the ragdoll throw. Animals are not
   run down.

A civilian's **look word** (`LOOK` in `civilian-crowd-constants.ts`) is a hash of who they are (bits 0-28), their gender (bit 29,
so a drawn Rosa is a woman) and their species (bits 30-31: person, cat, dog). The drawing dresses from it; it does not yet draw cats
and dogs differently, so animals are drawn as people for now.

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
crowd seconds) triples (`EVENT_LOG_CAPACITY`, equal to the wire's cap).

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
| The crowd, its constants | `ai/civilians/civilian-crowd.ts`, `civilian-crowd-constants.ts` |
| The look-at | `ai/civilians/civilian-look.ts` |
| The engine's end: crowd, link, look-at, wall hook | `engine/engine-openworld.ts` (`OpenWorldDirector`, held by `CrashEngine`) |
| Drawing | `present/civilian-art.ts`, `civilian-dress.ts`, `civilian-pose.ts`, `civilian-figure.ts` |
| Map and course | `world/openworld/` |

The director is made with the engine; the crowd is made on the first frame the open world's course is up and a map is known
(`CrashEngine.startOpenWorld(map)`), rebuilt when the key changes (a new seed, a host's other tier) and dropped, with its drawing, its
wall hook and its worker, as the course is left.
