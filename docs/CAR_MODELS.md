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
