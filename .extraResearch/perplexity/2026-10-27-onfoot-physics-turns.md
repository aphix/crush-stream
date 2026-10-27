> Question: For a physics-based or procedurally animated biped (active ragdoll with joint motors, or procedural legs with IK), what control techniques make sharp direction changes at running speed look and feel right: foot placement strategies (capture point / SIMBICON-style balance feedback, raibert foot placement), leaning the torso and pelvis into the turn, a plant step on the outside foot for a cut, braking steps, and how to blend the gait phase through the change without foot sliding or tripping? Include formulas or gains where published (e.g. foot placement = velocity x time + feedback on COM offset), typical human cutting biomechanics (deceleration rates, number of braking steps, lean angles in a 45-90 degree cut at 5-7 m/s), and sources.

For a convincing sharp cut, treat the maneuver as a **multi-step momentum-redirection problem**, not as an instantaneous heading change. The controller should first brake, then redirect the center-of-mass (COM) velocity, while the pelvis, torso, swing foot, and contact timing anticipate the new direction.

## 1. Foot placement: combine nominal velocity placement with balance feedback

A useful Raibert-style target is

\[
\mathbf p_{\text{foot}}^*
=
\mathbf p_{\text{COM}}
+
T_{\text{step}}\mathbf v_{\text{COM}}
+
\mathbf K_p(\mathbf p_{\text{COM}}-\mathbf p_{\text{ref}})
+
\mathbf K_v(\mathbf v_{\text{COM}}-\mathbf v_{\text{ref}})
\]

where:

- \(T_{\text{step}}\) is the estimated time until touchdown,
- \(\mathbf p_{\text{ref}}\) is the desired COM position relative to the support foot,
- \(\mathbf v_{\text{ref}}\) is the desired velocity,
- \(\mathbf K_p,\mathbf K_v\) are feedback gains.

For a linear inverted-pendulum model, the capture point is

\[
\boldsymbol{\xi}
=
\mathbf p_{\text{COM}}
+
\frac{\mathbf v_{\text{COM}}}{\omega_0},
\qquad
\omega_0=\sqrt{\frac{g}{h}},
\]

where \(h\) is COM height. A foot placed near \(\boldsymbol{\xi}\) makes the current state capturable in one step. In practice, use the capture point as a **stability correction**, not as the entire target: add a nominal running stride displacement and clamp the lateral correction to the leg’s reachable workspace.

A compact implementation is:

\[
\mathbf p_{\text{td}}
=
\mathbf p_{\text{nominal}}
+
k_{\xi}
(\boldsymbol{\xi}-\mathbf p_{\text{td}})
+
k_v(\mathbf v_{\text{desired}}-\mathbf v_{\text{COM}}).
\]

Use larger lateral gain during a turn and larger fore–aft gain during braking. Saturate the correction and begin modifying the target before the current stance foot leaves the ground; waiting until late swing commonly causes overextended steps and toe catches.

SIMBICON uses feedback of the general form

\[
\theta_d=\theta_{d0}+c_d d+c_v v,
\]

with joint targets adjusted from COM or body-state errors. Its key design idea is to regulate the torso and stance-leg configuration during each step rather than prescribe a completely open-loop animation.[10]

## 2. Make the cut explicit in velocity space

At the turn trigger, define:

\[
\mathbf v_{\text{in}}=v\hat{\mathbf d}_{\text{old}},
\qquad
\mathbf v_{\text{out}}=v_{\text{out}}\hat{\mathbf d}_{\text{new}}.
\]

Do not instantly rotate the desired velocity. Instead, use a bounded acceleration or impulse profile:

\[
\dot{\mathbf v}_{\text{des}}
=
\operatorname{clip}
\left(
\frac{\mathbf v_{\text{out}}-\mathbf v_{\text{in}}}{T_{\text{redirect}}},
-a_{\max},a_{\max}
\right).
\]

For a \(90^\circ\) turn, the required velocity change is approximately

\[
\left\lVert\Delta \mathbf v\right\rVert
=
\sqrt{v_{\text{in}}^2+v_{\text{out}}^2}.
\]

At \(v=6\ \text{m/s}\), an instantaneous redirection would require a \(6\ \text{m/s}\) lateral velocity change even if speed were maintained, which is why human runners slow and distribute the maneuver across several contacts.

Blend the target direction with a smoothstep or minimum-jerk curve:

\[
\hat{\mathbf d}(s)
=
\operatorname{normalize}
\left[
(1-w(s))\hat{\mathbf d}_{\text{old}}
+w(s)\hat{\mathbf d}_{\text{new}}
\right],
\]

\[
w(s)=10s^3-15s^4+6s^5,\qquad 0\le s\le1.
\]

Use \(s\) based on **contact events or step phase**, rather than raw elapsed time, so the maneuver remains stable if the gait speeds up or slows down.

## 3. Torso and pelvis lean

The torso should lean toward the intended new direction before or during the plant, but the pelvis should not yaw instantaneously to match the final heading.

A useful whole-body target is:

\[
\boldsymbol{\theta}_{\text{torso}}^*
=
\boldsymbol{\theta}_{\text{neutral}}
+
k_a\frac{\mathbf a_{\text{COM}}}{g}
+
k_v(\mathbf v_{\text{des}}-\mathbf v_{\text{COM}}).
\]

For a steady lateral acceleration \(a_y\), the dynamic lean angle is approximately

\[
\theta_{\text{lean}}\approx \tan^{-1}\left(\frac{a_y}{g}\right).
\]

The torso and pelvis should be coordinated separately:

- **Torso:** lean toward the cut to place the COM over the intended support region.
- **Pelvis:** rotate progressively toward the new travel direction, preserving leg reach and avoiding excessive yaw torque.
- **Head/upper body:** stabilize more than the pelvis; excessive whole-body snap makes the turn look robotic.
- **During braking:** a modest backward component can help reduce forward momentum. Human cutting analyses specifically associate braking with a large COM–COP separation and backward trunk lean.[3]

Published human cutting reviews consistently report that sharper cuts require greater braking and that leaning toward the intended travel direction is associated with faster cutting.[3][8] Exact lean angles vary substantially with speed, technique, footwear, and whether “lean” means trunk angle, whole-body COM angle, or segment angle, so a single universal human value should not be hard-coded.

For animation, a practical starting range is:

- \(5\)–\(15^\circ\) lateral whole-body lean for a fast \(45^\circ\) cut,
- \(10\)–\(25^\circ\) for a hard \(90^\circ\) cut,
- larger values only when the character visibly lowers the COM and accepts a substantial speed loss.

These are controller starting points, not universal measured human constants.

## 4. Plant strategy: outside foot, braking steps, and cut step

For a leftward cut, the **outside foot** is the right foot. It normally provides the broadest lateral base and can generate the redirection impulse. The plant should be:

- slightly outside the projected COM path,
- sufficiently forward to brake,
- pointed near-neutral or only modestly toward the new direction,
- flexed at the knee and hip to absorb impact,
- followed by rapid extension into the new direction.

A wide lateral plant helps generate the medial ground-reaction forces required for sharper turns, but excessive lateral foot placement increases knee loading and can look like a forced skid.[3] Human biomechanics literature recommends a relatively neutral foot progression angle for reducing undesirable knee loading.[3]

Use a braking-step policy based on turn angle and speed:

- **Mild \(30\)–\(45^\circ\) cut:** one preparatory braking step, then one redirecting plant.
- **Hard \(45^\circ\) cut at 5–7 m/s:** usually one or two braking contacts distributed across the approach and plant.
- **\(90^\circ\) cut at 5–7 m/s:** commonly two or more meaningful braking contacts; a single planted foot should not be expected to remove all forward momentum.
- **Near \(180^\circ\):** use a dedicated deceleration phase, often several steps, rather than a single pivot.

The exact number should be selected from available impulse:

\[
\Delta \mathbf p
=
\int \mathbf F_{\text{GRF}}\,dt.
\]

If the desired momentum change exceeds the stance leg’s force and reach limits, extend the braking phase automatically.

Human studies find that \(90^\circ\) cuts prioritize braking more strongly than \(45^\circ\) cuts, while \(45^\circ\) cuts distribute braking and translation more evenly.[6] Reported peak resultant GRF values in one review were approximately \(3.87\) bodyweights for a \(90^\circ\) cut plant and \(5.91\) bodyweights for a horizontal braking step in the cited experiments, though these values depend heavily on protocol and should not be treated as controller limits.[1]

## 5. Avoid foot sliding and tripping

### During stance

Once a foot is planted, switch it to a rigid world-space constraint:

\[
\mathbf x_{\text{foot}}(t)=\mathbf x_{\text{plant}},
\qquad
\mathbf R_{\text{foot}}(t)=\mathbf R_{\text{plant}}.
\]

For a physics character, enforce this through a high-gain Cartesian foot task or a contact constraint, while allowing limited compliance:

\[
\mathbf F_{\text{foot}}
=
\mathbf K_x(\mathbf x^*-\mathbf x)
+
\mathbf K_v(\dot{\mathbf x}^*-\dot{\mathbf x}).
\]

Do not drive the foot toward a newly recomputed IK target after contact. Recompute the target only for the next swing.

### During swing

Use touchdown prediction:

\[
\mathbf p_{\text{td}}
=
\mathbf p_{\text{COM}}
+
T_{\text{rem}}\mathbf v_{\text{COM}}
+
\mathbf p_{\text{turn correction}}.
\]

As the foot approaches touchdown:

- reduce swing-foot horizontal velocity,
- lower the foot with a controlled vertical velocity,
- maintain a toe-clearance margin,
- avoid placing the foot behind the COM unless deliberately braking,
- shorten the step if the target exceeds leg reach.

A useful emergency rule is:

\[
\text{if } z_{\text{toe}}<z_{\min}
\quad\text{or}\quad
\text{predicted leg reach}>\ell_{\max},
\]

then increase knee flexion, raise the toe, shorten the target, and delay the redirect rather than forcing an unreachable plant.

## 6. Gait-phase blending

Do not blend two complete gait animations by time alone. Blend **phase, contact state, and task priorities**.

A robust transition sequence is:

1. **Approach phase:** retain the old gait, begin reducing forward target velocity, and bias the next foot toward the future capture point.
2. **Pre-plant phase:** move the desired COM and torso toward the turn, widen the outside-foot target, and increase braking feedback.
3. **Plant phase:** lock the outside foot, prioritize contact stability and COM capture, and suppress rapid pelvis yaw.
4. **Redirection phase:** rotate the desired velocity and pelvis over the planted stance interval.
5. **Exit phase:** release the planted-foot constraint only after the COM has moved into the new support region, then resume the new gait phase.

For phase continuity, define the new gait phase from the actual contact event:

\[
\phi_{\text{new}}
=
\phi_{\text{contact}}
+
\frac{t-t_{\text{contact}}}{T_{\text{new}}}
\pmod 1.
\]

If a step is lengthened for braking, preserve the support-foot identity and remap the swing trajectory instead of jumping to a new animation frame. Blend joint targets with a smooth weight:

\[
\mathbf q_d
=
(1-w)\mathbf q_{d,\text{run}}
+
w\mathbf q_{d,\text{cut}},
\]

but blend Cartesian foot constraints and contact transitions separately. A planted foot should remain hard-constrained even if the upper-body pose is smoothly blended.

Use phase-dependent gains:

\[
K(\phi)=
\begin{cases}
K_{\text{swing}}, & \text{swing}\\
K_{\text{contact}}, & \text{stance}\\
K_{\text{impact}}, & \text{first }50\text{–}100\text{ ms after touchdown}.
\end{cases}
\]

Increase balance gains near touchdown and impact, then reduce them during mid-stance to avoid jitter and overly stiff motion.

## 7. Practical controller recipe

For an active ragdoll or procedural IK biped:

- Estimate COM position, velocity, support foot, and gait phase every frame.
- On a turn request, compute a new desired velocity rather than an instantaneous heading.
- Add one or more braking steps according to \(v\), turn angle, and predicted required impulse.
- Generate the next foot target from nominal velocity placement plus capture-point and velocity feedback.
- Bias the outside-foot target laterally and slightly forward.
- Lean the torso toward the new direction; add backward lean only as needed for braking.
- Keep the pelvis yaw transition slower than the velocity-direction transition.
- Lock the plant foot in world space and solve the stance leg around that constraint.
- Use a swing trajectory with increased toe clearance and a shortened target if reach is marginal.
- Transition gait phase on actual touchdown, not on a preselected animation timestamp.
- Exit the cut only when the COM capture point lies inside the new support region.

The central design rule is: **brake with earlier contacts, redirect with the outside plant, and let the torso/COM lead the foot rather than asking one foot to perform an instantaneous pivot**. Human studies support the multi-step nature of cutting, greater braking demands for sharper angles, and the importance of trunk and COM positioning during the maneuver.[2][3][6][8]

[1] Biomechanical and Neuromuscular Performance Requirements of ... (https://pmc.ncbi.nlm.nih.gov/articles/PMC9474351/)
[2] The Effect of Angle and Velocity on Change of Direction ... (https://link.springer.com/content/pdf/10.1007/s40279-018-0968-3.pdf?error=cookies_not_supported&code=e723b47f-de11-46b2-8be3-09ea01c3e07d)
[3] Biomechanical Determinants of Knee Joint Loads Associated with ... (https://link.springer.com/article/10.1186/s40798-020-00276-5?error=cookies_not_supported&code=d3a67085-0464-4b1d-b042-0e1e4a16950d)
[4] [PDF] Biomechanical and Neuromuscular Performance Requirements of ... (https://knowledge.lancashire.ac.uk/id/eprint/42351/1/Harper2022_Article_BiomechanicalAndNeuromuscularP.pdf)
[5] Gait selection and analysis of biped robots on different terrains ... (https://link.springer.com/article/10.1007/s40435-026-02231-w?error=cookies_not_supported&code=d7fa3135-de5c-4e80-80f7-8d8b7ec60f77)
[6] Whole body mechanics differ among running and cutting maneuvers ... (https://pubmed.ncbi.nlm.nih.gov/25149902/)
[7] Principal Component Analysis of the Biomechanical Factors... : The Journal of Strength & Conditioning Research (https://journals.lww.com/nsca-jscr/fulltext/2021/06000/principal_component_analysis_of_the_biomechanical.32.aspx)
[8] Biomechanical Determinants of Performance and Injury Risk ... (https://link.springer.com/content/pdf/10.1007/s40279-021-01448-3.pdf?error=cookies_not_supported&code=a09c1441-1093-4017-a0ac-c753a412cea1)
[9] [PDF] A Torso Driven Walking Algorithm for Dynamically Balanced ... (https://roblab.org/theses/2006-Biped-Sutherland-PhD.pdf)
[10] SIMBICON: Simple Biped Locomotion Control (https://www.cs.ubc.ca/~van/papers/2007-siggraph-simbicon.pdf)
