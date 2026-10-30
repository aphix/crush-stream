> Question: How do car games handle the hood (bonnet) and trunk lid in crashes? (1) BeamNG.drive: how is the hood latched and hinged in its jbeam (hood latch beams with breakGroups, the safety catch, hinge beams, a hood that pops open after a frontal crash and flaps at speed), at what crash severity does the latch break, does a popped hood open fully or only a few cm, how does it move after release (swinging, flapping in the wind, slamming shut), and is the trunk handled the same way? (2) Arcade and arcade-sim multiplayer racing or demolition games: Wreckfest, Burnout Paradise/Takedown, FlatOut 2/Ultimate Carnage, Forza Horizon, GRID, Need for Speed: when does a hood pop open, how far, does it flutter or come off, and how quickly (one frame, or animated over time)? (3) Real cars: after a frontal crash, how often does the hood stay latched, pop onto the secondary safety catch (a few cm), buckle upward in the middle, or fly fully open, and at what crash speeds? Cite sources (BeamNG docs or forum, game wikis, crash-test footage descriptions).

The short answer is that **BeamNG.drive models hood/trunk attachment as deformable beams and break groups**, while most arcade racers use a simple damage-state animation. Real cars are designed so a correctly latched hood normally stays shut in a crash; a fully flying hood usually indicates failure of both the primary latch and the secondary safety catch.

## 1. BeamNG.drive

BeamNG’s official modding documentation describes a panel as being attached by a **stronger hinge group** at one end and a **weaker latch group** at the other. The latch is intended to break first, allowing the panel to rotate around the hinges.[7]

A simplified hood structure is therefore:

- Hood-panel nodes and deformable beams.
- Left and right hinge beams, usually in separate or related break groups.
- One or more front latch beams in a weaker `breakGroup`.
- Optional support beams that hold alignment but are not intended to carry major crash loads.
- A secondary-catch-like restraint, if the vehicle’s JBeam author has modeled one.

A `breakGroup` means that when one beam in the group breaks, the other beams in that group are broken simultaneously.[7] The exact threshold is not a universal BeamNG value: it depends on the individual vehicle’s `beamStrength`, `beamDeform`, node arrangement, impact direction, and crash pulse. Consequently, there is no general answer such as “the latch breaks at 20 km/h.” A low-speed impact can break a latch if the force is concentrated at the latch, while a faster but differently aligned impact may leave it attached.

Once the primary latch group breaks, the hood normally remains connected by its hinges and can rotate upward. The documentation explicitly describes the hinge as the part that permits rotation after the latch fails.[7] In practical vehicle configurations, a hood may:

- Lift only slightly if a secondary restraint, deformation, or contact with the front structure limits it.
- Open farther if the latch and secondary restraint release.
- Oscillate or flap because the hood is still physically simulated and is exposed to aerodynamic forces.
- Slam back down when vehicle motion, deformation, or contact changes the hood’s angular momentum.
- Tear away if hinge groups or their supporting beams also fail.

The familiar “hood pops, then flaps at speed” behavior is therefore not necessarily a scripted animation. It can emerge from the hood’s rigid/deformable-body connections, hinge geometry, aerodynamic forces, and collisions with the body or windshield.

The trunk is structurally handled in the same general way: hinge-side beams, latch-side beams, support beams, and break groups. BeamNG forum guidance specifically refers to hoods and trunks together and points modders to examples such as `moonhawk_hood` and `moonhawk_trunk`.[2] The difference is mostly geometric and aerodynamic: a rear trunk lid is less likely to be driven open by oncoming airflow, so it often moves less dramatically than a front hood.

## 2. Arcade and arcade-sim racing games

There is no single behavior shared by Wreckfest, Burnout, FlatOut, Forza Horizon, GRID, and Need for Speed. In general, these games use **damage states or animation clips**, not a fully physical latch-and-hinge model.

| Game series | Typical hood/trunk behavior |
|---|---|
| **Wreckfest** | Damage is relatively physical and deformation-oriented, but hood movement is still governed by game-specific vehicle damage logic rather than a publicly documented latch-break threshold. A hood may bend, open, detach, or remain attached depending on the vehicle and impact. No general crash speed reliably triggers it. |
| **Burnout Paradise / Burnout 3: Takedown** | Cars are heavily stylized. Crash effects usually use predefined destruction states, camera effects, and parts separation. A hood opening is not a detailed secondary-latch simulation, and the transition is generally presented as an immediate crash-state change rather than a measured hinge motion. |
| **FlatOut 2 / Ultimate Carnage** | More visible body-part damage is used, including panels that can deform or detach. Hoods may appear to lift or come off after sufficiently severe impacts, but the threshold is game- and event-dependent, not a real-world speed threshold. |
| **Forza Horizon** | Vehicle damage is comparatively limited and presentation-focused. Hoods and trunks generally do not behave as independently simulated hinged panels that progressively flutter in the wind. Visible changes, where present, are usually damage-state transitions. |
| **GRID** | Damage presentation varies by title. Panels can visibly deform or detach, but there is no publicly established universal hood-latch model or speed at which a hood must pop. |
| **Need for Speed** | Most entries prioritize visual damage effects and scripted crash presentation. A hood may visibly move or disappear as part of a damage state, but it usually does not reproduce a primary latch, secondary catch, hinge torque, and aerodynamic flutter sequence. |

For these games, “how quickly” is usually best described as **render-frame or short animation timing**, not a physical release time. A part may appear to pop in one frame, then move through a short animation over several frames. Without title-specific telemetry, source code, or a controlled frame-by-frame test, assigning a precise duration would be speculation.

Likewise, “at what speed” is generally the wrong variable. Games commonly use combinations of:

- Collision impulse.
- Damage accumulated by the vehicle.
- Impact angle and location.
- A threshold for a particular damage state.
- Race mode or scripted event logic.

Thus, two impacts at the same speed can produce different hood results.

## 3. Real cars

Modern front-opening hoods generally use a **primary latch plus a secondary safety catch**. The secondary catch is intended to retain the hood if the primary latch is released or fails; U.S. safety requirements specifically address a second latch position or second hood-latch system when an opened hood could obstruct the driver’s forward view.[1][3]

The normal outcomes are:

- **Correctly latched:** The hood remains latched, although it may buckle, crease, or shift because the hood skin and surrounding structure deform.
- **Primary latch releases, secondary catch holds:** The hood rises only a small amount—often a few centimeters at the front—and remains restrained. This is the intended safety behavior.
- **Hood deformation:** A frontal impact can push the hood upward or buckle it near the center, especially when the front rails, radiator support, fenders, or hood hinges move relative to one another. This does not necessarily mean the latch released.
- **Both restraints fail:** The hood can open fully and be forced backward by airflow, potentially obstructing the windshield. Safety investigations describe this as a serious visibility hazard.[4][5]

There is no meaningful universal speed at which each outcome occurs. Crash severity depends on closing speed, vehicle mass, overlap, impact location, structural stiffness, hood design, latch geometry, pre-existing damage, and whether the impact directly loads the latch or hinges. A low-speed, concentrated impact at the latch area can be more relevant to latch release than a higher-speed offset impact that loads the front structure differently.

Crash-test programs also do not normally publish a general rule such as “the hood opens above 30 mph.” Their tests use defined crash configurations and evaluate injury and structural performance; the hood result is vehicle-specific. Therefore:

- A hood staying latched is common when the latch and front structure remain intact.
- A small pop to the secondary catch is a plausible restrained-failure outcome.
- Center buckling is often structural deformation rather than latch release.
- A fully open or flying hood is an abnormal failure mode involving loss of effective primary and secondary restraint, not the expected result of a particular speed.

The strongest general conclusion is that **BeamNG can produce emergent hinge-and-aerodynamic motion because its hood and trunk attachments are beam-based**, whereas most arcade racers use discrete visual damage states. Real vehicles use redundant latching specifically to prevent the dramatic fully-open hood behavior that games often exaggerate.

[1] 3272yy | NHTSA (https://www.nhtsa.gov/interpretations/3272yy)
[2] connecting two objects together? jbeam (https://www.beamng.com/threads/connecting-two-objects-together-jbeam.7170/)
[3] Interpretation ID: nht92-9.53 - NHTSA (https://www.nhtsa.gov/interpretations/nht92-953)
[4] aiam4936 | NHTSA (https://www.nhtsa.gov/es/node/115176)
[5] Statement of (https://www.autosafety.org/wp-content/uploads/import/CAS%20Insurance%20Dept%20Statement%208-9-12.pdf)
[6] General Discussion (https://www.beamng.com/forums/general-discussion.22/)
[7] Basic Car Tutorial - Autobello Kit Car (https://documentation.beamng.com/modding/vehicle/tutorials/basic_car_tutorial/)
[8] 2012-2014 Toyota Camry Hood Latch: A Guide to Replacement Variants (https://www.go-parts.com/garage/pl-2012-2014-toyota-camry-hood-latch)
[9] 2005-2009 Hyundai Tucson & 2005-2010 Kia Sportage Hood Latch ... (https://www.go-parts.com/garage/hood-latch-hyundai-tucson-kia-sportage-2005-2010)
[10] www.go-parts.com · garage · hood-latch-assembly-jeep2017-2026 Jeep Compass Hood Latch: Diagnosing and Replacing a ... (https://www.go-parts.com/garage/hood-latch-assembly-jeep-compass-2017-2026)

---

> Follow-up question: BeamNG.drive follow-up: in the stock vehicles' jbeam files (e.g. moonhawk_hood, etk800 or pickup hood), what are the actual hood latch beam values (beamStrength, beamDeform, breakGroup names like hood_latch), the hinge beams' strength, and is there a modelled secondary catch or a 'hood_latch2' limit beam that lets the hood rise only a few centimetres? When the latch breaks, how far does the hood rise at standstill, and does BeamNG apply aerodynamic drag to body panels (so a released hood flies open at speed) or does it flap only from vehicle motion? Cite jbeam snippets, BeamNG documentation or forum threads.

The stock files do **not** appear to use a universal, documented set of hood-latch numbers. Values vary by vehicle and game version, and the available documentation describes the intended structure rather than listing `moonhawk_hood`, `etk800`, or pickup values verbatim.

## What the JBeam structure means

BeamNG’s hood tutorial recommends two separate attachment groups:

- A **stronger hinge group**, normally with two attachment points so the hood can rotate after the latch fails.
- A **significantly weaker latch group**, which breaks first in a crash.[1]

The tutorial’s illustrative values are:

```json
{"beamDeform":15000,"beamStrength":15000},
{"breakGroup":"frontHood"},
["hood1ll","fr1l"],
["hood1ll","fr1"],
["hood1ll","fr2l"],
["hood1rr","fr1r"],
["hood1rr","fr1"],
["hood1rr","fr2r"],
{"breakGroup":""}
```

Those are **tutorial/example values**, not the confirmed values for the Moonhawk, ETK 800, or Pickup.[1]

`beamStrength` is the force threshold at which a beam breaks; once broken, it no longer connects its two nodes. `beamDeform` is the threshold for permanent deformation and does not itself create a hinge limit.[2] The relevant `breakGroup` name—such as `hood_latch`, `frontHood`, or a vehicle-specific name—groups beams that break together.

## Secondary catch and `hood_latch2`

A second latch or catch can be implemented in JBeam, but the available documentation does **not** establish that the stock Moonhawk, ETK 800, or Pickup hoods contain a universal modelled secondary catch named `hood_latch2`.

A beam called something like `hood_latch2` would normally be an ordinary structural/limit beam unless it is explicitly configured with suitable nodes, strength, and length limits. It would not automatically mean “allow only a few centimetres of opening.” BeamNG’s beam system defines spring/damper connections, deformation, breaking, and expansion/contraction limits; a physical opening stop must be created deliberately in the relevant JBeam.[3][4]

Likewise, section names such as `hoodCatchCoupler` and `hoodLatchCoupler` exist in the JBeam ecosystem, but their presence as names does not by itself prove that a particular stock hood has a functioning secondary catch.[3]

## How far the hood rises when the latch breaks

There is no fixed engine-wide distance. At standstill, the hood’s post-latch position depends on:

- hinge-node geometry;
- the hood’s centre of mass;
- hinge beam stiffness and damping;
- gravity;
- collision with the body or latch hardware;
- any explicit catch/limit beams;
- the hood’s initial deformation.

Therefore, a released stock hood may rise only slightly, settle at a partially open angle, or continue rotating until constrained. A precise “few centimetres” figure cannot be inferred from the generic JBeam documentation and requires inspecting and testing the exact vehicle/version.

## Does aerodynamic drag open the hood?

BeamNG supports aerodynamic forces on JBeam triangles and quads using properties including `liftCoef`, `dragCoef`, `stallAngle`, and `skinDragCoef`.[5] Consequently, a hood can receive aerodynamic forces if its relevant collision/aero triangles expose suitable aerodynamic parameters.

That does **not** mean every detached or unlatched body panel automatically receives a special “hood opening” force. The result depends on the hood’s aero geometry and coefficients. A hood that opens at speed can therefore be driven by aerodynamic lift/drag, while low-speed movement or apparent flapping can result from ordinary vehicle motion, hinge flexibility, deformation, and airflow-relative motion.

The practical distinction is:

- **At standstill:** no meaningful aerodynamic opening force; the hood’s movement comes from gravity, hinge spring/damper behavior, deformation, and collisions.
- **At speed:** aero forces can act on the hood’s triangles, so a released hood may be forced open and then flap or tear away.
- **If the hood has no effective aero triangles/coefficients:** it will not automatically behave like a powered aerodynamic flap merely because the latch broke.

The forum explanation confirms that aerodynamic effects are applied to individual JBeam triangles/quads and that drag depends on airflow angle and parameters such as `dragCoef` and `skinDragCoef`.[5]

[1] Jbeam Tips and Tricks - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/jbeamtips/)
[2] Basic Car Tutorial - Autobello Kit Car (https://documentation.beamng.com/modding/vehicle/tutorials/basic_car_tutorial/)
[3] JBeam file sections - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/)
[4] Introduction to JBeam - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/intro_jbeam/)
[5] BeamNG JBeam Modding Tutorial | PDF | Rotation (https://www.scribd.com/document/608966502/BeamNG-Modding-Tutorial-Basic-Jbeam-project)
[6] Beams - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/beams/)
[7] Custom Bodyworks | BeamNG (https://www.beamng.com/resources/custom-bodyworks.26359/)
[8] Changelog/0.26.x | BeamNG.drive Wikia - Fandom (https://beamng.fandom.com/wiki/Changelog/0.26.x)
[9] Aerodynamics in BeamNG (https://www.beamng.com/threads/aerodynamics-in-beamng.89942/)
[10] How to reduce aerodynamic drag of a vehicle. (https://www.beamng.com/threads/how-to-reduce-aerodynamic-drag-of-a-vehicle.97317/)

---

> Follow-up question: Real cars follow-up: FMVSS 113 (hood latch system) requirements for the second latch position, and how far a hood typically rises when held on its secondary safety catch (cm at the front edge). In IIHS or Euro NCAP frontal and small-overlap crash tests at 56-64 km/h, what does the hood usually do: stay latched but buckle into a peak or V near its middle, pop onto the safety catch, or open fully? How quickly does a hood buckle in the crash pulse (milliseconds)? Cite test reports or engineering sources.

FMVSS 113 does **not specify a required hood-opening height** or a particular crash response. It requires every hood to have a latch system, and requires a **second latch position or separate secondary latch** only for a front-opening hood that could obstruct the driver’s windshield view if it opened.[5]

## Secondary-latch requirement

The relevant provision is 49 CFR §571.113, S4.2:

> A front-opening hood that, in any open position, partially or completely obstructs the driver’s forward view through the windshield must have a second latch position or a second hood-latch system.[5]

The rule is therefore a **retention requirement**, not a prescribed clearance or travel requirement. It does not say that the secondary catch must hold the front edge a specified number of centimeters above the fenders. NHTSA interpretations also distinguish front-opening hoods from essentially vertical or rear-opening arrangements; the secondary latch is aimed at preventing a hood from flying up and blocking the windshield.[2][3]

## How far does a hood rise on the secondary catch?

There is no generally applicable “typical” value in FMVSS 113, and IIHS/Euro NCAP public crash reports generally do not measure or report secondary-catch height in centimeters. The gap depends on:

- Latch and striker geometry
- Hood curvature and hinge location
- The height of the secondary hook
- Hood-panel stiffness and local deformation
- Whether the hood is still supported by both hinges

For a conventional front-hinged hood, the secondary catch usually leaves the leading edge **only slightly raised—often on the order of a few centimeters**, rather than open to a service position. That figure should be treated as an engineering rule of thumb, not a regulatory or test-standard value; a defensible vehicle-specific number requires measuring the production latch.

## What usually happens in 56–64 km/h frontal tests?

In IIHS moderate-overlap, IIHS small-overlap, and Euro NCAP frontal tests, the usual outcome is:

**The hood remains latched, while the panel deforms—often buckling upward into a ridge, peak, or shallow V near the middle or near the rear of the hood.**

A hood that visibly rises in test footage is not necessarily on its secondary safety catch. The panel can buckle while the primary latch remains engaged, because the hood is a thin shell loaded by:

- Contact with the engine, radiator support, or other under-hood structures
- Longitudinal compression from front-end crush
- Bending between the latch, hinges, and deforming front structure

A secondary catch may engage if the primary latch or its surrounding sheet metal is displaced, but that is not the normal interpretation of a hood peak. **Full opening is comparatively abnormal** in a properly functioning vehicle and would generally indicate latch, striker, latch-support, or surrounding-structure failure—not the expected crash-test mode. FMVSS 113 itself is intended to prevent an unlatched hood from opening into the driver’s view.[5]

IIHS’s publicly available protocols describe the crash setups and occupant-compartment measurements, but do not establish a universal hood-rise or hood-buckling criterion.[6][7] Likewise, Euro NCAP ratings focus on occupant, pedestrian, and safety-assistance performance; they do not publish a universal “hood must remain flat” or secondary-catch-height requirement.

## How quickly does the buckling occur?

A useful engineering estimate is **roughly 20–80 ms after initial impact**, with the first visible hood bending often occurring within approximately **30–50 ms** in a 56–64 km/h crash. The exact timing varies substantially with:

- Vehicle deceleration pulse
- Hood mass and stiffness
- Latch/hinge spacing
- Under-hood contact
- Camera frame rate and definition of “buckling”

The impact speed alone cannot determine the time. At 60 km/h, the vehicle travels about 16.7 m/s, but the hood’s deformation is governed by the crash pulse and local structural contact, not by the time needed for the vehicle to traverse a fixed distance. Public IIHS and Euro NCAP reports generally do not provide a standardized timestamp for first hood buckling, so a precise value requires high-speed test video or instrumented engineering data from the specific vehicle.

**Bottom line:** expect a latched hood to deform into a central ridge or V within the first few tens of milliseconds; do not assume that visible rise means secondary-catch engagement. A small residual gap on the safety catch is vehicle-specific, commonly only a few centimeters, and neither that dimension nor a standard buckling time is prescribed by FMVSS 113.

[1] FMVSS 113 (https://www.ntea.com/fmvss-113)
[2] Interpretation ID: nht92-9.53 - NHTSA (https://www.nhtsa.gov/interpretations/nht92-953)
[3] 3272yy | NHTSA (https://www.nhtsa.gov/interpretations/3272yy)
[4] aiam4936 | NHTSA (https://www.nhtsa.gov/interpretations/aiam4936)
[5] 49 CFR 571.113 -- Standard No. 113; Hood latch system. (http://ecfr.gov/current/title-49/subtitle-B/chapter-V/part-571/subpart-B/section-571.113)
[6] Passenger vehicle test protocols and technical information - IIHS (https://www.iihs.org/ratings/about-our-tests/test-protocols-and-technical-information)
[7] Crash Test Protocol (https://www.iihs.org/media/7e290493-004f-4461-9975-4cbbee786c8b/jnWVVw/Ratings/Protocols/archive/test_protocol_high_0717.pdf)
[8] 02-5897.xml (https://www.federalregister.gov/documents/full_text/xml/2002/03/19/02-5897.xml)
[9] Interpretation ID: nht87-2.11 - NHTSA (https://www.nhtsa.gov/interpretations/nht87-211)
[10] Federal Register, Volume 65 Issue 204 (Friday, October 20, 2000) (https://www.govinfo.gov/content/pkg/FR-2000-10-20/html/00-27038.htm)

---

> Follow-up question: Wreckfest (Bugbear) follow-up: how does its soft-body damage model handle hoods, trunk lids and doors: are they separate hinged parts with latches, do they swing open and flap while driving, can they be torn off, and how quickly do they open in a crash (instantly or animated by physics)? How does FlatOut 2 handle the same? Cite developer blogs, interviews or wikis.

The available documentation supports a **component-based, damage-state interpretation**, not a fully simulated vehicle-body mechanism with individually working hinges and latches.

## Wreckfest

Bugbear describes Wreckfest as using soft-body damage modeling and physics-driven deformation, with crash damage depending on factors such as impact force, angle, vehicle weight, and frame structure.[2][6][8] However, the available developer-facing material does **not** establish that every hood, trunk lid, or door is simulated as a physically constrained hinged part with a functional latch.

What can be stated with reasonable confidence:

- **Separate visual/body components:** Wreckfest models vehicles as numerous individual parts, and damage can affect panels and other components independently.[7]
- **Hoods, trunks, and doors can visibly deform or become displaced:** The game’s damage system produces bent, hanging, or otherwise damaged bodywork rather than merely applying a single whole-car damage texture.[2][6][7]
- **Opening is generally a crash result, not a normal latch action:** There is no reliable source in the supplied material documenting working hood/trunk/door latches or ordinary hinge actuation.
- **Panels may hang or flap after damage:** Reports describe components such as bumpers hanging at collision-dependent angles, but the supplied sources do not specifically verify continuous, physically simulated swinging of every door, hood, or trunk lid.[4]
- **Detachment is possible for some components:** Wreckfest visibly sheds or destroys body parts and debris, but the available sources do not provide a panel-by-panel rule proving that every hood, lid, or door can tear off.[1][7]
- **Opening appears effectively immediate at the damage event:** The damage deformation is calculated from the collision and applied during the crash response; it is not documented as a slow, latch-release animation.[4] A panel may then move or settle under the resulting physics, but the evidence does not support a dedicated hinge-opening animation with a fixed opening time.

A useful distinction is that “soft-body damage” does not necessarily mean every visible part is a continuously simulated soft object. One technical description characterizes Wreckfest’s system as component-based and real-time, while another account argues that some visible outcomes use damage states or pre-made component behavior rather than unrestricted soft-body simulation.[4][7] Thus, the safest conclusion is: **panels are independently damageable visual/physical components, but publicly available evidence does not demonstrate fully functional latches and hinges for all of them.**

## FlatOut 2

FlatOut 2 retains the series’ pre-modeled, real-time damage approach. The FlatOut wiki describes cars as having many separately modeled damaged parts— including doors, hoods, trunks, bumpers, and exhaust components—with parts deforming according to the force and angle of impacts.[1]

That implies:

- **Doors, hoods, and trunks are separate modeled damage parts.**
- **They can deform and appear displaced after crashes.**
- **The system uses authored damage behavior/states rather than a fully articulated latch-and-hinge simulation.**
- **There is no supplied evidence for functional latches, normal hinge opening, or continuously flapping panels governed by detailed hinge physics.**
- **Panels may break away or disappear as part of the damage/debris system, but the cited documentation does not specify which particular lid or door is guaranteed to detach.**
- **Visible damage is applied as part of the collision response, so opening/displacement is effectively immediate rather than a mechanically timed opening sequence.**

## Bottom line

| Feature | Wreckfest | FlatOut 2 |
|---|---|---|
| Separate hood/trunk/door components | Yes, consistent with the component-based damage model[7] | Yes, explicitly listed among modeled damage parts[1] |
| Functional latches documented | No evidence found | No evidence found |
| Hinges continuously simulated | Not established; damaged parts can hang or move after impact[4] | Not established |
| Panels visibly open/displace in crashes | Yes, as crash damage behavior[2][6][7] | Yes, through modeled damage states[1] |
| Flap continuously while driving | Possible for damaged/hanging geometry, but not specifically documented for each panel | Not documented as a general physics feature |
| Can parts tear off | Some body components/debris can be lost; panel-specific guarantees are unclear[7] | Parts can break away in the damage system, but panel-specific behavior is undocumented[1] |
| Opening timing | Collision response is effectively immediate; subsequent movement may be physical[4] | Immediate damage-state transition rather than a detailed hinge animation[1] |

The key difference is **degree of simulation**: Wreckfest’s later component and deformation system gives damaged panels more physically consequential behavior, while FlatOut 2 more clearly relies on separately authored damage parts and deformation states. Neither set of cited sources confirms a fully realistic system of latches releasing, hinges rotating through a defined arc, and every lid or door independently flapping until torn off.

[1] Vehicle Damage - Flatoutgame Wiki - Fandom (https://flatout.fandom.com/wiki/Vehicle_Damage)
[2] | Jesus Behind The Wheel (https://jesusbehindthewheel.com/2020/03/17/wreckfest-the-racing-game-we-need-right-now)
[3] Bugbear Entertainment: Studio, Games & Wreckfest Developer (https://nextcargame.com/bugbear/)
[4] Does Wreckfest even have soft-body physics? (https://www.reddit.com/r/Wreckfest/comments/1jdbwcd/does_wreckfest_even_have_softbody_physics/)
[5] Wreckfest - Arcade Racing Game (https://wreckfest.fandom.com/wiki/Wreckfest)
[6] Wreckfest Is The Perfect Game To Bring Your Secret Demolition ... (https://www.carthrottle.com/news/wreckfest-perfect-game-bring-your-secret-demolition-fantasies-life)
[7] Wreckfest 2: a robust overhaul that showcases ... (https://www.digitalfoundry.net/articles/digitalfoundry-2025-wreckfest-2-a-superb-overhaul-of-a-boundary-pushing-game)
[8] Wreckfest on Steam (https://store.steampowered.com/app/228380/Wreckfest)
[9] Wreckfest 2 - Official Game Site (https://wreckfest2.thqnordic.com/)
[10] FlatOut 2 - Wikipedia (https://en.wikipedia.org/wiki/FlatOut_2)

---

> Follow-up question: Wreckfest technical deep dive: how does Bugbear's ROMU engine model vehicle damage? Find developer interviews, Digital Foundry or other technical analyses, GDC or conference talks, Bugbear blog posts (e.g. the Wreckfest development blog on bugbeargames.com) and patch notes describing: the deformation method (per-vertex mesh deformation driven by a physics skeleton, soft-body nodes and beams, or precomputed damage states), how many physics bodies or nodes a car has, how body panels such as the hood, trunk lid, doors and bumpers are attached (joints, hinges, break strengths), and how panel detachment works. Quote specifics.

Bugbear has never publicly documented ROMU at the level of a full solver specification—especially the exact node count, beam graph, joint parameters, or per-panel break-strength tables. The available evidence does, however, establish that Wreckfest uses a **real-time soft-body/component simulation**, not precomputed damage states.

## What ROMU appears to simulate

Bugbear’s ROMU system dates back to at least 2000; Bugbear explained that “ROMU” is Finnish for “scrap, junk, or wreck.” Its core vehicle-damage model is described as a soft-body simulation, with additional outer “plates” used to represent bodywork and make panels deform and detach more convincingly.[8]

The SIGGRAPH account specifically distinguishes two roles:

- **Soft-body simulation:** handles the vehicle’s main structural deformation, including chassis bending and buckling.[8]
- **Outer plates:** represent exposed bodywork; these can deform, but are designed to detach more readily than the underlying structure.[8]

That description rules out a system based solely on swapping intact, lightly damaged, and destroyed meshes. Digital Foundry likewise describes Wreckfest’s damage as “fully simulated,” with cars crumpling and disintegrating during collisions rather than selecting pre-authored damage states.[1]

A useful conceptual model is therefore:

\[
\text{vehicle damage} =
\text{deformable structural simulation}
+
\text{deformable detachable panels}
+
\text{component damage}
\]

The sources do **not** establish that Wreckfest’s implementation is literally a BeamNG-style lattice of named nodes and beams. “Soft body” is confirmed; the exact internal discretization—vertices, particles, beams, finite elements, or a hybrid—is not publicly specified in the material found.

## Per-vertex mesh deformation versus physics geometry

The evidence supports deformation driven by simulated physical components, with render geometry following that simulation. It does not support the simpler interpretation that ROMU merely performs independent per-vertex displacement against collision normals.

The SIGGRAPH description says that the engine “meld[s] cars into the shape of whatever they crash into,” while also describing soft-body simulation for the vehicle and plates for the outer regions.[8] Digital Foundry’s later technical coverage describes panels twisting and shearing according to impact angle and force, with damage occurring dynamically rather than being pre-calculated.[3]

Wreckfest 2 coverage is especially explicit about the component-level approach: vehicles are made from individual parts, including body panels and drivetrain components, and those parts have their own physical properties. Materials such as glass, plastic, and steel are assigned different strength and rigidity characteristics.[3] That is strong evidence for a **component-based dynamic model**, although Wreckfest 2 uses a rebuilt version of ROMU and should not automatically be treated as a complete description of the original Wreckfest implementation.

## Physics bodies, nodes, and beams

No reliable public source in the available material gives:

- the number of physics bodies per car;
- the number of soft-body nodes;
- the number of beams or constraints;
- whether each visible panel has a separate rigid body;
- the solver iteration count or timestep;
- the exact mapping between render vertices and simulation points.

Claims that a Wreckfest car has a particular fixed number of nodes or beams should therefore be treated as undocumented unless accompanied by a direct Bugbear engineering source or a controlled reverse-engineering analysis.

The available technical descriptions instead use higher-level terms: “soft-body simulation,” “plates,” “components,” and material-specific properties.[3][8]

## Hood, trunk lid, doors, and bumpers

The public descriptions confirm that external body parts can deform, rattle, and detach. The SIGGRAPH article gives the rear bumper as an example: it can rattle and spring when partially damaged.[8] Contemporary gameplay coverage also describes doors and bonnets deforming and flapping before coming off.[7]

What remains undocumented is the precise attachment mechanism. No cited Bugbear source specifies whether a hood, trunk lid, door, or bumper is attached using:

- a revolute hinge constraint;
- a six-degree-of-freedom joint;
- a collection of soft-body links;
- breakable weld constraints;
- a separate rigid body connected to the chassis;
- or a hybrid of these.

The safest interpretation is that panels are simulated as deformable outer components constrained to the vehicle until impact loads exceed their attachment or integrity thresholds. The sources support **progressive deformation followed by detachment**, but not a particular joint class or numerical break force.

## How detachment works

The clearest public description is that outer objects “more easily detach themselves,” while still being subject to deformation first.[8] This matches the visible behavior in Wreckfest:

1. A panel deforms under collision forces.
2. Its mounting or attachment region loses integrity.
3. The panel becomes loose, producing secondary motion such as rattling or flapping.
4. It eventually separates and becomes debris.

Digital Foundry describes crashes leaving fenders and sheet metal scattered around the track, confirming that detached bodywork is represented as physical debris rather than merely hidden or replaced visually.[1] The later ROMU description also emphasizes that individual components can crumble and change under external forces, with damage affecting the vehicle’s handling.[3]

Patch-note evidence is consistent with this model. Recent Wreckfest 2 notes refer to body panels bending, damaged parts coming loose, and damaged bumpers detaching completely more quickly; they also mention directional car-to-car damage and improved control over crumpled bodywork.[2] These notes concern Wreckfest 2, not necessarily the original game, but they reveal the type of state the engine exposes: panel deformation, loosening, complete detachment, and directional damage.

## What can be stated with confidence

| Question | Best-supported answer |
|---|---|
| Precomputed damage states? | No. Damage is described as dynamically simulated in real time.[1][3] |
| Soft-body deformation? | Yes. ROMU uses soft-body simulation for major vehicle deformation.[8] |
| Separate outer bodywork layer? | Yes. SIGGRAPH describes additional outer “plates” that deform and detach more readily.[8] |
| Per-vertex deformation? | The visible mesh must deform somehow, but no source confirms a purely per-vertex solver. |
| Individual physical components? | Clearly supported, especially in the newer ROMU implementation.[3] |
| Exact node/body/beam count? | Not publicly established by the available sources. |
| Hood/door/trunk attachment type? | Not publicly specified. |
| Break strengths? | Not publicly specified numerically. |
| Panel detachment? | Progressive deformation and loosening followed by physical separation; outer panels are designed to detach more readily.[1][2][8] |

In short, ROMU is best characterized as a **hybrid soft-body and detachable-component system**: structural soft-body physics bends the car, outer plates model deformable sheet metal, and component-level integrity determines when parts loosen or separate. The available public material does not justify more specific claims about exact node counts, beam topology, hinge types, or break-strength values.

[1] Wreckfest's Switch port impresses - even against PS5 and Xbox Series X (https://www.digitalfoundry.net/articles/digitalfoundry-2022-wreckfest-switch-port-impresses-even-against-ps5-and-xbox-series-x)
[2] Wreckfest 2 Content Update #9 Patch #1 Available (https://www.operationsports.com/wreckfest-2-content-update-9-patch-1-available/)
[3] Wreckfest 2: a robust overhaul that showcases ... (https://www.digitalfoundry.net/articles/digitalfoundry-2025-wreckfest-2-a-superb-overhaul-of-a-boundary-pushing-game)
[4] Wreckfest (Xbox Series X|S) (https://www.digitalfoundry.net/games/xbox-series-x/wreckfest)
[5] Wreckfest: The Demolition Derby Game’s Development History (https://nextcargame.com/)
[6] BUILD FEEDBACK + KNOWN ISSUES :: Wreckfest General Discussions (https://steamcommunity.com/app/228380/discussions/0/535150948604481251/?ctp=39)
[7] Wreckfest 2 Early Access gives a brief look at another smashingly ... (https://www.thesixthaxis.com/2025/03/19/wreckfest-2-early-access-preview/)
[8] Perfecting Destruction: Racing Game Focuses on the Crash (https://www.siggraph.org/news/perfecting-destruction-racing-game-focuses-on-the-crash/)
[9] Wreckfest [PC Games-Digital] (https://www.wog.ch/en/index.cfm/details/product/61765-Wreckfest)
[10] Wreckfest [Nintendo Switch] • World of Games (https://www.wog.ch/en/index.cfm/details/product/151105-Wreckfest)

---

> Follow-up question: Wreckfest modding and car files: in Wreckfest's modding tools (BagEdit, the vehicle .vhcl/.vdst/.tcd/.bmd files, 'body parts' and 'breakable parts' definitions), how are hoods, trunk lids and doors defined: is there a hinge axis, an open-angle limit, a latch or attachment strength, a detach threshold, a 'loose part' or flapping behaviour? Cite modding wikis, Steam workshop guides or community documentation, and quote the parameter names.

Wreckfest’s documented modding workflow does **not expose a general-purpose hinge simulation for hood, trunk-lid, or door meshes**. The available documentation describes these as vehicle/assembly parts with geometry, hierarchy, and damage definitions—not as articulated parts with editable hinge limits or latch mechanics.

## What the files appear to control

- **`.vhcl`**: vehicle geometry/scene data. It can contain or reference the body and visible vehicle components, but the available documentation does not identify parameters for a movable hinge, rotation limit, or door-opening animation.
- **`.vdst`**: vehicle damage/structure-related data. It is relevant to how vehicle sections and damage are represented, but no documented hood/door-specific hinge or latch parameters were found.
- **`.tcd`**: collision/damage-related vehicle data. The available sources do not document a hood, trunk, or door “open angle” field in it.
- **`.bmd`**: model/body-related data used by the vehicle asset pipeline; again, no documented articulated-panel schema was found.
- **BagEdit**: edits vehicle parts, physics, models, emitters, variables, and related definitions; it is described as a file browser/editor rather than a visual mechanical-rigging tool.[1][2]

The modding guide describes vehicles as assemblies of parts and emphasizes that parts must be **parented correctly**. It gives examples such as engine-manifold parts parented to engine parts, but does not describe a special hinge-part type for body panels.[1]

## Parameter names requested

No reliable community or official documentation located in the available results identifies parameter names corresponding to:

- hinge axis
- hinge pivot
- maximum/open angle
- latch state
- latch or attachment strength
- panel detach threshold
- loose-part mode
- flapping or free-swing behavior

In particular, there is no documented parameter such as `hinge_axis`, `open_angle`, `latch_strength`, `detach_threshold`, or `loose_part` that can be confidently attributed to Wreckfest’s `.vhcl`, `.vdst`, `.tcd`, or `.bmd` formats.

## What “body parts” and “breakable parts” likely provide

The documented distinction is primarily structural:

- **Body/assembly parts** define vehicle components, hierarchy, placement, geometry, and upgrade/part relationships.
- **Breakable parts** define components that can be damaged or separated according to the game’s damage system.

That can make a hood, door, or trunk lid disappear, deform, or detach as a damaged component, but the available documentation does not establish that breakable-part definitions support physically constrained rotation around a hinge. The “parenting” system is the documented mechanism for positioning parts in an assembly, not a documented hinge or latch system.[1]

## Practical conclusion

For a conventional hood/door/trunk implementation:

- A **static panel** can be modeled and assigned as a vehicle part.
- A **damage-detachable panel** may be possible if configured as a breakable/damage component using the relevant vehicle definitions.
- A panel that opens, swings, reaches an angle limit, remains attached by a weakening latch, and finally flaps or detaches is **not documented as a supported data-driven feature** in the available Wreckfest modding references.
- Such behavior would likely require an existing hard-coded game mechanic, animation/vehicle asset behavior not publicly documented, or custom executable-level support rather than ordinary BagEdit parameter editing.

The strongest directly relevant documentation found is the modding guide’s description of BagEdit and vehicle-part parenting, while the Steam material confirms that BagEdit is used for parts and vehicle editing but does not publish a hinge/breakable-panel parameter reference.[1][2]

[1] Wreckfest - Getting Started With Modding | PDF - Scribd (https://es.scribd.com/document/529869309/Wreckfest-Getting-Started-With-Modding)
[2] Wreckfest - Steam Community (https://steamcommunity.com/app/228380/guides/)
[3] Wreckfest (https://www.pcgamingwiki.com/wiki/Wreckfest)
[4] Releases · gmazy/wreckfest_toolbox (https://github.com/gmazy/wreckfest_toolbox/releases)
[5] wreckfest_toolbox/README.md at main · gmazy/wreckfest_toolbox (https://github.com/gmazy/wreckfest_toolbox/blob/main/README.md)
[6] How to mod Wreckfest Thread (https://www.moddb.com/forum/thread/how-to-mod-wreckfest)
[7] Steam Community::Wreckfest (https://steamcommunity.com/app/228380/guides/?browsesort=trend&filetype=11&requiredtags[]=Modding+or+Configuration)
[8] Wreckfest mods - Steam Workshop (https://steamcommunity.com/sharedfiles/filedetails/?id=2861180361)
[9] Bag Editor? :: Wreckfest Discusiones generales (https://steamcommunity.com/app/228380/discussions/0/1699415798772647127/?l=latam)
[10] github.com · gmazy · wreckfest_toolboxWreckfest Toolbox Mz - GitHub (https://github.com/gmazy/wreckfest_toolbox)

---

> Follow-up question: Wreckfest in play: what do players and reviewers observe about hoods, trunk lids and doors in crashes: do they pop open, how far, do they flap or swing while driving, do they slam shut, can they fall off, and is it instant or physically animated? And what changed in Wreckfest 2 (Early Access 2025): Bugbear's statements about the new damage model, panels, hinges, detachment and flapping parts. Cite reviews, patch notes, forum or Reddit threads, and Bugbear posts.

The clearest distinction is between **Wreckfest 1’s relatively restrained, mostly visual body damage** and **Wreckfest 2’s more aggressive, physically simulated panel behavior**. In both games, panels can deform and detach, but player reports suggest that Wreckfest 2 makes hood movement much more prominent—sometimes after a very minor impact.

## Wreckfest 1: what players observe

- **Hoods can pop up during crashes.** Players commonly describe the bonnet lifting or flipping upward after front-end impacts, especially in cockpit view. The effect is generally a damage-state transition rather than a fully articulated hood behaving like a real hinged part.
- **The hood usually obstructs vision rather than flapping continuously.** Reports describe it rising into the windshield view and remaining there while the car continues moving. It is not generally described as repeatedly opening and closing or freely swinging through a large range.
- **Doors and trunk lids are less prominent.** Player and review discussions emphasize crumpled bodywork, detached bumpers, wheels, roofs and other major damage more than doors or boot lids repeatedly opening and closing. There is little evidence in the available discussions of doors or trunk lids routinely being animated through realistic hinge arcs.
- **Parts can detach, but detachment is largely damage-triggered.** Wreckfest’s visual identity is built around body panels bending, collapsing and coming loose; players describe spectacular crashes and “twisted wreckage,” but the evidence here does not support a general rule that every hood, door or trunk lid is independently simulated as a freely moving object.[6][8]
- **The behavior is not normally “slam shut” physics.** The available player commentary does not describe Wreckfest 1’s hood, doors or trunk as repeatedly slamming shut under acceleration, braking or aerodynamic forces. Once a panel reaches a damaged state, it tends to stay visibly deformed or displaced.

A useful player comparison is that Wreckfest 1 is remembered as having cockpit visibility that remains “decently fine” for much of a race, whereas Wreckfest 2 is criticized for making the hood obstruct the view after a single bump.[2] That suggests Wreckfest 1’s hood effect is usually less intrusive, not necessarily that it is absent.

## Wreckfest 2 Early Access: what changed

Wreckfest 2 players report a much more conspicuous hood response:

- **A light front contact can make the hood fly or flip open.** One cockpit-view thread says that even a light bump can make the hood open and force the player to change camera views.[2]
- **The hood can stay up while driving.** Reports describe the bonnet remaining in the raised position and severely restricting visibility rather than simply popping up and immediately falling away.[2]
- **The result is experienced as physically animated, but not always convincingly restrained.** Players describe the panel “crumpling and flipping up,” implying movement through an animation or simulated hinge-like response rather than an instantaneous texture swap. However, the reports also criticize the frequency and persistence of the effect, especially in Realistic damage mode.[2]
- **The desired behavior is often detachment after prolonged damage.** Players have suggested that a hood should either remain closed, come off after enough damage, or perhaps lift and then detach after a short period, rather than stay in the driver’s sightline for an entire race.[2][9]
- **Doors and other panels are expected to become more independent.** A Wreckfest 2 crash-physics discussion specifically asks for body parts such as the hood to bend independently from the main body and for doors to be torn off in a more convincing way.[10] That indicates that independent panel deformation and detachment are a major expectation for the new damage system, even where players still debate how fully the Early Access build delivers it.
- **Detachment is not limited to cosmetic deformation.** Community discussion mentions front wings, bonnets and other parts coming off, while also questioning whether that should happen in every damage mode.[10] The concern is therefore not whether parts can detach, but whether the thresholds and behavior are appropriate.

## “Instant” state change or real physical motion?

The available evidence supports a middle position:

- **Impact damage is triggered immediately** when collision thresholds are crossed.
- **The visible panel response is animated or physically driven**, with panels bending, lifting, twisting and sometimes coming loose over a short interval.
- **It is not equivalent to a complete rigid-body simulation of every hinge.** The observed hood behavior is often a persistent damage pose: it opens, remains obstructive and may later detach, rather than naturally swinging, rebounding and settling like a real hood on functioning hinges.
- **Repeated slam-shut behavior is not a commonly reported feature.** Neither the Wreckfest 1 discussions nor the cited Wreckfest 2 reports describe doors, bonnets or trunk lids repeatedly closing themselves while the car drives.

## What Bugbear’s new model appears intended to do

The Early Access discussion points toward a more granular system in which:

- body panels deform more independently;
- hinges and attachment points matter more;
- panels can remain attached while bent or displaced;
- sufficiently damaged parts can detach;
- loose or detached parts can visibly flap, obstruct vision or separate from the car.

That is the conceptual change players are noticing: **Wreckfest 2 treats bodywork more like articulated, breakable geometry instead of only applying a finished crumpled visual state**. The criticism is that the hood’s current threshold may be too sensitive and its raised position too persistent, particularly in cockpit view.[2][10]

The available search results did not surface a direct Bugbear developer post or official Early Access patch-note entry specifically detailing hood hinges, trunk lids, doors and flapping panels. The strongest evidence for the exact in-game behavior therefore comes from player reports and crash-physics discussions, while the broader “independent panels and detachment” interpretation should be treated as a description of the Early Access direction rather than a verbatim Bugbear specification.

[1] Wreckfest 2 Content Update #9 Patch #1 Available (https://www.operationsports.com/wreckfest-2-content-update-9-patch-1-available/)
[2] Love cockpit view but OMG (https://www.reddit.com/r/Wreckfest/comments/1jsbrjy/love_cockpit_view_but_omg/)
[3] It’s called Wreckfest (https://www.reddit.com/r/Wreckfest/comments/1l2jf1b/its_called_wreckfest/)
[4] Wreckfest 2 is doing it right. (https://www.reddit.com/r/Wreckfest/comments/1p36e7p/wreckfest_2_is_doing_it_right/)
[5] Flipping on and on (https://www.reddit.com/r/Wreckfest/comments/1kljyta/flipping_on_and_on/)
[6] Opinions on wreckfest? (https://www.reddit.com/r/simracing/comments/8rb2yd/opinions_on_wreckfest/)
[7] The biggest problem I have with Wreckfest (https://www.reddit.com/r/Wreckfest/comments/1nn5xk4/the_biggest_problem_i_have_with_wreckfest/)
[8] Wreckfest...👀 (https://www.reddit.com/r/simracing/comments/qr76dh/wreckfest/)
[9] Wreckfest 2 :D (https://www.reddit.com/r/Wreckfest/comments/1k8puwk/wreckfest_2_d/)
[10] Crash physics in Wreckfest 2 (https://www.reddit.com/r/Wreckfest/comments/1ejguji/crash_physics_in_wreckfest_2/)

---

> Follow-up question: Wreckfest and Wreckfest 2 performance: how does Bugbear keep soft-body damage fast with 24 cars on track? Give the physics tick rate (Hz), the rate damage/deformation is computed and applied to meshes, how deformation reaches the GPU (CPU vertex updates, skinning, compute), LOD for distant cars' damage, multithreading of the physics (jobs per car), and the known performance killers (many cars piling up, debris counts, high damage settings) and settings or tricks that boost performance (debris limits, physics quality options, console 30/60 fps targets). Cite Digital Foundry, Bugbear interviews, patch notes and benchmarks.

The publicly available material does **not** document several of the low-level numbers requested—especially the physics tick rate, deformation-update frequency, GPU upload path, damage LOD policy, or “jobs per car.” Claims that Wreckfest runs a specific fixed tick rate or updates dents at a particular Hz should therefore be treated as unverified.

## What is established

- Bugbear’s ROMU engine simulates all 24 cars, collisions, debris, and environmental interactions in real time rather than relying on pre-scripted crash animations.[5]
- Wreckfest 2 rebuilds the physics engine and adds more detailed component damage and deformation.[1][2]
- The game’s system requirements target **1080p/30 FPS at low settings** for the minimum configuration, while published recommended specifications target **1080p/60 FPS**.[1][7]
- Independent PC testing found that Wreckfest 2 can be substantially CPU- and GPU-demanding, with the test reporting efficient use of up to eight loading/streaming threads—not proof that physics itself is divided into eight threads.[3]

## What cannot be responsibly confirmed

| Requested detail | Publicly verified answer |
|---|---|
| Physics tick rate | No reliable public figure found |
| Damage/deformation computation rate | No reliable public figure found |
| Mesh update rate | No reliable public figure found |
| GPU path | No authoritative confirmation of CPU vertex updates, GPU skinning, or compute deformation |
| Distant-car damage LOD | No documented policy found |
| Physics jobs per car | No documented number found |
| Exact debris-cost thresholds | No authoritative benchmark table found |

The available sources describe higher-fidelity deformation and component damage, but they do not expose the engine architecture needed to distinguish CPU-generated vertex buffers from skinning or compute-shader deformation.[1][3][10]

## Why 24-car destruction can remain practical

At a high level, the likely performance strategy is to separate **simulation complexity** from **visual complexity**: only collision-relevant and mechanically important state needs full physical treatment, while visible damage can be represented through lower-cost deformation and rendering data. However, Bugbear has not publicly specified the exact scheduling, update cadence, or per-car job breakdown, so that should not be presented as a confirmed implementation detail.

## Known performance pressure

- Large pileups create many simultaneous contacts and constraint interactions; the 24-car real-time simulation is explicitly part of the engine’s workload.[5]
- Debris and environmental objects add collision, visibility, particle, and draw-call costs.[5]
- Higher damage/deformation fidelity increases both simulation and rendering work; Wreckfest 2’s later updates specifically increased visual-deformation precision and tire-simulation detail.[10]
- Wreckfest 2’s real-time ray-traced shadows/reflections and expanded effects can add GPU load, independently of physics.[3]

## Practical performance advice

- Reduce **debris and particle limits** first when available; this lowers object, effects, and rendering overhead during pileups.
- Reduce **damage/deformation or physics-quality options** if the build exposes them; these are more likely to affect CPU simulation than ordinary texture settings.
- Lower reflections, ray tracing, shadows, and car-detail distance for GPU or draw-call bottlenecks.
- Use the console’s intended frame-rate mode: Wreckfest 2’s published targets distinguish a 30-FPS low-spec mode from a 60-FPS recommended mode.[1][7]
- Expect the worst frame times during dense multi-car impacts rather than normal racing. Online races may feel lighter on some CPUs if fewer AI vehicles require local simulation, though that behavior is anecdotal rather than a documented engine rule.[9]

Digital Foundry confirms the console version’s emphasis on Bugbear’s physical crash simulation, but the cited public material does not provide the requested internal timing or deformation-pipeline measurements.[8]

[1] Save 25% on Wreckfest 2 on Steam (https://store.steampowered.com/app/1203190/Wreckfest_2)
[2] Buy Wreckfest 2 (https://www.xbox.com/en-US/games/store/wreckfest-2/9nlhmthpjkh7)
[3] Wreckfest 2 - PC performance graphics benchmarks of Graphics Cards and Processors (https://en.gamegpu.com/racing-simulators-/-%D0%B3%D0%BE%D0%BD%D0%BA%D0%B8/wreckfest-2-test-gpu-cpu)
[4] Wreckfest 2 | GAMES.GG (https://games.gg/wreckfest-2/)
[5] Tech Expert Rips Open Wreckfest 2, and It's So Impressive, We're Praying GTA 6 Takes Notes (https://www.autoevolution.com/news/tech-expert-rips-open-wreckfest-2-and-it-s-so-impressive-we-re-praying-gta-6-takes-notes-250888.html)
[6] Wreckfest 2 - Wikipedia (https://en.wikipedia.org/wiki/Wreckfest_2)
[7] Wreckfest 2 - Game Database - gamepressure.com (https://www.gamepressure.com/games/wreckfest-2/z96a99)
[8] Wreckfest (PS5) (https://www.digitalfoundry.net/games/ps5/wreckfest)
[9] Wreckfest 2 General Discussions (https://steamcommunity.com/app/1203190/discussions/0/603025951007262890/?ctp=2)
[10] Wreckfest 2 Update 4 Patch Notes - EGW-News (https://egw.news/gaming/news/30397/wreckfest-2-update-4-patch-notes-expand-destructio-XDIHZOFaj)

---

> Follow-up question: Soft-body car crash games in general (BeamNG.drive, Wreckfest, CarX, Teardown vehicles, browser or WebGL soft-body car games): the measured performance numbers and techniques: BeamNG's physics at 2000 Hz and node/beam counts per car, how many cars run in real time per CPU core, how they cut cost for sleeping or distant vehicles (sleep, lower node counts, frozen deformation), what limits multiplayer (BeamMP) sync rates, and which choices are the biggest perf wins or killers. Cite BeamNG docs or blogs, BeamMP docs, and developer talks.

BeamNG is unusually expensive because it integrates deformable-vehicle physics at a supported **2,000 physics steps/s**—each step represents 0.5 ms of simulation time.[6] Its cars are mass-point-and-constraint systems rather than rigid bodies: nodes carry mass and state, beams connect them with spring/damper and breakage behavior, and collision triangles transfer forces into that network.[5][7]

## What is measured or documented

| Topic | Best-supported figure or conclusion |
|---|---|
| BeamNG physics rate | **2,000 Hz by default**; 0.5 ms per physics step. Other rates can be forced, but 2,000 Hz is the supported standard.[6][8] |
| Vehicle representation | A vehicle consists of mass-bearing nodes, beams between nodes, and collision geometry; beam count is therefore a major cost driver, alongside nodes, collisions, tires, drivetrain and constraints.[5][7] |
| Exact node/beam count per stock car | No authoritative general BeamNG figure was found in the available sources. Counts vary substantially by vehicle and configuration, so “typical car = N nodes/M beams” should not be stated without inspecting the vehicle JBeam files. |
| Cars per CPU core | No reliable BeamNG benchmark establishes a universal cars-per-core number. It depends on vehicle complexity, collisions, tires, AI, map collision, deformation, rendering and physics headroom. A single simple rigid-body car and a fully deformable BeamNG car are not comparable units. |
| BeamMP server physics | BeamMP’s server relays state; clients perform the vehicle physics rather than the server simulating every car.[3] |
| BeamMP update rate | The available official settings result says BeamMP smooths vehicle-position updates at regular intervals, but does not provide a definitive universal synchronization rate.[1] Third-party claims of 15/30/60 Hz should not be treated as official BeamMP limits without corroborating documentation. |
| Web/browser games | No measured cross-game benchmark was available for Wreckfest, CarX, Teardown vehicles or WebGL soft-body titles, so direct cars-per-core comparisons would be speculative. |

## Why 2,000 Hz matters

A high solver rate improves stability for stiff springs, suspension, tires and rapidly changing contacts. The trade-off is direct: every active vehicle’s physics workload is multiplied by roughly 2,000 integration steps per second. BeamNG documentation also notes that a physics step’s execution time varies and that other engine threads can become the frame bottleneck.[6]

The rate is not equivalent to “2,000 complete frames of all game systems.” Rendering, graphics, AI, networking and other tasks have their own schedules. But deformable vehicle state must still be advanced frequently enough to preserve stability and handling.

## Biggest performance wins

1. **Reduce active vehicle count.**  
   This is usually the largest scalable win because each active deformable vehicle adds nodes, beams, contacts, tires, drivetrain work and collision queries.

2. **Use simpler vehicle structures.**  
   Fewer nodes and beams reduce solver work. Removing unnecessary constraints, collision elements and highly detailed underbody nodes can matter as much as reducing visible mesh polygons.

3. **Reduce node–triangle contacts.**  
   BeamNG’s documentation specifically warns that many nodes colliding with triangles at spawn can create a noticeable performance impact.[7] It recommends spacing collidable components where possible and keeping roughly 3–3.5 cm between nodes to avoid excessive collision overlap.[7]

4. **Reduce bottom-side collision density.**  
   Vehicles driving over rocks and other map assets benefit from fewer bottom nodes; BeamNG notes that heightmap collision is cheaper than static collision, making node placement particularly relevant in those situations.[7]

5. **Keep distant or inactive vehicles out of full simulation.**  
   In a conventional soft-body game, the strongest optimization is to sleep, deactivate or replace distant cars with cheaper representations. However, the available BeamNG sources do **not** document a universal “distant cars use X nodes” or “deformation freezes beyond Y meters” policy. Those mechanisms may exist in particular gameplay systems or implementations, but exact general figures should not be asserted from the evidence available here.

## Biggest performance killers

- Large numbers of simultaneously active, fully deformable cars.
- Dense node placement and many node–triangle contacts.
- High-detail collision geometry and numerous collidable vehicle components.
- Cars actively colliding, because contact generation and force propagation wake additional parts and produce many changing constraints.
- AI, traffic, tires, drivetrain simulation and rendering competing with the physics threads.
- Attempting to lower the physics rate as a general optimization: BeamNG’s supported default is 2,000 Hz, and community/developer discussion indicates that substantially lower rates can hurt handling and material stiffness; this is not a free performance switch.[6][10]

## Multiplayer implications

BeamMP avoids the most expensive server architecture by not running one authoritative soft-body simulation for every player vehicle. Instead, clients calculate local physics while the server distributes vehicle-state information.[3] That makes multiplayer primarily a **network replication and client-simulation problem**, not a server CPU problem equivalent to hosting every BeamNG car’s solver.

The practical limits are therefore:

- **Bandwidth:** more vehicles and more frequent state updates increase traffic.
- **Latency and packet loss:** collisions and deformation are difficult to reconstruct perfectly after delayed or missing state.
- **Client CPU/GPU capacity:** every client still has to render and simulate the vehicles it receives.
- **State granularity:** position and rotation are cheap to transmit; complete node, beam, tire and damage state is much more expensive.
- **Correction frequency:** lower update rates save bandwidth but increase interpolation error, rubber-banding and collision disagreement.

The available official BeamMP result confirms the smoothing behavior but does not establish a single hard synchronization ceiling.[1] Consequently, claims such as “BeamMP is limited to exactly 30 Hz” require version-specific documentation and should not be generalized.

## Comparison with other categories

- **Wreckfest:** generally achieves its performance profile through a more specialized and constrained vehicle-damage model than BeamNG’s general node/beam vehicle construction. No primary developer benchmark was available here to quantify its solver rate or cars-per-core.
- **CarX:** the term covers several products and physics implementations; without a specific title and developer benchmark, no meaningful soft-body comparison can be made.
- **Teardown vehicles:** vehicle deformation and destruction are not automatically equivalent to BeamNG-style continuously simulated vehicle soft bodies. The relevant costs may instead be rigid-body physics, voxel destruction, collision and rendering.
- **Browser/WebGL games:** typically win through lower solver rates, fewer bodies, simplified constraints, sleep systems and aggressive level-of-detail switching. WebAssembly/WebGL performance varies too widely for a universal cars-per-core figure.

**Bottom line:** the dominant cost is not the visual damage mesh; it is the number of active dynamic state variables and contacts advanced at a very high rate. For BeamNG-like games, the largest wins usually come from fewer active vehicles, fewer nodes/beams and fewer collision contacts. The largest killers are dense deformable models, simultaneous impacts and trying to retain full-fidelity simulation for vehicles that players cannot meaningfully observe.

[1] Multiplayer Settings - BeamMP Docs (https://docs.beammp.com/game/multiplayer-settings/)
[2] docs.beammp.com › beamng › devVehicles - BeamMP Docs (https://docs.beammp.com/beamng/dev/content/vehicles/)
[3] BeamMP Dedicated Server Setup (2026): Windows & Linux (https://www.redswitches.com/blog/beammp-dedicated-server-setup-guide/)
[4] lag-compensation-settings (https://help.freakhosting.com/games/beammp/lag-compensation-settings)
[5] Soft-body Physics (https://beamng.com/game/about/physics/)
[6] Tight Coupling - BeamNG Documentation (https://documentation.beamng.com/beamng_tech/tools/cosimulationeditor/tight_coupling/)
[7] Nodes - BeamNG Documentation (https://documentation.beamng.com/modding/vehicle/sections/nodes/)
[8] Changelog — BeamNGpy documentation (https://documentation.beamng.com/api/beamngpy/master/changelog.html)
[9] github.com · a15343 · BeamSync-ColliderGitHub - a15343/BeamSync-Collider: Ultimate BeamNG Drive... (https://github.com/a15343/BeamSync-Collider)
[10] why is it taking so long to develop this game? (https://www.beamng.com/threads/why-is-it-taking-so-long-to-develop-this-game.10690/page-3)

---

> Follow-up question: FlatOut 2 (Bugbear, 2006) and FlatOut: Ultimate Carnage (2007) damage model in depth: how were cars built (a deformable mesh driven by a physics model, detachable body parts such as hoods, doors, bumpers and trunk lids as separate physics objects with hinges), when do hoods and doors pop open, swing, flap while driving and fall off, how many breakable parts per car and how much debris per race (FlatOut's selling point of thousands of physics objects), and the ragdoll driver ejection system. How did it run on PS2/Xbox-era hardware: physics rate, object counts, limits on debris and ragdolls, LOD? Cite Bugbear interviews, reviews, Digital Foundry retrospectives and modding documentation.

The short version: **FlatOut 2 and Ultimate Carnage did not use a fully deformable, soft-body vehicle simulation.** They combined a rigid-body car physics model with a visual damage/deformation system, detachable or breakable vehicle components, and a separate ragdoll character simulation. The result looked far more physically continuous than it actually was.

## What the cars were made of

Each car had a principal rigid chassis/body used for driving physics. Around it was a collection of damage regions and modeled components—hood/bonnet, doors, bumpers, trunk lid, fenders, lights, mirrors, exhaust pieces and other trim.

The often-repeated specification for *FlatOut 2* is **up to approximately 40 destructible parts per car**.[9] That figure should not be read as “40 independently simulated rigid bodies permanently attached by hinges.” It is better understood as a per-vehicle inventory of damageable, hideable, deformable and detachable components.

The visible body damage was primarily a **mesh-deformation/damage-state system driven by collision information**, rather than a general-purpose finite-element or soft-body simulation. Collision impacts could dent panels, change their position or switch them to damaged, detached or missing states. The car’s main collision and suspension behavior remained governed by a conventional vehicle rigid-body model.

Reviews accurately describe the effect as real-time car deformation and dynamic damage.[6] The important technical distinction is that a dented quarter panel did not become a newly solved soft body with independent mass and structural stress. Damage was produced through bounded deformation and object-state changes designed to be convincing and affordable on sixth-generation hardware.

## Hoods, doors and other panels

The game’s panels occupied several different implementation categories:

- **Deformable visual panels:** the hood, doors and bodywork could acquire dents or bent silhouettes while remaining part of the car’s visual assembly.
- **Breakable components:** bumpers, lamps, mirrors, exhaust parts and other pieces could be damaged or disappear.
- **Loose or detached pieces:** sufficiently damaged parts could separate and become debris in the world.
- **Animated articulated pieces:** hoods and doors could visibly open, swing or flap after impacts.

There is no reliable public evidence in the available sources that every hood and door was implemented as a continuously simulated hinge body with physically accurate hinge constraints. In practice, their behavior appears to have been hybrid: collision damage altered their pose or attachment state, while animation/constraint logic made them swing believably. Once the game decided that a part had become detached, it could be released as a separate debris object.

A hood or door generally opened when a collision exceeded the relevant damage threshold or struck the panel at a suitable angle. It could then:

- remain partly attached and oscillate or flap as the car moved;
- swing farther after another impact;
- interfere visually with the car;
- detach after additional damage or a sufficiently strong collision;
- become a free debris object and eventually settle, be struck, or disappear under engine-management rules.

The system was therefore **threshold- and state-based**, not an unrestricted simulation in which every panel continuously computed material failure.

## Debris and “thousands of physics objects”

The selling point was not that every piece of every car remained active indefinitely. It was that tracks contained very large numbers of interactive, destructible objects and that the game could leave substantial debris behind.

A contemporary hands-on report stated that the PS2 demonstration supported **up to 5,000 interactable objects**, including poles, wires, rocks and environmental props, while still tracking cars and scattered debris without obvious frame-rate collapse.[1] Other reviews describe thousands of destructible trackside objects and debris remaining on the circuit during a race.[2][3][8]

That number should be interpreted as an engine/world-object budget, not as a guarantee that 5,000 fully dynamic, high-cost rigid bodies were simultaneously active. Objects could use different categories:

- static collision geometry;
- cheaply simulated breakable props;
- active rigid debris;
- distant or simplified representations;
- objects removed, slept or recycled after their useful visual life.

The actual number of car fragments visible in a race would depend on collisions, race mode, track, camera visibility and cleanup rules. Public reviews establish “thousands of objects” and the roughly 40-part car figure, but do **not** provide a verified per-race cap such as “exactly N active debris bodies,” nor a complete part-by-part accounting for every vehicle.

## Driver ejection and ragdolls

The driver was a separate animated character while seated, not an integral deformable component of the car. Under a sufficiently severe crash—especially a high-speed impact against a wall—the game triggered an ejection event. The driver was propelled out of the vehicle and handed over to a ragdoll system.[5][6]

That transition involved several stages:

1. The game detected a crash severe enough to qualify for ejection.
2. The seated driver switched from its driving animation to an ejection pose or launch state.
3. An impulse was applied through the windshield/open cabin area.
4. The character became a dynamic ragdoll, with articulated limbs reacting to impacts.
5. In races, the ragdoll was subject to gameplay recovery/reset rules; in stunt events, the player could influence the airborne trajectory.

*FlatOut 2* expanded the original concept into dedicated “Ragdoll Olympics” events. Contemporary coverage specifically notes that the driver could be directed in midair during minigames to improve the landing.[2][5] That does not imply that the entire car was simulated as a soft body; it reflects a separate character-ragdoll system coupled to the vehicle’s crash impulse.

The number of simultaneously active driver ragdolls in an ordinary race was almost certainly constrained by gameplay and performance management. The available public material does not document a definitive hard limit. In normal racing, the game did not need to maintain unlimited persistent ragdolls: drivers could be reset, cars could respawn or recover, and inactive objects could be removed or put to sleep.

## PS2/Xbox-era performance strategy

The technology was impressive because it concentrated expensive simulation where it mattered:

- the player and nearby cars received the most detailed vehicle and collision treatment;
- debris could be promoted to active physics when necessary;
- distant or inactive objects could use cheaper representations;
- destroyed objects could be removed or recycled;
- visual damage could be represented by mesh deformation and state changes instead of full structural simulation;
- ragdolls were transient events rather than permanent world inhabitants.

The PS2 demonstration’s reported ability to manage cars, debris and an environment containing as many as 5,000 interactable objects is evidence of aggressive budgeting and prioritization, not evidence that all 5,000 objects were equally expensive dynamic bodies at every frame.[1]

No dependable public source in the supplied material specifies the engine’s exact fixed physics frequency, such as 30, 60 or 120 Hz. Reviews and retrospective-style technical discussions commonly describe the game’s physical behavior, but the available evidence does not justify assigning a precise simulation tick rate. Likewise, the sources do not establish a verified universal limit for active debris, ragdolls or simultaneously simulated detachable panels.

## Ultimate Carnage

*FlatOut: Ultimate Carnage* was an enhanced version of *FlatOut 2*, with improved graphics, additional drivers and cars, and expanded presentation rather than a fundamentally different damage architecture.[4] Its damage model retained the same basic hybrid design:

- rigid vehicle physics;
- collision-driven visual deformation;
- breakable and detachable components;
- persistent track debris;
- separate driver ragdolls.

The Xbox 360/PC hardware target allowed more detailed rendering and denser presentation, but the underlying design remained game-oriented rather than a fully general soft-body simulation. Contemporary coverage emphasizes that damage was rendered in many changing forms instead of merely switching to a single pre-buckled bonnet model.[10]

## What can be stated confidently

- Cars used a rigid driving/chassis physics model augmented by visual deformation and detachable damage components.
- *FlatOut 2* cars were commonly described as having **up to 40 destructible parts**.[9]
- Hoods and doors could open, flap, swing and eventually detach, but public documentation does not prove that all such behavior came from fully independent hinged rigid bodies.
- Track environments contained thousands of breakable/interactable objects; a contemporary PS2 report cited **up to 5,000 objects**.[1]
- Debris persisted and could affect later racing lines and collisions.[8]
- Drivers were ejected into a separate ragdoll simulation after severe crashes.[5][6]
- The game used culling, sleeping, object-state changes and likely cleanup/recycling to make the spectacle feasible.
- The supplied public sources do **not** verify an exact physics rate, exact active-debris cap, exact ragdoll cap, or a complete per-car component inventory.

The most accurate description is therefore: **a carefully budgeted hybrid of rigid-body vehicle physics, collision-driven mesh deformation, articulated/breakable props and transient ragdolls—not a complete soft-body car simulator.**

[1] E3 2006: FlatOut 2 Hands-On (https://www.ign.com/articles/2006/05/12/e3-2006-flatout-2-hands-on)
[2] Search Results » 1 (https://www.fun-motion.com/page/27/?s=1)
[3] Smashingly Fun Vehicle Physics with FlatOut 2 - Fun-Motion (https://www.fun-motion.com/physics-games/flatout-2/)
[4] FlatOut: Ultimate Carnage (https://www.pcgamingwiki.com/wiki/FlatOut:_Ultimate_Carnage)
[5] Physics Games and Physics-Based Game Downloads (https://www.fun-motion.com/category/physics-games/page/15/)
[6] FlatOut 2 Review - IGN (https://www.ign.com/articles/2006/08/03/flatout-2-review)
[7] FlatOut: Exclusive developer diary - part two (https://www.gamesradar.com/flatout-exclusive-developer-diary-part-two/)
[8] FlatOut 2 review (https://www.eurogamer.net/r-flatout2-x)
[9] FlatOut 2 - Wikipedia (https://en.wikipedia.org/wiki/FlatOut_2)
[10] FlatOut Ultimate Carnage (https://www.eurogamer.net/flatout-ultimate-carnage-first-impressions)
