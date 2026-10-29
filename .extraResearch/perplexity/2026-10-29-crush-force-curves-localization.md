> Question: Real car crash structure as a force-versus-crush curve, with numbers and sources. (1) For frontal, rear and side impacts of typical passenger cars (compact, midsize sedan, SUV, pickup), what are the published crush stiffness coefficients (NHTSA/CRASH3 A and B values, kN/m and kN/m^2 per metre of width) and what do measured force-deflection curves from NCAP rigid-barrier and offset tests look like: initial peak, crumple plateau force (kN), where the curve stiffens sharply (engine/firewall/frame stack-up, depth in cm), and the force needed to push past that? (2) How localized is deformation: in a corner or offset impact, how much does the opposite end of the car (e.g. rear bumper in a front-corner hit) deform or move relative to the body, and when does damage propagate through the whole frame (frame rail buckling, sway, diamond deformation)? (3) For a repeated hit on an already-crushed area, is the structure stiffer or weaker than fresh, and by how much (crush energy of previously deformed rails)? (4) Equivalent barrier speed / energy-based damage (EBS from crush profiles): how is impact energy split between body crush and vehicle motion in car-to-car vs car-to-rigid-barrier vs car-to-moving-deformable-barrier tests? Give engineering-order values where exact data is unpublished, and say which.

A single universal “car crash curve” does not exist: \(A\), \(B\), and the measured force–crush curve vary strongly with model year, body style, impact overlap, pulse, and whether force is measured at a rigid wall or inferred from vehicle acceleration. The most defensible public data are vehicle-specific NCAP tests and CRASH3 coefficient tables—not reliable class-wide values.

## 1. Crush stiffness and force–crush behavior

CRASH3 represents average crush force per unit width approximately as

\[
F'(C)=A+BC
\]

where \(C\) is crush depth and \(F'\) is force per metre of damaged width. For a damaged width \(w\),

\[
F(C)=w(A+BC)
\]

and absorbed energy is approximately

\[
E=w\left(AC+\frac{1}{2}BC^2\right).
\]

The commonly used reconstruction units are \(A\) in force/length and \(B\) in force/length². One published example gives Renault coefficients \(A=45{,}400\ \mathrm{N/m}\) and \(B=296{,}900\ \mathrm{N/m^2}\), but that is a vehicle-specific example, not a typical-car average.[6] CRASH3 also uses separate side-impact categories; one cited category has \(A=236.7\), \(B=13.75\), and \(G=2037.8\) in the model’s legacy units.[9]

### Engineering-order ranges

The following are **order-of-magnitude engineering ranges**, not official NHTSA class averages:

| Impact region | Approximate \(A\) | Approximate \(B\) | Typical interpretation |
|---|---:|---:|---|
| Frontal compact/sedan | \(40\)–\(150\ \mathrm{kN/m}\) | \(200\)–\(800\ \mathrm{kN/m^2}\) | Front rails, bumper beam, crash boxes and powertrain structure |
| Frontal SUV/pickup | \(60\)–\(250\ \mathrm{kN/m}\) | \(300\)–\(1{,}500\ \mathrm{kN/m^2}\) | Larger rails and heavier front structure; often higher total force |
| Rear passenger-car structure | \(20\)–\(100\ \mathrm{kN/m}\) | \(100\)–\(600\ \mathrm{kN/m^2}\) | Usually less energy capacity than the front |
| Side structure, door/sill region | \(50\)–\(250\ \mathrm{kN/m}\) | \(200\)–\(1{,}500\ \mathrm{kN/m^2}\) | Highly dependent on whether the load reaches the sill, B-pillar or seat cross-members |

These ranges should not be inserted into a reconstruction without a sensitivity analysis. Published CRASH3 sources explicitly caution that coefficients are vehicle-specific and that applying rigid-barrier coefficients to car-to-car or oblique impacts can be inappropriate.[6][9]

NCAP rigid-wall data are normally used to construct force–deflection curves from barrier force, vehicle acceleration and measured crush. NHTSA research describes the initial stiffness as the initial slope of the barrier force-versus-crush curve.[1] NHTSA also published comparisons of curves for vehicles such as the Mercedes ML320, Isuzu Rodeo and Ford Taurus, demonstrating substantial vehicle-to-vehicle differences rather than one “SUV” or “sedan” curve.[8]

### Typical curve shape

For a modern frontal rigid-barrier test, a reasonable engineering sketch is:

- **Initial bumper/crash-box engagement:** roughly \(0\)–\(50\ \mathrm{kN}\), over the first \(2\)–\(8\ \mathrm{cm}\).
- **Main crumple zone:** approximately \(50\)–\(200\ \mathrm{kN}\) for a compact or midsize car and \(100\)–\(300+\ \mathrm{kN}\) for a larger SUV or pickup.
- **Effective crush depth:** commonly about \(30\)–\(70\ \mathrm{cm}\) in severe full-frontal tests, with considerably less crush in offset tests on the undamaged side.
- **Sharp stiffening:** often begins after roughly \(35\)–\(60\ \mathrm{cm}\), when rails, dash cross-members, toe boards, firewall, engine, transmission, suspension towers or cabin rings become load-bearing.
- **Post-crumple force:** can rise into the \(200\)–\(500+\ \mathrm{kN}\) range for the entire vehicle structure, but the value depends on the force-measurement definition and is not a universal passenger-car number.

The curve is not generally a flat plateau. It contains peaks from bumper-beam engagement, rail folding, wheel/suspension contact and powertrain or firewall loading, followed by drops when a component buckles. NCAP studies use precisely these measured curves to compare initial stiffness, total stiffness and occupant-compartment crush.[1][8]

For rear impacts, the first deformation is usually concentrated in the bumper beam, crash boxes and rear rails. A steep rise commonly occurs when the rails reach the rear seat cross-member, wheelhouses, fuel-tank region or passenger-cell floor. For side impacts, there may be little crush force at first because the door and trim collapse, followed by a much steeper response when the B-pillar, rocker/sill, seat cross-members and roof rails engage.

Euro NCAP’s mobile progressive deformable-barrier specification illustrates why barrier stiffness matters: its prescribed face includes different crush/deflection properties, including stress levels on the order of \(0.6\)–\(1.1\ \mathrm{MPa}\) across specified deformation ranges.[3] Those values describe the barrier face, not a vehicle’s CRASH3 \(A\) and \(B\).

## 2. How localized is deformation?

In a **full-width frontal impact**, deformation is initially distributed across the bumper beam and both front rails. The opposite front corner can remain comparatively intact in a small-overlap or corner impact, but load transfer through the front module, subframe, floor and dash structure can still move the cabin.

In a **small-overlap or corner impact**:

- Local bumper/fender/rail damage may extend roughly \(0.5\)–\(1.5\ \mathrm{m}\) from the struck corner.
- The opposite bumper corner often has little visible crushing, commonly only millimetres to a few centimetres of rigid-body displacement relative to the cabin in a localized event.
- The vehicle can nevertheless yaw substantially, so the opposite end may sweep laterally by tens of centimetres even when it is not crushed.
- If the struck rail folds, the load path can rotate the front clip, shear suspension attachments, distort the floor and produce “sway” or diamond deformation.
- Whole-frame propagation becomes likely when the crush reaches the front-floor junction, dash/firewall, rocker, tunnel, major cross-member or cabin ring.

A **rear bumper in a front-corner impact** is therefore not expected to crush directly merely because the front corner is damaged. It can move laterally or rotate with the body, but direct rear-end deformation generally requires large global bending, a secondary collision, rollover/contact with another object, or severe intrusion through the entire vehicle.

Offset tests produce strongly asymmetric force and crush profiles. NHTSA compatibility work specifically analyzes force-transfer height and structural interaction because the load path differs from a full-width rigid wall.[2] A rigid-wall curve should therefore not be treated as a direct prediction of opposite-end deformation in an offset car-to-car crash.

## 3. Repeated impact into an already-crushed area

A previously crushed rail is usually **not equivalent to fresh structure**.

Two competing effects occur:

- **Work hardening and folded material:** some portions may become locally stronger and harder to buckle.
- **Loss of geometric crush length and damaged load paths:** the structure has already consumed its stable folding stroke, developed buckles, torn spot welds, yielded joints and lost alignment.

For a second hit in the same direction and location, the remaining structure often has a much shorter crush stroke and a higher initial reaction force, followed by much lower energy absorption. A practical engineering estimate is:

- Remaining energy capacity of a moderately pre-crushed rail: roughly \(20\)–\(60\%\) of its fresh capacity.
- Severe pre-crush or tearing: roughly \(0\)–\(30\%\).
- Peak force can be similar to or higher than fresh structure over a short displacement, even while total absorbed energy is much lower.

These are engineering estimates; a general NHTSA/CRASH3 coefficient for “second-hit stiffness” is not established. The appropriate method is component testing or finite-element analysis with the actual pre-crush state. Applying the original \(A\) and \(B\) to a second impact will generally overestimate available crush energy and may misrepresent the peak force.

## 4. EBS, equivalent barrier speed and energy partition

For a measured crush profile, absorbed energy is obtained from the force–crush area:

\[
E_{\mathrm{crush}}=\int_0^C F(x)\,dx.
\]

The equivalent barrier speed is then

\[
\mathrm{EBS}=\sqrt{\frac{2E_{\mathrm{crush}}}{m}}.
\]

EBS is the speed at which the vehicle would need to strike an ideal rigid barrier to absorb the same vehicle-damage energy. It is not necessarily the closing speed, closing-speed component, or pre-impact speed of either vehicle. Published validation work found that EBS calculated from force–deflection curves averaged about \(4\%\) above reported EBS in a dataset of 158 tests, with a \(4\%\) spread statistic reported in the source.[10]

### Approximate energy partition

| Test type | Where kinetic energy goes | Engineering-order interpretation |
|---|---|---|
| Car into rigid barrier | Vehicle crush, barrier reaction, tire/suspension motion, rotation and residual rebound | Nearly all translational kinetic energy not retained as post-impact vehicle motion is dissipated in vehicle and barrier deformation; for a straight, full-frontal test, vehicle crush commonly dominates |
| Car-to-car | Crush in both vehicles, plus residual translation, rotation, rebound and sometimes tire/braking losses | Energy is divided according to both masses, stiffnesses and crush capacities; the lighter or softer vehicle may absorb disproportionately more energy |
| Moving deformable barrier | Crush in the tested vehicle, crush in the barrier, barrier translation and residual vehicle/barrier motion | The barrier itself absorbs a controlled portion, so vehicle EBS is not equal to total system kinetic-energy loss |

For a one-dimensional car-to-car collision, the energy available for deformation is governed by the **reduced mass**

\[
\mu=\frac{m_1m_2}{m_1+m_2}
\]

and the relative closing speed \(v_{\mathrm{rel}}\):

\[
E_{\mathrm{available}}\approx \frac{1}{2}\mu v_{\mathrm{rel}}^2.
\]

For unequal masses, a useful idealized result is that the lighter vehicle experiences the larger velocity change, while the deformation energy is distributed according to the force–crush characteristics of both vehicles. Real crashes depart from this simple model through braking, angle, rotation, underride/override, vehicle compatibility and different structural engagement heights.

Rigid-barrier tests are useful for deriving vehicle-specific stiffness and EBS, but they are not direct substitutes for car-to-car tests. The published CRASH3 guidance explicitly identifies rigid-barrier extrapolation to angled and car-to-car impacts as an important source of error.[6] NCAP force–deflection curves remain the best public basis for frontal vehicle-specific estimates, while side and rear coefficients are less consistently available and should be treated with larger uncertainty.[1][8][9]

**Bottom line:** use published \(A\), \(B\), and measured curves only for the exact vehicle and impact region where possible. For class-level estimates, a plausible frontal total-force range is roughly \(50\)–\(300\ \mathrm{kN}\) through the main crush zone, with sharp stiffening after approximately \(0.35\)–\(0.60\ \mathrm{m}\) of crush; those figures are engineering-order values, not NHTSA-certified averages.

[1] Vehicle Related Factors that Influence Injury Outcome in ... (https://pmc.ncbi.nlm.nih.gov/articles/PMC3256768/)
[2] [PDF] NHTSA's Compatibility Research Program Update (https://www.nhtsa.gov/sites/nhtsa.gov/files/sae2001nhtsacompatibility.pdf)
[3] Technical Bulletin (https://cdn.euroncap.com/media/41764/tb-022-euro-ncap-mobile-progressive-deformable-barrier-face-specification-v12.201811091227034358.pdf)
[4] Design for Crashworthiness (http://cdl.hanyang.ac.kr/wp-content/uploads/2024/Platform/design%20for%20crashworthiness.pdf)
[5] crash robustness design for an AC-MPDB based on a bi-directional ... (https://academic.oup.com/tse/article/7/4/tdaf047/8240249)
[6] Accident Reconstruction | PDF | Traffic Collision | Mechanics - Scribd (https://www.scribd.com/document/115602022/Accident-Reconstruction)
[7] [PDF] VEHICLE FRONTAL CRUSH STIFFNESS COEFFICIENTS TRENDS (https://www.jsheld.com/uploads/Vehicle-Frontal-Crush-Stiffness-Coefficients-Trends.pdf)
[8] Effects of Geometry and Stiffness on the Frontal ... (https://www-nrd.nhtsa.dot.gov/pdf/ESV/esv17/Proceed/00078.pdf)
[9] [PDF] CRASH III model improvements - ROSA P (https://rosap.ntl.bts.gov/view/dot/29985/dot_29985_DS1.pdf)
[10] Evaluation of Vehicle Body Stiffness and Strength for Car to Car Compatibility (https://www.academia.edu/124080086/Evaluation_of_Vehicle_Body_Stiffness_and_Strength_for_Car_to_Car_Compatibility)
