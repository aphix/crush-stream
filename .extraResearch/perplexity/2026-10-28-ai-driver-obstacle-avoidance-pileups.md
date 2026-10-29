> Question: How do racing game AI drivers avoid obstacles and pile-ups: wrecked cars, stopped traffic, NPC vehicles and debris on the racing line? Covering Need for Speed, Burnout, GTA (vehicle AI and traffic), Forza, GRID, rFactor/Assetto Corsa and published game-AI literature (Game AI Pro racing AI chapters, AI Game Programming Wisdom, GDC talks, Craig Reynolds steering behaviours, Codemasters/Criterion talks). Specifically: (1) how far ahead they look and how they detect an obstruction (raycasts/whiskers, occupancy of the racing-line spline, sweeping a corridor, velocity-obstacle methods); (2) how they choose to steer left or right around it versus brake, including lateral offsets from the racing line and how they pick the side with more free space; (3) how they avoid all piling into the same wreck (spreading, per-driver offsets, reaction delays); (4) how they keep speed instead of crawling past an obstacle; (5) how they recover after contact. Give concrete numbers (look-ahead seconds or metres, offsets, reaction times) where published and cite sources; say where a detail is not published.

The public record supports a **layered system**, not one universal algorithm: racing AI usually combines a long-range route/trajectory planner with short-range collision avoidance, then modifies speed and steering according to the obstruction’s predicted time to collision. Exact production values for most commercial games—especially Need for Speed, Burnout, GTA, Forza, GRID, rFactor and Assetto Corsa—are generally **not published**.

## 1. Detection: what is ahead and how far?

### Long-range planning

Racing-AI architecture literature separates collision avoidance into:

- **Long range:** inspect the track ahead and plan a safe route around debris, damaged cars and other obstructions.
- **Short range:** make rapid steering corrections for obstacles that become immediately threatening.[1]

The long-range representation is commonly a track graph or racing-line spline with one or more lateral offsets. An obstruction can therefore be detected by:

- Testing whether its projected position overlaps the AI’s future racing-line segment.
- Marking occupied portions of the spline or track corridor.
- Sweeping the vehicle’s predicted footprint forward rather than testing only its centre point.
- Sampling candidate paths offset left and right from the nominal line.

The cited racing-AI chapter describes the architecture, but does **not** publish a universal look-ahead distance or time value.[1] For individual commercial games, such numbers are likewise not publicly established in the available sources.

### Short-range detection

Craig Reynolds’ classic obstacle-avoidance method uses a forward **detection box/cylinder** whose length is proportional to speed and whose width corresponds approximately to the vehicle’s body or bounding volume.[4][10] The algorithm:

1. Rejects obstacles outside the forward detection volume.
2. Expands obstacle bounds by the vehicle’s effective radius.
3. Finds intersections with the predicted forward path.
4. Selects the closest threatening intersection.
5. Produces a steering correction only when a collision is imminent.[4][10]

This is the conceptual equivalent of forward raycasts or “whiskers,” although a production racing game may use several rays, a capsule sweep, a vehicle-shaped volume, or a track-space occupancy test instead.

A useful engineering interpretation is:

\[
d_{\text{lookahead}} \approx vT_{\text{horizon}} + d_{\text{margin}}
\]

where \(v\) is speed and \(T_{\text{horizon}}\) is the prediction horizon. At higher speed the detection region automatically extends, allowing the AI to react earlier. Reynolds’ sources specify this proportional relationship, but not a racing-game-specific value such as “1.5 seconds.”[4][10]

Velocity obstacles are another possible method: they represent the set of velocities that would result in a collision within a time horizon, then select a velocity outside those forbidden regions.[6] This is more natural for dynamic traffic than a single ray, but the cited material does not establish that Need for Speed, Forza, GTA or the other named games use it.

## 2. Choosing left, right or brake

A robust racing implementation evaluates several candidate futures rather than simply steering away from the obstacle.

Typical candidates are:

- Continue on the racing line.
- Shift left by one or more lateral offsets.
- Shift right by one or more lateral offsets.
- Brake while remaining on-line.
- Brake and shift.
- Abort the manoeuvre if neither side has sufficient clearance.

For each candidate, the AI can score:

- Free distance before the next obstacle.
- Collision risk for the vehicle’s swept body.
- Required lateral acceleration or steering angle.
- Curvature of the candidate path.
- Speed loss.
- Whether the candidate rejoins the racing line cleanly.

The context-steering literature describes a danger map in which nearby cars write danger according to their **racing-line offset**; the AI then chooses a direction with less danger.[2] This maps directly to left/right candidate lanes or lateral samples around the spline.

The side-selection rule is usually equivalent to:

\[
\text{choose side} =
\arg\max_{s\in\{\text{left,right}\}}
\left(
\text{free space}_s
-\lambda_1\text{risk}_s
-\lambda_2\text{path cost}_s
\right)
\]

If both sides are blocked, braking is preferable to committing to a narrow gap. If one side has more free space, the target point moves toward that side’s lateral offset.

The published sources do **not** provide common production values for offsets such as “0.75 car widths” or “2 metres.” Those are implementation choices. A practical system would normally use offsets related to vehicle width—for example, half-width plus a safety margin—rather than a fixed world-space number.

## 3. Preventing a pile-up at the same wreck

A naïve system makes every car see the wreck and select the same nearest escape direction. That causes a secondary collision. Production-quality systems can reduce this through several mechanisms:

- **Reservation:** the first vehicle to select a side reserves that corridor temporarily.
- **Per-driver offsets:** each car aims at a slightly different lateral target rather than the exact same point.
- **Separation:** nearby vehicles contribute danger to one another, pushing trajectories apart.[2][3]
- **Priority rules:** cars farther ahead, already committed, or travelling faster receive priority.
- **Reaction-time variation:** drivers do not begin avoidance on the same simulation tick.
- **Different risk profiles:** cautious drivers brake earlier; aggressive drivers attempt narrower gaps.
- **Staggered rejoin points:** cars merge back onto the racing line at different distances.

Reynolds’ steering framework includes separation as a standard behaviour, and context steering can encode other cars as danger according to their racing-line positions.[2][3] However, published material does **not** establish exact reaction delays or lane-reservation timings for the named commercial games.

A plausible implementation is to assign each vehicle a reaction delay sampled around a driver-specific mean—for example, tens to a few hundred milliseconds—but that numerical range should be treated as an engineering example, **not a published value for Need for Speed, Burnout, GTA, Forza or GRID**.

## 4. Keeping speed instead of crawling

Avoidance should be treated as a **trajectory-and-speed problem**, not merely “turn away from obstacle.”

A competent controller:

- Looks beyond the immediate wreck to determine whether the escape route remains open.
- Reduces speed only enough to satisfy the candidate path’s curvature and clearance constraints.
- Selects the side with the greatest usable corridor.
- Uses a smooth lateral offset rather than a sudden heading reversal.
- Begins returning to the racing line once the vehicle’s swept body clears the obstruction.
- Restores target speed progressively after the risk region.

The target speed can be limited by both curvature and obstacle clearance:

\[
v_{\text{target}}
=
\min
\left(
v_{\text{racing line}},
v_{\text{curvature}},
v_{\text{obstacle}}
\right)
\]

If a wide route is available, \(v_{\text{obstacle}}\) remains near the normal racing speed. If the route is narrow or requires a sharp steering change, speed is reduced. This avoids the common failure mode in which the AI brakes to near zero merely because an object exists somewhere ahead.

Reynolds’ model explicitly makes obstacle detection depend on speed and vehicle agility, while steering behaviours produce a desired velocity rather than a binary stop command.[3][4] The cited racing-AI chapter likewise frames long-range avoidance as route planning, which supports preserving speed through a viable alternative route.[1]

No source retrieved here publishes exact “minimum pass speed,” braking thresholds, or speed-recovery distances for the named games.

## 5. Recovery after contact or a failed avoidance

After contact, racing AI generally needs a separate recovery layer rather than continuing to apply the original racing-line command. Typical steps are:

1. Detect abnormal state: large heading error, low forward speed, excessive lateral displacement, collision impulse or loss of track progress.
2. Suppress aggressive racing-line steering temporarily.
3. Choose a reachable recovery target on the track or nearest valid route.
4. Use low-speed alignment and separation to avoid immediately hitting the same wreck or neighbouring cars.
5. Rejoin the racing line only after the vehicle is facing approximately along the track and has adequate clearance.
6. Restore normal target speed with acceleration limits.

The steering literature’s basic model computes a desired velocity and limits steering force, acceleration and speed, which naturally supports gradual recovery rather than instantaneous snapping.[4] Its obstacle-avoidance behaviour returns no corrective steering when no imminent collision exists, allowing normal path-following behaviour to resume.[4]

For stuck vehicles, games may additionally use:

- Reverse-and-retry manoeuvres.
- A waypoint fallback.
- A reset or respawn after a timeout.
- A special “unstuck” animation or physics assist.

The available published sources do not document the recovery implementation or timeout values of the specific commercial games listed in the question.

## What can be stated confidently for the named games?

| Game or technology | Publicly supportable conclusion |
|---|---|
| **Need for Speed, Burnout** | Their detailed obstacle-avoidance algorithms and numerical parameters are not established by the sources available here. Claims about specific ray counts, look-ahead seconds or offsets would be speculation. |
| **GTA vehicle AI and traffic** | Traffic and vehicle AI likely require local collision handling, but the available sources do not document Rockstar’s exact raycasts, prediction horizon, side-selection logic or pile-up prevention. |
| **Forza** | The exact production AI collision-avoidance implementation and numerical thresholds are not published in the cited material. |
| **GRID/Codemasters** | Public racing-AI talks and technical discussion are relevant in principle, but no verified numerical parameters are established by the available results. |
| **rFactor/Assetto Corsa** | The available sources do not establish the simulator AI’s precise obstacle-detection or avoidance algorithms; mod/configuration behaviour should not be generalized into a single engine method. |
| **Game AI Pro** | Supports the long-range/short-range decomposition and racing-line-offset danger evaluation.[1][2] |
| **Craig Reynolds** | Publishes the forward detection-box/cylinder concept, speed-dependent look-ahead, closest-threat selection and steering-force model.[3][4][10] |
| **Velocity obstacles** | A recognized alternative for dynamic-agent avoidance, but not evidence that a particular listed racing game uses it.[6] |

## Concrete numbers: what is and is not published

The available sources provide concrete **geometric relationships**, but very few game-specific constants:

- Detection length: proportional to speed and vehicle agility, not a universal fixed distance.[4]
- Detection width: approximately the vehicle’s bounding width or bounding sphere diameter.[4]
- Threat selection: nearest predicted collision/intersection.[4][10]
- Lateral offsets: represented conceptually through racing-line offsets and danger values, but no universal metre value is published.[2]
- Reaction time: no verified commercial-game value is published.
- Pile-up spreading: separation and danger-map concepts are published, but no verified per-driver spacing or delay values are given.[2][3]
- Speed preservation: achieved by selecting a safe route and adjusting desired velocity, but no verified production speed thresholds are given.[1][4]

Thus, a defensible reconstruction is: **long-range spline/corridor occupancy identifies viable left/right routes; short-range swept-volume or ray-based prediction handles imminent threats; candidate routes are scored for clearance, curvature and speed; separation, reservations and varied reaction timing prevent synchronized pile-ups; and a bounded-force controller restores the racing line after the car clears the obstruction.** The exact metres, seconds, ray layouts and tuning constants for the named games remain unpublished in the cited material.

[1] www.gameaipro.com · GameAIPro · GameAIPro_Chapter38An Architecture Overview for AI in Racing Games - Game AI Pro (https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter38_An_Architecture_Overview_for_AI_in_Racing_Games.pdf)
[2] [PDF] Context Steering - Game AI Pro (https://www.gameaipro.com/GameAIPro2/GameAIPro2_Chapter18_Context_Steering_Behavior-Driven_Steering_at_the_Macro_Scale.pdf)
[3] Steering Behaviors - red3d.com (http://www.red3d.com/cwr/temp/2013_Steering_Behaviors.pdf)
[4] Steering Behaviors For Autonomous Characters - red3d.com (https://www.red3d.com/cwr/steer/gdc99/)
[5] 481 (http://www.gameaipro.com/GameAIPro/GameAIPro_Chapter39_Representing_and_Driving_a_Race_Track_for_AI_Controlled_Vehicles.pdf)
[6] Game AI Systems | Andrews Notebook - andrewaltimit.github.io (https://andrewaltimit.github.io/Documentation/docs/ai-ml/game-ai.html)
[7] skill-slice/skills/game-ai-behavior/SKILL.md at main ... - GitHub (https://github.com/Kayforkind/skill-slice/blob/main/skills/game-ai-behavior/SKILL.md)
[8] City, University of London Institutional Repository (https://openaccess.city.ac.uk/id/eprint/7123/1/GAME_AI_01.pdf)
[9] Methods for Combining Autonomous Steering Behaviours (https://alastaira.wordpress.com/2013/03/13/methods-for-combining-autonomous-steering-behaviours/)
[10] Autonomous Movement Introduction Craig Reynolds ... (http://web.cs.wpi.edu/~imgd4000/d16/slides/movement.pdf)
