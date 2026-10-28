# On foot

The player gets out of the car, walks and runs as the crash-test dummy, is knocked down by a car, gets up, and gets back in. The
walker is an active ragdoll: the same twelve Rapier boxes and eleven joints as a thrown driver (`present/ragdoll-body.ts`: feet on ankle hinges, 20° toes up and 30° down), held up by
joint motors, not a second animated mesh. The same walker, one per pool slot, stands the showcase's figures up again after a press
knocks them over ([The showcase](#the-showcase)).

## Controls

| Action | Keyboard and mouse | Controller |
|---|---|---|
| Get out of your car (driving, stopped or under 3 m/s, driver door clear); get back in (on foot, at your own car's driver door) | Enter | B / Circle |
| Walk, relative to the camera (stick: slower for a lighter push, 0.8 m/s to a run, past a 0.15 dead zone, curve 1.5) | W A S D, the arrows | left stick |
| Run (a key is a full push, the stick walks up to it) | W A S D, the arrows | left stick pushed all the way |
| Sprint (7 m/s) | Shift | A / Cross, or RT past halfway |
| Hold to a walk (1.5 m/s) | Space | X / Square |
| Look round (the same orbit as everywhere) | mouse drag, `;` mouse look, scroll | right stick |
| Get up after a fall | any walking control | any walking control |

Nothing on foot is a new control: the keys, sticks and buttons that steer, gas, boost and handbrake the car walk, run, sprint and hold to a walk
(`engine-walk-input.ts` reads the same `DRIVE_KEYS` and `PadState`; its rows pair every walking control with its driving twin).
Enter and B were free in the driving seat (`SEAT_KEYS.onFoot` in `engine-keys.ts`; `engine-keys.test.ts` keeps it clear of the scene keys).
While he is out, the seat's own keys (Space, R, Esc, Q, E, V, C, T and the pad's Back, LB, RB, Y and D-pad down) do nothing, so a stray press
cannot pause, reset or switch the car under him; Escape and Back still end mouse look and a menu as everywhere.

## Where it is offered, and why

Everywhere the player drives a car of his own, offline or online: the Fleet, a race (single, campaign, Survival, a room's), the derby, the Range's mini
games and the staged sandbox scenes (the press, pistons, doors, the stack, the corkscrew). Not in the garage, the lab or the showcase (no car of his to
leave), and not while a reel or clip is on screen, the game is paused or warming up, a scene is fading, or a race's menu is up (`CrashEngine.onFootOffered`,
the `available` of `OnFootHost`). He gets back into his own car only: the one he got out of. Another car's door is no door of his.

**What the rules see.** Nothing changes for them. A player on foot is a driver with his foot hard on the brake: the car he left stands on its brakes
(`brake: 1`, the `hold` input a racer waiting on a grid gets) and every rule reads that, not an empty seat.

- The walker writes nothing to a car. Not `driverOut` (that is a thrown-out driver: it rides the netplay snapshot and the highlight keyframes, makes
  the race's judge count the car a wreck and the HUD say DRIVER OUT, and the ejection watch skips the car), not `parked` (every drive call clears it), not
  the driver's door (an unlatched door at an angle is sim: the crash model hits it, and the clips record its hinge). The seated driver is left out of
  the draw (`SeatedDrivers.sync`'s `away`), and the door stays shut.
- `CrashEngine.fixedStep` holds the car the walker left (`onFoot.away`) with the brake input outside a race, and takes it out of the derby AI's and the
  wreck coast's loops, as it does the car the player drives. In a race the director holds it itself (`RaceHost.afoot`, `RaceDirector.drive`), and the
  rules count it a human's car: `judge` does not call it dead for standing still, `aiDrives` is false so the stall check never asks for its respawn, and
  the race AI never drives it. Its row stays racing, with every other rule as for any car at the wheel (a reset the player asks for, a bust, the finish).
- A derby's rules are the derby's: the player's car is alive while its drivetrain is. If his car is the last one alive he wins, on foot or not (the
  count-out clocks run on the car as they do on one at the wheel).
- The ejection watch judges the car as it always did; a driver it would throw is not there, so the dummy is not launched (`throwDriver` and the netplay
  `launchEjection` skip the car he left), while the recorder and the wire hear the event as before.
- A race's pause (Esc, Start) and a minigame's own keys stay theirs; R and the other seat keys do nothing on foot, as ever.

**Netplay.** The walker is local presentation: a peer sees the car, parked on its brakes on the host and coasting there while a client's input is idle,
and never a walker. Nothing on the wire changes (`NET_VERSION` stays), no snapshot or keyframe carries a dummy or a door, and the race recorder and the
reel keep recording the car's inputs as today. The dummies' world is per browser; `ragdolls.update`'s `authority` still gates only the glass.

A scene reset (the HUD's reset, a scene change, a race starting, a loop reset) empties the dummy world and puts him back in the seat; the loop's own
reset waits while he is out. A race that takes his car from him (he is put to spectating, his car is put away) ends the trip where it stands.

**His world.** He lives in this browser's dummies' Rapier world, never the worker's: starting him begins the run again there (a worker holding the
run's thrown drivers would not step him). A track's ground reaches 48 m round the patch built for him, so the patch is built again round him once
he is 24 m from its middle (`RagdollThrower.followWalkerGround`); a bounded scene (the derby, the Fleet disc) builds its fixed colliders for the
whole scene at his first step.

## The state machine

`present/onfoot-flow.ts` (rows in `onfoot-flow.test.ts`):

```
inCar --press, stopped, door clear--> exiting --0.8 s--> onFoot --press at a driver door--> entering --0.6 s--> inCar
```

Refusals, each with its prompt: the car is moving over 3 m/s (`Stop the car first`), another car, a lamp post or the edge of the ground (no ground a
metre round the spot) is within reach of the door, or the car is on its side or roof (`No room to open the door`), his own car's driver door is not
within 1.9 m (`Walk up to your car's driver door`); a press while exiting or entering is ignored. `engine/engine-onfoot.ts` carries out what the flow
decides: on exit the dummy is placed at the door in the player's own look and facing the car's way and the seat is stepped back (the car is the engine's
to hold, above); on entry he turns to the car, and after the climb the dummy leaves the pool and the seat takes the wheel (`seat.mode = "drive"`).

## The walker: a driven root and a powered ragdoll

`present/ragdoll-walker.ts` holds one `Walker` per pool slot; the player's is slot 3. Friction cannot give a body 12 m/s² (a run in 0.3 s) or 7 m/s, and the old open-loop
gait reached 1.3 / 2.5 m/s, so his root is driven the way a character controller drives a capsule, and the ragdoll is posed and powered to follow it
(onfoot-active-ragdoll, onfoot-rapier-ragdoll research):

- **The root** (`walker-locomotion.ts`). Speed along his facing rises at 12 m/s² to a run (3.5 m/s: 0.3 s) and at 4.5 m/s² on to a sprint (7 m/s: about a second); it falls at 14 / 10 m/s² (a run stops in
  0.25 s and 0.4 m, a sprint in under a second and 3 m). The facing turns at `10 m/s² / speed`, at most 8 rad/s, so a sprint curves wide and a walk turns on the spot, and he leans with his speed and
  acceleration and banks into a turn (onfoot-direction-change research): a heading under 30° off curves; 30-75° costs up to 30 % of the speed; past 75° he slows to a pivot's 2 m/s; past 120° he stops and
  turns; each band has 0.2 rad of hysteresis. A sprint turned 90° faces the new way in 0.8 s, 180° in 1 s, and is back at speed 0.9-1.3 s later.
- **The frame holds him.** A kinematic frame follows the gait's torso centre; the torso hangs off it by a joint whose three angular motors (60 kN·m/rad on his feet, 3 kN·m/rad in the get-up) and three linear motors
  (150 kN/m: a planted foot is locked, so the hip must be where the gait put it) hold it, with his weight and the root's push fed forward as a force on the torso. A torso held back more than 0.2 m (a wall) brings the root back to it and caps his speed there.
- **The gait** (`walker-gait.ts`, `walker-leg.ts`). Feet are set down in the world and stay there (a planted foot's target moves by under 1e-9 m) while the pelvis rides over them, then swing to where it will pass over the
  next spot; a stance share of 57.5 % at a walk, 38 % at a run and 22 % at a sprint gives a walk's double support (15 %) and a run's flight. The pelvis stands as high as its planted legs allow (the drawn torso bobs 2.4 cm at a walk, 4.4 at
  a run), each leg is a two-bone solve to its foot (hip swing, hip roll, knee; the knee's target follows the solve at 30/s, since near a straight leg a few mm of reach swing it tens of degrees), the arms swing fore-aft about the vertical against the legs (the opposite thigh's swing about its own mean, resting back by 0.6 of the lean) with the elbows
  held near a right angle running and never closing past 100°, so a hand travels from hip to chest height and never above the shoulder; the pelvis turns against the hips, the head levels against the lean (0.9 of it,
  its neck motors a little soft so it lags), and the motors lead their targets by the target's own rate. The gait reads the torso's actual orientation, not the commanded one, so the legs follow what the torso really does.
  Lean 4° at a walk, 8° at a run, 15° at a sprint plus the push of an acceleration, and a bank up to 26° in a cut. Cadence 126 / 180 / 300 steps a minute (research 100-130 walking, 150-210+ running; the sprint steps fast to keep its swing in the running range), steps ahead per speed, and braking steps reach out (natural-gait research).
  The feet roll (`walker-rocker.ts`): heel strike, flat, then the heel rises onto the toe, so a stance rolls over the foot instead of the hip swinging the whole stride. Hip swing per cycle (peak to peak, walk / run / sprint) 41 / 65 / 62° (research 30-45 walking, 50-70 running).
  The drawn hands keep the mesh's own shape (no finger bones to curl). A swing foot within 3 cm of the ground carries the pelvis (`allowedHeight`) only while it is within 0.5 m of the hip: a foot reaching further for a landing it has not made (the turn of a run reversed) would fold the planted leg under him to keep the pelvis at its reach.
  **Coming to rest.** Under 0.15 m/s and 0.4 rad/s he is still: the cycle no longer lifts a foot on its clock, only a foot more than 5 cm from where a standing foot goes (beside the pelvis) lifts, one at a time, and swings home over 0.4 s; the soles lie flat (a foot that had rolled onto its toe turns on its heel again), and once both are home and planted the cycle is parked. A walk stops standing in about 0.2 s, a run in 0.6 s. (Before, the clock kept lifting a foot every half cycle and the two were never home and on their heels at once, so after any walk, even a 0.2 s tap, he stepped in place for good; and a walker seeded again kept the last trip's toe pivot and pitch.)
- **The feet** are 0.25 m boxes from heel to toe, the heel 0.03 m behind the ankle; the shins end at the ankle. A foot is 5 kg, 2.5 times water's density (a foot of water under a shin four times its mass was pressed 5-6 cm into the ground at the Range's landings, and lighter feet left a throw at the high jump's net sitting up against it), and the shin is lighter by as much, so shin and foot together weigh the footless shin's 9.45 kg: a throw carries the mass it was tuned on. The skin and a shoe over the ankle blend shin to foot alike (`ankleShare`), so no ankle bend pulls one through the other.
- **Planted feet are locked** (`walker-feet.ts`). A foot the gait has set down is held by its sole's pivot (the heel, then the toe as the foot rolls) to a kinematic anchor with three linear motors (100 kN/m, 2.8 kN·s/m) that come on over 2 frames after the touchdown and let go the moment the gait lifts it, in every state but standing (the get-up and a fall free both).
  The motors, not friction, keep it still: before the lock the leg's own motors chasing the gait made the footless shin slide 0.22 / 0.47 / 1.06 m/s at a walk, run and sprint; the rows hold the sole's pivot under 0.1 / 0.1 / 0.2 m/s on average (`ragdoll-walker-pace.test.ts`). The lock is softer than the torso's hold (150 kN/m) on purpose: at 1 MN/m it took up every mismatch between the gait and the legs in the torso, which sagged 5-8 cm off its root, and the hit read below took that for a blow (3.8 of the 4 m/s that knock him down in every stand-up turn: 10 of 64 pushed-onto-his-back runs and 8 of 48 run-and-reverse runs fell, against 0 of 16 pushes before the feet).
- **Hits.** His torso moving more than 1 m/s differently from the root that holds it takes strength in proportion (the motors weaken and he stumbles); past 4 m/s he is knocked down, and a wall ahead of him does
  not count (it only stops him). The stiff hold takes a blow's speed out of the torso within a frame, so the read is the torso's speed relative to the root plus the hold's spring rate (√(150 kN/m / 100 kg) = 39/s) times how far it is displaced. Past a 60° tilt or under 0.75 m he has fallen and goes limp (8 % of the limb stiffness, no balance). A car at 4 m/s or more that meets him (`runsDown`) throws him with the lawn
  guards' and the VIP's launch (`fell`, in `scenes/figure-strike.ts`): the car's velocity with a lift, a kick to the side of its centre line and a tumble, ignoring that car for 0.35 s.
- **Getting up.** Unchanged: once he has lain still for a second and the player presses a walking control, he funnels into one of three routes by how his torso lies (`walker-getup.ts`): *feet down* regrounds; *face down*
  pushes up to hands and knees, kneels, rises; *face up* rolls onto his stomach first. Laid on his side, his feet tip him onto his stomach as he settles, so he takes *face down*. Stages are poses, a frame lean and a height, the limb motors ramp from limp over half a second, and a bounded
  lift carries the torso. It takes 2.3 s from the stomach and 3 s from the back after the second's lie, and then the root is seeded where he stands (`enterStand`): he runs at 3.15 m/s within 0.6 s of standing.
- **Cost.** Rapier steps 1/480 s inside the ragdoll system's own world (inline, never the worker's, in every scene, so the pad and keys reach the motors the frame they are read). Measured on the node probe,
  60 Hz frames: 0.034 ms a Rapier step and 0.28 ms a frame with the walker out, against 0.039 and 0.34 ms before; the gait and root cost under 0.01 ms a frame. A car near him is a kinematic proxy of its cage there, so a
  car that runs him down is the same one the sim moves (`ragdoll-walker-car.test.ts` drives a car through him and holds its sim state bit for bit against the same drive without him).

### Measured, before and after (node probe, flat ground)

| | Before | After |
|---|---|---|
| Walk / run / sprint (m/s) | 1.33 / 2.50 / none | 1.51 / 3.51 / 7.00 |
| 90 % of the speed | walk 1.23 s, run 1.40 s | walk 0.3 s, run 0.43 s, sprint 1.03 s |
| Stop | walk 0.77 s / 0.74 m, run 0.95 s / 1.45 m | walk 0.3 s / 5 cm, run 0.6 s / 0.4 m, sprint 0.8 s / 1.9 m |
| Drawn root speed, steady (std) | walk 0.27, run 0.42 (20 %, 17 %) | walk 0.08, run 0.12, sprint 0.11 (5 %, 3 %, 2 %) |
| Pelvis bob (range) | walk 8 cm, run 11 cm | walk 2.4 cm, run 4.4 cm, sprint 4.0 cm |
| Planted foot's speed over the ground (mean) | not planted-locked: walk 0.22, run 0.47, sprint 1.06 m/s | walk 0.024, run 0.052, sprint 0.077 m/s |
| Hip swing, peak to peak (gait target / physical thigh) | walk 54 / run 77 / sprint 96° | walk 44 / 42, run 64 / 61, sprint 65 / 66° (research 30-45 / 50-70) |
| Turn rate | 4.1 rad/s cap, no speed loss | by band; 90° at a sprint 0.82 s, 180° 0.98 s, no fall (tilt under 26°) |
| Get-up (from the first ask) | stomach 2.3 s, back / side 3.0 s | unchanged |
| Knocked down by a 1200 N·s blow | down at 0.7 s, up at 5.45 s | down at once, up at 4.4 s |
| Rapier step / frame | 0.039 / 0.34 ms | 0.034 / 0.28 ms |

## The camera

`OnFootDirector.aim` drives the one `ChaseCamera` orbit (no second camera system): the focus is 1.5 m up his chest (`PIVOT_OVER_TORSO`) and the eye `FOLLOW_RADIUS` 4.2 m back at 17°, with a 66° view across
(`followFov`), per the onfoot-camera research. The focus follows him critically damped (`walker-camera.ts`: 0.3 s walking, 0.12 s running; his height with 0.35 s, so the pelvis's bob reaches the screen at under a
quarter), the view comes back behind him after 1.2 s without look input while he moves faster than 1 m/s (0.4 s damped yaw), the scene's solids pull it in at once and let it out slowly (`EyeClear`), and stepping out takes
the camera from the car's chase over 0.3 s (the orbit adopts its pose; distance, pitch and lens ease). While he climbs back in the focus moves to the car and the camera draws back 35 %, and sitting down hands over to the car's chase cam.

## The showcase

`#scene=showcase` (by link only) runs the same walkers. A press on a figure now lands where you clicked (the garage's spray can uses the same
`DummyMesh.raycast` hit point) and pushes along the way the camera faces, instead of always throwing him straight back: the part under the
click (a hand, a shin, the head, the torso) is sent at 6 m/s along the camera's facing (with a small lift), and the torso is given
the spin of the lever from its centre to the click, so a high shove on one shoulder turns him and a blow low on a leg swings the legs out from
under him (`ragdoll-hit.ts`, rows in `ragdoll-hit.test.ts`). He goes limp, lies for a second, gets up, walks back to his mark, turns to his old
facing, and the set takes him back as he stood (`engine/showcase-walks.ts`). A press on a dummy that is already away (in the air, lying, getting up or
walking home) knocks him again where he is, and his way home starts over. A press picks the body as it is drawn (`DummyMesh.raycast` skins the
triangles a slot draws from its part poses, so a swung arm or a flung leg is picked where you see it, and the garage's spray can reads the same hit). The pool holds four: a fifth press sends the one longest away home
at once. A reset (R) stands everyone up as before. The scene's old self-reset (its parked car, off the rim, left the sim and the Fleet's
"disc is empty" rule rerolled the scene a few seconds later, standing everybody up) no longer fires there.

## Known gaps

- No seat blend or climb: he stands at the door for the 0.6 s entry and then is in the car; he appears at the door on the way out. The door stays shut
  (it is sim, above), and the player's own driver is never drawn in his car (`driver-look.ts`).
- His own car's driver door only, no passenger doors, no climbing in a window; another car, even a parked one, is not his to get into. In a minigame
  whose attempt needs the car moving, stepping out ends that attempt as stopping would.
- The walker walks into car bodies like any dummy (cars are kinematic boxes in the dummy world): walk round to the door.
- On a race track he stands in the road: the rivals and the traffic run him down like anything else there (that is the game), and his car is
  held where he left it, so it stays in the way too. Standing out for long enough that the race is over for his car ends nothing: his row finishes
  as a car with its brakes on does.
- The get-up is assisted (above) and does not read the ground's slope or lean on a wall; on a ramp he gets up as on the flat.
- A thrown driver and a person run down elsewhere still use the old, unmotored dummy.
- The pad: B is the only control that is free on every pad. A touch screen has the **Out** / **In** tap beside Boost (`CONTROLS.md`); the HUD's prompt line
  shows only on desktop, and on touch only a refusal's reason shows, beside that tap.

## What pins it

- One row per mode family, on the real engine (`engine-onfoot-{fleet,race,derby}.test.ts`, over `engine-onfoot.test-util.ts`'s rig): get out, walk, be run
  down by a car, get up, walk back, get in, drive again. The race row holds his car 9 s on foot (past the 8 s still-death) and reads its row still
  racing, `driverOut` null, no respawn, the HUD without DRIVER OUT, Esc the race's pause. The derby row crowns his car while he is on foot. The fleet
  rows add that another car's door is refused. Shown red against: the old fleet-only, offline-only gate (race and derby red), the race never hearing
  he is out (the race AI drives his car to the finish), any car's door letting him in (fleet red).
- Touch: the fleet rows tap the HUD's Out / In (`tapOnFoot`: out on one poll, the strip's gas walks him, in at his door) and find no button where Enter does
  nothing (a thrown driver, the seat only following). `engine-walk-input.test.ts` walks each scheme's thumbs forward, back and sideways, and runs only
  from the strip's Boost cap. Red against: the tap on another pad bit, the HUD's foot read ungated, the touch pedals not read as the forward axis, RT from
  the touch gas running him, Easy not drawing the strip on foot. A tap on a rolling car leaves him in with "Stop the car first" as `FootHud.refusal` (the
  prompt's own words), gone 2.5 s later; red against a HUD read without the refusal.
- `ragdoll-walker-car.test.ts`: a car driven through the spot where his walker stands, and again where nobody does; the car's position, velocity and
  every mass match bit for bit (`assertSameNumbers`). Red against a walker that shoves a car it is near.
- `ragdoll-walker-ground.test.ts`: starting the walker puts a run the worker held into this thread's world (red without the pin), and his ground patch
  is built again only once he is 24 m from its middle (red when it is rebuilt at 10 m).
- `onfoot-doors.test.ts` (own car's reach; room on any ground, not the disc's radius), `seated-drivers.test.ts` (the car left on foot has no driver
  drawn), `drive-keys.test.ts`, and the lane's rows: `onfoot-flow`, `engine-walk-input`, `ragdoll-walker`, `ragdoll-walker-getup`, `ragdoll-hit`,
  `ragdoll-mesh-pick`, `showcase-walks`.
- Unmoved by it, and run before and after: `whole-digest`, `replay-fidelity`, the race and derby result rows, the net codec and wire rows.
- The speed lane's rows, each shown red against a mutant (a 4 m/s² push, no pivot or stop band, a planted foot that rides with the root, an unsmoothed focus and no recenter delay):
  `walker-locomotion.test.ts` (time to speed, stops, 45 / 90 / 180° cuts at a sprint, hysteresis, lean and bank), `walker-gait.test.ts` (planted feet do not move
  by 1e-9 m, flight at a run, joint ranges, pelvis steps), `ragdoll-walker-pace.test.ts` (the physical walker: speed, time to 90 %, drawn-speed steadiness, planted-foot slide,
  stops, cuts), `ragdoll-walker-getup.test.ts` (time to stand from four lying poses, running again within 0.6 s, a car at 4.5 m/s), `walker-camera.test.ts`, `engine-walk-input.test.ts`.
- The foot-lock and stride lane's rows (`ragdoll-walker-pace.test.ts`: planted-foot slide under 0.1 / 0.1 / 0.2 m/s on average at a walk, run and sprint, red with the lock's stiffness at its floor; the physical thigh's swing 30-45 / 50-70 / 50-70°; `walker-gait.test.ts`: the gait's hip swing in the same ranges, red against the old lift shape and cadence; the knee-step rows, red without the knee's ease; `ragdoll-walker.test.ts`'s car blow, red with a stiff hold and the old velocity-only hit read).
- The stand-up and turn-about rows: `ragdoll-walker-getup.test.ts` (a figure pushed from in front onto his back, man and woman: he lies, is asked up, rolls over and walks off the way his feet pointed with no stumble, strength never under 0.3; six of the eight cases red against the old 1 MN/m lock and all eight with that lock alone put back) and `ragdoll-walker-pace.test.ts` (a figure runs 9, 10 and 11 feet and the stick is pulled straight back: through the turn and the 3.5 s after he never goes down, sinks under 0.9 m, tips past 35° or stumbles; four of the five cases red against the old lock and swing foot, and the sinking bar red against a swing foot that carries the pelvis at any reach alone).
- The rest rows: `engine-onfoot-idle.test.ts` (the real engine, a woman and a man: tap forward 0.2 s, tap sideways 0.5 s, walk 2 s, or walk and reset mid-stride and get out again; let go, and after 1 s at zero input over 3 s no foot steps, no sole rises over 1 cm, no foot drifts over 2 cm and the gait is parked; red on all eight against the clock-driven cycle with no home test: 10 steps in 3 s, soles up to 9 cm, feet 10 cm over the ground) and `walker-gait.test.ts` (a gait walked, run and sprinted then asked to stop stands within 1 / 1 / 1.5 s and never steps again).
