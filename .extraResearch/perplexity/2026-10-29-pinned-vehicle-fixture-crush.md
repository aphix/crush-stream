> Question: In crash simulation and vehicle soft-body physics (BeamNG node-beam, FEA crash codes like LS-DYNA, and game physics engines), how is a vehicle that is held fixed to the ground (fixed nodes, rigid constraint, 'bolted down' test fixture such as a pendulum or impactor test rig) modelled so that an impactor still crushes it correctly? (1) Is the fixture modelled as constraints on some nodes (the rest free to deform), or as infinite mass for the whole body, and why? (2) How does energy accounting work: impactor kinetic energy = deformation energy + fixture reaction work? (3) In an impulse/velocity-level contact solver (sequential impulses, plastic contact with an equivalent-barrier-speed reading), what is the standard way to compute the deformation energy delivered to a body that cannot move — e.g. use the impactor's full kinetic energy relative to the fixed body, rather than splitting by each body's velocity change? Cite sources where possible and separate documented practice from inference.

A fixed crash-test body is normally modeled as a **deformable body with selected degrees of freedom restrained**, not as a body whose entire mass is replaced by infinite mass. The impactor remains dynamic, contacts the deformable structure, and the fixture supplies reaction forces through the restrained nodes or rigid supports.

## 1. How the fixture is represented

### Deformable vehicle or crash box

In an LS-DYNA-style model, the usual arrangement is:

- The crushable component remains a deformable finite-element part.
- Nodes or a node set at the rear, base, rails, or fixture interface receive SPC constraints, prescribed motion, or a coupling to a rigid fixture.
- The impactor is modeled as a rigid body or deformable body with its own mass and initial velocity.
- Contact is defined between the impactor and the deformable component.

An LS-DYNA technical example explicitly fixes the rear end of a crash box with `*BOUNDARY_SPC_SET` while applying initial velocity to the impactor as a rigid body.[1] Another example fully constrains the bottom of an impacted surface with SPC.[1] This is the normal interpretation of “bolted down”: **restrain the physical attachment locations and leave the rest of the structure free to deform**.

In BeamNG’s node-beam formulation, nodes are mass points and beams are spring/damper-like structural connections.[2][3] Therefore, an anchored soft body is most naturally represented by fixing selected base or fixture nodes, while the other nodes retain their masses and can move and deform. Fixing every node would turn the vehicle into a non-deforming object, except for deformation mechanisms not represented by node motion.

### Rigid fixture versus infinite-mass vehicle

A rigid fixture can be modeled explicitly as:

- A rigid body with very large mass or prescribed zero motion;
- A stationary wall or rigid contact surface;
- Constraint equations or node-to-rigid-body couplings;
- Direct SPC constraints on the attached deformable nodes.

These are numerically different implementations but represent the same physical idealization only when the fixture’s compliance and motion are negligible.

Using infinite mass for the **whole vehicle** is generally not the preferred interpretation. It would suppress vehicle rigid-body translation and rotation everywhere, including degrees of freedom that should remain available for local deformation. It can also distort inertia, load paths, contact behavior, and energy interpretation. Infinite or effectively immovable mass is appropriate for the **fixture**, not for all vehicle nodes.

The key distinction is:

\[
\text{fixed translational/rotational DOFs at the attachment}
\neq
\text{zero motion of every material point in the vehicle}.
\]

A rigidly attached vehicle portion may itself be represented by a rigid body, but the crush zone must remain deformable.

## 2. Energy accounting

For an initially stationary impactor striking a stationary, constrained structure, the initial impactor kinetic energy is approximately

\[
E_{K,0}=\frac12 m v_0^2.
\]

A general energy balance is

\[
E_{K,0}+W_{\text{external}}
=
E_K(t)+E_{\text{internal}}(t)+E_{\text{contact}}(t)+E_{\text{damping}}(t)+E_{\text{other}},
\]

where “internal” may include plastic work, elastic strain energy, damage, fracture, and numerical hourglass energy depending on the solver’s conventions.

For an ideal perfectly stationary support, the support can provide reaction forces but does **no mechanical work** if its attachment points have zero displacement:

\[
W_{\text{fixture}}
=
\int \mathbf{R}_{\text{fixture}}\cdot d\mathbf{x}_{\text{fixture}}
=0.
\]

That does not mean the fixture is irrelevant. It supplies the momentum reaction that prevents global translation and changes the internal force and deformation pattern. It can carry a large force while doing zero work because its point of application does not move.

Thus, in the simplest fixed-body impact:

\[
E_{K,0}
\approx
E_{\text{deformation}}
+
E_{\text{residual impactor kinetic}}
+
E_{\text{elastic rebound}}
+
E_{\text{damping/contact/numerical terms}}.
\]

It is not generally correct to write “impactor kinetic energy = deformation energy + fixture reaction work” unless the fixture itself moves. If the fixture translates, rotates, or elastically deforms, then it can absorb or return energy and its work must be included. If it is an ideal stationary constraint, reaction work is zero even though reaction impulse is nonzero.

LS-DYNA provides energy and boundary-condition databases for evaluating applied-boundary forces and energy, and supports force transducers for measuring impactor/crash-box force.[4][5] In practice, the reliable method is to inspect the solver’s global energy terms and integrate the relevant force–displacement histories, rather than infer energy from momentum alone.

## 3. Impulse or velocity-level contact solvers

For a sequential-impulse solver, the impactor’s velocity change is computed from contact impulses. If the target is immovable, its effective inverse mass at the constrained contact direction is zero:

\[
\Delta v_{\text{target}}=0,
\]

while the impactor receives the full velocity change required by the contact law.

That does **not** mean the contact has zero energy transfer. The contact impulse acts on the impactor and on the constrained structure. The structure’s reaction is transmitted into its deformable internal degrees of freedom and ultimately into plastic or elastic deformation.

### Correct energy measure

For a body fixed against rigid-body motion, deformation energy should be computed from the **force–displacement response of its deformable coordinates**, for example:

\[
E_{\text{def}}
=
\int \mathbf{F}_{\text{impact}} \cdot d\mathbf{x}_{\text{deformation}},
\]

or, in a finite-element model, by summing the solver’s material internal-energy/plastic-work contributions.

It should not be calculated by taking only the kinetic-energy change associated with the target body’s center-of-mass velocity, because that velocity is intentionally zero. Center-of-mass kinetic energy would therefore report no energy even while the body is crushing internally.

For a rigidly fixed target and a single impactor, using the impactor’s kinetic-energy loss is often a useful approximation:

\[
E_{\text{delivered}}
\approx
\frac12 m(v_{\text{in}}^2-v_{\text{out}}^2).
\]

If the impactor comes to rest and there are no significant losses elsewhere, this approaches its full initial kinetic energy. But it is not automatically identical to material deformation energy: rebound, contact damping, friction, numerical dissipation, residual impactor motion, and fixture compliance must be separated.

### Equivalent barrier speed

An equivalent barrier speed is fundamentally an energy-equivalent measure. For an impactor of mass \(m\), if \(E_{\text{absorbed}}\) is the energy attributed to the deforming target, the corresponding speed is commonly represented as

\[
v_{\text{EBS}}
=
\sqrt{\frac{2E_{\text{absorbed}}}{m}}.
\]

For a fixed target, the relevant relative impact speed is the impactor speed relative to the stationary target. Therefore, using the impactor’s full pre-impact kinetic energy relative to the fixed body is generally the correct starting point—not splitting energy according to the two bodies’ velocity changes.

However, “full kinetic energy” should be assigned to deformation only when the impactor has transferred that energy and the accounting excludes:

- residual impactor kinetic energy;
- rebound energy;
- frictional or contact damping losses;
- fixture deformation or motion;
- vehicle components not included in the chosen deformation-energy measure;
- numerical stabilization or hourglass energy.

### Documented practice versus inference

**Documented practice**

- LS-DYNA examples restrain selected crash-box or impacted-surface nodes using SPC-type boundary conditions while assigning initial velocity to the impactor.[1]
- LS-DYNA supports prescribed boundaries, reaction-force/energy databases, and force transducers for measuring impact loading.[4][5]
- BeamNG describes vehicles as node-and-beam soft bodies whose nodes carry mass and whose beams provide deformable structural connections.[2][3]

**Physical/numerical inference**

- A stationary constraint can exert impulse and force without doing work when its point has zero displacement.
- A fixed target’s deformation energy cannot be inferred from its center-of-mass kinetic-energy change.
- For an immovable target, the impactor’s loss of kinetic energy is the appropriate aggregate energy-transfer measure, but material deformation energy is only the portion remaining after rebound, damping, fixture, and numerical contributions are accounted for.
- Fixing only attachment nodes is preferable to assigning infinite mass to the whole vehicle because it preserves local deformability and the intended structural load path.

[1] [PDF] Technical Guide for Explicit Analyses using Ansys LS-DYNA (https://lsdyna.ansys.com/wp-content/uploads/2025/08/LSDYNA_Explicit_Technical_Guide_v1.6.pdf)
[2] Nodes - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/nodes/)
[3] Introduction to JBeam - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/)
[4] lsdyna.ansys.com · wp-content · uploadsTechnical Guide for Explicit Analyses using Ansys LS-DYNA (https://lsdyna.ansys.com/wp-content/uploads/2025/03/LSDYNA_Explicit_Technical_Guide_v1.5.pdf)
[5] beamng-mcp/docs/SOFTBODY_AUTHORING.md at main · eric ... (https://github.com/eric-rolph/beamng-mcp/blob/main/docs/SOFTBODY_AUTHORING.md)
[6] NodeBeam Reference | BeamNG Docs (https://rls.studio/docs/api/common/jbeam/sections/nodeBeam)
[7] JBeam Syntax - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/jbeamsyntax/)
[8] Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/)
[9] [PDF] keyword user's manual volume i - LS-DYNA (https://lsdyna.ansys.com/wp-content/uploads/2025/02/ls-dyna_960_manual_k_vol-1.pdf)
[10] L-Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/l-beam/)
