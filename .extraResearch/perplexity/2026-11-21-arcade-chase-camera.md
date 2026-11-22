> Question: How do arcade racing and open-world driving games design the chase camera behind the player's car (distance, height, field of view changes with speed, lag or spring behaviour, look-ahead, what happens when reversing, stopping or hitting walls, keeping the camera out of the car's body and out of walls)? Cite developer talks, articles, mod documentation or source code with concrete numbers where they exist.

A robust chase camera is usually a **spring-mounted, collision-aware rig** rather than a transform rigidly attached to the car. It follows the car’s position and travel direction, but smooths distance, height, rotation, framing, and impacts independently.

## Typical camera geometry

A common starting point is an offset of roughly **10 m behind** and **3 m above** the car, aimed at the car plus some road ahead.[2] Practical chase-camera guides give approximately **10–15 m** of distance and **55–60°** FOV as reasonable starting values, though these are design presets rather than universal industry standards.[7]

The camera generally uses:

- A pivot near the car’s center of mass or roof.
- A local offset such as \((0, h, -d)\), transformed by the car’s orientation or velocity direction.
- A target point above the car and ahead of it, rather than the model origin.
- Separate “close,” “far,” “hood,” and “bumper” presets.

The OpenUG2 driving-camera documentation is a useful concrete example: it implements several driving views, per-car camera records, a smoothed motion model, and camera collision handling.[6] Its chase collision model uses a **0.55 m-radius camera clip sphere**, deliberately larger than the near plane so walls do not visually cut through the camera.[6]

## Distance and height

Distance is usually speed-dependent:

\[
d(v)=\operatorname{clamp}(d_0+k|v|,d_{\min},d_{\max})
\]

At low speed, the camera moves closer; at high speed, it pulls back to show more road. This is explicitly described as a common racing-game technique: increase camera distance with speed and reduce it as the car slows.[2]

Height may also change with speed, terrain, or camera mode:

- Lower and closer for a more dramatic, fast-feeling view.
- Higher and farther for visibility and navigation.
- Raised temporarily when nearby geometry or another car would obscure the view.

OpenUG2’s implementation raises the camera over nearby AI-car body spheres within **12 m**, with a **0.1 m margin** and up to **four passes**.[6] That is an example of visibility correction rather than ordinary follow height.

## FOV changes with speed

Many arcade-style cameras widen FOV as speed increases:

\[
\mathrm{FOV}(v)=\operatorname{clamp}
\left(\mathrm{FOV}_0+k_{\mathrm{FOV}}|v|,
\mathrm{FOV}_{\min},\mathrm{FOV}_{\max}\right)
\]

The purpose is not physical accuracy; it communicates acceleration and gives the player more peripheral information. A documented racing-camera implementation describes FOV as widening with speed, alongside distance, lag, and look-ahead controls.[10]

The change should normally be smoothed rather than applied immediately:

\[
f_{\text{current}}\leftarrow
\operatorname{lerp}(f_{\text{current}},f_{\text{target}},1-e^{-r\Delta t})
\]

A modest change is usually preferable. Excessive FOV produces a fisheye-like image and can make steering judgment worse.

## Lag and spring behavior

The camera should not simply copy the car’s transform. Instead, it follows a target using critically damped or spring-like motion:

\[
\ddot{x}=k(x_{\text{target}}-x)-c\dot{x}
\]

With critical damping:

\[
c=2\sqrt{k}
\]

Separate response rates are useful:

- **Position:** moderately soft, so acceleration and terrain movement are visible.
- **Rotation:** often slower than the car’s instantaneous yaw, especially during drifting.
- **Distance:** smooth and relatively slow to prevent zoom oscillation.
- **FOV:** smooth and slower still.
- **Collision retraction:** fast inward response, slower outward recovery.

A racing-camera discussion describes this in terms of spring angle, stiffness, and length: stiffness controls jerkiness, length controls distance, and excessive looseness can make the player lose the road during sharp turns.[2]

A practical implementation often uses critically damped smoothing rather than a simple frame-rate-dependent lerp. For a scalar value:

```cpp
void SmoothDamp(float& x, float& velocity,
                float target, float smoothTime, float dt)
{
    float omega = 2.0f / max(smoothTime, 0.001f);
    float a = omega * dt;
    float exp = 1.0f / (1.0f + a + 0.48f*a*a + 0.235f*a*a*a);

    float change = x - target;
    float temp = (velocity + omega * change) * dt;

    velocity = (velocity - omega * temp) * exp;
    x = target + (change + temp) * exp;
}
```

Use different `smoothTime` values for distance, height, yaw, pitch, and FOV.

## Look-ahead and heading

The camera usually aims at a point ahead of the car:

\[
p_{\text{look}}=
p_{\text{car}}+
a\,\hat{v}+
b\,\hat{f}
\]

where \(\hat{v}\) is normalized velocity direction and \(\hat{f}\) is the car’s forward direction. This helps during drifting: the camera can remain behind the direction of travel instead of blindly following the nose.

The look-ahead distance should increase with speed but be clamped:

\[
a(v)=\operatorname{clamp}(a_0+k_a|v|,a_{\min},a_{\max})
\]

A documented camera design specifically recommends looking slightly ahead at speed so more track is visible, rather than always aiming at the player model’s origin.[4] Another racing-camera API describes its defining behavior as sitting behind the direction of travel, looking into the corner, and widening with speed.[10]

A useful compromise is:

- Low speed: use mostly car forward direction.
- High speed: blend toward velocity direction.
- Heavy drift: limit the blend so the camera does not swing violently sideways.
- Cornering: add a small lateral look-ahead based on steering or predicted path curvature.

## Reversing

Reversing needs an explicit policy; simply multiplying the forward offset by reverse velocity often produces an unpleasant camera flip.

Common choices are:

1. **Keep the normal chase camera behind the car.**  
   The camera remains behind the vehicle’s rear, while the look target moves toward the reverse travel direction.

2. **Blend toward a rear-facing view.**  
   When reverse speed exceeds a threshold, rotate the camera gradually rather than snapping it.

3. **Use a dedicated look-back mode.**  
   OpenUG2 documents a held “look back” control that mirrors the view through the car’s vertical axis.[6]

A robust rule is:

\[
\hat{d}=
\operatorname{normalize}
\left(
(1-r)\hat{f}+r\hat{v}
\right)
\]

with \(r\) reduced or specially handled when \(v\cdot \hat f<0\). This prevents velocity noise at very low speed from rotating the camera unpredictably.

At the transition between forward and reverse:

- Freeze or heavily damp yaw near zero speed.
- Wait until reverse speed exceeds a small threshold.
- Blend over perhaps \(0.3\)–\(0.8\) seconds rather than snapping.
- Preserve player-controlled look-back input as an override.

## Stopping and low speed

At a stop, velocity direction becomes undefined. The camera should therefore retain the last valid travel direction or car heading:

```cpp
if (speed > 0.5f)
    travelDirection = normalize(velocity);
else
    travelDirection = previousTravelDirection;
```

Distance can move toward a short idle value, but it should not oscillate around zero. FOV should return gradually to its base value. Rotation damping should often become stronger while stationary so the camera settles instead of continually correcting small physics rotations.

## Impacts and wall hits

A wall collision should not instantly teleport the camera to a new transform. Instead, treat the impact as a temporary camera impulse:

- Add a short backward or lateral positional kick.
- Add a brief pitch/yaw impulse.
- Increase shake based on collision impulse.
- Quickly retract if the wall occupies the camera path.
- Recover more slowly than the initial impact.

For example:

\[
x_{\text{kick}}(t)=A e^{-t/\tau}
\]

with a short \(\tau\), while ordinary camera position continues to follow the smoothed target.

The camera should distinguish between:

- **Vehicle physics collision:** produces shake or kick.
- **Camera obstruction:** changes camera position to preserve visibility.
- **Vehicle resting against a wall:** prevents continuous shake every frame.

Trigger impact effects only on a rising collision impulse or velocity change, not merely because contact remains true.

## Keeping the camera out of the car

Do not place the camera at the mathematically desired point without checking the car model. Cast or sweep from the camera pivot toward the desired camera position:

```cpp
Vec3 pivot = cameraPivot;
Vec3 desired = pivot - travelDirection * distance
                     + Vec3(0, height, 0);

Hit hit;
if (SweepSphere(pivot, desired, cameraRadius, hit)) {
    float safeDistance = max(hit.distance - cameraRadius - margin,
                             minimumDistance);
    actual = pivot + normalize(desired - pivot) * safeDistance;
}
else {
    actual = desired;
}
```

The sphere radius must account for the near plane and numerical tolerance. OpenUG2 gives a concrete value of **0.55 m** for this purpose.[6]

Use a camera pivot that is above or just outside the vehicle’s body, and include an interior minimum distance. If the desired point would enter the car:

- Clamp to a minimum distance from the pivot.
- Raise the camera slightly.
- Move it laterally only as a last resort.
- Avoid using the rendered vehicle mesh alone if it has holes or thin surfaces; a simplified collision hull is more reliable.

## Keeping the camera out of walls

The standard third-person solution is a **sphere cast** or **capsule cast** from the pivot to the desired position. A ray is insufficient because it treats the camera as a point and permits wall clipping at the screen edges.

When an obstruction is found:

\[
d_{\text{actual}}=
\max(d_{\min},
d_{\text{hit}}-r_{\text{camera}}-\epsilon)
\]

Then smooth only the outward recovery:

```cpp
if (blocked)
    currentDistance = min(currentDistance, safeDistance);
else
    currentDistance = SmoothToward(currentDistance,
                                   desiredDistance,
                                   recoveryRate,
                                   dt);
```

This gives immediate retraction but prevents the camera from popping back and forth when passing pillars or walls. A documented open-world camera implementation uses exactly this conceptual pattern: hold the desired length in clear space, retract toward the pivot when obstructed, then spring back outward when clear.[8]

Additional protections include:

- Multiple sweeps or iterative depenetration for corners.
- A minimum camera distance to avoid entering the car.
- A small collision margin to prevent surface jitter.
- Testing against static level geometry and dynamic vehicles.
- Raising the camera over nearby occluders when retraction would make the car unreadable.
- Fading or transparently rendering the player car only as a last resort.

## A practical update order

A stable frame update can follow this sequence:

1. Read car position, heading, velocity, steering, and collision impulse.
2. Select a travel direction, retaining the previous direction near zero speed.
3. Compute speed-dependent distance, height, FOV, and look-ahead targets.
4. Compute the desired camera pivot and look target.
5. Apply camera collision sweep and car-body exclusion.
6. Smooth actual position, rotation, distance, and FOV with separate rates.
7. Add temporary impact kick and controlled shake.
8. Recompute the final look-at orientation.
9. Apply rendering-specific effects such as motion blur or exposure changes.

The key design principle is to separate **desired framing** from **physical camera placement**. The former decides what the player should see; the latter resolves the car, walls, other vehicles, and smoothing constraints before rendering.

[1] github.com › QuinnGao › 3d-car-demoGitHub - QuinnGao/3d-car-demo: A 3D car driving game built ... (https://github.com/QuinnGao/3d-car-demo)
[2] ELI5: how do racing games typically angle cameras to look as nice as they do when turning? How do they make it look natural and gradual, yet still functional? (https://www.reddit.com/r/explainlikeimfive/comments/fgxj43/eli5_how_do_racing_games_typically_angle_cameras/)
[3] Field of View (https://www.reddit.com/r/Games/comments/3zec41/field_of_view/)
[4] The Camera Is a Game Mechanic, Not a Recording Device (https://supagamesai.com/learn/threejs-camera-as-game-mechanic.html)
[5] Why Are Racing Games So Slow - PC Gaming Universe (https://pcgaminguniverse.com/why-are-racing-games-so-slow/)
[6] OpenUG2/docs/CAMERA.md at main · whoismept/OpenUG2 (https://github.com/whoismept/OpenUG2/blob/main/docs/CAMERA.md)
[7] How to Optimize Camera Settings for Racing Lines in Forza ... (https://forum.serjmin.com/viewtopic.php?f=7&t=2140)
[8] Building an open world in the browser, part 30: A camera that ... (https://app.cinevva.com/blog/2026-06-04-open-world-browser-part-30-collision-aware-camera)
[9] GitHub - AyanMemon296/open-world-driver: An infinite 3D driving … (https://github.com/AyanMemon296/open-world-driver)
[10] ChaseCamera class final (https://pub.dev/documentation/flutter3d_game_racing/1.0.0-rc.2/flutter3d_game_racing/ChaseCamera-class.html)
