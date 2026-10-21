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
optional `z0` leans its panel from its bottom edge `[y0, z0]` up to its hinge), `lamps`, and the
optional `livery` and `lightBar`. `rig` overrides the soft-body cages a body's panels need.
Optional `details` holds the car's fine contours (panel gaps, shut lines, creases, vents, grille bars, lamp internals) as strokes and patches drawn on its side, top, front and rear views; the detail-map system bakes them into height and cavity maps read at the skin's rest position, so they ride a crushed panel.

The hardpoints place the openings and the lower body, each per car:

| Field | Meaning |
|---|---|
| `windshield` | Base `[y, z]` of the glass centre line and its widths at the base and at `windshieldTop` |
| `bPillar` | The B-pillar's z band |
| `aPillarFoot` | Where the A-pillar's foot meets the belt (z): the door glass's front edge starts there |
| `aPillarTop` | Optional: where the A-pillar's rear edge meets the cant line (z), the door glass's top-front corner. Absent, 5 cm behind the windshield's top; set it on a raked windshield so the window's front edge isn't a straight line from the foot |
| `glassTop` | Optional side glass top (the DLO's top edge). A number: its drop under the roof (absent 0.075), the roof's side lip and the pillar tops following it. `[z, y]` stations (linear between, held past the ends, never above the cant line): the glass top follows them under a 0.075 lip and a painted fill (drawn only) closes the gap up to the cant line from the C-pillar to the A-pillar |
| `belt` | Side-glass sill: half-width `x` (one value, or `[z, x]` stations where the sill narrows toward the tail), and height `y` as `[z, y]` stations (linear between, held past the ends), so a beltline can rise toward the tail |
| `rocker` | The body side's lowest line; under it the sill turns in to the floor pan. It rides up with `underside` |
| `underside` | Optional floor pan height as `[z, y]` stations (linear between, held past the ends): the underside's rise to the nose and tail. Absent, the floor is flat at `dims.rideHeight` |
| `door` | Front doors: hinge axis `hingeX`, `hingeY`, `hingeZ` at the A-pillar, `length` hinge to trailing edge, skin ±`halfHeight` about the hinge, and `aperture` `[z0, z1]`, the body's door cut (the skin covers it, 2 cm past each end). The door glass rides the door: its rear edge stands 3 cm (belt) / 5 cm (top) inside the trailing edge, so put the B-pillar's front there. The mirror seats itself on the door skin at `mirrorY` over the hinge and `mirrorZ` behind it (default 0), drawn to reach `mirrorReach` out, ±`mirrorHalfDepth` deep |
| `arch` | Wheel-arch opening radius about each hub |
| `hood` | Bonnet span `z0` (cowl) to `z1` (nose) and its hinge `origin` `[y, z]` |
| `bumpers.front`, `bumpers.rear` | Group `seat` (height, distance from the middle), `fascia` section `[y, out]` top to bottom, `span` (half-width), and `wrap`: the `|x|` where the fascia's corner starts sweeping back (`from`) and how far its end sweeps (`back`) |

`car-styles/platform.ts` exports the values the first bodies shared as `PLATFORM_HARDPOINTS`; a table spreads it and overrides
what its car changes. Every hardpoint but the bumper fascia reaches the collision cage or a sim reader (the greenhouse pillars,
the sill, the arches, the hood's pose, a torn bumper's box), so moving one moves the sim: re-pin and bump `REPLAY_VERSION`.
The greenhouse header bars follow the roof: a drawn header bar's top never stands above the roof skin over its ends.

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
the plan gets worse (mean and largest |offset| over the sides, ends trimmed) and something gains. Each group's result is one
`guard` line, so the output is never worse than the style it started from. `dims` overhangs, width and height are then
measured off the built car, as the dims rows hold them.

```sh
R=/home/aphix/github/crash-deformer-test/.tmp/ModernCarDesign/ModernCarDesigns_SideAndTop
node --disable-warning=ExperimentalWarning scripts/fit-car.mjs --style sedan \
  --side $R/silver-sedan/silver-sedan-1.png --side-span 3,299=4.221 --top $R/silver-sedan/silver-sedan-2.png --top-span 3,292
```

- Read: `dims` (wheelbase and wheel radius from the side picture's tyres, which also set z = 0; `track` so each tyre's outer face
  sits 1 cm inside the plan), `profile` (stations where the roof line, plan or glass zone bends; mirrors and handles cut from
  the plan), `roofZ`, `windshield`, `windshieldTop`, `rearGlass`, `belt.y` (the glass sill), `belt.x` (the rail 4 cm under the
  shoulder), `underside`, `door.hingeX` (the plan at the hinge), `bumpers.*.seat.z` (lip on the end) and `bumpers.*.wrap`
  (the plan's end corners). Fitted: `profile`.
- Not read: hood, arch, rocker, boot, `rideHeight`, `cabinHw`, `bPillar`, `quarter`, mirrors, the bumper fascia and span, and the
  door's hinge y and z, length and aperture.

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
