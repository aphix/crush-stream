> Question: Real-time car crash simulation: when two deformable bodies or a car and a barrier collide over an area, how should crush force and deformation be distributed over the contact patch rather than applied at a single point? Describe approaches in soft-body/shape-matching or node-beam vehicle damage (pressure over overlapping area, per-node penetration weighting, Hertz/area scaling) and how momentum is conserved across the patch.

Treat collision as a **set of local contact elements**, not one collision point. Each element has a contact position, normal, penetration or gap, effective area, and relative velocity. Compute a force or impulse there, apply equal-and-opposite reactions to both bodies, and sum the resulting forces and torques.

## 1. Discretize the contact patch

Generate contact samples from:

- Overlapping surface triangles or polygon intersections.
- Node–triangle, node–segment, or beam–surface contacts.
- Particle neighborhoods in a soft-body model.
- A signed-distance or voxel/grid overlap region.

For each contact sample \(i\), calculate:

\[
\delta_i = \max(0,-g_i)
\]

where \(g_i\) is the signed normal gap and \(\delta_i\) is penetration. Associate an area \(A_i\), usually the clipped overlap area divided among nearby nodes or integration points.

The total normal force is then

\[
F_n = \sum_i F_i,
\qquad
F_i = A_i\,p_i(\delta_i,\dot{\delta}_i,\text{material state}).
\]

This is preferable to assigning one force to the deepest node, which produces unrealistic local impulses and poor torque distribution. Penalty contact is commonly formulated this way: penetration is converted into pressure, while the opposing body receives the equal reaction; penalty contact methods conserve momentum when the action–reaction pair is applied consistently.[1]

## 2. Pressure-based contact

For a simple elastic-damping law:

\[
p_i =
k_c \delta_i^m
+
c_c \max(0,\dot{\delta}_i),
\]

with \(m=1\) for a linear penalty and \(m\approx 3/2\) for a Hertz-like local law. The elemental force is

\[
\mathbf F_i = A_i p_i \mathbf n_i.
\]

Use the contact normal oriented from body \(B\) toward body \(A\). Apply

\[
\mathbf F_A += \mathbf F_i,
\qquad
\mathbf F_B -= \mathbf F_i.
\]

For deformable crash structures, \(k_c\) should generally represent the **combined compliance** of the two contacting layers, not just the stiffness of one mesh. A convenient series approximation is

\[
\frac{1}{k_c}
=
\frac{1}{k_A}
+
\frac{1}{k_B}.
\]

If one body is a rigid barrier, \(k_B\) is effectively very large, so the vehicle material dominates.

A velocity-dependent term should be limited carefully. Excessive damping creates artificial energy loss and can make the force depend strongly on timestep. Implicit integration, substepping, or a compliant impulse solver is often needed when contact stiffness is high.

## 3. Area scaling and Hertz-style models

For approximately curved elastic contact, use an effective contact radius \(R\) and effective modulus \(E^*\):

\[
F_n =
\frac{4}{3}E^*\sqrt{R}\,\delta^{3/2}.
\]

This is useful for a compact contact patch, but it should not be blindly applied to a flat crash surface. In a discretized vehicle, a practical hybrid is:

- Detect the overlap patch.
- Estimate an effective area \(A\).
- Use a pressure law \(p(\delta)\).
- Scale the force by \(A\).
- Optionally use a Hertz exponent for local rounded features.

Do not multiply a Hertz force by area if the Hertz formula already represents the integrated force over the contact patch; that would double-count area. Either use an integrated force law \(F(\delta)\), or use a pressure law and integrate it over \(A\).

For roughly uniform compression:

\[
F_n \approx A\,k_p\,\delta.
\]

For a patch whose penetration varies spatially:

\[
F_n \approx \int_{\mathcal P} p(\delta(\mathbf x))\,dA
\approx \sum_i A_i p_i.
\]

## 4. Per-node penetration weighting

In a node-based vehicle model, distribute each contact contribution to nearby structural nodes rather than applying it directly to one node.

For contact point \(c\), find the containing triangle, beam segment, or nearby nodes. Use barycentric or shape-function weights \(w_{ij}\), satisfying

\[
\sum_j w_{ij}=1.
\]

Then distribute the elemental force as

\[
\mathbf F_{ij}=w_{ij}\mathbf F_i.
\]

For a node–surface contact, weights can be based on:

- Barycentric coordinates of the projected point.
- Inverse distance, \(w_j\propto d_j^{-q}\).
- Kernel support radius.
- Tributary area or nodal mass.
- Penetration-weighted influence, for example
  \[
  w_j \propto A_{ij}\,\phi_j\,\delta_i.
  \]

The last option is useful when several nodes lie inside the same overlap region: nodes contributing more surface area or experiencing greater penetration receive more load.

For a beam vehicle model, convert the contact force into nodal forces and a couple. If the force acts at position \(\mathbf r_c\) along a beam element, distribute it to the beam’s end nodes using interpolation weights and preserve the contact moment:

\[
\boldsymbol\tau_c
=
(\mathbf r_c-\mathbf r_{\mathrm{COM}})\times\mathbf F_c.
\]

If the interpolation cannot reproduce the required moment, add an equal-and-opposite nodal couple or use a constraint formulation that transfers both force and torque.

## 5. Shape matching and soft bodies

Shape matching should provide the body’s internal restorative response, not replace spatially distributed contact.

A typical loop is:

1. Detect all contact samples.
2. Compute local contact forces or impulses.
3. Apply them to particles/nodes.
4. Compute the best-fit rigid transform of the current particle set to its rest shape.
5. Pull each particle toward its matched target with shape-matching forces or position corrections.
6. Solve constraints and integrate velocities.

Shape matching fits the rest configuration by aligning centers of mass and estimating the best rotation, then pulls particles toward corresponding matched positions.[8] It is computationally cheap, but basic shape matching can make deformation overly local because neighboring particles do not automatically transmit load as a continuum would.[8] To improve crash-like load spreading, combine it with:

- Multiple overlapping shape-matching clusters.
- Distance, volume, or beam constraints.
- Material-region stiffness and plasticity.
- Bending constraints.
- Contact-aware cluster weighting.
- Damage-dependent reduction of cluster stiffness.

A useful contact-aware stiffness model is to let the local restorative stiffness depend on accumulated plastic work or crush:

\[
k_{\text{local}}
=
k_0(1-D),
\]

where \(D\in[0,1]\) is a damage variable. Contact pressure can similarly use an internal crush state:

\[
p_i =
p_{\text{elastic}}(\delta_i-\delta_i^p)
+
p_{\text{damp}}(\dot{\delta}_i).
\]

This allows permanent crush instead of merely pushing the mesh back to its original shape.

## 6. Momentum and angular momentum conservation

The key rule is to use **paired impulses** at the same physical contact location. For an impulse \(\mathbf J_i\) over timestep \(\Delta t\):

\[
\mathbf v_A'=\mathbf v_A+\frac{\mathbf J_i}{m_A},
\qquad
\mathbf v_B'=\mathbf v_B-\frac{\mathbf J_i}{m_B}.
\]

The net linear impulse is zero for the isolated pair. For rotational motion, apply the corresponding torques:

\[
\boldsymbol\tau_A
=
(\mathbf r_i-\mathbf x_A)\times\mathbf J_i,
\qquad
\boldsymbol\tau_B
=
(\mathbf r_i-\mathbf x_B)\times(-\mathbf J_i).
\]

Do not apply the summed force at the patch centroid unless the patch is intentionally reduced to a rigid resultant and its total moment is also preserved. The distributed method naturally produces:

\[
\mathbf F_{\text{total}}=\sum_i\mathbf F_i,
\]

\[
\boldsymbol\tau_{\text{total}}
=
\sum_i
(\mathbf r_i-\mathbf x_{\mathrm{COM}})
\times \mathbf F_i.
\]

For position-based solvers, direct position projection can violate momentum unless the correction is converted into impulses or velocities. Use mass-weighted corrections, apply equal-and-opposite corrections to both bodies, and preserve the first moments of the correction forces. Shape-matching solvers likewise need rotation estimation and constraint application that preserve both linear and angular momentum; otherwise they can introduce spurious motion.[6]

## 7. Friction and tangential load

Decompose relative contact velocity into normal and tangential parts:

\[
\mathbf v_{\mathrm{rel}}
=
\mathbf v_n+\mathbf v_t.
\]

Compute normal pressure first, then limit tangential traction by Coulomb friction:

\[
\|\mathbf T_i\|
\le
\mu_i p_i A_i.
\]

Apply the tangential force at the same contact location as the normal force. This prevents friction from generating an incorrect torque or from being concentrated at a single arbitrary node.

## Practical algorithm

```text
for each overlapping contact patch:
    generate contact samples i
    compute area Ai, normal ni, gap gi, relative velocity
    compute penetration δi = max(0, -gi)

    pressure pi = contact_material_law(δi, normal_speed, damage)
    normal_force Fi = Ai * pi * ni

    tangential_force Ti = friction_limit(Fi, tangential_velocity)

    resultant Ri = Fi + Ti

    distribute Ri to body-A nodes using shape/barycentric weights
    distribute -Ri to body-B nodes using corresponding weights

    apply both forces at the same contact position
    accumulate force and torque for each body
```

The most robust real-time compromise is therefore **patch sampling + area-weighted penalty pressure + shape-function distribution + equal-and-opposite force/torque accumulation**, augmented with plastic crush and multiple shape-matching or beam constraints. It gives localized deformation without sacrificing the global momentum behavior expected from a physically consistent collision response.

[1] 36.2.3 Contact constraint enforcement methods in Abaqus ... (http://abaqusdocs.eait.uq.edu.au/v6.11/books/usb/pt09ch36s02aus177.html)
[2] Soft-bodies | Rapier (https://rapier.rs/docs/user_guides/c/soft_bodies/)
[3] Soft-bodies | Rapier (https://rapier.rs/docs/user_guides/rust/soft_bodies/)
[4] A Dynamic Implicit 3D Material Point‐To‐Rigid Body Contact ... (https://onlinelibrary.wiley.com/doi/10.1002/nme.70080)
[5] An Extended B‐Spline‐Based Material Point Method for ... (https://onlinelibrary.wiley.com/doi/full/10.1002/nme.70003)
[6] Soft-body dynamics - Wikipedia (https://en.wikipedia.org/wiki/Soft-body_dynamics)
[7] Enhanced Accuracy and Computational Efficiency: A Modified Formulation of a Displacement-Driven Approach for Large Deformation Frictional Contact (https://onlinelibrary.wiley.com/doi/10.1002/nme.7659)
[8] Soft-bodies (https://rapier.rs/docs/user_guides/javascript/soft_bodies/)
[9] soft_body_cohesion (https://rapier.rs/docs/user_guides/javascript/soft_body_cohesion/)
[10] Soft Body Deformation Dynamics Based on Shape Matching (https://nccastaff.bournemouth.ac.uk/jmacey/MastersProject/MSc13/18/report/i7762542_Report.pdf)
