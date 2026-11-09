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

`CivilianCrowd(map, seed, playableResidents, remote)` owns a `CrowdPoses` (what the drawing reads: drawn position, yaw, stride phase,
speed, look word, shown flag, and the activity the society or a bump gives each: code, clock, time left, partner, feet and surface height). `step(crowdSeconds, cars, authority)` runs once per sim step on the host and solo player and once
per frame on a client:

1. every decision tick passed is advanced through the brain (on the host, `CrimeDesk.collect` hands the crimes now due to the log as
   `crime` events);
2. each resident on a leg is placed by `legPositionAt` at the crowd time (a pure function of the rows and the time: any frame rate,
   no integration, no allocation); the stride phase is the metres walked, so it needs no state. A resident on a drive leg is in a car
   (not shown: the traffic draws it); one the society places (`readActivity`: seated, at a counter, fighting) is shown where it says;
3. the shown are kept a body apart and their bumps found (below);
4. with `authority`, every shown person is tested against every car (`runsDown` within `CAR_REACH`, `looseRunsDown` for a car with
   a torn part flying): a hit hides them at once, logs a `knock` event and queues a strike for the ragdoll throw, dressed as the drawn crowd dresses
   them (`dressOfLook` of their look word, the same dress the near dummy wears).

**Bodies.** Civilians keep a body's width apart (`BODY_GAP`, 0.6 m) without the brain knowing. `CrowdSeparation` (`civilian-separation.ts`) takes the brain's
spots, pairs the bodies by a hashed grid and relaxes the pairs `SEPARATION_PASSES` times, no body moving more than `MAX_OFFSET` (0.7 m) from the
brain's spot; a pair closing head on or overtaking is moved sideways instead (the side they were already on, so it never flips as they cross), so they pass instead of standing off. It is a
pure function of the brain's spots at that moment (no history, no allocation): every peer draws the same, and the brain's rows and the twin row never see it.
`poses.x`/`z` are the drawn spots (the art, the look-at, the ragdoll throw's spawn and the cars' hits read them: a car meets the body the player sees). Hits are found on the host only and a client hears
the knock as an event, so the host's drawn spots are the authority (the separation is a pure function of the brain's spots and the fixed bodies); a client's walker shifts only its own drawn spots, never a hit.
`crowd.overlay` (the law's: the fleeing suspect) runs after the placing and before the hits, so a hit meets the suspect where they are drawn. A bump or push is the brain walking two bodies through each other, so it is
found on the brain's spots, which the drawn spots no longer show. The drawn spots a hit meets include the players' walkers (immovable bodies the civilians are pushed round), so a future reel of open-world hits must record the walker positions as well as the crowd's clock. A player on foot is a body that does not give way (`crowd.walkers`, which the director refills each step from the `foot` port);
a civilian seated, at a counter or fighting is fixed too, and is not bumped.

**Bumps and pushes.** Two civilians whose brain spots come within `BUMP_DISTANCE` closing at `BUMP_CLOSING_SPEED` bump: both play the bump clip (`ACTIVITY.bump`,
partners of each other) for its length, at most once in `BUMP_COOLDOWN_SECONDS`; every peer finds this itself. On the host only, a hard collision (`HARD_DISTANCE`,
`HARD_CLOSING_SPEED`), a player on foot walking into a civilian (`WALKER_PUSH_DISTANCE`), a car's side passing within `CAR_NUDGE_GAP` of one at `CAR_NUDGE_SPEED` or more,
and every knock, is a `push` event: a triple whose subject is the victim and, after it with the same seconds, an `alongside` triple whose subject is the civilian who pushed, or a `walker` triple whose
subject is the bearing from the victim's brain spot to the player who shoved (`WALKER_BEARING_STEPS` a turn; the brain turns a fight his way); a car's nudge or a knock has neither: the wire's subject is 16 bits, so a pair is never packed into one. At most one per resident per `PUSH_LOCKOUT_SECONDS`; a knock logs its `knock` first and its push after. The brain rolls the fight from a push; nothing here changes its rows.

**Other host events.** `raiseEvent(kind, subject, seconds?)` puts one more host event in the log and the brain's next plan (a bust, from the cops).

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
| Drawn spot (separation), bump clip | local presentation: a pure function of the brain's spots at the crowd time |
| Push events | host: found on the brain's spots, logged and sent like knocks |

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

**Fights**: `EVENT_KIND.push` rolls a seeded chance (`FIGHT_CHANCE`, times `FIGHT_ANGRY_FACTOR` when either civilian is angry) that the pushed civilian comes to blows with
whoever pushed: another civilian, a car, or, when a `walker` triple follows, the human player on foot; `EVENT_KIND.fight` makes it so. Fighters stop at the nearest door for
`FIGHT_TICKS`. Two civilians face each other and are both wanted for it; one who turns on the player faces the walker's bearing (`fightPartner` is `FIGHT_PLAYER`), is wanted for it,
and swings at him: a swing lands half way through its clip, and when the host's walker is within `PLAYER_STRIKE_REACH` of the fighter's spot the director knocks him down the way the
walker is knocked down already (`findWalkerStrike`, the `strikeWalker` port), with no damage beyond it. A civilian run down may be taken on by a bystander standing at a door.
`EVENT_KIND.jaywalk` (raised by the police for a walker crossing against the light) holds a free resident `JAYWALK_CUSTODY_TICKS` and sends them home, annoyed.

A bust, knock or jaywalk arrest hides its resident from the event's tick for its whole window on every peer: the step that applies it never lets them back early, since a mirror
that only applies the worker's answers never runs that step.

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

`CivilianArt(nearSlots, capacity).update(poses, eyeX, eyeZ, sight, wallDt)`: the nearest `nearSlots` civilians within `NEAR_DRAW` (60 m) are posed dummies
dressed from their look (64 slots on a desktop, 20 on a phone: a slot nobody holds costs nothing, a mesh draws up to its highest slot in use); every other civilian within 120 m
is an instance of a 132-triangle figure whose limbs swing in the vertex shader; nothing past 120 m. Every shown civilian in range is asked of the sight field
(`seen(x, z, SIGHT_RADIUS)`): one unseen for `HIDE_GRACE` seconds is neither posed nor drawn, and comes back on the frame it is seen. Draw calls do not grow with the crowd.
A dummy's pose reads the activity rows (bump, buy, sit, fight...: `civilian-pose.ts`). `LOD_PRINT=1` on `civilian-art-sight.test.ts` prints the dummies, figures, draws, triangles and
milliseconds a frame at 50, 150 and 300 civilians. A look word that is all ones (`POLICE_HASH`) is a foot cop: dressed in uniform, on the dummy's police garment.

## Signs

`OpenWorldSigns(places)` (`present/openworld-signs.ts`) is the open world's signage, made by the director on the first frame the course is up and drawn in the scene (`signsOn`, `makeSigns` are its ports).

- **Shop signs** (always on, `present/openworld-shop-signs.ts`): every business inside the walls (`isBusiness`: a building that is not a home) gets a sign with its `Place.name` and a line of what it sells, by its `style` then its `sector` (a trade the table does not know gets a colour from its name and its sector as the line). All signs are cells of one atlas texture (96 px a metre, rows of up to 2048 px) drawn by one mesh: one draw call. `shopSignRect(place)` is where the sign hangs: a 1 m band from 2.9 m up on the place's street face, 0.1 m proud of it, centred on its door, no wider than 10.6 m; a shopfront's own sign-band geometry can take `ShopSigns.texture` and `uvRect(placeIndex)` instead of the panels.
- **Names** (the Track debug button, `Debug views > Track`): while it is on, every named place inside the walls prints its name over its door on its front face: a home's under the 3.6 m ground storey's top, a business's over its sign band, a place with no front (park, alley, yard, bus stop) at head height over its door point, written on both sides. Two places that share a door (a house and its roof deck) stack. The names are quads from one glyph atlas drawn in the track debug's label style (`drawOutlinedText`), inked by the kind of place, in 64 m chunks: a chunk is one draw call, hidden while past 120 m from the eye or, when a sight field is given, unseen. They are built the first time the button is on and cost nothing while it is off. Presentation only: nothing here reaches the sim or the wire.

## Seen and unseen (`SightField`)

`OpenWorldDirector.sight` (`present/openworld-sight.ts`, updated at the top of each frame) answers one question for everything that draws or streams: does a local eye see this? `seen(x, z, radius)` is true when the thing's column (the radius, 2 m tall, on flat ground) is inside some eye's view frustum and at least one of the lines from that eye to its top (through its middle and both sides across the view) clears every building box of the course (`hidingSight` of the course's solids: boxes 2.5 m or taller; the line's height against the roof counts, so a camera above sees over a block). A box an endpoint stands in never blocks that line. The boxes sit in a 16 m grid and each query walks the cells under its lines: no allocation, no per-id state.

The field also keeps a clock per id for those that want it: `claim(count)` hands out a private range, `observe(id, x, z, radius)` is `seen` plus the stamp, `unseenFor(id)` the seconds since it was last seen, and `HIDE_GRACE` (3 s) is the grace after which a consumer phases the thing out and releases what it holds. `near(x, z, radius)` is the host's keep-alive: a player's car within reach. Netplay: each peer culls only what it draws; the host never stops simulating something because `seen` is false, only when it is also not `near` a player. `sight.enabled = false` makes everything seen (the A/B arm with no culling).

**Cars** (`present/openworld-car-lod.ts`, driven by `engine/engine-openworld-cull.ts`): the distance detail runs three rungs nearer than the match ladder's while the open world is up (a desktop cuts small parts at 20 m and all but the body at 40 m), and a car no eye has seen for `HIDE_GRACE`, no player's car is within 40 m of and the camera does not follow is taken off the draw (`group.visible`, which the wheel, lamp, part and driver batches honour), and drawn again the frame it is seen. It never touches a car it did not hide, and lets go of all of them while a reel replay plays or the open world ends.

## The street fabric (`world/openworld/openworld-fabric.ts`)

The course lays the street's own paint and furniture as props that name scenery assets (`props[].asset`, the street and ground families), at exact points, from the layout and the walk graph; nothing is generated on the roads (`scenery.roadDecals: []`) and the loop's race marks are off (`road.raceMarks: false`: no chequered band, no red and white kerbs; the edge lines and centre dashes stay).

- **Crossings.** At the middle of every crossing edge of the walk graph, bars with the traffic across the whole carriageway (the crosswalk decal, as many as cover 11 m at its own pitch). No crosswalk lies anywhere else.
- **Manholes.** One cover in the middle of every street segment (between two intersections), in the middle of a travel lane, alternating lanes.
- **Furniture strips.** The 1.2 m strip at the curb of every block face, round the lamps and street trees (each keeps its clearance; nothing stands within 3 m of a face's end): a hydrant per face; per business (a place of kind shop, food, hangout or work with a face) its kit (`FRONTAGE_KITS`: newspaper box, bins, a bench, a café table, bike racks, parking meters), slid up to 4 m along the face to fit; the bus stop first of all (shelter, stop sign, bin).
- **Corners.** A street-name sign at two opposite corners of each intersection; none at the perimeter loop's four rounded corners.
- **Parked cars.** None are placed by the course: the low-poly parked cars inside the walls are gone, parked cars are real cars (traffic).

Nothing in the fabric throws: a piece that finds no room is left out, and a row holds the shipped layout to a hydrant on every face and a shelter at the bus stop. Not here yet: trees in pits, utility poles, storm drains, curb ramps.

## Rowhome facade kit

Every home inside the walls is dressed from its `Place` (`homeFrontages`): a point on the building's drawn front face at the lot's middle. Across the lot (u, along the building's local z) the door and its stoop stand at +1.8 m (`homeDoorPoint` is the place's door point) and the bay stack takes the other half, centred at -0.9 m, 2.8 m wide. Four instanced meshes (`FacadeBays`: bay, stoop, railing, cornice; four draws whatever the number of houses, painted textures made in code) draw
the bay stack (a stone plinth from the ground with a barred half-basement window, then on every storey, the raised ground storey included, a panelled apron, the window with a flat front and two angled sides and a belt band, a panel and a roof slab on top; every ring is cut from one footprint, 0.7 m out), the stoop (five 0.18 m risers whose landing, 0.9 m, is the door sill; jambs and a hood at the door), iron railings on its cheeks and a bracketed roofline cornice;
panels and cornice take the house's accent from `HOUSE_ACCENTS`, windows light at night from the facades' `FACADE_GLOW`. The facade art of a home carries no bay, stoop, railing or cornice of its own.
What a car or a walker meets is `facadeSolidProps(lots)`, appended to the course's props as invisible-wall boxes, three a home: the bay stack (one box to the roof slab), the stoop's ramp (a box over the four treads, placed with `stairs: true`, so `world/stairs.ts` makes it a flight: the walker's floor reads its treads and the dummies' world stands a box per tread in place of the block) and its landing (flush with the sill).

## Animation (`present/civilian-anim*.ts`)

A near dummy does what her brain says she does: `CrowdPoses.activity` is an `ACTIVITY` code (`ai/civilians/civilian-activity.ts`: idle, talk,
buy, door, sitDown, sit, standUp, bump, swing, block, hit, sitSteps; 0 is the walk). `activityClock` is the seconds since it began (the clip's own
time, so a civilian who comes into view mid-activity is already in it), `activityLeft` the seconds until it ends, `partner` the civilian a
bump, fight or talk is with (the clips turn toward or away from her), `feetY` and `surfaceY` the floor and the seat or counter top, so a
sitter lands on any seat height (`Place.seats`, a stoop step) and a customer's hand finds the counter.

`poseCivilian` fills one `ActivityPose` and `poseActivity` poses the dummy: the walk's channels (the guards' stride) first, then the clip's
tracks (`civilian-anim-clips.ts`, keyframes per channel: pelvis, torso, head, each arm and leg) blended over them by a weight that eases in
from the walk and out over the clip's last `blendOut` seconds, then two solves: a hand reaches a point (counter, door handle, a face) through the
torso's lean, and `plant` holds the feet on the floor as the pelvis sinks. A clip is authored for its main side, mirrored toward the partner's
side (bump, fight) or the civilian's handedness. Looping clips grow their fidgets from their rest pose over 1.5 s and start at an offset per
civilian, so a bar of sitters does not glance together. No frame allocates.

## Traffic (`ai/openworld-traffic`)

Real cars of the field drive the streets, stop at signals and park in the kerb spaces. They are sim cars on the host (and solo) and reach a client in the host's snapshots like every car (about 30 B a car at 30 Hz while undamaged: 12 movers about 11 KB/s a client). The pool is the cars past the seated ones (`first` = highest seat + 1): `MOVER_CARS` drivers (desktop 12, phone 6, the last `PATROL_CARS` of them police bodies for `spawnDrivenCar(..., { urgent: true })`) and `KERB_CARS` standing cars (desktop 10, phone 4). Mover and kerb cars wear everyday bodies only (`EVERYDAY_BODIES`: sedan, hatchback, wagon, pickup; the fleet slot's coupe or monster is rebuilt as a seeded pick, any other body is kept). A peer that joins takes the lowest free id: if it is a pool car, traffic lets go of it (its lease is `lost`).

- **Roads** (`world/openworld/openworld-roads.ts`): the 4 x 4 grid of junctions from `LAYOUT`, two lanes a street, traffic on the right; `openworld-parking.ts`: the kerb spaces on the block side of each lane (6 m each, 6 m clear of a junction's box), `stays` marks the 70 % that hold a car for good.
- **Signals** (`traffic-lights.ts`): four phases a junction (north-south through, left, east-west through, left), each a green, 3 s yellow and 1.5 s all red; `lightPhase(junction, crowdSeconds)` is a pure function of the crowd clock, staggered per junction, the same on every peer. Drawn by `present/traffic-lights.ts` (poles, heads and lamps, three instanced meshes).
- **Driving** (`trip-route.ts`, `traffic-driver.ts`): a trip is points along the lanes, the turns and the swing into a space (a Dijkstra over lanes); the driver is pure pursuit with the lowest of the cruise speed, the turn caps, the signal ahead (red, or a yellow it can stop for, holds it at the bar; a decision to stop sticks), the car ahead on the route and the end of the route.
- **Cars** (`mover-fleet.ts`): ambient cars dwell in a space, pull out, drive to a free space and park; leased cars (`OpenWorldTraffic.spawnDrivenCar(resident, fromSpot, toSpot, options?)`: a resident's commute, a patrol) take a given trip, and `handle.driver` replaces the trip driver. `kerb-cars.ts`: real cars standing in the spaces within 70 m of a player that no eye sees, put away when unseen and 40 m off.
- **Red-light runs** (`red-light-watch.ts`): `onRedLightRun(listener)` (host and solo) fires once per car per crossing of a stop bar against its signal, for every car, the player's included.
- **Engine** (`engine-openworld.ts`, `engine-race.ts`): `RaceDirector.freeDrivers` drives the lobby's cars no human does (null: they stand on their brakes as ever).

## Interiors (`world/openworld/interior-*`, `present/interiors`)

Five interiors (`Place.interior`: rowhome, coffee, bar, office, store) are built from one furniture kit. The **plan** (`planInterior`, pure, the same on every peer) lists walls with openings, floor and ceiling slabs, stairs and furniture in plan metres (`deep` from the street wall, `across` along the face); the same plan gives
the **seats** (`Place.seats`: x, z, yaw, height; a rowhome's two stoop seats lead, `Place.stoopSeats`), the **counter** spots (`Place.counter`: where a customer stands to buy, where the clerk stands) and the **solids** (`interiorSolids`) the walkers' physics takes while an eye is near. A rowhome stands on its stoop's landing (0.9 m) with three storeys and a stair up its left wall; a shop's floor is level with the sidewalk.

The **doorways and shop windows are cut through the facade's ground band** (`SHOPFRONT` per interior; `scripts/pack-facades.mjs` zeroes the ground layer's albedo alpha there and the shader discards it), so the interior is seen from the street and a door leads into it. `InteriorSet` (one per map) keeps the
ground floor's envelope of every place within `SHELL_NEAR` of the eye, so no opening shows through to the world, and the furnished interior within `INTERIOR_NEAR`; both are dropped after the eye has been past their far radius for `INTERIOR_LINGER`. Everything is merged into three meshes (envelopes, furniture, lamps and screens): the draw calls do not grow with the interiors.

**Walking in.** A place with an interior stands in a drawn-only `buildingShell` (a `building` with no collider), and its ground floor's street, party and back walls are invisible-wall props (`interiorEnvelopeProps`, merged along each row of houses) that are whole but for the doorways, so a car is stopped and a walker passes a door. The rest (slabs, stairs, furniture) reaches the physics as fixed boxes, handed over by `InteriorSet.onSolids` while the eye is within `SOLIDS_NEAR`.

## Where it lives

| Piece | File |
|---|---|
| The brain, its worker and remote | `ai/civilians/civilian-{state,tick,plan,events,remote,worker,wire}.ts`, `society*.ts`, `needs.ts` |
| Interaction table, venues, seats, crime, activity | `ai/civilians/society-{table,venues,seats,crime,reactions,activity,commuters}.ts` |
| The crowd, its constants | `ai/civilians/civilian-crowd.ts`, `civilian-crowd-constants.ts` |
| Bodies kept apart, the player on foot, a car's brush | `ai/civilians/civilian-separation.ts`, `crowd-walkers.ts`, `civilian-contact.ts` |
| The look-at | `ai/civilians/civilian-look.ts` |
| The engine's end: crowd, link, look-at, wall hook | `engine/engine-openworld.ts` (`OpenWorldDirector`, held by `CrashEngine`) |
| Drawing | `present/civilian-art.ts`, `civilian-dress.ts`, `civilian-pose.ts`, `civilian-figure.ts` |
| Signs: shop signs, names on the buildings | `present/openworld-shop-signs.ts`, `openworld-signs.ts` (the label style from `track-debug.ts`) |
| Rowhome facade kit | `present/facade-bays.ts`, `facade-bay-parts.ts`, `facade-kit-atlas.ts`; plan and colliders `world/openworld/openworld-facade-solids.ts` |
| Animation | `present/civilian-anim{,-clips,-rig,-channels}.ts`, `ai/civilians/civilian-activity.ts` |
| Traffic, signals, parking | `ai/openworld-traffic/`, `world/openworld/openworld-{roads,parking}.ts`, `present/traffic-lights.ts` |
| Map and course | `world/openworld/` |
| Street fabric (crossings, manholes, hydrants, furniture) | `world/openworld/openworld-fabric.ts`, `openworld-fabric-constants.ts`, `openworld-sides.ts` |
| What is seen, the cars' detail and phase-out | `present/openworld-sight.ts`, `present/openworld-car-lod.ts`, `engine/engine-openworld-cull.ts` |
| Interiors: plan, kit, streaming | `world/openworld/interior-{kinds,draft,layouts,plan}.ts`, `present/interiors/` |
| Programme (businesses, hours, sectors) and lots | `world/openworld/openworld-{programme,lots}.ts` |

The director is made with the engine; the crowd is made on the first frame the open world's course is up and a map is known
(`CrashEngine.startOpenWorld(map)`), rebuilt when the key changes (a new seed, a host's other tier) and dropped, with its drawing, its
wall hook and its worker, as the course is left.

## Law: cops and criminals (`ai/openworld-crime`)

Foot cops patrol the sidewalks and patrol cars (leased from the traffic's pool) answer what the society holds against its residents: a crime, a fight, a red light run, a driver who keeps running people down.

- **What it reads.** `OffenceSource` (the brain's wanted spell, fight tick and partner, where a resident stands, when their walk began; `StateOffenceSource` reads the society's rows through `society-crime.ts`). A resident wanted and not yet taken up opens a **case**: a crime (one suspect) or a fight (two). At most `MAX_CASES` at once.
- **Foot law (`FootLaw`).** Runs on a fixed grid of crowd time (`CRIME_HZ`), a pure function of (seed, society rows, clock): `FootCops` walkers on the walk graph (seeded patrol turns, the nearest free cops called, A\* runs by `PathFinder`, the last metres straight), `Flight` for suspects. A suspect a cop has in sight (`COP_SIGHT`) runs, by streets weighted away from the case's cops, to the hiding place (`PLACE_KIND.hide` door) they reach `HIDE_LEAD` m ahead of the nearest cop, else to the street corner farthest from the cops. Hidden, they are searched for once when the first cop reaches the door (a seeded draw, `FIND_CHANCE`); the search is given up after `SEARCH_SECONDS` and they stay off the street until their next walk begins. A cop within `BUST_REACH` of a suspect takes hold; `GRIP_SECONDS` later the host raises `EVENT_KIND.bust` (`CivilianCrowd.raiseEvent`; the society hides them for jail, clears the wanted spell and both fighters' fight).
- **Fights.** A cop within `FIGHT_WARN_REACH` warns; after `WARN_SECONDS` each fighter's seeded draw (`RESIST_CHANCE`) says whether they keep attacking. The instigator is arrested whatever; a fighter who keeps attacking is taken down (a `FigureStrike` thrown as a figure, like a run-down civilian) and arrested; the other is let go with a warning. A fight that ends before a cop comes goes on as a pursuit of the fighters still wanted.
- **Cars (`PatrolCars`, `PursuitDriver`).** A foot case calls a patrol car to it (it stops `CAR_STOP_GAP` m short; its cop steps out and joins the case, `CAR_COP`); a red light run a cop saw (foot cop or patrol car within `RED_LIGHT_SIGHT`) sends one after the car; a car that runs `HEAT_KNOCKS` civilians down within `HEAT_SECONDS` has one sent whoever saw it. The patrol car's driving is the police's: `pursuitSteer`, `arcSpeed`/`brakeOver` over `Pedals`, the hunters' heading search over the course's solids (`Obstacles`) and `Backoff`. A traffic car it comes within `YIELD_DISTANCE` of is made to stop (the traffic hands its driver slot over); the bust is the race's rule, `BUST` (held under `BUST.kph` within `BUST.near` m for `BUST.time` s), and Survival's `SURVIVAL.bustTime` for a human's car, whose bust the engine's `playerBusted` port answers.
- **Drawing.** The suspect's pose in `CrowdPoses` is overwritten inside the crowd's step (`CivilianCrowd.overlay`, after the civilians are placed and before the cars' hits, so a car meets a fleeing suspect where they are drawn; `overlaySuspects`); the foot cops are a second crowd (`copPoses`, look word `POLICE_HASH`) drawn by their own `CivilianArt`.
- **Netplay.** Every peer runs the foot law; only the host raises events, and a suspect's bust is the host's event heard back through the log. A peer that joins late starts its chases from the open wanted spells it finds, so its cops' positions are its own until the host's bust ends the case. Patrol cars are host sim cars and stream like any car.
- **Wiring.** `engine/engine-openworld-law.ts` (`OpenWorldLaw`) is made with the crowd and driven from `OpenWorldDirector.step/frame`; the director makes the law after the traffic and gives it the traffic (`OpenWorldTraffic` satisfies `TrafficApi`); `ports.law` (engine) supplies the course's solids (`RaceField.courseObstacles`), the light bars and the bust of a human's car, which takes it back to its spawn (`resetLobbyCar`: the lobby has no session, so Survival's banner and chase strip have nothing to show). Without `ports.law` there are no police.
