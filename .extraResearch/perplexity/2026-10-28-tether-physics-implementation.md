> Question: How do games implement a physics tether/rope between two rigid bodies or a body and a world point at a fixed maximum length (inextensible when taut, slack when shorter), as in Just Cause's grappling hook? Compare: a one-sided distance (max-length) constraint solved with impulses or position correction, XPBD distance constraints, a stiff spring-damper with a max length, and a chain of segments for visible sag; how to keep it stable with large mass ratios (a car tethered to a light prop or to a static anchor), at high speed, with a 60 Hz or substepped solver; how retracting (shrinking the max length over time) is done without explosive energy; adding breaking force, damping and restitution; and how the rope is drawn (straight line when taut, catenary or verlet sag when slack). Give formulas (constraint Jacobian, effective mass, Baumgarte/softness) and sources.

A robust game tether is usually a **unilateral distance constraint**: it applies tension only when the endpoint distance exceeds a maximum \(L\). While \(d<L\), it applies no force, so the rope is slack; when \(d>L\), it pulls the bodies together. For a grappling hook, this is generally preferable to a permanently stiff spring.

Let the attachment points in world space be \(\mathbf{a}\) and \(\mathbf{b}\), with

\[
\mathbf{r}=\mathbf{b}-\mathbf{a},\qquad
d=\|\mathbf{r}\|,\qquad
\mathbf{n}=\frac{\mathbf{r}}{d}.
\]

For a body-to-world tether, treat the world endpoint as having zero inverse mass and zero inverse inertia.

## 1. Unilateral distance constraint

Define

\[
C(\mathbf{q})=d-L.
\]

The constraint is active only when \(C>0\), or equivalently \(d>L\). Its velocity-level form is

\[
\dot C = \mathbf{J}\mathbf{v}.
\]

For two rigid bodies, with attachment offsets \(\mathbf{r}_A\) and \(\mathbf{r}_B\) from each center of mass,

\[
\dot C =
\mathbf{n}\cdot
\left[
\mathbf{v}_B+\boldsymbol{\omega}_B\times\mathbf{r}_B
-\mathbf{v}_A-\boldsymbol{\omega}_A\times\mathbf{r}_A
\right].
\]

One convenient Jacobian is

\[
\mathbf{J}
=
\begin{bmatrix}
-\mathbf{n}^{T} &
-(\mathbf{r}_A\times\mathbf{n})^{T} &
\mathbf{n}^{T} &
(\mathbf{r}_B\times\mathbf{n})^{T}
\end{bmatrix}.
\]

The effective inverse mass is

\[
K=\mathbf{J}\mathbf{M}^{-1}\mathbf{J}^{T},
\]

or explicitly,

\[
K=
m_A^{-1}+m_B^{-1}
+
(\mathbf{r}_A\times\mathbf{n})^{T}
\mathbf{I}_A^{-1}
(\mathbf{r}_A\times\mathbf{n})
+
(\mathbf{r}_B\times\mathbf{n})^{T}
\mathbf{I}_B^{-1}
(\mathbf{r}_B\times\mathbf{n}).
\]

The scalar impulse is applied as

\[
\Delta\mathbf{v}=\mathbf{M}^{-1}\mathbf{J}^{T}\lambda.
\]

For a velocity constraint, a basic impulse solve is

\[
\lambda
=
-\frac{\dot C+b}{K},
\]

where \(b\) is a bias velocity used to remove positional error. Sign conventions vary with the chosen Jacobian; the implementation should clamp the accumulated **tension impulse** so that it never becomes compressive:

\[
\lambda_{\text{acc}}\ge 0.
\]

A unilateral constraint should not pull when the endpoints are approaching or when the rope is slack. In practice:

- If \(d<L\), clear or retain no active tension impulse.
- If \(d>L\), solve the constraint.
- Clamp the accumulated multiplier to nonnegative values.
- Do not apply a “push” impulse when the rope is shorter than \(L\).

## 2. Baumgarte stabilization and softness

A common velocity bias is

\[
b=
\frac{\beta}{\Delta t}\max(0,d-L-s_{\text{allowed}}),
\]

where:

- \(\beta\) is typically around \(0.1\)–\(0.3\),
- \(s_{\text{allowed}}\) is a small slop distance,
- \(\Delta t\) is the solver step.

The resulting impulse is approximately

\[
\lambda=
-\frac{\dot C+b}{K}.
\]

Too much Baumgarte bias produces jitter, violent corrections, or energy injection, especially when the rope becomes taut at high speed. A softer form adds a compliance or softness term:

\[
\lambda
=
-\frac{\dot C+b+\gamma\lambda_{\text{acc}}}
{K+\gamma},
\]

where \(\gamma\) has units of inverse effective mass. This limits the impulse response and behaves like a regularized constraint.

For a rope intended to be nearly inextensible, use a small softness rather than an infinitely stiff spring. Several sequential solver iterations are usually better than one enormous correction.

## 3. XPBD distance constraint

XPBD treats distance constraints as compliant constraints and is designed to reduce the dependence of stiffness on timestep and iteration count.[1][2]

For the equality constraint

\[
C=d-L,
\]

the positional gradients are

\[
\nabla_{\mathbf{a}}C=-\mathbf{n},
\qquad
\nabla_{\mathbf{b}}C=\mathbf{n}.
\]

For particles, the XPBD update is commonly expressed as

\[
\Delta\lambda
=
\frac{-C-\alpha\lambda/\Delta t^2}
{\sum_i w_i\|\nabla_i C\|^2+\alpha/\Delta t^2},
\]

where

\[
w_i=m_i^{-1}
\]

and \(\alpha\) is compliance, the inverse of physical stiffness.[1][2]

Then

\[
\Delta\mathbf{x}_i
=
w_i\nabla_iC\,\Delta\lambda.
\]

For rigid bodies, replace the particle denominator by the generalized effective inverse mass:

\[
K_x =
\mathbf{J}\mathbf{M}^{-1}\mathbf{J}^{T}.
\]

Thus,

\[
\Delta\lambda
=
\frac{-C-\alpha\lambda/\Delta t^2}
{K_x+\alpha/\Delta t^2}.
\]

For a maximum-length tether, use the solve only when \(C>0\), and clamp the accumulated multiplier to the tension-producing direction. XPBD’s accumulated multiplier also provides a useful estimate of constraint force:

\[
F_{\text{tension}}\approx
\frac{\lambda}{\Delta t^2}.
\]

The exact scaling depends on the formulation and units, but it is suitable for break-force tests after calibration. XPBD’s compliance formulation and force-estimation capability are described in the original XPBD work.[2]

## 4. Spring-damper with a maximum length

A unilateral spring is simpler but usually less ideal for an inextensible gameplay rope. When \(d>L\), define extension

\[
x=d-L
\]

and radial relative velocity

\[
v_r=
\mathbf{n}\cdot
\left[
\mathbf{v}_B+\boldsymbol{\omega}_B\times\mathbf{r}_B
-\mathbf{v}_A-\boldsymbol{\omega}_A\times\mathbf{r}_A
\right].
\]

Apply tension

\[
T=\max\left(0,kx+c\,v_r\right).
\]

The forces are

\[
\mathbf{F}_A=+T\mathbf{n},
\qquad
\mathbf{F}_B=-T\mathbf{n}.
\]

Use \(T=0\) when \(d\le L\).

Advantages:

- Easy to implement.
- Naturally supports controlled stretch.
- Damping can suppress oscillation.

Disadvantages:

- High stiffness requires small timesteps or implicit integration.
- Large mass ratios make explicit springs unstable.
- A very stiff spring can produce explosive forces when the rope first becomes taut.
- “Nearly inextensible” behavior depends strongly on timestep and solver iterations.

A practical hybrid is to use a hard unilateral constraint for the maximum length, plus modest radial damping, rather than trying to emulate inextensibility with an extremely stiff spring.

## 5. Chain of segments for visible sag

A single endpoint constraint cannot produce sag or wrapping. For a visible rope, create a chain of particles or short rigid/particle segments:

- Fixed or constrained endpoint at the hook.
- Fixed or constrained endpoint at the attached body.
- Distance constraints between adjacent particles.
- Optional bending constraints.
- Collision constraints against the environment.
- A separate long-range maximum-length constraint between endpoints.

The segment length is approximately

\[
\ell_i=\frac{L}{N},
\]

where \(N\) is the number of segments. Adjacent constraints alone may stretch under large loads and limited iterations. A long-range endpoint constraint prevents the entire chain from becoming excessively long; this is also a common practical technique in rope systems.[9]

For a slack rope, use:

- Gravity on rope particles.
- Damping or drag.
- Distance constraints with small compliance.
- Bend constraints if the rope should resist sharp kinks.
- Collision constraints if it should drape over geometry.

A visual-only rope can use Verlet or position-based particles. A physically coupled rope should either:

1. Couple its endpoint particles to the rigid bodies through impulses/XPBD, or
2. Use the rope mainly for rendering and let the rigid-body tether provide gameplay behavior.

The second option is often much more stable and cheaper for a Just Cause-style grappling hook.

## 6. Stability with large mass ratios

A light prop attached to a heavy car is a difficult case because the light body can receive a huge velocity change:

\[
\Delta v \approx \frac{\lambda}{m_{\text{light}}}.
\]

Useful safeguards are:

- Give the world anchor zero inverse mass and zero inverse inertia.
- Use the actual rigid-body effective mass, including rotational terms.
- Solve the tether after ordinary contact constraints, or use a consistent constraint ordering.
- Use accumulated impulses rather than independently recomputing and overwriting impulses.
- Run several sequential impulses per substep.
- Substep high-speed or highly stressed tethers.
- Limit maximum correction velocity or maximum tension impulse as a gameplay safety cap.
- Use a small slop and moderate Baumgarte factor.
- Avoid applying the full positional error as an instantaneous velocity change.
- Consider inverse-mass scaling or a maximum impulse for the light prop if gameplay permits it.

For high-speed motion, the endpoint can travel beyond the allowed length during one frame. Continuous or swept detection helps determine when the tether should become active, but it does not replace solving. A good baseline is:

- Main timestep: \(1/60\) s.
- Two to eight internal substeps for fast tethered objects.
- Several sequential constraint iterations per substep.
- More iterations for a segment chain than for a single endpoint constraint.

When a rope first becomes taut, solve the **relative outward velocity** first. If

\[
\dot C>0,
\]

remove or reduce that separating velocity with the unilateral impulse. Then correct residual positional error gradually. Instantly correcting a large overshoot is a common source of explosions.

## 7. Retracting the tether

Do not abruptly replace \(L\) with a much smaller value. Instead use a target length and a bounded retraction rate:

\[
L_{k+1}
=
\max(L_{\min},L_k-v_{\text{retract}}\Delta t).
\]

If the current distance is already greater than the new length, the constraint becomes active. The solver then reels the body inward over multiple steps.

To avoid energy injection:

- Limit the rate at which \(L\) shrinks.
- Limit inward target velocity.
- Use a soft or compliant constraint while retracting.
- Apply damping against inward radial motion.
- Avoid teleporting either endpoint.
- Use a maximum tension or maximum inward impulse.
- If the rope is slack, retract the visual rope without creating a sudden pull until the new length is exceeded.

A useful target radial velocity is

\[
v_{\text{target}}
=
-\min(v_{\text{retract}},\,\text{allowed correction speed}),
\]

and the velocity constraint can be written as

\[
\dot C-v_{\text{target}}\le 0.
\]

This makes retraction behave like a controlled winch rather than a shrinking rigid rod.

With XPBD, change the rest or maximum length gradually and retain the accumulated multiplier carefully. If the constraint suddenly changes from inactive to deeply violated, reset or damp its accumulated multiplier to prevent a stale multiplier from generating a large impulse.

## 8. Damping and restitution

### Radial damping

For a taut rope, radial damping is usually desirable:

\[
T_{\text{damp}}=c\,v_r.
\]

Only apply damping that resists motion:

\[
T=
\max(0,kx+c\,v_r).
\]

For a hard constraint, velocity-level damping can be represented by a target relative normal velocity. A damping factor \(e\) can be applied to the post-solve relative velocity:

\[
v_r^{+}=-e\,v_r^{-}.
\]

For a rope, choose \(e\) near zero; a rope normally should not bounce like a rubber band. A small nonzero value can create a stylized snap.

### Restitution

Restitution is usually disabled for a grappling rope. If desired, apply it only when the rope becomes taut and the endpoints are separating outward:

\[
v_r^{-}>0.
\]

Then solve toward

\[
v_r^{+}=-e\,v_r^{-},
\qquad 0\le e\le 1.
\]

Never apply restitution while the rope is slack or while the endpoints are moving inward. Otherwise the rope can inject energy on every frame.

## 9. Breaking force or impulse

A break threshold can be based on estimated force:

\[
F_{\text{break}} > F_{\max},
\]

or on impulse per step:

\[
\frac{\lambda}{\Delta t}>F_{\max}.
\]

Use hysteresis or a short accumulation window to prevent one-frame numerical spikes from breaking the rope:

\[
\text{damage} \mathrel{+}= 
\max\left(0,\frac{\lambda}{\Delta t}-F_{\text{threshold}}\right)\Delta t.
\]

Break when damage exceeds a configured limit. For a segment rope, either:

- Break the whole rope from endpoint tension, or
- Assign break thresholds to individual segments and use local constraint multipliers.

Because solver iteration count affects approximate constraint forces, calibrate the threshold under the actual timestep, substep count, and iteration budget.

## 10. Rendering the rope

Use the physical solver’s endpoint and, if available, intermediate particle positions.

### Taut rope

When \(d\) is near or above the maximum length, render a straight line between the attachment points. This is the cheapest and most convincing result for a high-tension grappling cable.

Add a small visual offset or smoothing filter to avoid visible jitter:

\[
\mathbf{p}_{\text{render}}
=
(1-s)\mathbf{p}_{\text{old}}
+s\mathbf{p}_{\text{physics}}.
\]

Do not smooth the actual physics endpoints.

### Slack rope

For a simple slack appearance, interpolate a curve between endpoints with a downward sag. A parabola is often sufficient:

\[
\mathbf{p}(u)
=
(1-u)\mathbf{a}
+u\mathbf{b}
+\mathbf{d}_{\text{sag}}\,4u(1-u),
\qquad 0\le u\le 1.
\]

Here \(\mathbf{d}_{\text{sag}}\) points downward and its magnitude depends on slack:

\[
s=L-d.
\]

For a more physical visual, use a catenary approximation. A catenary in local horizontal coordinates is

\[
y(x)=a\cosh\left(\frac{x}{a}\right)-a,
\]

with \(a\) chosen so that the curve’s arc length equals the rope length. Solving for \(a\) numerically is usually unnecessary for a game; a lookup table or iterative approximation is adequate.

If the rope has a simulated particle chain, render a spline through the particles. A practical hybrid is:

- Use the endpoint tether for gameplay stability.
- Use a low-resolution Verlet/XPBD chain for sag and collision appearance.
- Snap or softly constrain its endpoints to the rigid-body attachment points.
- Draw straight when tension exceeds a threshold.
- Draw the particle curve when slack exceeds a threshold.

This separates the **mechanical tether** from the **visual rope**, avoiding the cost and instability of making every rendered segment a fully coupled rigid-body constraint.

## Recommended implementation

For a Just Cause-style tether:

1. Use a unilateral endpoint distance constraint with accumulated impulses.
2. Include attachment-point rotation in the Jacobian and effective mass.
3. Use modest Baumgarte stabilization or XPBD compliance.
4. Substep when speed, tension, or error is high.
5. Add radial damping but little or no restitution.
6. Retract \(L\) at a bounded rate rather than teleporting it.
7. Clamp tension, correction velocity, and optional break force.
8. Render a straight cable while taut.
9. Use a separate low-resolution particle chain or catenary only for slack visual sag.
10. Add a long-range endpoint constraint if a simulated chain is used.

XPBD is particularly attractive when the rope also needs segment constraints, compliance, or force estimates; its central goal is to make compliant constraint behavior less dependent on timestep and iteration count.[1][2] Position-based distance constraints likewise distribute corrections according to inverse mass, which is useful for ordinary rope particles but must be complemented by substepping, damping, and impulse limits for extreme rigid-body mass ratios.[6]

[1] Extended Position Based Dynamics (https://matthias-research.github.io/pages/tenMinutePhysics/09-xpbd.pdf)
[2] matthias-research.github.io · pages · publicationsXPBD: Position-Based Simulation of Compliant Constrained Dynamics (https://matthias-research.github.io/pages/publications/XPBD.pdf)
[3] [PDF] XPBD: position-based simulation of compliant constrained dynamics | Semantic Scholar (https://www.semanticscholar.org/paper/XPBD:-position-based-simulation-of-compliant-Macklin-M%C3%BCller/ee283867a4124032df8e18d7a514417ab4cf99ee)
[4] real-time visual and haptic interaction with deformable bodies ... (https://link.springer.com/article/10.1007/s00371-026-04570-3?error=cookies_not_supported&code=a8498bb3-66af-4e45-9504-22b99fc3b7df)
[5] XPBI: Position-Based Dynamics with Smoothing Kernels Handles ... (https://arxiv.org/html/2405.11694v2)
[6] Position Based Dynamics (https://matthias-research.github.io/pages/publications/posBasedDyn.pdf)
[7] State‐of‐the‐art improvements and applications of position based ... (https://onlinelibrary.wiley.com/doi/10.1002/cav.2143)
[8] [PDF] Improving real-time simulation of soft tissues using eXtended Position (https://www.politesi.polimi.it/retrieve/85b9b3bc-4262-4d48-bb00-f805d846522a/2024_04_Alessi_Executive_Summary_02.pdf)
[9] Rope physics · Phaser AE expansion pack (https://phaser.io/packs/physics-rope)
[10] Application to Rigid Bodies and Cosserat Rods (https://arxiv.org/html/2608.23606v1)
