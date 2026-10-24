# On foot

The player gets out of the car, walks and runs as the crash-test dummy, is knocked down by a car, gets up, and gets back in. The
walker is an active ragdoll: the same ten Rapier boxes and nine joints as a thrown driver (`present/ragdoll-body.ts`), held up by
joint motors, not a second animated mesh. The same walker, one per pool slot, stands the showcase's figures up again after a press
knocks them over ([The showcase](#the-showcase)).

## Controls

| Action | Keyboard and mouse | Controller |
|---|---|---|
| Get out of the car (driving, stopped or under 3 m/s, driver door clear); get in (on foot, at a car's driver door) | Enter | B / Circle |
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

Only in the offline Fleet scene: `sceneId === "fleet"`, no netplay room (`net.role === "off"`), no reel or clip on screen, not paused, not
warming up (`OnFootHost.available`, wired in `engine.ts`). The HUD's `foot` field is null elsewhere, so the prompt and the key line never show.

Why that is safe: the Fleet records nothing (`CrashRecorder` belongs to the race director; the highlight reel and the replay clips are
race-only; no netplay snapshot carries a dummy), so an extra dummy cannot desync or corrupt a recording. The dummy's world reads the sim and
writes back one thing, `car.hitGlass` on a pane his torso strikes at 4 m/s or more, which is cosmetic (`ragdoll-trigger.test.ts` holds the sim
state bit-identical with and without strikes). The walker itself adds no write to the sim beyond two flags on the car he leaves: `parked`
(its tyres grip, so it does not coast off the disc) and `driverOut = "doorR"` (the ejection watch skips a car with nobody in it; a hard hit
would otherwise throw a driver who is not there), and its driver door's pose (`setDoorOpen`, drawn only). `REPLAY_VERSION` and `NET_VERSION`
do not move.

A scene reset (`R` is dead on foot; the HUD's reset, a scene change, a loop reset) empties the dummy world and puts him back in the seat. The
loop's own reset waits while he is out.

## The state machine

`present/onfoot-flow.ts` (rows in `onfoot-flow.test.ts`):

```
inCar --press, stopped, door clear--> exiting --0.8 s--> onFoot --press at a driver door--> entering --0.6 s--> inCar
```

Refusals, each with its prompt: the car is moving over 3 m/s (`Stop the car first`), another car, a lamp post or the rim of the ground is within
reach of the door (`No room to open the door`), no driver door within 1.9 m (`Walk up to a car's driver door`); a press while exiting or entering
is ignored. `engine/engine-onfoot.ts` carries out what the flow decides: on exit the dummy is placed at the door in the player's own look and
facing the car's way, the car is parked, `driverOut` set and the seat stepped back; the driver's door swings open by its existing pose and shuts
once he has walked 4 m from it; on entry the door opens, he turns to the car, and after the climb the dummy leaves the pool, the door shuts,
`driverOut` clears, the car is unparked and the seat takes the wheel (`seat.mode = "drive"`).

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
- **Cost.** Rapier steps 1/480 s inside the ragdoll system's own world (inline, not the worker, in the Fleet); a standing walker is awake,
  so the world steps while he is out.

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

- No seat blend or climb: he stands at the door for the 0.6 s entry and then is in the car; he appears at the door on the way out. The seated
  pose in `people.ts` is hand-posed for the VIP only, and the player's own driver is never drawn in his car (`driver-look.ts`).
- Only the player's own car and any other car's driver door, on the Fleet disc; no passenger doors, no climbing in a window, no other scenes.
- The door is the existing pose, not a collider, and the walker walks into the car's body like any dummy (cars are kinematic boxes in the
  dummy world): walk round to the door.
- The get-up is assisted (above) and does not read the ground's slope or lean on a wall; on a ramp he gets up as on the flat.
- A thrown driver and a person run down elsewhere still use the old, unmotored dummy.
- The pad: B is the only control that is free on every pad; on a touch screen there is no on-foot control yet (the HUD's prompt shows only on
  desktop).
