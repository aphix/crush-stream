> Question: How do third-person games (GTA V, Red Dead Redemption 2, The Last of Us Part II, Assassin's Creed, Uncharted, Spider-Man) handle a character sprinting in one direction and then changing direction: sharp 90-180 degree turns, plant-and-pivot, skid/stop-and-turn animations, lean into curves, turn-in-place? Cover the kinematics (deceleration, how momentum carries, lean angle vs speed and turn rate, banking), foot placement (plant foot choice, IK foot locking to prevent sliding), how the system decides between a smooth curved turn and a planted pivot by angle and speed thresholds, how long these transitions take, and techniques such as motion matching, root motion vs capsule-driven movement, desired-velocity springs, and procedural foot planting. Give concrete numbers (angles, seconds, m/s^2) and sources (GDC talks, papers).

The games listed generally combine **animation-driven locomotion, predictive turning, and procedural foot correction** rather than applying a single physically simulated maneuver. Exact production thresholds for GTA V, Red Dead Redemption 2, The Last of Us Part II, Uncharted, Assassin’s Creed, and Spider-Man are rarely public, so the numerical values below are representative implementation ranges—not confirmed settings for each title.

## What the player usually sees

| Situation | Typical behavior |
|---|---|
| Small heading change, roughly \(0^\circ\)–\(30^\circ\) | Continue the stride on a shallow curve; rotate pelvis, torso, and feet progressively |
| Moderate change, roughly \(30^\circ\)–\(90^\circ\) | Use a curved turn or a turn-specific locomotion clip; decelerate slightly |
| Sharp turn, roughly \(90^\circ\)–\(135^\circ\) | Plant the next available foot, brake, rotate the body around it, then launch in the new direction |
| Reversal, roughly \(135^\circ\)–\(180^\circ\) | Usually stop-and-turn, pivot, or use a dedicated reversal clip; continuing momentum is strongly reduced |
| Low-speed heading change | Turn in place or use short directional steps |
| High-speed heading change | Lean, widen the step, brake, and use a larger-radius curve or planted pivot |

Motion matching systems can select these outcomes directly from captured data. Ubisoft’s Motion Matching presentation describes searching a mocap database for a pose that matches both the current pose and the desired future path, eliminating the need to manually author every start, stop, and turn transition.[10]

## Kinematic model

A practical controller commonly maintains a desired horizontal velocity \(\mathbf v_d\), current velocity \(\mathbf v\), and facing direction \(\mathbf f\). A critically damped or spring-like update is often used:

\[
\dot{\mathbf v}=k(\mathbf v_d-\mathbf v)
\]

with acceleration clamped to a gameplay range. Plausible values are:

- Walk acceleration: \(2\)–\(4\ \mathrm{m/s^2}\)
- Run acceleration: \(3\)–\(6\ \mathrm{m/s^2}\)
- Sprint acceleration: \(4\)–\(8\ \mathrm{m/s^2}\)
- Sprint braking: \(5\)–\(10\ \mathrm{m/s^2}\)
- Ordinary sprint speed: approximately \(5\)–\(8\ \mathrm{m/s}\)

At \(7\ \mathrm{m/s}\), braking at \(7\ \mathrm{m/s^2}\) takes about \(1.0\) second and covers roughly \(3.5\) meters. Games frequently cheat this result: a sharp reversal may visually take \(0.45\)–\(0.9\) seconds while the collision capsule slows more quickly, redirects immediately, or follows authored root motion.

A common rotation limit is speed-dependent:

\[
\omega_{\max}(v)=\frac{v}{R_{\min}}
\]

For a minimum running turn radius of \(2.5\)–\(5\) meters, a character moving at \(6\ \mathrm{m/s}\) turns at roughly \(69^\circ\)–\(138^\circ/\mathrm{s}\). A \(90^\circ\) curved turn therefore takes approximately \(0.65\)–\(1.3\) seconds. A planted pivot can visually rotate through \(90^\circ\) in about \(0.35\)–\(0.7\) seconds, but it usually includes braking before the actual pivot.

## Momentum and the choice between curve and pivot

The decision is usually based on both **angle** and **speed**, not angle alone. A representative policy is:

- Below \(30^\circ\): preserve most velocity and bend the trajectory.
- \(30^\circ\)–\(75^\circ\): reduce speed by \(10\%\)–\(30\%\), increase yaw rate, and search for a curved turn.
- \(75^\circ\)–\(120^\circ\): trigger a braking or planted-turn animation if speed exceeds roughly \(3\)–\(4\ \mathrm{m/s}\).
- Above \(120^\circ\): use a stop-and-turn, reversal, or pivot unless the character is already moving slowly.
- At less than \(1\)–\(2\ \mathrm{m/s}\): turn-in-place clips become preferable.

The thresholds are normally softened with hysteresis so the system does not alternate between “curve” and “pivot” when the input hovers near a boundary. Future path prediction also matters: motion matching searches for a pose and trajectory that satisfy the upcoming movement, rather than merely matching the instantaneous stick direction.[6][10]

## Leaning and banking

For a turn at speed \(v\) and radius \(R\), the ideal lateral acceleration is

\[
a_{\text{lat}}=\frac{v^2}{R}
\]

and a physically inspired lean angle is

\[
\theta=\tan^{-1}\left(\frac{v^2}{gR}\right).
\]

Examples:

- \(v=4\ \mathrm{m/s}, R=5\ \mathrm{m}\): \(\theta\approx18^\circ\)
- \(v=6\ \mathrm{m/s}, R=4\ \mathrm{m}\): \(\theta\approx42^\circ\)
- \(v=7\ \mathrm{m/s}, R=3\ \mathrm{m}\): \(\theta\approx59^\circ\)

Games usually cap and art-direct this result. A human-like sprint turn may use roughly \(5^\circ\)–\(20^\circ\) of whole-body lean, with additional spine and shoulder rotation. Spider-Man-style traversal can use much larger banking because the character is attached to a highly stylized movement model; the visual lean is not necessarily consistent with the capsule’s actual curvature.

The lean is commonly distributed over:

- Root and pelvis: small counter-rotation or lateral displacement
- Spine and chest: primary visual lean
- Head: stabilization toward the camera or target
- Outside shoulder: raised or opened during the turn
- Inside leg: shortened and angled toward the center of curvature

## Foot placement and the planted pivot

A planted turn typically follows this sequence:

1. Detect a large change in desired heading.
2. Select a turn animation whose next contact foot is compatible with the turn direction.
3. Brake the root or capsule during the approach.
4. Lock the contacting foot in world space.
5. Rotate the pelvis and root around that support foot.
6. Release the planted foot and place the opposite foot toward the new trajectory.
7. Accelerate out of the turn.

The preferred plant is not always simply “the outside foot.” It depends on animation phase, turn direction, current support foot, and the available clip. If the character is already about to place the left foot, a left-turn clip may be selected if that produces a stable outside plant; otherwise the system can wait a few frames or choose a different transition.

Foot locking aims for approximately zero world-space foot velocity during contact. The procedural correction must compensate for both body translation and rotation; otherwise the shoe slides as the character pivots.[1] A typical implementation:

- Mark heel/toe contact in animation data.
- Save the foot’s world transform when contact begins.
- Solve the leg with two-bone IK.
- Blend the target during the first \(50\)–\(120\) ms.
- Maintain the lock for roughly \(100\)–\(350\) ms.
- Unlock when the foot leaves the ground, reaches an extension limit, or the animation’s contact label ends.

Motion-matching research similarly uses contact labels, inertialization, and analytical two-joint IK to preserve a foot’s locked position while blending to a new pose.[2]

## Smooth curves versus hard pivots

A robust locomotion system often evaluates a candidate turn using a cost function such as

\[
C=w_a|\Delta\theta|+w_v|\Delta v|+w_pE_{\text{pose}}+w_fE_{\text{foot}}+w_tE_{\text{trajectory}},
\]

where the terms measure heading error, required speed change, pose mismatch, foot-placement error, and future trajectory error.

A curved turn is favored when:

- The requested angular change is small.
- Current speed is compatible with the required radius.
- The next foot contact can remain inside a natural stride.
- The future path does not require crossing the character’s support polygon.

A planted pivot is favored when:

- The heading error is large.
- The required turn radius is below the animation’s believable minimum.
- Current speed is too high for a clean curve.
- The next contact foot can provide a stable support point.
- A reversal is requested while the character is in a braking phase.

Typical transition durations:

- Blend between ordinary locomotion clips: \(80\)–\(200\) ms
- Start or stop: \(250\)–\(600\) ms
- Running \(90^\circ\) turn: \(450\)–\(900\) ms
- Hard reversal: \(600\)–\(1200\) ms
- Turn-in-place \(90^\circ\): \(350\)–\(800\) ms
- Turn-in-place \(180^\circ\): \(700\)–\(1400\) ms

These values describe the visible animation and blend window; the gameplay controller may redirect the capsule earlier.

## Root motion versus capsule-driven movement

### Root-motion-heavy approach

The animation supplies displacement and rotation. The controller consumes the root transform and moves the collision body accordingly. This preserves the captured relationship between stride length, braking, hip motion, and foot contact. Root motion is especially valuable for:

- Planted pivots
- Stops and starts
- Vaults and traversal
- Combat locomotion
- Cinematic or highly authored movement

The main risk is responsiveness: if the animation says the character needs \(0.8\) seconds to complete a turn, immediate player input may feel delayed.

### Capsule-driven approach

The gameplay controller determines velocity, acceleration, collision, and facing. Animation follows that movement through blend spaces, pose warping, stride warping, IK, and inertialization. This is preferable when:

- Collision must be authoritative.
- The player needs immediate directional control.
- Movement occurs over unpredictable terrain.
- Network synchronization matters.

The main risk is foot sliding and visibly inconsistent momentum. Procedural foot placement and stride adjustment compensate for the discrepancy.

### Hybrid approach

Most high-end third-person systems use a hybrid:

- Capsule or character controller owns collision and broad trajectory.
- Animation supplies local stride timing and body mechanics.
- Root motion is selectively extracted for authored actions or difficult turns.
- IK locks feet to the ground.
- Animation warping adjusts stride length and orientation.
- Motion matching or a locomotion graph selects the next pose.

A root-motion implementation must avoid applying both extracted root rotation and an independent scripted rotation, which can cause the character to rotate twice.[1]

## How the named games likely differ

- **GTA V:** Primarily responsive capsule-driven locomotion with authored directional blends, braking, pivots, and contextual animations. Sharp reversals are usually stylized rather than physically continuous.
- **Red Dead Redemption 2:** More animation-led and deliberate. Longer braking, stronger weight transfer, foot plants, and terrain-aware transitions make direction changes feel heavier.
- **The Last of Us Part II:** Strongly authored and context-sensitive, with highly visible weight shifts, planted feet, and animation transitions selected around combat intent and environment.
- **Uncharted:** Similar authored cinematic logic, but transitions are often biased toward readability and camera composition rather than strict physical continuity.
- **Assassin’s Creed:** Commonly uses responsive locomotion blended with parkour-specific root-motion clips. Direction changes during free running may prioritize traversal alignment over realistic braking.
- **Spider-Man:** Uses a highly specialized traversal model. The desired path, camera direction, surface attachment, and acrobatic pose can override ordinary bipedal sprint mechanics; banking and body orientation are deliberately exaggerated.

Public material confirms the general technology—motion matching searches long captured sequences for the current pose and future desired motion, with small blends between matching frames.[10] Public sources do not establish title-specific values such as “GTA V pivots at \(103^\circ\)” or “The Last of Us uses exactly \(6\ \mathrm{m/s^2}\) braking,” so such numbers should be treated as reconstruction targets rather than verified proprietary parameters.

[1] locomotion-godot/docs/educational_guide.md at main · Johnz86/locomotion-godot (https://github.com/Johnz86/locomotion-godot/blob/main/docs/educational_guide.md)
[2] Chapter 1 Introduction (https://arxiv.org/html/2310.05215)
[3] A Motion Matching plugin for Godot 4 (https://github.com/GuilhermeGSousa/godot-motion-matching)
[4] Character Control with Neural Networks and Machine Learning (https://www.youtube.com/watch?v=o-QLSjSSyVk&ab_channel=GDC&type=link)
[5] Character Locomotion in Half-Life: Alyx - SIGGRAPH 2021 (https://www.youtube.com/watch?v=RCu-NzH4zrs)
[6] Take 'Control' of Animation (https://www.youtube.com/watch?v=JH69g7yA7QM)
[7] Returning to Red Dead Redemption 2 (https://www.youtube.com/watch?v=gcRleWwWpsY)
[8] VRIK - RootMotion (https://www.root-motion.com/finalikdox/html/page16.html)
[9] Rupayan Debnath | LinkedIn (https://www.linkedin.com/in/rupayan5)
[10] GDC 2016: Simon Clavet - "Motion Matching and The Road to Next ... (https://archive.org/details/GDC2016Clavet)
