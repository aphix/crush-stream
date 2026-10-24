> Question: In real-time soft-body and shape-matching vehicle damage (BeamNG node-beam, Wreckfest/Bugbear, Müller meshless shape matching with plasticity), how do engines end a deformed body's elastic spring-back after an impact: rest/sleep detection on velocity and residual energy, plastic yield that resets rest shape, damping schedules, or fixed time windows? What thresholds and criteria are used to decide a deformed body has settled, and how do they avoid freezing it mid-motion?

There is no single universal “deformation finished” timer. In the documented models, elastic recovery ends because the dynamics become negligible—through damping and, in some engines, sleeping—while **plastic deformation changes the target/rest configuration** so that no further spring-back is expected.

## BeamNG-style node–beam systems

BeamNG’s documented model is a mass–spring system: beams apply spring forces toward their current rest lengths, and damping opposes relative motion.[1][2] Elastic deformation therefore returns toward the beam’s rest length; damping dissipates the oscillation rather than explicitly declaring a dent “finished.”[1]

Permanent deformation is handled separately. A beam’s deformation threshold causes plastic deformation, changing its rest length; after that, the beam no longer returns fully to its original geometry.[3][4] Thus the effective settled shape is determined by the updated plastic rest lengths plus whatever residual elastic displacement remains.

The public documentation does **not** specify a global vehicle-level velocity threshold, residual-energy threshold, settling-time constant, or fixed post-impact time window for stopping spring-back. It does document a narrower sleep optimization: collision-free triangles may enter sleep mode when no potentially colliding nodes are within 10 cm of either side.[5] That is a collision/narrow-phase optimization, not evidence of a universal “body has settled” criterion.

BeamNG’s relevant authoring controls are continuous physical parameters:

- `beamSpring`: elastic restoring stiffness.
- `beamDamp`: velocity-dependent damping that reduces oscillations.[2][3]
- `beamDeform`: force threshold for plastic rest-length change.[3][4]
- `beamStrength`: force threshold for beam breakage.[4]

The documentation warns that excessive damping can itself produce pulsing stresses or instability, so damping is not simply increased until a fixed sleep time is reached.[2][6]

## Müller meshless shape matching

Müller’s shape matching computes goal positions from the undeformed rest configuration and the current point cloud.[7] In the basic elastic formulation, particles continue to be pulled toward those goals; the paper does not define a vehicle-style impact “settled” event or a universal velocity/energy cutoff.

Plasticity is introduced by modifying the reference shape when deformation exceeds a yield criterion. Conceptually, this is the same division as in a plastic beam: below yield, the original rest shape keeps producing recovery forces; after yield, the reference shape is updated, reducing or eliminating recovery toward the old shape. A practical implementation can then sleep an object only after its residual motion is sufficiently small, but the paper itself does not prescribe one universal numerical threshold.

## Wreckfest/Bugbear

Publicly available material is not sufficient to establish Wreckfest’s exact internal sleep thresholds, damping schedule, plastic-yield rule, or any fixed settling window. Claims that it uses a particular velocity cutoff or a fixed number of frames should therefore be treated as reverse-engineering observations or speculation unless supported by engine-source or developer documentation.

## How a robust implementation normally avoids freezing mid-motion

A practical soft-body solver generally uses **sleep as a conservative optimization**, not as the mechanism that creates the final deformation:

1. Integrate forces and constraints normally.
2. Apply damping and plastic-rest updates.
3. Measure motion over a window, commonly using maximum or RMS particle speed and angular speed.
4. Require the body to remain below small thresholds for several consecutive frames.
5. Also require low constraint-force activity, low acceleration, or low residual elastic energy.
6. Wake the body immediately after a collision, contact, constraint impulse, external force, or threshold violation.

A representative criterion is:

\[
\max_i \lVert v_i\rVert < v_{\mathrm{sleep}},
\qquad
\lVert \omega\rVert < \omega_{\mathrm{sleep}},
\qquad
E_{\mathrm{residual}} < E_{\mathrm{sleep}}
\]

for \(N\) consecutive simulation steps, with a hysteresis rule such as a higher wake threshold than sleep threshold.

The important safeguards are:

- **Consecutive-frame qualification**, preventing one quiet frame from freezing an object at an oscillation turning point.
- **Velocity and acceleration/force checks**, preventing sleep while it is momentarily stationary but about to rebound.
- **Contact and collision wake-up**, preventing sleep while another body is still injecting impulses.
- **Energy or constraint-residual checks**, preventing sleep when visible spring strain remains dynamically significant.
- **Separate plasticity from sleep**, because yielding changes the rest shape; sleeping merely stops solving negligible motion.
- **Time limits only as failsafes**, not as the primary physical criterion.

Consequently, the best-supported answer is: **damping removes elastic oscillation; plastic yield resets or updates the rest shape; sleeping, where used, is a low-motion optimization based on sustained negligible movement rather than a fixed impact timer.** Exact numerical thresholds for BeamNG and Wreckfest are not publicly documented in the supplied sources.

[1] Jbeam Tips and Tricks - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/jbeamtips/)
[2] Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/)
[3] Introduction to JBeam - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/)
[4] Meshless Deformations Based on Shape Matching (https://graphics.stanford.edu/courses/cs468-05-fall/Papers/p471-muller.pdf)
[5] Common Jbeam Issues - BeamNG Documentation (https://docs.beamng.com/modding/vehicle/intro_jbeam/common_issues/)
[6] BeamNG JBeam Modding Tutorial | PDF | Rotation (https://www.scribd.com/document/608966502/BeamNG-Modding-Tutorial-Basic-Jbeam-project)
[7] Modeling cars for this game. (https://www.beamng.com/threads/modeling-cars-for-this-game.506/)
[8] BeamNG.tech Technical Paper (https://beamng.tech/blog/2021-06-21-beamng-tech-whitepaper/bng_technical_paper.pdf)
[9] Basic Car Tutorial - Autobello Kit Car (https://documentation.beamng.com/modding/vehicle/tutorials/basic_car_tutorial/)
[10] Soft-Body Authoring with Blender and BeamNG MCP - GitHub (https://github.com/eric-rolph/beamng-mcp/blob/main/docs/SOFTBODY_AUTHORING.md)
