> Question: For a third-person driving and on-foot browser game on desktop, gamepad and mobile touch, what is good UX for aiming and firing a grappling hook/tether like Just Cause: target highlighting and snapping (aim assist cones, valid-target reticle), showing the attach point and the cable, attaching two targets in sequence, reeling in, releasing, cancelling; and how to map it to touch controls (buttons vs drag-to-target)? Include examples from shipped games and concrete parameters (aim assist angles in degrees, max range, reticle feedback) with sources.

A good grappling-hook UX should make **valid targets obvious before firing**, require little precision during fast driving, and preserve manual control when the player wants a specific attach point. Use a two-stage model: **soft target acquisition while aiming**, followed by **explicit confirmation/firing**.

## Recommended interaction model

### 1. Aim and target acquisition

Cast a camera-centered ray or cone from the reticle. Within the cone, score candidates by:

- Screen-space distance from the reticle
- World distance
- Visibility and line of sight
- Surface angle
- Target type and priority
- Whether the point is reachable or physically useful

A practical starting configuration:

| Parameter | Suggested value |
|---|---:|
| Normal aim-assist cone | 6–8° half-angle |
| Driving-speed cone | 10–14° half-angle |
| Precision/aim mode | 2–4° half-angle |
| Maximum grapple range | 60–100 m on foot; 100–150 m from vehicles |
| Target acquisition delay | 50–120 ms |
| Target switch hysteresis | 2–3° or 100–200 ms |
| Reticle snap interpolation | 80–150 ms |
| Minimum target screen size | 8–12 px on desktop; 14–20 px on mobile |

The cone should not silently redirect the actual projectile too far from the player’s aim. Keep the visual reticle near the intended point, then bend the hook toward the selected anchor only within the assist cone.

*Just Cause 2* uses a nearby-target aiming reticule, with the reticle indicating accuracy, and changes the crosshair to red when an object is in grappling-hook range.[1] Its manual also describes dual-hooking by holding the grapple input for the first attachment, aiming at another target, and releasing to attach the second end.[2]

### 2. Reticle states

Use a clear, consistent state machine:

- **Neutral:** white hollow reticle; no valid target.
- **Candidate:** pale yellow ring or four corner brackets; a target is nearby but not fully confirmed.
- **Valid:** green or cyan reticle; hook can attach.
- **Preferred/locked:** filled center dot, thicker ring, and a small target marker at the exact attach point.
- **Out of range:** red or amber reticle with a broken-range indicator.
- **Blocked:** gray/red reticle with a short “line of sight blocked” pulse.
- **Second endpoint:** first anchor remains highlighted; the reticle says “Select second anchor.”
- **Attached:** reticle becomes a tether icon; show reel and release affordances.

Sekiro uses contextual grappling symbols that change from gray to green when an anchor is close enough and usable.[5] That is a strong pattern for environmental targets: gray means “potentially usable,” green means “currently valid.”

Avoid relying on color alone. Pair color with shape, animation, and audio:

- Valid: brief tick, subtle scale-up, solid center dot
- Invalid: muted click or no sound
- Locked: short confirmation tone
- Attach: sharp cable-launch sound
- Release/cancel: lower-pitched snap

### 3. Highlighting the attach point

Highlight both the **object** and the **exact surface point**:

- Put a world-space anchor marker at the raycast hit point.
- Add a thin projected line from the reticle to that marker.
- Use an outline or emissive rim only on the selected object, not every possible object.
- For large objects, favor a navigable attachment socket—roof edge, beam, bumper, trunk, or designated grapple node—rather than arbitrary triangles.
- Show a small distance label only when useful, such as `74 m`; hide it during hectic driving unless accessibility settings enable it.

The cable should appear immediately after successful attachment, not only after the player begins moving. Render it as a bright, high-contrast line with:

- A short glow near the hook
- A visible anchor knot or clamp
- Slight sag only when slack is physically meaningful
- A different color or pulse when tension is high
- A warning flash when the cable is about to break or become obstructed

## Two-target tether flow

Use an explicit, easy-to-read sequence:

1. **Press/hold grapple:** acquire and attach the first valid target.
2. **Enter endpoint-selection mode:** freeze or soften target switching; retain the first anchor marker and draw the first cable.
3. **Aim at the second target:** show a second reticle and preview cable.
4. **Press or release to attach:** depending on the platform’s input style.
5. **Show both endpoints:** label them subtly as `A` and `B` if confusion is likely.
6. **Reel, release, or cancel:** expose the available actions in the HUD.

The first endpoint should remain fixed unless the player deliberately cancels. Do not let ordinary reticle movement accidentally replace it.

A useful rule is:

- **Tap/press:** attach one endpoint.
- **Hold:** keep the hook tool active.
- **Second tap/press:** attach the next endpoint.
- **Release button:** detach the current endpoint.
- **Dedicated cancel:** clear the pending endpoint without detaching an already completed tether.

For a Just Cause-like feel, an alternative is **hold to select endpoint one, release to select endpoint two**, matching the dual-hook behavior documented for *Just Cause 2*.[2] However, a discrete second press is usually more reliable on touchscreens and avoids accidental attachment when a finger slips.

## Reeling, releasing, and cancelling

### Reeling

Use a continuous reel rather than repeated button presses:

- Gamepad: left/right trigger or shoulder buttons for reel in/out
- Keyboard: hold two adjacent keys, such as `R` and `F`
- Touch: two dedicated buttons, or a single reel button whose direction is controlled by a short swipe

Suggested tuning:

- Reel speed: 8–15 m/s on foot
- Vehicle reel speed: 12–25 m/s
- Acceleration: 150–300 ms
- Release the input to preserve current cable length
- Add a small dead zone so brief accidental touches do not change length

Display a compact cable-length meter near the reticle or tether line. During high tension, add a tension arc or vibration rather than a large HUD panel.

### Release

Release should be immediate and reversible only through a clearly separate re-fire action:

- Gamepad: right bumper or face button
- Keyboard: grapple key tap
- Touch: large `RELEASE` button near the action thumb
- Optional: tapping the active anchor marker releases that endpoint

Do not make release depend on aiming away from the target; that is difficult to discover and unreliable during driving.

### Cancel

Cancellation should be distinct from release:

- During first-endpoint targeting: cancel clears the aim state.
- After endpoint one but before endpoint two: cancel removes the pending first endpoint.
- After both endpoints are attached: cancel may release both, but only after a short hold or confirmation if releasing has major consequences.

A brief button hold—roughly 250–400 ms—works well for destructive “clear tether” behavior, while a normal tap handles ordinary release.

## Desktop and gamepad controls

### Mouse and keyboard

- Move mouse: aim
- Left click or grapple key: fire/attach
- Hold grapple key: maintain endpoint-selection mode
- `R`/`F`: reel in/out
- Right click or `Esc`: cancel
- Mouse wheel or number keys: cycle nearby valid targets, if desired

For mouse aiming, use a small 4–6° assist cone and let the player override the selected target by moving the cursor directly onto a different anchor.

### Gamepad

- Right stick: aim
- Right trigger: fire/attach
- Hold right trigger: select the first endpoint and continue aiming
- Left/right bumpers: reel in/out
- Face button: release
- B button: cancel
- Optional left-trigger “precision aim”: reduce assist cone from approximately 10° to 3°

On vehicles, increase the cone slightly with speed, but also increase target stickiness. At high speed, a 12° cone with 150–250 ms target hysteresis is more usable than a narrow, twitchy reticle.

## Touch controls

### Recommended default: drag-to-target, release-to-fire

For mobile, drag-to-target is generally better than a fixed fire button when the hook’s destination matters. *Grapple Caves* uses “drag anywhere to aim, lift to fire,” while *Swingo* describes touch-drag aiming with a dotted trajectory preview.[3][4]

Flow:

1. Touch and hold anywhere in the right half of the screen.
2. Drag toward the desired anchor.
3. Show a projected hook path, valid-target markers, and the snapped attach point.
4. Release to fire.
5. After the first endpoint, repeat the gesture for the second endpoint.
6. Display large `REEL`, `RELEASE`, and `CANCEL` controls while attached.

Recommended touch parameters:

- Touch aim dead zone: 20–35 px
- Aim drag sensitivity: 0.7–1.2 screen pixels per reticle pixel
- Touch assist cone: 12–18° half-angle
- Mobile target minimum: 14–20 px
- Fire confirmation delay: 80–150 ms after release
- Optional slow-motion while dragging: 30–50% game speed
- Cancel swipe threshold: 60–100 px toward the screen edge

A dotted trajectory is useful for direction, but it should be supplemented by a highlighted target and exact attach marker. A direction-only line is insufficient when several anchors overlap.

### Buttons versus drag-to-target

| Situation | Best control |
|---|---|
| Precise anchor selection | Drag-to-target |
| Fast repeated grapples | Dedicated button with aim assist |
| Vehicle driving | Large grapple button plus soft auto-targeting |
| Two-endpoint tethering | Drag/release for each endpoint or button-plus-reticle |
| Reeling | Dedicated large buttons |
| Release/cancel | Dedicated buttons, never hidden gestures |

A strong hybrid layout is:

- **Grapple button:** tap to fire at the current valid target.
- **Drag from grapple button:** aim manually and release to fire.
- **Target marker tap:** directly select a visible highlighted anchor.
- **Reel and release buttons:** remain visible only while attached.

This accommodates both players: those who want a one-thumb arcade control and those who need precise targeting. *Terraria Mobile* provides a useful precedent for a dedicated grapple gesture alongside aim-stick and touch controls, including swipe-to-grapple and sequential activation for multi-hook tools.[8]

## Recommended baseline implementation

Start with these defaults and tune through playtesting:

- 10° assist cone on foot
- 14° assist cone while driving
- 80 m on-foot range
- 120 m vehicle range
- 100 ms target acquisition
- 150 ms target-switch hysteresis
- 100 ms reticle snap
- Green valid-target reticle
- Yellow candidate reticle
- Red out-of-range reticle
- World-space anchor marker plus visible projected cable
- Tap to attach endpoint one
- Tap again to attach endpoint two
- Hold or buttons to reel
- Dedicated release and cancel controls
- Touch drag-to-aim with release-to-fire
- Optional 40% slow-motion during touch aiming

The key principle is **assist selection, not intent**: the game may snap to a nearby valid anchor, but it should always show which point was selected and give the player a clear way to reject, cancel, or manually override it.

[1] [PDF] Untitled - SQUARE ENIX Support Center (https://support.na.square-enix.com/document/manual/1100/Just_Cause_2_PS3_Instruction_Manual.pdf.pdf?SQEXSC=1u7862nqnva6sgm4f6a4tvsq93)
[2] Just Cause 2 PC Instruction Manual | PDF | Video Games - Scribd (https://www.scribd.com/document/46895098/Just-Cause-2-PC-Instruction-Manual)
[3] Grapple Caves – Free grappling hook adventure (https://www.kiloo.com/games/grapple-caves)
[4] Swingo - Grappling Hook Platform Adventure - Seele AI (https://www.seeles.ai/games/action/swingo-grappling-hook-platform-adventure)
[5] gamewith.net › sekiro › articleSEKIRO | Grappling Hook - Where To Get & How to Use (https://gamewith.net/sekiro/article/show/8493)
[6] Hook Slice – Play Online and Master the Grappling Hook - MaxiGames (https://maxigames.io/game/hook-slice/)
[7] Rabbit Samurai 3 | Play Free Online Games in Your Browser! (https://freegames.io/game/rabbit-samurai-3)
[8] Terraria Mobile 1.3 Controls: An Introduction (https://forums.terraria.org/index.php?threads/terraria-mobile-1-3-controls-an-introduction.82198/)
[9] GitHub - khaled-hassen/SekiroGrapplingHook: I recreated ... (https://github.com/khaled-hassen/SekiroGrapplingHook)
[10] Blacktop: Police Chase - Free 3D Racing Game (https://www.seeles.ai/games/action/noob-hook-physics-based-grappling-hook-game)
