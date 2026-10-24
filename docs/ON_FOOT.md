# On foot

The player gets out of the car, walks and runs as the crash-test dummy, is knocked down by a car, gets up, and gets back in. The
walker is an active ragdoll: the same ten Rapier boxes and nine joints as a thrown driver (`present/ragdoll-body.ts`), held up by
joint motors, not a second animated mesh. The same walker, one per pool slot, stands the showcase's figures up again after a press
knocks them over ([The showcase](#the-showcase)).

## Controls

| Action | Keyboard and mouse | Controller |
|---|---|---|
| Get out of your car (driving, stopped or under 3 m/s, driver door clear); get back in (on foot, at your own car's driver door) | Enter | B / Circle |
| Walk, relative to the camera | W A S D, the arrows | left stick |
| Run | Shift | A / Cross, or RT past halfway |
| Look round (the same orbit as everywhere) | mouse drag, `;` mouse look, scroll | right stick |
| Get up after a fall | any walking control | any walking control |

Nothing on foot is a new control: the keys, sticks and triggers that steer, gas and boost the car walk, run and look
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

## The active ragdoll

`present/ragdoll-walker.ts` holds one `Walker` per pool slot; the player's is slot 3.

- **Balance.** The torso hangs off a massless kinematic frame by a joint whose three angular motors are a virtual gyro: stiffness
  3000 N·m/rad, damping 600 N·m·s/rad, force-based motors, reaction taken by the frame. Standalone Rapier probes (101 kg dummy, 4 s): a
  40 N·m·s twist, and every one up to 320, straightens him (worst tilt 21° at 320); with the gyro off, 40 topples him. The frame turns to the
  heading the player asks for (4 rad/s), and he faces before he walks.
- **Gait.** Limb motors chase a gait from `walker-gait.ts`: thigh swing, knee flex through the swing phase, arms against legs, a lean over
  the stance foot. Nothing pushes him along: the legs walk. Walk 1.3 m/s, run 2.5 m/s (open-loop; the browser run measured 1.31 and 2.52 m/s
  commanded, and the test rows take 0.8 to 2 and 1.6 to 3.6). A stick pushed less than all the way walks slower, down to 0.8 m/s.
- **Hits.** A frame in which his speed changes by more than 1 m/s drops his motors' strength in proportion; past a 60° tilt or under 0.75 m
  he has fallen and goes limp (8 % of the limb stiffness, no balance). A car at 4 m/s or more that meets him (`runsDown`) throws him with the
  lawn guards' and the VIP's launch (`fell`, in `scenes/figure-strike.ts`, shared with `lawn-guard.ts` and `people.ts`): the car's velocity
  with a lift, a kick to the side of its centre line he stood on and a tumble, ignoring that car for 0.35 s.
- **Getting up.** Once he has lain still for a second and the player presses a walking control, he funnels into one of three routes by
  how his torso lies (`walker-getup.ts`): *feet down* (torso within 60° of upright) regrounds; *face down* pushes up to hands and knees,
  kneels, rises; *face up* (and on his side) rolls onto his stomach first and then goes the same way. Each stage is a pose for the limbs, a
  lean of the torso's frame and a height, eased from the stage before; the limb motors ramp from limp to full over half a second, so the limbs
  converge on the pose; a bounded lift (70 % of his weight, never more than 1.25 weights) and the frame's lean carry the torso while the
  hands, knees and feet push on the real ground. He stands facing the way his head pointed. A get-up that ends short of upright drops him
  again and he retries. The whole thing takes 2.2 s from the stomach and 2.9 s from the back, and it is assisted: the frame and the lift
  are not limbs, so what you see is an animated-looking recovery driven through real contacts, not a gait the physics discovered.
- **Cost.** Rapier steps 1/480 s inside the ragdoll system's own world (inline, never the worker's, in every scene); a standing walker is awake,
  so the world steps while he is out. A car near him is a kinematic proxy of its cage there, so a car that runs him down is the same one the sim
  moves (`ragdoll-walker-car.test.ts` drives a car through him and holds its sim state bit for bit against the same drive without him).

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
- The pad: B is the only control that is free on every pad; on a touch screen there is no on-foot control yet (the HUD's prompt shows only on
  desktop).

## What pins it

- One row per mode family, on the real engine (`engine-onfoot-{fleet,race,derby}.test.ts`, over `engine-onfoot.test-util.ts`'s rig): get out, walk, be run
  down by a car, get up, walk back, get in, drive again. The race row holds his car 9 s on foot (past the 8 s still-death) and reads its row still
  racing, `driverOut` null, no respawn, the HUD without DRIVER OUT, Esc the race's pause. The derby row crowns his car while he is on foot. The fleet
  rows add that another car's door is refused. Shown red against: the old fleet-only, offline-only gate (race and derby red), the race never hearing
  he is out (the race AI drives his car to the finish), any car's door letting him in (fleet red).
- `ragdoll-walker-car.test.ts`: a car driven through the spot where his walker stands, and again where nobody does; the car's position, velocity and
  every mass match bit for bit (`assertSameNumbers`). Red against a walker that shoves a car it is near.
- `onfoot-doors.test.ts` (own car's reach; room on any ground, not the disc's radius), `seated-drivers.test.ts` (the car left on foot has no driver
  drawn), `drive-keys.test.ts`, and the lane's rows: `onfoot-flow`, `engine-walk-input`, `ragdoll-walker`, `ragdoll-walker-getup`, `ragdoll-hit`,
  `ragdoll-mesh-pick`, `showcase-walks`.
- Unmoved by it, and run before and after: `whole-digest`, `replay-fidelity`, the race and derby result rows, the net codec and wire rows.
