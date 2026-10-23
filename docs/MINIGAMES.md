# Range minigames

Three throw events on the Range scene: Long jump, High jump and Ring Fling. Local and cosmetic: nothing here is in a replay or a snapshot, and netplay clients do not see minigame state. The one sim change is the vertical carry on an ejection (section 8). The Range scene itself is in [`CINEMATIC.md`](CINEMATIC.md).

## 1. What it is and how to play

Range scene -> Mini games -> Long jump / High jump / Ring Fling. There is no auto-drive: the car is parked at the top of the station's start hill until your first pedal press, the camera behind it in the seat's chase view (`followsInChaseView`). Drive down the hill and the run-up, up the climb; at the lip the driver is thrown (section 2; the Long jump's barrier throw waits for your bail press, below) and the camera follows him (`ride-cam.ts` leads its aim along the throw) and holds on him until Retry. A minigame's throw always opens that ride, whatever you framed before it (a wheel, a drag or a pinch set `userFramed`, which only keeps the plain Range's throw from taking the camera).

The score card shows the live value while he flies (metres past the lip, metres above it, or the ring zone under him), then the scored value once he is at rest. Buttons: **Retry** (Ring Fling: **Next throw**, then **New set** once the set is complete), the quick-switch buttons to the other two modes, **Reset run** and **Exit**.

Ring Fling throws per set: 1-10, default 5 (`THROWS_PER_SET`); a set's score is the sum of its throws and is recorded when the set completes. Bests are kept per mode x car type and overall, in `localStorage` under `crush.minigame.best.<mode>[.<throwsPerSet>].<carType | overall>` (`engine/minigame-store.ts`; only Ring Fling keys carry the set length).

**The Long jump's timed bail.** In the Long jump the **boost control** (keyboard Shift, pad A / Cross, touch Boost; the one binding `readIntent` reads, see [`CONTROLS.md`](CONTROLS.md)) is the bail and nothing else: the car's own boost is off there (`DriverSeat.boostLocked`). Press it once as the car meets the barrier. How close the press is to the hit sets the launch: perfect (within 0.03 s) is the best launch, 45 degrees; each farther press loses metres in a straight line (not a cliff) down to 0 at 0.25 s; no press (or a press more than 0.25 s early, a wasted bail, or after the throw) is the flat 30 degree throw at half the range, mid-field (about 50 m). The first press of a run counts. The throw is held up to 0.25 s after the hit for a late press, so a press that is "late" still lands before the dummy leaves. The card shows "Press Shift as you hit the barrier" (the control as the device in use names it: Shift; A on an Xbox pad, Cross on a PlayStation pad, A on a generic pad; Boost on a touch screen) until he is thrown, then the timing: "Perfect", "Early 0.12 s", "Late 0.08 s", "Too early (0.90 s): no bail", "No bail".

**The bail is timed in real time.** The crash clock is held at 1x in the Long jump from the start of the attempt until the throw's release (`SLOMO_HELD`): no pre-impact slow-mo before the barrier, none after the hit. So the 0.03 s perfect band and the 0.25 s window are 0.03 s and 0.25 s of the player's own time on both sides of the hit (an earlier build let the hit's slow-mo stretch the late side: on a coasting run the throw waited 356 presented frames, about 6 s, and a press 0.5 s after the hit counted as 0.08 s late). The throw's own slow-mo starts at the release, after its usual 0.25 s at 1x for the exit. The drive hint under the card names no boost in the Long jump: the card's prompt is the control's one word.

## 2. Station anatomy

Each station is laid out in its own frame (`scenes/minigame-constants.ts`): +x is the throw direction, z = 0 the lane's middle, y measured from the pad. Stations sit at `STATION_ANCHORS` (long jump (0, 0), high jump (0, 90), Ring Fling (0, 170)), every one within `STATION_HALF_WIDTH` 12 m of its anchor.

Start pad (6 m) -> start hill (falls 3 m over `START_HILL_LENGTH`: 11 / 24 / 24 m) -> run-up (`RUN_UP_LENGTH`: 0 / 40 / 30 m) -> climb or kicker -> lip. The parked car faces +x.

- **Long jump**: lip = world origin, because the jersey barrier is origin-bound. The barrier throws the driver by a hit. Incline 7 degrees, 2 m, crest radius 100 m, flat for x in [-5, 0]. The barrier rebounds without ejecting above ~31.4 m/s arrival (lowest failing speed, phase dependent). The monster rides over the barrier on its tyres (its keel clears the top) and keeps its driver below ~22.5 m/s arrival (thrown at every phase from 22.52, not at 22.48); every other class is thrown at every phase from ~17.6 m/s (the truck, the last: not at 17.18, at 17.63; sedan, police, hatch from 15.7). So the approach is tuned: arrival at full throttle on the shipped approach sedan 24.7-24.9, muscle 26.7-26.8, truck 24.4-24.5, monster 27.2-27.5, police 24.7-24.8, hatch 24.6-24.8, suv 24.4-24.6 m/s (was 36-39), every class thrown once at every phase; the window floor is each class's own slowest ejecting arrival + 3 m/s. The field is 110 m with a sign every 10 m to 110 (`RANGE.signs`), so the signs run past the best landing.
- **High jump**: one R25 m arc kicker tangent to the run-up, lip pitch 60 degrees, lip 9.5 m up, run-up 40 m, hill 24 m. All 7 classes reach the lip at full throttle.
  Radius sweep at 60 degrees (lip height; sedan / muscle / truck / monster unboosted apex m; ratio): R20 7.0 m 60/142/110/219 3.64 | R22 8.0 m 127/146/123/213 1.81 | R25 9.5 m 135/158/125/200 1.67 | R28 11.0 m 125/151/127/207 1.66 | R30 12.0 m 136/154/125/218 1.75. R25 was chosen (R20 is a cliff for the sedan: lip speed 18.9 vs 27 m/s). After the climb fix the R20 cliff no longer holds (R20 at 60 degrees: sedan lip 26.8 m/s; R15 26.4; R10 26.0), so the 'can fail' controls are the shipped radius one 5-degree step past the sweep's end (80 degrees: sedan 14.0 m/s, under the 17 floor; the sweep ends at 75 where it reads 18.0), a 15 m radius at 60 degrees for the climb bar (26.42 under 26.5), and a 3 m radius at 85 degrees for the apex ratio (10.4: the sedan family cliffs, the monster carries).
- **Ring Fling**: 5 degree incline plus a 4 m ball-hop quarter wave (1.005 m, the machine's 3.35 in on 120 in), lip 1.31 m high, hill 24 m, run-up 30 m; the board starts 6 m past the lip.

**Forced lip throw** (High jump, Ring Fling; `minigame-lip.ts` `LipThrow`): there is no wall on those ramps, so when a car's centre crosses the lip plane going +x (tested between two `collide` calls, so a fast slice cannot step over it) its driver leaves through the windscreen at the car's full 3D velocity (`EjectionWatch.throwDriverNow`) and the driverless car is cut to `LIP_CAR_SPEED_KEEP` (0.25) of its speed so it falls short of the boxes and board. **Back drop**: behind the lip the floor falls away at `LIP_BACK_FACE_PITCH_DEGREES` (60) down to the landing level.

Class lip speeds at full throttle (horizontal m/s; High jump on a 5 cm grid, at the centre): High jump sedan 27.1, police 27.2, hatch 27.2, suv 27.5, truck 30.7, muscle 36.5, monster 29.4 (the monster's 35.6 was the climb artifact). Ring Fling sedan 32.4, muscle 35.7, truck 32.3, monster 38.2, police 32.5.

## 3. Scoring

- **Long jump**: the torso's x at rest, past the lip (min 0).
- **High jump**: the highest point the torso reaches above the lip while it is within `SCORE_BAND_HALF_DEPTH` (2 m) in front of or behind the posts' plane (`HighJumpPeak`), from the throw until he lies still. The posts do not have to be passed: a dummy that taps a post or a slat and falls back scores the height he had at the bars, caught or not; any lateral position counts (between the posts, beside them, past the field); a peak before the band (a slow run's apex) or beyond it (the muscle's best run peaks 17.5 m out) does not count, only what he had inside it; 0 if he is never above the lip inside the band. The card's live value is the highest point in the band so far (it never drops; 0 until he is in it), and the score arrives once he is at rest, as in the other modes.
- **Ring Fling**: the cup the torso rests in, 10-50, or one of the two 100 pockets (`ringScore`); 0 off the board.

"At rest" is the torso's own still-time reaching `REST_HOLD` (1 s), never the ragdoll's `settled` flag (`minigame-session.ts`): the score reads the torso, so it waits on the torso's own still-time, not on a whole-body flag. Rest positions still carry a skid lottery after landing, so the sizing bars are on landing distance as well as rest.

## 4. The Ring Fling board

`present/ring-fling-art.ts` and `scenes/minigame-ring.ts` scale the real skee-ball machine's measurements (inches x `METRES_PER_REAL_INCH` 0.0254) by `SKEE_SCALE` 15, the least whole scale at which the 50 cup holds the 2.0 m lying dummy. The board starts `RING_BOARD_START_X` 6 m past the lip, slopes `BOARD_SLOPE` 0.06 over a 27 in lane; cups have radii 1.33-1.9 m; rim, skirt and rails come from the machine's rail inches; the two 100 pockets (window 2.29 m across) sit at the sides behind the 50 cup; a 19 m backstop (backboard) stops a long throw (`RING_BACKSTOP`).

## 5. The high jump frame

Posts at `POSTS_DISTANCE` 11 m (half-span `POST_HALF_SPAN`): two black posts `POST_THICKNESS` 0.25 m square from the pad to the frame top, whatever its height. Between them a slat `SLAT_THICKNESS` 0.1 m square (thinner than a post) stands at every board, one every `BOARD_STEP` 5 m up from the lip (the lip line at 0), the bright ones every 50 m (`MAJOR_BOARD_EVERY_METRES`); nothing else stands between the posts. At every `SIGN_EVERY_METRES` 10 m mark (the lip's included) a numbered plate is mounted on each post, the same number on both ("0", "10", "20" ...), facing the run-up and sitting on its slat: the range's distance sign (`signAtlas` and `signFace` in `range-art.ts`: same paint, font and plate), 1.3 x 0.65 m (half the range's 2.6 x 1.3 m sign), its inner edge flush with the post's inner face so the opening stays clear; the other slats carry a small brass plate on each post. The posts and slats are ragdoll colliders: `MinigameGround.addHighJumpFrame` builds them as one static triangle mesh (the posts, then one slat per board) in the dummy's Rapier world with the ground's other meshes, so they share the ground's collision groups; a dummy can hit a slat, catch on it and tumble through. The plates are art only: a dummy passes the middle touched by nothing but the slats. The frame is deliberately not prisms: a prism is a floor to every height read and sight probe, 200 m up, and a wall to cars. Frame top = `FRAME_HEADROOM_FACTOR` 1.3 x the best measured height (`HIGH_JUMP_MEASURED.bestHeight` 169.1 m, the best run's score, so 220 m: boards are 5 m apart all the way, 44 slats, 22 marks). A tall net stands `NET_DISTANCE_PAST_POSTS` 30 m past the posts (41 m), `bestHeight` x `NET_HEIGHT_SHARE` 0.5 tall (85 m). Between them, cardboard box piles end 35 m out: `BOX_COUNT` 48 dynamic cuboids (4x4 towers of 3, 0.9 m cartons in the cost test) in the ragdoll's own Rapier world (`present/ragdoll-boxes.ts`, art `cardboard-art.ts`); no stack stands in a cell a post stands over. Cost per 60 Hz frame (8 Rapier steps): +0.03-0.05 ms asleep, +1.1 ms awake (budgets 0.5 / 3 ms). The frame adds one 46-box mesh collider (552 triangles) to the world, built once with the ground; the slats are one draw (`boards`), the plates one more (`height-plates`, 44 quads on one atlas).

## 6. The dummy boost

`THROW_BOOST` (`minigame-constants.ts`) holds a `{ forward, upward, elevation }` triple per minigame: `forward` and `upward` multiply the thrown driver's horizontal and vertical launch velocity, and a non-null `elevation` (rad) makes the scaled horizontal speed the whole release speed, aimed at that angle above the heading; applied only to a minigame throw and only on the ragdoll side (the ragdoll's launch). The sim's Ejection event stays physical, so replays and the fingerprint do not move.

Why a triple: the sim keeps a car's horizontal speed on a slope and lets its vertical speed follow the ground, so a 60 degree kicker throws at vy = vh x tan(60), a near-vertical rocket. Hence forward < 1 for the High jump. The barrier's throw has about the same vertical speed (3.2 m/s) at any approach speed, so a multiplier on it made the landing depend on the speed only as its square root, with a slower monster out-carrying a faster one: the Long jump builds the release from the horizontal speed alone (upward 1, elevation set by the bail), so its landing goes with the speed squared.

| Mode | forward | upward | Intent |
|---|---|---|---|
| Long jump | 1.13 | 1 | the base of a perfect bail: the whole release speed is 1.13 x the car's horizontal speed at 45 degrees; the bail (section 1) sets the angle and speed of every other press |
| High jump | 0.112 | 1 | forward keeps the best run landing in the box field before the net; upward puts it over the posts |
| Ring Fling | 0.4 | 0.65 | a ballistic landing that puts a full-throttle sedan on the 30 cup |

Retuned 2026-10-20 for the seat-velocity launch (the push out follows the pitched nose, so a kicker's throw leaves 1.5 m/s higher and 1.5 m/s less along; was 1.15, 0.108 / 1.03 and 0.4 / 0.7), so each mode lands where it was tuned. Retuned again after the climb fix: high jump 0.117 / 1.03 -> 0.112 / 1 (forward keeps the longest best run, now the muscle's, in the box field; upward puts its crossing at the posts' plane in the owner's 150-160 m: 156.9 m).

Unboosted a best long jump rests 16-26 m.

## 7. Sizing table

Worst of 3 repeats, from `minigame-sizing.test.ts`.

**High jump** (boost 0.112 / 1; best run: score, the highest point above the lip within `SCORE_BAND_HALF_DEPTH` 2 m of the posts / apex @ distance / lands, all m)

| Class | Score / apex @ dist / lands |
|---|---|
| sedan | 111.3 / 111.3 @ 10.2 / 19.9 |
| police | 111.0 / 111.0 @ 10.2 / 19.9 |
| hatch | 116.6 / 116.6 @ 10.5 / 20.5 |
| suv | 115.7 / 115.7 @ 10.3 / 20.0 |
| truck | 136.5 / 136.5 @ 12.4 / 23.9 |
| monster | 112.3 / 112.3 @ 9.9 / 20.0 |
| muscle | 170.3 / 182.9 @ 17.5 (past the band; crosses the posts' plane at 156.9) / 33.0 |

An 80% run (the best throw scaled alike horizontally and vertically) scores sedan 60.7, police 59.5, hatch 66.7, suv 62.5, truck 88.0, muscle 121.8, monster 55.1 m (the bar `SLOW_RUN_HEIGHT_MINIMUM` 50 holds; the monster's 55.1 the least). The best-height band is the owner's 150-160 m crossing height times the best run's score over its crossing (170.3 / 156.9 = 1.085): 163-174 m (was 162-173 from a ratio measured on the artifact). Frame top 225 m, 45 slats, 22 height marks, net height 85 m, posts 11 m, net 41 m, box piles end 33.6 m.

The table above and its bars are measured on the free pad: the posts and slats are taken out of the ragdoll's world (`rangeFor` in the sizing test), so they size the launch alone. With the frame in (the sizing test's framed row, one throw per class's best run at the steady 60 Hz; score / lands, m): sedan 111.3 / 16.0, police 111.0 / 17.0, hatch 116.6 / 21.9, suv 115.7 / caught (NaN), truck 134.8 / 13.2, monster 112.3 / 18.6, muscle 156.3 / 31.1. A slat catches the muscle's best run on the way up inside the band, so it costs 13.9 m of score (170.3 to 156.3); every best run still scores well up the boards and the best class stays over the owner's accepted 150 m (the framed bars). With the middle signs gone (they were 4.7 m tall colliders between the posts) the sedan, police and hatch are no longer caught at the plane: they land 16-22 m out instead of resting 8.5-9.8 m out. `HIGH_JUMP_MEASURED` stays the free pad's: it is the most a run can score, which the frame is sized over. Whether a run is caught is a lottery a browser's own frame times change, so a score with the frame in is a range, not a number.

**Ring Fling** (boost 0.4 / 0.65; lip h/v m/s -> rest x, cup)

| Class | Full throttle | 70% run |
|---|---|---|
| sedan, hatchback, wagon | 32.4/13.5 -> 31.9-32.1, cup 30 | sedan 21.6/8.9 -> 18.6, 0 (short of the 10 cup at 20.1 m); hatchback/wagon 23.3-23.6, cup 10 |
| truck | 32.2/13.7 -> 32.0, cup 30 | 23.3-23.6, cup 10 |
| police | 32.5/13.6 -> 32.0, cup 30 | 23.3-23.6, cup 10 |
| muscle | 35.6/14.9 -> 38.1, cup 50 | 21.0, cup 10 |
| monster | 38.2/18.0 -> 41.0, bounced off the backstop (0) | 25.1, cup 20 |

Sedan speed-share sweep (share of full-throttle lip speed -> cup): 0.72-0.86 -> 10, 0.88-0.94 -> 20, 0.96-1.00 -> 30; below 0.70 no cup.

**Long jump** (the timed bail; `THROW_BOOST.longJump` forward 1.13; best run of each class: landing / rest in m by press offset from the hit, early and late alike, seed 0 of `minigame-sizing.test.ts`)

| Class | Perfect | ±0.05 s | ±0.10 s | ±0.20 s | No press |
|---|---|---|---|---|---|
| sedan, hatchback, wagon | 88.0 / 90.2 | 84.5 / 86.5 | 75.6 / 78.4 | 56.7 / 59.9 | 47.0 / 50.6 |
| muscle | 99.3 / 101.1 | 95.8 / 97.7 | 85.6 / 88.1 | 64.4 / 68.0 | 53.2 / 57.2 |
| truck | 86.6 / 88.3 | 83.3 / 85.3 | 74.5 / 76.7 | 56.2 / 59.5 | 46.2 / 49.9 |
| monster | 104.7 / 106.3 | 100.7 / 103.0 | 90.6 / 92.8 | 68.8 / 72.4 | 57.1 / 60.9 |
| police | 88.2 / 90.2 | 85.0 / 86.8 | 76.0 / 78.7 | 56.8 / 60.2 | 47.1 / 50.8 |

Mid run (85% of the approach, perfect bail / no press): sedan 68.2 / 36.1, muscle 76.6 / 40.8, truck 66.0 / 35.0, monster 77.4 / 41.9, police 67.7 / 36.0. A slower run lands shorter for every class at every offset. Through the real engine, keys and all, at full throttle with no press: sedan 49.9, muscle 58.2, truck 48.8, monster 63.0, police 49.7, hatchback 49.7, wagon 49.9 m.

The barrier throws no driver below ~18 m/s horizontal. The sizing bars (`minigame-sizing.test.ts`): the perfect bail lands the farthest class 97-108 m (the last sign, 110 m, is the field's end) and every class past 85 m; a run with no press lands every class 42-58 m; the metres fall by at least 8 m from perfect to 0.1 s, to 0.2 s and to no press, never rise with the distance, and an early press lands within 4 m of a late one of its distance. The monster's ±0.05 s rest of 124.9 m is a skid past the field's end: the landing (104.5 m) is what is sized, the rest is a lottery of up to ~35 m.

## 8. Determinism and replay impact

The only sim change is in `vehicle/ejection.ts`. REPLAY entry:

> Ejection: the thrown driver keeps the car's vertical velocity (v.y = pre.y + THROW_UP, was the constant 3.5; the watch's velocity ring stores y), so a car leaving a ramp or kicker throws its driver along the ramp's climb. Flat-ground ejections are unchanged (pre.y ~ 0) but any ejection with a moving-vertical car (derby jumps, ramps) changes: replays and the sim fingerprint change. A forced-throw entry (EjectionWatch.throwDriverNow, used by the range minigames' lip trigger) is new and unreachable from existing scenes.

Everything else (session state, bests, boosts, boxes, boards, panel) is local presentation: not in replay or snapshots; netplay clients do not see minigame state.

The fountains lead the car up to the lip (`engine-fountains.ts`, `Fountains.runUpFrame`, once a frame from the engine; the plain Range does the same up to its barrier): up to three rows of two jets along both edges of the run-up (`STATION_HALF_WIDTH` from the lane's middle; the plain Range's `RANGE.halfWidth` + 1 m), the big pair at the lip itself (the Long jump's barrier) and the others spread evenly back toward the car's spawn, each on the floor under it. The back row stands just past a parked car's standstill reach from the spawn, so it lights as the car pulls away; the gap (`STATION_ROW_GAP`, `RANGE_ROW_GAP`, never under `RUNUP_MIN_GAP` 10 m) comes to 35 m in the High jump, 39 m in Ring Fling, 10 m in the Long jump and 11 m on the plain Range. Each row starts so it is in full spray as the player's car passes it (`APPROACH_LEAD_S` ahead at its current speed), strictly back to front and at least `ROW_STAGGER_S` after the row behind it, so a car already at speed (the plain Range's) still sees them light one after another; they burn on through the throw (`APPROACH_RUN_S`). None stands past the lip, none starts once the car is by, and a parked car starts none; Retry, Reset and Exit clear them. Cosmetic like everything else here; the FX tier sets the rows.

## 9. Re-sizing and files

Change a number in `scenes/minigame-constants.ts`, then run the tests that print the tables: `minigame-sizing.test.ts` (boost and bars on the free pad, pins `HIGH_JUMP_MEASURED` within 2%; its framed rows print the best runs with the posts and slats in the world), `minigame-profile.test.ts` (hill and kicker speeds), `minigame-lip.test.ts` (lip throw and `LIP_CAR_SPEED_KEEP`). Update `HIGH_JUMP_MEASURED` and this doc's tables with what they print.

| File | Role |
|---|---|
| `scenes/minigame-constants.ts` | modes, anchors, hill/incline/kicker numbers, `THROW_BOOST`, `HIGH_JUMP_MEASURED` |
| `scenes/minigame-profile.ts` | station ground profile |
| `scenes/minigame-ground.ts` | ground solids built from the profile |
| `scenes/minigame-ring.ts` | Ring Fling board geometry, cups, pockets, `ringScore` |
| `scenes/minigame-high-jump.ts` | posts, boards, signs, net, box layout, `HighJumpPeak` (the score) |
| `scenes/minigame-lip.ts` | `LipThrow` forced throw |
| `scenes/minigame-session.ts` | attempt state machine, scoring, bests pairing |
| `engine/engine-minigame.ts`, `engine-minigame-commands.ts` | engine wiring and panel commands |
| `engine/minigame-store.ts` | `localStorage` bests |
| `present/ragdoll-boxes.ts`, `cardboard-art.ts` | box piles (Rapier cuboids) and their art |
| `present/minigame-art.ts`, `high-jump-art.ts`, `ring-fling-art.ts`, `long-jump-art.ts`, `minigame-surface-art.ts` | per-station art |
| `present/ride-cam.ts` | the minigame framing (`Framing.lead`): aim led by the shown velocity, opens on the follow shot (eased from the drive cam), eye 5 m aside, 12 m back at speed, 8 m back and 6 m up at rest, lifted clear of the ground and `sight` solids |
| `engine/engine-core.ts` | `onThrow` (a minigame's throw always opens the ride camera) and `followsInChaseView` (the parked start's shot) |
| `present/engine-ragdoll.ts` | `launch`: the release's `forward`, `upward` and `elevation` |
| `scenes/minigame-bail.ts` | the Long jump's timed bail: windows, verdict, `bailRelease`, `LongJumpBail` |
| `hud/bail-prompt.ts` | the bail's prompt and result text, the control named per device |
| `match/phase.ts` | `SLOMO_HELD`: the crash clock's slow-mo held at 1x until the throw (`holdForThrow`); `engine-scenes.ts` `restartCrash` arms it in the Long jump |
| `hud/drive-keys.ts` | the driven car's key line, with no boost in it in the Long jump |
| `vehicle/ejection.ts` | `throwDriverNow`, vertical carry |
| `components/minigame-panel*.tsx` / `.ts` | score card and buttons |
