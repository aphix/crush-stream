import * as THREE from "three";
import type { CrushBands } from "./physics-util.ts";
import type { ShapeCluster, ShapeParticle } from "./shape-match.ts";
import {
  CAGES,
  MASS_SPECS,
  PLATFORM_TYRE,
  SENSORS,
  SHAPE_CLUSTERS,
  type BodyPartName,
  type CageSpec,
  type MassName,
  type MassSpec,
  type SensorSpec,
} from "../kernel/rig-spec.ts";
import { DEFAULT_BUCKLE, DEFAULT_SQUASH } from "./constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { DeformParticleHelper, DeformRigHelper } from "./deform-helper.ts";
import { bindLattice, buildRunStructures, INF_K, restoreInto, runTemplate, wrinkleSeeds } from "./deform-build.ts";
import { FACES, faceFollow, IMPRINT_NONE, type FaceBands } from "./load-crush.ts";
import { PushBudget } from "./push-budget.ts";
import { hypot3, hypot2, PART_FAMILY } from "../kernel/physics-core.js";

/** Numbers a `simState` block spends on the rig’s scalar fields (`simScalarsOut`: 58 fields, one double each: nine are the epicenter freeze: `frozen`, `frozenReady`, `sinceThaw`, the cached centre and inertia; the last two the solids' hold of the slice, `solidHold`). */
export const SIM_SCALAR_NUMBERS = 58;

export type DeformMode = "shape" | "lattice";

/** Rearward engine travel (m, vs the cell, along the hit) that leaves the car undriveable.
 *  ESV 98S3P12: a rigid full-width barrier overloads the front above ~50 km/h
 *  and leaves the safety cell intact below that. With the slab stopping the
 *  nose (A1) the block is reached once the nose packs (RigTables.packGap): about
 *  0.03 m at 35 km/h, 0.11 m at 56 km/h, 0.15 m at 64 km/h and 0.23 m at 80.
 *  A tail-first hit does not reach the block (it lives in the nose), so the
 *  same threshold stays driveable from the rear well past 80 km/h. */
export const ENGINE_KILL_TRAVEL = 0.15;
/** A corner crushed to within this of its hub (m) takes the wheel on any real hit, however wide and from whichever end: the
 *  bumper has overrun the tyre (`clampMass`, `hubReach`). Not a press: the compactor's plates ride the hubs back at under 1 m/s. */
export const HUB_OVERRUN = 0.12;
/** Sim time (s) a driven wreck's steer turn stays in its reported spin after `applyDrive` set it (`keptSpin`). */
const DRIVE_TURN_HOLD = 1 / 30;

/** A car's rig at rest: rig-spec's cages, crush sensors and masses placed on its body, its tyre (m: radius along the car, half-width across) and the scalars its readers take from the body. */
export interface RigTables {
  readonly cages: readonly CageSpec[];
  readonly sensors: readonly SensorSpec[];
  readonly masses: readonly MassSpec[];
  readonly tyre: { readonly r: number; readonly halfW: number };
  /** Factor on every mass and on every beam's stiffness, yield and damping: a heavier body keeps the platform's frequencies and damping ratios. */
  readonly massScale: number;
  /** Height (m) of the wheel arch's top: skin below it is the arch's (planted on its hub) or the sill's. */
  readonly archTop: number;
  /** Plan reach (m) of the arch plant: skin below `archTop` this near a hub's rest stands at its rest offset from that hub. */
  readonly archPlant: number;
  /** A rest vertex over this height (m) is roof: the skin's roof clamp holds it. */
  readonly roofClampY: number;
  /** Where the roof's skin hangs on the roof mass (m): at the roof panel's own place, which its crush reaches. The mass itself stands where the sim has it. */
  readonly roofSkin: readonly [number, number, number];
  /** Where each face's crush reaches into this body (`faceFollow`): the bands follow its bonnet, roof and ends. */
  readonly faceBands: FaceBands;
  /** Plan reach (m) from its hub at which a crushed corner has hit the tyre: tyre radius plus the packed bumper beam. */
  readonly tyreReach: number;
  /** How far (m) the front bumper's particles stand behind the nose a solid's face meets: a push bar's reach, which the hold on a face (`faceHits`) adds to those particles' own. */
  readonly noseReach: number;
  /** Packed bumper-to-block-centre length (m): bumper beam and radiator crushed flat ahead of the block. The nose's rest gap less this is its crumple, 0.30 m on every body; crush past it shoves the engine back. */
  readonly packGap: number;
  /** The hit speed (m/s EBS) under which no hit takes a wheel off, whatever the crush: 0 on the platform (the gates of `clampMass` stand alone), more where the hub hardware is built for heavier wheels. */
  readonly hubHoldMps: number;
}
/** Platform bonnet top (m): where the top band starts following the roof's crush. */
const PLATFORM_BONNET_TOP = CAGES.find((cage) => cage.name === "bonnet")!.max[1];
/** The platform's roof mass. */
const PLATFORM_ROOF = MASS_SPECS.find((spec) => spec.name === "roof")!;
/** The tables as they stand: the platform every body shared. */
export const PLATFORM_RIG: RigTables = {
  cages: CAGES,
  sensors: SENSORS,
  masses: MASS_SPECS,
  tyre: PLATFORM_TYRE,
  massScale: 1,
  archTop: 0.55,
  archPlant: 0.4,
  roofClampY: 1.05,
  roofSkin: PLATFORM_ROOF.rest,
  faceBands: {
    top: [PLATFORM_BONNET_TOP, MASS_SPECS.find((spec) => spec.name === "roof")!.rest[1] - PLATFORM_BONNET_TOP],
    nose: [0.7, 1.36],
    tail: [0.7, 1.36],
    side: [0.4, 0.4],
  },
  tyreReach: 0.42,
  noseReach: 0,
  packGap: 0.54,
  hubHoldMps: 0,
};
/** Depth (m) inside the chassisCell span's front/rear face over which non-cell skin weight blends back in. */
const CELL_FACE_BLEND = 0.3;
/** Largest non-cell skin weight at the span face (D1): the A-pillar foot still creases. */
const CELL_FACE_SHARE = 0.25;
/** Share of the nearest nose mass in a windscreen base corner (`parentRule`'s `foot`): the cowl is where the nose meets the cabin, so the pane's frame rides the cabin and half the nose's give. Hung wholly on the cabin the pane never cracks in a wall hit hard enough to crack it; on the nearest four masses it cracks in a lighter one. */
const WINDSCREEN_FOOT_SHARE = 0.5;

/** Most cluster weights a skin vertex keeps: the 4 nearest plus the cell-face share. */
export const SKIN_K = 5;
/** `skinN` packs a point's cluster count into this many low bits (`SKIN_K` ≤ 7), and its lever share (`SKIN_LEVER_STEPS` of them at most) into the rest. */
export const SKIN_COUNT_BITS = 3;
export const SKIN_COUNT_MASK = 7;
/** Steps of a skin point's lever share: `skinN >> SKIN_COUNT_BITS` of these is the share (31 fits the five bits left in a byte). */
export const SKIN_LEVER_STEPS = 31;
/** How far (m) from its parents' rest centroid a skin point still turns with its clusters' maps in full: the maps are fitted on clusters half a metre across, so past this lever they are carried no further than at it. */
const SKIN_LEVER_REACH = 0.35;
/** Parent masses per skin point (A5): the paint rides these particles. */
const RES_K = 4;
/** Parent slots: RES_K plus the cell-face share of the nearest non-cabin mass (D1). */
export const RES_SLOTS = 5;
/** IDW softening (m²) of the parent weights, 1/(d² + RES_SOFT). */
const RES_SOFT = 0.04;
/** Plan travel (m) off its plant at which an arch vertex lets go of its hub: a deeper crush takes the arch with the body (held, a 0.3 m nose crush ran the fender through the arch's lip and folded it). */
const ARCH_YIELD = 0.15;

/** The share `keep` of an arch vertex's pull onto its plant, as it stands `dx`, `dz` (m) off it: whole at the plant, none from `ARCH_YIELD` on (the skin kernel's `skin_shape` mirrors it). */
export function archKeep(keep: number, dx: number, dz: number): number {
  return keep * Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz) / ARCH_YIELD);
}

export interface Cage {
  spec: CageSpec;
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  restCorners: THREE.Vector3[];
  corners: THREE.Vector3[];
  size: THREE.Vector3;
  glass: boolean;
}

export interface Sensor {
  spec: SensorSpec;
  rest: THREE.Vector3;
  pos: THREE.Vector3;
  partIndex: number;
  compression: number;
  target: number;
  delay: number;
  fired: boolean;
}

export interface MassNode {
  name: MassName;
  rest: THREE.Vector3;
  local: THREE.Vector3;
  world: THREE.Vector3;
  vel: THREE.Vector3;
  mass: number;
  radius: number;
  dynamic: boolean;
  clipping: boolean;
  popped: boolean;
  /** Car-frame push (m) a squeezing face (press plates, `pushMass` when bidirectional) has given a planted
   *  hub: clampLocal pins it at rest + shove and pops it past a wheel diameter. Pinned at rest, plates passed through the tyres. */
  shoveX: number;
  shoveZ: number;
  /** Permanent set (m) along the hit, from `baseX/baseZ`: crush this node can no longer spring back from. */
  crushSet: number;
  /** Planar displacement from rest (m, car frame) when the current hit started: earlier hits' damage.
   *  clampLocal caps only what this hit adds on top, so a later hit never springs an old dent back. */
  baseX: number;
  baseZ: number;
  bands: CrushBands;
  /** Name-class flags and region softness, resolved once so hot loops never string-match. */
  hub: boolean;
  bumper: boolean;
  rail: boolean;
  /** Bumper or wing: soft sheet metal that yields on sphere-sphere contact. */
  crumple: boolean;
  softness: number;
  /** Position in `masses`: the key of the per-mass tables (`massBeams`). */
  index: number;
}

export interface Beam {
  a: number;
  b: number;
  rest: number;
  plastic: number;
  minLen: number;
  kTen: number;
  yieldK: number;
  damp: number;
  alive: boolean;
  restDir: THREE.Vector3;
}

/** A5 skin tables (`DeformRig.buildSkinWeights`): per point its cluster count `sN`, cluster map offsets `sXf` and weights `sW` (`SKIN_K` slots), its parent mass offsets `rJ` (index × 3) and weights `rW` (`RES_SLOTS` slots), and their weighted rest centroid `rC`. */
interface SkinPointTables {
  readonly sN: Uint8Array;
  readonly sXf: Int32Array;
  readonly sW: Float64Array;
  readonly rJ: Int32Array;
  readonly rW: Float64Array;
  readonly rC: Float64Array;
}

/** The A5 tables of a mesh outside the body skin (`DeformRig.bindPoints`), for its `count` vertices. */
export interface PointSkin extends SkinPointTables {
  readonly count: number;
}

/** The cabin section and the sill's rule for which skin follows only the cell (D1, `DeformRig.skinZones`). */
interface SkinZones {
  readonly span: Cage;
  inCell(x: number, y: number, z: number): boolean;
  cellOnly(x: number, y: number, z: number, hub: number): boolean;
}

type SkinParentRule = (rx: number, ry: number, rz: number, i: number, t: SkinPointTables, hung?: boolean, foot?: boolean) => void;

type KeyMass = "cell" | "roof" | "engineL" | "engineR" | "axleR" | "doorL" | "doorR" | "hubFL" | "hubFR" | "hubRL" | "hubRR" | "bumperFL" | "bumperFR" | "bumperRL" | "bumperRR";

/** The soft body's state and build. Layers stack `DeformRig` → `DeformHit` → `DeformState` → `DeformContact` → `DeformSolve` →
 *  `StreamedDeformation` (one class split by context; the last is what anything constructs). */
export abstract class DeformRig {
  readonly cageCount: number;
  readonly sensorCount: number;
  dirty = false;
  /** True after this frame's skin() — panels skip computeVertexNormals otherwise. */
  skinnedThisFrame = false;
  /** Owner's per-frame LoD verdict: the car is off-screen or tiny, so skip the vertex skin (the cage/shape solve still runs). */
  skinDeferred = false;
  /** A skin was skipped since the mesh was last written — `flushSkin` before the car is seen. */
  skinOwed = false;
  /** The sim baked the skin since the car's cage (`DeformableCar.cage`) was last fitted to it: the cage is fitted from that bake. */
  cageDue = true;
  /** Counts every write of the cage corners (`solveCages`, a `simState` restore); 0 again at a respawn (`rebuildRunStructures`): a reader that cached something of the corners re-reads when it changed. */
  cornerSerial = 0;
  /** The next cage fit takes no `REFIT_EPSILON` slack: the crush window's final bake, a seat's bake (`followGroup`) and a client's net bake are fitted exactly. Cleared by the fit. */
  cageExact = false;
  /** The sim has baked the masses since the car was set up: until it has, `massPos` and the cluster maps are empty and the body is its rest shape. */
  skinBaked = false;
  /** The crush window closed since the mesh was last written: a deferred skin is written once anyway. */
  protected skinFinal = false;
  /** The length (s) of the last slice `stepCrushSlice` read the sensors at, until the step's own `stepCrush` takes it (0: no slice has). Never outlives a step. */
  protected sliceReadDt = -0;
  crushAmount = -0;
  impactLocal = new THREE.Vector3();
  impactInward = new THREE.Vector3(0, 0, -1);
  massActive = false;
  /** Epicenter activation (`EPICENTER`): the wreck is relocked, its masses ride the body and its structure step is only a clock (`stepFrozen`). A contact thaws it (`thaw`). */
  frozen = false;
  /** A frozen wreck whose rigid step has run once: its centre of mass and inertia (`frozenCentre`, `frozenInvI`, car frame) are cached, for its masses stand still in the frame (`DeformableCar.integrateWreck`, `wreckCentre`). */
  frozenReady = false;
  /** Seconds since the last thaw (`settleFreeze` advances it): with `EPICENTER.thawHold` > 0 a wreck does not refreeze before that long has passed since a contact thawed it. */
  sinceThaw = Infinity;
  readonly frozenCentre = new THREE.Vector3();
  readonly frozenInvI = new THREE.Vector3();
  /** Nodes the last structure step ran the solver on and the ones it left riding the body (`stepStructure`, `stepFrozen`), and how often this car froze and thawed since `stepWorld` last read them (it adds them to the step's work counters and zeroes them). */
  nodesLoose = 0;
  nodesLocked = 0;
  /** Masses the solver matches (every one but the hubs, which ride the suspension). */
  protected matchedNodes = 0;
  freezes = 0;
  thaws = 0;
  /** Metres of crush a frozen car dropped (`EPICENTER.feedMin`) since `stepWorld` last read it (it adds them to the step's work counter and zeroes them). */
  crushDropped = 0;
  drivetrainAlive = true;
  /** Worst engine-block travel toward the cabin so far (m); only rises (updateDrivetrain). */
  engineTravel = 0;
  /** Block travel (m) that kills the drivetrain. Physics default ENGINE_KILL_TRAVEL (sourced); the
   *  handling model may raise it per car (arcade ↔ realistic) without changing how far the block moves. */
  killTravel = ENGINE_KILL_TRAVEL;
  /** Wear (Σ per-hit EBS², each capped at WEAR_HIT) that wrecks the drivetrain by itself; the engine's
   *  travel share adds to it. Infinite (off) unless the context arms it (a derby, `armKill`). */
  wreckEnergy = Infinity;
  /** Wear taken so far: every hit's EBS², capped at WEAR_HIT (beginCrush, rearmHit). */
  protected wear = -0;
  /** Both ends are crumple zones (car-compactor / two-wall squeeze). */
  bidirectional = false;
  /** Sticky until reset: this car was squeezed / deep-crushed, so `clampLocal` keeps those shape limits. */
  protected squeezeShape = false;
  protected deepShape = false;
  /** Masses resting on the face after the last `faceHits` call (a world slice drops it before its course pass). */
  faceContacts = 0;
  /** Walls past both wheel midpoints: the cage and rails may yield. Reads false while `frameCrush` is off. */
  get deepCrush(): boolean {
    return this.squeezed && this.frameCrush;
  }
  set deepCrush(v: boolean) {
    this.squeezed = v;
  }
  private squeezed = false;
  /** A squeeze past both wheel midpoints may crush the frame (`deepCrush`). Off: the cell holds (race mode). */
  frameCrush = true;
  /** Wheels may separate (C4 corner hits, kerb launches, a face shoving the hub a wheel diameter). Off: never. */
  wheelsDetach = true;

  /** Whatever moves a mass or restarts the contact clock calls this first: the cage runs the solve again from the next structure step. */
  thaw(): void {
    if (!this.frozen) return;
    this.frozen = false;
    this.frozenReady = false;
    this.sinceThaw = 0;
    this.thaws++;
  }

  protected cages: Cage[];
  protected sensors: Sensor[];
  protected restPos: Float32Array;
  /** The body's rest skin (x, y, z per vertex): what a scrape test measures a panel on, in place of the drawn skin. */
  get restSkin(): Float32Array {
    return this.restPos;
  }
  /** Per-vertex wrinkle phase noise in [−0.5, 0.5). */
  protected readonly wrinkleSeed: Float64Array;
  /** Cage influences per vertex (≤ INF_K): count, `cageCo` offset, (u, v, w, weight). */
  protected readonly infN: Uint8Array;
  protected readonly infCo: Int32Array;
  protected readonly infUvw: Float64Array;
  /** `cageCoeffs` of every cage (24 per cage), refreshed per skin. */
  protected readonly cageCo: Float64Array;
  protected vertexCount: number;
  protected elapsed = 0;
  protected lastContact = -10;
  /** A contact within the last `PLANT_QUIET` s keeps the hit on (the pair contact reads it to extend its reach by the crush so far). */
  crushing = false;
  protected impulse = -0;
  /** Equivalent barrier speed (m/s, −1 before any hit) of the current hit: the root-sum-square of every
   *  hit's EBS on the struck end. Crush energy grows with EBS² on a linear-stiffness end, so repeated hits
   *  on one end add stroke; spikes inside one contact never re-arm (`rearmHit`). */
  protected hitSpeed = -0;
  /** Σ EBS² per struck end (`struckEnd`: front, rear, left, right). */
  protected readonly endEbs2 = new Float64Array(4);
  /** Ground under each dynamic mass before (`floorPre`) and after (`floorPost`, `gripPost`) its move (`sampleGround`). */
  protected readonly floorPre = new Float64Array(MASS_SPECS.length);
  protected readonly floorPost = new Float64Array(MASS_SPECS.length);
  protected readonly gripPost = new Float64Array(MASS_SPECS.length);
  protected readonly massCornerW = new Float64Array(MASS_SPECS.length);
  protected massCornerX = NaN;
  /** Per mass index, x/z (car frame) of where a hub stood at the last `followGroup`: a planted hub's world, not its pin in `local` (`settleHubStand`); `measurePose` plants the frame on it. */
  protected readonly hubStand = new Float64Array(MASS_SPECS.length * 2);
  /** `floorPost` sampled since the masses last armed (`measurePose` reads the hubs' floors from it). */
  protected floorsFresh = false;
  /** `measurePose` output (pitch, yaw, roll, anchor world x/y/z and body x/z, floor, lowest hub, 1 when every hub is
   *  on its ground, the ground that holds the body up, then the pitch and roll (rad) of the plane under its hubs, at any
   *  lean (the frame lies on it once levelled; `stepSuspension` tilts its rest offsets by it); 1 when planted on level ground). */
  protected readonly pose = new Float64Array(15);
  /** `yawMomentum`'s held angular momentum: [0] clampLocal's, [1] separateAlong's, [2] stepShapeMatch's, [3] the slide drag's (`stepMassSlice`, `dragGround`). */
  protected readonly spinHeld = new Float64Array(4);
  protected readonly strokeOut = new Float64Array(1);
  /** The current hit's block travel is its EBS energy's outright (`updateDrivetrain`): a re-armed hit's, or a tyre's side hit's (it lands on the running gear, under the nose's crush). */
  protected energyTravel = false;
  /** `elapsed` of the last throttle input (`notifyPower`). */
  protected lastPower = -0;
  /** `elapsed` when the current hit began (beginCrush, rearmHit): the sliding-drag clock (`sinceHit`). */
  protected hitAt = -0;
  /** `lastContact` before the slice now touching (`touchNow`): a re-arm reads the quiet the wreck had when its slice began. Read within one slice only, so not netted. */
  protected touchedBefore = -10;
  /** `elapsed` of the slice whose contact re-armed the hit (`rearmHit`), with that contact's EBS and what it found: a harder contact of the same slice takes the hit over. Read within one slice only. */
  protected armedAt = -1;
  protected armedEbs = 0;
  protected armedEnd = 0;
  protected armedEnd2 = 0;
  protected armedWear = 0;
  protected wrinkleAmp = -0;
  /** `slabTravel`'s low mark of `crumpleTravelCorner` this hit. */
  protected cornerLow = Infinity;
  protected helper: DeformRigHelper | null = null;
  protected particleHelper: DeformParticleHelper | null = null;
  /** World xyz shape-match goal per particle for the particle view; NaN = no pull last step. */
  protected goalView = new Float64Array(0);
  /** goalView while the particle view is visible, else null so the solver skips the copy. */
  protected goalOut: Float64Array | null = null;
  readonly masses: MassNode[];
  protected beams: Beam[];
  protected readonly at: Record<KeyMass, MassNode>;
  protected readonly byName: Map<MassName, MassNode>;
  protected readonly suspension: readonly (readonly [MassNode, MassNode])[];
  protected readonly cageByPart: Map<BodyPartName, Cage>;
  protected _totalMass = 1;

  /** Crush (m) a hit's stroke must reach to overrun `hub`'s wheel and tear it off (`HUB_OVERRUN` short of the hub): the corner's rest distance to the hub. */
  hubReach(hub: MassNode): number {
    const corner = hub.rest.z > 0 ? (hub.rest.x < 0 ? this.at.bumperFL : this.at.bumperFR) : hub.rest.x < 0 ? this.at.bumperRL : this.at.bumperRR;
    return Math.abs(corner.rest.z - hub.rest.z) - HUB_OVERRUN;
  }

  /** A driven wreck's body and masses turned at `rate` rad/s this step (`applyDrive`): a position correction, so no spin of the body's shows it (`keptSpin`). */
  driveTurn(rate: number): void {
    this.keptTurn[1] = rate;
    this.keptTurn[2] = this.elapsed;
  }

  /**
   * The turn rate (rad/s) the wreck's position corrections made and its body's spin lacks: the planted write-back's over the last
   * timed `followGroup`, plus a driven wreck's steer (held `DRIVE_TURN_HOLD` after `applyDrive`). A readout, never `car.angular`.
   */
  get keptSpin(): number {
    const driven = this.drivetrainAlive && this.elapsed - this.keptTurn[2]! < DRIVE_TURN_HOLD ? this.keptTurn[1]! : 0;
    return this.keptTurn[3]! + driven;
  }

  protected prevYaw = 0;
  /**
   * The rigid body's velocity and spin (`followGroup`'s arguments, kept: the car's own vectors; a restored wreck's from `DeformableCar.solverState`) the masses ride when the
   * structure is rigid and the wheels are freed against: `bodyV` is its centre's, the masses' centroid stood `liftOffset` off.
   */
  bodyV = new THREE.Vector3();
  bodyW = new THREE.Vector3();
  /**
   * The rigid body's centre's offset (m, world) from the masses' centroid: a lifted class's body rises over the stock frame its masses are, and
   * its centre of mass with it (`centreLift`, along its up). Kept by the car at its pose (`CarCore.refreshBasis`); zero for an unlifted class.
   * Read at the centroid, the monster wreck's masses rode its body ω × 0.71 m off the centre it turned about: 11.7 m/s apart tumbling off the
   * owner's stack column (union 5af15133).
   */
  readonly liftOffset = new THREE.Vector3();
  /** The drawn body's lift over the masses (m, world, along the car's up), kept by the car at its pose: zero for an unlifted class. */
  readonly bodyLift = new THREE.Vector3();

  /** The lowest and highest rest height (m, the car's frame) of the masses that crush (all but the roof); NaN until `massPoint` first reads them. */
  private bandLow = NaN;
  private bandHigh = NaN;

  /**
   * `world`, a point read off the drawn (lifted) cage, in the masses' frame: less the body's lift, and held between the heights the crushing
   * masses stand at over the car's origin height `originY`. A cage point's height is wherever the other body's overlap lands on it (a
   * hood's lip, a windshield, a lifted tail's band) and moves with the slice the contact is first read in; the crush reads it only as a
   * distance to those masses.
   */
  massPoint(world: THREE.Vector3, out: THREE.Vector3, originY: number): THREE.Vector3 {
    if (Number.isNaN(this.bandLow)) {
      let low = Infinity;
      let high = -Infinity;
      for (const m of this.masses) {
        if (m.name === "roof") continue;
        low = Math.min(low, m.rest.y);
        high = Math.max(high, m.rest.y);
      }
      this.bandLow = low;
      this.bandHigh = high;
    }
    out.copy(world).sub(this.bodyLift);
    out.y = Math.min(originY + this.bandHigh, Math.max(originY + this.bandLow, out.y));
    return out;
  }

  /** Share (0–1) of the read pitch/roll the frame takes, and the sim time it was last eased at (followGroup). */
  protected lean = 1;
  protected leanAt = -Infinity;
  /** The body's middle is above its ground band (followGroup): no wheel holds it, its masses fly. */
  aloft = false;
  /** The frame's height at sim time `frameAt` (followGroup's last timed call) and its measured climb (m/s). */
  protected frameY = 0;
  protected frameAt = 0;
  protected frameVy = 0;
  /** The slice's position corrections (pair pushes, mass-sphere shifts, wall translations): one net budget. */
  protected readonly push = new PushBudget();
  /** `elapsed` at the start of the world slice being stepped (`beginSlice`), the `push` window of everything in it; negative
   *  outside one. A double from the start: a Smi field's first double write changes the maps. */
  protected sliceAt = -1.5;
  /** The slice's length (s) and the faster of the touching cars in it (m/s): what the drift cap (`settleDrift`) grows with. */
  protected sliceDt = 1 / FRAME_HZ;
  protected sliceTouch = -0;
  protected overlapFrame = false;
  /** Summed plan normals fixed solids held the wreck out along: [0, 1] this slice (`holdBySolid`), [2, 3] the slice before (`beginSlice`
   *  moves them), which the pair pushes read (`solidHolds`): the course's solids are met after the pairs. */
  protected readonly solidHold = new Float64Array(4);
  /** Sim time (elapsed) of the last fed contact: the solver stays in contact mode CONTACT_HOLD past it. */
  protected contactAt = -Infinity;
  /** stepShapeMatch ran during the current / the previous structure step: the falling edge rebases the rests. */
  protected shapeRan = false;
  protected shapeWasLive = false;
  /** Body frame of the last syncShapeFromMasses: world = R_y(heading)·(local − bodyRestC) + bodyC. */
  protected bodyCos = 1;
  protected bodySin = 0;
  protected readonly bodyC = new THREE.Vector3();
  protected readonly bodyRestC = new THREE.Vector3();
  /** The car body's up (world) as the structure step began (`stepStructure`'s `frame`): a squeeze's roof goal moves square to it. */
  protected readonly frameUp = new THREE.Vector3(0, 1, 0);
  squash = DEFAULT_SQUASH;
  buckle = DEFAULT_BUCKLE;
  mode: DeformMode = "shape";
  protected clusters: ShapeCluster[] = [];
  protected clusterAbsorb = new Float64Array(0);
  protected clusterOwner: BodyPartName[] = [];
  protected shapeParticles: ShapeParticle[] = [];
  protected goalX = new Float64Array(0);
  protected goalY = new Float64Array(0);
  protected goalZ = new Float64Array(0);
  protected goalW = new Float64Array(0);
  /** Body-frame x/y/z of each particle when stepShapeMatch started (net-spin removal). */
  protected startX = new Float64Array(0);
  protected startY = new Float64Array(0);
  protected startZ = new Float64Array(0);
  /** World x/z of each mass at `holdTurn` (a position-only pass's net turn, undone by `undoTurn`). */
  protected turnX = new Float64Array(0);
  protected turnZ = new Float64Array(0);
  /** [0]: turn (rad) the planted write-back kept since the last timed `followGroup`; [1], [2]: `applyDrive`'s yaw rate and its sim time (`driveTurn`); [3]: [0] as a rate (`keptSpin`). */
  protected readonly keptTurn = new Float64Array(4);
  /** Cluster skin weights per vertex (≤ SKIN_K): count (0 = cage fallback), `clusterXf` offset, weight. */
  protected skinN = new Uint8Array(0);
  protected skinXf = new Int32Array(0);
  protected skinW = new Float64Array(0);
  /** Skin vertex → mass index of the hub that plants it (wheel arch, below 0.55 m), else −1. */
  protected skinHub = new Int32Array(0);
  /** Per cluster: skin map M as of the last bake (row-major 9), applied to a skin point's offset from its parent masses (A5); the mesh, cages and net state read it. */
  protected clusterXf = new Float64Array(0);
  /** Cage corner ← cluster weights (rest-only, so built once): per corner [start, end) into `cornerXf`/`cornerW`, and Σw. */
  protected cornerStart = new Int32Array(0);
  protected cornerXf = new Int32Array(0);
  protected cornerW = new Float64Array(0);
  protected cornerWsum = new Float64Array(0);
  protected impulseW = new Float64Array(0);
  /** The skin's fit rest: each mass's rest plus the sets it has kept (`restTakesSet`), as the clusters' rest takes them. The parents already carry a kept dent into the paint, so the cluster maps read only the strain past it. */
  protected skinRest: THREE.Vector3[] = [];
  protected skinLocal: { x: number; y: number; z: number }[] = [];
  protected skinMassN: number[] = [];
  /** A5 skin anchors: per skin point (vertices, then cage corners) up to RES_SLOTS parent masses (×3 offsets into `massPos`),
   *  their weights and weighted rest centroid; `massPos` is the masses' local positions at the last bake. */
  protected resJ = new Int32Array(0);
  protected resW = new Float64Array(0);
  protected resC = new Float64Array(0);
  protected massPos = new Float64Array(0);
  protected readonly netImpact = Float64Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, IMPRINT_NONE, 0, 0);
  protected netPopped = 0;
  protected netFlags = 0;
  /**
   * Load crush (load-crush.ts): each face's crush depth (m), the depth already baked into the masses (`bakeLoadCrush`),
   * how much each mass follows each face (rest-only), and a changed-since-the-skin-read mark; typed arrays keep the
   * `simState` layout. `imprint`: the plane the roof was last pressed to (`IMPRINT_NONE` until a load crushes it).
   */
  readonly crush = new Float64Array(FACES);
  protected readonly crushBaked = new Float64Array(FACES);
  readonly imprint = Float64Array.of(IMPRINT_NONE, 0, 0);
  protected readonly loadW: Float64Array;
  protected readonly loadDirty = new Uint8Array(1);
  protected readonly rig: RigTables;

  constructor(geometry: THREE.BufferGeometry, rig: RigTables = PLATFORM_RIG) {
    this.rig = rig;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    this.vertexCount = pos.count;
    this.restPos = new Float32Array(pos.array as Float32Array);
    this.wrinkleSeed = wrinkleSeeds(this.restPos, this.vertexCount);

    const nameIndex = new Map<MassName, number>();
    const built = buildRunStructures(rig, nameIndex);
    this.cages = built.cages;
    this.cageCount = this.cages.length;

    this.cageByPart = new Map(this.cages.map((c) => [c.spec.name, c]));

    this.sensors = built.sensors;
    this.sensorCount = this.sensors.length;

    this.masses = built.masses;
    const cellNode = this.masses.find((m) => m.name === "cell") ?? this.masses[5]!;
    const node = (name: MassName): MassNode => {
      const i = nameIndex.get(name);
      return i === undefined ? cellNode : this.masses[i]!;
    };
    this.at = {
      cell: cellNode,
      roof: node("roof"),
      engineL: node("engineL"),
      engineR: node("engineR"),
      axleR: node("axleR"),
      doorL: node("doorL"),
      doorR: node("doorR"),
      hubFL: node("hubFL"),
      hubFR: node("hubFR"),
      hubRL: node("hubRL"),
      hubRR: node("hubRR"),
      bumperFL: node("bumperFL"),
      bumperFR: node("bumperFR"),
      bumperRL: node("bumperRL"),
      bumperRR: node("bumperRR"),
    };
    this.byName = new Map(this.masses.map((m) => [m.name, m]));
    this.suspension = [
      [this.at.hubFL, this.at.engineL],
      [this.at.hubFR, this.at.engineR],
      [this.at.hubRL, this.at.axleR],
      [this.at.hubRR, this.at.axleR],
    ];
    this._totalMass = 0;
    for (const m of this.masses) this._totalMass += m.mass;
    this.impulseW = new Float64Array(this.masses.length);
    this.matchedNodes = this.masses.filter((m) => !m.hub).length;
    this.skinRest = this.masses.map((m) => m.rest.clone());
    this.skinLocal = this.masses.map((m) => m.local);
    this.skinMassN = this.masses.map((m) => m.mass);
    this.beams = built.beams;

    // Lattice skin (and the cluster-less fallback): up to INF_K cage influences per vertex (`bindLattice`).
    this.infN = new Uint8Array(this.vertexCount);
    this.infCo = new Int32Array(this.vertexCount * INF_K);
    this.infUvw = new Float64Array(this.vertexCount * INF_K * 4);
    this.cageCo = new Float64Array(this.cages.length * 24);
    bindLattice(this.restPos, this.vertexCount, this.cages, this.infN, this.infCo, this.infUvw);

    this.shapeParticles = built.shapeParticles;
    this.goalX = new Float64Array(this.masses.length);
    this.goalY = new Float64Array(this.masses.length);
    this.goalZ = new Float64Array(this.masses.length);
    this.goalW = new Float64Array(this.masses.length);
    this.startX = new Float64Array(this.masses.length);
    this.startY = new Float64Array(this.masses.length);
    this.startZ = new Float64Array(this.masses.length);
    this.turnX = new Float64Array(this.masses.length);
    this.turnZ = new Float64Array(this.masses.length);
    this.clusters = built.clusters;
    this.clusterOwner = SHAPE_CLUSTERS.map((spec) => spec.owner);
    this.clusterAbsorb = Float64Array.from(SHAPE_CLUSTERS, (spec) => this.cageByPart.get(spec.owner)!.spec.absorption);
    this.loadW = new Float64Array(this.masses.length * FACES);
    for (const [i, m] of this.masses.entries()) {
      if (m.hub) continue;
      for (let f = 0; f < FACES; f++) this.loadW[i * FACES + f] = faceFollow(this.rig.faceBands, f, m.rest.x, m.rest.y, m.rest.z);
    }
    this.buildSkinWeights();
    this.initRunState();
  }

  /** The per-run structures back to as built, in place: copied from the rig's shared template (`runTemplate`). */
  protected rebuildRunStructures(): void {
    restoreInto(this as unknown as Record<string, unknown>, runTemplate(this.rig));
    this.cornerSerial = 0;
  }

  /**
   * Every per-run scalar, vector and buffer to its construction value: the constructor's last step, and `reset`'s with
   * `rebuildRunStructures`, so a reset car runs exactly like a fresh one. Settings (`squash`, `buckle`, `mode`, `killTravel`,
   * `wreckEnergy`, `frameCrush`, `wheelsDetach`), helpers and the rest-only tables stay.
   * Fields declared `-0` (here, and the masses' and sensors' in their literals) hold a double from construction: a Smi
   * field's first double write changes the maps, which deoptimised 60–100 physics functions mid-race on each car's
   * first crash, re-arm and drive as a wreck.
   */
  protected initRunState(): void {
    this.dirty = false;
    this.skinnedThisFrame = false;
    this.skinDeferred = false;
    this.skinOwed = false;
    this.cageDue = true;
    this.cageExact = false;
    this.skinBaked = false;
    this.skinFinal = false;
    this.sliceReadDt = -0;
    this.crushAmount = -0;
    this.impactLocal.set(0, 0, 0);
    this.massCornerX = NaN;
    this.impactInward.set(0, 0, -1);
    this.massActive = false;
    this.frozen = false;
    this.frozenReady = false;
    this.sinceThaw = Infinity;
    this.nodesLoose = 0;
    this.nodesLocked = 0;
    this.freezes = 0;
    this.thaws = 0;
    this.crushDropped = 0;
    this.drivetrainAlive = true;
    this.engineTravel = 0;
    this.wear = -0;
    this.bidirectional = false;
    this.squeezeShape = false;
    this.deepShape = false;
    this.faceContacts = 0;
    this.squeezed = false;
    this.elapsed = 0;
    this.lastContact = -10;
    this.crushing = false;
    this.impulse = -0;
    this.hitSpeed = -1;
    this.energyTravel = false;
    this.lastPower = -10;
    this.hitAt = -0;
    this.touchedBefore = -10;
    this.armedAt = -1;
    this.wrinkleAmp = -0;
    this.cornerLow = Infinity;
    this.prevYaw = 0;
    this.lean = 1;
    this.leanAt = -Infinity;
    this.keptTurn.fill(0);
    this.aloft = false;
    this.floorsFresh = false;
    this.frameY = 0;
    this.frameAt = 0;
    this.frameVy = 0;
    this.push.reset();
    this.solidHold.fill(0);
    this.sliceAt = -1.5;
    this.sliceDt = 1 / FRAME_HZ;
    this.sliceTouch = -0;
    this.overlapFrame = false;
    this.contactAt = -Infinity;
    this.shapeRan = false;
    this.shapeWasLive = false;
    this.bodyCos = 1;
    this.bodySin = 0;
    this.bodyC.set(0, 0, 0);
    this.bodyV = new THREE.Vector3();
    this.bodyW = new THREE.Vector3();
    this.bodyRestC.set(0, 0, 0);
    this.frameUp.set(0, 1, 0);
    this.netPopped = 0;
    this.netFlags = 0;
    this.crush.fill(0);
    this.crushBaked.fill(0);
    this.imprint[0] = IMPRINT_NONE;
    this.imprint[1] = 0;
    this.imprint[2] = 0;
    this.loadDirty.fill(0);
    for (let i = 0; i < this.masses.length; i++) this.skinRest[i]!.copy(this.masses[i]!.rest);
    for (const b of [this.endEbs2, this.cageCo, this.floorPre, this.floorPost, this.gripPost, this.hubStand, this.pose, this.spinHeld, this.strokeOut, this.massCornerW]) b.fill(0);
    for (const b of [this.goalX, this.goalY, this.goalZ, this.goalW, this.startX, this.startY, this.startZ, this.turnX, this.turnZ, this.impulseW]) b.fill(0);
    for (const b of [this.massPos, this.clusterXf, this.netImpact]) b.fill(0);
    this.netImpact[9] = IMPRINT_NONE;
    this.goalView.fill(NaN);
  }

  /**
   * After `clampLocal`: where each hub stands in the frame, for the planted anchor (`measurePose`). A planted hub's `local`
   * is its pin (`rest` + shove), so `hubStand` keeps the point `followGroup` read it at (0.1–0.5 m off the pin).
   */
  protected settleHubStand(pinned: boolean): void {
    for (let mi = 0; mi < this.masses.length; mi++) {
      const m = this.masses[mi]!;
      if (m.hub && !(pinned && !m.popped)) {
        this.hubStand[mi * 2] = m.local.x;
        this.hubStand[mi * 2 + 1] = m.local.z;
      }
    }
  }

  /** Each shape cluster's mass-weighted rest centroid: the centre its skin weights fall off from. */
  private clusterCentres(): { x: number; y: number; z: number }[] {
    return this.clusters.map((c) => {
      let x = 0,
        y = 0,
        z = 0,
        m = 0;
      for (const i of c.idx) {
        const p = this.masses[i]!;
        x += p.rest.x * p.mass;
        y += p.rest.y * p.mass;
        z += p.rest.z * p.mass;
        m += p.mass;
      }
      m = Math.max(m, 1e-8);
      return { x: x / m, y: y / m, z: z / m };
    });
  }

  /**
   * D1: skin in the cabin section (the chassisCell cage's z span, above its floor) follows only the clusters and masses that hold the cell, so
   * A-pillar and footwell skin cannot ride the crushed nose into the cabin; within CELL_FACE_BLEND of the span's front or rear face up to
   * CELL_FACE_SHARE of the nearest other cluster blends back in. The sill (skin below the arch top between the axles, outside the arches) is
   * the cell's rocker and follows the cell's clusters too: on the nose's clusters, which a frontal crush turns, it swung into the standing front tyre.
   */
  private skinZones(): SkinZones {
    const span = this.cageByPart.get("chassisCell")!;
    const inCell = (x: number, y: number, z: number): boolean => z >= span.min.z && z <= span.max.z && y >= span.min.y;
    const axleF = Math.max(...this.masses.filter((m) => m.hub).map((m) => m.rest.z));
    const axleR = Math.min(...this.masses.filter((m) => m.hub).map((m) => m.rest.z));
    const { archTop } = this.rig;
    return {
      span,
      inCell,
      cellOnly: (x, y, z, hub) => inCell(x, y, z) || (y < archTop && z < axleF && z > axleR && hub < 0),
    };
  }

  /** The hub (mass index) that plants a skin point at rest (x, y, z) as wheel arch: below `archTop`, within `archPlant` of its rest; else −1. */
  private archHub(x: number, y: number, z: number): number {
    const { archTop, archPlant } = this.rig;
    return y < archTop ? this.masses.findIndex((m) => m.hub && hypot2(x - m.rest.x, z - m.rest.z) <= archPlant) : -1;
  }

  /**
   * A5 parents: the RES_K nearest non-hub masses by 1/(d² + RES_SOFT), less the (RES_K+1)th's weight so a parent fades out before it is
   * swapped (no seam where the nearest set changes). A cabin point takes cabin masses only (D1), plus the cell-face share of the nearest other mass;
   * a `hung` point (a door's frame, hinged to the A-pillar and latched to the B-pillar) takes the cabin masses wherever it stands, and no share;
   * a `foot` point (the windscreen's frame, standing on the A-pillar's foot) takes the share at the cell's face or past it, as the skin there does.
   * `only`: the masses a point may take (by index), for a part that rides a few of them (a push bar on its bumper's two).
   */
  private parentRule(zones: SkinZones, only?: readonly number[]): SkinParentRule {
    const { span, inCell } = zones;
    const body = this.masses.flatMap((m, j) => (m.hub || (only && !only.includes(j)) ? [] : [j]));
    const cabinBody = body.filter((j) => inCell(this.masses[j]!.rest.x, this.masses[j]!.rest.y, this.masses[j]!.rest.z));
    const outside = body.filter((j) => !cabinBody.includes(j));
    const roofJ = this.masses.findIndex((m) => m.name === "roof");
    const anchors = this.masses.map((m, j): readonly [number, number, number] => (j === roofJ ? this.rig.roofSkin : [m.rest.x, m.rest.y, m.rest.z]));
    const near = (rx: number, ry: number, rz: number, set: number[]) =>
      set.map((j) => ({ j, w: 1 / ((rx - anchors[j]![0]) ** 2 + (ry - anchors[j]![1]) ** 2 + (rz - anchors[j]![2]) ** 2 + RES_SOFT) })).sort((a, b) => b.w - a.w);
    return (rx, ry, rz, i, t, hung = false, foot = false) => {
      const cabin = inCell(rx, ry, rz);
      const ds = near(rx, ry, rz, cabin || hung ? cabinBody : body);
      const floor = ds.length > RES_K ? ds[RES_K]!.w : 0;
      ds.length = Math.min(ds.length, RES_K);
      let sum = 0;
      for (const d of ds) sum += d.w - floor;
      for (const d of ds) d.w = (d.w - floor) / sum;
      const face = Math.min(rz - span.min.z, span.max.z - rz);
      if ((cabin || foot) && face < CELL_FACE_BLEND) {
        const share = (foot ? WINDSCREEN_FOOT_SHARE : CELL_FACE_SHARE) * Math.min(1, 1 - face / CELL_FACE_BLEND);
        for (const d of ds) d.w *= 1 - share;
        ds.push({ j: near(rx, ry, rz, outside)[0]!.j, w: share });
      }
      for (let k = 0; k < ds.length; k++) {
        const { j, w } = ds[k]!;
        const r = this.masses[j]!.rest;
        t.rJ[i * RES_SLOTS + k] = j * 3;
        t.rW[i * RES_SLOTS + k] = w;
        t.rC[i * 3] += r.x * w;
        t.rC[i * 3 + 1] += r.y * w;
        t.rC[i * 3 + 2] += r.z * w;
      }
    };
  }

  /** A skin point's cluster weights: the 4 nearest clusters within 1.45 m by exp(−2.35 d), a `cellOnly` point the cell's (D1); the roof skin takes none from below the bonnet's top. */
  private clusterRule(zones: SkinZones, cms: readonly { x: number; y: number; z: number }[]): (rx: number, ry: number, rz: number, cellOnly: boolean, i: number, t: SkinPointTables) => void {
    const { span, inCell } = zones;
    const holdsCell = this.clustersHoldingCell();
    const roofFloor = this.cages.find((c) => c.spec.name === "roof")!.spec.min[1];
    const bonnetTop = this.cages.find((c) => c.spec.name === "bonnet")!.spec.max[1];
    return (rx, ry, rz, cellOnly, i, t) => {
      const scored: { ci: number; w: number }[] = [];
      let other = -1,
        otherW = 0;
      for (let ci = 0; ci < this.clusters.length; ci++) {
        const cm = cms[ci]!;
        const d = hypot3(rx - cm.x, ry - cm.y, rz - cm.z);
        if (d > 1.45) continue;
        if (ry > roofFloor && cm.y < bonnetTop) continue;
        const w = Math.exp(-d * 2.35);
        if (cellOnly && !holdsCell[ci]) {
          if (w > otherW) {
            other = ci;
            otherW = w;
          }
          continue;
        }
        scored.push({ ci, w });
      }
      scored.sort((a, b) => b.w - a.w);
      if (scored.length > 4) scored.length = 4;
      let sum = 0;
      for (const s of scored) sum += s.w;
      if (sum > 1e-8) for (const s of scored) s.w /= sum;
      const face = Math.min(rz - span.min.z, span.max.z - rz);
      if (inCell(rx, ry, rz) && other >= 0 && face < CELL_FACE_BLEND && scored.length > 0) {
        const share = CELL_FACE_SHARE * (1 - face / CELL_FACE_BLEND);
        for (const s of scored) s.w *= 1 - share;
        scored.push({ ci: other, w: share });
      }
      // The share of its clusters' maps this point takes: past `SKIN_LEVER_REACH` from its parents' rest centroid the maps' turn is carried only as far as at that reach.
      const lever = Math.min(1, SKIN_LEVER_REACH / hypot3(rx - t.rC[i * 3]!, ry - t.rC[i * 3 + 1]!, rz - t.rC[i * 3 + 2]!));
      t.sN[i] = scored.length | (scored.length > 0 ? Math.round(lever * SKIN_LEVER_STEPS) << SKIN_COUNT_BITS : 0);
      for (let k = 0; k < scored.length; k++) {
        t.sXf[i * SKIN_K + k] = scored[k]!.ci * 9;
        t.sW[i * SKIN_K + k] = scored[k]!.w;
      }
    };
  }

  /**
   * The body paint's A5 tables (`buildSkinWeights`) for the points of a mesh outside the body skin, `rest` in the mesh's frame seated at car-frame
   * `origin`: a door shell skins by them as the paint around it does (`skinPoints`). Rest-only: built once per mesh. `only`: the masses (names) its
   * points take as parents, where a part rides a few of them.
   */
  bindPoints(rest: Float32Array, origin: THREE.Vector3, only?: readonly string[]): PointSkin {
    const count = rest.length / 3;
    const t: PointSkin = { count, sN: new Uint8Array(count), sXf: new Int32Array(count * SKIN_K), sW: new Float64Array(count * SKIN_K), rJ: new Int32Array(count * RES_SLOTS), rW: new Float64Array(count * RES_SLOTS), rC: new Float64Array(count * 3) };
    const zones = this.skinZones();
    const parents = this.parentRule(zones, only?.map((name) => this.masses.findIndex((m) => m.name === name)));
    const clusters = this.clusterRule(zones, this.clusterCentres());
    for (let i = 0; i < count; i++) {
      const rx = rest[i * 3]! + origin.x;
      const ry = rest[i * 3 + 1]! + origin.y;
      const rz = rest[i * 3 + 2]! + origin.z;
      parents(rx, ry, rz, i, t);
      clusters(rx, ry, rz, zones.cellOnly(rx, ry, rz, this.archHub(rx, ry, rz)), i, t);
    }
    return t;
  }

  /** Rest-only skin tables: cluster weights per vertex and cage corner, the parent masses of every skin point (A5), the hub that plants each arch vertex. */
  private buildSkinWeights(): void {
    const n = this.vertexCount;
    const points = n + this.cages.length * 8;
    this.skinN = new Uint8Array(n);
    this.skinXf = new Int32Array(n * SKIN_K);
    this.skinW = new Float64Array(n * SKIN_K);
    this.skinHub = new Int32Array(n).fill(-1);
    this.resJ = new Int32Array(points * RES_SLOTS);
    this.resW = new Float64Array(points * RES_SLOTS);
    this.resC = new Float64Array(points * 3);
    this.massPos = new Float64Array(this.masses.length * 3);
    this.clusterXf = new Float64Array(this.clusters.length * 9);
    const t: SkinPointTables = { sN: this.skinN, sXf: this.skinXf, sW: this.skinW, rJ: this.resJ, rW: this.resW, rC: this.resC };
    const cms = this.clusterCentres();
    const zones = this.skinZones();
    const parents = this.parentRule(zones);
    const clusters = this.clusterRule(zones, cms);
    for (let i = 0; i < n; i++) {
      const rx = this.restPos[i * 3]!;
      const ry = this.restPos[i * 3 + 1]!;
      const rz = this.restPos[i * 3 + 2]!;
      parents(rx, ry, rz, i, t);
      this.skinHub[i] = this.archHub(rx, ry, rz);
      clusters(rx, ry, rz, zones.cellOnly(rx, ry, rz, this.skinHub[i]!), i, t);
    }
    this.bindCorners(n, cms, parents, t);
  }

  /** The clusters that hold the cell: what a cabin point's cluster weights are drawn from (D1). */
  private clustersHoldingCell(): boolean[] {
    const cell = this.masses.indexOf(this.at.cell);
    return this.clusters.map((c) => c.idx.includes(cell));
  }

  /**
   * Cage corners follow the clusters within 1.4 m of their rest position (`solveCagesFromShape`), and their A5 parents as skin points `n + j`.
   * A door cage's corners hang on the cabin: its masses and its cell-holding clusters only, so the rear axle and tank, which a side hit's tyres
   * hold back while the cabin is shoved, do not shear the far door's frame (and its glass) by centimetres. The windscreen's hang there too, with
   * the A-pillar foot's share of the nose (`parentRule`'s `foot`): its base corners took the rails' and the engine's masses, which a nose hit moves before the cabin has moved at all.
   */
  private bindCorners(n: number, cms: readonly { x: number; y: number; z: number }[], parents: SkinParentRule, t: SkinPointTables): void {
    const start: number[] = [0];
    const xf: number[] = [];
    const ws: number[] = [];
    this.cornerWsum = new Float64Array(this.cages.length * 8);
    const holdsCell = this.clustersHoldingCell();
    for (let j = 0; j < this.cages.length * 8; j++) {
      const cage = this.cages[j >> 3]!;
      const rest = cage.restCorners[j & 7]!;
      const foot = cage.spec.name === "glassFront";
      const hung = foot || cage.spec.name.startsWith(PART_FAMILY.door);
      parents(rest.x, rest.y, rest.z, n + j, t, hung, foot);
      let wsum = 0;
      for (let ci = 0; ci < this.clusters.length; ci++) {
        if (hung && !holdsCell[ci]) continue;
        const cm = cms[ci]!;
        const d = hypot3(rest.x - cm.x, rest.y - cm.y, rest.z - cm.z);
        if (d > 1.4) continue;
        const w = Math.exp(-d * 2.35);
        xf.push(ci * 9);
        ws.push(w);
        wsum += w;
      }
      start.push(xf.length);
      this.cornerWsum[j] = wsum;
    }
    this.cornerStart = Int32Array.from(start);
    this.cornerXf = Int32Array.from(xf);
    this.cornerW = Float64Array.from(ws);
  }

  /** `simState`: every scalar field as a double (declaration order: a saved clip’s layout, `REPLAY_VERSION`, fixes it). Returns the offset after them. */
  protected simScalarsOut(buf: Float64Array, o: number): number {
    buf[o] = this.crushAmount;
    buf[o + 1] = this.massActive ? 1 : 0;
    buf[o + 2] = this.drivetrainAlive ? 1 : 0;
    buf[o + 3] = this.engineTravel;
    buf[o + 4] = this.killTravel;
    buf[o + 5] = this.wreckEnergy;
    buf[o + 6] = this.wear;
    buf[o + 7] = this.bidirectional ? 1 : 0;
    buf[o + 8] = this.squeezeShape ? 1 : 0;
    buf[o + 9] = this.deepShape ? 1 : 0;
    buf[o + 10] = this.faceContacts;
    buf[o + 11] = this.squeezed ? 1 : 0;
    buf[o + 12] = this.frameCrush ? 1 : 0;
    buf[o + 13] = this.wheelsDetach ? 1 : 0;
    buf[o + 14] = this.vertexCount;
    buf[o + 15] = this.elapsed;
    buf[o + 16] = this.lastContact;
    buf[o + 17] = this.crushing ? 1 : 0;
    buf[o + 18] = this.impulse;
    buf[o + 19] = this.hitSpeed;
    buf[o + 20] = this.floorsFresh ? 1 : 0;
    buf[o + 21] = this.energyTravel ? 1 : 0;
    buf[o + 22] = this.lastPower;
    buf[o + 23] = this.hitAt;
    buf[o + 24] = this.wrinkleAmp;
    buf[o + 25] = this.cornerLow;
    buf[o + 26] = this._totalMass;
    buf[o + 27] = this.prevYaw;
    buf[o + 28] = this.lean;
    buf[o + 29] = this.leanAt;
    buf[o + 30] = this.aloft ? 1 : 0;
    buf[o + 31] = this.frameY;
    buf[o + 32] = this.frameAt;
    buf[o + 33] = this.frameVy;
    buf[o + 34] = this.push.x;
    buf[o + 35] = this.push.at;
    buf[o + 36] = this.overlapFrame ? 1 : 0;
    buf[o + 37] = this.contactAt;
    buf[o + 38] = this.shapeRan ? 1 : 0;
    buf[o + 39] = this.shapeWasLive ? 1 : 0;
    buf[o + 40] = this.bodyCos;
    buf[o + 41] = this.bodySin;
    buf[o + 42] = this.squash;
    buf[o + 43] = this.buckle;
    buf[o + 44] = this.netPopped;
    buf[o + 45] = this.netFlags;
    buf[o + 46] = this.push.z;
    buf[o + 47] = this.frozen ? 1 : 0;
    buf[o + 48] = this.frozenReady ? 1 : 0;
    buf[o + 49] = this.sinceThaw;
    buf[o + 50] = this.frozenCentre.x;
    buf[o + 51] = this.frozenCentre.y;
    buf[o + 52] = this.frozenCentre.z;
    buf[o + 53] = this.frozenInvI.x;
    buf[o + 54] = this.frozenInvI.y;
    buf[o + 55] = this.frozenInvI.z;
    buf[o + 56] = this.solidHold[0]!;
    buf[o + 57] = this.solidHold[1]!;
    return o + SIM_SCALAR_NUMBERS;
  }

  protected simScalarsIn(buf: Float64Array, o: number): number {
    this.crushAmount = buf[o]!;
    this.massActive = buf[o + 1]! !== 0;
    this.drivetrainAlive = buf[o + 2]! !== 0;
    this.engineTravel = buf[o + 3]!;
    this.killTravel = buf[o + 4]!;
    this.wreckEnergy = buf[o + 5]!;
    this.wear = buf[o + 6]!;
    this.bidirectional = buf[o + 7]! !== 0;
    this.squeezeShape = buf[o + 8]! !== 0;
    this.deepShape = buf[o + 9]! !== 0;
    this.faceContacts = buf[o + 10]!;
    this.squeezed = buf[o + 11]! !== 0;
    this.frameCrush = buf[o + 12]! !== 0;
    this.wheelsDetach = buf[o + 13]! !== 0;
    this.vertexCount = buf[o + 14]!;
    this.elapsed = buf[o + 15]!;
    this.lastContact = buf[o + 16]!;
    this.crushing = buf[o + 17]! !== 0;
    this.impulse = buf[o + 18]!;
    this.hitSpeed = buf[o + 19]!;
    this.floorsFresh = buf[o + 20]! !== 0;
    this.energyTravel = buf[o + 21]! !== 0;
    this.lastPower = buf[o + 22]!;
    this.hitAt = buf[o + 23]!;
    this.wrinkleAmp = buf[o + 24]!;
    this.cornerLow = buf[o + 25]!;
    this._totalMass = buf[o + 26]!;
    this.prevYaw = buf[o + 27]!;
    this.lean = buf[o + 28]!;
    this.leanAt = buf[o + 29]!;
    this.aloft = buf[o + 30]! !== 0;
    this.frameY = buf[o + 31]!;
    this.frameAt = buf[o + 32]!;
    this.frameVy = buf[o + 33]!;
    this.push.x = buf[o + 34]!;
    this.push.at = buf[o + 35]!;
    this.overlapFrame = buf[o + 36]! !== 0;
    this.contactAt = buf[o + 37]!;
    this.shapeRan = buf[o + 38]! !== 0;
    this.shapeWasLive = buf[o + 39]! !== 0;
    this.bodyCos = buf[o + 40]!;
    this.bodySin = buf[o + 41]!;
    this.squash = buf[o + 42]!;
    this.buckle = buf[o + 43]!;
    this.netPopped = buf[o + 44]!;
    this.netFlags = buf[o + 45]!;
    this.push.z = buf[o + 46]!;
    this.frozen = buf[o + 47]! !== 0;
    this.frozenReady = buf[o + 48]! !== 0;
    this.sinceThaw = buf[o + 49]!;
    this.frozenCentre.set(buf[o + 50]!, buf[o + 51]!, buf[o + 52]!);
    this.frozenInvI.set(buf[o + 53]!, buf[o + 54]!, buf[o + 55]!);
    this.solidHold[0] = buf[o + 56]!;
    this.solidHold[1] = buf[o + 57]!;
    return o + SIM_SCALAR_NUMBERS;
  }
}
