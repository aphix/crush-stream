# Stretched panels, flap, door pendulum, frame parity

Hinged body parts (quarter panels, arch flares, a hanging bumper) and open doors react to the wind, to the car's own
acceleration and to whatever touches them. All of it is a function of the car's relative motion and the contact. Code:
`vehicle/car-wear.ts` (the laws), `car-parts.ts` (the rules that use them), `car-panels.ts` (shell geometry),
`contact/door-contact.ts` `hitPanel` (the striker against a panel, reached through `partContact` in `external-contact.ts`), `scenes/door-rig.ts` (Doors scenes D and E).

## Stand-off cap

A quarter panel peels about the vertical hinge line at its tail. Its peel angle is cut so the free end stands at most
`STAND_MAX` = 0.4 m off the body at hinge value 1 (`PanelRegion.peel = asin(STAND_MAX / reach)`, reach 1.33 m on the sedan,
0.30 rad). It was a fixed 1 rad: 1.20 m on the 80 km/h rear offset hit. The stand-off in metres is reach · sin(peel · t); an arch
flare flaps out 0.16 m at most.

## Stretched panels are easy to break

A quarter panel or arch flare hinged to `PANEL_FRAGILE_T` = 0.5 (a quarter panel: 0.2 m off) is *stretched*. In
`evaluateBreakage` it comes off on

- a **fresh contact**: whatever feeds `deform.notifyContact()` (wall, car, prop, ground rig) after a quiet pause of 0.15 s
  (`TOUCH_GAP`). The crash's own continuing contact does not count; the next touch does;
- a **scrape** (quarter panels only; an arch flare's box includes the sill, which the body sinks to the road on its own): its box reaches the ground under it. The box is the shell on the body’s REST skin bent to its hinge value, carried by the car’s pose and class lift (`shellBox`): sim state only. The drawn shell (the skin’s solve, which a camera’s view cone and the frame rate decide, the suspension’s heave, the flutter) once decided it, and a replay that drew at other times than the live sim tore the panel one step off (city seed 5, a car-to-car door and panel contact lost).

A bumper is not torn by contact timing: a torn bumper changes the crash hulls, which a headless replay re-simulating from a keyframe could
not reproduce (tried: it moved a replayed first impact out of the 0.2 s window). It wears off in the wind like the panels.

The Doors-scene strikers (below) take a stretched panel at a nudge (`PANEL_FRAGILE_J` = 15 J).

## Flap and wear in the wind

`flapAmp(speed, hingeT)` = 0.3 rad · min(1, v/40 m/s)² · min(1, hingeT/0.25): zero at rest, ∝ v². Each car keeps one flap
clock turning at (3 + 0.2 v) Hz; a part beats it at its own phase (its rest spot's) with `flapWave`, a 0..1 two-beat wave (a
part lifts off its body and settles, it never folds into it). No random draw: speed, time and part only.

- quarter panel / arch flare: the whole shell mesh turns about its hinge line (`flutterShell`, a transform: **no vertex rebuild,
  no upload**); a quarter about the vertical line at its tail, an arch flare about the line along z at its top;
  an arch flare's free ends also drop (`FLAP_DROP` 4 cm × hinge value) and flap out (`FLAP` 16 cm × hinge value, out of the body side) only as far toward the road as it lets
  them (`poseShell`, `roadLift`): 5 mm (`SHELL_CLEAR`) over the plane of the ground's height and normal under its middle, along that normal, however the car lies
  (its drop on its wheels; the flap out of the flank of a wreck lying on its side, which hung 10-14 cm into the road with the monster's front-left arch
  on a 5° slope); a point whose body skin is already in the road keeps to the skin (a sedan wreck drew its flap 4.2 cm in the road). Drawn only:
  the held shell is re-posed as the car moves over the road, and torn off it leaves bent as its hinge alone bends it, the pose
  replays already throw (`detachPart` poses it free);
- hanging bumper: its roll about the corner it hangs by grows by the flutter.
  The bumper's box stays 4 cm (`BUMPER_CLEAR`) above the ground under it: a bumper hangs rolled about its corner up to
  `BUMPER_ROLL` = 0.6 rad, cut (by halving, `hangBumper`) to the roll at which its free end rests on the road (a sedan's bumper rides
  ~0.16 m up: a few degrees, where 34° put the end 0.4-0.6 m under the road in the flagged clips E5YE-TN78, PPP0-2DJK and YYR3-TWJ4),
  or lifted when the crush has already brought it to the road. A torn bumper leaves in that pose (REPLAY_VERSION 77).

`windWear(speed, hingeT)`: above 80 km/h (`FLAP_TEAR_MPS`) a hinged part wears (`fatigue` 0..1, off at 1) at
(v/22.2)² / 6 s, scaled by min(1, hingeT/0.25); a stretched part at (v/22.2)² / 1.5 s. Below 80 km/h it recovers. The clock and
the wear are host-side; the flutter is cosmetic (netplay clients and replays shake the parts they draw by the same law from
the interpolated speed, `flutterParts` in `netFrame`).

## Door pendulum

An unlatched door is a uniform slab hinged at (±0.86, 0.55) swinging along u = (sx sin θ, −cos θ). The car-frame pseudo force
F = −a + ω² p − α × p gives its opening acceleration (`swingAccel`): braking (a_z < 0) swings it forward (open), accelerating
shuts it, the outside of a turn opens it, the inside shuts it; a shut door has no torque from braking. a is the change of the
car's velocity since the last sample, rotated into the car frame and capped at 1.5 g (a crash's spike saturates; the crash rules
C1 tear or spare a door), α the same for the yaw rate. Hinge friction: 0.8/s viscous plus a dry detent: a door's holds it against a
car-frame push of up to 0.76 m/s² across its slab whatever its length (`DOOR_DETENT_ACC`, as the swing it drives: 3/(2L) rad/s² per
m/s²); a lid's is 2 rad/s² (`LID_DRY`), so a jostle leaves either hanging. Turned any way, a car's door swings the same.

**Wind on an open door or lid** (`windPush`): the panels' airflow, `WIND_PUSH_MAX` 80 m/s² × min(1, v/40 m/s)² × `flapWave` at the
part's flutter phase (the beat's mean is half the peak), pushes it rearward along the car (forward when it reverses), added to the
fore-aft drive as the pseudo force of a forward acceleration. At 30 m/s it swings a 35° door shut and latches it and swings a sedan's
deck lid more than halfway shut, flapping about 6 times a second; at walking pace it moves nothing. The air is not carried with the
car, so a car carried at a steady 30 m/s no longer swings its door as one at rest does. An uncrashed car's flap clock turns in
`swingHinges` (a crashed one's with its crash rules).

The door ends on the check-strap stop (`loadDoorStop`), on its crash jam, or in the latch: `closeSwing` is the one rule for
reaching shut, used by the car's own swing and by the Doors ram alike (latched below `SLAM_TEAR_J`, wrenched off above it). A
crash jam that leaves the free edge within `LATCH_REACH_M` (5 cm: the striker's play and the seal's squeeze) still latches; a
deeper one stops it unlatched. Only fresh crush (the hinge value rising) springs a latch, so a part latched again over an old dent
stays latched.

A door a **side hit** opens past `DOOR_AJAR` is sprung (`springSwing`): unlatched, hanging at least as far open as its crash
jam (`hingeT × 1.45`, which it can never shut past), swinging with the car. Frontal and rear hits still only jam it ajar,
latched (C1).

The trunk lid, hatch, liftgate and drop gate swing on the same hinge once a rear hit springs them, and the hood once a front hit
does, turning about car x with their own law (`lidAccel`: weight under gravity plus the car's vertical acceleration, struts,
fore-aft acceleration and wind; [`DOOR_RIG.md`](DOOR_RIG.md), Lids). The vertical acceleration is not capped: a landing's jolt
on the wheels, which no contact rule reads, weighs an open lid down (a sedan's deck lid dropped 0.3 m dips and rises back, from
2 m swings to 14° of shut and rises back on its torsion bars, from 2.5 m latches; a hatch latches from 2 m; a drop gate is
pressed onto its cables).

## The Doors scene: panels (D, E) and frame parity

- **D `panelPush`** (key 6): a quarter panel stands out at hinge 0.45; the ram runs rear→front and pushes it back onto the
  body. **E `panelPull`** (key 7): the ram runs front→rear into its free end and pulls it open. The panel is the door's mirror
  image: hinged at the tail, free end ahead, so the directions are swapped.
- `hitPanel` is in `partContact`, the contact a car passing alongside meets too. The slab goes where the face pushes it; the striker
  pays the plastic work `PANEL_BEND_NM` (36 N·m) × the angle moved; no rebound. Pushed back, the panel keeps its dent
  (`bendPanel` sets `hingeMax`: the crash target cannot raise it again, and it is never flat: `PANEL_SMUSH_MIN` = 0.1). Pulled
  out it opens to full hinge and holds. A striker carrying more than `PANEL_SLAM_J` (150 J, pushed back), `PANEL_PULL_J` (60 J,
  pulled out) or, once stretched, `PANEL_FRAGILE_J` (15 J) tears it off.
- **Frame parity**: `DoorRig.carMoves` parks the ram in the world and drives the car at it at the shot's speed. Both ways reach
  the same `partContact` with the same relative velocity: `door-frame.test.ts` tables every scenario × both directions × {ram
  moves, car moves} × both sides, and drives the contact with a world-fixed box and real car positions.

## Police light bar

The bar is a hinged part (`hinge: "bar"`, `hingePose` in `part-pose.ts`, the one pose the drawn mesh and the cage both take). It stands on two
feet 0.8 m apart across the roof, skinned with the roof cage, so its feet ride the crushed skin; the hinge is a **horizontal line along its
base, across the car** (axis x), on the edge the car's inertia sends it toward (a nose hit tips it forward, a tail hit back; `impactInward.z`).
The hinge edge of both soles stays put and the other edge rises, like a door's free edge: the free edge lifts `0.18 m × sin(0.45 · hingeT)`,
7.5 cm at the last hinge value (0.95). A clamped pair of feet can fold only on that line (a turn about one foot, along the car, lifted the far
end 0.35 m off the roof). The hinge value is the crash target `max(roof sink / 0.12 m, hit EBS / 60 km/h)`, at most 0.95 (`barLoad`).
It shears off at 1: the roof mass 0.12 m under its rest height, or a hit at 60 km/h EBS (`BAR_TEAR_SINK`, `BAR_TEAR_MPS`), and is then a
loose part (`stepLoose`) with its sirens dark. `light-bar.test.ts` holds the hinge line, both edges' gap to the roof skin through a 56 km/h
crush, the shear depth and the replay's bits.

## Sim state and versions

Netted already: `hingeT` (also a smushed panel's), door `theta` and latch, part flags. A part with no swing leaves two of its
three hinge slots free; they now carry `fatigue` and `1 − hingeMax` (0 = uncapped, so old data reads as before), so a keyframe
restores the wear and the dent cap. Not carried: the flap clock (cosmetic), the contact timing and door motion sample (re-read from the
restored deform and velocity, `restoreWear`). No layout change: NET_VERSION 8 and REPLAY_VERSION 6 stay.

Lids: the trunk slot (3) now has a swing, so its two free hinge slots carry the lid's `theta` and 0 (were `fatigue` and
`1 − hingeMax`, always 0 for it) and part flag bit 4 its latch. Same layout, new meaning: a NET_VERSION bump (it rides the car
rig's combined bump) and a REPLAY entry (lids swing, spring, re-latch and tear; a part resting on its stop takes no strap load; the
lid's crash hinge runs on rear crush).

The hood slot (2) now has a swing too: its two free hinge slots carry its `theta` and 0 and flag bit 4 its latch (NET_VERSION 40). A
keyframe's part state carries the door-swing sample's vertical velocity and drive (`motion[3]`, `swingDrive[4]`) and the flap clock,
which the wind on an open door or lid reads.
