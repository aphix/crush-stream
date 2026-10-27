> Question: For a procedurally animated or physics-driven (active ragdoll, joint-motor) humanoid in a game, what makes walking and running look natural rather than stiff or doll-like? Give the human gait kinematics a procedural gait should reproduce, with numbers: joint angle ranges per cycle for hip, knee, ankle, pelvis rotation/tilt/obliquity, shoulder counter-rotation and arm swing (shoulder and elbow), trunk lean vs speed, vertical centre-of-mass bob, stride length and cadence vs speed for walking and running (including the run's flight phase), heel strike to toe-off timing; plus game techniques (procedural animation layers, inverse kinematics foot placement, secondary motion/lag on head and arms, motor stiffness tuning so limbs aren't rigid) used in games like GTA V (Euphoria), Gang Beasts, Totally Accurate Battle Simulator and in papers on physics-based locomotion. Cite sources.

Natural procedural locomotion is not just a sinusoidal leg animation. It combines **phase-correct gait kinematics**, foot–ground constraints, whole-body balance, compliant joint control, and secondary motion. Human walking normally has about **60% stance and 40% swing**, while running introduces a flight phase in which neither foot contacts the ground.[3]

## Reference gait numbers

Values vary with subject, footwear, speed, and angle conventions. The following are useful **game-development targets**, not rigid anatomical limits. Angles are approximate sagittal-plane excursions relative to a neutral standing pose.

| Quantity | Walking target | Running target |
|---|---:|---:|
| Speed | \(0.8\text{–}1.8\ \mathrm{m/s}\) | \(2.0\text{–}6+\ \mathrm{m/s}\) |
| Cadence | \(100\text{–}130\) steps/min; comfortable adults often roughly \(114\text{–}129\) steps/min[3] | \(150\text{–}210+\) steps/min |
| Cycle time | \(0.9\text{–}1.2\ \mathrm{s}\) | \(0.55\text{–}0.8\ \mathrm{s}\) |
| Step length | \(0.5\text{–}0.8\ \mathrm{m}\); reported adult averages are approximately \(0.56\text{–}0.65\ \mathrm{m}\) across walking speeds[8] | \(0.9\text{–}1.8\ \mathrm{m}\) |
| Stride length | \(1.0\text{–}1.6\ \mathrm{m}\) | \(1.8\text{–}3.6\ \mathrm{m}\) |
| Stance | About \(60\%\) | Roughly \(35\text{–}50\%\), decreasing as speed rises |
| Swing | About \(40\%\) | Roughly \(30\text{–}40\%\) |
| Double support | About \(20\%\) of the cycle at ordinary walking speeds | None in a normal running gait |
| Flight phase | None | Approximately \(5\text{–}20\%\) of the cycle, depending on speed and running style |

Walking speed increases through both **cadence and stride length**; one reference dataset found cadence rising from \(1.68\) to \(2.14\) steps/s and step length from \(0.56\) to \(0.65\ \mathrm{m}\) as speed increased.[8] Do not increase cadence alone: that produces a shuffling, “treadmill” appearance.

### Lower-limb joint motion

Use these as approximate peak-to-peak ranges for one complete gait cycle:

| Joint | Walking | Running | Important phase behavior |
|---|---:|---:|---|
| Hip flexion/extension | About \(30\text{–}45^\circ\) total; roughly \(10\text{–}20^\circ\) extension to \(25\text{–}35^\circ\) flexion | About \(50\text{–}70^\circ\) total | Extension peaks late stance; flexion peaks during late swing |
| Knee flexion/extension | About \(55\text{–}65^\circ\) total; approximately \(0\text{–}5^\circ\) at contact, \(15\text{–}20^\circ\) in loading response, \(55\text{–}65^\circ\) in swing | About \(90\text{–}130^\circ\) total; commonly \(80\text{–}120^\circ\) peak swing flexion | A small “shock absorber” bend after heel strike, then large swing flexion |
| Ankle dorsiflexion/plantarflexion | About \(25\text{–}35^\circ\) total; approximately \(5\text{–}10^\circ\) dorsiflexion in midstance and \(15\text{–}25^\circ\) plantarflexion at toe-off | About \(35\text{–}50^\circ\) total | Heel strike is near neutral or slight dorsiflexion; plantarflexion accelerates toe-off |
| Foot progression | Roughly \(5\text{–}15^\circ\) toe-out | Often \(5\text{–}15^\circ\), with more variation | Avoid pointing both feet identically during turns |

A recent gait review reports typical peak knee flexion of about \(60^\circ\) during swing and about \(20^\circ\) during stance.[3] Reference gait data also report ankle dorsiflexion around \(14\text{–}16^\circ\) and plantarflexion around \(18\text{–}19^\circ\), with speed affecting knee and ankle timing and amplitude.[8]

### Pelvis and trunk

| Motion | Walking target | Running target |
|---|---:|---:|
| Pelvic transverse rotation | About \(8\text{–}12^\circ\) peak-to-peak | About \(10\text{–}16^\circ\) |
| Pelvic tilt, sagittal | About \(5\text{–}10^\circ\) peak-to-peak | About \(5\text{–}12^\circ\) |
| Pelvic obliquity, frontal plane | About \(4\text{–}8^\circ\) peak-to-peak | About \(4\text{–}10^\circ\) |
| Shoulder-girdle counter-rotation | About \(8\text{–}15^\circ\) peak-to-peak relative to pelvis | About \(12\text{–}25^\circ\) |
| Shoulder flexion/extension arm swing | Roughly \(20\text{–}40^\circ\) | Roughly \(35\text{–}70^\circ\) |
| Elbow angle | Usually \(15\text{–}35^\circ\) bend variation | Usually held around \(70\text{–}110^\circ\), with \(10\text{–}25^\circ\) variation |
| Trunk lean | Near upright; about \(0\text{–}5^\circ\) forward | About \(5\text{–}15^\circ\) forward, increasing with acceleration |
| Centre-of-mass vertical excursion | About \(2\text{–}5\ \mathrm{cm}\) peak-to-peak | About \(4\text{–}10\ \mathrm{cm}\), usually higher with faster running |

Pelvic motion should not be a decorative sine wave. During double support, the pelvis rotates forward over the loading limb and backward over the limb preparing for toe-off; during midstance, it drops slightly toward the swing side.[2] These small motions make the legs appear to lengthen and shorten naturally and reduce an obviously mechanical centre-of-mass path.

## Event timing

For walking, define phase \(0\%\) as heel strike:

- **Heel strike / initial contact:** \(0\%\)
- **Loading response:** \(0\text{–}10\%\)
- **Midstance:** \(10\text{–}30\%\)
- **Terminal stance:** \(30\text{–}50\%\)
- **Pre-swing and toe-off:** approximately \(50\text{–}60\%\)
- **Initial and midswing:** \(60\text{–}85\%\)
- **Terminal swing:** \(85\text{–}100\%\)
- The opposite foot usually contacts at approximately \(50\%\), creating double support early and late in the cycle.

The exact split changes with speed. At fast walking, heel contact may become flatter or forefoot-biased; at running speeds, replace heel-strike logic with a landing event and preserve a genuine airborne interval.

For running:

- Landing: approximately \(0\%\)
- Early stance and impact absorption: \(0\text{–}15\%\)
- Mid-to-late stance and propulsion: \(15\text{–}35\%\)
- Toe-off: approximately \(30\text{–}45\%\)
- Flight: approximately \(35\text{–}55\%\)
- Next landing: \(100\%\)

Running should therefore have a visible **compression–extension–flight** sequence. A character that always keeps one foot planted is doing a fast walk, not a run.

## Why physics-driven characters look stiff

The common failure is using high-gain position motors to force every joint onto an animation curve. That makes limbs track accurately but removes compliance, timing errors, impact absorption, and momentum. Physics-based animation instead treats the body as constrained rigid segments driven by actuator torques; joint-torque work commonly uses proportional–derivative control based on desired-versus-current angular error.[1][6]

A useful controller is:

\[
\tau =
K_p(\theta_d-\theta)
+
K_d(\dot{\theta}_d-\dot{\theta})
+
\tau_{\mathrm{feedforward}}
\]

where \(K_p\) controls positional stiffness and \(K_d\) controls damping. In practice:

- Use **high stiffness** for the stance ankle, pelvis orientation, and gross torso balance.
- Use **moderate stiffness** for hips and knees.
- Use **lower stiffness** for shoulders, elbows, wrists, neck, and sometimes the swing leg.
- Increase damping enough to prevent oscillation, but avoid critical-looking, perfectly settled motion.
- Reduce motor strength during impact and allow a few degrees of tracking error.
- Use torque, angular-speed, and joint-limit clamps so a strong controller cannot snap limbs into place.
- Add strength scaling based on contact state: the stance leg supports; the swing leg remains relatively loose.
- Let collisions and external impulses perturb the pose, then recover over several frames rather than correcting instantly.

The desired pose should be a **reference**, not an inviolable command. A physically plausible character has small timing and angular errors.

## Procedural animation stack

A robust game implementation usually layers controls from global to local:

1. **Locomotion phase generator**
   - Drive phase from traveled distance or speed, not only from elapsed time:
     \[
     \dot{\phi}=\frac{v}{L(v)}
     \]
     where \(L(v)\) is the speed-dependent stride length.
   - Blend walking, transitional gait, running, stopping, turning, and strafing rather than switching abruptly.

2. **Base gait curves**
   - Generate hip, knee, ankle, pelvis, shoulder, and elbow targets from phase-dependent curves.
   - Use asymmetric curves: impact and push-off should not mirror each other.
   - Add speed-dependent amplitude and timing changes.

3. **Foot placement and inverse kinematics**
   - Raycast or sweep beneath the predicted foot position.
   - Place the sole on the surface normal, preserving a plausible ankle orientation.
   - Lock the planted foot in world space during stance; move it through an arc during swing.
   - Adjust pelvis height and lateral position when terrain changes.
   - Use a two-bone IK solve for hip–knee–ankle, with a stable knee pole target.
   - Add toe clearance, heel-roll, toe-roll, and a small slip tolerance. Perfectly immobile feet can look robotic if the rest of the body is not adjusted.

4. **Balance and centre-of-mass control**
   - Continuously aim the projected centre of mass inside the support polygon.
   - Lean the pelvis and trunk toward acceleration, braking, and turning.
   - During a stumble, prioritize support-foot placement over exact pose tracking.

5. **Secondary motion**
   - Apply spring-damper lag to the head, chest, arms, hands, and weapon.
   - Let the head stabilize the horizon while the torso and pelvis move.
   - Counter-rotate shoulders against pelvis motion.
   - Add elbow and wrist noise or task-driven targets, but keep it low amplitude and bandwidth-limited.
   - Use different response times: pelvis fastest for balance, chest slightly delayed, head stabilized, hands most task-dependent.

6. **Contact and impact layer**
   - Detect heel strike, foot flat, toe-off, landing, and slipping.
   - Briefly increase stance-leg damping at contact, then release it during push-off.
   - Add subtle compression at the knee, hip, and ankle instead of stopping the body abruptly.

7. **Animation/physics blending**
   - Use animation to provide plausible intent and physics to resolve contacts and disturbances.
   - Blend by body region: feet and pelvis may be strongly grounded, while arms and torso remain physically responsive.
   - Fade motor targets during ragdoll transitions rather than disabling every joint simultaneously.

## Lessons from game-style active ragdolls

The defining visual quality of systems such as Euphoria-style animation is not simply “ragdoll physics.” It is the combination of procedural goals, balance reactions, contact handling, and variable joint strength. A physically simulated character can still look artificial if all joints are equally constrained.

For loose, comedic systems such as *Gang Beasts* or *Totally Accurate Battle Simulator*, the goal is different: exaggerated inertia, delayed limbs, weak stabilization, collisions, and underactuated bodies create the floppy style. For a natural humanoid, use the same physical responsiveness selectively:

- Keep the pelvis and stance leg competent.
- Make the upper body and swing limbs delayed but not limp.
- Allow collisions to redirect motion.
- Preserve momentum during turns and falls.
- Use task-specific constraints for hands, head, and gaze.
- Avoid identical motor gains on every joint.

The core test is whether the character’s **foot placement, centre of mass, pelvis, trunk, and arms agree about the same movement**. If the feet move at one rhythm while the pelvis is fixed, the legs look like pistons. If the pelvis moves but the feet slide, the character looks weightless. If the feet are grounded, the pelvis and trunk balance over them, and the arms and head lag naturally, even a relatively simple procedural gait can look convincingly human.

[1] Generating Upper-Body Motion for Real-Time Characters Making their way through Complex Environments (https://www.lix.polytechnique.fr/vista/vista-web-data/publications/2022_alvarado_sca/sca2022_alvarado.pdf)
[2] Kinematics of human gait (https://ouhsc.edu/bserdac/dthompso/web/gait/knmatics/gait.htm)
[3] Step‐by‐step insight into gait analysis: A narrative review unlocking ... (https://pmc.ncbi.nlm.nih.gov/articles/PMC13418446/)
[4] www.atlantis-press.com › article › 126014108Basics of Human Gait Analysis - Atlantis Press (https://www.atlantis-press.com/article/126014108.pdf)
[5] Effects of walking speed on gait biomechanics in healthy participants: a systematic review and meta-analysis - Systematic Reviews (https://systematicreviewsjournal.biomedcentral.com/articles/10.1186/s13643-019-1063-z)
[6] Joint-Torque Control of Character Motions: Active Animations (https://xbdev.net/misc_demos/demos/joints_torques_and_control/paper.pdf)
[7] Real-time Physics Based Character Control carrying (https://publications.scss.tcd.ie/theses/diss/2020/TCD-SCSS-DISSERTATION-2020-058.pdf)
[8] Three-Dimensional Human Gait Pattern: Reference Data for Young ... (https://pmc.ncbi.nlm.nih.gov/articles/PMC6335661/)
[9] Modeling the Kinematics of Human Locomotion over Continuously Varying Speeds and Inclines (https://www.ncbi.nlm.nih.gov/pmc/articles/6358210)
[10] Vol. 42 | No. 3 | SEPTEMBER - DECEMBER 2021 | pp 6-27 (https://www.scielo.org.mx/pdf/rmib/v42n3/2395-9126-rmib-42-03-1189.pdf)
