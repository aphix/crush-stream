> Question: What are the most useful published sources (books, conference talks, papers, postmortems) on designing third-person follow cameras for action and open-world games, both on foot and in vehicles? What concrete practices and numbers do they give (distances, heights, field of view, lag, collision handling, recentering, input response), and what common mistakes do they name? Cite sources.

The most useful public material falls into three groups: **practical implementation guides**, **design articles and theses**, and **research/postmortems**. The strongest sources for concrete engineering decisions are the Game Developer free-move-zone article, Unity/Cinemachine and Godot documentation, the third-person-camera thesis, and the vehicle-camera research example.

## Best sources

| Source | Why it is useful | Concrete guidance |
|---|---|---|
| **“Third person camera design with free move zone,” Game Developer** | One of the clearest descriptions of a production-style follow-camera state machine. | Defines a “free move zone” around the character: the camera does not react to every small displacement, then moves the target back inside the zone when the character exits it. Collision takes priority over other camera rules; the camera uses a volume, slides along surfaces, and has a minimum distance. Occlusion recovery is ordered from least disruptive to most disruptive: rotate around the character, move closer while preserving minimum distance, rotate while moving closer, and only then violate the minimum distance.[2] |
| **Unity Cinemachine 3rd Person Follow documentation** | Practical reference for a configurable action-game camera rig. | Uses a follow target, shoulder offset, damping, target tracking, and built-in collision resolution. The rig bends or stretches when approaching an obstacle so the camera remains outside geometry while keeping the target visible. It also exposes collision filtering, which is essential for excluding the player and selecting camera-relevant world geometry.[5] |
| **Godot SpringArm3D documentation** | A concise implementation model for collision-aware third-person cameras. | Recommends a pivot → spring arm → camera hierarchy. The spring arm casts a shape toward the camera and places the camera at or near the collision point rather than allowing it to enter geometry. This is a good baseline for a camera that retracts in narrow spaces.[3] |
| **“How Camera Placement Affects Gameplay in Video Games,” academic paper** | Useful design overview and literature entry point. | Describes third-person cameras as generally close behind the character, showing the body and surrounding space. It notes that the camera follows movement but need not mechanically follow orientation—a useful distinction for avoiding unwanted sickness and over-rotation.[4] |
| **“Virtual Camera Systems in Current Generation Third Person Action Games,” thesis** | A focused academic treatment of camera systems in third-person action games. | Useful for comparing camera behaviors and identifying design trade-offs, particularly the separation between player-controlled orientation, automatic follow behavior, and obstruction handling.[7] |
| **“Global Illumination for Fun and Profit,” vehicle-camera research** | Although primarily a rendering paper, it provides explicit vehicle-camera placements useful as reference points. | Gives example third-person car views approximately **19 m behind the car**, with a low camera angle around **15°** and a high angle around **60°**. These are research examples rather than universal gameplay recommendations, but they are unusually concrete published numbers.[10] |
| **Middle-earth: Shadow of Mordor postmortem** | Valuable for the design principle behind combat cameras. | Emphasizes that controls and camera behavior must support the player’s intention at all times. It is less useful for numeric tuning than for prioritization: the camera should not fight targeting, traversal, or combat input.[6] |

## Practical numbers and starting ranges

Published sources rarely prescribe one universal camera distance or damping value. They usually describe **relationships, constraints, and ordering rules** rather than fixed numbers. The clearest explicit values found are the vehicle examples: roughly **19 m** behind the vehicle at approximately **15°** and **60°** elevation.[10]

For an action game, reasonable starting ranges—treated as tuning hypotheses rather than published standards—are:

| Parameter | Useful starting range | What to tune for |
|---|---:|---|
| On-foot distance | **3–6 m** | Character readability versus spatial awareness |
| On-foot camera height above pivot | **1.5–3 m** | Ground visibility, aiming, and obstacle anticipation |
| Horizontal shoulder offset | **0.3–0.8 m** | Over-the-shoulder readability and target visibility |
| Vertical look-ahead | **0.5–1.5 m** above the character’s root | Keeps the camera from staring at the feet |
| Horizontal field of view | **60–75°** | Wider values improve peripheral awareness but increase distortion and motion |
| Vehicle distance | **8–20 m**, depending on vehicle speed and scale | Higher speed requires more view ahead and more braking distance |
| Vehicle elevation | **10–25°** for grounded driving; higher for strategic visibility | Too low hides upcoming road geometry; too high weakens speed sensation |
| Collision margin | Roughly **0.1–0.3 m** for a human-scale character | Prevents near-plane and corner clipping |
| Position lag | About **0.05–0.2 s** for responsive action; **0.2–0.5 s** for heavier vehicles | More lag gives weight but harms precision |
| Rotation lag | About **0.05–0.15 s** on foot; **0.15–0.4 s** in vehicles | Separate rotational and positional smoothing |
| Collision retract speed | Fast—typically near-immediate or under **0.1–0.2 s** | Prevents the camera entering walls |
| Collision recovery | Slower—roughly **0.3–1 s** | Prevents visible popping and oscillation |
| Recenter delay | Commonly **0.3–1 s** after manual input ends | Avoids fighting the player’s camera control |

These ranges are engineering starting points, not claims that the cited publications mandate those exact values. The published guidance strongly supports using a free-look region, damping, collision volumes, and distinct inward/outward response rates.[2][3][5]

## Recommended camera architecture

### 1. Separate desired and constrained poses

Compute the pose the player and game systems want first:

- Desired pivot position
- Desired yaw and pitch
- Desired distance
- Shoulder offset
- Look-at point
- Vehicle-specific look-ahead

Then perform collision resolution against that pose. Do not overwrite the desired orbit permanently when an obstruction occurs. The camera should retract temporarily and return to the intended distance and shoulder position when the obstruction clears. This follows the free-move-zone and spring-arm approach: collision is a constraint on the camera pose, not a new player-controlled orbit.[2][3]

### 2. Use a volume, not a center ray

A single ray from the character to the camera misses corner clipping and near-plane intersections. Use a swept sphere, capsule, or camera-volume approximation. The free-move-zone article explicitly describes a camera collider that cannot enter geometry and slides along surfaces, while spring-arm systems use a shape cast to place the camera at the collision point.[2][3]

Recommended procedure:

1. Build the unconstrained camera endpoint.
2. Sweep a sphere or capsule from the pivot toward that endpoint.
3. Retract to the first valid collision point.
4. Apply a small collision margin.
5. Smooth outward recovery separately from inward obstruction response.
6. Exclude the controlled character and irrelevant trigger/effect geometry from the collision mask.

### 3. Preserve player intent during collision

Collision handling should normally prefer, in order:

1. Keep the player visible.
2. Preserve the player’s manual yaw and pitch.
3. Preserve shoulder side and intended orbit.
4. Reduce distance.
5. Rotate only as a fallback.
6. Penetrate or hide the character only as a last resort.

This ordering is consistent with the published free-move-zone guidance, which prioritizes collision safety and recommends rotating before aggressively reducing distance, while treating violation of minimum distance as the final option.[2]

### 4. Use free-look and delayed recentering

Do not attach the camera rigidly to the character’s facing direction. A free-look zone lets the character move without causing constant camera motion; recenter only after the player stops providing camera input and only when the character is meaningfully outside the intended framing region.[2]

A robust policy is:

- Manual camera input has immediate priority.
- Disable automatic recentering while input is active.
- Add a short delay after input ends.
- Recenter gradually toward movement direction.
- Cancel or weaken recentering during aiming, lock-on, climbing, narrow traversal, or precision driving.
- Never rotate solely to solve a minor obstruction if retracting preserves the player’s view.

The academic overview similarly distinguishes following character movement from following character orientation, supporting a camera that tracks position without mechanically copying every facing change.[4]

### 5. Tune position and rotation independently

A character can change direction quickly without needing the camera to snap. Use separate filters for:

- Camera position
- Camera yaw
- Camera pitch
- Distance
- Look-at point
- Collision recovery

For on-foot action, rotation usually needs to feel more immediate than distance recovery. For vehicles, position and yaw can lag more to convey mass, but collision retraction must remain fast enough to prevent wall penetration.

### 6. Give vehicles their own camera mode

A vehicle camera should not merely reuse the on-foot camera with a larger distance. It generally needs:

- More look-ahead in the direction of travel
- A wider or speed-dependent field of view
- Greater distance at high speed
- Smoother yaw response
- Reduced recentering while drifting or turning sharply
- A stable relationship to the vehicle’s velocity vector rather than only its forward axis
- Different collision behavior around walls, tunnels, and roadside objects

The published vehicle-camera example demonstrates the scale difference clearly: its reference views place the camera approximately 19 m behind the car, with either a low 15° or high 60° angle.[10] In an actual action game, those values would normally be adapted to vehicle size, speed, and camera purpose.

## Common mistakes

- **Following the character’s rotation one-to-one.** This creates constant camera noise and can induce discomfort; following movement does not require copying orientation.[4]
- **Using a single ray for collision.** Rays miss camera-volume and near-plane clipping at corners; a swept volume is safer.[2][3]
- **Letting collision logic permanently alter the orbit.** The camera should return to the player’s intended distance, shoulder, and angle after the obstruction clears.[2][3]
- **Recovering outward as fast as retracting inward.** Symmetric smoothing causes popping and oscillation in doorways and around corners. Fast retraction plus slower recovery is the safer pattern.
- **Allowing automatic recentering to fight manual input.** Player camera input should override recentering and autonomous camera rotation.[2][6]
- **Ignoring a minimum distance.** Sliding along floors or ceilings can pull the camera too close to the character; the free-move-zone design explicitly warns against violating the minimum distance except as a last resort.[2]
- **Treating all geometry as camera geometry.** The collision mask should exclude the player and irrelevant objects while retaining walls, ceilings, terrain, and important occluders.[5]
- **Using one camera tuning profile for walking and driving.** Vehicle speed, scale, look-ahead, and inertia require different distance, lag, and collision settings.
- **Optimizing for a mathematically smooth camera instead of player intention.** The Shadow of Mordor postmortem’s central principle is that camera and controls must support what the player is trying to do, especially during combat.[6]
- **Relying on fixed numbers without testing context.** The published sources mostly provide systems and constraints rather than universal distances or damping constants; numbers must be validated against character scale, movement speed, level density, and target platform.[2][3][5]

A practical implementation baseline is therefore: **free-look pivot, separate desired/constrained poses, swept-volume collision, fast inward retraction, slow outward recovery, delayed recentering, independent position/rotation damping, and distinct on-foot and vehicle profiles**. The Game Developer article is the best single design source for the behavior hierarchy, while Cinemachine and SpringArm3D are the most useful implementation references.[2][3][5]

[1] Third Person Follow (3D) (https://phantom-camera.dev/follow-modes/third-person)
[2] Third person camera design with free move zone - Game Developer (https://www.gamedeveloper.com/design/third-person-camera-design-with-free-move-zone)
[3] Third-person camera with spring arm - Godot Docs (https://docs.godotengine.org/en/latest/tutorials/3d/spring_arm.html)
[4] How Camera Placement Affects Gameplay in Video Games This research has been co-financed by the European Union and Greek national funds through the Operational Program Competitiveness, Entrepreneurship and Innovation, under the call RESEARCH – CREATE – INNOVATE (project Mediludus, code: T2EDK-03049) (https://ar5iv.labs.arxiv.org/html/2109.03750)
[5] 3rd Person Follow | Cinemachine | 2.10.7 (https://docs.unity3d.com/Packages/com.unity.cinemachine@2.10/manual/Cinemachine3rdPersonFollow.html)
[6] Postmortem: Monolith Productions' Middle-earth: Shadow of Mordor (https://www.gamedeveloper.com/audio/postmortem-monolith-productions-i-middle-earth-shadow-of-mordor-i-)
[7] 1 (https://uu.diva-portal.org/smash/get/diva2:628121/FULLTEXT01.pdf)
[8] Implement stable third-person exploration and raised-weapon ... (https://github.com/adventure-simulator-group/fabelgeist/issues/424)
[9] Third person camera (https://wiki.gdevelop.io/gdevelop5/extensions/third-person-camera/)
[10] Global Illumination for Fun and Profit (https://www.csse.canterbury.ac.nz/andrew.cockburn/papers/steer.pdf)
