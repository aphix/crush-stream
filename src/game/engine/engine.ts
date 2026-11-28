// First: every quaternion built from here on, constants at load included, takes the engine-identical trig (kernel/three-trig.ts).
import "../kernel/three-trig.ts";
import { takeTierWork } from "../kernel/tier-work.ts";
import { COUNT, countPart, lapPart, PART } from "../kernel/frame-parts.ts";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { hidingSight, sightLine, type Occluder } from "../present/spectate-cam.ts";
import { holdHidden, holdWaits } from "./skin-hold.ts";
import { EYE_HEIGHT } from "../ai/openworld-crime/crime-constants.ts";
import { PISTON_ORBIT_RATE, PistonBank } from "../present/engine-pistons.ts";
import { DoorRam } from "../present/engine-doors.ts";
import { sliceSpeed } from "../contact/sat.ts";
import { PACE_BUDGET_MS, SimPacer } from "./sim-pace.ts";
import { QUALITY_QUERY, SETTING_KEY } from "./constants.ts";
import { PoseBlend } from "../present/pose-blend.ts";
import { INITIAL_HUD, type HudStore } from "../hud/hud-store.ts";
import { easeTimeScale, PRE_IMPACT_LEAD, preImpact, stepPhase, struck } from "../match/phase.ts";
import { settleStep, stepWorld } from "./world-step.ts";
import { lap, PHASE, startLaps } from "./sim-phases.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { GROUND_LEVEL, LAB_PRESET } from "../scenes/constants.ts";
import { groundMaterial, levelOrder } from "../scenes/ground-stack.ts";
import { carClass, damageStage, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { makeJerseyBarrier, makePoolTexture } from "../present/engine-world.ts";
import { Cinematics } from "../present/engine-cine.ts";
import { CAR_HIT, WALL_HIT } from "../present/hit-foot.ts";
import { setReliefDevice } from "../present/surface-relief.ts";
import { FX_TIERS } from "../present/engine-post.ts";
import { SKY_MODES } from "../present/sky-dome.ts";
import { sceneryShare } from "./scenery-share.ts";
import { AutoFx, deviceClass, gpuRenderer, type DeviceClass } from "../present/auto-fx.ts";
import { PHONE_LEVEL } from "../present/car-detail.ts";
import { DetailGovernor } from "../present/detail-governor.ts";
import { DRAW_DISTANCES, knobValue, PlayerQuality, RENDER_SCALES, SHADOW_QUALITIES } from "../present/player-quality.ts";
import { makeRenderer } from "./engine-renderer.ts";
import { checkUploads, uploadCheckAsked } from "./upload-check.ts";
import { DebrisSystem, SparkSystem, GlassDotSystem, TireSmokeSystem } from "../present/engine-fx.ts";
import { Fountains } from "./engine-fountains.ts";
import { GameAudio, type AmbientScene } from "../present/game-audio.ts";
import { propSoundMat } from "../present/hit-sound.ts";
import { AudioFeed, STEEL } from "./engine-audio-feed.ts";
import { coursePlace, DEFAULT_PLACE, hourOfDay, UiCues } from "./engine-audio-cues.ts";
import { ShotFx } from "../present/shot-fx.ts";
import { gunModel } from "../present/weapon-models.ts";
import { tagMaterial } from "../vehicle/material-class.ts";
import { MAT, MATERIALS } from "../kernel/material-ids.ts";
import { LookRay } from "../ai/civilians/civilian-look.ts";
import { HandGuns } from "./engine-hand-gun.ts";
import type { RacePhase } from "../match/types.ts";
import { COUNTDOWN } from "../match/session.ts";
import { RemoteGuns } from "./engine-remote-guns.ts";
import { slotOfWeapon } from "./engine-onfoot-arms.ts";
import type { CarPick, DollPick } from "./engine-openworld.ts";
import { FX_REACH } from "../present/witness.ts";
import { RagdollSystem } from "../present/engine-ragdoll.ts";
import { WALKER_SLOT } from "../present/ragdoll-pool.ts";
import { VIP_LOOK } from "../present/dummy-dress.ts";
import { presentedRate } from "../present/dummy-jiggle.ts";
import { OnFootDirector } from "./engine-onfoot.ts";
import { OpenWorldDirector } from "./engine-openworld.ts";
import { OpenWorldActs } from "./engine-openworld-acts.ts";
import type { ActorPlace } from "./engine-openworld-law.ts";
import { OpenWorldSeats } from "./engine-openworld-seats.ts";
import { SeatRiders } from "../present/seat-riders.ts";
import { SeatTable } from "../scenes/seat-table.ts";
import { RayNearest } from "./ray-nearest.ts";
import { type AutoOrbit, autoOrbitOf } from "./engine-openworld-auto.ts";
import { STORE_AT } from "../ai/openworld-traffic/traffic-constants.ts";
import { TrafficLightArt } from "../present/traffic-lights.ts";
import { wearCarLook } from "../present/car-look.ts";
import { TrafficDress } from "./traffic-dress.ts";
import { RagdollBodyHost } from "./ragdoll-body-host.ts";
import { RemoteCables } from "./openworld-cables.ts";
import type { BodyMotion } from "../net/body-codec.ts";
import { DRIVER_SIDE } from "../vehicle/constants.ts";
import { applyCarFinish, finishForTier } from "../vehicle/car-finish.ts";
import { NO_CAR_PICK } from "../match/look-data.ts";
import { layOnGround } from "../vehicle/car-air-points.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { buildRoadNetwork } from "../world/openworld/openworld-roads.ts";
import { CivilianArt } from "../present/civilian-art.ts";
import { AnimalArt } from "../present/animal-art.ts";
import { FacadeBays } from "../present/facade-bays.ts";
import { InteriorSet } from "../present/interiors/interior-art.ts";
import { DETAIL_SLOTS, NEAR_SLOTS } from "../present/civilian-art-constants.ts";
import { OpenWorldSigns } from "../present/openworld-signs.ts";
import { POPULATION_TIER } from "../ai/civilians/civilian-crowd-constants.ts";
import { PUNCH_LIFT, PUNCH_SPEED } from "../ai/civilians/civilian-constants.ts";
import type { OpenWorldMap } from "../world/openworld/walk-graph.ts";
import { buildOpenWorldMap } from "../world/openworld/openworld-map.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { homeFrontages } from "../world/openworld/openworld-facade-solids.ts";
import type { ChaseHud, LookAtHud } from "../hud/hud-store.ts";
import type { CrowdLink } from "../net/net-ports.ts";
import { TetherDirector } from "./engine-tether.ts";
import { ownLook } from "../present/driver-look.ts";
import { throwComing } from "../present/ragdoll-trigger.ts";
import { ChaseCamera, SHAKE_DECAY_PER_S, type SpecScene } from "../present/engine-camera.ts";
import { centroid } from "../present/orbit-shots.ts";
import { blankFreeInput, sceneExtent } from "../present/free-cam.ts";
import { MINIGAME_AIM_LEAD } from "../present/ride-cam.ts";
import { MINIGAME_MODE, THROW_BOOST } from "../scenes/minigame-constants.ts";
import type { ReleaseScale } from "../present/ragdoll-boxes.ts";
import type { Ejection } from "../vehicle/ejection.ts";
import { readFreeInput } from "./engine-free.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { armTops } from "../world/surfaces.ts";
import { thinScenery } from "../world/scenery.ts";
import { CompactorPress, JerseyBarrier, type ContactHit } from "../scenes/engine-props.ts";
import { FleetRamps } from "../scenes/fleet-ramps.ts";
import { Corkscrew } from "../scenes/corkscrew.ts";
import { TraceRecorder } from "./engine-trace.ts";
import { snapshotAiCar } from "../match/derby.ts";
import { LampLights, lampPoolFor } from "../vehicle/lamp-lights.ts";
import { applyDrive, carRuns, COAST, idleDrive, type DriveInput } from "../vehicle/car-drive.ts";
import { applyAiDrive } from "../ai/input-fade.ts";
import { makeDerbyArena, WinnerSpot } from "../scenes/derby-arena.ts";
import { NetPlay } from "../net/net-play.ts";
import { RaceDirector } from "./engine-race.ts";
import { ReelDirector } from "./engine-highlights.ts";
import { PodiumDirector } from "./engine-podium.ts";
import { TrackArt } from "../present/track-art.ts";
import { reliefForTier } from "../present/surface-relief.ts";
import { EngineGarage } from "./engine-garage.ts";
import { detTan } from "../kernel/det-tan-core.js";
import { detSin, detCos } from "../kernel/physics-core.js";
import { SHOT_SPARK_IMPULSE, SMOKE_PUFF_HZ, SPARK_MIN_IMPULSE } from "./constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { firstMassContact } from "./car-contact-scan.ts";

const FIXED = 1 / FRAME_HZ;
/** Share of a course's drawn-only scenery (`thinScenery`) each effects tier draws: the cheap tiers a third, Low three fifths, High and above all of it. */
/** Deform LoD: sphere around a car — rest half-diagonal 2.5 m plus crumple slack and the
 *  ≈0.9 m the sun throws the roof's shadow, so an off-screen car's shadow is never stale either. */
const LOD_RADIUS = 3.5;
/** Projected sphere radius (CSS px) below which a car skins every 2nd / every 4th frame. */
const LOD_SMALL_PX = 40;
const LOD_TINY_PX = 20;
const _lodCenter = new THREE.Vector3();
const _v = new THREE.Vector3();
const _footVelocity = new THREE.Vector3();
const _actorSpot: ActorPlace = { x: 0, y: 0, z: 0, heading: 0, velocityX: 0, velocityZ: 0 };
const _actorMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _ownMotion: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
/** The seat table of every scene but the open world: nobody sits in it. */
const NOBODY_SEATED = new SeatTable();
const _hand = new THREE.Vector3();
const _gunRest = new THREE.Vector3();
const _gunAim = new LookRay();
const _bn = new THREE.Vector3();
const _bp = new THREE.Vector3();
/** The live cars' groups and the nearest hit for a bullet's car pick (`pickCar`): refilled each shot, so a shot allocates nothing of its own. */
const _carGroups: THREE.Object3D[] = [];
const _carHit = new RayNearest();
/** No cars: the showcase's set outside its scene. */
const NO_CARS: readonly DeformableCar[] = [];
const NO_SOLIDS: readonly Occluder[] = [];

export class CrashEngine extends EngineGarage {
  /** Resolves when `warmPrograms` is done (a failure is logged): the loop simulates and draws only after it, so play never links a program. */
  readonly ready: Promise<void>;
  /** A client draws host snapshots instead of simulating. */
  readonly net = new NetPlay({
    cars: () => this.live(),
    // The host's field size. Race and derby own their field (they seat peers at their next start), and a
    // client takes the host's cars without the sandbox reset.
    setCarCount: (n) => (this.race.active || this.derbyMode || this.net.client ? this.ensureCars(n) : this.setCarCount(n)),
    matchCar: (i, style, cls) => this.matchCar(i, style, cls),
    setRealism: (v) => this.setRealism(v),
    phase: () => this.clock.phase,
    timeScale: () => this.clock.timeScale,
    mirrorClock: (phase, timeScale) => {
      this.clock.phase = phase;
      this.clock.timeScale = timeScale;
      this.clock.targetScale = timeScale;
    },
    race: () => (this.race.active ? this.race : null),
    enterRace: (survival, lobby = false) => {
      if (this.race.active) {
        if (this.race.survival === survival && (!lobby || this.race.free)) {
          // A room hosted or joined from the solo open world takes its lobby over: the scene is the room's from here.
          if (this.sceneId === "openworld") this.sceneId = "race";
          return;
        }
        this.setRace(false);
      }
      this.setRace(true, survival, lobby);
      this.emitHud();
    },
    resetLobbyCar: (i) => this.race.resetLobbyCar(this.resetCarOf(i)),
    resetLobbyScene: () => this.randomizeAndReset(),
    exitRace: () => {
      if (!this.race.active) return;
      this.setRace(false);
      this.randomizeAndReset();
      this.emitHud();
    },
    startRace: () => this.raceCommand({ type: "start" }),
    setSeats: (seats) => {
      this.netSeats = seats;
      // A peer who leaves mid-match hands its car back to the AI.
      for (const i of this.derbySeated) if (!seats.has(i)) this.derbySeated.delete(i);
      if (this.race.active) this.race.setSeats(seats);
    },
    playerName: () => this.race.playerName,
    hostFit: () => this.autoFx.canHost(),
    remoteDrivable: (i) => !this.derbyMode || (this.derbySeated.has(i) && !this.derby.held(i) && this.cars[i]?.driverOut === null),
    derbyPhase: () => (!this.derbyMode ? null : !this.derby.active ? "lobby" : this.derby.winnerId == null ? "running" : "over"),
    derbyState: () => this.derbyNetState(),
    applyDerby: (s, self) => this.applyNetDerby(s, self),
    derbyLobby: (field) => this.netDerbyMatch(false, field),
    startDerby: (field) => this.netDerbyMatch(true, field),
    setVaporized: (i, on) => this.setVaporized(i, on),
    clearGen: () => this.clearGen(),
    clearScene: () => this.clearLocal(),
    playReel: (reel, startAt) => this.highlights.play(reel, startAt),
    reelPlaying: () => this.highlights.playing,
    launchEjection: (e) => {
      if (e.car !== this.awayCar() && !this.onFoot.takeEjected(e)) this.ragdolls.launch(e, this.live());
    },
    meterOf: (i) => this.meterOf(i),
    playerLook: () => this.playerLook(),
    wearLook: (i, look) => this.wearLook(i, look),
    dropLooks: () => this.dropLooks(),
    courseMenu: () => this.race.courseMenu(),
    crowdLink: () => this.crowdLink(),
    hearAct: (actor, act) => this.acts.hear(actor, act),
    seatTable: () => (this.showOpenWorld ? this.desk.table : null),
    seatsHeard: (notice) => this.desk.heardNotice(notice),
    drivenCar: () => this.drivenCar(),
    seat: this.seat,
  });
  /** The results reel and its solo view. */
  protected readonly highlights: ReelDirector;
  /** The podium over the course (docs/PODIUM.md). */
  protected readonly podium: PodiumDirector;
  /** The open world's society and crowd (docs/OPEN_WORLD.md). */
  private readonly openWorld: OpenWorldDirector;
  /** What every player on foot does at the host, and a guest's way to tell it (`MSG.act`). */
  private readonly acts: OpenWorldActs;
  /** Who sits where in the open world: the seat table and the functions that get a player in and out of a car (`MSG.seats`). */
  private readonly desk: OpenWorldSeats;
  /** The seated players as drawn (`SeatedDrivers`). */
  private readonly riders: SeatRiders;
  readonly pace = new SimPacer(true);
  private readonly blend = new PoseBlend();
  /** What a crashed car nobody drives rolls on: its drive's idle pedals (engine braking, the test world's IDLE). */
  private readonly wreckCoast = idleDrive();
  /** The car its player left on foot stands on its brakes, as a driver with his foot on the pedal does: no rule sees an empty seat. */
  private readonly standHold: DriveInput = { ...idleDrive(), brake: 1 };
  private readonly slice = (h: number): void => {
    const cars = this.live();
    const phases = this.world.phases;
    startLaps(phases);
    this.blend.begin(cars);
    this.fixedStep(h);
    this.elapsedSim += h;
    settleStep(cars, h, this.clock.wallSinceImpact > 0.2);
    lap(phases, PHASE.settle);
    this.blend.end(cars);
  };
  private readonly hitFx = (contact: THREE.Vector3, normal: THREE.Vector3, impulse: number): void => {
    if (this.elapsedWall - this.sparkAt < 0.12 || !this.witness.sees(contact, FX_REACH.debris)) return;
    this.sparkAt = this.elapsedWall;
    this.sparks.poof(contact, normal, Math.min(56, 12 + impulse * 1.2) * this.fxDensity);
    if (impulse > 6) this.debris.burst(contact, normal, Math.min(40, impulse * 1.5) * this.fxDensity);
  };
  /** The spark shower of a contact closing at `impulse`: two cars grinding (`fixedStep`), and a guard's shot landing on a car (`shotFx`). */
  private sparkShower(contact: THREE.Vector3, normal: THREE.Vector3, impulse: number): void {
    this.sparks.poof(contact, normal, Math.min(56, 18 + impulse * 0.8) * this.fxDensity);
  }
  /** A guard's shot landed on a car at `contact`: one shower a hit, on no throttle of its own (a car scraping at that moment must not swallow it), where the camera sees it. */
  private readonly shotFx = (contact: THREE.Vector3, normal: THREE.Vector3): void => {
    if (this.witness.sees(contact, FX_REACH.sparks)) this.sparkShower(contact, normal, SHOT_SPARK_IMPULSE);
  };
  /** The player's muzzle flash and tracers (the guards have their own in `People`). */
  private readonly playerShots = new ShotFx(1);
  /** What the player holds out in his right hand while a gun or the hook's launcher is the weapon in hand: one mesh that wears that weapon's model (`HandGuns.model`), coloured per vertex. */
  private readonly handGun = new THREE.Mesh(gunModel("pistol").geometry, tagMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 }), MAT.GUN_STEEL));
  /** The one source of the held gun's mesh and lengths per weapon (`HandGuns`). */
  private readonly handGuns = new HandGuns(this.handGun, this.playerShots.muzzles);
  /** The guns in the other players' hands, and their shots' flashes and tracers. */
  private readonly remoteGuns = new RemoteGuns(
    this.handGun.material,
    (car, hand, forearm) => this.bodyHand(car, hand, forearm),
    (car, held) => this.raiseBodyArm(car, held),
    (weapon) => {
      if (this.audioOn) this.audio.shot(weapon);
    },
  );
  /** A gun was posed in the player's hand this frame: its muzzle is where a shot leaves from. */
  private gunPosed = false;

  /** What this device is (`deviceClass`), decided once from the GL context, the pointer and the user agent. */
  protected readonly deviceClass: DeviceClass;

  constructor(canvas: HTMLCanvasElement, hudStore: HudStore, veil: HTMLElement) {
    super();
    this.canvas = canvas;
    this.veil = veil;
    this.hudStore = hudStore;
    this.clock.reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.lab.load(LAB_PRESET.cards);
    this.lab.fx = this.hitFx;

    const watchUploads = (gl: WebGL2RenderingContext): void => checkUploads(gl, () => ({ scene: this.scene, tier: this.cine.tier }));
    this.renderer = makeRenderer(canvas, uploadCheckAsked(window.location.search) ? watchUploads : undefined);
    const gl = this.renderer.getContext();
    const kind = deviceClass(gpuRenderer(gl), window.matchMedia("(pointer: fine)").matches, (navigator as Navigator & { userAgentData?: { mobile: boolean } }).userAgentData?.mobile === true);
    this.deviceClass = kind;
    const desktop = kind === "desktop";

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 180);
    this.view = new ChaseCamera(this.camera, canvas, this.seat, this.pad.state, this.clock.reduceMotion, {
      at: (x, y) => this.carAt(x, y),
      choose: (car) => this.watchCar(car),
    });

    this.scene.background = new THREE.Color(0x12141a);
    this.scene.fog = new THREE.FogExp2(0x12141a, 0.008);
    const env = this.attachStudioEnv();

    this.buildWorld();
    this.view.posts = this.poles;
    this.arena = makeDerbyArena(this.derbyGround);
    this.scene.add(this.arena);
    this.winnerSpot = new WinnerSpot(this.scene, makePoolTexture());
    this.barrier = new JerseyBarrier(this.scene, makeJerseyBarrier());
    this.ramps = new FleetRamps(this.scene);
    this.corkscrew = new Corkscrew(this.scene);
    this.press = new CompactorPress(this.scene, this.compactor.face);
    this.pistonBank = new PistonBank(this.scene, this.pistons);
    this.doorRam = new DoorRam(this.scene);

    this.glassDots = new GlassDotSystem(this.scene);
    this.ensureCars(INITIAL_HUD.carCount);
    this.scene.add(this.wheels.group, ...this.lampBatch.meshes, ...this.partBatch.meshes, this.partBatch.looseWarm, this.seated.mesh, this.coverBatch.group);
    // Under the wheel shadow prisms, shown to the shadow pass alone: the casters cost no camera-pass draw.
    this.wheels.meshes.at(-1)!.add(...this.partBatch.casters);
    const driverLook = (car: number) => this.ragdolls.carDriverLook(car);
    const uniform = (car: number, cop: boolean) => this.ragdolls.uniformOn(car, cop);
    // After the renderer's scene matrix update, before culling/upload: every render path draws current wheels, lamps, parts and seated drivers.
    this.scene.onBeforeRender = (renderer) => {
      lapPart(PART.matrices);
      const drawn = this.drawnCars();
      this.wheels.sync(drawn, renderer);
      this.lampBatch.night = this.stage.night;
      this.lampBatch.sync(drawn);
      this.partBatch.sync(drawn);
      // In the garage the standing dummy beside the car is the driver, and the showcase's cars show their empty cabins: no one sits in the car there. A car its player left on foot has nobody in it either.
      this.seated.sync(this.showGarage || this.showShowcase ? [] : drawn, driverLook, uniform, this.awayCar(), this.parkedEmpty, this.riders);
      this.coverBatch.sync(drawn);
      lapPart(PART.batches);
    };

    this.debris = new DebrisSystem(this.scene);
    this.sparks = new SparkSystem(this.scene);
    this.fountains = new Fountains(this.scene);
    this.smoke = new TireSmokeSystem(this.scene);
    this.ragdolls = new RagdollSystem(this.scene, (i) => this.onThrow(i), (at, frame, inherit) => this.onExit(at, frame, inherit));
    this.ragdolls.poles = this.poles;
    this.ragdolls.lookOf = (car) => this.looks.of(this.driverActor(car), this.ownCar());
    this.ragdolls.actorLookOf = (actor) => this.looks.of(actor, this.ownCar());
    this.riders = new SeatRiders((actor) => this.ragdolls.riderLook(actor));
    this.lab.dolls = this.ragdolls;
    this.ragdolls.onPartHit = (car, part, energy, push) => {
      if (this.race.active) this.race.recorder.partHit(car, part, energy, push.x, push.y, push.z);
    };
    this.onFoot = new OnFootDirector({
      ragdolls: this.ragdolls,
      seat: this.seat,
      view: this.view,
      camera: this.camera,
      keys: this.keys,
      pad: this.pad.state,
      touch: this.pad.touch,
      cars: () => this.live(),
      available: () => this.onFootOffered(),
      racing: () => this.race.active,
      look: () => ownLook(this.looks.mine.person),
      sight: () => this.chaseSight(true),
      openWorld: () => this.showOpenWorld,
      runsCars: () => !this.net.client,
      guest: () => this.net.client,
      bodyHost: this.bodyHost,
      freshCarNear: (index, x, z, facing) => this.race.placeNear(index, x, z, facing),
      respawn: () => this.requestRespawn(),
      adopt: (index) => {
        if (this.race.adoptCar(index)) this.adoptedCar = index;
      },
      desk: () => (this.showOpenWorld ? this.desk : null),
      sitDown: (seat) => this.riders.sitDown(this.ownCar(), seat),
      mouseCaptured: () => this.mouseLook.on,
      captureMouse: (on) => {
        if (!on) this.mouseLook.exit();
        else if (!this.mouseLook.on) this.toggleMouseLook();
      },
      punchLanded: (dirX, dirZ) => this.acts.punchLanded(dirX, dirZ),
      aimRay: (centre, out) => this.aimRay(centre, out),
      shootRay: (aim, gun) => this.acts.shootLocal(aim, gun),
      shotFired: (ray, far) => this.shotFired(ray, far),
      hook: () => this.tether.fire(),
    });
    this.view.click = () => {
      if (!this.onFoot.armed()) return false;
      this.onFoot.arms.press();
      this.onFoot.arms.release();
      return true;
    };
    this.tether = new TetherDirector({
      tethers: this.world.tethers,
      camera: this.camera,
      scene: this.scene,
      ropes: this.ragdolls,
      movers: () => [this.wheels.group, ...this.lampBatch.meshes, ...this.partBatch.meshes, this.partBatch.looseWarm, this.coverBatch.group, ...this.balls.map((ball) => ball.mesh)],
      cars: () => this.live(),
      playerCar: () => -1,
      offered: () => this.tetherOffered(),
      chase: () => false,
      afoot: () => this.onFoot.afootInOpenWorld,
      self: () => WALKER_SLOT,
      actor: () => this.ownCar(),
      actorSlot: (actor) => this.openWorld.playerSlot(actor),
      actorAfoot: (actor) => this.openWorld.playerPlace(actor, _actorSpot),
      guest: () => this.net.client,
      hostHolds: () => this.openWorld.hookHeld(),
      hostHoldAt: (out) => this.openWorld.hookHeldAt(out),
      hostCables: () => this.openWorld.hookCount(),
      sendAct: (kind, arg, eye, dir, name) => this.net.sendAct(kind, arg, eye, dir, name),
      nameHook: (civilian, slot, x, y, z, out) => this.openWorld.nameHook(civilian, slot, x, y, z, out),
      personMet: (ray, reach, out, remote) => this.openWorld.hookMet(ray, reach, out, remote),
      standPerson: (civilian, eyeX, eyeZ, actor) => this.openWorld.hookBody(civilian, eyeX, eyeZ, actor),
      holdDoll: (slot) => this.openWorld.hookPin(slot),
    });
    this.scene.add(this.tether.art.group);
    this.scene.add(this.remoteCables.art.group);
    this.cine = new Cinematics(this.renderer, this.scene, this.view, { sparks: this.sparks, fountains: this.fountains.jets, glass: this.glassDots, witness: this.witness }, MAX_CARS, this.clock.reduceMotion, () => this.queueWarm());
    // `?fx=off|minimal|low|high|ultra` picks the tier for the session (bench A/B); the auto tier otherwise. Ultra loads after boot (below).
    const fxParam = FX_TIERS.find((t) => t === new URLSearchParams(window.location.search).get(SETTING_KEY.fx));
    this.cine.marks.phone = !desktop;
    this.cine.post.phone = !desktop;
    this.stage.phone = !desktop;
    setReliefDevice(desktop);
    this.cine.setTier(fxParam === "ultra" ? "high" : (fxParam ?? INITIAL_HUD.fxTier));
    // `?sky=0|1|auto|on|off` pins the Sky setting for the session (bench A/B).
    const skyParam = new URLSearchParams(window.location.search).get(SETTING_KEY.sky);
    this.stage.setSky(skyParam === "0" ? "off" : skyParam === "1" ? "on" : (SKY_MODES.find((m) => m === skyParam) ?? INITIAL_HUD.sky));
    this.stage.setProceduralSky(INITIAL_HUD.proceduralSky);
    this.autoFx = new AutoFx(kind !== "software", fxParam === undefined, desktop);
    // A phone starts on the nearer rung (a ~20 px car loses nothing the eye can use); the governor walks either way from the first match.
    this.detailGov = new DetailGovernor(desktop ? 0 : PHONE_LEVEL);
    this.detail.setLevel(this.detailGov.level);
    this.quality = new PlayerQuality({ renderer: this.renderer, camera: this.camera, scene: this.scene, stage: this.stage, detail: this.detail, post: this.cine.post }, window.devicePixelRatio || 1);
    // `?draw=`, `?scale=`, `?shadow=` pin those knobs for the session (bench A/B); the HUD's pick still wins.
    const query = new URLSearchParams(window.location.search);
    this.quality.pinFromPage(knobValue(DRAW_DISTANCES, query.get(QUALITY_QUERY.draw)), knobValue(RENDER_SCALES, query.get(QUALITY_QUERY.scale)), knobValue(SHADOW_QUALITIES, query.get(QUALITY_QUERY.shadow)));
    this.audio = new GameAudio(this.camera, desktop);
    this.audio.setVolumes(this.musicVolume, this.engineVolume);
    this.audioFeed = new AudioFeed(
      {
        hit: (e) => this.audio.hit(e),
        scrape: (id, speed, force, x, y, z, a, b) => this.audio.scrape(id, speed, force, x, y, z, a, b),
      },
      () => this.live(),
    );
    this.uiCues = new UiCues((name) => this.uiSound(name));
    this.trace = new TraceRecorder({
      barrier: this.barrier,
      balls: this.balls,
      sparks: this.sparks,
      smoke: this.smoke,
      debris: this.debris,
      ragdolls: this.ragdolls,
    });
    this.impactLight = new THREE.PointLight(0xffc27a, 0, 22, 2);
    this.scene.add(this.impactLight);
    this.scene.add(this.playerShots.group, this.handGun);
    this.scene.add(this.remoteGuns.group);
    this.handGun.visible = false;
    // Four body lamps per car plus at most one lit siren; a phone links the lean pool (`lampPoolFor`). Fixed here, before the programs
    // link: a light-count change relinks every lit shader.
    this.lampLights = new LampLights(this.scene, MAX_CARS * 5, lampPoolFor(desktop, new URLSearchParams(window.location.search).get("lamps")));
    this.lampLights.middleTile = desktop;
    groundMaterial(this.lampLights.pools.material as THREE.Material, GROUND_LEVEL.decal);
    this.lampLights.pools.renderOrder = levelOrder(GROUND_LEVEL.decal);
    this.race = this.makeRace();
    this.race.drivers = (car) => this.driverActor(car);
    this.highlights = this.makeHighlights();
    this.podium = this.makePodium();
    this.openWorld = this.makeOpenWorld();
    this.desk = new OpenWorldSeats({
      cars: () => this.live(),
      poles: () => this.poles,
      place: (actor, out) => this.actorPlace(actor, out),
      active: () => this.showOpenWorld,
      peer: (actor) => this.netSeats.has(actor),
      self: () => this.ownCar(),
      guest: () => this.net.client,
      canTake: (car) => this.canTakeCar(car),
      taken: (car) => this.openWorld.adopt(car),
      gas: () => this.seat.intent.gas,
      now: () => performance.now() / 1000,
      sendAct: (kind, arg, eye, dir) => this.net.sendAct(kind, arg, eye, dir),
    });
    this.acts = new OpenWorldActs(
      {
        actorPlace: (actor, out) => this.actorPlace(actor, out),
        now: () => performance.now() / 1000,
        self: () => this.ownCar(),
        guest: () => this.net.client,
        face: (dx, dz) => this.onFoot.steer.faceToward(dx, dz),
        layGun: (x, y, z, out) => this.layGun(x, y, z, out),
        sendAct: (kind, arg, eye, dir, name) => this.net.sendAct(kind, arg, eye, dir, name),
        seatedCar: (actor) => this.desk.table.carOf(actor),
        getIn: (actor, car) => this.desk.getIn(actor, car),
        getOut: (actor, door) => this.desk.getOut(actor, door),
        hookFire: (actor, ray, sawPerson) => void this.tether.fireFor(actor, ray, sawPerson),
        hookCut: (actor) => this.tether.cutFor(actor),
        hookReel: (actor, on) => this.tether.reelFor(actor, on),
      },
      this.openWorld,
    );
    this.startOpenWorld(buildOpenWorldMap(layOutLots()));

    this.resize();
    this.cacheCanvasRect();
    this.resizeObs = new ResizeObserver(() => {
      this.resize();
      this.cacheCanvasRect();
    });
    this.resizeObs.observe(canvas.parentElement ?? canvas);

    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    // three calls preventDefault on webglcontextlost (so the browser may restore) and rebuilds its own state on restore; the rest is ours.
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.pad.attach(() => this.emitHud());
    this.view.attach();
    canvas.addEventListener("pointerdown", this.onArmsDown);
    canvas.addEventListener("pointerup", this.onArmsUp);
    canvas.addEventListener("pointercancel", this.onArmsUp);
    canvas.addEventListener("contextmenu", this.onArmsMenu);
    try {
      // Applies the page's `#` as this first reset, so the first run already uses it.
      this.attachShare();
    } catch (err) {
      console.error("first reset failed", err);
      // The window listeners above would keep calling into a half-built engine nobody can dispose.
      this.dispose();
      throw err;
    }
    (window as unknown as { __crush?: CrashEngine }).__crush = this;
    this.emitHud();
    this.ready = this.warmPrograms(env)
      .catch((err: unknown) => console.error("Crush Stream program warm-up failed", err))
      .then(() => {
        this.warming = false;
        if (fxParam === "ultra") this.setFxTier("ultra");
        // Only a throw needs Rapier, so boot never waits for it: it loads in the background from here, and a car disabled before
        // it is in simply throws nobody (`EjectionWatch` only judges edges it saw). Its purse pool joins the scene then: warm it.
        this.ragdolls.preload().then(() => this.queueWarm(), (err: unknown) => console.error("Crush Stream ragdoll load failed", err));
      });
  }

  /** The open world's dummies' world as the bodies see it, shared by the bodies and the walker's host drag. */
  private readonly bodyHost = new RagdollBodyHost(() => this.ragdolls);
  /** The host's hook's cables as a guest draws them (`MSG.bodies`): empty on the host and in every scene but a room of the open world. */
  private readonly remoteCables = new RemoteCables();

  /** A car of the open world standing in a kerb space, or whose player is on foot, has nobody in it (`SeatedDrivers.sync`). */
  private readonly parkedEmpty = (id: number, car: DeformableCar): boolean => this.openWorld.carIsEmpty(id, car) || this.openWorld.playerAway(id);

  private makeOpenWorld(): OpenWorldDirector {
    const eyes = [this.camera];
    const playerCars: DeformableCar[] = [];
    const walkerStand = { group: { position: new THREE.Vector3() } };
    return new OpenWorldDirector({
      inOpenWorld: () => this.showOpenWorld,
      isClient: () => this.net.client,
      inRoom: () => this.net.role !== "off",
      seed: () => this.sceneSeed,
      mindsAuto: () => this.mindsAuto(),
      tier: () => (this.deviceClass !== "desktop" ? POPULATION_TIER.phone : this.cine.tier === "ultra" ? POPULATION_TIER.ultra : POPULATION_TIER.desktop),
      cars: () => this.live(),
      peerName: (carIndex) => (this.race.racers[carIndex]?.kind === "remote" ? this.race.racers[carIndex]!.name : null),
      ownCar: () => this.live()[this.drivenCar()] ?? null,
      foot: (out) => {
        if (!this.ragdolls.torso(WALKER_SLOT, _v, _footVelocity)) return false;
        out.x = _v.x;
        out.z = _v.z;
        out.velocityX = _footVelocity.x;
        out.velocityZ = _footVelocity.z;
        return true;
      },
      ownActor: () => this.ownCar(),
      placeCarNear: (actor, x, z, yaw) => this.race.placeNear(actor, x, z, yaw),
      now: () => performance.now() / 1000,
      eye: (ray) => {
        this.camera.getWorldDirection(_v);
        ray.eyeX = this.camera.position.x;
        ray.eyeY = this.camera.position.y;
        ray.eyeZ = this.camera.position.z;
        ray.dirX = _v.x;
        ray.dirY = _v.y;
        ray.dirZ = _v.z;
      },
      throwFigure: (strike, look, life) => this.ragdolls.throwFigure(strike, this.live(), look, life),
      removeFigure: (slot, spawn) => this.ragdolls.removeDummy(slot, spawn),
      spawnOf: (slot) => this.ragdolls.spawnOf(slot),
      bodies: this.bodyHost,
      footAnchor: (out) => this.onFoot.flow.active && this.bodyHost.motion(WALKER_SLOT, out),
      ownCarIndex: () => this.ownCar(),
      tethers: () => this.world.tethers,
      playerLook: (car) => this.ragdolls.carDriverLook(car),
      knockWalker: (vx, vy, vz) => this.onFoot.knocked(vx, vy, vz),
      dragWalker: (t) => this.onFoot.dragged(t),
      hookHold: (actor, out) => this.tether.heldPoint(actor, out),
      strikeWalker: (dirX, dirZ) => this.strikeOwnWalker(dirX, dirZ),
      staggerWalker: (dirX, dirZ) => this.staggerOwnWalker(dirX, dirZ),
      actorPlace: (actor, out) => this.actorPlace(actor, out),
      strikeActor: (victim, dirX, dirZ, knockedOut) => this.strikeActor(victim, dirX, dirZ, knockedOut),
      punchProp: (x, z, dirX, dirZ) => this.race.punchProp(x, z, dirX, dirZ),
      pickDoll: (actor, ray, range, out) => this.pickDoll(actor, ray, range, out),
      pickCar: (ray, range, out) => this.pickCar(ray, range, out),
      strikeDoll: (slot, x, y, z, ray, speed) => this.strikeDoll(slot, x, y, z, ray, speed),
      shotSparks: (x, y, z, ray) => this.shotFx(_p.set(x, y, z), _n.set(-ray.dirX, -ray.dirY, -ray.dirZ)),
      shootProp: (ray, limit, vx, vz) => this.race.shootProp(ray, limit, vx, vz),
      propMet: (ray, limit) => this.race.propMet(ray, limit),
      hookWallHits: (listener) => {
        const recorded = this.race.onWallHit;
        this.race.onWallHit = (i, closing, x, z) => {
          recorded(i, closing, x, z);
          listener(closing, x, z);
        };
        return () => {
          this.race.onWallHit = recorded;
        };
      },
      setDayHour: (hour) => {
        this.stage.setDayHour(hour);
        this.smoke.shade = this.cine.tyreSmoke.shade = this.stage.smokeShade;
      },
      makeFacades: (map) => {
        const kit = new FacadeBays(homeFrontages(map.places.filter((place) => place.doorNode >= 0)));
        this.scene.add(kit.group);
        this.queueWarm();
        return kit;
      },
      makeArt: (capacity) => {
        const desktop = this.deviceClass === "desktop";
        const art = new CivilianArt(desktop ? NEAR_SLOTS.desktop : NEAR_SLOTS.phone, capacity, desktop ? DETAIL_SLOTS.desktop : DETAIL_SLOTS.phone);
        this.scene.add(art.group);
        this.queueWarm();
        return art;
      },
      makeAnimals: (capacity) => {
        const animals = new AnimalArt(capacity);
        this.scene.add(animals.group);
        this.queueWarm();
        return animals;
      },
      signsOn: () => this.showTrackDebug,
      makeSigns: (places) => {
        const signs = new OpenWorldSigns(places);
        this.scene.add(signs.group, signs.spillGroup);
        return signs;
      },
      cull: {
        eyes: () => eyes,
        solids: () => {
          const sight = this.race.courseSight();
          return sight === null ? NO_SOLIDS : hidingSight(sight).occ;
        },
        playerCars: () => {
          const racers = this.race.racers;
          let count = 0;
          for (let at = 0; at < racers.length; at++) {
            const car = this.cars[racers[at]!.id];
            if (car !== undefined && racers[at]!.kind !== "ai") playerCars[count++] = car;
          }
          playerCars.length = count;
          return playerCars;
        },
        walker: () => (this.ragdolls.walkerTorso(walkerStand.group.position) ? walkerStand : null),
        others: (out, from) => this.openWorld.sightOthers(out, from),
        detail: () => this.detail,
        followed: () => this.followedCar(),
        replaying: () => this.highlights.playing,
      },
      law: {
        solids: () => this.race.courseObstacles(),
        playerBusted: (carIndex) => this.race.resetLobbyCar(carIndex),
        footArrest: {
          busted: () => this.onFoot.arrest(),
          led: (x, z) => this.onFoot.lead(x, z),
          taken: (carIndex) => this.onFoot.take(carIndex),
          delivered: (x, z, yaw) => this.onFoot.deliver(x, z, yaw),
        },
        sirens: (id, on) => {
          const car = this.cars[id];
          if (car && car.sirens !== on) car.setSirens(on);
        },
        lineOfSight: (ax, az, bx, bz) => {
          const sight = this.race.courseSight();
          if (sight === null) return true;
          const ground = activeGround();
          return sightLine(hidingSight(sight), ax, ground.heightAt(ax, az) + EYE_HEIGHT, az, bx, ground.heightAt(bx, bz) + EYE_HEIGHT, bz) >= 0;
        },
      },
      traffic: {
        cars: () => this.live(),
        ensureCars: (count) => this.ensureCars(count),
        seated: (id) => id === this.race.self || this.netSeats.has(id) || this.desk.table.takenMask(id) !== 0,
        place: (id, x, z, yaw, colour) => this.standTrafficCar(this.live()[id]!, x, z, yaw, colour),
        putAway: (id) => this.storeTrafficCar(this.live()[id]!, id),
        markPolice: (from, count) => this.setPolice(from, count),
        sirens: (id, on) => {
          const car = this.cars[id];
          if (car && car.sirens !== on) car.setSirens(on);
        },
        openDoor: (id, radians) => this.cars[id]?.setDoorOpen(DRIVER_SIDE, radians),
        groundAt: (x, z) => activeGround().heightAt(x, z, 0.5),
        setBody: (id, style) => this.matchCar(id, style, STYLE_CLASS[style]),
        release: (id) => {
          this.live()[id]!.stored = false;
        },
        setFreeDrivers: (drivers) => {
          this.race.freeDrivers = drivers;
        },
        makeLights: () => {
          const lights = new TrafficLightArt(buildRoadNetwork(openWorldGeometry(LAYOUT)));
          this.scene.add(lights.group);
          this.queueWarm();
          return {
            update: (seconds) => lights.update(seconds),
            dispose: () => {
              this.scene.remove(lights.group);
              lights.dispose();
            },
          };
        },
      },
      makeInteriors: (map) => {
        const interiors = new InteriorSet(map);
        this.scene.add(interiors.group);
        this.queueWarm();
        interiors.onSolids((boxes) => this.ragdolls.setFixedBoxes(boxes));
        return interiors;
      },
    });
  }

  /** The open world's traffic car stood on its street space: repaired, at rest, on the ground there, drawn and simulated. */
  /** What a traffic car needs each time it is stood on a space (`TrafficDress`). */
  private readonly trafficDress = new TrafficDress<DeformableCar>(
    (car) => this.dressCar(car),
    (car, colour) => {
      wearCarLook(car, { ...NO_CAR_PICK, body: colour }, null);
      applyCarFinish(car.group, finishForTier(this.cine.tier));
    },
  );

  /** Whether course `trackId`'s art draws the far scenery clumps: a desktop at the full scenery share. A phone, and the course's load for the ragdoll worker, leave them out. */
  private drawsFar(trackId: string): boolean {
    const desktop = this.deviceClass === "desktop";
    return desktop && sceneryShare(trackId, this.cine.tier, desktop) >= 1;
  }

  private standTrafficCar(car: DeformableCar, x: number, z: number, yaw: number, colour: number | null): void {
    car.stored = false;
    car.group.visible = true;
    car.spawnFacing(x, z, yaw, 0);
    car.group.position.y = activeGround().heightAt(x, z, 0.5);
    layOnGround(car);
    this.trafficDress.stand(car, colour);
  }

  /** The open world's traffic car put away far off the course: hidden, still, and not simulated (`EPICENTER.storedSkip`). */
  private storeTrafficCar(car: DeformableCar, id: number): void {
    car.stored = true;
    car.group.visible = false;
    car.spawnFacing(STORE_AT.x + id * STORE_AT.step, STORE_AT.z, 0, 0);
  }

  /** The map the open world's crowd lives on (the open world's builder line calls it once). */
  startOpenWorld(map: OpenWorldMap): void {
    this.openWorld.startOpenWorld(map);
  }

  protected override crowdLink(): CrowdLink | null {
    return this.openWorld.link();
  }

  protected override lookAtText(): LookAtHud | null {
    return this.openWorld.lookAt();
  }

  protected override bustText(): ChaseHud | null {
    return this.openWorld.bustOf(this.race.self);
  }

  protected override gameMinuteText(): number | null {
    return this.showOpenWorld ? this.openWorld.gameMinute() : null;
  }

  protected override get autoCamOn(): boolean {
    return this.showOpenWorld && this.openWorld.autoOn;
  }

  protected override skipDay(direction: 1 | -1): boolean {
    return this.showOpenWorld && this.openWorld.skipDay(direction);
  }

  protected override cycleAutoSubject(dir: 1 | -1): boolean {
    return this.showOpenWorld && this.openWorld.cycleAuto(dir);
  }

  /** The orbit the Auto camera hands the view to while the player turns it. */
  private autoOrbitOfView: AutoOrbit | null = null;

  /** In the open world the driven car's last view (the hood's) is followed by Auto, and Auto by the first (the chase); Auto that Q / E brought up from off goes back to the view he had. */
  protected override cycleAutoCamera(): boolean {
    if (!this.showOpenWorld || this.seat.mode !== "drive") return false;
    if (this.openWorld.autoOn) {
      const spectated = this.openWorld.spectating;
      this.openWorld.setAuto(false);
      return spectated;
    }
    if (this.seat.view !== "first") return false;
    this.openWorld.setAuto(true);
    return true;
  }

  private makeRace(): RaceDirector {
    return new RaceDirector({
      scene: this.scene,
      camera: this.camera,
      view: this.quality.view,
      sun: this.sun,
      sunOffset: this.stage.sunOffset,
      sunRight: this.stage.sunRight,
      sunUp: this.stage.sunUp,
      setTimeOfDay: (time) => this.stage.setTime(time),
      seat: this.seat,
      live: () => this.live(),
      setCarCount: (n) => this.ensureCars(n),
      setPolice: (from, count) => this.setPolice(from, count),
      dress: (car) => this.dressCar(car),
      setPaused: (on) => {
        this.playing = !on;
        this.uiSound(on ? "open" : "close");
        this.emitHud();
      },
      leave: () => this.setScene("fleet"),
      watchCam: () => {
        this.view.leaveFree(); // Watch Cam ends the free view too, or its begun/userFramed state outlives the switch.
        this.view.spec = "auto";
      },
      hitFx: this.hitFx,
      shotFx: this.shotFx,
      throwPassenger: (car, look) => this.ragdolls.throwPassenger(car, look),
      throwFigure: (strike) => this.ragdolls.throwFigure(strike, this.live()),
      hit: (i, closing) => this.noteHit(i, closing),
      heard: (car, impulse, x, z, material) => {
        const struck = this.live()[car];
        if (this.audioOn && struck) this.audioFeed.wall(struck, impulse, x, struck.group.position.y, z, propSoundMat(MATERIALS[material]![0]));
      },
      knockProp: (index, car, vx, vy, vz) => this.ragdolls.knockProp(index, car, vx, vy, vz),
      buildArt: (track, placed, drawn, arm) => {
        this.queueWarm();
        const art = new TrackArt(track, placed, this.stage, thinScenery(drawn, sceneryShare(track.id, this.cine.tier, this.deviceClass === "desktop"), this.drawsFar(track.id)), reliefForTier(this.cine.tier, this.cine.marks.phone), this.deviceClass !== "desktop");
        this.ragdolls.setCourse(track, placed, art.props, arm);
        return art;
      },
      drawsFar: (trackId) => this.drawsFar(trackId),
      markBounds: (minX, minZ, maxX, maxZ) => this.cine.marks.setBounds(minX, minZ, maxX, maxZ),
      // tickInner's wreck-slide rule (`bleedAfterSlide` once the crash clock is past the hit).
      bleeds: () => this.clock.wallSinceImpact > 0.2,
      reelReady: (clips, since) => void this.startReel(clips, since),
      clear: () => this.clearScene(),
      heardMeter: (i) => this.net.heard(i),
      afoot: (i) => this.awayCar() === i,
    });
  }

  private makeHighlights(): ReelDirector {
    return new ReelDirector({
      carsOf: (clip) => clip.cars.map((c) => this.cars[c.slot]!),
      live: () => this.live(),
      scene: { dress: (car) => this.dressCar(car), collide: (car, slot, h) => this.race.courseHit(car, slot, h), restore: (slot, mem, at) => this.race.remember(slot, mem, at), stored: (slot, x, z) => this.race.stored(slot, x, z), knocks: (bits) => this.race.knockTo(bits), guards: () => this.race.guardSpec(), blend: this.blend },
      resetProps: () => this.race.resetProps(),
      clear: () => this.clearLocal(),
      sight: (focus) => this.sceneSight(focus, true),
      still: () => this.sceneSight(null, false),
      clock: this.clock,
      crash: (contact, normal, source) => this.cine.beginCrashCam(contact, normal, this.crashSight(), this.clock.hold, source),
      impact: (contact, normal, closing) => this.beginCinematic(contact, normal, closing, false),
      hit: (contact, normal, impulse) => {
        this.hitFx(contact, normal, impulse);
        if (this.audioOn) this.audioFeed.wall(this.nearestCar(contact), impulse, contact.x, contact.y, contact.z, STEEL);
      },
      fudge: (at, normal, strength) => this.fudgeContact(at, normal, strength),
      eject: (e, ride) => {
        this.ragdolls.launch(e, this.live(), ride);
        if (ride) this.ragdolls.follow();
      },
      passenger: (car) => this.ragdolls.throwPassenger(car, VIP_LOOK),
      strike: (s) => this.ragdolls.throwFigure(s, this.live()),
      ride: (camera, wallDt, subject) => this.ragdolls.rideAlong && this.ragdolls.frameCamera(camera, wallDt, false, this.cars.indexOf(subject), false, this.view.lens, () => this.sceneSight(subject, true)) !== "none",
    });
  }

  /** The scratch list `drawnCars` rewrites in place. */
  private readonly drawnBuf: DeformableCar[] = [];

  /** The cars the wheel, lamp and part batches draw (instanced, not meshes of the car): the field's, the podium's own while it stands (it hides the field), and the showcase's set in its scene. */
  private drawnCars(): readonly DeformableCar[] {
    const live = this.live();
    const stand = this.podium.cars();
    const set = this.showShowcase && this.showcase ? this.showcase.cars : NO_CARS;
    if (stand.length === 0 && set.length === 0) return live;
    const out = this.drawnBuf;
    out.length = 0;
    for (let i = 0; i < live.length; i++) out.push(live[i]!);
    for (let i = 0; i < stand.length; i++) out.push(stand[i]!);
    for (let i = 0; i < set.length; i++) out.push(set[i]!);
    return out;
  }

  private makePodium(): PodiumDirector {
    return new PodiumDirector({
      spot: () => this.race.podiumSpot(),
      carFor: (id, reuse) => {
        const racer = this.cars[id];
        if (!racer) return null;
        const type = { cls: carClass(racer), style: racer.style.id };
        if (reuse && reuse.group.userData.carIndex === id && reuse.style.id === type.style && carClass(reuse) === type.cls) return reuse;
        if (reuse) this.discardPodiumCar(reuse);
        return this.buildCar(id, type);
      },
      dress: (car) => this.dressCar(car),
      discard: (car) => this.discardPodiumCar(car),
      damageOf: (id) => this.race.endedDamage(id),
      scene: this.scene,
      jet: (x, y, z, startIn, runFor, power, color) => this.fountains.jets.jet(x, y, z, startIn, runFor, power, color),
    });
  }

  private discardPodiumCar(car: DeformableCar): void {
    this.scene.remove(car.group);
    car.dispose();
  }

  /**
   * The loop runs from here, but until `ready` it only reads input (keys, pad, the seat's follow → drive), so a
   * press during the warm-up still counts; it simulates and draws once every program is linked.
   */
  start(): void {
    this.last = performance.now();
    this.loopDraws = true;
    this.renderer.setAnimationLoop(this.tick);
  }

  /**
   * The page's loop stops: the bench draws its frames itself, and only once a setting is in force. So a warm-up stops waiting for
   * frames between its steps (`framesPass`): with the loop counted as drawing, an Ultra switch waited for frames nobody drew and the
   * bench never left that setting. `start` gives the loop back.
   */
  stop(): void {
    this.loopDraws = false;
    this.releaseFrameWaiters();
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.mouseLook.exit();
    this.disposed = true;
    this.releaseFrameWaiters();
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.pad.detach();
    this.detachShare();
    this.net.leave();
    this.view.detach();
    this.canvas.removeEventListener("pointerdown", this.onArmsDown);
    this.canvas.removeEventListener("pointerup", this.onArmsUp);
    this.canvas.removeEventListener("pointercancel", this.onArmsUp);
    this.canvas.removeEventListener("contextmenu", this.onArmsMenu);
    this.resizeObs.disconnect();
    for (const car of this.cars) car.dispose();
    this.podium.dispose();
    this.paintScratches.dispose();
    this.openWorld.stop();
    this.race.dispose();
    this.labArt?.dispose();
    this.garage?.dispose();
    this.looks.dispose();
    this.rivals.dispose();
    for (const batch of [this.wheels, this.lampBatch, this.partBatch, this.seated, this.coverBatch]) batch.dispose();
    this.tether.dispose();
    this.remoteCables.dispose();
    this.sparks.dispose();
    this.fountains.dispose();
    this.debris.dispose();
    this.cine.dispose();
    this.glassDots.dispose();
    this.smoke.dispose();
    this.ragdolls.dispose();
    this.lampLights.dispose();
    this.audio.dispose();
    this.playerShots.dispose();
    this.remoteGuns.dispose();
    this.daylight?.dispose();
    this.envMap?.dispose();
    this.envMap = null;
    this.scene.environment = null;
    // Props, arena, barrier and track art have no dispose of their own: free whatever the scene still holds.
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line)) return;
      o.geometry.dispose();
      for (const m of [o.material].flat() as THREE.Material[]) m.dispose();
    });
    this.scene.clear();
    const g = window as unknown as { __crush?: CrashEngine };
    if (g.__crush === this) delete g.__crush;
    const gl = this.renderer.getContext();
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.renderer.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }


  /**
   * The adaptive quality and the pacer as the page booted them: the FX tier on its first tier, a new tier policy (`AutoFx`: its learned ceiling and climb streak), a new
   * detail governor at its start rung, Auto's render scale at its top rung (the quality knobs, the page's `?draw=`/`?scale=`/`?shadow=` arms included, stay as they are) and a pacer with nothing owed or learned
   * (`SimPacer.reset`). A bench loop runs every step in one page; each step starts from here,
   * so what an earlier step taught the policy, the governor or the pacer never decides a later one. Call it before `benchParts()`: the parts hold the governor.
   */
  resetAdaptiveQuality(): void {
    const desktop = this.deviceClass === "desktop";
    this.setFxTier(INITIAL_HUD.fxTier);
    this.autoFx = new AutoFx(this.deviceClass !== "software", true, desktop);
    this.detailGov = new DetailGovernor(desktop ? 0 : PHONE_LEVEL);
    this.detail.setLevel(this.detailGov.level);
    this.quality.restartAuto();
    this.pace.reset();
  }

  /** Fire and aim on the canvas (`OnFootArms`): the right button held aims; a left press fires at once while the mouse is captured (a free left click is the camera's `click`). */
  private readonly onArmsDown = (e: PointerEvent): void => {
    if (!this.onFoot.armed()) return;
    if (e.button === 2) this.onFoot.arms.aim(true);
    else if (e.button === 0 && this.mouseLook.on) this.onFoot.arms.press();
    else if (e.button === 1 && this.onFoot.arms.weapon === "hook") this.tether.cut();
  };
  private readonly onArmsUp = (e: PointerEvent): void => {
    if (e.button === 2) this.onFoot.arms.aim(false);
    else if (e.button === 0) this.onFoot.arms.release();
  };
  private readonly onArmsMenu = (e: Event): void => {
    if (this.onFoot.armed()) e.preventDefault();
  };

  /** The canvas's place on the page as of its last resize (`cacheCanvasRect`), so a shot and the gun's pose read no layout. */
  private readonly canvasRect = { left: 0, top: 0, width: 0, height: 0 };

  /** Reads the canvas's rect once, where its size changes. */
  private cacheCanvasRect(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.canvasRect.left = rect.left;
    this.canvasRect.top = rect.top;
    this.canvasRect.width = rect.width;
    this.canvasRect.height = rect.height;
  }

  /** The ray a shot goes along: from the camera through the view's centre (`centre`, or no cursor over the canvas), else through the cursor. Reads the cached canvas rect. */
  private aimRay(centre: boolean, out: LookRay): void {
    const rect = this.canvasRect;
    const x = this.view.hoverX;
    const y = this.view.hoverY;
    if (centre || Number.isNaN(x) || Number.isNaN(y) || rect.width < 2 || rect.height < 2) {
      // The view's centre is the camera's own forward: no projection is read, so a canvas with no size (no aspect) still aims, and never along NaN.
      this.camera.getWorldPosition(_p);
      this.camera.getWorldDirection(_n);
    } else {
      this.ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(this.ndc, this.camera);
      _p.copy(this.raycaster.ray.origin);
      _n.copy(this.raycaster.ray.direction);
    }
    out.eyeX = _p.x;
    out.eyeY = _p.y;
    out.eyeZ = _p.z;
    out.dirX = _n.x;
    out.dirY = _n.y;
    out.dirZ = _n.z;
  }

  /** The player fired along `ray` and its farthest ray went `far` m: the flash, the tracer and the sound (what the shot did is `OpenWorldActs.shootBy`). */
  private shotFired(ray: LookRay, far: number): void {
    this.playerShots.fire(0, ray.eyeX + ray.dirX * far, ray.eyeY + ray.dirY * far, ray.eyeZ + ray.dirZ * far);
    this.openWorld.shotMade(ray.eyeX + ray.dirX * far, ray.eyeY + ray.dirY * far, ray.eyeZ + ray.dirZ * far);
    const weapon = this.onFoot.arms.weapon;
    if (this.audioOn && weapon !== "fists" && weapon !== "hook") this.audio.shot(weapon);
  }

  /** Where player `car`'s right hand is, and the way his forearm points (elbow to hand, a unit vector), when a dummy body carries him; false when he is drawn as a figure. */
  private bodyHand(car: number, hand: THREE.Vector3, forearm: THREE.Vector3): boolean {
    const slot = this.openWorld.playerSlot(car);
    if (slot < 0) return false;
    const mesh = this.ragdolls.pickMesh;
    mesh.partPoint(slot, 5, _gunRest.set(0.24, 0.79, 0), hand);
    mesh.partPoint(slot, 5, _gunRest.set(0.24, 1.07, 0), forearm);
    forearm.subVectors(hand, forearm).normalize();
    return true;
  }

  /** The body that carries player `car`, if any, holds his right arm out as the local walker's is while a gun or the hook is in his hand (`Walker.holdGun`), and lets it hang otherwise. */
  private raiseBodyArm(car: number, held: boolean): void {
    const slot = this.openWorld.playerSlot(car);
    if (slot >= 0) this.ragdolls.walkers[slot]?.holdGun(held);
  }

  /** The first dummy of the pool the ray meets within `range` m, not the walker of actor `actor` when that is this player (`DummyMesh.nearestHit`: what the raycaster would sort first, with no hit list). */
  private pickDoll(actor: number, ray: LookRay, range: number, out: DollPick): void {
    out.slot = -1;
    out.along = Infinity;
    const mesh = this.ragdolls.pickMesh;
    if (!mesh.layers.test(this.raycaster.layers)) return;
    this.raycaster.set(_p.set(ray.eyeX, ray.eyeY, ray.eyeZ), _n.set(ray.dirX, ray.dirY, ray.dirZ));
    mesh.nearestHit(this.raycaster.ray, this.raycaster.near, range, actor === this.ownCar() ? WALKER_SLOT : this.openWorld.playerSlot(actor), out);
  }

  /** Where actor `actor` stands on foot and how he moves: this machine's player from his walker as the ragdoll world's last step has him (`dollMotion`: the kept torso and velocity, nothing made), every other player as the host has him (`OpenWorldDirector.playerPlace`). */
  private actorPlace(actor: number, out: ActorPlace): boolean {
    if (actor !== this.ownCar()) return this.openWorld.playerPlace(actor, out);
    if (!this.onFoot.flow.active || !this.ragdolls.dollMotion(WALKER_SLOT, _actorMotion)) return false;
    out.x = _actorMotion.x;
    out.y = _actorMotion.y;
    out.z = _actorMotion.z;
    out.heading = this.ragdolls.walker.facing;
    out.velocityX = _actorMotion.vx;
    out.velocityZ = _actorMotion.vz;
    return true;
  }

  /** The car its player left on foot, unless another player has the wheel of it now. */
  private awayCar(): number {
    const away = this.onFoot.away;
    return away >= 0 && this.desk.table.driverOf(away) < 0 ? away : -1;
  }

  /** Whether car `car` has nobody in it that this player may take: the traffic says so for the host and solo; a guest, who has no traffic, takes the car he drives or left and a car standing parked, and the host has the last word. */
  private canTakeCar(car: number): boolean {
    if (!this.net.client) return this.openWorld.canEnter(car);
    const body = this.live()[car];
    return car === this.drivenCar() || (body !== undefined && this.openWorld.carIsEmpty(car, body));
  }

  /** The player at the wheel of car `car`: who the seat table says in the open world (the car this player drove and left is still his), else (a lobby, a race) the player whose own car it is. */
  private driverActor(car: number): number {
    if (!this.showOpenWorld) return car;
    const driver = this.desk.table.driverOf(car);
    return driver >= 0 || car !== this.drivenCar() ? driver : this.ownCar();
  }

  /** The car a reset of actor `actor` puts back at its spawn: the one he drives in the open world, his own elsewhere. */
  private resetCarOf(actor: number): number {
    const car = this.showOpenWorld ? this.desk.respawned(actor) : -1;
    return car >= 0 ? car : actor;
  }

  /** A civilian's swing fells this player's walker, pushed along (dirX, dirZ). */
  private strikeOwnWalker(dirX: number, dirZ: number): void {
    if (!this.ragdolls.walkerTorso(_p)) return;
    this.ragdolls.strikeWalker(WALKER_SLOT, _p, _n.set(dirX, PUNCH_LIFT, dirZ).normalize(), PUNCH_SPEED);
  }

  /** A blow and a stagger on this player's walker, pushed along (dirX, dirZ), that does not fell him. */
  private staggerOwnWalker(dirX: number, dirZ: number): void {
    if (!this.ragdolls.walkerTorso(_p)) return;
    this.ragdolls.blowWalker(WALKER_SLOT, _p, _n.set(dirX, PUNCH_LIFT, dirZ).normalize(), PUNCH_SPEED);
    this.ragdolls.staggerWalker(WALKER_SLOT, 0.5);
  }

  /** Another player's punch lands on player `victim`. This machine's own walker takes it here; another player's walker is his own machine's, so the blow rides the host's record of him: one that fells him as a strike with its launch, a lighter one as a stagger (`OpenWorldDirector.strikePlayer`, `staggerPlayer`). */
  private strikeActor(victim: number, dirX: number, dirZ: number, knockedOut: boolean): void {
    if (victim !== this.ownCar()) {
      if (knockedOut) {
        _n.set(dirX, PUNCH_LIFT, dirZ).normalize().multiplyScalar(PUNCH_SPEED);
        this.openWorld.strikePlayer(victim, _n.x, _n.y, _n.z);
      } else this.openWorld.staggerPlayer(victim, dirX, dirZ);
      return;
    }
    if (knockedOut) this.strikeOwnWalker(dirX, dirZ);
    else this.staggerOwnWalker(dirX, dirZ);
  }

  /** The first live car the ray meets within `range` m, and the glass pane hit (null: the body): the hit three's raycaster sorts first (`RayNearest`). */
  private pickCar(ray: LookRay, range: number, out: CarPick): void {
    out.car = -1;
    out.along = Infinity;
    out.pane = null;
    this.raycaster.set(_p.set(ray.eyeX, ray.eyeY, ray.eyeZ), _n.set(ray.dirX, ray.dirY, ray.dirZ));
    this.raycaster.far = range;
    const cars = this.live();
    _carGroups.length = cars.length;
    for (let at = 0; at < cars.length; at++) {
      cars[at]!.poseNow();
      _carGroups[at] = cars[at]!.group;
    }
    _carHit.find(this.raycaster, _carGroups);
    this.raycaster.far = Infinity;
    for (let o: THREE.Object3D | null = _carHit.object; o; o = o.parent) {
      const index: unknown = o.userData.carIndex;
      if (typeof index !== "number" || index < 0 || index >= this.carCount) continue;
      out.car = index;
      out.x = _carHit.point.x;
      out.y = _carHit.point.y;
      out.z = _carHit.point.z;
      out.along = _carHit.distance;
      const panes = cars[index]!.glassPanes;
      for (let at = 0; at < panes.length && out.pane === null; at++) if (panes[at]!.mesh === _carHit.object) out.pane = panes[at]!.name;
      break;
    }
    // The hit holds a mesh: let it go until the next shot.
    _carHit.release();
  }

  /** A shot strikes the dummy in pool slot `slot` at (x, y, z) along the ray, as a showcase click strikes one. */
  private strikeDoll(slot: number, x: number, y: number, z: number, ray: LookRay, speed: number): void {
    _p.set(x, y, z);
    _n.set(ray.dirX, ray.dirY, ray.dirZ);
    // A walker is felled as a showcase click fells one; a dummy already limp takes the blow alone.
    if (this.ragdolls.walkers[slot]?.active) this.ragdolls.strikeWalker(slot, _p, _n, speed);
    else this.ragdolls.blowWalker(slot, _p, _n, speed);
  }

  /** Once a frame: the gun laid in the player's right hand (part 5, the one the ARM_R / ELBOW_R motors drive) with its barrel at what his aim is on (or on the lay of his last shot while its flash shows), and the tip the tracers start from; hidden with no gun in hand. */
  private poseHandGun(dt: number): void {
    const arms = this.onFoot.arms;
    this.openWorld.armsHeld(slotOfWeapon(arms.weapon));
    const held = this.onFoot.armed() && arms.heldOut();
    this.gunPosed = held;
    this.handGuns.model(arms.weapon).visible = held;
    if (!held) return;
    this.ragdolls.pickMesh.partPoint(WALKER_SLOT, 5, _gunRest.set(0.24, 0.79, 0), _hand);
    this.aimRay(this.onFoot.aimsAtCentre(), _gunAim);
    this.handGuns.dt = dt;
    this.handGuns.pose(arms.weapon, _hand, _gunAim);
  }

  /** A shot is fired at (x, y, z): the gun in the player's hand is laid straight at it (`HandGuns.layOn`) and `out` is its tip, where the shot and its tracer start; false while no gun is in his hand. */
  private layGun(x: number, y: number, z: number, out: { x: number; y: number; z: number }): boolean {
    if (!this.gunPosed) return false;
    this.ragdolls.pickMesh.partPoint(WALKER_SLOT, 5, _gunRest.set(0.24, 0.79, 0), _hand);
    if (!this.handGuns.layOn(this.onFoot.arms.weapon, _hand, x, y, z)) return false;
    const muzzles = this.playerShots.muzzles;
    out.x = muzzles[0]!;
    out.y = muzzles[1]!;
    out.z = muzzles[2]!;
    return true;
  }

  /**
   * The browser gave the context back: the timer's queries, the PMREM environments (the studio's; Ultra's sky with its handle) and every
   * program's link went with the old one, and the load windows counted frames that drew nothing.
   */
  private readonly onContextRestored = (): void => {
    this.cine.contextRestored();
    this.autoFx.restart();
    this.detailGov.restart();
    this.quality.scaleGov.restart();
    const ultra = this.cine.tier === "ultra";
    if (this.cine.ultra) {
      if (ultra) this.cine.setTier("high");
      this.cine.ultra.dispose();
      this.cine.ultra = null;
    }
    void this.attachStudioEnv().then(() => {
      if (ultra) this.setFxTier("ultra");
    });
    this.queueWarm();
  };

  private tick = (now: number): void => {
    if (this.disposed) return;
    try {
      this.frame(now);
    } catch (err) {
      console.error("Crush Stream tick failed", err);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
      this.blend.restore();
    }
  };

  protected tickInner(now: number): void {
    if (this.disposed) return;
    const t0 = performance.now();
    lapPart(PART.rest);
    // The first rAF stamp can predate `start()`'s performance.now(): a negative dt froze the sim for seconds.
    const wallDt = Math.min(this.advanceDt ?? Math.max(0, (now - this.last) / 1000), 0.1);
    this.last = now;
    if (wallDt > 1e-4) {
      const inst = 1 / wallDt;
      this.fps = this.fps > 1 ? this.fps * 0.85 + inst * 0.15 : inst;
    }
    this.pollInput(wallDt);
    lapPart(PART.input);
    if (this.warming) return;
    this.stepSceneFade(wallDt);
    this.fxFrame(wallDt, this.pace.lost);
    // The rivals' sprays are drawn as fine as the FX tier allows (`RIVAL_SPRAY_SCALE`): a tier change, the player's pick or the auto tier's, dresses the cars again.
    if (this.rivals.useTier(this.cine.tier, this.deviceClass)) for (let i = 0; i < this.cars.length; i++) this.dressCar(this.cars[i]!);
    // The new scene's sim waits behind the transition's black (a slow first-use warm-up would play its opening unseen).
    // Local presentation only: a netplay session or the results replay owns time, so they never wait.
    const held = this.sceneFade.holding && this.net.role === "off" && !this.highlights.playing;

    // The results reel lives until its race is left or the next one sets up (a client's host may start it). Not "until
    // the phase leaves finished": a client's race state comes 5 times a second, unreliably, so the host's reel (reliable,
    // sent at the finish) can land while it still reads "racing" (measured: stopped 106 ms after it arrived).
    const p = this.race.phase;
    if (this.highlights.hasReel && (!this.race.active || p === null || p === "grid" || p === "countdown")) this.stopReel();
    // The sim hears the dummies' world (a worker) at a fixed frame: it does not run one until the answer it is to hear is in.
    if (this.playing && !held && !this.ragdolls.waiting) {
      this.elapsedWall += wallDt;
      const reelDt = this.highlights.frame(now / 1000);
      this.reelFrame(reelDt !== null);
      const cars = this.live();
      let simDt: number;
      if (reelDt !== null) simDt = reelDt;
      else {
        // A netplay client mirrors the host's phase and slow-mo (`net.frame`) instead of running its own.
        if (!this.net.client) this.maybePreSlowmo(wallDt);
        easeTimeScale(this.clock, wallDt);
        simDt = wallDt * this.clock.timeScale * this.cine.timeWarp;
        if (!this.net.client) {
          let fineNeeded = false;
          for (let i = 0; i < cars.length; i++) if (cars[i]!.deform.massActive && cars[i]!.deform.crushing) fineNeeded = true;
          lapPart(PART.rest);
          this.pace.run(simDt, this.clock.timeScale * this.cine.timeWarp, sliceSpeed(cars), fineNeeded, performance.now() + PACE_BUDGET_MS, this.slice);
          lapPart(PART.sim);
        }
      }
      this.stepEdge();
      lapPart(PART.rest);
      this.scheduleSkins(cars);
      // A client draws the host's skins; the reel's replay (a client's too) skins its own cars, the hidden ones wait.
      if (reelDt !== null || !this.net.client) {
        for (let i = 0; i < cars.length; i++) {
          const car = cars[i]!;
          if (reelDt !== null || this.showStack ? car.group.visible : !this.rigScene || car === this.carA) {
            car.updateSkin();
            if (car.deform.skinnedThisFrame) countPart(COUNT.skinnedCars, 1);
          }
        }
      }
      lapPart(PART.skin);
      // The reel's skins and parts were written after `ClipSim.present`: draw them at the frame's time too.
      if (reelDt !== null) this.blend.refresh();
      if (reelDt === null && !this.net.client) this.updatePhase(wallDt);
      if (this.showStack) this.stepStack(); else if (this.showPistons && this.looping) this.stepPistonLoop(wallDt);
      if (reelDt === null && this.clock.phase !== "approach") {
        lapPart(PART.rest);
        this.emitContactFx();
        lapPart(PART.fx);
      }
      if (this.impactLightLife > 0) {
        this.impactLightLife -= wallDt;
        this.impactLight.intensity = Math.max(0, this.impactLightLife * 90);
      }
      this.shakeOnHits();
      this.view.trauma = Math.max(0, this.view.trauma - wallDt * SHAKE_DECAY_PER_S);
      if (this.barrierUp) this.barrier.step(simDt);
      const fxDt = simDt;
      // The bits land on the ground and the cars' tops of the world this frame stepped, the replay's while a clip plays (`landOn`).
      armTops(this.highlights.surfaces ?? this.world.surfaces);
      lapPart(PART.rest);
      this.debris.update(fxDt);
      this.sparks.update(fxDt);
      this.playerShots.update(fxDt);
      this.poseHandGun(fxDt);
      this.glassDots.update(fxDt);
      armTops(null);
      lapPart(PART.fx);
      if (this.race.active) this.race.foliageFrame(cars, fxDt, this.fxDensity);
      lapPart(PART.scenery);
      this.fountains.setLook(this.cine.tier, this.fxDensity);
      this.fountains.update(fxDt);
      this.smoke.update(fxDt, this.camera);
      lapPart(PART.fx);
      const sandbox = !this.race.active && !this.derbyMode;
      // Who the drivers look like: the clip on screen's race, else this race's, this derby round's, or this run's scene seed.
      this.ragdolls.lookSeed = this.highlights.look ?? (this.race.active ? this.race.look : this.derbyMode ? this.derbyRound : this.sceneSeed);
      this.desk.frame(wallDt);
      this.onFoot.frame(wallDt);
      this.riders.refresh(this.showOpenWorld ? this.desk.table : NOBODY_SEATED, wallDt, this.onFoot.active ? this.ownCar() : -1);
      if (this.showShowcase) this.showcase!.step(wallDt);
      // The busts jiggle at the presented rate: the eased slow-mo and warp (smooth), or the reel's own step against the wall (a clip's speed).
      const rate = presentedRate(reelDt, wallDt, this.clock.timeScale, this.cine.timeWarp);
      this.ragdolls.pickMesh.timeScale = rate;
      this.seated.mesh.timeScale = rate;
      // A clip's own hits ride its record (`ClipPartHit`): its replayed dummies' world strikes nothing.
      lapPart(PART.rest);
      this.ragdolls.gateProps(this.deviceClass !== "desktop" && this.showOpenWorld);
      this.ragdolls.update(simDt, cars, !this.net.client && reelDt === null, sandbox, this.barrierUp ? this.barrier.group : null);
      lapPart(PART.ragdoll);
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        if (reelDt !== null && !car.group.visible) continue;
        if (!car.deform.drivetrainAlive) {
          this.deadSmokeAcc[i] = (this.deadSmokeAcc[i] ?? 0) + wallDt;
          if (this.deadSmokeAcc[i]! > 0.14) {
            this.deadSmokeAcc[i] = 0;
            this.puffDeadEngine(car);
          }
        } else if (this.elapsedWall < (this.smokeUntil[i] ?? 0)) {
          // One puff each 1/SMOKE_PUFF_HZ wall seconds, whatever the refresh rate.
          this.deadSmokeAcc[i] = (this.deadSmokeAcc[i] ?? 0) + wallDt;
          for (; this.deadSmokeAcc[i]! >= 1 / SMOKE_PUFF_HZ; this.deadSmokeAcc[i]! -= 1 / SMOKE_PUFF_HZ) this.puffEngine(car);
        } else if (damageStage(car) === "limping") {
          // A limping engine trails a thin thread, half the dead engine's rate.
          this.deadSmokeAcc[i] = (this.deadSmokeAcc[i] ?? 0) + wallDt;
          if (this.deadSmokeAcc[i]! > 0.28) {
            this.deadSmokeAcc[i] = 0;
            this.puffDeadEngine(car);
          }
        }
      }
      if (this.trace.due(wallDt, this.captureTrace)) this.trace.sample(this.traceSetup(), cars, this.traceClock());
      this.stepDerby(simDt);
      this.seat.step(simDt);
      this.cine.update(wallDt, simDt, cars, this.followedCar(), this.seat.mode === "drive", this.fxDensity, this.net.client, this.boostZoom ? this.watchedCar() : null);
      lapPart(PART.fx);
      // Live play only: a reel's cars keep the spatter they had (replays don't record it).
      if (reelDt === null) this.paintScratches.spatter(cars, this.cine.marks.wheels, simDt);
      lapPart(PART.paint);
      if (this.derbyMode) {
        const boosts = this.derby.consumeBoosts();
        for (let k = 0; k < boosts.length; k++) this.takedownBoost(boosts[k]!);
      }
    }

    // Paused or not: a paused host keeps serving its (frozen) world, so clients never think it is gone.
    this.net.frame(wallDt);
    // The reel's replay presents its own steps through the same blend (`ClipSim.present`, before the skins above): the world's pace has no step to show.
    if (!this.highlights.playing) this.blend.present(this.live(), this.pace.alpha);
    if (this.race.active) {
      lapPart(PART.rest);
      this.race.frame(this.playing && !held ? wallDt : 0, this.highlights.people);
      lapPart(PART.scenery);
      // A reel plays a clip, not the race: its finish is not this race's last lap.
      if (!this.highlights.playing) {
        const car = this.followedCar() ? this.seat.carIndex : this.race.self;
        this.fountains.raceFrame(this.race, car, this.cars[car]?.velocity.length() ?? 0);
      }
    } else if (this.showRange && !this.highlights.playing) {
      // The Range's jets lead car A (the player's in a minigame) up the run-up to the lip: its presented place, before the throw.
      const car = this.carA;
      this.fountains.runUpFrame(this.minigameMode, car.group.position.x, Math.max(0, car.velocity.x));
    }
    const focus = this.highlights.playing ? this.highlights.focus() : null;
    if (focus) this.race.followSun(focus);
    lapPart(PART.rest);
    this.updateCamera(wallDt);
    lapPart(PART.camera);
    this.openWorld.mindsSetting = this.minds;
    this.openWorld.frame(wallDt);
    this.tether.frame(wallDt);
    this.remoteGuns.dt = wallDt;
    this.remoteGuns.eyeX = this.camera.position.x;
    this.remoteGuns.eyeZ = this.camera.position.z;
    this.remoteGuns.frame(this.openWorld.playerArms);
    this.remoteCables.frame(this.openWorld.cableFrame(), this.live(), this.camera, this.openWorld.peopleShared, this.openWorld.peopleCapacity, this.onFoot.flow.active && this.bodyHost.motion(WALKER_SLOT, _ownMotion) ? _ownMotion : null, this.drivenCar());
    lapPart(PART.scenery);
    this.rumbleFrame(this.playing && !held ? wallDt : 0);
    lapPart(PART.rest);
    this.flushVisibleSkins();
    lapPart(PART.skin);
    this.paintScratches.frame(this.drawnCars(), wallDt);
    this.paintScratches.flush(this.renderer);
    lapPart(PART.paint);
    this.detail.update(this.cars, this.camera, this.followedCar(), this.highlights.playing ? this.highlights.focus() : null);
    this.lampLights.night = this.stage.night;
    this.showcase?.art.setNight(this.stage.night);
    lapPart(PART.rest);
    this.lampLights.update(this.showShowcase ? this.drawnCars() : this.live(), this.camera, this.followedCar(), performance.now() / 1000, this.highlights.playing ? this.highlights.cars() : undefined, wallDt);
    lapPart(PART.scenery);
    if (this.audioOn) {
      this.audioFeed.frame(wallDt);
      this.uiCues.frame(this.cuePhase(), this.cueTime(), this.cueWrecked(), this.onFoot.armed() ? this.onFoot.arms.weapon : null);
      this.audio.frame(wallDt, this.highlights.playing ? this.highlights.cars() : this.live(), this.highlights.playing ? this.highlights.focus() : this.followedCar(), this.clock.timeScale * this.cine.timeWarp, this.playing && !held, this.ambientScene());
    } else this.audioFeed.clear();
    lapPart(PART.audio);
    if (this.stage.night) this.stage.syncPools(this.poles);
    lapPart(PART.scenery);
    const drawAt = performance.now();
    if (!this.skipDraw) {
      this.scene.sync(this.warmsInFlight === 0);
      lapPart(PART.scenery);
      this.cine.render(this.scene, this.camera, wallDt, this.markFocus());
      this.frameDrawn();
    }
    this.renderMs = performance.now() - drawAt;
    this.tierWorkMs = takeTierWork();
    this.blend.restore();
    this.race.readFinish(); // after the restore: the blend draws skins between two steps, and the finish keeps the sim's
    this.hudAcc += wallDt;
    if (this.hudAcc > (this.clock.timeScale < 0.5 ? 0.05 : 0.12)) {
      this.hudAcc = 0;
      lapPart(PART.rest);
      this.emitHud();
      lapPart(PART.hud);
    }
    this.workMs = performance.now() - t0;
  }

  /**
   * Deform LoD. Skinning (+ normals) is the per-vertex cost, so a car outside the view frustum
   * defers it and a small one skins every 2nd / 4th frame; the cage/shape solve always runs.
   * Deferred cars carry `skinOwed`, which `flushVisibleSkins` settles once the camera has moved,
   * so no car is ever drawn on-screen with a dent it has not been given. The followed car always skins.
   */
  private scheduleSkins(cars: DeformableCar[]): void {
    this.witness.aim(this.camera);
    this.aimCover(true);
    this.lodFrame++;
    const followed = this.followedCar();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const stride = car === followed ? 1 : this.skinStride(car);
      this.lodStride[i] = stride;
      car.setNearView(stride === 1);
      const skinDeferred = stride === 0 || (this.lodFrame + i) % stride !== 0;
      const hidden = car !== followed && holdHidden(this.cover, this.race, car, stride, i, LOD_RADIUS);
      car.setHoldDeferred(hidden || (car !== followed && holdWaits(stride, skinDeferred)), hidden);
      car.deform.skinDeferred = skinDeferred;
    }
  }

  /**
   * After the camera update: any owed car now on screen at full rate, or just entering the view, skins before it draws.
   * Always reads the final camera into `witness`: next frame's FX spawns (decided before its rigs aim) ask that cone.
   */
  private flushVisibleSkins(): void {
    this.witness.aim(this.camera);
    this.aimCover(false);
    const cars = this.live();
    let followed: DeformableCar | null | undefined;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const owed = car.deform.skinOwed;
      if (!owed && !car.holdOwed && !car.partsOwed) continue;
      if (followed === undefined) followed = this.followedCar();
      const stride = car === followed ? 1 : this.skinStride(car);
      const hidden = car !== followed && holdHidden(this.cover, this.race, car, stride, i, LOD_RADIUS);
      car.setHoldDeferred(hidden || (car !== followed && holdWaits(stride, car.deform.skinDeferred)), hidden);
      if (owed) {
        car.setNearView(stride === 1);
        if (stride === 1 || (stride > 1 && this.lodStride[i] === 0)) car.flushDeferredSkin();
        this.lodStride[i] = stride;
      }
      car.settleHold();
      car.settleParts();
    }
  }

  /** Reads the camera, as `witness.aim` just read it, into the cover; `newFrame` is the frame's first read. */
  private aimCover(newFrame: boolean): void {
    const e = this.camera.matrixWorld.elements;
    this.cover.aim(e[12]!, e[13]!, e[14]!, -e[8]!, -e[9]!, -e[10]!, newFrame);
  }

  /** 0 off-screen, else skin every Nth frame by projected size. Needs `witness.aim` this frame. */
  private skinStride(car: DeformableCar): number {
    _lodCenter.set(car.group.position.x, car.group.position.y + 0.6, car.group.position.z);
    if (!this.witness.mayWitness(_lodCenter, LOD_RADIUS)) return 0;
    const d = _v.setFromMatrixPosition(this.camera.matrixWorld).distanceTo(_lodCenter);
    if (d <= LOD_RADIUS) return 1;
    const halfHeightPx = (this.renderer.domElement.height / this.renderer.getPixelRatio()) * 0.5;
    const px = (LOD_RADIUS / (d * detTan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)))) * halfHeightPx;
    return px >= LOD_SMALL_PX ? 1 : px >= LOD_TINY_PX ? 2 : 4;
  }

  private maybePreSlowmo(wallDt: number): void {
    const c = this.clock;
    if (this.derbyMode || this.race.active || !this.autoSlomo || this.rigScene || !(c.phase === "approach" || (c.phase === "aftermath" && this.sceneId === "fleet"))) return;
    preImpact(c, this.contactEta(), this.elapsedSim, Math.max(PRE_IMPACT_LEAD, wallDt + FIXED), FIXED, this.throwSoon);
    if (c.phase === "approach" && c.targetScale < 1 && c.userTimeScale == null) this.fudgePredicted();
  }

  /** Whether the coming hit will throw a driver: his exit then plays at 1× (`THROW_ONSET`). */
  private readonly throwSoon = (): boolean => throwComing(this.live(), this.barrierUp ? this.barrier : null);

  // The world's hooks are these four functions for good, each with one call site per scene below: swapping a different closure into the
  // world's field (or one call site over several targets) per scene made every call site polymorphic, which SpiderMonkey bails out of.
  /** Each car-pair hit: the scene's own hook (the derby's credit, the race recorder, the Lab's), then the shake of whichever of the two is watched. */
  private readonly pairHit = (a: number, b: number, hit: ContactHit): void => {
    if (this.derbyMode) this.derbyHit(a, b, hit);
    else if (this.race.active) this.race.pairHit(a, b, hit);
    else if (this.showLab) this.lab.pairHit(a, b, hit);
    else if (this.sceneId === "fleet") this.fleetHit(a, b, hit);
    this.noteHit(a, hit.impulse);
    this.noteHit(b, hit.impulse);
    if (this.audioOn) this.audioFeed.pair(this.cars[a]!, this.cars[b]!, hit);
  };

  /** The slab met a car: concrete against steel. */
  private readonly barrierHeard = (car: number, hit: ContactHit): void => {
    if (this.audioOn) this.audioFeed.wall(this.cars[car]!, hit.impulse, hit.contact.x, hit.contact.y, hit.contact.z, "concrete");
  };

  private readonly ambientNow: AmbientScene = { place: DEFAULT_PLACE, hour: 13, speed: 0, indoors: false };
  private uiCues!: UiCues;

  /** What the ambient bed is told each frame: where the player is, the hour, how fast the followed car goes, and whether he is under a roof. */
  private ambientScene(): AmbientScene {
    const s = this.ambientNow;
    const followed = this.followedCar();
    s.speed = followed ? followed.velocity.length() : 0;
    s.indoors = false;
    if (this.showOpenWorld) {
      s.place = "openworld";
      s.hour = hourOfDay(this.openWorld.gameMinute());
    } else if (this.race.active) {
      s.place = coursePlace(this.race.courseId);
      s.hour = hourOfDay(null, this.race.timeOfDay);
      s.indoors = followed !== null && this.race.inTunnel(this.seat.carIndex);
    } else {
      s.place = this.derbyMode ? "arena" : DEFAULT_PLACE;
      s.hour = hourOfDay(null);
      s.indoors = this.showGarage || this.showShowcase || this.showLab;
    }
    return s;
  }

  /** The race phase the UI cues follow: a race's, or a derby's read from its clock (null: neither is running). */
  private cuePhase(): RacePhase | null {
    if (this.race.active) return this.race.phase;
    if (!this.derbyMode || !this.derby.active) return null;
    if (this.derby.winnerId !== null) return "finished";
    return this.derby.time < -COUNTDOWN ? "grid" : this.derby.time < 0 ? "countdown" : "racing";
  }

  private cueTime(): number {
    return this.race.active ? this.race.time : this.derby.time;
  }

  /** The followed car, driven by the player, is wrecked. */
  private cueWrecked(): boolean {
    return this.seat.mode === "drive" && (this.followedCar()?.crashed ?? false);
  }

  /** Before each slice: a rig scene's or the Lab's own step; true when it stepped the slice itself. */
  private readonly beforeSlice = (h: number): boolean => {
    if (this.rigScene && !this.showStack) return this.rigSlice(h);
    if (this.showLab) return this.lab.slice(h);
    return false;
  };

  /** A door, mirror or top met between two cars: the race recorder keeps both (`World.partTouch`). */
  private readonly partTouch = (a: number, b: number): void => {
    if (this.race.active) this.race.partTouch(a, b);
  };

  /** A loose part met another car's top: the race recorder keeps that car with the part's (`World.partMet`). */
  private readonly partMet = (own: number, top: number): void => {
    if (this.race.active) this.race.partMet(own, top);
  };

  /** Each car at a slice's end. The corkscrew's walls hold its car on its floor: the ramps are put away there (`SCENE_PROPS`), like the slab and the balls, so their faces cannot stand in for them (a 6 m/s car slid off the bank onto its roof) or wall in a parked car. */
  private readonly collide = (car: DeformableCar, i: number, h: number): void => {
    if (this.race.active) this.raceCollide(car, i, h);
    else if (this.derbyMode) this.derbyCollide(car, i, h);
    else if (this.showCorkscrew) this.corkCollide(car);
    else if (this.showLab) this.lab.collide(car, i, h);
    else if (this.minigameMode !== null) {
      this.rigCollide(car, i, h);
      this.minigames.collide(car, i);
    } else this.rigCollide(car, i, h);
  };

  /** A driver thrown out: his dummy flies (`release`: a minigame's boost), the minigame knows he is out, the race recorder and the netplay peers hear of it. */
  private throwDriver(e: Ejection, cars: readonly DeformableCar[], release?: ReleaseScale): void {
    if (e.car !== this.awayCar() && !this.onFoot.takeEjected(e)) this.ragdolls.launch(e, cars, true, release);
    this.desk.driverEjected(e.car);
    if (this.minigameMode !== null) this.minigames.noteThrown();
    if (this.race.active) this.race.recorder.eject(e);
    this.net.sendEject(e);
  }

  /** The hook is on offer: weapon 0 in hand, on foot in the open world, on any machine (a guest sends its fire as an act). */
  private tetherOffered(): boolean {
    return this.onFoot.afootInOpenWorld && this.onFoot.arms.weapon === "hook";
  }

  /** The on-foot control is offered: the game is running a scene with a player's car to leave (not the garage, the lab or the showcase), and no reel, fade, boot warm-up or race menu holds it. Online or off. */
  private onFootOffered(): boolean {
    if (this.highlights.playing || !this.playing || this.warming || this.sceneFade.pending !== null) return false;
    return !this.showGarage && !this.showLab && !this.showShowcase && !this.race.menuOpen;
  }

  private fixedStep(dt: number): void {
    const cars = this.live();
    // Race: every car (the player too) is driven through its controller slot by the director.
    if (this.race.active) this.race.drive(dt);
    const driven = this.seat.mode === "drive" && !this.race.active ? this.seat.carIndex : -1;
    if (driven >= 0 && driven < cars.length) {
      const car = cars[driven]!;
      const seatHeld = this.derbyMode && (this.derby.held(driven) || car.driverOut !== null);
      if (car.deform.drivetrainAlive && !seatHeld) applyDrive(car, this.seat.input(car, dt), dt);
      if (this.seat.selfRight(car.group.matrixWorld.elements[5]!, car.velocity.length(), dt)) this.recoverDriven();
    }
    // The player on foot has left his car with its brakes on (the race director holds it in a race; the other scenes here).
    const left = this.awayCar();
    const away = !this.race.active && left >= 0 && left < cars.length && cars[left]?.deform.drivetrainAlive ? left : -1;
    if (away >= 0) applyDrive(cars[away]!, this.standHold, dt);
    this.net.drive(cars, dt, driven);
    if (this.derbyMode && this.derby.winnerId == null) {
      const snaps = this.derby.snapshots(cars.length);
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i]!;
        snapshotAiCar(snaps[i]!, i, c, carRuns(c));
      }
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        // A thrown-out driver is nobody's input, the player's and a peer's car too: it coasts, a wreck to the rules (`carRuns`).
        if (car.driverOut !== null) applyDrive(car, COAST, dt);
        else if (i !== driven && i !== away && !this.derbySeated.has(i)) {
          applyAiDrive(car, this.derby.think(snaps[i]!, snaps, dt), dt);
          if (this.derby.recoverDue(i, car, dt)) this.recoverCar(car);
        }
      }
    }
    // A crashed car nobody drives still rolls on its drive's law (car-air `driven` skips tyre friction for it): the race, the derby
    // before its winner and the net host drive theirs; the rest take the idle pedals here.
    if (!this.race.active && !(this.derbyMode && this.derby.winnerId == null)) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        if (i === driven || i === away || car.parked || !car.crashed || !car.deform.massActive || this.net.drives(i, driven)) continue;
        applyDrive(car, this.wreckCoast, dt);
      }
    }
    const w = this.world;
    w.cars = cars;
    w.barrier = this.barrierUp ? this.barrier : null;
    w.barrierHits = this.barrierHits;
    w.beforeSlice = this.beforeSlice;
    w.pairHit = this.pairHit;
    w.partTouch = this.partTouch;
    w.partMet = this.partMet;
    w.collide = this.collide;
    w.barrierHit = this.barrierHeard;
    w.lone = this.race.active;
    w.restSleep = this.showOpenWorld;
    if (!this.race.active && !this.showLab) this.syncRigs();
    this.ejection.ctx = this.derbyMode ? "derby" : "default";
    this.ejection.minigame = this.minigameMode !== null;
    w.fine = this.pace.fine;
    lap(w.phases, PHASE.drive);
    if (w.tethers.sim && this.race.active) this.race.recorder.tethered();
    stepWorld(w, dt);
    // The slab names no car: a hit it took from the watched one, at the step's hardest contact next to that car.
    const watched = this.seat.mode !== "global" ? cars[this.seat.carIndex] : undefined;
    const at = w.strongest.contact;
    if (watched && at && this.barrierUp && this.barrierHits[this.seat.carIndex]) {
      const dx = at.x - watched.group.position.x;
      const dz = at.z - watched.group.position.z;
      if (dx * dx + dz * dz < 16) this.noteHit(this.seat.carIndex, w.strongest.impulse);
    }
    // A driver thrown out this step (`EjectionWatch`): his dummy flies, the race recorder and the netplay peers hear of it.
    const ejected = this.ejection.take();
    for (let k = 0; k < ejected.length; k++) {
      const e = ejected[k]!;
      if (this.minigameMode === MINIGAME_MODE.longJump) this.minigames.holdForBail(e, this.elapsedWall);
      else this.throwDriver(e, cars, this.minigameMode === null ? undefined : THROW_BOOST[this.minigameMode]);
    }
    const bailed = this.minigameMode === MINIGAME_MODE.longJump ? this.minigames.bailThrowDue(this.elapsedWall) : null;
    if (bailed !== null) this.throwDriver(bailed.event, cars, bailed.release);
    if (this.race.active) this.race.step(dt, w.shape, w.loners);

    const { impulse, contact, normal } = w.strongest;
    // The Lab's crash is its throw's first contact (`Lab.shot`): a stack settling before any throw is no crash.
    const shot = this.showLab ? this.lab.shot : null;
    if (shot && shot.contactS !== null && this.clock.phase === "approach") {
      this.beginCinematic(shot.contactAt, shot.normal, shot.speedBefore);
    } else if (!this.derbyMode && !this.race.active && !this.showStack && !this.showLab && !struck(this.clock) && contact && normal && impulse > 0.4) {
      this.beginCinematic(contact, normal, impulse, undefined, w.strongest.wall ? WALL_HIT : CAR_HIT);
    } else if ((this.derbyMode || this.race.active) && contact && normal && impulse > SPARK_MIN_IMPULSE && this.elapsedWall - this.sparkAt > 0.16 && this.witness.sees(contact, FX_REACH.sparks)) {
      this.sparkAt = this.elapsedWall;
      this.sparkShower(contact, normal, impulse);
    }
    this.openWorld.step(dt);
    lap(w.phases, PHASE.rules);
  }

  private emitContactFx(): void {
    if (this.clock.phase === "approach" || this.fxPoofed) return;
    const cars = this.live();
    let contact: THREE.Vector3 | null = null;
    let normal: THREE.Vector3 | null = null;
    if (firstMassContact(cars, _p, _n)) {
      contact = _p;
      normal = _n;
    }
    if (!contact && this.barrierUp) {
      const hi = this.barrierHits.findIndex(Boolean);
      const hitCar = hi >= 0 ? cars[hi] : null;
      if (hitCar) {
        _bp.copy(hitCar.deform.massWorld("bumperFL")).add(hitCar.deform.massWorld("bumperFR")).multiplyScalar(0.5);
        _bp.y = 0.32;
        _bn.set(detCos(this.barrier.yaw), 0, -detSin(this.barrier.yaw));
        contact = _bp;
        normal = _bn;
      }
    }
    if (!contact) return;
    const src = this.nearestCar(contact);
    this.armEngineSmoke(src, 2.8);
    if (!this.fxPoofed) {
      this.sparks.poof(contact, normal!, Math.max(24, (48 * this.fxDensity) | 0));
      this.smoke.plume(contact, src.velocity, Math.max(10, (16 * this.fxDensity) | 0));
      this.fxPoofed = true;
    }
  }

  private updatePhase(wallDt: number): void {
    if (this.derbyMode || this.race.active) return;
    const settled = this.clock.phase === "aftermath";
    stepPhase(this.clock, wallDt);
    // A minigame has no loop and no timer: the dummy lies where he lands, and the session waits for the player's Retry.
    if (this.minigameMode !== null) {
      this.minigames.step(this.ragdolls, this.seat.mode === "drive" && this.seat.carIndex === 0, this.carA, wallDt);
      return;
    }
    // A thrown range driver holds the loop until his landing has been shown (`RangeRun`); otherwise it runs as the
    // fleet's, after any ride-along with thrown drivers. The Lab never loops: the wreckage stays until the player resets.
    const still = this.showRange ? this.ragdolls.latest(_v) : -1;
    const shown = this.showRange && this.rangeRun.step(still >= 0, this.ragdolls.latestSettled, _v.x, wallDt);
    if (this.looping && !this.onFoot.active && !this.showLab && !this.showGarage && !this.showShowcase && (shown || (still < 0 && settled && !this.ragdolls.rideAlong && !this.showPistons && this.clock.wallSinceImpact > (this.showCompactor ? 14 : 10.4)))) this.randomizeAndReset();
  }

  /** `aimRigs`'s derby centroid set, refilled per frame. */
  private readonly aliveBuf: DeformableCar[] = [];
  private readonly freeInput = blankFreeInput();

  /**
   * What the spectator cams read from the scene: the solids and the rival racers when they pick a shot, the course's own
   * solids per frame (the chase push-out); `cut` is the Auto cam's cut, where the Auto driver may hand over another car.
   */
  private readonly specScene: SpecScene = {
    sight: () => this.sceneSight(this.followedCar(), true),
    rivals: () => (this.race.active ? this.live().slice(0, this.race.racers.length) : this.live()),
    fixed: () => this.chaseSight(true),
    cut: (car) => {
      if (this.race.auto) this.race.autoStep(this.view.auto.cuts, true);
      return this.followedCar() ?? car;
    },
  };

  /** The car the shot watches: the reel's focus car while a clip plays (null in its flights), else the seat's. */
  private watchedCar(): DeformableCar | null {
    return this.highlights.playing ? this.highlights.focus() : this.followedCar();
  }

  /** What the shot watches, for the tyre-mark window: the crash cam's hit while it cuts, else the watched car, else the eye. */
  private markFocus(): THREE.Vector3 {
    if (this.cine.cutting) return this.cine.crash.hit;
    const car = this.watchedCar();
    return car ? car.group.position : this.camera.position;
  }

  /** The rigs' shot, then the rear-view hold over it (undone before the next frame's rigs, so they never see it). */
  private updateCamera(wallDt: number): void {
    this.view.unflip();
    // The ride's end hands the camera to the rigs below it: they work on the pose they left (`unfadeRide`), and the
    // camera shown eases out of the ride's last pose into theirs, never a jump (a reel's shots are its own).
    this.ragdolls.unfadeRide(this.camera);
    this.aimRigs(wallDt);
    this.ragdolls.fadeRide(this.camera, wallDt, !this.highlights.playing);
    if (this.highlights.playing) return;
    const back = this.view.rear && !this.view.flying && !this.onFoot.active ? this.followedCar() : null;
    if (back?.group.visible) this.view.lookBack(back, this.chaseSight(true), wallDt);
  }

  /** The free view's frame: the held keys and sticks (none under a menu), over the scene's footprint. */
  private flyFree(wallDt: number): void {
    sceneExtent(this.view.free.extent, this.derbyMode, this.race.active ? this.race.courseBounds() : this.showRange ? this.minigames.bounds() : null);
    this.view.frameFree(readFreeInput(this.keys, this.pad.state, this.race.menuOpen, this.freeInput), wallDt);
    if (this.showShowcase) this.followShowcaseEye(this.view.free, wallDt);
  }

  private aimRigs(wallDt: number): void {
    // Driving is not spectating: the free view ends where a seat takes the wheel.
    if (this.seat.mode === "drive") this.view.leaveFree();
    if (this.highlights.playing) {
      // The reel frames its own shots: the crash cam over the hit while its window is open, then the subject's thrown driver's ride-along.
      this.reelFov ??= this.camera.fov;
      this.highlights.aim(this.camera, wallDt, this.cine);
      // The free view flies over the reel: its cuts still run underneath, and the eye is the viewer's.
      if (this.view.flying) this.flyFree(wallDt);
      return;
    }
    // The crash cam plays its cuts first (letterbox, bars and clock too); a thrown driver's ride-along, which opens on his
    // exit's windshield and then frames the dummy, waits for its window to close (the range's own dummy cam rides at once).
    // A drag hands the ride to the orbit around the dummy, the ride's cuts waiting; the ride then picks up from the user's view.
    if (this.onFoot.aim(wallDt)) {
      // The walker's camera is the player's alone: a ride-along's or the Auto camera's hold on the view ends, or a press of the mouse would take the orbit's pose from the eye and its aim and put it in first person.
      this.view.frameRide(null);
      this.openWorld.setAuto(false);
      return;
    }
    // The chase sight is built only where Auto frames: driving, `frameDrive` builds the frame's one.
    if (this.showOpenWorld && this.openWorld.autoOn && this.openWorld.aimAuto(this.camera, this.chaseSight(true), wallDt, (this.autoOrbitOfView ??= autoOrbitOf(this.view)))) {
      this.view.setLens(null, false);
      this.view.pos.copy(this.camera.position);
      return;
    }
    // The Range's ride takes the camera while the crash cam cuts (it does not wait for it): the ride's lens is the shot's, not the cut's.
    const cut = this.cine.direct(this.camera, wallDt, !this.view.flying && !this.view.userFramed && this.seat.mode !== "drive", null, !(this.showRange && this.ragdolls.rideAlong));
    if (this.view.flying) {
      // The free eye ignores the target, but the Auto director must still move the named car when it finishes (no cuts: the camera makes none).
      if (this.race.auto) this.race.autoStep(-1, true);
      this.flyFree(wallDt);
      return;
    }
    const watched = this.followedCar() ? this.seat.carIndex : -1;
    const held = this.view.rideHeld(this.ragdolls.rideAlong, wallDt);
    const waits = this.cine.holding && !this.showRange;
    const ride = waits ? "none" : this.ragdolls.frameCamera(this.camera, wallDt, this.showRange, watched, held, this.view.lens, this.specScene.sight, this.minigameMode === null ? 0 : MINIGAME_AIM_LEAD);
    this.view.frameRide(ride === "none" ? null : this.ragdolls.rideLook);
    if (ride === "held") this.view.orbit(wallDt, 0, false);
    if (ride !== "none" || cut) return;
    // The Auto driver (race spectating): a camera that makes no cuts is itself the cut; the Auto cam cuts in `specScene.cut`.
    if (this.race.auto) this.race.autoStep(this.view.specView(this.race.chase) === "auto" ? this.view.auto.cuts : -1, this.view.specView(this.race.chase) !== "auto");
    const followed = this.followedCar();
    // Off the disc's rim (from the first centimetre of drop): the eye settles on the rim at shoulder height and keeps
    // the falling car centred, then holds once it vaporizes.
    const fp = followed?.group.position;
    if (followed && fp && (followed.falling || followed.vaporized || (fp.y < -0.01 && activeGround().heightAt(fp.x, fp.z, fp.y) === NO_FLOOR))) {
      this.view.watchFall(followed, wallDt, followed.vaporized);
      return;
    }
    if (followed && followed.group.visible && this.seat.mode === "drive") {
      // The body's ride reaches the chase and hood cams on every FX tier but "off" (0.0004 ms a frame), unless motion is reduced.
      this.view.drive.ride = this.cine.tier !== "off" && !this.clock.reduceMotion;
      this.view.frameDrive(followed, this.specScene.fixed(), wallDt, this.playing);
      return;
    }
    // Following (spectating): the chosen spectator cam, on the rigs too (their default is the orbit, which falls through).
    if (this.seat.mode === "global" && !this.view.flying) this.view.spec = null;
    const spec = this.view.specView(this.followsInChaseView);
    if (followed && followed.group.visible && this.view.frameSpectate(followed, spec, this.specScene, wallDt, this.playing)) return;
    // The garage's orbit keeps the centre `frameGarage` gave it (the car's shot or the driver's chest): no case below sets it.
    const look = this.view.look;
    if (followed && followed.group.visible) {
      // Over the car's own height: a race course climbs hills and bridges.
      look.set(followed.group.position.x, followed.group.position.y + 0.7, followed.group.position.z);
    } else if (this.rigScene) {
      look.set(this.carA.group.position.x, this.showStack ? this.stackLookY(wallDt) : 0.55, this.carA.group.position.z);
    } else if (this.derbyMode && this.derby.winnerId != null) {
      const champ = this.cars[this.derby.winnerId];
      if (champ) this.lookOver(champ.group.position.x, champ.group.position.z);
    } else if (this.derbyMode) {
      const alive = this.aliveBuf;
      const live = this.live();
      let n = 0;
      for (let i = 0; i < live.length; i++) if (live[i]!.deform.drivetrainAlive) alive[n++] = live[i]!;
      alive.length = n;
      centroid(_v, n ? alive : live);
      this.lookOver(_v.x, _v.z);
    } else if (this.showLab) {
      // A phone turned on its side (or back) gets that shape's shot: its lens and distance are fitted to the screen's width, so a
      // view the player turned on the other shape means nothing on this one.
      if (this.camera.aspect < 1 !== this.labUpright) this.frameLab();
      look.copy(this.labLook);
    } else if (!this.showGarage) {
      centroid(_v, this.live());
      this.lookOver(_v.x, _v.z);
    }

    // The Lab holds still for the aim, and the garage for the paint and the picks: a turning view would turn every flick or stroke.
    let spinRate = 0;
    if (this.autoRotate && this.playing && this.seat.mode !== "drive" && !this.showLab && !this.showGarage) {
      spinRate = this.showPistons ? PISTON_ORBIT_RATE : this.clock.phase === "approach" ? 0.12 : 0.32;
    }
    this.view.orbit(wallDt, spinRate, this.playing, this.rigScene || this.showLab || this.showGarage ? null : this.chaseSight(followed !== null && followed.group.visible));
  }

  /** Aim the orbit 0.7 m over the surface at (x, z): the cars' mean spot can lie over a derby mound or ramp, and the eye's clear line starts at the aim. */
  private lookOver(x: number, z: number): void {
    const g = activeGround().heightAt(x, z);
    this.view.look.set(x, (g === NO_FLOOR ? 0 : g) + 0.7, z);
  }
}
