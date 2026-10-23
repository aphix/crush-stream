import { FLIGHT } from "../vehicle/car-flight.ts";
import { EPICENTER_FIELDS } from "../deform/epicenter.ts";
import { CAR_STYLE_IDS } from "../vehicle/car-variants.ts";
import { VEHICLE_CLASS_IDS } from "../vehicle/vehicle-classes.ts";
import { CLIP_NO_CAR, CLIP_OUT_CAR, INPUT_BYTES, MAX_HITS, MAX_KNOCKS, MAX_PART_STIRS, MAX_SQUAD, MAX_SQUAD_EVENTS, MAX_STIRS, MAX_STRIKES, MAX_VIP_EVENTS, MEMORY, simFingerprint, type ClipEjection, type ClipHit, type ClipKnock, type ClipPartStir, type ClipSquad, type ClipStir, type ClipStrike, type ClipVip, type HighlightClip, type Reel, type ReelCar } from "../match/highlights.ts";
import { LOOSE_BODIES } from "../vehicle/part-state.ts";
import { blankStrike } from "../scenes/figure-strike.ts";
import { blankEjection } from "../vehicle/ejection.ts";
import { GUARD_DOWN, SQUAD_ALARM, SQUAD_DOWN, SQUAD_SHOT, SQUAD_TARGET, squadStateLength } from "../scenes/lawn-guard.ts";
import { makeSnapshot, MAX_NET_CARS, MSG, NET_VERSION, readEjection, readSnapshot, Reader, writeEjection, Writer, type NetLayout } from "./codec.ts";

/**
 * Highlight clips on the wire and in storage (docs/HIGHLIGHTS.md): one byte layout for the `MSG.reel` message and a
 * saved clip. A clip's keyframes are netplay snapshot messages (`writeSnapshot`) of its cars, kept as bytes, so a host,
 * its clients and a saved copy replay the very same numbers. Little-endian.
 */

/**
 * Clip layout version: bump on any change to `writeClip` or to a keyframe's bytes after its snapshot (2: each car's
 * flight block and solver state; 3: that state XORed on the car's previous keyframe's; 4: the solver state's
 * wreck-flight scalars `aloft`, `floorsFresh`, `frameY`, `frameAt`, `frameVy`; 5: the race's driver-look seed after
 * the deform mode; 6: `ejects` and the ejections tail, a thrown driver's step and launch numbers; 7: `simState` carries
 * each face's load crush (a stack's roofs replay crushed as live, docs/LOAD_CRUSH.md); 8: each step's dt as a float32
 * instead of whole microseconds, and the solver state's hit block, `impactLocal`, `impactInward` and `endEbs2`; 9: the
 * solver state as doubles instead of float32 pairs (a keyframe restores a wreck bit for bit) and the clip's `fine` block
 * as the pedals' doubles, NaN where not recorded, instead of one rounding byte each; the pile-ups replay to the bit; 10:
 * the live sim changed under the same bytes: a car meets a solid or knock prop with its whole footprint, not six probes,
 * so a clip recorded against a prop replays another hit; 11: the live sim changed again: the course wall keeps a per-car
 * contact memory, so a car that arrives beyond a wall line from another road stays there, not thrown back across it;
 * 12: no layout change, the live trajectories of cars stacked on each other moved: a car over another's roof is carried
 * by it, not shoved off by the plan SAT, and a tyre on a car grips both ways, so an older clip is refused; 13: a car
 * pair's contact axis is signed by the cars' centres (`satTwoHulls`), so a clip saved under 12 replays its pairs' pushes
 * the other way round; 14: a hard hit on a fixed solid (a course wall, a prop, a ramp's flank) is met as the range's slab
 * is, masses held on its face and the crush spending the hit's stroke, not cancelled and bounced in one step; 15: the
 * solver state's `hubStand` (where each hub stood in the car frame) and the planted anchor that reads it, a
 * live-trajectory change; 16: the solver state's position-correction budget is a net translation (`PushBudget`: one
 * more double), a live-trajectory change of every pile: pair pushes, sphere shifts and wall translations share it, and
 * the plant frees the wheels within 8 m/s of the body; 19: no layout change, the live sim changed: head-on tyres whose
 * hit stroke reaches the wheels, with stroke left, tear off their hubs instead of stopping the pair, so a fast head-on
 * crushes on and an older clip replays another hit; 20: a fixed solid's face meeting only the crush hulls (a palm
 * between the bumpers) is a contact as the slab's is (kept open, crushing and braking), and a wreck's hull allowance at a
 * fixed solid ramps with its closing speed, a live-trajectory change; 21: a re-armed hit's damage base is read in the
 * frame `clampLocal` keeps (`rearmHit`) and a derby car's wear share is 250, so a re-hit crushes and kills differently;
 * 22: derby drivers that pace in one pocket go bold, the first 8 s lift off high-closing rams, and lost wheels take
 * their steering, thrust, brakes and grip with them, all live-trajectory changes; 23: a clip carries the world's step
 * schedule (`shape`), each keyframe the course's wall memory and knocked props, a placed car takes a keyframe, and
 * masses touching keep a car in the clip; 24: a wreck's spin is its masses' momentum, a re-measure is no vertical
 * speed, steering, the plant's wheel seat and the planted write-back turn the masses' velocities with their positions,
 * shape matching hands back the angular momentum it moves, and a slice's pushes, structure step and re-fits share one
 * budget, all live-trajectory changes; the sim scalars drop two doubles; 25: the police pack guard reads the soonest
 * mate ahead first and a parked mate as an obstacle, drops the boost only for a predicted hit, and same-beat stakeouts
 * don't stack, a live-trajectory change of every pursuit; 26: pair contact trades momentum (the COM-gap floor holds
 * only once the struck face's crush is spent, as an inelastic exchange), mass pairs solve mirror-symmetrically, and a
 * flying body lands only with its middle no deeper than its springs, all live-trajectory changes; 27: pedals run on
 * the grid a clip stores (throttle/steer 1/127, brake 1/255), a clip keeps keyframe 0 plus one per placement, every
 * wreck or loose-part car's keyframe carries its parts, cage and sensor state, a clip lists props knocked by cars it
 * leaves out, and a straddled fleet-wedge wall seats an axle on its lower tyre; 28: a racer is waited for at 1.5x its
 * slowest lap, not its best, so a car is no longer DNF'd mid-lap after a shortcut lap; 29: the derby opening caution
 * reads a nose's own speed toward a crossing rival, not the range rate alone, so it lifts for more early charges;
 * 30: a crashed car's reported spin counts the turn its masses made beyond L/I, the planted write-back's kept turn and
 * a driven wreck's steer, so keyframe spin changes; 31: a clip carries the count of cars its cluster hit (`hit`), and
 * an impact counts only at 12.5 m/s closing; 32: the police pack guard reads a braking mate still rolling and leaves a
 * stopped mate the steer already clears, and a racer off the road corridor wakes no stakeout; 33: a wreck's car.angular
 * is L/I plus the driven steer only, the write-back's kept turn a readout, so keyframe spin changes; 34: a wreck's
 * tyres and scraping hubs resist its spin by Coulomb friction and the quiet collapse keeps spin until friction stops it;
 * 35: a wreck in flight lands on a fleet wedge's end only from within 0.1 m of its top, no longer popped onto it;
 * 36: a hunter's drop-in keeps dropMin from the player up to the frame the cop shows; 37: a car whose masses are idle
 * holds no contact clock, so a once-touched intact bystander stays quiet; 38: a car's far-end bumpers ride with the
 * cabin, crumpleWeight 1 only at the struck end; 39: a race reset puts a car at its last on-road spot between the last
 * checkpoint hit and the first owed, and a held reset moves a car there keeping its damage; 40: Survival's course sight
 * models trees and palms as a trunk under a crown, which moves cop drop-ins; 41: a hit square on a door at or above
 * killSpeed throws the driver out of that door's window with the engine running; 42: the sim's distances use the
 * kernel's hypot2/hypot3, not Math.hypot, so every browser computes the same last bits; 43: a clip records the hit
 * speed, the summed cage crush, each scoped hit and which ejections are its own, and a deep slow crush counts as a hit;
 * 44: the ragdoll world runs on Rapier's SIMD wasm build, whose float results differ from the plain build's, so a thrown
 * dummy's and a knocked prop's motion in a replayed clip changes; 45: race walls and solid props are one solid shaped from
 * the drawn pieces, and an open door meets them (shut or torn), so a replayed clip near a wall or prop moves differently;
 * 46: Razor Shelf's inside cut opens on cobble and carries marker cones and a CRUSH sign, so a run through it replays on
 * different ground and props; 47: a race AI car that needs more than full lock to regain its line slows to its class's
 * corner speed and drops boost, so AI cars in a replayed race drive differently; 48: the course's path tangents and the
 * AI's hashed dice use the kernel's engine-independent hypot and sin/cos, so a replayed race starts from different bits;
 * 49: Stage 1 of the one-motion-path physics: every car steps one rigid body on tyre springs solved together, rest is derived,
 * wreck contact is derived in one place, a wreck's shape fit keeps its roll, debris rests and slides on the ground and car tops by
 * one query, so a replayed clip's cars, wrecks and parts move differently; 50: every sine and cosine the sim takes, its own and
 * three's quaternion from Euler angles or an axis and angle, is the kernel's engine-identical one, so a replayed clip starts from
 * different last bits and replays to the same bits in every browser;
 * 51: Stage 2 of the one-motion-path physics: props, race walls, ramps and the press's plates are prisms of one store met by the face a
 * body entered, torn parts and wheels are rigid bodies that topple and slide by their points, a loose part's pose leaves the wire, so a
 * replayed clip's cars near a solid and its debris move differently; 52: the car's cage is baked and fitted by the sim alone, on every step of
 * a crush window, and a wreck's solver state ends with each cluster's skin fit, the cage's flags and its refit history (`CarCage`
 * `stateSize`), and a keyframe's flight block also carries the weight borne on a car and what its wheels touch (`FLIGHT`), so a clip
 * recorded before replays the cars' tops, and what stands on them, otherwise); 53: a circle prism (a palm's trunk, a lamp post) is met by the
 * face the footprint entered only when it crossed it within `ENTRY_WINDOW`, else by the way it is nearest, so a replayed clip's car sliding
 * past a trunk is no longer carried through its own length by the walk back); 54: Stage 4 item 5 (car-car through the kernel): car pairs meet
 * through the one body-contact kernel and every contact of a slice is solved once (no repeated SAT passes, no mass-on-mass sphere pass), so a
 * replayed clip's cars in contact move differently; 55: the pair pass splits its push-out by the kernel's inverse mass and a car's push
 * budget reads its own speed, so a replayed pile's wrecks move differently; 56: Stage 5 class balance (truck grip 41, truck brake 27,
 * monster brake 26), so a replayed truck or monster brakes and corners differently; 57: Stage 5 rear stroke gain 1.08, so a replayed
 * car hit in the tail crushes deeper; 58: a crashed car on its tyres with its pedal held drives instead of sliding, and a police car
 * that stands still 8 s is put away, so a replayed wreck or stalled cop moves differently; 59: a Survival hunter creeping beside a
 * stopped player car is read at its own speed and a drop-in may reuse an in-view wreck, so a replayed Survival pack moves differently; 60: a car
 * standing on another's top within the surface store's reach is not a plan hit, so a replayed stack moves differently; 61: a wedged
 * traffic car backs off, so a replayed city race's traffic moves differently; 62: 60's standing rule is withdrawn, so a replayed
 * stack moves as it did at 59; 63: a wrecked Survival cop stops driving and a cop brakes in time to stop beside a stopped player car;
 * 64: the derby is fought in the new arena (baked rises, prism wall and props), so a replayed derby moves differently; 65: the wreck
 * split (Stage 4 item 6): a wreck's pose is its rigid body's, its keyframe carries whether its cage refits exactly, and its cage keeps
 * the crushed nose and tail lip, so every replayed crash after the first hit moves differently; the derby's jumps and pit stand 0.5 m
 * further in, and a guarded racer is off the gas while it brakes and brakes for any closing past a nudge once inside the contact zone;
 * 66: a body point near a car top is read only when it could reach that top or a solid within the slice, so a replayed pile-up's slices
 * are cut finer at other moments; 67: a wreck's torn parts and popped wheels are stepped once per slice (they were stepped twice, so
 * their debris moved at twice sim time), so a replayed wreck's debris falls and slides at half the rate it did; 68: a crashed car nobody
 * drives rolls on its drive's idle pedals (it rolled with no tyre friction), the wreck gate and the tyre footprint count props, walls and
 * rigs under a point, a car's roof grid follows every refit of its cage (an opened lid or risen roof reaches the tops gate), and a popped
 * wheel launches from a once-per-slice spin; 69: a wreck at rest sleeps (its rigid step skipped until a moving car, an applied pedal, a
 * written velocity or a moved solid wakes it; a keyframe carries its rest timer) and a quiet step takes the 1/120 slice unless a crush
 * window is open, so a replayed pile settles and steps differently; 70: a car taken out of the world leaves no roof behind (a resting
 * loose part was woken by the roof of a car the step's list had dropped); 71: a fleet car's spawn keeps its whole straight path clear of the lamp
 * posts, past the centre to the far side of their ring (`layoutFleet` rejects more bearings, the lone car spawns between two posts and the last-resort
 * ring steps off the post lines), so the spawns of a seed differ; 72: a pair's contact axis lying within 17° of square to its centre
 * line (wrecks interlocked past the outline's reach) is the centre line pointing apart, where it took its sign from a few mm of centre offset
 * (a pile's pairs flipped it every slice and were pushed 6 mm to and fro), so a replayed pile's push-out goes along the centre line;
 * 73: a held reset leaves the parts and wheels already off a car where they lie (it threw them again from the new spot) and a car's net
 * skin inputs follow the state written to it (a second hold crushed the body flat), so a replayed clip's held reset moves its debris and skins differently;
 * 74: the start/finish seam of a looped course is smooth (four-count's start node was banked 8° over unbanked neighbours, the road's
 * edges 1.4 m up and down across the chequers; the builder now refuses a bend there), so a car crossing four-count's line replays on a level road;
 * 75: a torn part leaves with the car's spin (its velocity is the car's plus ω × r about the body's centre of mass, its angular velocity the car's plus the tumble),
 * so a replayed clip's debris torn off a turning car flies and lands elsewhere.
 * 76: a drift held on the gas with the wheel in the deadband holds its body angle (it was caught at the release rate) while the car is yawed past
 * 0.12 rad of slip, and a brake press catches any held drift, so a replayed clip's drifting car released to 0 steer slides on and a braked one is caught.
 * 77: a bumper hung by one corner rests on the road under its free end (it was rolled up to 34° whatever the road, 0.4-0.6 m under it), and a
 * bumper torn off leaves in that pose, so a replayed crash's hanging and torn bumpers start above the road and fly differently.
 * 78: a police car is put on the road, and put away, only out of every racer's sight (100 m or more from each, 200 m or more ahead of it along the road, 40 m
 * or more behind it, each with 20 m to spare) and a cop put on the road stays 12 s unless it is knocked out, stuck or 300 m from every racer, so a replayed race's stakeouts, reinforcements and stand-downs happen elsewhere and later.
 * 79: a police car put on the road already chasing (a reinforcement coming up behind its target) has its sirens on from its first frame, not a patrol beat (0.25 s) later,
 * and the director resets a stalled AI racer `STALL_WINDOW` (8 s) after it last gained `STALL_GAIN` (25 m) of track, not at the end of a fixed grid window (8 to 16 s after a pin), so a replayed race's pinned racers respawn sooner.
 * 80: a clip lists the sleeping wrecks woken in a step by something that moves coming near them (`ClipStir`), and a replay wakes each at that slice: a wreck beside the road
 * that a racer the clip leaves out drove past woke in the record and slept on in the replay, so its settling (millimetres in a step, then a pile's push-out) differed after it. A saved
 * clip's layout gains a count and the stirs after the knocks, so a clip of 79 or before does not decode.
 * 81: a quiet step is 1/90 s, one per 90 Hz frame (it was 1/120 s), and a step in contact is cut to slices of the 1/240 s floor (3 of 1/270 s), so a
 * clip saved at 80 holds steps of another length and a replayed crash lands on other slices (the 1/240 s crush-window steps are as before).
 * 82: the handbrake and a slide's entry fade instead of switching: the handbrake grips over 0.08 s and lets go over 0.12 s (a tap's short window never gets it to full),
 * a slide starts as hard as the inputs are past each gate, the yaw clamp hands over to the slide across drift 0.05-0.15, and the flight block holds the handbrake's grip and the boost's level,
 * so a replayed clip's handbrake flicks and slide starts run differently; and a respawn that falls due while another racing car is bearing down on its spot waits for it (up to 2 s),
 * so a replayed race's respawns land later where a car was closing.
 * 83: a pane a thrown dummy's torso strikes is applied to the car `LAG` (2) dummy-world frames after the frame it was struck in, in every mode (the
 * world runs in a worker on race courses and must answer at a fixed frame; the inline world used to apply it at once), and the dummies' world no
 * longer refits a car's cage (the sim's own fit is what it reads), so a replayed crash's panes shatter, and the contact points they leave, two frames later.
 * 84: a clip lists the sleeping torn parts and popped wheels woken by something that moves coming near them (`ClipPartStir`: runs of slices), and a replay wakes each at those slices:
 * a part beside the road that a racer the clip leaves out drove past stepped and settled in the record and lay still in the replay, so its pose differed after it. A saved clip's
 * layout gains a count and the part stirs after the stirs, so a clip of 83 or before does not decode.
 * 85: a keyframe's flight block carries whether the car's engine runs, and a car whose engine a guard's gunfire killed (the National Mall's
 * White House lawn, `LawnGuard`) is keyed in that step, so a replayed car shot dead stops where it did; and a side street's straight run
 * is stamped into the ground as one segment (a street's end stops at its round cap), so 40 road-edge cells of the National Mall's ground and 16 of Havana's take the other street's surface.
 * 86: a car whose engine a guard's gunfire killed is a wreck like a crash's kill (`DeformableCar.disable`: its masses armed, `crashed`, a dead drivetrain), so it rolls to a stop on dragged wheels
 * and sleeps at rest, where before it kept its speed for as long as the run lasted; its kill is keyed in its step by its own count (`DeformableCar.kills`, not `placements`), and the keyframe's
 * flight block no longer carries whether the engine runs (the wreck's section does), so a clip of 85 does not decode.
 * 87: the sim's inverse trigonometry (headings from `atan2`, a clamped rotation's angle from `acos`, the suspension's `atan`, the spawn layout's `asin`) is the kernel's `detAtan2`/`detAcos`/`detAtan`/`detAsin` in place of the engine's `Math` ones, which
 * differ in the last bit between Chromium and Firefox, so every heading the AI and the contact code read moves in the last bit and a replayed race drifts from a clip of 86 or before.
 * 88: the National Mall's course file gains a rim of 154 `building` blocks round its city (Survival's closed arena; the race meets them too), so a clip recorded on it at 87 has
 * a prop list (and keyframe knocked-prop bits) of another length and a replayed car meets blocks the record never had.
 * 89: a clip lists the guards a car in it ran down (`ClipStrike`: the National Mall's White House lawn), and a replay throws each again as a ragdoll at that step: a guard a car ran
 * down is a thrown figure, not a pose, so a replayed run past the lawn shows it. A saved clip's layout gains a count and the strikes after the part stirs, so a clip of 88 or before does not decode.
 * 90: a quiet step is 1/80 s (it was 1/90 s since 81): a step in contact is three slices of exactly 1/240 s (not three of 1/270 s, which made a crowded race 270 slices a second against
 * 240 at 1/120 s), and a quiet step is one slice up to 13 ms (it was 12), so a replay of a clip of 89 or before steps and slices a crash on other lengths.
 * 91: a clip carries the course's guard squad (`ClipSquad`: the National Mall's White House guards): its state at the clip's start and its decisions (alarm, target, each shot, each guard run
 * down) per step, and a replay steps a squad from them and draws the standing guards, their run out of the doors and their fire (a clip recorded before showed no guard until a strike threw one). A saved
 * clip's layout gains the squad after the strikes, so a clip of 90 or before does not decode.
 * 92: a keyframe carries where each torn part and popped wheel of a car lies and how it moves (a loose block in front of the car's solver state: its pose, velocity, spin, sleep, dents), and a replay puts it back
 * there; it threw every part the car had off before the clip's keyframe off the car afresh at the clip's first step (a car whose hood, doors and bumper lay on the road began the replay with them flying round it).
 * A saved clip's keyframes gain the block, so a clip of 91 or before does not decode. The same version: a clip lists the car the course's VIP rides in (the National Mall's Konami secret) at its start and each change
 * (`ClipVip`, after the squad), and a replay seats him in that car's passenger seat and throws him with its driver as the live race does (a clip recorded before had no VIP in a replay, whatever its race had).
 * 93: a wreck leaves a free-standing solid (a rail, a container, a pad, a prop) round the end its car's centre stands beyond when that is nearer than its car-side face (`ContactBox.openEnds`), so a corner
 * that came in round a rail's end is pushed out a few millimetres, not the rail's whole width: a replayed derby of 92 or before moves its wrecks differently from the first such grind.
 * 94: a wreck at rest lifts its body points in the world's ground (a crushed sill or fender the crush drove down, closing on nothing) out by their depth, at most rest speed a slice, whatever carried them there (it
 * rested 4-19 cm in the road on them), so a replay of a clip of 93 or before rests its wrecks at other heights.
 * 95: a wreck whose engine a side hit cut (`stalledS`: nobody drives it, its tyres are dragged) keeps its own spin when its contact window closes: the rule that zeroed a wreck's spin
 * there held for every wreck with a live drivetrain, so a replayed side-hit wreck turns on, slowing on its dragged wheels, where it ran on straight at its speed with the spin gone;
 * a clip of 94 or before replays such a wreck differently.
 * 96: a rear hit's push on the engine block counts as the drivetrain's travel only within `PACK_QUIET` of the hit's start (it counted at any time while something touched the car), so a car hit
 * from behind and touched later (a wall, a pusher, a ramp's flank) on a bank no longer reads the awakened lattice's set as 21 mm of crush: a replay of a clip of 95 or before reads that car's drivetrain health differently.
 * 97: a mirror of a wreck lying on its side or roof (up below `UPRIGHT_UP_Y`) that its rest box puts into the ground is torn off (`CarParts.mirrorUnderGround`), and lies on the ground as a loose part (it
 * stood 0.2-0.5 m into it, drawn on the door); a replay of a clip of 96 or before keeps that mirror on the car, so its keyframes' parts and the wreck's loose bodies differ from the first such landing.
 * 98: a side hit's fuel cut (`stalledS`) removes the gas and the boost and nothing else: the drive's tyres, brakes, handbrake and lift-off engine braking run through the stall (it ran no drive, its wheels dragged), and the
 * spin exemption of 95 is gone, so a stalled wreck's tyres own its turn as a running car's do; and a crashed car in contact takes the sliding friction of a locked tyre (`CRASH.muSlide` · `FRICTION_G`) as its
 * sideways bite, not the arcade grip, the arcade grip fading back over `CONTACT_WINDOW` after the last contact, for every car: a replay of a clip of 97 or before moves a side-hit car, and any car struck
 * sideways or glancingly, differently from its hit on.
 * 99: the engine's pull is the class's launch pull, then constant power tailing off through every gear (`enginePull`, `ClassStats.launch`/`power`; it was a fixed thrust per gear bucket stepping
 * down at each shift); the road takes it through the driven axles' traction for the class's driveline (`tractionLimit`), the excess spinning the wheels (`drive.spinSpeed`, state in the flight
 * block) and fading their sideways grip; each surface drags by its rolling resistance (`Surface.roll`) and the flat off-road speed cap (`Surface.speed`, `onSurface`) is gone: a replay of a clip of
 * 98 or before drives every car off its recorded line, off the road most of all.
 * 100: a held slide's hands-off hold fades out over a deadband of stick past `DRIVE.driftDeadband` (`held`) instead of switching off at its edge, so a slide steered out of the hold yaws
 * differently from the slice the stick crosses 0.1: a replay of a clip of 99 or before drifts its cars off their recorded line past that crossing.
 * 101: a hands-off slide under the slip gate (`DRIVE.driftHoldSlip`) aims straight in proportion to its angle instead of jumping back to the steered angle (the body bounced off the gate,
 * kicking the yaw rate seven times as a gentle slide unwound), and the AI asks for a target as its share of the class top alone (the terminal divisor over-asked on grass and sand):
 * a replay of a clip of 100 or before unwinds its hands-off slides and drives its AI on soft ground off their recorded lines.
 * 102: a wall's push-out puts a car back along the face no further than it moved along it in the slice (a car turned into a face at rest slid 0.45 m a frame along it); no drive from the
 * tyres while the body is on its side or roof (`FLIPPED_UP_Y`); a racer meeting a car head-on rounds it on the side with more road, not the side nearer its planned lane; the light bar tips
 * about its far mount with the struck side lifting (its cage pose with it): a replay of a clip of 101 or before moves wall-pinned, flipped and head-on cars and struck light bars differently.
 * 103: the race AI plans every stop at the contact guard's 0.72 of the class brake (`BRAKE_SHARE`; the plan counted on 0.5), the guard takes a car ahead to shed the whole class brake (it was the plan's share), easy's `push` / `slipBrake` are retuned, and a racer rounds a stopped, crawling or oncoming car on the side with more road
 * (`blockerAlong < CRAWL`; it was `< 0`): a replay of a clip of 102 or before drives its AI racers' braking, guard, and so their lines and speeds, differently.
 * 104: easy's corner `push` is 0.78–0.86 (it was 0.76–0.84): easy's oval winner runs about 10 % behind hard's, not 13 %. A replay of a clip of 103 or before drives its easy racers' corners differently.
 * 105: the tyres' drive (the yaw and velocity change `applyDrive` gives) fades with how far the surface under the wheels in contact carries the car (`standingBite`: nothing as the surface turns edge-on to the tread, a car on its side or roof, or to a wall that bears no weight, whole once it is within 65° of the wheel's under-axis) where 102 cut it dead below a body up·world-up of 0.35: a replay of a clip of 104 or before drives a car leaning or part-way over (up·world-up 0.35 to 0.42) or banked past 70° differently.
 * 106: the derby arena is rebuilt (a 12 m concrete-and-glass wall where it was 10 m, four bowl ramps at the wall rising 2.5-3.0 m, a 12 x 12 x 2.2 table-top, a pit plateau, the props re-laid, the spawn ring skipping the ramps, every prism reaching 3.36 m below the floor) and a wreck's seat step on its cell
 * keeps its world-vertical part by 1 - sin⁴ of the body's tilt (`followGroup`: whole upright or roof-down, none on the side or nose, where a body axis is the world vertical and the step sank the wreck 4-5 mm a step against the floor, 0.9 to -4.4 m in derby seed 8): a replay of a clip of 105 or before plays on different derby ground and moves a tilted wreck in contact differently.
 * 107: a thrown driver keeps the car's vertical velocity (`v.y = pre.y + THROW_UP`, it was the constant pop; the watch's velocity ring stores y), so a car leaving a ramp or kicker throws its driver along its climb; flat-ground throws are as before. The range's mini games add a forced throw
 * at a ramp's lip (`EjectionWatch.throwDriverNow`), which no other scene reaches: a replay of a clip of 106 or before throws a driver out of a car moving up or down (derby jumps, ramps, slopes) differently.
 * 108: a body coming down onto a solid prism's top (a derby tyre stack, K-rail or container) lands on it: its plan footprint no longer shoves it out of the overlap, its fall stops and it rises by the slice's fall plus the push-out speed (`cameThroughTop`, shared with the points'
 * top entry); it was shoved 0.4-1.3 m sideways the step its lowest point crossed the top: a replay of a clip of 107 or before moves a car or wreck landing on a prism top differently.
 * 109: a wreck on or against a solid prism (a derby tyre stack, K-rail or wall) is no longer pushed out of its whole plan overlap in one slice: the footprint's over and sunk shoves are capped at the wreck's own arrival into the face plus the push-out speed, masses
 * standing within a skin of the top are not held on the face, and a landing stops the wreck's masses' fall with its body's (it was shoved 0.4-1 m in a slice). A wreck lying on its roof takes no world-vertical part from the seat step (it sank into the floor at up to 0.28 m/s):
 * a replay of a clip of 108 or before moves a wreck at a prism or on its roof differently.
 * 110: a step cut to fine slices for contact cuts only the cars in contact: a car with no hit about to land, no crush running, no body contact and no other car within 5.3 m (7.07 m of a sleeping wreck) + 1 m + both cars' travel over the step runs the step as one
 * slice of its whole length (`World.loners`), as a car of a quiet step does, instead of 3 slices at 1/240 s; a clip carries each step's lone cars (`HighlightClip.lone`, after the step schedule) and a replay runs them as recorded: a clip of 109 or before no longer reads.
 * 111: a derby car's wear limit is `DERBY_WRECK_ENERGY / DERBY_WEAR_GAIN` (250 / 1.35 m²/s², so every hit wears 1.35 times what it did): a derby wreck's drivetrain dies sooner and its drive and handling grade with it; race, fleet, survival, range and the
 * sandbox arm no wear limit and are unchanged: a replay of a clip of 110 or before of a derby drives its wrecks' drivetrains out differently.
 * 112: a clip records the epicenter activation it ran with (`HighlightClip.epicenter`: a flag byte, then the knobs' values when it was on) and a replay runs under it; with it on a wreck that has sat quiet past `relockHold` is frozen (its masses ride the car's frame,
 * no solve, no frame re-measure), which moves it within a few millimetres of where the whole solve leaves it: a clip of 111 or before no longer reads (layout).
 * 113: the epicenter activation's knob list gains `thawHold` (seconds a thawed wreck waits before it may freeze again; 0 is the behaviour of 112), an eighth value after `frozenCheck` in a clip that ran with the activation on: a clip of 112 no longer reads.
 * 114: a clip's epicenter byte is the NUMBER of knob values that follow (0: `whole`), not a flag: a knob added later takes the end of the list with its off value as the default, so a clip recorded before it reads that knob as off and replays as it recorded, and adding one needs no new version; a clip of 113 no longer reads (the byte was 1 for any knob count). `feedMin` (metres of crush a frozen car's resting contact may feed in a slice before it thaws; 0 is off, as 113) is the ninth value.
 * 115: a quarter panel a hit has folded takes contacts as soon as the step folds it (`hitPanel` gates on `folding`, the sim's, not on `open`, which the frame's pose set on the first drawn frame after the fold): a car no frame ever drew (a replay re-simulated
 * headless, a hidden tab) now meets a striker's panel contact, and a drawn car meets it from the folding step instead of from the next drawn frame: a clip of 114 or before no longer reads.
 * 116: the police light bar folds about a hinge line along its base across the car (the roof lattice's image of the rest hinge edge, on the edge the struck end's inertia sends it toward; `BAR_FOLD` 0.45 rad times the hinge value, the free edge up at most
 * 7.5 cm) where it turned about one foot along the car with the far end rising up to 0.35 m, so its cage pose, and the contact shape over a struck police car's roof, differ: a clip of 115 or before no longer reads.
 * 117: a wreck's solver state in a keyframe carries the epicenter freeze (nine more doubles: `frozen`, `frozenReady`, `sinceThaw`, the cached centre and inertia), so a clip whose first keyframe finds a wreck frozen replays it frozen,
 * bit for bit, instead of whole (15 m of pose error after a second crash beside it): the solver state is nine numbers longer, and a clip of 116 or before no longer reads.
 * 118: the epicenter freeze keeps a wheel hub that stands more than 0.3 m off its pinned frame place at the freeze slice (`HUB_PIN_MAX`; it was re-derived from its world place, up to 1.5 m off on a spinning driven wreck, and its wheel was drawn there):
 * a clip recorded with the epicenter on replays its frozen wrecks' hubs differently; with it off nothing changes. A clip of 117 or before no longer reads.
 * 119: a circle collider placed at uneven x and z scales is an ellipse of circles inside the drawn shape (the National Mall's WWII basin, 160 x 48 m, was a 160 m circle): a clip recorded on the
 * Mall that met the old circle north or south of the basin (up to 112 m past its drawn edge) replays without that wall. A clip of 118 or before no longer reads.
 * 120: a wreck at rest rises out of ground it is sunk into through the contact solve's own speed bias (a third of `REST_SPEED`) instead of a positional lift of 1.2 mm a
 * slice: a wreck resting on a sunk sill no longer hops at 21 Hz, and rests and sleeps earlier. A clip of 119 or before no longer reads.
 * 121: a pair of cars that no longer closes gets no crush stroke to absorb its overlap (`resolveCarPair`'s give applies only while closing): two cars that stopped 10-21 cm
 * inside each other are pushed out to the outlines' 2.5 cm. A clip of 120 or before no longer reads.
 * 122: a thrown driver's arms swing down and his elbows and knees bend in flight; he grips pads, roads and ramps like cloth on asphalt (0.6), so he slides less there, and
 * rests about 5 m farther on the range sand; the driver's exit pane breaks in the step that throws him, live and in a replay alike. A clip of 121 or before no longer reads.
 * 123: a contact at 1.5 times the EBS a wreck's hit armed at (`HARDER_HIT`) re-arms the hit inside `REARM_QUIET`, so a door graze no longer sizes the nose hit that follows it
 * into a pile; a pair contact wakes its cars only while it closes faster than rest speed, and a sleeping wreck wakes only at rest speed or when stirred. A clip of 122 or before no longer reads.
 * 124: a crushed node springs back min(0.08 m, 0.015 + 10 % of its crush) and in shape mode the set moves the clusters' rest, so dents stay (75-90 % of peak); a head-on pair
 * stops at 0.9 of its stroke (the crossing slice's exchange is split); a frozen wreck resting on a barrier takes no slab exchange and goes quiet; glass cracks or shatters from its
 * frame's distortion (windscreen 5 / 30 mm, tempered 30 mm) and a shattered laminated windscreen stays in the contact cage. A clip of 123 or before no longer reads.
 * 125: a wreck's body seats on its cell's rest plus its earlier hits' damage, so a kept cabin offset no longer walks a tilted wreck into the ground. A clip of 124 or before no longer reads.
 * 126: only a fixed solid's slow face counts as a wreck resting on it; a press plate or piston pushes however slowly it closes. A clip of 125 or before no longer reads.
 * 127: ramp side contact asks the points the rigid step carries (`loadPoints`): a torn-off lid's parked vertices are no longer points and a wreck's belly follows its crushed
 * cage, so a wreck beside a ramp flank takes no phantom side hits. A clip of 126 or before no longer reads.
 * 128: a keyframe's flight block carries where a sleeping wreck fell asleep (`sleepX`, `sleepZ`), so a restored sleeper is stirred in the step the live one was. A clip of 127 or before no longer reads.
 * 129: past the crush window a seat step of 1 mm or more re-bakes the skin and contact cage (fitted exactly), so a side-struck car's body and cage follow its cell back out;
 * a shape-rest rebase no longer resets the drawn cluster maps. A clip of 128 or before no longer reads.
 * 130: a keyframe's loose block carries each torn part's box (middle and half extents), so a restored part flies as the box it tore as, not its shell drawn on the keyframe's
 * skin. A clip of 129 or before no longer reads.
 * 131: a keyframe's flight block carries each drawn wheel's turn and rate (`wheelSpin`, `wheelRate`), so a wheel popped in a replay leaves at the turn the live one did. A clip of
 * 130 or before no longer reads.
 * 132: a gone windscreen no longer opens the roof header in the dummies' world (a lying pane's top-edge nodes stay roof), so a thrown dummy meets the roof the player sees. A clip of
 * 131 or before no longer reads.
 * 133: a crush sets only within `CONTACT_HOLD` of a loading contact, so a wreck's sets no longer ratchet on (set, rest shift, seat) after the face lets go. A clip of 132 or before
 * no longer reads.
 * 134: a wreck meets a wall or solid prop with its masses' face spheres, not only its drawn body, so a wreck closing slowly into a face is held every slice instead of coasting
 * its bumpers 0.2 m into it. A clip of 133 or before no longer reads.
 * 135: a wreck resting on a face (masses on it, no contact within `CONTACT_HOLD`) keeps the face's push on its struck half out of the free shape step's centroid restore, so it
 * springs off the face instead of walking into it. A clip of 134 or before no longer reads.
 * 136: every thrown driver leaves with a slight roll about his line of flight (`EJECT_ROLL` 0.5 rad/s), live and in a replay alike. A clip of 135 or before no longer reads.
 * 137: a just-thrown dummy hits other cars' dummies from its first frame (only a dummy thrown from the same car is ignored for its first 0.35 s), so two drivers thrown at
 * each other in one head-on meet over the cars. A clip of 136 or before no longer reads.
 * 138: a wreck a solid's face shoves out by position while the face's exchange holds nothing (its drawn body round an open end, no mass on the face) stops driving into
 * the face, so it no longer keeps a phantom speed into a monument's corner that a pair contact reads. A clip of 137 or before no longer reads.
 * 139: 138 withdrawn: its rule also stopped cars hitting a monument head-on with almost no crush (a sedan at 55 m/s kept 1 mm against the slab's 0.50 m), so the sim is 137's
 * again. A clip of 138 or before no longer reads.
 * 140: 138's rule again, only where the shove leaves round an open end (the one way `strikeCar` cannot hold); a monument's narrow tip slice a head-on car drives through no
 * longer stops it. A clip of 139 or before no longer reads.
 * 141: a pair push back against a car's full net translation for the slice is granted, not refused by the rounding of a full budget; the sill (skin below the arch top
 * between the axles, beyond the arch plant) follows the cell's clusters, not the nose's, so a frontal crush no longer swings the drawn rocker into the front tyre, and the
 * cage's sill and floor change with it. A clip of 140 or before no longer reads.
 * 142: the skin's fit rest takes each kept set as the clusters' rest does, so a kept dent moves the paint once, through its parent masses: the drawn body and contact cage
 * over a dent no longer over-read it (a 50 km/h frontal's door frames read 22 mm, not 34, so their glass stays whole), and keyframes carry each mass's skin rest. A clip
 * of 141 or before no longer reads.
 * 143: a wreck's hull carries sill-underside samples between the axles where the lattice can bend the sill (24-25 a style), so a wreck rests on its bent sill instead of
 * a straight span drawn 16-20 cm under it. A clip of 142 or before no longer reads.
 * 144: a car put on a spot (respawn, start, held reset) drives from rest: every drive field goes back to as built (steer, throttle, spin, drift, hold...), where before it
 * carried over from the car's last life. A clip of 143 or before no longer reads.
 * 145: a pair's plan SAT places each car's outline nodes through both cars' full poses (it took a level, yaw-only frame), at both ends of the heights where a node's
 * slanted band meets the other body, the deeper counting, and the contact point through the container's full pose, so a pitched car's raised end overhanging its
 * plan is met as deep as it is (a 27° pitched monster's tail read 0.22 m shallow) and a raised tail over a cab is no contact. A clip of 144 or before no longer reads.
 * 146: a pair's crush gives room only from the stroke of the face it presses on, and only while the pair closes faster than `REST_SPEED` (a nose hit's stroke no
 * longer holds off a push on the tail, nor a resting pair's creep its overlap), and a wreck a fixed solid held out in the slice before takes no share of a pair push
 * into that solid (the other car takes it all); a keyframe carries that hold. A clip of 145 or before no longer reads.
 * 147: a wheel arch's skin lets go of its hub as a crush drives it off its plant (held whole at the plant, not at all past 0.15 m of plan travel), in the drawn skin
 * and the cage, so a nose crushed back past the front tyres no longer runs through a planted arch lip. A clip of 146 or before no longer reads.
 * 148: a dummy thrown from a car collides with the dummies thrown from that car in their `GRACE` (a passenger with his driver), as with any other car's: at a
 * real spawn (0.5-1 m apart) the pair reads the same as with the exclusion, and a later dummy now meets an earlier one lying in its way. A clip of 147 or before no longer reads.
 * 149: a fixed solid that shoves a wreck's drawn body out also stops the body's turn sweeping that body's deepest vertex into its face (the rigid plastic
 * impulse at that vertex): the centre's closing, which `strikeCar` reads, misses it, and a wreck turning on the spot had its nose shoved 5 cm out of a tyre stack every slice. A clip of 148 or before no longer reads.
 * 150: the range's sand is ground like any other to a dummy (`GROUND_GRIP`, not a friction of 3 under the Max rule, whose pull at a planted forearm's edge spun the
 * arm 160 rad/s in a step and sank it 5-11 cm), so a range throw lands, slides and rests shorter. A clip of 149 or before no longer reads.
 * 151: a thrown driver leaves with his seat's velocity as the hit began (the car's centre velocity plus its turn rate, eased pitch and roll included, about his
 * point; the watch's last sample before the hit, not the peak-closing one up to 0.35 s earlier), and the 3 m/s push out of the pane follows the car's nose in 3D;
 * the range has a 15 cm lip before the barrier (`RANGE_GROUND`). Every throw anywhere leaves differently. A clip of 150 or before no longer reads.
 * 152: a torn panel's contact keeps its bounce (`RESTITUTION` of the closing on every pass of the solve, which took the first pass's back) and scrapes at the
 * body's `MU_BODY`, not a locked tyre's μ times the tyre grip (a popped wheel keeps the tyre's contact); and it flies in the wind as a flat plate (`blow`: the
 * relative wind's normal force at its centre of pressure, and the uplift on a sheet lying on a surface), so a panel sliding flat at 31 m/s lifts and tumbles
 * within 0.25 s and one meeting a kerb at 15-21 m/s bounces back with a fifth of its speed. A clip of 151 or before no longer reads.
 * 153: a race cop whose pack gave up takes up the nearest racer still racing within 45 m (a still-parked one: a racer passing its spot), never the one its pack
 * gave up on. With none, it is put away only once no player can see it (outside the local camera's view or behind a solid, out of every netplay peer's racer
 * sight; stopped, or clear of every racer's near range plus the margin), where before it stayed until every racer's sight let it go or it was 75 s old and braked
 * to a stop. Every put-away is judged this way, the stall recall's included, and the race's patrol runs on after the finish. A clip of 152 or before no longer reads.
 * 154: a car that leaves a solid's face (a course wall, a prop) no longer keeps the face's last count of its masses on it: each world slice drops the count
 * before its course pass, so the free shape step stops holding the struck half against a face that is gone (a wreck rolling back off a wall rested 7 cm
 * further off, pushed 7 mm a step). Every car that leaves a wall moves differently. A clip of 153 or before no longer reads.
 * 155: a torn part or popped wheel resting on two points (a bumper across two wreck tops) sleeps once it has rested a second under rest speed; on three or
 * more it sleeps at once as before. A keyframe's loose block carries each body's rest time (one number more). A clip of 154 or before no longer reads.
 * 156: a sleeping torn part or popped wheel is stirred only by the roof of a car that moves, as a sleeping wreck is: beside or on a resting wreck it sleeps
 * on, where it had stepped every slice and crept (up to 8 mm a second). Every part that lies near a resting car moves differently. A clip of 155 or before no longer reads.
 * 157: the driver sits on the car's left (`DRIVER_SIDE`, car-local +x; he sat at -x): a driver thrown out of the windshield leaves 0.25 m to +x of the
 * pane's middle, with his seat's turn velocity from there; the VIP rides in, and is thrown from, the -x seat; the derby AI's driver's door is the +x one,
 * and its reverse run-in aims 1.6 m out from a target's nose on either side (2.1 on the driver's). Every windshield throw and every derby car moves
 * differently. A clip of 156 or before no longer reads.
 * 158: a car's roof takes its imprint plane (the top other cars stand on, which the skin flattens to) only from a belly within 5 cm of the roof, above or
 * below; a car set down inside another (placed on its spot, or driven through it) no longer cuts the other's roof, pillars and upper sides to its own ride
 * height. A wreck's hub springs act along its body's up (they acted along the world's), and its hubs stay planted only while it stands on its
 * wheels: a wreck lying over or tumbling carries its hubs where its wheels are drawn (a monster on its side held them 0.4-0.9 m off, its
 * wheels drawn in the ground), and a door jammed open on a wreck lying over stands out of the ground under it. Every crash moves differently.
 * A cop knocked out near a racer is put away only once its body has stopped every way (it was by its plan speed at the slice's start): a race
 * with police puts its cops away at other times. Every car another car is set inside moves differently. A clip of 157 or before no longer reads.
 * 159: the car overhaul (every car to its reference design). Each car's soft-body rig is carried from the platform's onto its own body: its cages,
 * sensors and masses move with its own dims (axles, ends, width, floor, roof; hubs on its wheels), its roof, windscreen, rear-glass, bonnet and boot
 * cages fit its own panels, and every style's cage source follows its new shape (the sedan and police from their reference, wheel arches .405 → .375;
 * the monster and truck at their reference dims, with wheel tubs in the truck's bed; the wagon, coupe, pickup and hatchback reshaped; the muscle's and
 * pickup's bonnets spanning their panel seams). The hatchback and wagon drive as their own classes (hatch, SUV: mass, power, grip, springs, voice); the
 * muscle and truck stand on their true tyres and the truck no longer rides lifted. A tyre's footprint reads the ground at its own radius across its whole
 * drawn tread, and meets a solid's sides (a wall, the slab, a prism's flank) at four hub-height points through the shared crash path, giving over its
 * class's spring travel before the face holds it (a monster whose keel clears the slab stops on its tyres); the slab keeps each car off it by its own
 * box, a car on its side drags that side's tyres, and a wreck pressed into the ground stays awake until it is out. A lifted car (the monster) turns,
 * lands and is thrown about a centre risen by its sprung share of the lift (0.81 of the monster's 0.87 m), and a respawn re-attaches it there; as a
 * wreck its masses ride that centre too, and its fading lift as it lies over moves the centre without moving its momentum; a wreck at rest on a
 * tyre at the end of its springs rests on the stop (it fell onto it every other slice and never slept). Trunk
 * lids, hatches, the SUV liftgate and the pickup's drop gate swing on hinges: a rear crush pops the latch, a slam re-latches it, a hard stop, slam,
 * crush or hit tears it off (a loose lid weighs its car's share), struts raise a lid to its stop and a drop gate falls level on its cables; the
 * hatch's and SUV's rear glass rides its gate. The monster's tailgate drops on a hinge at its foot, as the pickup's does. Door glass ends 1 cm under its B-pillar's front edge; a mirror keeps its style's reach (sedan 0.157 m,
 * 0.25 m behind its hinge; hatchback 0.075, SUV 0.065; it stood at the platform's 0.21) through a reset and every crash pose; a sedan's torn bumper flies as the box of
 * everything it draws, its seam cover included; its seams no longer hook back over the wheel arches' tops, so each torn bumper's box is 6-7 cm shorter;
 * the sedan's door glass meets a thrown driver at its drawn front edge;
 * the sedan's hood ends at z 0.99; the police light bar sits over the B-pillars. A driver thrown out
 * of the windshield leaves from the pane's bowed middle (`userData.centre`, 1 cm further forward), each raked pane's top corners fall onto the roof's
 * dome (`domeFall`, about 2 cm), and the hatchback's windshield reaches its reference's glass top (17 cm further back, 8 cm higher) with its rear glass
 * base and tailgate top at .905, its roof rolling round into its side glass as the coupe's. The sedan's and police's tails end 3.5 cm wider. A car's collision cage keeps the underside it rests on out to its nose and tail lips (read once it is a wreck), so a
 * wreck that loses a front wheel rests on its lip instead of rocking 3-4 cm in the ground, and a car pitched over another meets it as deep as the two
 * cages stand. A thrown driver meets each pane as its glass's own quad, and breaks it only with a blow on its face: a door strike no longer
 * cracks the windshield. A sedan dropped on its roof keeps its rear glass (its fastback frame stands clear of the crushed roof). A wreck
 * struck again re-arms its hit on the slice's hardest contact, whichever touched first, and a graze too soft to arm no longer shuts the
 * window on the face behind it: a derby sedan's 25 km/h side hits wear its drivetrain out in 6 (each counted its graze's 8 of 36, or none).
 * A torn part flies as its drawn shell's own points (the shell point farthest along each of its box's twenty ways), not its box, where its
 * box leaves a corner empty: every torn part but the mirrors and the light bar. A bumper, door, quarter or arch no longer rests on a corner
 * where nothing is drawn (12-73 cm off its shell), and the keyframe carries each loose part's twenty points and its shell flag. A torn grille,
 * tail trim or mirror flies and collides as its style draws it, not as the platform part.
 * The coupe's flanks carry their widest line 5-9 cm under the belt from its tail to its door (its reference's haunch crest), its quarter sill dips
 * behind the door and rises to the window's point, and its roof's rear corner stands 2 cm wider.
 * A solid placed or rewritten where it already stands (a wall, the slab, a ramp or rig synced each step) stirs the wrecks near it only on the step
 * it changes: a wreck at rest beside one sleeps (it was woken every slice for good).
 * A popped wheel flies as a disk of its own tyre's width (the sedan's 0.22 m, the hatchback's 0.17, the monster's 0.364 before its wheel
 * scale), not the platform's 0.24 on every car.
 * A car's nose closing on another car's steep face (a sloped bonnet corner) faster than a crash, read against that car's own motion, is the pair's
 * hit: a head-on no longer arms on one corner at the rigid step's sideways reading (28 km/h each: 0.237 m of even nose crush, was 0.092 on one corner).
 * A pair that packs its noses stops at the packed stroke with the next slice's crush feed counted, not up to that feed past it (200 km/h
 * each: 0.904 of the stroke, was 0.916).
 * A door swings, is struck and is shut by a solid as its style draws it (its own length and inertia about its hinge, not the platform's),
 * a mirror is met at its drawn seat and heights and folds only until its tip clears the striker, a striker above a car's shoulder
 * meets the body only where it stands at those heights, and two cars side by side read each other's own mirror tips; a door's hinge detent
 * holds it against the same car-frame jostle whatever its length.
 * A tyre climbing a steep face pushes its car straight up only while that push lifts its tread off the face (else along the face): a monster
 * no longer leaves a kicker's lip, or a slope on one tyre, at over 100 m/s up, and every car climbs a kicker's last metres differently.
 * A wreck rising out of the ground counts its second of rest while it rises and sleeps once it is out: one sunk a few centimetres sleeps
 * as soon as it would on the road, one sunk deep stays awake until it is out.
 * A car's collision cage carries its bumpers' fascias, each a 12-point panel of its own past the body's budget, and a cruiser's push bar as one
 * box of its own riding its bumper's two masses (tow hitch and exhaust tips stay drawn only), so it meets cars, walls, figures and props at its
 * drawn bumper faces, 3-15 cm past its nose's and tail's sheet metal, until a bumper tears off; a pair's plan test reads a bumper at its own
 * heights, never its body's behind it; the piston rig's faces rest clear of them. A wall holds a cruiser's bumper particles a bar's reach (9 cm)
 * further back than a sedan's, so the bar's box is no deeper in the face than a bumper's is: its front wings crush as a sedan's do.
 * The tallest step a tyre mounts by grip, and how far under a prism's top a tyre still stands on it, is its own drawn radius's share (the
 * sedan's 0.342 m tyre 0.088 m, the monster's 0.614 m 0.158 m), not 0.140 m sized for the platform's tyre on every car; a point that names no
 * tyre keeps the biggest tyre's, and a tyre that landed on a prism's top counts it only within its radius.
 * A tyre rolling into a face it came in by meets it as a wall even within that mount, so a face whose top stands over a moving tyre's hub is never
 * climbed (a monster sliding sideways into the slab trips on its tyres and rolls over it, nobody thrown; off the long jump's crest it flies the slab
 * and keeps its driver in, thrown only when it arrives too slow to clear it), and a tyre climbs what it rolls onto over many slices, rising no
 * faster than its plan speed times its grip (a step no longer sets a car on its top in one slice). A car in the air clears the slab by its lifted
 * body, as a wreck does, and a striker under a lifted body meets its tyres, not a body edge standing over it.
 * A car's point at rest inside a wall, a slab or a prop leaves by the side its car stands on, not the nearest: a tyre that stopped past a thin
 * wall's middle was pushed on through the wall, and the drive pushing the car back out was read as closing on it, so a car pinned to a wall at
 * 0.1 m/s stayed there for seconds (a monster on a slab ends with its front tyres torn off and over it, where it stood on its nose with them in it).
 * A quiet wreck standing on its planted tyres has its hubs' springs critically damped (they were damped a little over a quarter of critical),
 * so a truck on three tyres comes to rest and sleeps instead of rocking on them for as long as it lies; every wreck's hubs settle a
 * centimetre or two off where they stood.
 * A lifted car's (the monster's) crash contact reaches its masses where they stand: a car-car hit's point, read off its lifted body, stood 0.8-0.9 m over
 * its nose masses, so it fed its bumper a thousandth of the crush and its engine none (a monster head-on at 40 m/s crushed 0.61 m and left its engine 0.42
 * healthy, where it crushed 0.84 m and killed it before the overhaul), and its plan contact reads its body's lift as drawn (faded as it lies over; it
 * stood at the whole 0.87 m up its tilted axis). Monster hits crush, kill, throw and push differently; a monster lying over meets cars where it is drawn.
 * A pair whose nose corners meet each other's sloped bonnet is one contact, taken whole by the pair: the rigid step's exchange at those
 * corners is taken back first, so an undriven 60 km/h head-on arms at its own closing (16.66 m/s, its engine blocks 0.165 m back; was
 * 15.70 m/s and 0.118 m).
 * A door a side hit presses onto its crush band's full depth keeps it (it is packed: nothing springs back), where it sprang 4 cm back once the face left.
 * A pair whose stop packs a nose counts that car's engine block travel as the hit's own energy (a re-armed hit's rule), not the geometric peak the
 * stop's slice leaves it (6-12 mm off with the phase): a sedan head-on's block travel now rises with speed through its kill window (56 km/h each:
 * 0.1579 m, was 0.1461 beside 0.1521 at 55.5 and 0.1511 at 56.5).
 * A killed engine block keeps counting its travel through the hit, so it reads the hit's peak rather than the kill slice's sample (a sedan at 55 m/s
 * reads 0.608 m into the slab and every wall, where it read 0.46-0.58 by the slice's phase); a car half over the end of a slab or a wall's hold face is
 * crushed only where the face presses it, not at the corner hanging past the end.
 * The press closes its plates 0.26 m inside the rails' rest in shape deform mode (0.06 m in lattice), where every car class folds its rails
 * past 0.2 m, not stalls at 0.183-0.199 m: a pressed sedan's rails fold 0.244 m, were 0.191.
 * A torn hatchback gate flies as its glass and spoiler only (its D-posts stay on the body); a torn SUV liftgate flies with its D-post shares as
 * closed pieces cut on one shared section and a flange under its slab.
 * A door cage's corners hang on the cabin (its masses and the clusters that hold the cell), not on the tail and axle a side hit's tyres hold back: a side
 * hit no longer shears the far door's frame by 5-6 cm (a 30 km/h side hit read 55 mm, now 18; its glass burst), and a 50 km/h wall hit racks a door's frame 12 mm, not 26.
 * A windscreen's frame hangs on the cabin as a door's does, its base corners with half of the nearest wing's give (the cowl, where the nose meets the
 * cabin) in place of the rails' and engine's: a 35 km/h wall hit racks it 4.3 mm, not 6.5 (the pane cracked), and a 50 km/h one 5.4 mm, not 24.5 (it still cracks).
 * A tyre meets a solid's side at both corners of each edge of its tread and, where an edge's corners read nothing, at samples 0.2 m apart between them: a
 * wall thinner than the tyre is long (the oval's 0.6 m) no longer stands between its corners while the tyre straddles it, so a monster's rear pair that rolled
 * through it at 56 m/s (two wheels still on, 24.9 m/s after the hit) is torn off at it (none left, 10.7 m/s). A point that came in by no face within the
 * entry window leaves by the side its car stands on, as one at rest does, not by the nearest face (a car's tyre deep in a panel it was rebounding from was put out through its far face).
 * A wreck's tyre springs hold its weight at the hubs where its hit has left them in its body (a planted hub keeps its place on the ground while the body is
 * driven back off it, and the body seats on it again over the next second), not at the stock wheel places: a monster's axles were loaded 1.3 % of its weight unevenly 1.2 s after a
 * 20 m/s hit, which the springs took up as a pitch the wreck kept if it fell asleep before it had seated (0.5° nose-off on flat ground, 2.2° on a 10° bank, more with a harder hit), now none (0.0° and 0.1°).
 * A torn part that flies as its shell takes the wind on the broad face it draws (the axis its drawn triangles face most), not its box's shortest axis, which
 * a bumper's wrapped ends and seam cover tie with its height within 2 mm: a sedan's, hatchback's or wagon's front bumper, a monster's rear one and a
 * coupe's front arches met the wind edge-on and lifted where they should brake. The keyframe carries each loose part's plate axis with its flags.
 * A torn part that flies as its shell is supported the same either side of its car's middle plane: the farthest point along a way tied between a
 * bumper's two lower front ends and one slot took one, so a sedan's, hatchback's or wagon's front bumper rested on a lone point and tipped forward end
 * over end at its first slide (73-85° in 0.4 s: 4.658 m where its box slides 4.39), where it now slides flat.
 * A loose point (a torn part's, a popped wheel's) more than a car's roof reach (0.25 m) under its top, inside its drawn plan and over its underside is in
 * that car's flank and is put out along the plan outline's normal, where it passed through any car whose top stood out of its reach (a door cage's 0.9 m
 * shelf): a bumper a car is driven into at 2 m/s is shoved 0.67 m (0.51 m riding the sill top; 0.002 m under the door cages, now 0.82), and one flying at
 * a parked car's door stops at its face, where it ended 1.02 m inside it.
 * A hit's centre follows the pair's patch for its first 15 ms and its snap to the nearest mass has no step at 0.2 m off the centre line: a T-bone's nose
 * no longer crushes 0.38 m or 0.74 m with where in a 1/240 s slice the first touch fell (now within 0.09 m), and a pair's crush spreads over a flat face.
 * A pair's hit armed on its first aslant touch of one corner (10.3 m/s, patch normal 26° off) takes over the face-on contact that follows within 15 ms
 * (13.5 m/s), keeping the crush it has taken: a T-bone's nose crushes 0.42-0.47 m wherever in a slice the touch fell, not 0.34 m (the stroke of the aslant arm).
 * A pair's first overlap no longer depends on the step it is first read in: a car under a lifted body that stands on its wheels meets it at its own heights
 * (the frame and wheels the cage does not draw), and a patch's height is held within the heights the crushing masses stand at, so a car hit into or by
 * a monster crushes alike a m/s faster, not 0.14 healthier on every third step (a sedan into a monster's tail, 29 -> 30 m/s: striker 0.69 -> 0.80).
 * Each car's nose packs to its own length ahead of its engine block, leaving the platform's 0.30 m of crumple on every body (the sedan's
 * was 0.287, the wagon's 0.318, the monster's 0.255, the hatchback's and pickup's 0.18), so a nose hit reaches the block and kills the
 * engine at the same speed whatever the car.
 * A car's two front doors are cage panels of their own while they hang latched (a sprung or torn door leaves it), so a side striker meets the drawn door's skin, not the sill and belt behind it.
 * A hood's and a trunk lid's heights in the cage reach a lattice step past their triangles (they reached half of one), so the drawn lid's wrapped nose and rolled edge, which stand 1-2 cm past the plain cage lid, have a cage under them: a tyre meets hood up to 5 cm past the lid's true edge.
 * A pair's patch reads every node of the other outline that reads a depth: the plan field's edge stands half a lattice step past the outermost node, beyond the drawn triangles' box that gated them, so a door's nodes
 * at a nose's edge joined the patch at once and moved its centre 2.1 or 11.2 cm in a millimetre of closing (a T-bone's door crushed 0.706 m or 0.753 m by 2 mm of start, now 0.750-0.753 m).
 * A pair tilted 30° to 150° against each other (a car on its side beside one on its wheels or on its roof) reads the plan overlap from every node of the cages with its own column, not from the outline's stretched band: a monster rolled 70° with a cop's nose in its roof read 0.253 m shallow (0.021 m against 0.274 m) and a one-level graze of the other's top counted as a contact up to 0.75 m deep, and now reads the cages' overlap to within 0.04 m; pairs tilted less (a car pitched 27° on a tier) or turned over flat read as before.
 * Every car crushes, tears, touches, throws its driver and comes to rest differently. A clip of 158 or before no longer reads.
 * A saved clip also records `NET_VERSION` (its snapshots' layout).
 */
const REPLAY_VERSION = 159;
/** Bounds a decoder enforces (a clip is ≤ 13 s at ≤ 300 steps/s, ≤ 15 keyframes). */
const MAX_STEPS = 8192;
const MAX_KEYS = 64;
/** The deflated size the recorder budgets a reel's clips to (`CrashRecorder`). A reel over it still goes whole, in `reelParts` frames. */
export const REEL_BUDGET = 240 * 1024;
const SAVE_MAGIC = 0x4c484353; // "SCHL"
const utf8 = (s: string): number => Math.min(255, new TextEncoder().encode(s).length);

/** A clip's ejection record: its step (u32), whether the scope owns it (u8), then `writeEjection`'s 2 + 22 × 4 bytes. */
const EJECTION_BYTES = 4 + 1 + 2 + 22 * 4;
/** A clip's knocked prop: its step (u32) and the prop (u16). */
const KNOCK_BYTES = 4 + 2;
/** A clip's stir: its step (u32), the car (u8) and the slice (u8). */
const STIR_BYTES = 4 + 1 + 1;
/** A clip's part stir: its step (u32), the car (u8), the body (u8), the slice (u8) and the slice count (u16). */
const PART_STIR_BYTES = 4 + 1 + 1 + 1 + 2;
/** A clip's strike: its step (u32), the car (u8), the guard (u8: 255 for the VIP, -1) and 11 x f32 (position, facing, velocity, spin). */
const STRIKE_BYTES = 4 + 1 + 1 + 11 * 4;
/** A clip's squad decision: its step (u32), kind, and its three operands (u8 each). */
const SQUAD_EVENT_BYTES = 4 + 4;
/** A clip's VIP change: its step (u32) and the car (u8). */
const VIP_EVENT_BYTES = 4 + 1;
/** A clip's scope hit: its time (f64), position (3 x f32) and cars (2 x u8). */
const HIT_BYTES = 8 + 4 + 4 + 4 + 2;

/** One lone step on the wire: its step (u16) and its mask (u32). */
const LONE_BYTES = 6;

/** The steps of `c` that ran lone cars. */
function loneSteps(c: HighlightClip): number {
  let n = 0;
  for (const m of c.lone) if (m !== 0) n++;
  return n;
}

/** Exact encoded size of `clip` (`writeClip`). */
export function clipBytes(c: HighlightClip): number {
  const nc = c.cars.length;
  let n = 1 + utf8(c.trackId) + 92 + (c.epicenter ? c.epicenter.length * 8 : 0) + c.cars.reduce((a, car) => a + 4 + utf8(car.name), 0);
  n += 4 + c.h.length * (8 + nc * INPUT_BYTES) + 2 + 2 + loneSteps(c) * LONE_BYTES;
  for (const k of c.keys) n += 12 + k.length;
  const squad = c.squad ? 1 + c.squad.state.length * 4 + 2 + c.squad.events.length * SQUAD_EVENT_BYTES : 1;
  const vip = 2 + c.vip.events.length * VIP_EVENT_BYTES;
  return n + 1 + c.ejections.length * EJECTION_BYTES + 2 + c.knocks.length * KNOCK_BYTES + 2 + c.stirs.length * STIR_BYTES + 2 + c.partStirs.length * PART_STIR_BYTES + 1 + c.strikes.length * STRIKE_BYTES + squad + vip + 1 + c.hits.length * HIT_BYTES;
}

export function writeClip(w: Writer, c: HighlightClip): void {
  w.str(c.trackId);
  w.f32(c.score);
  w.u16(c.impacts);
  w.u8(c.kills);
  w.u8(Math.min(255, c.ejects));
  w.u8(c.hit);
  w.f32(c.peakKph);
  w.f32(c.hitKph);
  w.f32(c.deform);
  w.f64(c.t0);
  w.f64(c.firstImpact);
  w.u32(c.firstStep);
  w.f64(c.lastImpact);
  w.f32(c.x);
  w.f32(c.z);
  w.u8(c.focus);
  w.u8(c.firstA);
  w.u8(c.firstB < 0 ? 255 : c.firstB);
  w.f64(c.realism);
  w.u8(c.bleed ? 1 : 0);
  w.f64(c.squash);
  w.f64(c.buckle);
  w.u8(c.deformMode === "lattice" ? 1 : 0);
  w.u8(c.epicenter ? c.epicenter.length : 0);
  if (c.epicenter) for (const v of c.epicenter) w.f64(v);
  w.u32(c.look);
  w.u8(c.cars.length);
  for (const car of c.cars) {
    w.u8(car.slot);
    w.u8(CAR_STYLE_IDS.indexOf(car.style));
    w.u8(VEHICLE_CLASS_IDS.indexOf(car.cls));
    w.str(car.name);
  }
  w.u32(c.h.length);
  // Each step's dt as the recorder's ring holds it (float32): whole microseconds moved a 2 x 20 m/s head-on's wreck 8 mm and its crush 10 mm.
  for (const h of c.h) w.f32(h);
  for (const s of c.shape) w.u32(s);
  w.u16(loneSteps(c));
  for (let s = 0; s < c.lone.length; s++) {
    if (c.lone[s] === 0) continue;
    w.u16(s);
    w.u32(c.lone[s]!);
  }
  w.bytes.set(c.inputs, w.off);
  w.off += c.inputs.length;
  w.u16(c.keys.length);
  for (let k = 0; k < c.keys.length; k++) {
    w.u32(c.keyStep[k]!);
    w.u32(c.keyCars[k]!);
    w.u32(c.keys[k]!.length);
    w.bytes.set(c.keys[k]!, w.off);
    w.off += c.keys[k]!.length;
  }
  w.u8(c.ejections.length);
  for (const x of c.ejections) {
    w.u32(x.step);
    w.u8(x.own ? 1 : 0);
    writeEjection(w, x.e);
  }
  w.u16(c.knocks.length);
  for (const x of c.knocks) {
    w.u32(x.step);
    w.u16(x.prop);
  }
  w.u16(c.stirs.length);
  for (const x of c.stirs) {
    w.u32(x.step);
    w.u8(x.car);
    w.u8(x.slice);
  }
  w.u16(c.partStirs.length);
  for (const x of c.partStirs) {
    w.u32(x.step);
    w.u8(x.car);
    w.u8(x.body);
    w.u8(x.slice);
    w.u16(x.slices);
  }
  w.u8(c.strikes.length);
  for (const x of c.strikes) {
    const s = x.s;
    w.u32(x.step);
    w.u8(s.car);
    w.u8(s.guard < 0 ? 255 : s.guard);
    w.f32(s.x);
    w.f32(s.y);
    w.f32(s.z);
    w.f32(s.faceX);
    w.f32(s.faceZ);
    w.f32(s.vx);
    w.f32(s.vy);
    w.f32(s.vz);
    w.f32(s.wx);
    w.f32(s.wy);
    w.f32(s.wz);
  }
  w.u8(c.squad ? (c.squad.state.length - 2) / 5 : 0);
  if (c.squad) {
    for (const v of c.squad.state) w.f32(v);
    w.u16(c.squad.events.length);
    for (const x of c.squad.events) {
      w.u32(x.step);
      w.u8(x.kind);
      w.u8(x.a);
      w.u8(x.b);
      w.u8(x.c);
    }
  }
  w.u8(c.vip.start);
  w.u8(c.vip.events.length);
  for (const x of c.vip.events) {
    w.u32(x.step);
    w.u8(x.car);
  }
  w.u8(c.hits.length);
  for (const x of c.hits) {
    w.f64(x.t);
    w.f32(x.x);
    w.f32(x.y);
    w.f32(x.z);
    w.u8(x.a);
    w.u8(x.b < 0 ? 255 : x.b);
  }
}

/**
 * One clip; throws RangeError on a truncated or out-of-range one (another build, a corrupt store, a hostile peer).
 * Every keyframe is decoded once against the cars' netplay layout `L` to check it.
 */
export function readClip(r: Reader, L: NetLayout): HighlightClip {
  const trackId = r.str();
  const score = r.fin32();
  const impacts = r.u16();
  const kills = r.u8();
  const ejects = r.u8();
  const hit = r.u8();
  const peakKph = r.fin32();
  const hitKph = r.fin32();
  const deform = r.fin32();
  const t0 = r.f64();
  const firstImpact = r.f64();
  const firstStep = r.u32();
  const lastImpact = r.f64();
  const x = r.fin32();
  const z = r.fin32();
  const focus = r.u8();
  const firstA = r.u8();
  const b = r.u8();
  const firstB = b === 255 ? -1 : b;
  const realism = r.f64();
  const bleed = r.u8() === 1;
  const squash = r.f64();
  const buckle = r.f64();
  if (!Number.isFinite(squash) || !Number.isFinite(buckle)) throw new RangeError("clip crumple");
  const deformMode = r.u8() === 1 ? "lattice" : "shape";
  let epicenter: number[] | null = null;
  const knobs = r.u8();
  if (knobs > EPICENTER_FIELDS) throw new RangeError("clip epicenter knobs");
  if (knobs > 0) {
    epicenter = Array.from({ length: knobs }, () => r.f64());
    if (!epicenter.every(Number.isFinite)) throw new RangeError("clip epicenter");
  }
  const look = r.u32();
  const nc = r.u8();
  if (nc < 1 || nc > MAX_NET_CARS || focus >= nc || firstA >= nc || firstB >= nc) throw new RangeError("clip cars");
  if (![t0, firstImpact, lastImpact, realism].every(Number.isFinite)) throw new RangeError("clip clock");
  const cars: ReelCar[] = [];
  for (let j = 0; j < nc; j++) {
    const slot = r.u8();
    const style = CAR_STYLE_IDS[r.u8()];
    const cls = VEHICLE_CLASS_IDS[r.u8()];
    const name = r.str();
    if (!style || !cls || slot >= MAX_NET_CARS) throw new RangeError("clip car");
    cars.push({ slot, style, cls, name });
  }
  const steps = r.u32();
  if (steps < 1 || steps > MAX_STEPS) throw new RangeError("clip steps");
  const h = new Float32Array(steps);
  for (let s = 0; s < steps; s++) {
    h[s] = r.fin32();
    if (!(h[s]! > 0)) throw new RangeError("clip dt");
  }
  // Each step's schedule (`World.shape`): 19 bits, the slice count − 1 and 2 bits of SAT passes per slice.
  const shape = new Uint32Array(steps);
  for (let s = 0; s < steps; s++) {
    shape[s] = r.u32();
    if (shape[s]! >>> 19 !== 0) throw new RangeError("clip step shape");
  }
  // The steps that ran lone cars (`World.loners`), each with its mask: bit j the clip's car j, so none above the clip's cars. A step in one slice and a step with none lone are left out.
  const lone = new Uint32Array(steps);
  const nl = r.u16();
  if (nl > steps) throw new RangeError("clip lone steps");
  for (let k = 0, last = -1; k < nl; k++) {
    const s = r.u16();
    const m = r.u32();
    if (s <= last || s >= steps || m === 0 || (nc < 32 && m >>> nc !== 0)) throw new RangeError("clip step lone cars");
    lone[s] = m;
    last = s;
  }
  const inputs = new Uint8Array(steps * nc * INPUT_BYTES);
  for (let i = 0; i < inputs.length; i++) inputs[i] = r.u8();
  const nk = r.u16();
  if (nk < 1 || nk > MAX_KEYS) throw new RangeError("clip keys");
  const keyStep = new Uint32Array(nk);
  const keyCars = new Uint32Array(nk);
  const keys: Uint8Array[] = [];
  const check = makeSnapshot();
  const kr = new Reader();
  const everyCar = 2 ** nc - 1;
  for (let k = 0; k < nk; k++) {
    keyStep[k] = r.u32();
    keyCars[k] = r.u32();
    if (keyStep[k]! >= steps || (k > 0 && keyStep[k]! <= keyStep[k - 1]!) || (k === 0 && keyStep[0] !== 0)) throw new RangeError("clip key step");
    // The first keyframe carries every clip car; a later one a nonempty subset.
    if (k === 0 ? keyCars[0] !== everyCar : keyCars[k] === 0 || keyCars[k]! > everyCar) throw new RangeError("clip key cars");
    const len = r.u32();
    if (r.off + len > r.length) throw new RangeError("clip key length");
    const key = new Uint8Array(len);
    for (let i = 0; i < len; i++) key[i] = r.u8();
    kr.reset(key);
    if (kr.u8() !== MSG.snapshot) throw new RangeError("clip key type");
    kr.off = 0;
    readSnapshot(kr, check, L);
    // Then the knocked props (a u16 byte count and the bytes), and per car its flight block, course memory and solver state (`encodeKey`).
    const knockBytes = kr.u16();
    kr.off += knockBytes;
    const here = keyCars[k]!.toString(2).split("1").length - 1;
    let j = 0;
    for (; j < here && kr.off + FLIGHT * 8 + MEMORY * 8 + 2 <= len; j++) {
      kr.off += FLIGHT * 8;
      // The course memory (`RaceField.remember`): the road segment its projection hint is on (-1: none).
      const seg = kr.f64();
      if (!Number.isInteger(seg) || seg < -1) throw new RangeError("clip course memory");
      const n = kr.u16();
      kr.off += n * 8;
    }
    if (check.count !== here || j !== here || kr.off !== len) throw new RangeError("clip key cars");
    keys.push(key);
  }
  if (firstStep >= steps) throw new RangeError("clip first step");
  const ne = r.u8();
  const ejections: ClipEjection[] = [];
  for (let k = 0; k < ne; k++) {
    const step = r.u32();
    const own = r.u8() === 1;
    const e = blankEjection();
    readEjection(r, e);
    if (step >= steps || e.car >= nc || (k > 0 && step < ejections[k - 1]!.step)) throw new RangeError("clip ejection");
    ejections.push({ step, e, own });
  }
  const nkn = r.u16();
  if (nkn > MAX_KNOCKS) throw new RangeError("clip knocks");
  const knocks: ClipKnock[] = [];
  for (let k = 0; k < nkn; k++) {
    const step = r.u32();
    const prop = r.u16();
    if (step >= steps || (k > 0 && step < knocks[k - 1]!.step)) throw new RangeError("clip knock");
    knocks.push({ step, prop });
  }
  const nst = r.u16();
  if (nst > MAX_STIRS) throw new RangeError("clip stirs");
  const stirs: ClipStir[] = [];
  for (let k = 0; k < nst; k++) {
    const step = r.u32();
    const car = r.u8();
    const slice = r.u8();
    if (step >= steps || car >= nc || slice >= 8 || (k > 0 && step < stirs[k - 1]!.step)) throw new RangeError("clip stir");
    stirs.push({ step, car, slice });
  }
  const nps = r.u16();
  if (nps > MAX_PART_STIRS) throw new RangeError("clip part stirs");
  const partStirs: ClipPartStir[] = [];
  for (let k = 0; k < nps; k++) {
    const step = r.u32();
    const car = r.u8();
    const body = r.u8();
    const slice = r.u8();
    const slices = r.u16();
    if (step >= steps || car >= nc || body >= LOOSE_BODIES || slice >= 8 || slices === 0 || (k > 0 && step < partStirs[k - 1]!.step)) throw new RangeError("clip part stir");
    partStirs.push({ step, car, body, slice, slices });
  }
  const nsk = r.u8();
  if (nsk > MAX_STRIKES) throw new RangeError("clip strikes");
  const strikes: ClipStrike[] = [];
  for (let k = 0; k < nsk; k++) {
    const step = r.u32();
    const s = blankStrike();
    s.car = r.u8();
    const guard = r.u8();
    s.guard = guard === 255 ? -1 : guard;
    s.x = r.fin32();
    s.y = r.fin32();
    s.z = r.fin32();
    s.faceX = r.fin32();
    s.faceZ = r.fin32();
    s.vx = r.fin32();
    s.vy = r.fin32();
    s.vz = r.fin32();
    s.wx = r.fin32();
    s.wy = r.fin32();
    s.wz = r.fin32();
    if (step >= steps || s.car >= nc || (k > 0 && step < strikes[k - 1]!.step)) throw new RangeError("clip strike");
    strikes.push({ step, s });
  }
  const squad = readSquad(r, steps, nc);
  const vip = readVip(r, steps, nc);
  const nh = r.u8();
  if (nh > MAX_HITS) throw new RangeError("clip hits");
  const hits: ClipHit[] = [];
  for (let k = 0; k < nh; k++) {
    const t = r.f64();
    const hx = r.fin32();
    const hy = r.fin32();
    const hz = r.fin32();
    const a = r.u8();
    const hb = r.u8();
    const b = hb === 255 ? -1 : hb;
    if (!Number.isFinite(t) || a >= nc || b >= nc || (k > 0 && t < hits[k - 1]!.t)) throw new RangeError("clip hit");
    hits.push({ t, x: hx, y: hy, z: hz, a, b });
  }
  return { trackId, score, impacts, kills, ejects, hit, ejections, knocks, stirs, partStirs, strikes, squad, vip, peakKph, hitKph, deform, hits, t0, firstImpact, lastImpact, firstStep, x, z, focus, firstA, firstB, realism, bleed, squash, buckle, deformMode, epicenter, look, cars, h, shape, lone, inputs, keyStep, keyCars, keys };
}

/** A clip's squad block (`squadBytes`); throws RangeError on one that names a guard, a car or a step the clip has not. */
function readSquad(r: Reader, steps: number, nc: number): ClipSquad | null {
  const guards = r.u8();
  if (guards === 0) return null;
  if (guards > MAX_SQUAD) throw new RangeError("clip squad");
  const state = new Float32Array(squadStateLength(guards));
  for (let k = 0; k < state.length; k++) state[k] = r.fin32();
  const carCode = (v: number): boolean => v === CLIP_NO_CAR || v === CLIP_OUT_CAR || v < nc;
  if (!carCode(state[1]!)) throw new RangeError("clip squad state");
  for (let g = 0; g < guards; g++) if (!Number.isInteger(state[2 + 5 * g]!) || state[2 + 5 * g]! < 0 || state[2 + 5 * g]! > GUARD_DOWN) throw new RangeError("clip squad state");
  const n = r.u16();
  if (n > MAX_SQUAD_EVENTS) throw new RangeError("clip squad events");
  const events: ClipSquad["events"] = [];
  for (let k = 0; k < n; k++) {
    const step = r.u32();
    const kind = r.u8();
    const a = r.u8();
    const b = r.u8();
    const c = r.u8();
    const ok =
      (kind === SQUAD_ALARM && a <= 1) || (kind === SQUAD_TARGET && carCode(a)) || (kind === SQUAD_SHOT && a < guards && b < nc && c <= 1) || (kind === SQUAD_DOWN && a < guards);
    if (!ok || step >= steps || (k > 0 && step < events[k - 1]!.step)) throw new RangeError("clip squad event");
    events.push({ step, kind, a, b, c });
  }
  return { state, events };
}

/** A clip's VIP block (`VIP_EVENT_BYTES` an event); throws RangeError on one that names a car or a step the clip has not. */
function readVip(r: Reader, steps: number, nc: number): ClipVip {
  const carCode = (v: number): boolean => v === CLIP_NO_CAR || v < nc;
  const start = r.u8();
  const n = r.u8();
  if (!carCode(start)) throw new RangeError("clip vip");
  if (n > MAX_VIP_EVENTS) throw new RangeError("clip vip events");
  const events: ClipVip["events"] = [];
  for (let k = 0; k < n; k++) {
    const step = r.u32();
    const car = r.u8();
    if (!carCode(car) || step >= steps || (k > 0 && step < events[k - 1]!.step)) throw new RangeError("clip vip event");
    events.push({ step, car });
  }
  return { start, events };
}

/** A decoder never inflates past this (a hostile peer's or a corrupt store's deflate bomb). */
const INFLATE_MAX = 4 << 20;

/** deflate-raw (the platform's `CompressionStream`): a reel's clips shrink about 4× (inputs and keyframes repeat). */
async function deflate(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}

/** Inflate at most `INFLATE_MAX` bytes; RangeError on bad or oversized data. */
async function inflate(data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const reader = new Blob([data.slice()]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      n += r.value.length;
      if (n > INFLATE_MAX) throw new RangeError("inflates past the cap");
      parts.push(r.value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e instanceof RangeError ? e : new RangeError("bad deflate data");
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function clipsBytes(clips: readonly HighlightClip[]): Uint8Array<ArrayBuffer> {
  const w = new Writer(1 + clips.reduce((n, c) => n + clipBytes(c), 0));
  w.u8(clips.length);
  for (const c of clips) writeClip(w, c);
  return w.done();
}

/**
 * The reel as one message (`reelParts` frames it for the wire): `MSG.reel`, seed (u32), the host-clock second every
 * peer starts the reel at (f64), then every clip deflated. The host plays the clips it sent, so every peer shows the same ones.
 */
export async function packReel(reel: Reel, startAt: number): Promise<Uint8Array<ArrayBuffer>> {
  const body = await deflate(clipsBytes(reel.clips));
  const w = new Writer(13 + body.length);
  w.u8(MSG.reel);
  w.u32(reel.seed);
  w.f64(startAt);
  w.bytes.set(body, w.off);
  w.off += body.length;
  return w.done();
}

/** A `MSG.reel`; RangeError on a malformed one. */
export async function unpackReel(data: Uint8Array, L: NetLayout): Promise<{ reel: Reel; startAt: number }> {
  const r = new Reader().reset(data);
  if (r.u8() !== MSG.reel) throw new RangeError("not a reel");
  const seed = r.u32();
  const startAt = r.f64();
  if (!Number.isFinite(startAt)) throw new RangeError("reel clock");
  const body = r.reset(await inflate(data.subarray(13)));
  const n = body.u8();
  const clips: HighlightClip[] = [];
  for (let k = 0; k < n; k++) clips.push(readClip(body, L));
  return { reel: { seed, clips }, startAt };
}

/**
 * A `MSG.reel` decoded and handed to `play`, its start (host clock) moved onto this browser's clock by `offset`. Decoding is
 * async: `current` says the session is still the one the message came from, else it is dropped; a malformed one plays nothing.
 */
export function playHostReel(data: Uint8Array, L: NetLayout, offset: number, play: (reel: Reel, startAt: number) => void, current: () => boolean): void {
  unpackReel(data, L).then(
    ({ reel, startAt }) => {
      if (current()) play(reel, startAt + offset);
    },
    () => {},
  );
}

/** A clip for `localStorage`: magic, `REPLAY_VERSION`, `NET_VERSION`, the sim fingerprint, then the clip deflated; base64. */
export async function encodeSaved(c: HighlightClip): Promise<string> {
  const w = new Writer(clipBytes(c));
  writeClip(w, c);
  const body = await deflate(w.done());
  const out = new Writer(11 + body.length);
  out.u32(SAVE_MAGIC);
  out.u16(REPLAY_VERSION);
  out.u8(NET_VERSION);
  out.u32(simFingerprint());
  out.bytes.set(body, out.off);
  out.off += body.length;
  let s = "";
  for (const b of out.done()) s += String.fromCharCode(b);
  return btoa(s);
}

/** A saved clip's 11-byte header against this build: "version" (another clip or keyframe layout, or another sim build), "corrupt" (not a clip), null (this build's). */
function checkHeader(r: Reader): "version" | "corrupt" | null {
  if (r.u32() !== SAVE_MAGIC) return "corrupt";
  return r.u16() !== REPLAY_VERSION || r.u8() !== NET_VERSION || r.u32() !== simFingerprint() ? "version" : null;
}

/**
 * Whether this build can replay saved clip `text`, from its header alone (the first 12 bytes: no inflate, so listing many stays cheap).
 * A clip whose body is damaged under a good header passes here and is "corrupt" in `decodeSaved`.
 */
export function savedPlayable(text: string): boolean {
  try {
    return checkHeader(new Reader().reset(Uint8Array.from(atob(text.slice(0, 16)), (c) => c.charCodeAt(0)))) === null;
  } catch {
    return false;
  }
}

/** A saved clip, or why it cannot replay here (`checkHeader`'s "version" or "corrupt"). */
export async function decodeSaved(text: string, L: NetLayout): Promise<HighlightClip | "version" | "corrupt"> {
  let bin: string;
  try {
    bin = atob(text);
  } catch {
    return "corrupt";
  }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const r = new Reader().reset(bytes);
  try {
    const bad = checkHeader(r);
    if (bad) return bad;
    return readClip(r.reset(await inflate(bytes.subarray(11))), L);
  } catch (e) {
    if (e instanceof RangeError) return "corrupt";
    throw e;
  }
}
