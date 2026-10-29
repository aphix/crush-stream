> Question: Collision mechanics, concrete numbers please. A rigid steel impactor of mass M (e.g. 858 kg or 1500 kg, non-deforming) moving at 11.1 m/s (40 km/h) strikes a stationary deformable car of mass m = 858 kg, which is free to move (not braked, not fixed). (1) How much kinetic energy is dissipated in total (plastic collision: 1/2 * M*m/(M+m) * v^2), and how is that dissipated energy split between the two bodies when one cannot deform: does ALL the crush energy go into the car (since the rigid impactor stores none), and is that standard (e.g. in accident reconstruction / CRASH3 / momentum-energy methods, equivalent barrier speed of the car = sqrt(2*E_crush/m))? (2) Compare: the same car hit by another identical deformable car of mass 858 kg at the same speed: how is crush energy split between two deformable cars of equal and unequal stiffness (equal force on both, energy ∝ 1/stiffness)? Give the formulas and the resulting EBS for each case. (3) If instead the struck car is fixed/immovable (bolted down, as on a crash test rig) and hit by the same rigid impactor: all the impactor's kinetic energy goes into the car's crush, EBS = ? Show numbers for M = 858 and 1500 kg at 40 km/h.

Let \(v=11.1\ \mathrm{m/s}\) (40 km/h). For a perfectly inelastic collision, momentum is conserved; the kinetic-energy loss is the reduced-mass energy

\[
E_{\text{diss}}=\frac12\frac{Mm}{M+m}v^2.
\]

This is the kinetic energy converted into deformation, heat, sound, and other internal energy; in an idealized crash model it is treated as crush energy.[1][2]

## 1. Rigid impactor striking a free, deformable car

For \(M=m=858\ \mathrm{kg}\):

\[
v_f=\frac{M}{M+m}v=\frac{v}{2}=5.55\ \mathrm{m/s},
\]

\[
E_{\text{diss}}
=\frac12\frac{858\cdot858}{1716}(11.1)^2
=26.49\ \mathrm{kJ}.
\]

The initial kinetic energy of the impactor is

\[
E_{0}=\frac12Mv^2=52.89\ \mathrm{kJ}.
\]

The combined wreck retains

\[
E_f=\frac12(M+m)v_f^2=26.49\ \mathrm{kJ},
\]

so half the initial kinetic energy is dissipated.

### Where does the dissipated energy go?

Under the stated idealization—rigid impactor, deformable car, no significant elastic storage, and perfectly plastic contact—all \(26.49\ \mathrm{kJ}\) of **collision dissipation** is assigned to deformation of the car:

\[
E_{\text{crush, car}}=26.49\ \mathrm{kJ}.
\]

The rigid impactor stores no crush energy. This does **not** mean all of the impactor’s original \(52.89\ \mathrm{kJ}\) disappears: \(26.40\ \mathrm{kJ}\) remains as translational kinetic energy of the two-body wreck.

The car’s equivalent barrier speed (EBS), defined by

\[
E_{\text{crush}}=\frac12m v_{\text{EBS}}^2,
\]

is therefore

\[
v_{\text{EBS}}
=\sqrt{\frac{2E_{\text{crush}}}{m}}
=\sqrt{\frac{2(26\,494)}{858}}
=7.86\ \mathrm{m/s}
=28.3\ \mathrm{km/h}.
\]

Thus, for equal masses, a 40-km/h impact into a rigid free-moving object gives the deformable car an idealized **28.3-km/h EBS**, not 40 km/h.

For general \(M\) and \(m\), with the rigid impactor initially moving and the car stationary,

\[
E_{\text{crush, car}}
=\frac12\frac{Mm}{M+m}v^2,
\]

and

\[
v_{\text{EBS, car}}
=v\sqrt{\frac{M}{M+m}}.
\]

This is the energy-equivalent result used in momentum–energy crash analysis. Actual CRASH3-style reconstruction additionally depends on measured crush, stiffness coefficients, restitution, geometry, and other assumptions; EBS is not automatically identical to the vehicle’s pre-impact speed.

## 2. Two deformable cars, each \(858\ \mathrm{kg}\)

The total collision crush energy remains

\[
E_{\text{total crush}}=26.49\ \mathrm{kJ}.
\]

If the two cars have linear crush stiffnesses \(k_1\) and \(k_2\), they experience approximately the same contact force. Since

\[
E_i=\frac{F^2}{2k_i},
\]

the energy split is inversely proportional to stiffness:

\[
\frac{E_1}{E_2}=\frac{k_2}{k_1}.
\]

Therefore,

\[
E_1=E_{\text{total}}\frac{k_2}{k_1+k_2},
\qquad
E_2=E_{\text{total}}\frac{k_1}{k_1+k_2}.
\]

For equal masses, the EBS of each car is

\[
v_{\text{EBS},i}=\sqrt{\frac{2E_i}{m}}.
\]

### Equal stiffness

If \(k_1=k_2\),

\[
E_1=E_2=\frac{26.49}{2}=13.25\ \mathrm{kJ}.
\]

Each car’s EBS is

\[
v_{\text{EBS}}
=\sqrt{\frac{2(13\,247)}{858}}
=5.55\ \mathrm{m/s}
=20.0\ \mathrm{km/h}.
\]

So the total is 26.49 kJ, split equally:

| Car | Crush energy | EBS |
|---|---:|---:|
| Car 1 | \(13.25\ \mathrm{kJ}\) | \(20.0\ \mathrm{km/h}\) |
| Car 2 | \(13.25\ \mathrm{kJ}\) | \(20.0\ \mathrm{km/h}\) |

### Unequal stiffness

Let car 1 have stiffness \(k_1\), and define

\[
r=\frac{k_1}{k_2}.
\]

Then

\[
E_1=\frac{26.49}{1+r}\ \mathrm{kJ},
\qquad
E_2=\frac{26.49r}{1+r}\ \mathrm{kJ}.
\]

Because the masses are equal,

\[
v_{\text{EBS},1}
=28.3\sqrt{\frac{1}{1+r}}\ \mathrm{km/h},
\]

\[
v_{\text{EBS},2}
=28.3\sqrt{\frac{r}{1+r}}\ \mathrm{km/h}.
\]

For example, if car 1 is twice as stiff as car 2, \(k_1=2k_2\):

\[
E_1=8.83\ \mathrm{kJ},\qquad E_2=17.66\ \mathrm{kJ},
\]

\[
v_{\text{EBS},1}=14.4\ \mathrm{km/h},
\qquad
v_{\text{EBS},2}=23.0\ \mathrm{km/h}.
\]

The softer car absorbs more energy and has the larger EBS. The relation \(E\propto1/k\) applies to an ideal linear spring or an equivalent constant-stiffness model; real vehicle crush force is generally nonlinear.

## 3. Rigid impactor striking a fixed car

If the struck car is truly immovable, its center of mass cannot acquire translational kinetic energy. In the idealization that all impactor kinetic energy becomes crush energy in the car,

\[
E_{\text{crush}}=\frac12Mv^2.
\]

The corresponding EBS of the fixed car is

\[
v_{\text{EBS}}
=\sqrt{\frac{2E_{\text{crush}}}{m}}
=v\sqrt{\frac{M}{m}}.
\]

Here \(m=858\ \mathrm{kg}\).

### \(M=858\ \mathrm{kg}\)

\[
E_{\text{crush}}
=\frac12(858)(11.1)^2
=52.89\ \mathrm{kJ},
\]

\[
v_{\text{EBS}}
=11.1\ \mathrm{m/s}
=40.0\ \mathrm{km/h}.
\]

### \(M=1500\ \mathrm{kg}\)

\[
E_{\text{crush}}
=\frac12(1500)(11.1)^2
=92.46\ \mathrm{kJ},
\]

\[
v_{\text{EBS}}
=\sqrt{\frac{2(92\,452.5)}{858}}
=14.68\ \mathrm{m/s}
=52.9\ \mathrm{km/h}.
\]

| Impactor mass \(M\) | Impact energy | Fixed-car crush energy | Fixed-car EBS |
|---:|---:|---:|---:|
| \(858\ \mathrm{kg}\) | \(52.89\ \mathrm{kJ}\) | \(52.89\ \mathrm{kJ}\) | \(40.0\ \mathrm{km/h}\) |
| \(1500\ \mathrm{kg}\) | \(92.46\ \mathrm{kJ}\) | \(92.46\ \mathrm{kJ}\) | \(52.9\ \mathrm{km/h}\) |

The fixed-target result is fundamentally different from the free-target result: for a free equal-mass target, only \(26.49\ \mathrm{kJ}\) is dissipated, whereas fixing the target removes the post-impact translational-motion channel and makes the full \(52.89\ \mathrm{kJ}\) available for deformation.

[1] Classical Mechanics LECTURE 9: INELASTIC COLLISIONS (https://users.physics.ox.ac.uk/~harnew/lectures/lecture9-mechanics-handout.pdf)
[2] 10. Collisions — Classical Mechanics & Special Relativity ... (https://interactivetextbooks.tudelft.nl/classical-mechanics-and-special-relativity/content/ChX0_Collisions.html)
[3] ChX0_Collisions.md (https://interactivetextbooks.tudelft.nl/classical-mechanics-and-special-relativity/_sources/content/ChX0_Collisions.md)
[4] Inelastic Collisions (http://electron6.phys.utk.edu/PhysicsProblems/Mechanics/3-Impulsive%20forces/Colissions/inelastic.html)
[5] Collisions in 1-dimension - Richard Fitzpatrick (https://farside.ph.utexas.edu/teaching/301/lectures/node76.html)
[6] Microsoft PowerPoint - Class 12 (https://www.pa.uky.edu/~kwng/fall2011/PHY404G/Formula%20slides/Class%2012.pdf)
[7] What are elastic and inelastic collisions? (article) - Khan Academy (https://www.khanacademy.org/science/physics/linear-momentum/elastic-and-inelastic-collisions/a/what-are-elastic-and-inelastic-collisions)
[8] Inelastic collision - Wikipedia (https://en.wikipedia.org/wiki/Inelastic_collision)
[9] [PDF] Inelastic Collisions (https://web.pa.msu.edu/courses/2016summer/PHY251/labfiles/Lab4.pdf)
[10] Design of Vehicle Structures for Crash Energy Management (https://web.iitd.ac.in/~achawla/public_html/736/7-Design_of_Vehicle_Structures_for_crash_energy_management_v6.pdf)
