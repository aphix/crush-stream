> Question: How does the grappling hook and tether ('retractor') work in Just Cause 2, 3 and 4 as game design: firing a hook, attaching two objects (cars, people, props, the ground) together with a cable, how many tethers at once, maximum range and cable length, retracting/reeling to pull objects together and its strength, what happens with very heavy vs light objects, when a tether breaks or is detached, slack vs taut behaviour, and the controls on gamepad and mouse/keyboard (aim, attach first point, attach second point, retract, detach all)? Give concrete numbers (metres, counts, seconds, forces) where known, with sources (developer interviews, wikis, GDC talks).

The **grappling hook is primarily a physics constraint system**, not a realistic winch. Rico fires separate hook shots; once a hook hits a valid target, the game creates a cable between Rico and that object, or—after a second shot—between two objects. The exact engine constants for cable force, range, and break thresholds are generally not publicly documented, so reliable concrete values are limited.

## Core behavior

- **First attachment:** Aim at a valid target and fire the grapple. In *Just Cause 4*, the documented grapple range is approximately **80 metres**; two objects can be joined within the same range.[9]
- **Second attachment:** With an active cable selected, aim at another valid object and fire again. The two endpoints then share a tether.
- **Valid targets:** Depending on the game and object, these include people, vehicles, aircraft, boats, destructible scenery, props, towers, switches, doors, and the ground.
- **Rico attachment:** A hook attached to a surface can pull Rico toward it; a hook attached to a vehicle or person can also pull Rico toward the target.[9]
- **Cable length:** The initial cable is determined by the distance between the attachment points. There is no well-supported public figure for a separate universal “maximum cable length” beyond the approximately **80 m targeting range** documented for *Just Cause 4*.[9]
- **Slack and tautness:** The cable behaves like a distance constraint. If the endpoints move closer, it becomes slack or visually sags; when they separate to the cable’s current length, it becomes taut and begins transferring force. It does not continuously pull objects together unless a retractor or an equivalent automatic-pull behavior is active.

## Number of simultaneous tethers

| Game | Known tether capacity |
|---|---|
| *Just Cause 2* | The base game supports multiple grapples, but a reliable developer-published numerical limit is not established in the available sources. |
| *Just Cause 3* | **2 active tethers** initially; **4** after Double Tethers; **6** after Triple Tethers.[6] |
| *Just Cause 4* | The available documentation confirms multiple configurable grapple loadouts, but does not provide a dependable total active-tether number in the cited material. |

In *Just Cause 3*, the upgrades are cumulative capacity upgrades: Double Tethers raises the maximum to four, and Triple Tethers raises it to six.[6] These limits describe simultaneous active cables, not merely the number of objects that can be selected.

## Retracting and pulling

### *Just Cause 2*

The original system is comparatively simple:

- A grapple can pull Rico toward an attachment point.
- A tether between two objects can constrain them and allow the game’s physics to pull or drag them as the endpoints move.
- There is no well-supported public specification in the available sources for a selectable retract speed, calibrated force, exact cable length, or Newton-level break threshold.

### *Just Cause 3*

*Just Cause 3* introduced the more explicit two-object tether behavior:

- Two dynamic objects can be connected by a tether.
- Upgraded tethers increase both **strength** and the force with which they retract.[1][6]
- Heavy structures may resist movement because the tether applies a finite impulse rather than guaranteeing that either object will move.
- A light object—such as a person, small prop, or loose vehicle—moves readily toward a heavier or fixed object.
- When the applied strain exceeds the tether’s durability, the cable breaks; the games do not expose a numeric force value to the player.

The director’s explanation specifically describes *Just Cause 3* as allowing two dynamic objects to be tethered, while later systems expanded the available behavior.[1]

### *Just Cause 4*

*Just Cause 4* makes the retractor a configurable gameplay tool rather than a single fixed pull:

- The retractor joins two targets and pulls them toward one another.[2]
- **Power:** Off, Soft, or Extreme; this changes the force of the pull.[3]
- **Retract speed:** Slow, Medium, or Fast.[3]
- **Minimum length:** Short or Long; this determines how far the cable retracts before its configured end behavior occurs.[3]
- **End behavior:** Deactivate, Snap, or Pulse.[2][3]
- **Pulse:** Applies a strong outward impulse when the cable reaches its selected minimum length.[3]
- **Deactivate:** Stops the retraction while leaving the objects joined.[2][3]
- **Snap:** Releases the tether when the minimum length is reached.[2][3]

Thus, “retract” is not a physically measured winch speed. It is a game-controlled shortening constraint combined with a selectable impulse strength. Extreme power can yank light objects rapidly, while massive structures may barely move or cause the tether to snap instead.[3]

## Heavy versus light objects

The system is deliberately asymmetric:

- **Light target + heavy target:** The light target generally travels toward the heavy target.
- **Two light targets:** Both may move significantly, often producing the characteristic “objects pulled together” effect.
- **Heavy structure + ground:** The structure may deform, topple, or break if the game has authored the relevant destruction behavior; otherwise the cable may stretch to its limit or snap.
- **Heavy structure + heavy structure:** The retractor does not guarantee motion. The effective result depends on mass, anchoring, destructibility, cable strength, and the selected power setting.
- **Extreme power:** Produces a sharper impulse and can be useful for yanking enemies or props, but it can also make a tether snap quickly, especially against large structures.[3]

The games do not publish masses or force coefficients for individual objects, so “strength” is best understood as a relative gameplay parameter rather than a documented physical unit.

## Detachment and breaking

A tether ends when:

- The player detaches it.
- A configured **Snap** effect releases it.
- Its strain or durability limit is exceeded.
- One endpoint is destroyed, removed, or becomes invalid.
- The relevant object or cable unloads from the world; *Just Cause 3* cables can disappear after leaving the area, with one cited console observation placing this around **800 m**.[9]

Breaking is not presented as a fixed real-world cable failure force. In *Just Cause 3*, tether-strength upgrades increase the strain the cable can withstand.[6] In *Just Cause 4*, the selected power and object pairing can make a tether fail almost immediately when trying to move very large structures.[3]

## Controls

Exact bindings vary by platform, control scheme, and remapping, but the interaction model is:

1. **Aim:** Hold the grapple-aim control and place the reticle over a valid target.
2. **Attach first point:** Press the grapple-fire/attach button.
3. **Attach second point:** Aim at another target and press the same attach button.
4. **Retract:** Use the retraction control while the two-object tether is active.
5. **Detach:** Use the tether-release control; in *Just Cause 4*, the configured Snap or Deactivate behavior can also end or suspend the automatic pull.
6. **Select tether configuration:** In *Just Cause 4*, cycle grapple configurations with **left/right on the D-pad**; the cited PC guide lists **C/Z** for cycling on keyboard.[2]
7. **Retractor activation mode:** *Just Cause 4* supports automatic, tap, and hold-style retraction behavior, depending on the selected configuration.[5]

The available sources do not establish a single universal mouse/keyboard binding for every PC version and control preset, so the in-game control screen is the authoritative source for the current mapping.

## What is and is not known numerically

**Reliable concrete figures from the available material:**

- *Just Cause 4* grapple/attachment range: approximately **80 m**.[9]
- *Just Cause 3* active tether capacity: **2 → 4 → 6** with the relevant upgrades.[6]
- *Just Cause 3* cable unloading observation: approximately **800 m** from the loaded area on PS4.[9]
- *Just Cause 4* retractor power: **Off / Soft / Extreme**.[3]
- *Just Cause 4* retractor speed: **Slow / Medium / Fast**.[3]
- *Just Cause 4* end behavior: **Deactivate / Snap / Pulse**.[2][3]
- *Just Cause 4* minimum-length setting: **Short / Long**.[3]

**Not reliably published in the cited material:**

- Newtons or kilograms for tether strength.
- Exact cable-length caps separate from targeting range.
- Exact seconds per metre for Slow, Medium, or Fast.
- Per-object masses or break thresholds.
- A confirmed *Just Cause 2* numerical tether count.
- A confirmed *Just Cause 4* total simultaneous-tether count.

The design therefore prioritizes readable, spectacular outcomes—light things fly toward heavy things, large structures resist or break cables, and retractors can be tuned from gentle to violent—rather than exposing a fully specified mechanical simulation.

[1] The Making of Just Cause 3 and Just Cause 4, Revealed by Game Director (https://www.youtube.com/watch?v=kWkao8f5wNs)
[2] Tether Mods - Just Cause 4 Guide - IGN (https://www.ign.com/wikis/just-cause-4/Tether_Mods)
[3] Grappling Hook Mods (https://gamefaqs.gamespot.com/xboxone/241025-just-cause-4/faqs/76690/grappling-hook-mods)
[4] I’m new to just cause 4 and I can’t rip of the cover of these generators what am I doing wrong? (https://www.reddit.com/r/JustCause/comments/qrubuf/im_new_to_just_cause_4_and_i_cant_rip_of_the/)
[5] Just Cause 4: Grapple Hook Retractor Pro Tips (https://www.youtube.com/watch?v=z4p8iPuSM4c)
[6] Upgrades - Just Cause 3 Guide - IGN (https://www.ign.com/wikis/just-cause-3/Upgrades)
[7] Grappling hook is too op now (Just cause 4) (https://www.reddit.com/r/JustCause/comments/k2zmrr/grappling_hook_is_too_op_now_just_cause_4/)
[8] Just Cause 4 Grapple Guide (+ Flying Death Mech Instructions!) (https://www.youtube.com/watch?v=5dNNAEmYO24)
[9] Just Cause 4 (https://justcause.fandom.com/wiki/Protec_Grappler_G3)
[10] Just cause 4, Tether will snap immediately!!! HELP (https://www.reddit.com/r/JustCause/comments/ctj33i/just_cause_4_tether_will_snap_immediately_help/)
