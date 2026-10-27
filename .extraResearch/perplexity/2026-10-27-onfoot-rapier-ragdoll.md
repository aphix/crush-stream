> Question: With the Rapier physics engine (rapier3d / rapier.js), what are good techniques for a player character that walks and runs fast and smoothly but can become a ragdoll on hits: a KinematicCharacterController capsule for locomotion versus a motor-driven active ragdoll with joint motors, how to switch between them, and how to blend a ragdoll back to a controllable standing state? Include API names, motor stiffness/damping guidance, and performance notes, with sources.

For a fast, responsive player who can become physically limp on impact, the best default is a **hybrid**:

- Use a **KinematicCharacterController (KCC)** capsule for normal locomotion.
- Keep a separate, usually disabled, **dynamic ragdoll skeleton** for impacts.
- On a ragdoll event, transfer the player’s pose and velocity to the ragdoll, disable the capsule controller, and enable the ragdoll.
- On recovery, drive the ragdoll toward a prepared standing pose, then switch control back to the capsule.

Rapier’s KCC is specifically designed for move-and-slide movement, slope handling, stair climbing, and small obstacles.[2] Its JavaScript API is `world.createCharacterController(offset)` followed by `computeColliderMovement(collider, desiredTranslationDelta)`, after which the resulting movement is read and applied to the body.[3][6]

## 1. Kinematic capsule: recommended locomotion solution

Use a kinematic rigid body with a capsule collider, or a parentless capsule collider where appropriate.

Typical update flow:

```js
const controller = world.createCharacterController(0.02);

controller.setUp({ x: 0, y: 1, z: 0 });
controller.setMaxSlopeClimbAngle(Math.PI * 0.25);
controller.setMinSlopeSlideAngle(Math.PI * 0.75);
controller.enableAutostep(0.35, 0.2, true);

const desired = {
  x: velocity.x * dt,
  y: velocity.y * dt,
  z: velocity.z * dt,
};

controller.computeColliderMovement(
  playerCollider,
  desired
);

const movement = controller.computedMovement();
playerBody.setNextKinematicTranslation({
  x: playerBody.translation().x + movement.x,
  y: playerBody.translation().y + movement.y,
  z: playerBody.translation().z + movement.z,
});
```

Names can vary slightly with the Rapier JavaScript package version, but the central API is `computeColliderMovement`; it computes the translation remaining after collision response and sliding.[3]

Good practices:

- Maintain horizontal acceleration and braking yourself rather than instantly changing speed.
- Use a capsule rather than a detailed mesh; Rapier recommends capsules, balls, and cuboids because they are computationally cheaper and numerically simpler.[2]
- Keep the capsule slightly separated from the environment using the controller’s `offset`. The offset improves numerical stability and helps prevent sticking.[2]
- Use `computedGrounded()` or the equivalent controller output to decide whether to apply gravity, jump, and footstep logic.
- Filter the controller so it does not collide with the ragdoll’s own colliders. `computeColliderMovement` supports collision filtering through flags, groups, and a predicate.[10]
- For very high running speeds, use a fixed physics timestep and avoid moving the body by large unrestricted teleportations. The KCC’s shape casts should still be given the full desired displacement for the step.

This approach generally feels better than a fully physical player because acceleration, stopping, stairs, slopes, and input response are deterministic and easy to tune.

## 2. Motor-driven active ragdoll

An active ragdoll is appropriate when the character should remain physically simulated while trying to maintain a pose. It consists of:

- Dynamic rigid bodies for pelvis, torso, head, arms, and legs.
- Ball, revolute, or prismatic joints between body parts.
- Joint limits.
- Motors whose targets are generated from the animation or desired pose.

Rapier joints are inserted with `world.createImpulseJoint(...)` or `world.createMultibodyJoint(...)`.[1] Spherical, revolute, and prismatic joints support motors. Rapier describes these motors as PD controllers with target position, target velocity, stiffness, and damping.[1]

Conceptually:

```js
joint.configureMotorPosition(
  targetAngle,
  stiffness,
  damping
);

joint.configureMotorVelocity(
  targetVelocity,
  factor
);
```

The exact method names depend on the joint type and Rapier version. The underlying operations are commonly exposed as methods such as:

- `configureMotorPosition(...)`
- `configureMotorVelocity(...)`
- `configureMotor(...)`
- `configureMotorModel(...)`

Use the generated TypeScript declarations for the installed package as the final API authority.

### Motor tuning

Start with critically damped or slightly overdamped behavior rather than maximum stiffness.

For a joint with approximate effective inertia \(I\), a useful starting point is:

\[
k = I\omega_n^2
\]

\[
c = 2I\zeta\omega_n
\]

where:

- \(k\) is stiffness,
- \(c\) is damping,
- \(\omega_n\) is the desired natural frequency,
- \(\zeta\) is the damping ratio.

Use \(\zeta \approx 1\) for critical damping and \(1.1\)–\(1.5\) when you want less overshoot. In practice:

- Start with moderate stiffness and damping.
- Increase stiffness until the pose tracks adequately.
- Increase damping when limbs oscillate or overshoot.
- Reduce stiffness if the ragdoll jitters, explodes, or creates extreme solver impulses.
- Use lower stiffness in hands, feet, and neck than in the pelvis and torso.
- Use stronger torso and hip motors than wrist and ankle motors.
- Limit maximum motor force or torque where the API exposes that option.

The Rapier documentation specifies that stiffness controls the force toward the target relative position, while damping controls the force toward the target relative velocity.[8] Absolute numerical values are mass- and timestep-dependent, so values copied from another character rarely transfer directly.

A fully active ragdoll is usually more expensive and harder to stabilize than a capsule controller. It also requires careful collision filtering, joint limits, mass distribution, solver iterations, and pose targets. For a player character, it is often better as a hit-reaction or recovery system than as the primary locomotion system.

## 3. Switching from capsule to ragdoll

Treat the two representations as separate control modes rather than trying to make the same collider simultaneously kinematic and fully physical.

### Enter ragdoll

1. Stop accepting locomotion movement.
2. Read the capsule’s world transform and current velocity.
3. Sample the animated skeleton’s current world-space bone transforms.
4. Place each ragdoll rigid body at the corresponding bone transform.
5. Assign velocities:
   - Linear velocity from the player’s movement.
   - Additional impulse velocity from the hit.
   - Angular velocity from the animation pose or hit direction.
6. Disable or remove the capsule’s collision participation.
7. Enable the ragdoll rigid bodies and colliders.
8. Disable ragdoll self-collision selectively if adjacent parts generate undesirable jitter.
9. Apply the hit impulse to the relevant body, commonly the pelvis, torso, or struck limb.
10. Switch animation to ragdoll-driven bone transforms.

Avoid leaving both the capsule and ragdoll active in the same collision groups. Otherwise the two representations can collide with each other or produce duplicated physical mass.

A practical collision-group layout is:

- Environment: collides with capsule and ragdoll.
- Player capsule: collides with environment and gameplay objects.
- Ragdoll bodies: collide with environment and selected gameplay objects.
- Ragdoll self-collision: enabled only for useful pairs.

If the ragdoll should inherit the player’s momentum, copy the capsule’s velocity before disabling it. Rapier’s rigid bodies expose velocity setters such as `setLinvel` and `setAngvel`; use wake-up enabled when available.

## 4. Recovering from ragdoll

Do not instantly teleport a fallen ragdoll into a standing pose. A reliable recovery sequence is:

1. Decide whether recovery is allowed.
2. Find a suitable recovery animation: get-up-front, get-up-back, kneel, or similar.
3. Determine the desired root transform from the ragdoll.
4. Perform clearance tests for the standing capsule.
5. Align the recovery animation to the ragdoll’s pelvis and facing direction.
6. Blend physics toward the animation over several frames.
7. Freeze or disable the ragdoll at the end of the blend.
8. Place and re-enable the capsule.
9. Resume KCC locomotion with zeroed or smoothly restored velocity.

### Finding a safe standing position

Use ray casts and shape casts to check:

- Ground below the pelvis.
- Capsule clearance above the intended standing position.
- Obstacles around the character.
- Whether the character is trapped under geometry.

Do not recover if the standing capsule would overlap a wall, ceiling, or another character. In that case, remain ragdolled or use a crouched recovery.

### Physics-to-animation blending

There are two common approaches.

**Pose-target blending**

Continue simulating the ragdoll, but gradually change motor targets from the current physical pose to the recovery animation pose:

```js
const t = smoothstep(0, 1, recoveryTime / recoveryDuration);
const blend = t * t * (3 - 2 * t);

const target = slerp(currentPose, recoveryPose, blend);

joint.configureMotorPosition(
  target.angle,
  recoveryStiffness * blend,
  recoveryDamping
);
```

Begin with low stiffness so the ragdoll does not snap, then ramp stiffness over the recovery. This produces a physically plausible stand-up but can fail if the character is pinned or badly tangled.

**Animation-driven recovery**

Disable or greatly reduce physical influence and drive the skeleton through a get-up animation. The ragdoll is used only to determine the initial root position, orientation, and selected pose offsets. This is more reliable for a controllable game character.

A common production compromise is:

- Use physical ragdoll for the first impact and fall.
- Wait until linear and angular velocities are below thresholds.
- Blend the visible skeleton toward a recovery animation.
- Gradually increase motor strength or kinematic influence.
- Re-enable the capsule only when the recovery pose is stable.

During the final transition, copy the ragdoll pelvis transform to the player root, but project it onto the ground plane and correct the capsule height. Avoid inheriting a large residual angular velocity into the newly controllable character.

## 5. Recommended architecture

For most games:

| Mode | Representation | Control |
|---|---|---|
| Normal movement | Kinematic capsule | KCC and gameplay velocity |
| Minor hit reaction | Capsule plus animation reaction | KCC remains active |
| Knockdown | Dynamic ragdoll | Joint motors disabled or weakened |
| Get-up | Ragdoll with increasing motors or animation blend | Recovery controller |
| Standing again | Kinematic capsule | KCC resumes |

This hybrid model gives responsive high-speed movement without requiring the player to be a permanently stabilized physical mechanism.

A motor-driven active ragdoll is preferable as the primary locomotion system only when physical interaction is central to the game—for example, when the player must push, stumble, balance, or be affected continuously by forces. Even then, many implementations use a kinematic or animation-assisted root for navigation and dynamic limbs for secondary physical behavior.

## 6. Performance considerations

- Reuse one `KinematicCharacterController`; do not create one every frame.
- Keep the locomotion shape simple, preferably a capsule.[2]
- Simulate ragdoll bodies only when needed. Sleeping or disabling inactive ragdolls saves solver work.
- Reduce ragdoll body count where possible: pelvis, torso, head, upper/lower arms, and upper/lower legs are often enough.
- Avoid unnecessary self-collision pairs.
- Use fixed physics steps and tune solver iterations before pushing motor stiffness higher.
- Avoid very large mass ratios between neighboring bodies.
- Use impulse joints for ordinary ragdolls unless multibody behavior is specifically beneficial; benchmark both configurations for the target scene.
- Update motor targets once per physics step, not once per render frame.
- Keep rendering interpolation separate from physics simulation.
- Pool ragdoll resources if many characters can be knocked down.
- Consider simplified ragdolls for distant characters and purely animated hit reactions for far-away NPCs.

The KCC itself performs ray casts and shape casts to resolve movement, so its cost rises with collider complexity and environmental query load.[2] The ragdoll cost is dominated by the number of active bodies, joints, collision pairs, and solver iterations. The safest optimization is to keep only nearby, visible ragdolls fully simulated and downgrade the rest.

[1] Joints (https://rapier.rs/docs/user_guides/javascript/joints/)
[2] Character controller (https://rapier.rs/docs/user_guides/javascript/character_controller/)
[3] KinematicCharacterController | @dimforge/rapier3d (https://rapier.rs/javascript3d/classes/KinematicCharacterController.html)
[4] KinematicCharacterController | @dimforge/rapier2d (https://rapier.rs/javascript2d/classes/KinematicCharacterController.html)
[5] Controllers (https://rapier.rs/docs/user_guides/c/character_controller/)
[6] character_controller_setup | Rapier (https://rapier.rs/docs/user_guides/javascript/character_controller_setup/)
[7] Character controller (https://rapier.rs/docs/user_guides/bevy_plugin/character_controller/)
[8] Joints | Rapier (https://rapier.rs/docs/user_guides/c/joints/)
[9] Controllers (https://rapier.rs/docs/user_guides/python/character_controller/)
[10] character_controller_filtering (https://rapier.rs/docs/user_guides/javascript/character_controller_filtering/)
