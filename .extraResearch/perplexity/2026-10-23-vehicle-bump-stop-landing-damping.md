> Question: Vehicle suspension simulation for games: how to model bump stops and jounce bumpers so they damp suspension ringing but don't absorb a big landing as a dead-stop (hydraulic bump stops, rate-limited or position-dependent damping, progressive rubber stops)? Typical bump-stop stiffness, damping and engagement travel for a car and a monster truck, and how landing pitch after jumps is affected.

Model the bump stop as a **separate, progressively engaged force element**, not as a very stiff spring that activates at the end of travel. The key is to dissipate energy through damping while allowing enough compression travel that the landing does not become an instantaneous velocity reversal.

## A practical force model

Let \(x\) be suspension compression, \(x_0\) the bump-stop engagement point, and \(v=\dot{x}\) compression velocity. Define penetration:

\[
p=\max(0,x-x_0)
\]

Apply bump-stop force only when \(p>0\):

\[
F_{\text{stop}} =
F_{\text{spring}}(p)+F_{\text{damper}}(p,v)
\]

A useful game-oriented model is:

\[
F_{\text{spring}} =
k_1p+k_2p^2+k_3p^3
\]

\[
F_{\text{damper}} =
\begin{cases}
c_c(p)\,v, & v>0\\
c_r(p)\,v, & v<0
\end{cases}
\]

where compression damping \(c_c\) and rebound damping \(c_r\) can differ. Clamp the force so that it cannot reverse wheel velocity in one frame.

A robust implementation uses an implicit or semi-implicit spring-damper solve. Explicit Euler with a very large \(k\) tends to create explosive forces, tunneling, or a dead-stop landing.

### Recommended shaping

Use three regions:

1. **Touch zone:** small force and moderate damping.
2. **Working zone:** increasing spring rate and velocity-sensitive damping.
3. **End zone:** very high progressive rate, but only over a short remaining distance.

For example:

\[
k(p)=k_{\min}+
(k_{\max}-k_{\min})
\left(\frac{p}{p_{\max}}\right)^n
\]

with \(n\) typically between 2 and 4 for a visibly progressive stop.

Avoid a force discontinuity at engagement. The bump-stop force should start near zero or blend into the ordinary suspension force over a small distance.

## Rubber or polyurethane jounce bumper

A rubber stop is primarily a **nonlinear spring with hysteresis**. Polyurethane generally gives a more progressive response and useful internal damping, while ordinary rubber can return more of the stored compression energy into rebound motion.[9][6]

Use:

- Strongly progressive \(F(x)\)
- Moderate compression damping
- Substantial rebound damping from the main shock
- A short engagement region rather than immediate full stiffness

A useful approximation is:

\[
F_{\text{rubber}}=K
\left(\frac{p}{p_{\max}}\right)^n
\]

with a separate unloading curve:

\[
F_{\text{unload}}=\eta F_{\text{load}}, \qquad 0<\eta<1
\]

This hysteresis prevents the stop from returning all its stored energy. Do not rely on hysteresis alone; the damper must control rebound, otherwise the stop can produce a second bounce.

## Hydraulic bump stop

Treat a hydraulic bump stop as a short secondary damper with progressive compression resistance. Real hydraulic units are designed to give a smooth initial impact, rising resistance with compression, and controlled rebound rather than simply acting as a rigid end stop.[2][3]

A useful game approximation is:

\[
F_{\text{hyd}} =
F_0+
K(p)p+
C(v,p)v
\]

with velocity-sensitive damping:

\[
C(v,p)=C_{\min}+
(C_{\max}-C_{\min})
\left(\frac{p}{p_{\max}}\right)^m
\]

You can also use separate low- and high-speed damping:

\[
F_{\text{hyd}} =
C_{\text{low}}v+
(C_{\text{high}}-C_{\text{low}})
\,\operatorname{smoothstep}(v/v_h)\,v
\]

The important behavior is:

- Low force when first contacted
- Moderate damping through most of the stroke
- High resistance near full compression
- Lower rebound force than compression force
- No perfectly rigid limit until the final few percent of travel

For landing comfort, increase damping with compression velocity, but cap it. Excessive damping creates the same “dead-stop” sensation as excessive spring stiffness.

## Typical starting ranges

These are simulation starting points, not universal physical specifications. Tune them at the **wheel**, then convert through the suspension motion ratio. Component stiffness and damping cannot be copied directly to the wheel because linkage geometry changes the relationship between wheel and damper motion.[4]

Assume:

- \(x\) is wheel travel
- \(m_s\) is sprung mass supported by one wheel
- \(g\) is gravity
- \(F\) is wheel force

### Road car

| Parameter | Initial range |
|---|---:|
| Bump-stop engagement before mechanical full bump | 15–30 mm |
| Effective bump-stop working travel | 20–50 mm |
| Force at initial contact | 0.02–0.10 \(m_sg\) |
| Force near full compression | 1.0–3.0 \(m_sg\) |
| Initial effective wheel rate | 1–3 times the main spring rate |
| Final effective wheel rate | 5–20 times the main spring rate |
| Compression damping in stop zone | 0.1–0.4 of critical damping equivalent |
| Rebound damping in stop zone | 0.05–0.25 of critical damping equivalent |

For a sporty road car, contact may occur only around 15–20 mm before the end of wheel travel, with roughly 40–70 mm total remaining metal-to-metal wheel travel depending on the design.[9]

A practical feel target is that a moderate pothole touches the stop but does not noticeably slow the wheel. A severe bump should use most of the stop stroke and approach the final rate without reaching an infinite force.

### Monster truck or high-travel off-road vehicle

| Parameter | Initial range |
|---|---:|
| Bump-stop engagement before full bump | 100–200 mm |
| Effective bump-stop working travel | 100–200 mm |
| Force at initial contact | 0.02–0.08 \(m_sg\) |
| Force near full compression | 1.5–4.0 \(m_sg\) |
| Initial effective wheel rate | 0.5–2 times the main spring rate |
| Final effective wheel rate | 4–12 times the main spring rate |
| Compression damping in stop zone | 0.15–0.5 of critical damping equivalent |
| Rebound damping in stop zone | 0.1–0.35 of critical damping equivalent |

Actual racing and desert-style systems often use roughly the final 100–150 mm of wheel travel for air or hydraulic bump-stop action. One documented monster-truck configuration uses air bump stops over the final 6 inches of wheel travel.[7]

For a monster truck, the stop should usually be softer at first contact than for a road car, because the vehicle may arrive with large vertical velocity. Let the stop absorb distance first, then build force rapidly near the end.

## Preventing the “dead-stop” landing

The landing impulse is approximately governed by the available compression distance:

\[
a_{\text{avg}}\approx
\frac{v_{\text{impact}}^2}{2d}
\]

where \(d\) is total effective stopping distance from tire, spring, damper, and bump stop. Halving \(d\) roughly doubles the average deceleration for the same impact speed.

Use these safeguards:

- Begin bump-stop engagement early enough to provide meaningful stroke.
- Make the force curve smooth and convex rather than vertical.
- Limit maximum per-frame force or acceleration.
- Use a compliant tire/contact model; a rigid tire plus rigid bump stop creates an artificial impulse.
- Use velocity-dependent damping rather than only a very high spring rate.
- Apply lower rebound damping than compression damping.
- Let the stop dissipate energy; do not model it as a perfectly elastic spring.
- Scale stop force by the remaining travel so the last millimeters become protective, not the entire stop stroke.

A useful acceleration cap for an arcade game is around \(3\text{–}6g\) at the wheel for ordinary landings, with higher values reserved for obvious hard bottom-outs. The exact value depends on the game’s desired feel.

## Damping suspension ringing

If the suspension oscillates after landing, first check the ordinary shock damping. A bump stop should not be used to compensate for a badly underdamped main suspension.

For a single effective suspension mode:

\[
c_{\text{critical}}=2\sqrt{km}
\]

Use a damping ratio around:

- \(0.6\text{–}0.9\) for a responsive road vehicle
- \(0.8\text{–}1.1\) in the bump-stop zone
- \(0.4\text{–}0.8\) for a plush monster-truck landing, with strong compression damping but controlled rebound

Use more compression than rebound damping in the bump stop. High rebound damping is useful for preventing bucking, but too much can hold the suspension compressed after landing and make the next bump harsh.

## Effect on landing pitch after a jump

Landing pitch depends mainly on:

- Front-versus-rear touchdown timing
- Front/rear suspension compression
- Center-of-mass height
- Pitch inertia
- Longitudinal distance from the center of mass to each axle
- Front/rear bump-stop engagement and stiffness
- Whether the vehicle lands on both axles or one axle first

### Nose-down landing

If the front wheels touch first, the front suspension receives the initial impact. A front bump stop that engages too early or becomes too stiff creates a large upward force at the front axle, producing a nose-up pitch impulse. This can then cause the rear to strike harder.

If the front stop is too soft or engages too late, the front compresses deeply, temporarily producing nose-down attitude before the rear contacts.

### Rear-first landing

The same behavior occurs in reverse: a stiff rear stop produces a nose-down pitch impulse, while a soft rear stop allows greater rear compression and can delay the pitch reversal.

The pitch torque from axle forces is approximately:

\[
\tau_y =
F_{\text{front}}\,l_f-
F_{\text{rear}}\,l_r
\]

where \(l_f\) and \(l_r\) are the center-of-mass distances to the front and rear axles. Unequal bump-stop force curves therefore change not only bottoming behavior but also landing rotation.

### Tuning strategy

- For a neutral two-wheel landing, make front and rear engagement forces produce similar normalized deceleration.
- If the vehicle pitches nose-up after front contact, soften or delay the front stop, increase its working travel, or reduce front compression damping.
- If it pitches nose-down after rear contact, apply the corresponding changes to the rear stop.
- To keep the nose down during a jump, use a slight aerodynamic or control torque, but let the suspension remain nearly symmetric during touchdown.
- Avoid using very different front/rear final rates unless the asymmetry is intentional; it can turn small touchdown timing differences into large pitch changes.

For a convincing monster-truck landing, use long progressive stop travel, strong but velocity-limited compression damping, and controlled rebound. The vehicle should visibly settle through several tenths of a second rather than rotate abruptly when one axle reaches its bump stop. Progressive bump stops are specifically valuable because they increase effective wheel rate near the travel limit and influence pitch, roll, and axle load transfer like additional springs.[9]

[1] Overlooked Performance: Bump Stops Explained (https://www.hpacademy.com/technical-articles/overlooked-performance-bump-stops-explained/)
[2] Hydraulic Bump Stop (https://dobinsons.com/component/virtuemart/product-packs/pack-items/2-inch-to-4-inch-hbs-pack_hbs66-002-detail)
[3] Threaded Hydraulic Bump Stop - 2" 4x4 (https://pmcmotorsport-shop.com/product-eng-5253-Threaded-Hydraulic-Bump-Stop-2-4x4.html)
[4] Suspension Kinematics and Vehicle Dynamics | EVKX.net (https://evkx.net/technology/suspension/kinematics-and-dynamics/)
[5] Glossary - Perry Parts (https://perryparts.com/pages/glossary)
[6] Progressive-rate bump stops for 4wd suspensionsoutbacktravelaustralia.com.au › progressive-rate-bump-stops (https://outbacktravelaustralia.com.au/4wd-mods-suspension/progressive-rate-bump-stops/)
[7] www.therangerstation.com · tech · monster-truck-suspensionMonster Truck Suspension Evolution - The Ranger Station (https://www.therangerstation.com/tech/monster-truck-suspension-evolution/)
[8] Best Hydraulic Rear Bump Stop Kits For 2nd & 3rd Gen Tacoma (https://trailtacoma.com/suspension/best-hydraulic-rear-bump-stop-kits-2nd-3rd-gen/)
[9] Insights into bump-stop tuning | Vehicle Dynamics International (https://www.vehicledynamicsinternational.com/features/insights-into-bump-stop-tuning.html)
[10] [PDF] Prediction of impulsive vehicle tyre-suspension response to abusive ... (https://scispace.com/pdf/prediction-of-impulsive-vehicle-tyre-suspension-response-to-17l9we4hcy.pdf)
