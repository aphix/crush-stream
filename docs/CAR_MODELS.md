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
`midPillarZ`, `rearBulkhead`, `tubs` (open floors), `rearDoorSeam`, `boot` (deck lid, or a hatch / tailgate), `lamps`, and the
optional `livery` and `lightBar`. `rig` overrides the soft-body cages a body's panels need.

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

`scripts/trace-car.mjs` draws one style's car (its class's lift and wheel scale applied, no engine boot, under a second) over a
reference picture calibrated to metres, writes an overlay PNG and prints one JSON line: the silhouette IoU, signed edge offsets
in cm at stations along the top, bottom, front and rear edges (positive where the car sticks out past the reference), and the
drawn car's length, width, height, wheelbase, track, overhangs, wheel diameter and ground clearance.

```sh
S=/tmp/ModernCarDesign/ModernCarDesigns_SideAndTop
node --disable-warning=ExperimentalWarning scripts/trace-car.mjs --style sedan --view side \
  --ref $S/silver-sedan/silver-sedan-1.png --ref-span 3,299=4.221 [--points '[[2.0,0.65],[1.2,0.9]]']
```

- `--view side|top|front|rear` are orthographic and axis-aligned; `iso` / `iso-rear` use the game's lens at `--camera r,pitch,angle`
  and fit the reference to the car (IoU a rough guide). `--ref-crop x,y,w,h` cuts one car out of a lineup.
- `--ref-span x0,x1=m`: the reference's bumper-tip columns (or wheel centres with `--anchor wheels`) and their distance; without
  `=m`, the style's `dims` length (wheelbase). Side spans are the foreground columns × 0.01426 m; a top view takes its side's length.
  The hatchback's pictures are swapped (`-2` is its side, `-1` its top).
- `--points` overlays a traced edge in the view's axes (side `[z, y]`, top `[z, x]`): read the reference's edge off the PNG's
  0.5 m grid or the JSON's `edges` (`[station, car, reference, offset cm]`), and copy it into the style's tables.
- The PNG: the car orange and outlined magenta, the reference outlined cyan. Full usage is in the script's header.
