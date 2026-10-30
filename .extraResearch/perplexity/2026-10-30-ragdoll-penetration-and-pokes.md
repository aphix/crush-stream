> Question: Rapier 3D (rapier3d / @dimforge/rapier3d JS, versions 0.12-0.19, 2024-2026): which integration parameters cap how fast penetration is corrected per step, and what are their defaults and semantics: contact_natural_frequency and contact_damping_ratio (soft contact constraints), normalized_max_corrective_velocity (or max_corrective_velocity), normalized_allowed_linear_error, normalized_prediction_distance, num_solver_iterations, num_internal_pgs_iterations, and length_unit? Can a body closing faster than the soft contact can push back sink deep into another collider by design, and how do Rapier docs or maintainers recommend tuning for a stiff, high-rate (480 Hz) ragdoll? Cite Rapier docs, source code and GitHub issues.

Yes. Rapier’s contact solver can be configured to correct penetration only at a finite speed, so a body arriving faster than the available corrective response can penetrate deeply before being pushed out. That behavior is a consequence of the solver’s discrete, velocity-limited correction—not necessarily a collision-detection failure.

## Parameters and defaults

The names below are the Rust/WebAssembly names; JavaScript uses camelCase equivalents such as `contactNaturalFrequency`.

| Parameter | Default in Rapier 3D 0.12–0.19* | Semantics |
|---|---:|---|
| `contact_natural_frequency` | `30 Hz` | Natural frequency of the soft spring used to regularize contact constraints. Higher values make contacts recover penetration faster but can increase jitter or overshoot. |
| `contact_damping_ratio` | `1.0` | Damping ratio of that soft contact spring. Around `1` is critically damped; increasing it generally makes contact response less bouncy and visually stiffer, while excessive damping can make response sluggish. |
| `normalized_max_corrective_velocity` | `3.0` | Maximum speed at which the biased contact solve may push penetrating bodies apart. The actual limit is scaled by `length_unit`; it is a cap on recovery velocity, not an amount of penetration corrected per step. |
| `max_corrective_velocity` | Version/binding-dependent alias or older name | Same conceptual limit as above, but expressed without the newer normalized naming in some APIs. Check the generated JS binding for the exact version. |
| `normalized_allowed_linear_error` | `0.001` | Allowed linear-error/slop parameter used by the solver. It is scaled by `length_unit`. It is not a permanent penetration dead zone: Rapier’s documentation says penetrations are still corrected rather than deliberately left at this depth.[5] |
| `normalized_prediction_distance` | `0.02` | Maximum separation at which Rapier creates predictive/speculative contacts. It is four times the default geometric slop and is scaled by `length_unit`.[1][3] |
| `num_solver_iterations` | `4` | Number of solver iterations used to calculate constraint impulses. More iterations improve constraint convergence and stability but cost CPU time.[3][8] |
| `num_internal_pgs_iterations` | commonly `1` in the relevant versions | Additional internal projected-Gauss-Seidel iterations used inside the solver step. Increasing it can improve convergence for difficult constraint systems, but it is an advanced performance/stability knob and is not equivalent to increasing the simulation frequency. |
| `length_unit` | `1.0` | Number of application/world units corresponding to one real-world meter. Rapier is tuned for meter-scale worlds. Normalized distance and velocity parameters are multiplied by this value internally.[3][5] |

\*Defaults can differ in bindings, wrappers, and later releases. In particular, some Godot integration documentation reports a different default corrective velocity, so the generated API for the exact `@dimforge/rapier3d` package version should be treated as authoritative.[6]

In JavaScript, the usual fields are approximately:

```js
params.contactNaturalFrequency = 30.0;
params.contactDampingRatio = 1.0;
params.normalizedMaxCorrectiveVelocity = 3.0;
params.normalizedAllowedLinearError = 0.001;
params.normalizedPredictionDistance = 0.02;
params.numSolverIterations = 4;
params.numInternalPgsIterations = 1;
params.lengthUnit = 1.0;
```

## Why fast bodies can sink

A useful simplified bound is:

\[
\Delta x_{\text{recoverable per step}}
\lesssim
\frac{v_{\max}}{f_{\text{sim}}}
\]

With the default \(v_{\max}=3\ \mathrm{m/s}\):

- at 60 Hz, the cap corresponds to roughly \(0.05\ \mathrm{m}\) of maximum corrective displacement per step;
- at 480 Hz, it corresponds to roughly \(0.00625\ \mathrm{m}\) per step.

That is only an intuition—the actual correction also depends on contact bias, softness, damping, masses, friction, and solver convergence—but it explains why a high-speed impact can outrun the soft constraint. `contact_natural_frequency` controls how aggressively the soft constraint generates a correction; `normalized_max_corrective_velocity` imposes a hard ceiling on the resulting separating speed. Raising the frequency alone cannot overcome a low velocity cap.

`normalized_prediction_distance` helps by creating contacts before geometric intersection, allowing the solver to begin braking earlier. It does not guarantee zero penetration: if the object crosses the prediction distance by more than the solver can handle during one step, penetration can still occur.

`normalized_allowed_linear_error` should not be interpreted as “Rapier will tolerate this much penetration forever.” The current documentation explicitly distinguishes it from a correction dead zone and says penetration correction continues toward zero.[4][5]

## Tuning a stiff, high-rate ragdoll

For a 480 Hz ragdoll, a practical tuning order is:

1. **Keep the world scale correct.** Use meter-scale geometry and `lengthUnit = 1`. Do not compensate for centimeter- or millimeter-scale modeling problems merely by increasing solver parameters.

2. **Raise `numSolverIterations`.** Start around `8–12` for demanding articulated systems; Rapier’s documentation gives that range for stiff joints, machinery, and difficult stacks.[8] Test CPU cost and convergence.

3. **Increase `numInternalPgsIterations` cautiously.** This can help coupled ragdoll joints and contacts converge, but it is more expensive and should be tested against simply increasing ordinary solver iterations.

4. **Use a critically damped or slightly overdamped contact response.** Keep `contactNaturalFrequency` near the default initially and increase `contactDampingRatio` when the goal is a less compliant/stiffer-looking contact. Rapier’s integration guidance specifically recommends increasing damping rather than relying only on a much higher natural frequency; excessive frequency can cause jitter.[6]

5. **Raise the corrective-velocity cap for high-speed impacts.** If a ragdoll can arrive at a surface at tens of meters per second, a default cap of `3 m/s` is intentionally conservative. Choose a cap high enough that the expected penetration can be removed over a small number of 480-Hz steps, while watching for explosive recovery when objects begin deeply interpenetrated. The documented purpose of the cap is precisely to prevent deep penetrations from being resolved explosively.[2][3]

6. **Increase prediction distance when anticipation is needed.** The default `0.02` normalized units may be too small for very fast motion or large body parts. Increasing it gives speculative contacts more lead time, but too large a value can create contacts that feel premature or interfere with motion.

7. **Use CCD for thin or very fast colliders.** Solver tuning is not a substitute for continuous collision detection when a body can cross a collider in one discrete step. CCD, appropriate collider geometry, and sane time stepping are especially important for limbs, capsules, and fast projectiles.

8. **Do not expect 480 Hz alone to make contacts rigid.** The higher rate reduces the distance traveled per step, but it also means a fixed velocity cap permits less corrective distance per step. The cap, prediction distance, softness, and solver convergence must be tuned together.

The key distinction is:

- `contactNaturalFrequency` and `contactDampingRatio` determine the **soft spring-like response**;
- `normalizedMaxCorrectiveVelocity` limits the **maximum separating response**;
- `normalizedPredictionDistance` determines how early speculative contact can begin;
- solver iteration counts determine how well the constraints **converge**;
- `lengthUnit` determines the physical scale applied to normalized quantities.

Thus, for a stiff high-rate ragdoll, the usual remedy for deep impact penetration is not simply “increase spring frequency.” It is a combination of earlier contact generation, a sufficiently high corrective-velocity cap, adequate solver iterations, damping, and CCD where discrete stepping cannot robustly catch the motion.

[1] Integration parameters (https://rapier.rs/docs/user_guides/c/integration_parameters/)
[2] Integration parameters - Rapier physics engine (https://rapier.rs/docs/user_guides/python/integration_parameters/)
[3] Integration parameters - rapier.rs (https://rapier.rs/docs/user_guides/javascript/integration_parameters/)
[4] Struct IntegrationParameters Copy item path (https://docs.rs/rapier3d/0.35.3/rapier3d/dynamics/struct.IntegrationParameters.html)
[5] docs.rs · rapier3d · latestIntegrationParameters in rapier3d::dynamics - Rust - Docs.rs (https://docs.rs/rapier3d/latest/rapier3d/dynamics/struct.IntegrationParameters.html)
[6] Project Settings (https://godot.rapier.rs/docs/documentation/project-settings/)
[7] Integration parameters | Rapier (https://rapier.rs/docs/user_guides/templates/integration_parameters/)
[8] Integration parameters | Rapier (https://rapier.rs/docs/user_guides/bevy_plugin/integration_parameters/)
[9] IntegrationParameters | @dimforge/rapier2d (https://rapier.rs/javascript2d/classes/IntegrationParameters.html)
[10] ◆ contactClustering (https://rapier.rs/c/3d-f64/struct_r3_integration_parameters.html)

---

> Follow-up question: How do PhysX, Havok, Unity and Unreal ragdoll setups recover a jointed limb that has ended up inside or threaded through another body: max depenetration velocity (Rigidbody.maxDepenetrationVelocity, PhysX maxDepenetrationVelocity), contact offset / rest offset (skin), inter-ragdoll collision filtering, overlap recovery or 'unstuck' passes, and how the separating direction is chosen for box-box deep penetration (minimum penetration axis vs SAT, flipping normals)? Cite engine documentation and developer forum answers.

A jointed limb that is **deeply interpenetrating or threaded through another body cannot generally be “recovered” correctly by a single generic depenetration setting**. Physics engines compute local contacts and push bodies along the contacts’ selected normals; they do not normally infer the globally correct way to pull an articulated chain back through an obstacle. Reliable recovery therefore combines prevention, collision filtering, constrained correction, and—when necessary—an explicit gameplay “unstuck” or pose-reset procedure.

## What the settings actually do

| Mechanism | PhysX / Unity | Havok / Unreal implication |
|---|---|---|
| **Maximum depenetration velocity** | PhysX limits the solver velocity used to move a body out of overlap. Unity exposes this as `Rigidbody.maxDepenetrationVelocity`; its documentation describes it as the maximum velocity used when moving a Rigidbody out of a penetrating state.[1][2] | This is a recovery-speed cap, not a choice of escape route. Raising it can remove shallow overlaps faster, but can create violent impulses, jitter, or overshoot. Lowering it makes correction gentler but may leave bodies interpenetrating longer. PhysX tuning guidance likewise warns that excessive values can cause instability and recommends reducing the value when response overshoots.[3] |
| **Contact offset / skin** | PhysX contact offset causes contacts to be generated before visible geometric contact. Unity says contacts are generated when separation is less than the sum of collider contact offsets and warns that values near zero can cause jitter.[4] | It is preventive “breathing room,” not a cure for an already threaded limb. Increasing it can give the solver more time to respond, but excessive offsets make limbs appear to collide early and can degrade contact behavior. |
| **Rest offset** | PhysX distinguishes contact offset from rest offset: contact offset is the collision-generation margin, while rest offset is the preferred settled separation. A typical configuration uses a positive contact offset and a smaller or zero rest offset.[5] | Rest offset affects where contacts settle; it does not provide topological awareness or guarantee that an articulated body will be pulled out on the desired side. |
| **Collision filtering** | Disable collisions between adjacent ragdoll links, and often between selected self-collision groups, to prevent elbows, forearms, thighs, and shins from trapping one another. | This is usually the most effective prevention measure. It does not solve penetration against the world or another character, and filtering must be designed per pair rather than indiscriminately disabling all ragdoll collisions. |
| **Overlap recovery / unstuck** | Engine-level overlap correction handles detected overlaps locally. It is not equivalent to a character-level “find a collision-free articulated pose” operation. | A robust game implementation commonly detects failure—excessive penetration, trapped pelvis, impossible capsule placement, or stalled progress—and performs a trace-based relocation, joint reset, temporary collision suppression, or animation reattachment. An Unreal ragdoll-recovery example uses traces and pelvis/capsule offsets to prevent the recovered character capsule from remaining underground.[6] |

## Separating direction for box–box penetration

For convex box contacts, the normal is normally selected from the **minimum-penetration separating axis** found by SAT or an equivalent box-box contact algorithm. In simplified terms, the engine tests candidate face normals—and, for a full OBB-vs-OBB test, edge-cross-edge axes—and chooses the axis with the smallest overlap. The resulting contact normal points from one shape toward the other, with its sign oriented consistently according to the shape ordering.

That direction is only a **local minimum translation direction**. It is not necessarily the direction that:

- untangles a limb from a loop or hole;
- preserves joint limits;
- moves the whole ragdoll toward a valid pose;
- avoids pushing another body deeper into penetration; or
- restores the previous side of a collision boundary.

Consequently, “flip the normal” is not a general solution. Flipping may push the wrong body or violate the solver’s contact convention. A normal can also become unstable when several axes have nearly equal penetration, especially for nearly parallel boxes. Engines may apply tie-breaking, feature caching, contact persistence, or other implementation details, so the exact direction should not be treated as a deterministic global escape vector.

## Recommended recovery design

1. **Prevent self-trapping**
   - Disable collision between neighboring articulated bodies.
   - Use collision groups so only meaningful limb–world and limb–other-character pairs remain active.
   - Keep collider geometry simple and slightly conservative.

2. **Use a modest skin/contact margin**
   - Give colliders enough contact offset to generate contacts before visible intersection.
   - Do not use a large offset as a substitute for correct collision filtering.
   - Keep rest offset appropriate for the desired settled gap.

3. **Tune depenetration conservatively**
   - Increase the maximum only enough to clear ordinary shallow overlaps.
   - For ragdolls, excessive depenetration velocity can launch limbs or amplify joint instability; Unity explicitly notes that very large values can destabilize collision detection, while too-small values can fail to clear penetration.[2]
   - Use solver iterations, substeps, and stable joint drives alongside the velocity cap rather than relying on the cap alone.

4. **Detect pathological penetration**
   - Track persistent contact depth, rapidly increasing joint error, stalled bodies, or a limb whose swept volume remains overlapped for several frames.
   - Treat this as a failure state rather than waiting indefinitely for the local solver.

5. **Perform an explicit unstuck pass**
   - Temporarily disable selected collisions or make the affected limb kinematic.
   - Search candidate translations/rotations using overlap queries and sweeps.
   - Prefer a correction that reduces total penetration while respecting joint limits and keeping the pelvis/root stable.
   - If no valid local correction exists, reset the ragdoll to a safe pose, teleport the root/capsule, or blend back to animation.
   - For character recovery, use a capsule or root trace to ensure the final locomotion collider is not underground; the Unreal recovery discussion specifically emphasizes correcting the pelvis-to-capsule offset and tracing for underground placement.[6]

6. **Do not rely on one contact normal for a chain**
   - Solve the affected limb as an articulated group or use a kinematic pull-out procedure.
   - A per-body minimum-penetration correction can move one link out while forcing another link deeper, producing oscillation or a “threaded” configuration.

In short: **contact/rest offsets and depenetration velocity improve ordinary contact recovery; collision filtering prevents many ragdoll traps; only an application-level articulated unstuck or reset procedure reliably handles a limb that has become topologically threaded through another body.** Unity’s public documentation confirms the roles and limitations of contact offset and maximum depenetration velocity,[1][2][4] while PhysX guidance similarly treats contact offset and depenetration velocity as collision-tuning parameters rather than global untangling logic.[3]

[1] Rigidbody • Unity Editor (https://docs.unity.com/en-us/engine/6000.5/script-reference/unityengine/rigidbody)
[2] defaultMaxDepenetrationVelocity • Unity Editor • Unity Docs (https://docs.unity.com/en-us/engine/6000.3/script-reference/unityengine/physics/defaultmaxdepenetrationvelocity)
[3] maxDepenetrationVelocity • Unity Editor • Unity Docs (https://docs.unity.com/en-us/engine/6000.7/script-reference/unityengine/rigidbody/maxdepenetrationvelocity)
[4] Interpenetration of objects and incoherent force ... (https://forums.developer.nvidia.com/t/interpenetration-of-objects-and-incoherent-force-measurement-with-physx-engine/204873)
[5] Physics • UnityEngine • 6000.3 • Unity Editor • Unity Docs (https://docs.unity.com/en-us/engine/6000.3/script-reference/unityengine/physics)
[6] Rigidbody.maxDepenetrationVelocity (https://docs.unity3d.com/6000.1/Documentation/ScriptReference/Rigidbody-maxDepenetrationVelocity.html)
[7] Tutorial: Ragdolling and how to recover from it - Unreal Engine Forums (https://forums.unrealengine.com/t/tutorial-ragdolling-and-how-to-recover-from-it/601613)
[8] PhysX/ovphysx/docs/guides/collision_tuning.md at ... - GitHub (https://github.com/NVIDIA-Omniverse/PhysX/blob/main/ovphysx/docs/guides/collision_tuning.md)
[9] Manual: Physics (https://docs.unity3d.com/2022.2/Documentation/Manual/class-PhysicsManager.html)
[10] Physics - Manual (https://docs.unity3d.com/2022.3/Documentation/Manual/class-PhysicsManager.html)

---

> Follow-up question: Engine guidance on poking one part of a jointed ragdoll (a mouse click or bullet hit): setting a rigid body's linear velocity directly vs applying an impulse (AddForce ForceMode.Impulse, PhysX addForce eIMPULSE, Havok applyLinearImpulse) or a force over a few steps. Does a large velocity set on one link of a joint chain cause penetration, joint stretching or blow-ups that an impulse or force avoids, and what do Unity, Unreal (Physical Animation), Havok and Rapier docs recommend for hit reactions and ragdoll pokes? Cite docs and developer talks.

For a mouse poke or bullet hit, **apply an impulse at the contact point** rather than overwriting a link’s velocity. A force over several fixed steps is appropriate when the interaction has duration—such as a shove, jet, or sustained weapon force. Direct velocity assignment is a kinematic-style correction and should be reserved for deliberate gameplay control, not ordinary physical impacts.

## What happens in a joint chain

Setting one link’s velocity to a very large value does not inherently “stretch” an ideal joint: the solver will try to enforce the joint constraints on the next simulation step. However, it creates an abrupt constraint error and can require very large corrective impulses. Depending on timestep, solver iterations, joint limits, masses, collision geometry, and maximum-depenetration settings, the result can include:

- Visible joint separation or stretching for a frame.
- Violent corrective motion, jitter, or instability.
- Excessive joint impulses that cause a chain to explode or a joint to break.
- Tunneling or deep penetration if the assigned velocity moves the body farther than collision detection can robustly handle in one step.
- Energy that does not correspond to the intended hit, especially if only one link is changed.

An impulse also changes velocity instantly, so it is **not magically immune** to these problems. The difference is that an impulse expresses a momentum change through the physics API, incorporates mass—and, when applied at a point, angular momentum—and lets the solver process it as part of the step. An arbitrarily large impulse can still destabilize a ragdoll.

Unity documents `Rigidbody.linearVelocity` as the body’s rate of position change[1], while `ForceMode.Impulse` applies an instantaneous force and is mass-dependent, making it suitable for events such as explosions and collisions[3]. Unity’s ragdoll system is explicitly built from colliders, rigidbodies, and joints for impact simulation[5].

## Practical choice

| Interaction | Preferred operation | Reason |
|---|---|---|
| Bullet, punch, explosion, click “poke” | Impulse at the hit point | Models an instantaneous momentum transfer and produces both translation and rotation |
| Push held for time | Force each fixed step | Acceleration is integrated over the duration |
| Desired immediate gameplay velocity | Carefully set velocity | Predictable but bypasses normal mass-based momentum transfer |
| Teleport or reposition | Move the whole articulated pose consistently | Avoids giving one link an impossible state |
| Strong hit on a ragdoll | Impulse plus bounded hit-reaction tuning | Avoids arbitrary velocity discontinuities while preserving authored control |

For a hit at world point \(p\), use a force direction and magnitude that reflect the impact, preferably with:

\[
\Delta v = \frac{J}{m}
\]

and apply \(J\) at \(p\), so the off-center hit also generates angular impulse. Rapier’s documentation makes this distinction explicit: forces affect acceleration, whereas impulses affect velocity immediately, with velocity change equal to impulse divided by mass[6].

## Unity

Use `AddForceAtPosition(direction * impulseMagnitude, ForceMode.Impulse)` for a physical hit. Avoid assigning a huge `linearVelocity` to one bone unless the intention is to override physical behavior. If an authored hit reaction is needed, cap the impulse or blend toward a target velocity over several fixed updates rather than injecting an extreme one-frame value.

The impulse should generally be applied to the hit rigidbody, not manually distributed across every bone. The joint solver and articulated mass distribution then propagate the response. For a highly constrained or unstable setup, inspect joint anchors, mass ratios, collision filtering, solver iteration counts, timestep, and joint projection settings.

## Unreal Physical Animation

For Unreal ragdolls, the usual separation is:

- Use physical impulses or forces for genuine impacts.
- Use Physical Animation to drive bodies toward animation poses while allowing physics to react.
- Use an authored physical-animation profile and blend strength rather than forcing a single bone’s velocity to an extreme value.

Physical Animation is a controller layered over the simulated bodies; it is not a replacement for physically plausible impact input. A hit reaction commonly combines an impulse on the affected body with temporary changes to physical-animation strength, stiffness, damping, or the blend between animation and simulation. Applying an impulse to the hit bone is preferable to directly assigning velocity because it preserves the solver’s mass and constraint treatment.

## NVIDIA PhysX

PhysX’s `eIMPULSE` mode corresponds to an instantaneous momentum change; a force mode integrates a force according to the simulation timestep. For collision-like events, an impulse is the appropriate abstraction. Applying velocity directly bypasses the normal force/momentum path and can leave the joint solver with a large positional and velocity inconsistency to correct.

PhysX still cannot guarantee stability for unlimited impulses. Keep the impulse physically or gameplay bounded, use continuous collision detection for fast-moving small projectiles, and avoid extreme adjacent-body mass ratios. A joint is a constraint, not an infinite-strength promise that any arbitrary manually assigned state will remain stable.

## Havok and Rapier

Havok’s rigid-body APIs distinguish applying a linear impulse from applying a force over time. The same engineering rule applies: use an impulse for an instantaneous hit, and a force for sustained acceleration. For a ragdoll, apply the impulse through the normal dynamics interface and let the constraint solver distribute the resulting reaction.

Rapier documents the same model directly: custom forces affect acceleration, while impulses immediately modify velocity[6]. Its joint documentation also exposes the impulses generated by joint constraints, limits, and motors, illustrating that joint stabilization is itself impulse-based[4]. Those solver impulses can be inspected and used to detect excessive constraint loading or decide when a joint should break.

## Recommended implementation pattern

1. Convert the click or bullet event into a world-space hit point and direction.
2. Compute a bounded impulse from weapon strength, surface response, and hit mass.
3. Apply it at the hit point through the engine’s impulse API.
4. Enable suitable continuous collision detection for fast projectiles or small bodies.
5. Keep neighboring ragdoll masses within a reasonable ratio.
6. Tune fixed timestep, solver iterations, joint limits, damping, and collision filtering.
7. Add authored hit-reaction blending or temporary joint weakening only if the desired result is more dramatic than the physical response.
8. Avoid overwriting a single link’s velocity except for an explicitly designed gameplay effect; if it is necessary, use a limited delta and apply it coherently to the relevant articulated bodies.

In short: **impulse for the hit, force for the duration, velocity assignment only for controlled overrides**. An impulse can still destabilize a ragdoll when excessively large, but direct velocity injection is more likely to create an unphysical state that manifests as penetration, stretching, or solver explosions.

[1] Rigidbody • Unity Editor (https://docs.unity.com/en-us/engine/6000.5/script-reference/unityengine/rigidbody)
[2] docs.unity.com · script-reference · unityengineRigidbody • Unity Editor • Unity Docs (https://docs.unity.com/en-us/engine/7000.0/script-reference/unityengine/rigidbody)
[3] Impulse • Unity Editor • Unity Docs (https://docs.unity.com/en-us/engine/6000.6/script-reference/unityengine/forcemode/impulse)
[4] Joints - Rapier.rs (https://rapier.rs/docs/user_guides/templates/joints/)
[5] Ragdoll physics • Built-in 3D physics • 7000.0 • Unity Editor • Unity Docs (https://docs.unity.com/en-us/engine/7000.0/manual/physics-section/physics-overview/ragdoll)
[6] rigid_body_forces_and_impulses (https://rapier.rs/docs/user_guides/c/rigid_body_forces_and_impulses/)
[7] Unity - Scripting Api: Rigidbody (https://docs.unity3d.com/6000.2/Documentation/ScriptReference/Rigidbody.html)
[8] Rigidbody - Unity - Manual (https://docs.unity3d.com/2018.3/Documentation/Manual/class-Rigidbody.html)
[9] Unity - Manual: Rigidbody component reference (https://docs.unity3d.com/2020.3/Documentation//Manual/class-Rigidbody.html)
[10] Rigidbody (https://docs.unity3d.com/500/Documentation/Manual/class-Rigidbody.html)
