# Car models

Every drawn car is one `BodyStyle`: a spec table the shared builders turn into the body, its parts, the collision cage and the
soft-body rig. A style is data only; nothing in a builder names a style.

## Files

| Path | Holds |
|---|---|
| `src/game/vehicle/car-variants.ts` | The `BodyStyle` type, `CarStyleId`, `CAR_STYLE_IDS` (netplay wire order: append only), `FLEET_STYLE_IDS` (spawn order) and the `CAR_STYLES` registry |
| `src/game/vehicle/car-styles/<id>.ts` | One car's table |
| `src/game/vehicle/car-styles/platform.ts` | Pieces several tables share (the station helper, front clip, lamp seat, cabin tub, the platform tyre). A table that diverges writes its own value instead of importing the shared one |

The tables are one data table split a car per file ([`ARCHITECTURE`](ARCHITECTURE.md) W5): `check:boundaries` C13 lets two
tables carry the same number, but a number also typed outside `car-styles/` must be one imported constant.

## The spec

`dims` (metres, car space: origin on the ground midway between the axles, +z forward) is what the car's reference was
measured to, and the built car is held to it within 5 mm (`car-variants.test.ts`):

| Field | Meaning |
|---|---|
| `wheelbase` | Axle to axle |
| `overhang.front`, `overhang.rear` | Axle to bumper face; length = front + wheelbase + rear |
| `track` | Wheel centre to wheel centre |
| `width` | Widest drawn body, mirrors off |
| `height` | Ground to roof crown at rest, light bar off |
| `rideHeight` | Ground to floor pan, class lift off |
| `wheel.radius`, `wheel.width` | The tyre, before the class's `wheelScale` |

Mass, centre of gravity, lift and `wheelScale` stay per class in `vehicle-classes.ts` ([`HANDLING`](HANDLING.md)).

The shape tables describe the surfaces inside those bounds: `profile` (side-profile stations rear to front: shoulder
half-width, beltline, roof height and width, how much greenhouse), `roofZ`, `windshieldTop`, `rearGlass`, `quarter`,
`midPillarZ`, `rearBulkhead`, `tubs` (open floors), `rearDoorSeam`, `boot` (deck lid, or a hatch / tailgate; a tailgate's
optional `z0` leans its panel from its bottom edge `[y0, z0]` up to its hinge; a deck lid's optional `drop` `{ y, w, z? }` wraps it
over the tail edge (8 cm fold) and down the rear face to `y`, `w` its half-width there, the face's top at `z1` and its bottom at `z` (default `z1`); optional
`pivot` `[y, z]` is the hinge line the lid turns about, default its `origin`, and decides the swing: a chord rising over 45° from
it is a drop gate, a pivot over 0.2 m above the panel's top edge is a roof-hinged hatch or liftgate that carries the rear glass;
optional `swing` is its `LidSwing` (mass, struts, stop rise, latch and tear bars), default the preset for its kind;
[`DOOR_RIG.md`](DOOR_RIG.md), Lids), `lamps`, and the
optional `livery` and `lightBar`. `rig` overrides the soft-body cages a body's panels need.
Drawn only: `rearGlass.frame` `[side, bottom, top]` (m) draws the clear pane that far inside the outline and the band out to it as
the glass's black frit, so it swings, breaks and tears with the pane; `grille.lean` (rad) leans the grille's top back about its centre line onto a raked face;
`grille.rim` draws the surround in its own finish (a chrome frame round a black mesh; absent, `finish`); a mesh or hex grille's `count` sets its lines each way (absent, the default pitch).
Optional `details` holds the car's fine contours (panel gaps, shut lines, creases, vents, grille bars, lamp internals) as strokes and patches drawn on its side, top, front and rear views; the detail-map system bakes them into height and cavity maps read at the skin's rest position, so they ride a crushed panel.

The hardpoints place the openings and the lower body, each per car:

| Field | Meaning |
|---|---|
| `windshield` | Base `[y, z]` of the glass centre line and its widths at the base and at `windshieldTop` |
| `bPillar` | The B-pillar's z band |
| `aPillarFoot` | Where the door glass's front edge meets the belt (z) |
| `aPillarTop` | Optional: where the door glass's front edge meets the cant line (z), its top-front corner. Absent, 5 cm behind the windshield's top; set it on a raked windshield so the window's front edge isn't a straight line from the foot |
| `glassTop` | Optional side glass top (the DLO's top edge). A number: its drop under the roof (absent 0.075), the roof's side lip and the pillar tops following it. `[z, y]` stations (linear between, held past the ends, never above the cant line): the glass top follows them under a 0.075 lip and a painted fill (drawn only) closes the gap up to the cant line from the C-pillar to the A-pillar |
| `camera` | Optional cameras, car frame as drawn (a class lift included): `hood` `[y, z]`, the hood view's eye, just over the bonnet and ahead of the windshield base (`car-variants.test.ts` holds it there); `third` and `far` `{ dist, height, aimUp }`, the chase and far chase eyes behind and over the car's origin and their aim point's height. Absent: `PLATFORM_CAMERA` (the 4.2 m sedan's). Shoot them with `scripts/headless-frame.mjs --hash 'scene=race&car=<id>' --view hood\|chase\|far` |
| `belt` | Side-glass sill: half-width `x` (one value, or `[z, x]` stations where the sill narrows toward the tail), and height `y` as `[z, y]` stations (linear between, held past the ends), so a beltline can rise toward the tail |
| `rocker` | The body side's lowest line; under it the sill turns in to the floor pan. It rides up with `underside` |
| `underside` | Optional floor pan height as `[z, y]` stations (linear between, held past the ends): the underside's rise to the nose and tail. Absent, the floor is flat at `dims.rideHeight` |
| `door` | Front doors: hinge axis `hingeX`, `hingeY`, `hingeZ` at the A-pillar, `length` hinge to trailing edge, skin ±`halfHeight` about the hinge, and `aperture` `[z0, z1]`, the body's door cut (the skin covers it, 2 cm past each end). The door glass rides the door; its rear edge stands 1 cm under the drawn B-pillar's front edge at the belt and the top (`pillars.b`, else the `bPillar` band), whatever the door's length, so put the trailing edge at the B-pillar. The mirror seats itself on the door skin at `mirrorY` over the hinge and `mirrorZ` behind it (default 0), drawn to reach `mirrorReach` out, ±`mirrorHalfDepth` deep |
| `arch` | Wheel-arch opening radius about each hub |
| `hood` | Bonnet span `z0` (cowl) to `z1` (nose) and its hinge `origin` `[y, z]`. The drawn hood rests on the fenders: its edge 6.5 cm inside the station's half-width, 3 mm over the fender top beside it (a groove, not a step), its centre line `yBelt` + 2.8 cm |
| `bumpers.front`, `bumpers.rear` | Group `seat` (height, distance from the middle), `fascia` section `[y, out]` top to bottom, `span` (half-width), and `wrap`: the `|x|` where the fascia's corner starts sweeping back (`from`) and how far its end sweeps (`back`). Optional `wrap.end` `{ corner, stand }` (drawn only; the coupe's chrome bars): a lofted end instead of a corner held inside the body. The face runs straight to `from`, then a quarter-ellipse corner `corner` m deep turns onto the body side, and the end runs on along it to `back`, its face `stand` m off the skin. The section keeps its face and thins its hidden back round the corner. The fitter doesn't write `end` |
| `seats` | The driver's H-point `front` `[x, y, z]` (he sits on −x, the passenger mirrors him) and the rear bench's `rear` `[y, z]` on the centre line, or `null` with no rear row (the regular-cab truck). The drawn seats, the seated driver and the sim's seat read it |

`car-styles/platform.ts` exports the values the first bodies shared as `PLATFORM_HARDPOINTS`; a table spreads it and overrides
what its car changes. Every hardpoint but the bumper fascia reaches the collision cage or a sim reader (the greenhouse pillars,
the sill, the arches, the hood's pose, a torn bumper's box), so moving one moves the sim: re-pin and bump `REPLAY_VERSION`.
The greenhouse header bars follow the roof: a drawn header bar's top never stands above the roof skin over its ends. The drawn
A-pillar is a rounded post along the windshield's edge, 6 cm wide in side view whatever `aPillarFoot` / `aPillarTop` say, its top
held under the roof skin; where the door glass's front edge lies further back, a sail panel fills the gap at the same height (the
cage keeps its box between the windshield and the door glass).

The drawn parts (optional, drawn only: no cage build reads them, so adding one never moves the sim) dress a body without a
new mesh: each is merged into the mesh it stands on and moves with it.

| Field | Meaning |
|---|---|
| `hood.bulge` | Raised centre bulge on the drawn hood from `z0` to `z1`, `width` across, its top `rise` over the lid, easing into it at both ends. `scoop` (`inlets` 1 or 2, mouth at `z`, `width`, `height` over the bulge) rises toward a mouth facing forward, drawn dark. Merged into the hood (`withHoodBulge`): the bonnet's skin crushes it. `round` (m): rolled flanks (S-curve over that width) instead of the 5 cm chamfer; absent = chamfer |
| `hood.kind` | `"lid"` (default) or `"clamshell"`: the drawn lid laps the body's deck edge and shoulders 1 mm clear down to a side shut line on the fender top, where the drawn body's shoulder steps 3 mm in under the lid's edge (a groove, ramped in over 2 cm inside each lid end on body slices of its own) |
| `hood.crown` | `[drop, at]`: the drawn hood's top is a parabola across x, `drop` (m) under its centre line at \|x\| `at` (m), so its centre stands `drop·(w/at)²` over an edge of half-width `w`; drawn in four chords a side (default: the deck lid's 2.1 cm bow, its outer point over the deck's crown). Drawn only: the cage keeps the plain lid |
| `hood.groove` | `[out, down]` (m): over the open bay, the fender's deck edge beside a lid hood stands `out` outboard of the hood's edge and `down` lower, a shut-line slot onto the bay wall instead of the fender meeting the skirt flush. Keep the moved point under the deck-edge-to-shoulder chord (about 0.38 m down per m out) so the drawn ring stays inside the cage's. Drawn only |
| `boot.lip` | Ducktail kick: the deck lid's top rises `rise` at its rear edge, or the tailgate's top edge kicks `rise` out, easing in over `depth` |
| `boot.flush` | The drawn deck lid seats on the deck edge like the hood (its edge a groove over the deck edge, 5 mm wider than a plain lid), not a step up off it; the coupe's ducktail lid. Drawn only: the cage keeps the plain lid |
| `boot.crown` | `[drop, at]` (m): the drawn deck lid's top is a parabola across x, `drop` under its centre line at \|x\| `at`, so its centre stands `drop·(w/at)²` over its edge (the shut line, unchanged); one dome point a side, so no vertices are added. It eases in over 25 cm from the lid's front edge (which tucks under the rear glass's base) and back to the plain dome over the tail fold. Drawn only: the cage keeps the plain lid |
| `windowTrim` | `"chrome"`: a chrome bead (1 cm across, 5 mm proud) round every pane's border; the door glass's rides its door at the glass's seat, the rest (quarters, windshield, rear glass on the body) is one body mesh, so +3 draws. Drawn only |
| `chromeStrips` | With `windowTrim`: chrome strips on the body side, side-view `[z, y]` polylines `width` tall on both sides (rocker mouldings, a door handle bar). A strip wholly inside the door aperture rides the door's trim mesh, any other the body's; no draws added |
| `roof.rails` | Two dark rails at \|x\| `x[0]`..`x[1]` over `z` [rear, front], their tops `rise` over the roof at their inner edge |
| `roof.spoiler` | Body-colour wedge off the roof's rear end over `z` [tip, front edge]: underside at `y[0]`, top `y[1]` at the front edge, ±`halfWidth` |
| `roof.glassPanel` | Dark panel a few mm proud of the roof over `z` [rear, front], `width` across |
| `pillars.b` | The drawn B-pillar's side-view band: `width` [belt, top] (z) and optional centre `z` [belt, top] (a leaning post, e.g. a front door frame whose rear edge leans into it); absent `z`, centred on `bPillar`. Absent: the `bPillar` band, its top 3 cm narrower. Either way the door and quarter glass tuck 1 cm under its edges at the belt and the top |
| `pillars.divider` | The drawn post at `midPillarZ`: `width` [belt, top] (z) and optional `z` [belt, top] (a leaning post). Absent: 0.08 / 0.07 wide, upright at `midPillarZ` |
| `blackout` | Parts drawn gloss black by the paint's `primer` attribute: `a` (A-post), `sail`, `b`, `divider`, `rear` (the pillar to the rear glass), and `cowl`: the deck from 5 cm under the windshield's foot to 5 cm under the hood's rear edge (put `hood.z0` ahead of `windshield.base` to show a strip) |
| `cPillar` | The C-pillar drawn as a sail instead of a flat post: lofted from the haunch's shoulder (tangent to it) up to the rear glass's side edge and the roof, its front on the side window's line, its rear end 4 mm ahead of a deck lid. `tip` [y, z]: where that line meets the belt behind the quarter glass, with a gloss-black panel on the glass plane filling the gap. Absent `tip`: the line is the quarter glass's rear edge. `flush`: along the rear glass the sail's head laps 11 mm in over the glass's side edge, standing 5 mm on it and arriving level across it (one broad pillar rolling into the glass) instead of a rounded buttress beside it |
| `bumpers.front.trim`, `bumpers.rear.trim` | `"body"` (its body colour, painted finish), `"chrome"` or `"black"`; unset, the car's accent trim. A player's bumper colour still recolours it |
| `bumpers.rear.hitch` | Black tow-hitch receiver under the rear bumper's middle |
| `bumpers.rear.plate` | The number plate's centre height (m, car frame; drawn only); absent, `PLATE_RISE` (3 cm) over the bumper's seat. `plateFace` {`out`, `color`}: the plate's rear face (m, as `fascia`'s out) and colour; absent the platform plate's (0.09, cream) |
| `grille` | The style's own front grille (drawn only; it tears off with the front bumper): centre height `y` and face `z` (m, car frame; absent `z`: the platform grille's face), `size` [w at the top, h], `bottom` its width at the bottom (a trapezoid), `round` its corner radius, `kind` `"bars"`, `"slats"`, `"mesh"` or `"hex"` with `count` bars or slats, a round `badge` of that radius, `finish` `"black"`, `"chrome"` or `"body"`. `bezel` (m): a chrome frame that wide round the grille, 3 mm proud; absent none. Absent `grille`: the platform grille |
| `exhaust` | `tips` 1 (at `x`) or 2 (at ±`x`) at height `y`, `size` [w, h], `shape` `"round"` (oval) or `"rect"`: chrome with a dark throat, ending 4 mm inside the rear bumper's rearmost face (nothing stands past the tail) |
| `door.mirror` | The style's own mirror: `cap` `"rounded"` or `"box"`, `size` [w out from the door, h, d along the car] (default 0.16 × 0.10 × 0.08), `finish` `"body"` (the door's paint, a look's door colour too), `"black"` or `"chrome"`. Its foot sits on the door/A-pillar skin at the seat, a stalk runs out to the cap where the cap leaves room, and the cap's outer face is at `mirrorReach`, drawn at its real size. Unset: the platform mirror, x-scaled to the reach. The sim's mirror (reach, seat, rest box, torn box) is the platform's either way. `lift` (m): head on a pedestal that far above the seat. `mount` `"glass"`: the seat stands on the door glass's plane at `mirrorY`/`mirrorZ` (which may stand over the door skin's top) and the foot leans with the pane, as the trucks' tow mirrors on the glass's front corner |
| `door.hingeTop` | Drawn only: the door skin's top edge at its hinge cut (car y). Over the hinge end's slope the skin's rows close down toward the bottom one so the top meets the fender's deck edge there instead of standing over it as a fin. Absent: the slope alone. Every door's face between its edge rolls rides the body ring's side rows (`drawnSideRing`: shoulder, feature line, tuck rows, rocker, with the arch flare), lerped between the two cuts, so at each cut the door and the fender share one facet line |
| `arch.lip` | Each wheel arch's lip: a strip round the opening's edge, its crown `flare` (m) proud of the body side, faired into the skin `width` out and rolled under the edge into the well, down the opening's sides to the rocker. `square` squares its outline (a superellipse round the round opening) and its face: a box flare. `band` gives the round outline that stepped face (flat crown, its outer edge stepping down over 1.6 cm): a raised flare band. Its underside is the well's tone over the opening only; where a square outline stands out over the skin it is paint. Merged into the body, seated on its drawn loft (`archLipGeometry`); it peels and tears with its arch's panel |
| `ringSplit` | Drawn only: `[z0, z1]` (m). Every body loft gap whose middle falls in that range gets an extra ring there. Use it where the flank turns hard between stations, as the side rows lift onto an arch's flare. The cage keeps its own rings. The sedan sets `[1.4, 1.57]`, splitting the front arch's two gaps over z 1.39-1.58 (+2 rings, 46 vertices). The police inherits it |
| `wheelTub` | A bed's wheel tubs (pickup, monster): over each wheel whose liner stands in a tub floor, a half cylinder `rise` (m) over the floor, `length` along the car, `width` in from the bed's side wall, in BOTH builds. The cage merges them last, so every other cage vertex keeps its id, and keeps them out of its hull's decimation: the hull is decimated exactly as the body without them, then the tubs' vertices follow it whole (`CAGE_TUB_VERTICES` of room past `CAGE_VERTICES`). Absent, the drawn body's hump hugs the liner (below) |
| `tubWall` | A tub's rim width (m): how far in from the body side its side wall's top edge stands, seen from above, in both builds; the wall leans out to it from its foot, which stays 0.06 in (the wheel tubs, liners and boot hollow meet the foot). Default 0.06; the monster 0.04 (a thin bed rim). The pickup waits: its bed rim (1.18 m) and hood (1.04-1.16 m) stand over the dummies' proxy belt (`BELT_Y` 1 m), so they are fitted as roof slabs with nothing under them, and at 0.04 the re-decimated cage lids the bed or orphans the hood's nose row |
| `bayFloor` | The engine bay trough's floor height (m) under the hood (`bayTub`), which the bay set and the bay-paint row read. Default 0.28; the lifted trucks set their floor pan's 0.34, which stands over it |
| `boot.outline` | A tailgate's edge: the reference's gate seam as [x, y] on the right side, top to bottom (held past its ends). The gate is lofted to it at each height, with a ring at each of its corners, in both builds; the face's cut takes its widest point. Where it steps in narrower than the cut (the hatch, ±.43 between its tail lamps), a drawn infill panel flush with the gate shuts the tail beside it, a 4 mm seam off the gate's edge (`bootInfill`), so no loft ring points are added. Read it with `tailgateHalf(style, y)`. Absent: the tail panel's half-width less 13.5 cm |

Every drawn body also opens its boot and closes its wells, from the tables it already has (`bootCut`, `wellHumpGeometry`):
- **Boot opening.** Under a deck lid hinged at its front, a hollow (an unpainted inner panel) from the lid's front edge to its rear
  edge, its floor at the rear bumper's seat height. A tailgate, or a roof-hinged lid (hatch, liftgate), opens the rearmost open floor
  (cabin or bed) on through the tail instead. A tailgate, or a lid with `boot.drop`, also takes its share of the rear face: the tail
  panel is cut to the panel's width (1 cm inside its edge) down to its bottom edge, or the floor where that stands higher (a bed).
  Nothing of the body stands in the opening between its edges (`car-variants.test.ts`); the cage's deck stays closed.
- **Open floors and wheel humps.** A drawn open floor (a bed, a cargo floor, a boot; not the engine bay) stays flat over the wheels.
  Where a wheel's liner stands up through one, a hump closes it: from the floor's side wall in to past the liner's inner edge, its top a
  half ellipse 1.5 cm over the liner's arc. The liner is the cage's own wheel housing, so the hump stands where the sim already does.
  A bed with `wheelTub` gets the reference's tall wheel tubs instead, one at each side over each wheel, in the drawn body and the cage;
  no tyre risen to its spring's stop stands through the bed between its walls (`car-variants.test.ts`).

The roof parts are merged into the drawn body after its other parts (the body's skin crushes them with the roof); rails and
panel, and blacked-out pillars, are drawn dark by the paint's `primer` attribute. Exhaust tips and the hitch are merged into the rear bumper
(`withRearFittings`), so they tear off with it; their chrome and black come from the trim material's `fitting` attribute, so
no part adds a draw call. Every style's mirror is one variant in the part batch's two mirror draws: an instance draws its own
variant and paints a body-colour cap from its instance colour (`mirrorPartsMaterial`), so mirrors stay at two draws for any fleet.

## Interior, engine bay and bare metal

The cabin is shared props, placed per car by its spec (`vehicle/interior.ts` `CarCabin`, geometry in `interior-geometry.ts`):

| Prop (`PART_KIND`) | Seats per car | Placed by |
|---|---|---|
| `interior`: the cabin shell (floor, tunnel and console, dash with binnacle and screen, side trim) | 1 | Mapped from `REF_CABIN` onto the car's cabin box: `belt.x` (sides), the cabin tub's floor, 3 cm under the roof line at the B-pillar (top), `rearBulkhead.z` to `windshield.base` |
| `seatFront` | 2 | `seats.front`, the passenger mirrored |
| `seatRear` | 0 or 1 | `seats.rear`, stretched to the cabin's width |
| `wheel` | 1 | Ahead of the driver's H-point (`WHEEL_AT`), leaned `WHEEL_TILT` |
| `liningL`, `liningR`: door cards | 1 each | Door space; each keeps the first lining's box exactly (a torn door's loose box is sim) |
| `engineBay` | 1 | Mapped from `REF_BAY` onto the trough under the hood; shown while the hood is off or open |
| `crashBar` | 2 | Each bumper's seat; shown while that bumper is off or hanging |
| `ladderFrame`: rails, crossmembers, transfer case, steering box, shock bodies | 0 or 1 | `underbody: true` (the monster): in the class-lift body's space, under the floor (`CarUnderbody`) |
| `axle`: tube, diff, knuckles, shock shafts, trailing links, driveshaft, tie rod | 0 or 2 | `underbody: true`: each pair of drawn wheels' hub midpoint, tilted and spanned to them every sync; hung in the class hub group (`assignClass`); none while either wheel is off the car |

Every prop kind is one `InstancedMesh` for the whole field (`PartBatch`, `PART_PER_CAR`): adding a car adds instances, never
draws. At rest the interior costs six draws for the whole field (cabin, both door-card sides, front seats, rear bench, wheel) and the
seated drivers one more; the bay and the crash bars draw only while exposed, the undercarriage (two draws) only while a monster is in
the field. `CarDetail` takes the cabin, seats, wheel and bay at its far distance (by `INTERIOR_MESH`), the door cards, crash bars
and undercarriage with the small parts at mid distance. The undercarriage is drawn only: the cage, hull and contact shapes never
see it; each axle's shock shafts slide into the frame's shock bodies, so the pair telescopes through the suspension's travel.

- **Seat lean:** seats and the seated driver lean `SEAT_RECLINE` back; under a low roof the seat leans further (to
  `SEAT_RECLINE` + 0.35 rad) until the driver's head clears the roof line by 5 cm.
- **The driver:** `present/seated-drivers.ts` draws every car's driver seated (one `DummyMesh` for the field, slot = the car's
  index), posed by `seatedPose(style)`: hips on the H-point, back on the seat, hands on the rim's grips, soles on the floor. He
  wears the car's driver look (`RagdollSystem.carDriverLook`, as he is thrown) and hides once `driverOut` is set or the far
  cut takes his seat. In the garage no one sits in the car: the standing dummy beside it is the driver. The National Mall's
  VIP rides with his hips on the passenger H-point (`seats.front` mirrored).
- **Headliner:** the drawn roof panel is a thin shell (the cage's stays a closed wedge): its inner face, inset 4 mm from the roof
  skin's cants and crown, is the headliner, dark primer. It is skinned with the body, so it follows a crushed roof and never stands
  outside it (`shellTwins` pairs each headliner vertex with the skin vertex it is inset from).
- **Crush:** the cabin shell squeezes with the roof mass (a load's crush too, `CarCabin.squeezeUnderRoof`), so its dash never stands
  through a crushed roof. The bay rides the engine masses with its front no further out than the front bumper's masses (the
  nose); each crash bar rides its bumper's, its face on the bumper's seat.
- **The engine bay:** the drawn body (never the cage) opens a trough under the hood (`bayTub`: from the hood's cowl edge or the
  windshield's foot to inside the nose, floor at 0.28 m, and at least 5 cm of closed deck behind its blend after the cabin tub's, a
  cowl and not a fin), one more `tubs` entry for the drawn loft only. The bay set fills it
  wall to wall up to the hood's underside: a dark block and black cover with bare-aluminium heads, intake, plenum and strut
  caps, steel rails and manifolds, black radiator, airbox and battery.
- **Unpainted panels:** `primer` = `INNER_PANEL` (2) draws dark bare steel: the trough's walls and floor and the hood's underside.
  `WELL_PANEL` (3) draws a wheel well flat near-black with no sheen (`bare-metal.ts`): the wheel liners, each well's ceiling inside
  its arch, an arch lip's roll underside and return, and the trough corners an outboard tyre's arch looks onto (the monster's).
  Both are set at build, on the drawn body only (a panel torn and put back gets its rest tone, `PanelRegion.rest`). The drawn
  liners are two-sided (the paint culls back faces), their feet end at the rocker where it stands over the hub, and their outer
  ends follow the body side 5-8 cm past the opening, 1 cm inside it, so no liner shows past the skin. Over a tyre standing outboard
  of the body (the monster's) a half disc closes each well up to its crown, at a bed's wall where one stands over the wheel. No
  texture, no draw.
- **Bare metal:** the paint's `primer` attribute draws procedural riveted steel (`bare-metal.ts`: object-space seams, rivet
  rows, a tint per sheet), so a torn panel's or bumper's under-panel bends with the body and costs no texture or draw. A torn
  bumper bares the painted body it covered (`bumperBare`), a reset paints it again.
- **The cage** reads `cageInterior()`, the first interior box byte-for-byte: the drawn kit moves no sim reading.

## References and scale

The reference images are measured at one scale for every car: 0.01426 m per pixel of the lineup side view, anchored at the
reference sedan's bumper-to-bumper length of 4.22 m, so the cars keep the references' relative sizes and the fleet stays the
size the courses are tuned for. Where the references disagree, the front and rear isometric views win, then the side and top
views, then the lineup. Archetype research (real cars of the type) sets ratios and segmentation, not absolute size.

## Adding a car

1. Write `car-styles/<id>.ts`: `dims` and the shape tables.
2. Append the id to `CarStyleId` and `CAR_STYLE_IDS`, and add it to `CAR_STYLES`. A new wire index bumps `NET_VERSION`
   ([`MULTIPLAYER`](MULTIPLAYER.md)).
3. Give it a class (`STYLE_CLASS` in `vehicle-classes.ts`), or a new class row.
4. Pin it: its row in `car-smooth.test.ts`'s draw-call and digest tables; the dims rows pick it up from `CAR_STYLE_IDS`.
   A body that changes the cage or the rig moves the sim: bump `REPLAY_VERSION` with its history entry
   (`src/game/net/reel-codec.ts`).
5. Update the docs the car touches: [`UNIFIED_CONTACT`](UNIFIED_CONTACT.md) (cage), [`DOOR_RIG`](DOOR_RIG.md) (doors, lamps),
   [`PANEL_FLAP`](PANEL_FLAP.md) (panels), [`HANDLING`](HANDLING.md) (class), [`CINEMATIC`](CINEMATIC.md) (look).

## Tracing harness

Two tools share one core (`scripts/trace-core.mjs`, `trace-ref.mjs`, `trace-metrics.mjs`): a style's drawn car (its class's lift
and wheel scale applied, no engine boot) in a bare scene through headless GL, over a reference picture calibrated to metres.
The references live in `/home/aphix/github/crash-deformer-test/.tmp/ModernCarDesign/` (git-ignored; `/tmp` does not survive a
reboot). Run both through the box gate: `CAP=2G /home/aphix/crash-wt/slot-run /home/aphix/crash-wt/capped node ...`.

**`fit-car.mjs`: a speed-up.** It reads the side and top pictures into the style's own fields, builds the car from them, and
nudges the profile stations toward the reference's roof line and plan for a few rounds, all in one process of about 6 s. It
gets a car close fast but misses finer details. Each car agent then aligns the rest by hand on trace-car's overlays (windows,
doors, wheel centres, any silhouette edge) and spot-checks against the bar: side and top IoU ≥ 0.95, per-edge mean ≤ 2 cm,
max ≤ 5 cm, corners and glass included. Output: `.tmp/fit/<style>/fit.ts` (paste over the style file's fields after review),
before/after overlays beside it, and one JSON line with both views' IoU, edge and glass offsets before and after, the
per-corner checklist, `guard` and `notFit` (the fields left to the hand). It never writes a style file.

The fit is guarded: it lays the read fields onto the style as it stands one group at a time (the body with its greenhouse frame,
then the plan, track, glass sill, door, bumpers, underside). It keeps a group only where neither view's IoU nor either side of
the plan gets worse (mean and largest |offset| over the sides, ends and wheel arches trimmed) and something gains. Each group's result is one
`guard` line, so the output is never worse than the style it started from. `dims` overhangs, width and height are then
measured off the built car, as the dims rows hold them.

```sh
R=/home/aphix/github/crash-deformer-test/.tmp/ModernCarDesign/ModernCarDesigns_SideAndTop
node --disable-warning=ExperimentalWarning scripts/fit-car.mjs --style sedan \
  --side $R/silver-sedan/silver-sedan-1.png --side-span 3,299=4.221 --top $R/silver-sedan/silver-sedan-2.png --top-span 3,292
```

- Read: `dims` (wheelbase and wheel radius from the side picture's tyres, which also set z = 0; `track` so each tyre's outer face
  sits 1 cm inside the plan), `profile` (stations where the roof line, plan or glass zone bends; mirrors and handles cut from
  the plan, and the wheel arches too: 1.3 tyre radii either side of each hub, where the flare bulges past the body side, take the
  line between their neighbours, and no station there is ever wider than that line, so the shoulder gets no hump over a wheel;
  the flare is the arch lip's), `roofZ`, `windshield`, `windshieldTop`, `rearGlass`, `belt.y` (the glass sill), `belt.x` (the rail
  4 cm under the shoulder), `underside`, `door.hingeX` (the plan at the hinge), `bumpers.*.seat.z` (lip on the end) and
  `bumpers.*.wrap` (the plan's end corners). Fitted: `profile`. `arch-bulge.test.ts` holds every style to it, fitted or hand-set:
  over each arch's stretch, the drawn half-width at the belt and the shoulder's top stand no more than 1 cm over the lowest body
  either side of them (each on its own run: hood, cabin, boot deck). Within 25 cm of a glass base (the deck's rise to the rear
  glass, the cowl, the sail foot) both are judged instead against the reference: neither may stand more than 1 cm outside the
  picture's plan or side top edge at the same z. Those lines are `src/game/vehicle/car-reference-lines.fixture.json`, one key per style (the police
  answers to the sedan's), written by `fit-car --lines-out <that file>` from the same pictures and spans; rerun it when a
  reference or its span changes.
- Not read: hood, arch, rocker, boot, `rideHeight`, `cabinHw`, `bPillar`, `quarter`, mirrors, the bumper fascia and span, and the
  door's hinge y and z, length and aperture.

**`landing-shots.mjs`: the landing gate's shots.** For side, top, iso and rear-iso, the car alone (`ours`: the real engine in
the garage at the high tier over a white backdrop, through headless-frame), the car over its reference (`overlay`: trace-car) and
the two side by side (`pair`: the reference alone left, ours right), all through one camera spec (`trace-camera.mjs`) on one
canvas, so they line up pixel for pixel and every car is framed the same way:

```sh
CAP=4G /home/aphix/crash-wt/slot-run /home/aphix/crash-wt/capped node --disable-warning=ExperimentalWarning \
  scripts/landing-shots.mjs --root <tree> --car <style> [--paint]   # writes <tree>/.tmp/shots/landing/<car>-<view>-{ours,overlay,pair}.png
```

- Build side-by-sides only this way: a pair cropped or scaled per half (each to its own bounding box) misregisters. Each pair
  marks the reference's wheels (yellow crosses: the iso picks, the side picture's tyre contacts) and where the engine drew ours
  (magenta rings) on both halves. A wheel more than 5 reference pixels off, or a pair with nothing to register by (an iso with no
  picks, a side picture whose tyres were not found), turns the label red and the exit nonzero. The top view is not registered.

- Each car's `scripts/landing-views/<style>.json` holds its references, its iso crops (cut from the lineups; widen one that
  clips its car) and its iso cameras. Side and top are orthographic, spanned on the reference's bumper tips at the spec length,
  with z = 0 between the reference's tyres. Its `paint` is the reference's body colour (the median of the top picture's brighter
  half), which `--paint` gives both shots (`headless-frame --paint <colour>` or `<style>=<colour>,...`; a livery stays) so the
  overlays compare like for like.
- The isos are AI renders with their own lens, so each is aligned once on its wheels. Pick the visible wheels' hub (outer face)
  and contact points on the crop: `trace-car --style <id> --view iso --landing --grid <png>` draws the crop with a pixel grid.
  Wheels are named `fl`/`fr`/`rl`/`rr`; the front iso shows the car's left (+x) side, the rear iso its right. Store them as
  `wheels`. One side's wheels lie near one plane and leave the view's tilt about the wheel line loose, so also pick one or two
  `landmarks` off that plane, e.g. `{ "name": "front badge", "at": [0, 0.62, 2.08], "pixel": [u, v] }`. `at` is the point's place
  as the style file writes it (metres, before the class lift): a badge on the centre line, a far-side lamp or mirror. Then run
  `--solve`.
- `--solve` fits the camera's pose to the picks, held upright, for fields of view from 12° to 50°. It keeps the one whose
  silhouette fits best, or the entry's `fov` where one is pinned by hand, and stores it. Narrower lenses fit the renders a little
  better but stand the camera past the detail map's fade, so the engine shot would lose its panel lines. Every later shot reuses
  the stored camera, so a wheel the car moves shows as wheel error. Re-solve only when the wheels change.
- The overlay marks the picks yellow and the car's points magenta. The JSON prints `wheels` and `landmarks` (each point's error in
  crop pixels, RMS and largest). The sedan's wheel picks are in: about 2.5 px RMS on both isos.
- `headless-frame.mjs --view side|top|iso|rear-iso --view-camera <spec>` draws that camera on the garage car, and
  `--backdrop <colour>` draws the car alone. Both also work on their own, as does `--detail <rung>` (the distance-detail rung,
  governor off).

**`trace-car.mjs`: one view, measured.** Writes an overlay PNG and prints one JSON line: the silhouette IoU and signed edge
offsets (cm, positive where the car sticks out), the glass's (side: roof rail, sill, A- and C-pillar with their rake), the
side view's named corners (nose, tail, bumper tops and bottoms, sill, arch lips, roof corners), the largest uncovered and
overhanging regions (cm² with their extent), a `checklist` of FAIL/ok lines over all of them, and the drawn car's dimensions.

```sh
node --disable-warning=ExperimentalWarning scripts/trace-car.mjs --style sedan --view side \
  --ref $R/silver-sedan/silver-sedan-1.png --ref-span 3,299=4.221 [--omit doors,bumpers] [--points '[[2.0,0.65],[1.2,0.9]]']
```

- `--view side|top|front|rear` are orthographic and axis-aligned; `iso` / `iso-rear` use the game's lens at `--camera r,pitch,angle`
  and fit the reference to the car (IoU a rough guide). `--ref-crop x,y,w,h` cuts one car out of a lineup.
- `--ref-span x0,x1=m`: the reference's bumper-tip columns (or wheel centres with `--anchor wheels`) and their distance; without
  `=m`, the style's `dims` length (wheelbase). Side spans are the foreground columns × 0.01426 m; a top view takes its side's length.
  The hatchback's pictures are swapped (`-2` is its side, `-1` its top).
- `--omit` hides parts (doors, glass, bumpers, mirrors, hood, trunk, lightbar, wheels, lamps, parts) from the drawing and the fit.
- `--points` overlays a traced edge in the view's axes (side `[z, y]`, top `[z, x]`).
- The PNG: the car orange, outlined magenta; the reference outlined cyan; the car's glass lime, the reference's blue. The
  reference's glass is its dark, grey pixels (an Otsu cut, printed as `refThreshold`); a grey ground shadow on an opaque backdrop
  is left out of its silhouette (`shadowPx`). Full usage is in each script's header.
