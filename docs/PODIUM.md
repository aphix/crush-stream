# Podium

The top three of a finished race or campaign stand on a three-level podium floating in the air over the course just raced, each car as the race left it
(dented, torn parts and lost wheels gone), a name plate in front of each, a banner behind, fountains and a slow camera swing. It is presentation only: nothing here
touches the sim, the recorder or the clip layout (`REPLAY_VERSION` and `NET_VERSION` stay), and it is this browser's view alone (nothing goes on the net).

| File | Role |
|---|---|
| `match/podium.ts` | The stand's numbers: the three blocks (place, x, height, the way the car faces) and `podiumPlaces`, the first three rows of a classification. |
| `match/campaign-reel.ts` | `CampaignReel`: a campaign's highlights kept round to round, and the best three picked for its finale. |
| `engine/car-damage.ts` | `CarDamage`, one car's damage; `FinalDamage`, every racer's as the race ended. |
| `engine/engine-podium.ts` | `PodiumDirector`: raises and lowers the stand, its three cars, the camera swing, the jets. |
| `present/podium-stage.ts` | `PodiumStage`: the platform, the blocks with their cups and numerals, the name plates, the banner, the poles and bunting. |
| `engine/engine-reel.ts`, `engine/engine-highlights.ts` | The commands (`podium`, `campaignReel`), and `ReelDirector.showPodium` / `endPodium`: the podium takes the screen over a reel and gives it back. |
| `components/race-podium.tsx` | The HUD while it is up: a line of title and the pills. |

## When it shows

- **Race.** The results sheet has a **Podium** button (next to Retry): the top three of the results. The reel keeps its clock behind it and sets its clip up again at its next flight when the podium goes down.
- **Campaign.** After the last round, when the standings come up (the champion's), the podium raises itself once: the top three by points. The standings sheet keeps a **Podium** button to raise it again.
- **Skip.** The **Skip** pill (the campaign's: **Standings**), Esc or the pad's B takes it down, back to the sheet it came from. There is nothing else to wait for: it runs until skipped.

## The stand

Three blocks side by side facing the viewer (+z): the winner's in the middle at 2.2 m, the second's on the viewer's left at 1.6 m, the third's on the right at 1.1 m (`BLOCK_TOPS`). The second's and third's cars turn 0.45 rad
in toward the winner; the winner's faces the viewer. The platform is a stone disc (11.5 m radius) with a gold rim over a rock cone, 40 m (`PODIUM_HOVER`) over the course's start line, so the course reads below it. Each block's face has a cup either side of
its place's numeral in the place's metal (gold, silver, bronze), dark-inked so silver on a silver block still reads; the cups are placed by their measured extents (`present/podium-layout.ts`: the handles reach past the cup's middle) and kept inside the decal's canvas by a margin and clear of the numeral. A name plate, leaning back like a lectern, stands on the apron in front of it with the racer's name as the standings show it (shrunk to fit the plate). The banner hangs
behind the blocks between two poles, with a string of bunting across it: a trophy at each end, a row of stars, and the course's name small above them (a campaign's: Championship). It never says the word podium: a podium just is one. Everything is built once on the first raise and re-lettered for each: names on the plates, the title on the
banner (canvas textures; no per-frame cost).

## The cars

The field's cars are the reel's to respawn (every clip puts its cars back from keyframes), so the podium never uses them. `FinalDamage` reads every racer's damage (`CarDamage.read`: the dents and the packed engine block, the parts torn off,
the lost wheels, lamps, glass: `DeformableCar.deform.readNetState` and `readPartNetState`, what a netplay host sends) once per race, on the first frame that sees the race finished, before the reel can move a car. The
podium builds three cars of its own beside the field (the body, class and paint of the racer's: `buildCar` and `dressCar` on the racer's slot, so the player's look and the rivals' spray are right), stands each on its block and lays the damage on it
(`CarDamage.lay`, the held reset's own path: `RaceField.placeKeeping` uses it too), then seats each wheel it kept at its hub (`DeformableCar.followHubs`). Torn parts and lost wheels are not drawn (`DeformableCar.hideLoose`): the car is missing them, and nothing hangs in the air where they came off. Its body and bonnet are drawn as the finished car drew them (`CarDamage.readDrawn`, `drawOn`), the tyre hold over its wheels as they stood then included, not re-held over the podium car's own seated wheels. The three cars are
kept between raises while a racer's body and class are the same, and let go with the engine.

**Wheels and lamps are the batches' draws, not meshes of the car** (`vehicle/wheel-batch.ts`, `LampBatch`): the engine hands them the field's cars once a frame (`CrashEngine.drawnCars`), so a car outside that list shows none. The podium's three are on it while it stands (the field is hidden then, so the two never draw at once). A podium car shows the wheels it kept and not the ones it lost; before this was added all three drew with empty arches.

**The final state is held in a row**: against the car as it finished (read in the frame that sees the race finished), each podium car's attached parts (doors, hood, boot, bumpers, mirrors, light bar) sit in the same pose within 1 cm and its torn ones are absent, and each wheel it kept sits where the finished car's did along the ground. A bumper's hang follows its attach sensors' compression, which is solver state the net state does not carry: a podium bumper stands straight where the finished car's hung (a measured 5 cm of drop and 0.04 of a quaternion component at most; the row's bound is 6 cm). A wheel's height is the suspension's ride, which a level car at rest has.

## The camera, the jets

The camera pose is built without a call that allocates: the swing's sine and cosine come from `sinCosAt` (it writes into a typed array; `detSin`/`detCos`/`detAtan2` box their numbers when not inlined, which showed as 110-180 B a frame in a window that did not happen to be inlined), the camera's quaternion from half-angle identities (no pitch trig, no Euler), the width fit only when the lens changes, and the frame's time goes in and out through `PodiumDirector.time` (a double passed to or returned from a call that is not inlined is a heap number). `engine-podium-alloc.test.ts` holds it at 16 B a frame, 10 of 10 runs alone.

A pendulum swing of 0.8 rad either side of dead ahead over 30 s, dollying in from 34 m to 19 m in 3.5 s, 8.5 m over the platform, looking 2.8 m over it. The distance grows when the screen is narrow enough that the stand would not fit
its width (a phone upright), so all three blocks stay in view on every screen shape; the pendulum keeps the banner behind the cars. The jets are the course fountains' (`FountainSystem.jet`, `docs/CINEMATIC.md`): four spots on the
platform, a round every 3 s, in gold, red, blue and white in turn, scaled by the FX tier and nothing at `off`.

## Campaign reel

`CampaignReel` keeps the clips of each round's results reel (`EngineReel.startReel`, on the host or offline) while a campaign runs. A clip is let go once three others score `1 + WINNER_LEAN` times its score or more: those rank ahead of it
whoever wins, so the memory is the three best clips and the few within the lean of them, however many rounds (a clip is up to 300 KB). At the finale the reel is the best three by **weighed score**: a clip's score, times
`1 + WINNER_LEAN` (0.1) if any of the campaign's top three racers is among its cars (owner: the winners being in the highlight is a tie break), so a clip with a winner in it ranks ahead of one without it up to 10 % better, and exactly
tied clips go to the winner. Ties of weight keep the clip found first.

The standings sheet and the podium offer **View the highlight reel** while there are clips (`RaceHud.campaignReel`, not in a room: the campaign is the room's). It leaves the campaign for the setup menu (the standings are gone with it)
and plays the three one after another through the saved-clip player, each once and on its own course and cars' looks (`dressForClip`, the saved highlights' own path), then the setup menu. A tap, Esc or B leaves the reel at once.

## Tests

`match/podium.test.ts` (order, heights, symmetry, names), `match/campaign-reel.test.ts` (the three best from every course, the tie-break and the lean's edges, the memory bound against a campaign that keeps everything, for every winner set),
`engine/engine-podium.test.ts` (each car on its block, the winner's skin is the wreck's, a shoved hub's wheel sits on its hub, the camera keeps the stand in view on five screen shapes over a minute, lowering, the jets), `engine/engine-podium-alloc.test.ts` (16 B a frame), `engine/engine-podium-race.test.ts` (the real engine: a
race ended with every car dented, a wheel lost, a bumper torn and the hood and a door forced open shows the first three of its results in order, wrecked, after the field's cars were respawned; the wheel batch draws the wheels the three kept and none they lost; each attached part is in the finished car's pose and each torn one absent; Skip gives the field back; the jets keep moving), `engine/engine-podium-campaign.test.ts` (a campaign's finale raises it and the reel option plays the three kept clips), `present/podium-stage.test.ts` (no podium text anywhere on the stage, every point of a decal's cups inside its canvas, each decal inside its block's face with a margin).
