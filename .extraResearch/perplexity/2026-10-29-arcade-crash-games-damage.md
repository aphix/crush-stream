> Question: How do arcade/semi-sim crash-racing games model car damage and collisions, with sources (GDC talks, developer interviews, papers, modding docs): Bugbear's FlatOut series and Wreckfest (soft-body / clustered shape matching, Rajala 2008), Criterion's Burnout 3/Revenge/Paradise (crash deformation, 'Crash Mode', Takedowns), and similar (Next Car Game, Destruction AllStars, Carmageddon Max Damage). For each: (1) how impact force/energy is converted into deformation vs rigid-body motion, and whether car-car, car-wall, car-prop and car-ground impacts use the same code path or special cases; (2) how deformation is kept local (a corner hit not deforming the far end) and how repeated hits on the same area behave (does crushed metal get stiffer); (3) how detachable parts (doors, bumpers, hoods, wheels) decide to break off and then collide (do loose parts collide with cars and ragdolls? one-way or two-way?); (4) known tricks for stability and believability (clamping, limits per region, crumple zones vs rigid cabin cage, deformation caps, damping); (5) how 'crusher'/compactor or pinned-car scenarios are handled if at all. Distinguish documented facts from inference.

The public record is uneven: **Wreckfest/FlatOut and Carmageddon have unusually useful technical descriptions**, while detailed implementation documentation for Criterion’s *Burnout* games, *Destruction AllStars*, and some later Bugbear systems is sparse. The comparison below separates documented facts from engineering inference.

## At a glance

| Game | Damage model publicly established | Main collision philosophy |
|---|---|---|
| **FlatOut / Wreckfest / Next Car Game** | Bugbear soft-body, location-dependent deformation; *Wreckfest* explicitly markets damage that affects handling[4] | Deformable vehicle representation coupled to rigid-body physics |
| **Burnout 3 / Revenge / Paradise** | Highly authored crash presentation with deforming bodies, flying parts, Crash Mode, Takedowns, and spectacle-oriented physics[1][8] | Rigid-body gameplay plus localized visual/structural damage and scripted or constrained crash behavior |
| **Carmageddon: Max Damage** | Vehicle assembled from pieces, “virtually welded” as a monocoque; explicit concertina, buckling, splitting, and detachable-part systems[9] | Deformable component network with special handling for trapped regions and catastrophic separation |
| **Destruction AllStars** | Publicly visible localized body damage and detachable components, but little authoritative technical disclosure | Likely hybrid rigid-body gameplay, damage zones, part detachments, and authored limits; implementation details are not publicly established |

## Bugbear: FlatOut, Next Car Game, and Wreckfest

### 1. Force, deformation, and collision paths

Bugbear’s system is generally described as **soft-body damage**, rather than merely swapping between intact and destroyed meshes. *Wreckfest* is specifically described as using location-based damage that changes vehicle dynamics[4]. Contemporary descriptions of *Next Car Game* likewise call the vehicles “destructible soft body” vehicles[7].

A useful engineering interpretation is:

- The car’s overall motion is solved as a rigid body: translation, rotation, suspension, tires, and contacts.
- The visible body is represented by deformable points, clustered shapes, or equivalent local elements.
- Collision impulses are divided between changing the vehicle’s rigid-body velocity and moving/deforming local body elements.
- Damage is then fed back into collision geometry, suspension/wheel alignment, visual meshes, and handling.

The often-cited Rajala 2008 material is relevant to this family of methods because it describes **soft-body deformation using clustered shape matching**: groups of particles attempt to preserve a preferred local shape, while deformation and constraints prevent the model from behaving like an unconstrained bag of points. However, the available results do not establish that the released *FlatOut* or *Wreckfest* code is a literal implementation of every detail in that paper. That connection should therefore be treated as **strongly suggestive, not source-code proof**.

There is no reliable public documentation showing that Bugbear uses one identical contact routine for every case. The likely structure is a shared contact/impulse foundation with distinct treatment for:

- Car–car contacts
- Car–wall and car–track-boundary contacts
- Car–prop contacts
- Car–ground and wheel/terrain contacts

That distinction is technically necessary: ground contacts need suspension, tire friction, and rolling constraints; body impacts need local deformation; props may be breakable rigid bodies; and car–car contacts may transfer damage to both vehicles.

### 2. Locality and repeated hits

Locality is the central advantage of a clustered or region-based soft-body model. A front-corner collision primarily moves or compresses nearby clusters; distance constraints, shape-matching regions, and structural links propagate only limited motion toward the cabin and opposite end.

The public descriptions support location dependence: *Wreckfest* damage depends on where the vehicle is hit and affects handling[4]. The precise rule for repeated impacts is not documented in the available sources. Two plausible mechanisms are:

- **Plastic rest-state update:** after a region is crushed, its preferred shape is moved toward the crushed configuration, so later impacts deform it differently.
- **Damage or stiffness state:** a region accumulates damage and changes its allowable compression, strength, or visual response.

Whether crushed metal becomes physically stiffer is not established. In real sheet metal, folding can locally increase resistance in some directions, but game systems often approximate this with damage caps, state changes, or reduced remaining travel. Thus “the crushed area gets stiffer” should not be asserted as a documented Bugbear rule.

### 3. Detachable parts

Bugbear games visibly support parts such as bumpers, hoods, doors, wheels, and other body components becoming loose or disappearing. *Next Car Game* coverage notes that impacts can damage exposed parts and that pieces of solid structures can crumble onto the track[7]. *Wreckfest* reviews describe wheels coming off, hoods crumpling, bumpers hanging or scraping, and doors caving in[10].

The likely sequence is:

1. A part has an attachment constraint, break threshold, or damage state.
2. Sufficient impulse, separation, or accumulated damage breaks the attachment.
3. The part becomes a separate rigid body, is hidden, or is replaced by a simplified debris object.
4. Its subsequent collision behavior depends on performance and gameplay importance.

The sources do not establish whether every detached part remains fully two-way physically interactive. A practical implementation would often use tiers:

- Important wheels or large debris: two-way collision, at least briefly.
- Small panels: simplified collision or one-way visual debris.
- Cosmetic fragments: particles or non-colliding objects.
- Ragdolls: likely collision-filtered against some debris to avoid instability.

There is no reliable public evidence that every loose Bugbear part continuously collides with cars and ragdolls with equal physical authority.

### 4. Stability and believability

The following are technically likely, but not individually documented in the supplied sources:

- Limit deformation per cluster or body region.
- Preserve a rigid or semi-rigid cabin volume.
- Clamp maximum stretch and compression.
- Use damping to stop oscillation after impacts.
- Treat wheels, axles, and suspension as stronger structural elements than cosmetic panels.
- Reduce or disable collision complexity for tiny detached fragments.
- Cap damage accumulation so repeated contacts do not produce numerical explosion.
- Separate visual deformation from the collision hull where necessary.

The visible results strongly imply some such constraints. Without them, a soft-body car would easily explode, invert, or stretch unrealistically under repeated contacts. The claim that *Wreckfest* deformation affects handling is documented[4]; the specific clamps, damping constants, or region limits are not.

### 5. Crusher and pinned-car cases

A car pinned between another car and a wall is a difficult case because the solver must generate compression from both ends while maintaining contacts. Public material does not provide a Bugbear-specific description of a crusher or compactor algorithm.

Likely behavior is emergent from multiple contacts:

- The front contact prevents motion.
- The rear impact supplies impulse.
- Local body elements compress and transmit forces through structural links.
- Once deformation or damage limits are reached, further energy becomes rigid-body rebound, sliding, part detachment, or a capped visual result.

Whether the game has a special “crusher” mode is undocumented. It is safer to describe Bugbear’s result as **contact-driven deformation with stability limits**, not as a confirmed dedicated compactor solver.

## Criterion: Burnout 3, Revenge, and Paradise

### 1. Force, deformation, and collision paths

The *Burnout* games are best understood as **arcade crash systems**, not publicly documented general-purpose soft-body simulators. The series is known for crash damage, slow-motion presentation, Crash Mode, and spectacular vehicle deformation[1]. *Burnout 2* coverage already described bumpers and hoods flying off and debris becoming projectiles[8].

The gameplay objective is not to reproduce structural mechanics consistently in every situation. Instead, the system appears to combine:

- Rigid-body vehicle motion
- Strongly tuned collision impulses
- Localized visual deformation
- Detachable part effects
- Camera, slow motion, explosions, and scoring
- Special Crash Mode setups and rules

A normal race collision, a Crash Mode event, a Takedown, and a spectacular scripted-looking wreck may therefore share basic rigid-body contacts but use different damage, scoring, camera, and reset logic. There is no sufficiently detailed public source here to specify the exact path for car–wall versus car–car contacts.

### 2. Locality and repeated impacts

The deforming body panels in *Burnout* are visibly localized enough to sell a crash, but the sources do not document whether the deformation is based on a soft-body solver, pre-authored deformation modes, a mesh lattice, or a hybrid.

The most defensible distinction is:

- **Documented:** localized-looking crash deformation and flying body parts.
- **Not documented:** the exact mathematical locality mechanism or whether a previously crushed region becomes stiffer.

Repeated hits in an arcade game are commonly handled with bounded damage states, accumulated deformation vectors, or a small number of directional deformation modes. A physically exact plasticity model is unnecessary and would be costly. That is an inference, not a confirmed Criterion implementation.

### 3. Detachable parts

The evidence clearly supports detachable or flying components: bumpers and hoods can fly off, and debris becomes part of the crash spectacle[8]. Crash Mode emphasizes the visual and scoring consequences of impacts[1][8].

Whether detached parts are fully dynamic, collision-enabled, and two-way is not established. In an arcade presentation, a common compromise is:

- Large parts receive rigid-body motion and can affect nearby vehicles.
- Small fragments are visual debris or particles.
- Collision filters prevent debris from destabilizing the player car or producing unwanted chain reactions.
- Ragdolls and traffic vehicles may use special collision masks.

Thus, “loose parts collide with cars” is supported in a broad visual/gameplay sense, but **full two-way physical interaction for every detached part is not documented**.

### 4. Stability and believability

Criterion’s likely priorities were readability, spectacle, and repeatability:

- Damage caps to prevent a car from becoming numerically unstable.
- Strong damping and tuned restitution.
- Authoritative limits on vehicle angular velocity.
- Special handling for Crash Mode scoring and camera timing.
- Controlled debris counts and collision filtering.
- A distinction between a driveable damaged car and a crash/reset state.

*Burnout Paradise* is described in available material as treating severe chassis or wheel damage as a crash even when body damage alone would not necessarily end the event[6]. That supports a gameplay-level distinction between cosmetic deformation and structural/driveability failure.

### 5. Crusher and pinned-car cases

Crash Mode is a designed scenario for maximizing damage, not necessarily a general crusher simulation. The system likely handles a car trapped between traffic and scenery through tuned contacts, damage accumulation, and eventual crash/reset behavior.

There is no source here documenting a true constrained-volume or energy-conserving compactor model. Any apparent concertinaing should therefore be treated as an authored or bounded arcade result rather than proof of a general structural solver.

## Carmageddon: Max Damage

### 1. Force, deformation, and collision paths

Carmageddon has the clearest public technical description among the listed games. Stainless Games’ development account says vehicle models were built from individual pieces and “virtually welded together like a monocoque”[9]. The system was designed to handle panel damage, detached pieces, sandwiching, concertinaing, twisting, buckling, and splitting[9].

The article explicitly distinguishes deformation modes:

- **Concertinaing:** compression along one axis, such as hitting a wall.
- **Buckling:** wrapping or bending around an axis, such as a pole impact or T-bone.
- **Twisting:** different parts moving independently when some areas are trapped.
- **Splitting:** the vehicle divided across an arbitrary plane and continuing as two operational halves[9].

This indicates more than a simple health bar. The vehicle is a network of pieces with constraints and special handling for blocked regions. The source does not give the exact force equation or state whether all contacts use one path.

### 2. Locality and repeated hits

Locality is handled structurally: because the model consists of pieces connected as a monocoque, forces can be applied to the impacted or trapped areas and propagated through the connected vehicle representation. The developers specifically describe applying forces to points away from a trapped part so that another portion can twist independently[9].

The available source does not say whether crushed metal becomes stiffer. It does establish that the system can preserve and copy existing damage when the car splits[9]. Repeated hits therefore appear to accumulate persistent deformation, but the mechanical response of an already-crushed region is undocumented.

### 3. Detachable parts

Carmageddon’s parts are explicit components. The article says that pieces can come off and that, when a vehicle splits, anything crossing the split plane that can smash or detach must do so[9]. Crushable parts are divided across the plane, while the corresponding split-half is enabled and behaves as a normal car[9].

This is strong evidence for component-level attachment and detachment. It does not fully specify collision masks after detachment. Large pieces likely become physical objects, while smaller pieces may use simplified handling. The source does not establish whether loose panels have fully two-way collisions with vehicles or ragdolls.

### 4. Stability and believability

Carmageddon’s documented stability strategy is structural decomposition plus special-case transformations:

- Piece-based monocoque construction.
- Separate treatment of concertinaing and buckling.
- Independent twisting around trapped regions.
- Arbitrary-plane splitting.
- Copying existing damage into the newly enabled half.
- Vertex masking to hide geometry on the wrong side of the split[9].

Other likely safeguards—maximum deformation, damping, strength limits, and collision simplification—are engineering inferences rather than stated facts.

### 5. Crusher and pinned-car cases

This is the one game in the list for which the source explicitly discusses the scenario. Developers describe a car “sandwiched between another vehicle and the environment,” producing concertinaing, twisting, buckling, or splitting[9]. They also explain that when one part cannot move because it is trapped against something solid, forces are applied to points farther away so the rest of the vehicle can twist independently[9].

That is not merely a visual effect: it is a special response to constrained geometry. The source does not say that Carmageddon solves a fully general constrained finite-element problem, so the best characterization is **a specialized component-based deformation system designed to produce crusher-like outcomes**.

## Next Car Game

*Next Car Game* is the pre-release name associated with Bugbear’s later destruction technology. Public coverage describes destructible soft-body physics, exposed parts taking damage, and solid structures crumbling into track debris[2][7].

The available material supports the following:

- Damage is spatially localized rather than purely a global health meter.
- Environmental objects can be destructible.
- Body parts and track-side structures can become debris.
- The presentation aims at physically convincing deformation while remaining arcade-oriented.

It does **not** establish:

- Exact impulse-to-deformation equations.
- Whether the car–ground path differs internally from car–car.
- Whether crushed regions harden.
- Exact detachable-part collision filters.
- A dedicated crusher algorithm.

Because *Wreckfest* is the released successor and is explicitly associated with soft-body damage affecting handling[4], it is reasonable to view *Next Car Game* as an evolution of that technology, but not to treat every *Wreckfest* behavior as documented for the prototype.

## Destruction AllStars

The publicly visible game provides localized vehicle damage, breakable-looking panels, spectacular impacts, and character/ragdoll interactions. However, the available sources do not provide a developer interview, paper, GDC presentation, or modding document detailed enough to answer the requested implementation questions confidently.

Accordingly:

- **Documented at the gameplay level:** cars visibly damage and shed parts; collisions are heavily authored for spectacle.
- **Reasonable inference:** a hybrid of rigid-body vehicle simulation, regional damage states, detachable-part proxies, collision filtering, and hard caps.
- **Not established:** whether deformation uses soft-body shape matching, a finite-element approximation, pre-authored deformation fields, or another method.
- **Not established:** whether loose parts collide two-way with cars or ragdolls.
- **Not established:** any special crusher or pinned-car solver.

## Cross-game conclusions

### Impact energy versus deformation

The games generally divide an impact into two conceptual outcomes:

\[
E_{\text{impact}} \rightarrow E_{\text{rigid motion}} + E_{\text{deformation}} + E_{\text{friction/heat/debris}}
\]

But arcade games rarely conserve these quantities literally. The split is tuned for:

- Driveability
- Crash readability
- Visual drama
- Performance
- Predictable resets
- Scoring

Bugbear and Carmageddon expose more of the deformation state to gameplay. Criterion exposes more of it to spectacle and scoring.

### Local damage

Locality is usually achieved through one or more of:

- Spatially local deformation nodes or clusters
- Component attachment graphs
- Regional damage accumulators
- Directional deformation modes
- Separate visual and collision representations
- Strength differences between panels, frame, wheels, and cabin

A far-end panel remaining mostly intact after a corner hit is therefore likely a design property, not an emergent consequence of a single uniform car-health value.

### Repeated hits

There are three common possibilities:

1. **Plastic rest-state update:** the damaged geometry becomes the new local reference shape.
2. **Damage accumulation:** a region approaches a deformation or break threshold.
3. **Bounded deformation modes:** additional impacts have diminishing or redirected effects.

The supplied sources document persistent damage, but not enough implementation detail to decide which mechanism each game uses. “Crushed metal gets stiffer” is not a safe generalization.

### Detachment and collision

All these games benefit from collision tiers:

- Full two-way physics for wheels, major bumpers, or large debris.
- Reduced or one-way collision for panels and small parts.
- Visual-only fragments for high-count debris.
- Collision masks for ragdolls, traffic, and the player vehicle.

This is the most likely way to obtain spectacle without letting hundreds of fragments destabilize the simulation. Specific per-game behavior remains underdocumented.

### Crusher behavior

Carmageddon has explicit documentation for sandwiching, concertinaing, buckling, and splitting[9]. Bugbear’s public descriptions support soft-body, location-based damage but do not document a dedicated compactor solver[4][7]. Criterion’s Crash Mode is a designed damage-scoring environment rather than evidence of a general crusher model[1][8]. For *Destruction AllStars*, the implementation is not publicly established.

### Bottom line

- **Most physically expressive:** Bugbear’s soft-body lineage and Carmageddon’s component/monocoque model.
- **Most spectacle- and scoring-oriented:** Criterion’s *Burnout* system.
- **Best documented crusher logic:** *Carmageddon: Max Damage*.
- **Most defensible generic architecture:** rigid-body vehicle motion plus localized deformable regions, structural attachment constraints, detachable-part thresholds, collision filtering, and hard deformation/stability limits.
- **Claims requiring caution:** exact solver equations, stiffness after crushing, universal collision paths, and two-way interaction of every loose part with cars or ragdolls.

[1] Burnout (series) - Wikipedia (https://en.wikipedia.org/wiki/Burnout_(series))
[2] The Next Car Game (Livestream) (Max Graphics) (1080p) HD! (http://www.youtube.com/watch?v=CqYg49o4mC4)
[3] Burnout seriesburnout.fandom.com › wiki › Burnout_series (https://burnout.fandom.com/wiki/Burnout_series)
[4] Wreckfest - Wikipedia (https://en.wikipedia.org/wiki/Wreckfest)
[5] Face-Off: Carmageddon: Max Damage (https://www.digitalfoundry.net/articles/digitalfoundry-2016-carmageddon-max-damage-face-off)
[6] Burnout - TV Tropes (https://tvtropes.org/pmwiki/pmwiki.php/VideoGame/Burnout)
[7] Impressions: Next Car Game (https://www.rockpapershotgun.com/impressions-next-car-game)
[8] Burnout 2: Point of Impact - IGN (https://www.ign.com/articles/2003/04/03/burnout-2-point-of-impact-2)
[9] A crash course in the car physics of Carmageddon: Max ... (https://mcvuk.com/development-news/a-crash-course-in-the-car-physics-of-carmageddon-max-damage/)
[10] Wreckfest Review: A Good Old Fashioned Car Brawler - The Rant 365 (https://www.therant365.com/post/wreckfest-review-a-good-old-fashioned-car-brawler)
