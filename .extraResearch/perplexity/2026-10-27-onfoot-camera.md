> Question: How do third-person action games with both on-foot and driving (GTA V, Red Dead Redemption 2, Watch Dogs, Mafia) set up the on-foot camera: follow distance, height over the shoulder, field of view, camera lag/smoothing (spring arm), auto-recentering behind the character, and how the camera transitions when entering or exiting a vehicle? Give concrete numbers (metres, degrees, seconds) where known, with sources, plus design advice for a third-person follow camera on mobile touch and gamepad.

Exact camera values for commercial games are rarely published, and the available public material is uneven. The strongest conclusion is that **GTA V, RDR2, Watch Dogs, and Mafia use authored camera rigs with several selectable distances and context-specific offsets**, not one universal “third-person camera” setting. Treat the figures below as measured approximations or implementation references, not confirmed internal source values.

## Approximate camera setups

| Game | On-foot distance and height | FOV | Lag, recentering, and vehicle transition |
|---|---|---|---|
| **GTA V** | Common gameplay-camera recreations place the pivot around chest height, roughly \(1.4\)–\(1.6\) m above ground, with a follow distance near \(4\)–\(5\) m. One GTA-style implementation explicitly uses \(4.5\) m distance and \(1.6\) m height, though this is a recreation rather than Rockstar documentation.[2] | No authoritative public gameplay value. A practical approximation is about \(60^\circ\) horizontal-equivalent gameplay FOV, with a narrower aiming view. | Strong position damping and collision push-in are characteristic. GTA V exposes separate camera contexts for on-foot, car, bike, boat, aircraft, helicopter, and submarine, confirming that rigs are context-specific.[1] Vehicle cameras sit farther back—roughly \(6\)–\(9\) m in a GTA-style recreation—and commonly lag behind vehicle heading and recenter after inactivity.[2] |
| **Red Dead Redemption 2** | The game provides close, medium, and far third-person distances rather than a single fixed distance.[8][10] Exact metres are not officially documented; visually, the medium on-foot camera is approximately \(3.5\)–\(4.5\) m back, with the pivot around upper torso height. Horseback uses a distinct, farther rig. | No reliable public numerical value. A reasonable reconstruction is approximately \(55^\circ\)–\(65^\circ\), varying with camera distance and cinematic context. | RDR2 uses a relatively deliberate, soft-follow camera, with stronger authored behavior during traversal, combat, mounting, and cinematic moments. Horse and vehicle cameras use separate distance values and transitions; publicly exposed mod data confirms distinct third-person near, medium, and far modes.[8] |
| **Watch Dogs** | Public technical values are not generally available. A useful approximation for the standard over-the-shoulder rig is \(3\)–\(4\) m behind the character, with the pivot approximately \(1.5\)–\(1.7\) m high. Aiming shifts the camera toward the shoulder and closer to the player. | Approximately \(55^\circ\)–\(65^\circ\) in normal play; aiming is usually narrower. Treat this as an estimate, not a published value. | The camera generally follows character heading during locomotion but permits free look while stationary or aiming. Entering a car blends to a vehicle-specific camera rather than simply scaling the on-foot camera; exiting reverses that blend and restores the character rig. |
| **Mafia** | Mafia’s third-person camera is generally closer and more deliberately framed than GTA’s. A practical estimate is \(3\)–\(4\) m behind the character and \(1.5\)–\(1.7\) m at the target/pivot. Driving uses a higher and farther camera to preserve road visibility. | Approximately \(55^\circ\)–\(65^\circ\), with driving often widened modestly. No dependable public internal value was found. | Vehicle entry and exit are strongly authored: animations and camera cuts/blends are coordinated, with the vehicle camera typically taking control before the character is fully seated. Driving cameras often align more aggressively with velocity and road direction than walking cameras. |

GTA V’s publicly exposed scripting documentation is useful mainly because it shows the **architecture**: camera behavior is selected by context, including on-foot and multiple vehicle types, rather than being a single spring arm with a changed distance.[1] A separate GTA-style implementation gives concrete example values of \(4.5\) m distance, \(1.6\) m height, spring damping around \(8\), vehicle distance of \(6\)–\(9\) m, and idle vehicle recentering after about \(1.5\) seconds; those numbers are useful starting points but should not be attributed to Rockstar.[2]

## A practical production baseline

For a modern third-person action game, start with these values:

- **Character pivot:** \(1.35\)–\(1.55\) m above ground, usually chest or shoulder level.
- **Normal follow distance:** \(3.5\)–\(4.5\) m.
- **Camera height:** approximately \(1.6\)–\(2.0\) m, depending on whether height is measured at the camera or target pivot.
- **Normal FOV:** \(60^\circ\)–\(70^\circ\) horizontal, or approximately \(45^\circ\)–\(55^\circ\) vertical on a 16:9 display.
- **Aim distance:** \(1.5\)–\(2.2\) m.
- **Aim shoulder offset:** \(0.45\)–\(0.7\) m laterally.
- **Aim FOV:** reduce by roughly \(8^\circ\)–\(15^\circ\).
- **Vehicle distance:** \(6\)–\(9\) m for cars; farther and higher for trucks or fast vehicles.
- **Vehicle camera height:** approximately \(2.2\)–\(3.0\) m.
- **Vehicle FOV:** widen by \(5^\circ\)–\(15^\circ\) at speed rather than using a constant wide lens.
- **Idle recenter delay:** \(1.0\)–\(1.8\) seconds.
- **Collision pull-in:** move the camera toward the pivot immediately, then restore distance smoothly over roughly \(0.15\)–\(0.35\) seconds.

## Spring-arm and smoothing behavior

Avoid smoothing the camera as one undifferentiated transform. Use separate response times:

- **Position follow:** \(0.10\)–\(0.20\) seconds while running; \(0.20\)–\(0.35\) seconds while walking.
- **Yaw follow:** \(0.15\)–\(0.30\) seconds when movement should lead the camera.
- **Pitch follow:** \(0.20\)–\(0.40\) seconds to prevent head-bobbing and terrain jitter.
- **Manual-look release:** preserve the player’s view for about \(0.5\)–\(1.0\) seconds before recentering.
- **Recenter duration:** \(0.35\)–\(0.8\) seconds for walking; \(0.6\)–\(1.2\) seconds for driving.
- **Hard recenter conditions:** begin sooner when the character has rotated more than \(100^\circ\)–\(140^\circ\) away from camera forward, or when a target enters a combat cone.
- **Soft recenter conditions:** use movement direction only after sustained input for roughly \(0.2\)–\(0.5\) seconds.

A useful model is a critically damped spring rather than a simple frame-by-frame lerp:

\[
x(t+\Delta t)=\operatorname{SmoothDamp}(x(t),x_{\text{desired}},v,\tau,\Delta t)
\]

Use separate \(\tau\) values for position, yaw, pitch, and distance. This lets the camera remain stable over uneven ground while still turning decisively when the player changes direction.

## Entering and exiting vehicles

Use a staged transition rather than teleporting between rigs:

1. **Before interaction:** keep the on-foot camera active, but begin orienting it toward the vehicle.
2. **At animation commitment:** blend the target from the character’s chest to a vehicle seat or vehicle-center socket over \(0.2\)–\(0.4\) seconds.
3. **During the enter animation:** increase distance and height gradually; blend FOV by \(5^\circ\)–\(10^\circ\).
4. **When seated:** transfer control to the vehicle camera and align its yaw with vehicle heading or velocity.
5. **On exit:** reverse the process, but attach the target to the character’s upper torso before the exit animation completes.
6. **After control returns:** delay auto-recentering for \(0.3\)–\(0.7\) seconds so the player can see where they emerged.

For a moving vehicle, use velocity direction only when speed exceeds a threshold—for example, \(3\)–\(5\) m/s. At low speed, retain free-look behavior; at higher speed, increase heading-follow strength. This avoids the unpleasant effect of the camera snapping around while parking or reversing.

## Mobile touch and gamepad advice

**Mobile touch**

- Reserve the right half of the screen for camera orbit and the left half for movement.
- Use a dead zone of roughly \(4\%\)–\(8\%\) of the touch region.
- Convert finger displacement to angular velocity, not absolute camera angle.
- Cap orbit speed around \(180^\circ\)–\(300^\circ\) per second horizontally and \(90^\circ\)–\(160^\circ\) per second vertically.
- Add modest inertia after release—about \(0.08\)–\(0.18\) seconds—but stop quickly when the player touches again.
- Make vertical look sensitivity \(60\%\)–\(80\%\) of horizontal sensitivity.
- Provide a visible recenter button and a two-finger or edge gesture for camera reset.
- Avoid aggressive automatic recentering while the player is dragging the camera.
- During driving, enlarge the camera touch region and use speed-sensitive recentering, since precise free-look is harder with one thumb.
- Keep the character visible under thumb occlusion; a shoulder-side camera is usually better than a centered camera.

**Gamepad**

- Start with a right-stick dead zone of \(0.12\)–\(0.18\), then calibrate per controller.
- Use a response curve around \(1.5\)–\(2.0\), giving fine control near center and faster rotation at full deflection.
- Target approximately \(120^\circ\)–\(220^\circ\) per second at maximum horizontal input.
- Use a separate, slower aiming sensitivity—typically \(50\%\)–\(70\%\) of normal look speed.
- Let left-stick movement influence camera yaw only after a short delay, around \(0.2\)–\(0.4\) seconds.
- Recenter after \(1.0\)–\(1.5\) seconds of no right-stick input, but suspend recentering while aiming, strafing around a target, or near a traversal interaction.
- Keep camera collision independent from character collision and use sphere or capsule sweeps rather than a single ray.
- When the camera is obstructed, reduce distance first, then raise or shift the camera slightly; never allow walls to hide the player for long.

The central design lesson across these games is **contextual separation**: walking, aiming, driving, mounting, entering, exiting, combat, and cinematic moments each need their own target socket, distance, FOV, and recenter policy. A single universal spring arm can work technically, but it rarely produces the readable, low-friction behavior expected from GTA-style open-world cameras.

[1] gta5-under-the-hood/docs/rendering/cameras.md at main · Goodvibes74/gta5-under-the-hood (https://github.com/Goodvibes74/gta5-under-the-hood/blob/main/docs/rendering/cameras.md)
[2] leonida/SYSTEM_PROMPT.md at main · bridge-mind/leonida (https://github.com/bridge-mind/leonida/blob/main/SYSTEM_PROMPT.md)
[3] codeByAlexff/garrys-redemption: Play Red Dead ... (https://github.com/codeByAlexff/garrys-redemption)
[4] Custom Cameras (https://gta5.photography/manuals/cameras)
[5] Which camera angle do you use to play the game? (https://www.reddit.com/r/reddeadredemption2/comments/1h5xqe0/which_camera_angle_do_you_use_to_play_the_game/)
[6] Two quick settings you should change right away (https://www.reddit.com/r/GrandTheftAutoV_PC/comments/32ox3s/two_quick_settings_you_should_change_right_away/)
[7] Driver's Eye - GTA5-Mods.com (https://www.gta5-mods.com/scripts/driver-s-eye)
[8] Perspective - Camera Overhaul (https://www.nexusmods.com/reddeadredemption2/mods/2403?tab=posts)
[9] Custom Camera V Plus - GTA5-Mods.com (https://www.gta5-mods.com/scripts/custom-camera-v-plus)
[10] First person, on PC? :: Red Dead Redemption 2 General Discussions (https://steamcommunity.com/app/1174180/discussions/0/3153076242548019437/)
