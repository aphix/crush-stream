# Third-person cameras and on-foot controls

Research for the 2026-11-22 play pass (owner: "3rd person, controls and performance all need some work"). Status per
claim: VERIFIED (read in the primary source; file and line or a quote given), LEAD (an answer said it; not checked),
ENGINEERING (our starting value, tuned by feel).

## GTA III / Vice City, read in their reverse-engineered source

The re3 project (GTA III, branch `master`) and reVC (Vice City, branch `miami`) are complete reimplementations of the
games' C++ (mirrors: github.com/Cai1Hsu/re3, github.com/gibesauce/re3). Everything below was read in `miami`.

### On-foot camera with the mouse (`src/core/Cam.cpp`, `CCam::Process_FollowPedWithMouse`, 1346-1541) VERIFIED

| What | Code | Value |
|---|---|---|
| Pivot | `TargetCoors.z += fTranslateCamUp` (1340) | 0.8 m above the ped's origin (its centre), about head height |
| Distance | `CamDist = fBaseDist + Cos(Alpha)*fAngleDist` (1335-1336) | 1.7 + 2.0 cos(pitch) m: 3.7 m level |
| Pitch range | `Alpha` clamp | +45 deg (from above) to -89.5 deg |
| Resting pitch | `fDefaultAlphaOrient` (1342) | -0.22 rad, used when the player has no control |
| Mouse | `BetaOffset = -2.5*MouseX * m_fMouseAccelHorzntl * FOV/80` | sensitivity scales with the field of view |
| Pad stick | `fStickSens` (1338) | 0.01; yaw x 1/14, pitch x 0.6/14 per step |
| Outward recovery | `fMouseAvoidGeomReturnRate` (1343) | 0.92 per 1/50 s step: a time constant of about 0.24 s |

- The mouse camera never recentres: yaw stays where the player left it, and while the ped may strafe or be
  mouse-controlled its heading is set to the camera's (`CanStrafeOrMouseControl`).
- Collision: one line of sight from the pivot to the eye. On a hit the eye moves to the hit point that frame (inward is
  instant) and the near plane shrinks to `Max(PedColDist - 0.3, 0.05)`. A sphere the size of the near-plane rectangle is
  then tested and, while it touches, the eye steps 30 % closer (at most five times). Only the way back out is eased
  (the 0.92 rate above). A ped in the way that the eye does not clip is looked through (a second ray from the hit).

### On-foot camera with a pad (`CCam::Process_FollowPed`, 990-1345) VERIFIED

- The camera eases back behind the walk direction through `WellBufferMe` (`fDefaultSpeedStep 0.025`,
  `fDefaultSpeedMultiplier 0.09`, `fDefaultSpeedLimit 0.15`, softer `...4Avoid` values while avoiding geometry, 980-985).

### Car camera, San Andreas style (`CCam::Process_FollowCar_SA`, from 4780; `CARCAM_SET` 4830-4838) VERIFIED

- The eye trails a history point of the car like a weight on a string: `Front = TargetCoors - m_aTargetHistoryPosOne`.
  Distance is the zoom plus `CARCAM_SET[i][1]` plus the car's length, never under `approxCarLength * CARCAM_SET[i][3]`.
- Yaw swings toward the direction of travel, rate-limited: `betaChangeMult1 = step * 0.075` times the sideways speed,
  limit `step * 0.05` rad (cars).
- Pitch eases toward the string's pitch by `1 - Pow(0.5, step)`, capped at 1.0 rad a step; `maxAlphaAllowed` is
  computed from the car's collision box (and the car's own pitch and roll on the ground) so the eye never drops into the
  body. The code's own comment: "Originally this is to prevent camera enter into car while we're stopping".

### Player on foot (`src/peds/PlayerPed.cpp`, `CPlayerPed::PlayerControlZelda`) VERIFIED

- Movement is camera-relative: `padHeading = angle(-leftRight, upDown)`; `m_fRotationDest = padHeading - camOrientation`.
- Speed climbs by `0.07 * timestep` (1/50 s steps) toward the stick's magnitude and is set to 0 the frame the stick is
  released: a ramp up, an instant stop. Sprint is a held button.

## Published camera practice

- Yoann Pignole, "Third person camera design with free move zone", Game Developer, 2015-09-28 VERIFIED (no numbers;
  structure only): a "free move zone" cylinder in which the character moves without the camera following; free-cam
  input orbits on a sphere with its own acceleration and speed, pitch limited; once the player has moved the camera it
  stays in "free cam mode" (translation only) until the character leaves the zone within a front angle and the camera
  input is idle, then it eases back to the default setup; distance grows with forward speed between two speeds, up to
  a maximum. Collision: "The camera collider (sphere around the camera) can't enter a collision and slides on it. This
  rules takes priority over all the other ones." Occlusion fallbacks in order: orbit (horizontal first), come closer
  keeping a minimum distance, closer and orbit, and only last closer than the minimum.
- Unity Cinemachine "3rd Person Follow", Godot `SpringArm3D`, the Shadow of Mordor postmortem, a 2021 arXiv overview
  (2109.03750) and a vehicle-camera paper giving views ~19 m behind at ~15 and ~60 deg: LEAD (named by
  `perplexity/2026-11-21-third-person-camera-practice.md`; not opened). The answer's ranges (on-foot 3-6 m, lag
  0.05-0.15 s on foot and 0.15-0.4 s in a car, recentre after 0.3-1 s idle) are its own, not from a source.

## What this repo takes from it (ENGINEERING unless marked)

| Knob | Value | From |
|---|---|---|
| On-foot pivot | about head height | GTA 0.8 m over the ped centre (VERIFIED) |
| On-foot boom at level | about 3.5-3.7 m, shortening with pitch | GTA 1.7 + 2.0 cos(pitch) (VERIFIED) |
| On-foot framing | player centred horizontally, whole body in view at the default zoom | GTA; the owner's GTA 6 reference |
| Mouse orbit | never changes the view kind; no auto-recentre | GTA mouse camera (VERIFIED) |
| Pad recentre | ease behind the walk direction after about 1 s with no camera input | GTA pad camera behaviour; delay ENGINEERING |
| Collision | swept sphere; inward instant; outward eased, time constant about 0.24 s; near plane shrinks | GTA (VERIFIED), Pignole |
| Chase camera | eye bounded by the car's box so it never enters the body; yaw toward velocity, rate-limited | GTA SA car camera (VERIFIED) |
| On-foot start/stop | short ramp up, stop at once on release | GTA (VERIFIED) |

## Sources

- re3/reVC source: github.com/Cai1Hsu/re3 (branch `miami`), files `src/core/Cam.cpp`, `src/core/Camera.cpp`,
  `src/peds/PlayerPed.cpp`.
- Pignole 2015: https://www.gamedeveloper.com/design/third-person-camera-design-with-free-move-zone
- Raw answers: `perplexity/2026-11-21-re3-follow-cameras.md`, `perplexity/2026-11-21-third-person-camera-practice.md`.
