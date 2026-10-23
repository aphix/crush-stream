// First: every quaternion built from here on, constants at load included, takes the engine-identical trig (kernel/three-trig.ts).
import "../kernel/three-trig.ts";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
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
import { carClass, damageStage } from "../vehicle/vehicle-classes.ts";
import { makeJerseyBarrier, makePoolTexture } from "../present/engine-world.ts";
import { Cinematics } from "../present/engine-cine.ts";
import { FX_TIERS } from "../present/engine-post.ts";
import { SKY_MODES } from "../present/sky-dome.ts";
import { AutoFx, deviceClass, gpuRenderer, type DeviceClass } from "../present/auto-fx.ts";
import { PHONE_LEVEL } from "../present/car-detail.ts";
import { DetailGovernor } from "../present/detail-governor.ts";
import { DRAW_DISTANCES, knobValue, PlayerQuality, RENDER_SCALES, SHADOW_QUALITIES } from "../present/player-quality.ts";
import { makeRenderer } from "./engine-renderer.ts";
import { DebrisSystem, SparkSystem, GlassDotSystem, TireSmokeSystem } from "../present/engine-fx.ts";
import { Fountains } from "./engine-fountains.ts";
import { GameAudio } from "../present/game-audio.ts";
import { FX_REACH } from "../present/witness.ts";
import { RagdollSystem } from "../present/engine-ragdoll.ts";
import { VIP_LOOK } from "../present/dummy-dress.ts";
import { throwComing } from "../present/ragdoll-trigger.ts";
import { ChaseCamera, centroid, SHAKE_DECAY_PER_S, type SpecScene } from "../present/engine-camera.ts";
import { blankFreeInput, sceneExtent } from "../present/free-cam.ts";
import { MINIGAME_AIM_LEAD } from "../present/ride-cam.ts";
import { MINIGAME_MODE, THROW_BOOST } from "../scenes/minigame-constants.ts";
import type { ReleaseScale } from "../present/ragdoll-boxes.ts";
import type { Ejection } from "../vehicle/ejection.ts";
import { readFreeInput } from "./engine-free.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";
import { armTops } from "../world/surfaces.ts";
import { CompactorPress, JerseyBarrier, type ContactHit } from "../scenes/engine-props.ts";
import { FleetRamps } from "../scenes/fleet-ramps.ts";
import { Corkscrew } from "../scenes/corkscrew.ts";
import { TraceRecorder } from "./engine-trace.ts";
import { snapshotAiCar } from "../match/derby.ts";
import { LampLights, lampPoolFor } from "../vehicle/lamp-lights.ts";
import { applyDrive, idleDrive } from "../vehicle/car-drive.ts";
import { applyAiDrive } from "../ai/input-fade.ts";
import { makeDerbyArena, WinnerSpot } from "../scenes/derby-arena.ts";
import { NetPlay } from "../net/net-play.ts";
import { RaceDirector } from "./engine-race.ts";
import { ReelDirector } from "./engine-highlights.ts";
import { PodiumDirector } from "./engine-podium.ts";
import { TrackArt } from "../present/track-art.ts";
import { EngineGarage } from "./engine-garage.ts";
import { detSin, detCos } from "../kernel/physics-core.js";
import { SHOT_SPARK_IMPULSE, SMOKE_PUFF_HZ, SPARK_MIN_IMPULSE } from "./constants.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { firstMassContact } from "./car-contact-scan.ts";

const FIXED = 1 / FRAME_HZ;
/** Deform LoD: sphere around a car — rest half-diagonal 2.5 m plus crumple slack and the
 *  ≈0.9 m the sun throws the roof's shadow, so an off-screen car's shadow is never stale either. */
const LOD_RADIUS = 3.5;
/** Projected sphere radius (CSS px) below which a car skins every 2nd / every 4th frame. */
const LOD_SMALL_PX = 40;
const LOD_TINY_PX = 20;
const _lodCenter = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _p = new THREE.Vector3();
const _bn = new THREE.Vector3();
const _bp = new THREE.Vector3();
/** No cars: the showcase's set outside its scene. */
const NO_CARS: readonly DeformableCar[] = [];

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
        if (this.race.survival === survival && (!lobby || this.race.free)) return;
        this.setRace(false);
      }
      this.setRace(true, survival, lobby);
      this.emitHud();
    },
    resetLobbyCar: (i) => this.race.resetLobbyCar(i),
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
    remoteDrivable: (i) => !this.derbyMode || (this.derbySeated.has(i) && !this.derby.held(i)),
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
    launchEjection: (e) => this.ragdolls.launch(e, this.live()),
    meterOf: (i) => this.meterOf(i),
    playerLook: () => this.playerLook(),
    wearLook: (i, look) => this.wearLook(i, look),
    dropLooks: () => this.dropLooks(),
    courseMenu: () => this.race.courseMenu(),
    seat: this.seat,
  });
  /** The results reel and its solo view. */
  protected readonly highlights: ReelDirector;
  /** The podium over the course (docs/PODIUM.md). */
  protected readonly podium: PodiumDirector;
  readonly pace = new SimPacer(true);
  private readonly blend = new PoseBlend();
  /** What a crashed car nobody drives rolls on: its drive's idle pedals (engine braking, the test world's IDLE). */
  private readonly wreckCoast = idleDrive();
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

    this.renderer = makeRenderer(canvas);
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
    const driverLook = (car: number, cop: boolean) => this.ragdolls.carDriverLook(car, cop);
    // After the renderer's scene matrix update, before culling/upload: every render path draws current wheels, lamps, parts and seated drivers.
    this.scene.onBeforeRender = (renderer) => {
      const drawn = this.drawnCars();
      this.wheels.sync(drawn, renderer);
      this.lampBatch.night = this.stage.night;
      this.lampBatch.sync(drawn);
      this.partBatch.sync(drawn);
      // In the garage the standing dummy beside the car is the driver, and the showcase's cars show their empty cabins: no one sits in the car there.
      this.seated.sync(this.showGarage || this.showShowcase ? [] : drawn, driverLook);
      this.coverBatch.sync(drawn);
    };

    this.debris = new DebrisSystem(this.scene);
    this.sparks = new SparkSystem(this.scene);
    this.fountains = new Fountains(this.scene);
    this.smoke = new TireSmokeSystem(this.scene);
    this.ragdolls = new RagdollSystem(this.scene, (i) => this.onThrow(i), (at, frame, inherit) => this.onExit(at, frame, inherit));
    this.ragdolls.poles = this.poles;
    this.ragdolls.lookOf = (car) => this.looks.of(car, this.ownCar());
    this.lab.dolls = this.ragdolls;
    this.cine = new Cinematics(this.renderer, this.scene, this.view, { sparks: this.sparks, fountains: this.fountains.jets, glass: this.glassDots, witness: this.witness }, MAX_CARS, this.clock.reduceMotion, () => this.queueWarm());
    // `?fx=off|minimal|low|high|ultra` picks the tier for the session (bench A/B); the auto tier otherwise. Ultra loads after boot (below).
    const fxParam = FX_TIERS.find((t) => t === new URLSearchParams(window.location.search).get(SETTING_KEY.fx));
    this.cine.marks.phone = !desktop;
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
    this.trace = new TraceRecorder({
      barrier: this.barrier,
      balls: this.balls,
      sparks: this.sparks,
      smoke: this.smoke,
      debris: this.debris,
    });
    this.impactLight = new THREE.PointLight(0xffc27a, 0, 22, 2);
    this.scene.add(this.impactLight);
    // Four body lamps per car plus at most one lit siren; a phone links the lean pool (`lampPoolFor`). Fixed here, before the programs
    // link: a light-count change relinks every lit shader.
    this.lampLights = new LampLights(this.scene, MAX_CARS * 5, lampPoolFor(desktop, new URLSearchParams(window.location.search).get("lamps")));
    this.lampLights.middleTile = desktop;
    groundMaterial(this.lampLights.pools.material as THREE.Material, GROUND_LEVEL.decal);
    this.lampLights.pools.renderOrder = levelOrder(GROUND_LEVEL.decal);
    this.race = this.makeRace();
    this.highlights = this.makeHighlights();
    this.podium = this.makePodium();

    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(canvas.parentElement ?? canvas);

    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    // three calls preventDefault on webglcontextlost (so the browser may restore) and rebuilds its own state on restore; the rest is ours.
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.pad.attach(() => this.emitHud());
    this.view.attach();
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
        this.emitHud();
      },
      leave: () => this.setScene("fleet"),
      watchCam: () => void (this.view.spec = "auto"),
      hitFx: this.hitFx,
      shotFx: this.shotFx,
      throwPassenger: (car, look) => this.ragdolls.throwPassenger(car, look),
      throwFigure: (strike) => this.ragdolls.throwFigure(strike, this.live()),
      hit: (i, closing) => this.noteHit(i, closing),
      knockProp: (index, car, vx, vy, vz) => this.ragdolls.knockProp(index, car, vx, vy, vz),
      buildArt: (track, placed) => {
        this.queueWarm();
        const art = new TrackArt(track, placed, this.stage);
        this.ragdolls.setCourse(track, placed, art.props);
        return art;
      },
      markBounds: (minX, minZ, maxX, maxZ) => this.cine.marks.setBounds(minX, minZ, maxX, maxZ),
      // tickInner's wreck-slide rule (`bleedAfterSlide` once the crash clock is past the hit).
      bleeds: () => this.clock.wallSinceImpact > 0.2,
      reelReady: (clips, since) => this.startReel(clips, since),
      clear: () => this.clearScene(),
      heardMeter: (i) => this.net.heard(i),
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
      crash: (contact, normal) => this.cine.beginCrashCam(contact, normal, this.crashSight(), this.clock.hold),
      impact: (contact, normal, closing) => this.beginCinematic(contact, normal, closing, false),
      hit: this.hitFx,
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

  dispose(): void {
    this.mouseLook.exit();
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.pad.detach();
    this.detachShare();
    this.net.leave();
    this.view.detach();
    this.resizeObs.disconnect();
    for (const car of this.cars) car.dispose();
    this.podium.dispose();
    this.race.dispose();
    this.labArt?.dispose();
    this.garage?.dispose();
    this.looks.dispose();
    this.rivals.dispose();
    for (const batch of [this.wheels, this.lampBatch, this.partBatch, this.seated, this.coverBatch]) batch.dispose();
    this.sparks.dispose();
    this.fountains.dispose();
    this.debris.dispose();
    this.cine.dispose();
    this.glassDots.dispose();
    this.smoke.dispose();
    this.ragdolls.dispose();
    this.lampLights.dispose();
    this.audio.dispose();
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
    // The first rAF stamp can predate `start()`'s performance.now(): a negative dt froze the sim for seconds.
    const wallDt = Math.min(this.advanceDt ?? Math.max(0, (now - this.last) / 1000), 0.1);
    this.last = now;
    if (wallDt > 1e-4) {
      const inst = 1 / wallDt;
      this.fps = this.fps > 1 ? this.fps * 0.85 + inst * 0.15 : inst;
    }
    this.pollInput(wallDt);
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
          this.pace.run(simDt, this.clock.timeScale * this.cine.timeWarp, sliceSpeed(cars), fineNeeded, performance.now() + PACE_BUDGET_MS, this.slice);
        }
      }
      this.stepEdge();
      this.scheduleSkins(cars);
      // A client draws the host's skins; the reel's replay (a client's too) skins its own cars, the hidden ones wait.
      if (reelDt !== null || !this.net.client) {
        for (let i = 0; i < cars.length; i++) {
          const car = cars[i]!;
          if (reelDt !== null || this.showStack ? car.group.visible : !this.rigScene || car === this.carA) car.updateSkin();
        }
      }
      // The reel's skins and parts were written after `ClipSim.present`: draw them at the frame's time too.
      if (reelDt !== null) this.blend.refresh();
      if (reelDt === null && !this.net.client) this.updatePhase(wallDt);
      if (this.showStack) this.stepStack(); else if (this.showPistons && this.looping) this.stepPistonLoop(wallDt);
      if (reelDt === null && this.clock.phase !== "approach") this.emitContactFx();
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
      this.debris.update(fxDt);
      this.sparks.update(fxDt);
      this.glassDots.update(fxDt);
      armTops(null);
      this.fountains.setLook(this.cine.tier, this.fxDensity);
      this.fountains.update(fxDt);
      this.smoke.update(fxDt, this.camera);
      const sandbox = !this.race.active && !this.derbyMode;
      // Who the drivers look like: the clip on screen's race, else this race's, this derby round's, or this run's scene seed.
      this.ragdolls.lookSeed = this.highlights.look ?? (this.race.active ? this.race.look : this.derbyMode ? this.derbyRound : this.sceneSeed);
      this.ragdolls.update(simDt, cars, !this.net.client, sandbox, this.barrierUp ? this.barrier.group : null);
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
      this.cine.update(wallDt, simDt, cars, this.followedCar(), this.seat.mode === "drive", this.fxDensity, this.net.client);
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
      this.race.frame(this.playing && !held ? wallDt : 0, this.highlights.people);
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
    this.updateCamera(wallDt);
    this.rumbleFrame(this.playing && !held ? wallDt : 0);
    this.flushVisibleSkins();
    this.detail.update(this.cars, this.camera, this.followedCar(), this.highlights.playing ? this.highlights.focus() : null);
    this.lampLights.night = this.stage.night;
    this.lampLights.update(this.live(), this.camera, this.followedCar(), performance.now() / 1000, this.highlights.playing ? this.highlights.cars() : undefined, wallDt);
    if (this.audioOn) this.audio.frame(wallDt, this.highlights.playing ? this.highlights.cars() : this.live(), this.highlights.playing ? this.highlights.focus() : this.followedCar(), this.clock.timeScale * this.cine.timeWarp, this.playing && !held);
    if (this.stage.night) this.stage.syncPools(this.poles);
    const drawAt = performance.now();
    if (!this.skipDraw) {
      this.scene.sync(this.warmsInFlight === 0);
      this.cine.render(this.scene, this.camera, wallDt, this.markFocus());
      this.framesDrawn++;
    }
    this.renderMs = performance.now() - drawAt;
    this.blend.restore();
    this.hudAcc += wallDt;
    if (this.hudAcc > (this.clock.timeScale < 0.5 ? 0.05 : 0.12)) {
      this.hudAcc = 0;
      this.emitHud();
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
    this.lodFrame++;
    const followed = this.followedCar();
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      const stride = car === followed ? 1 : this.skinStride(car);
      this.lodStride[i] = stride;
      car.deform.skinDeferred = stride === 0 || (this.lodFrame + i) % stride !== 0;
    }
  }

  /**
   * After the camera update: any owed car now on screen at full rate, or just entering the view, skins before it draws.
   * Always reads the final camera into `witness`: next frame's FX spawns (decided before its rigs aim) ask that cone.
   */
  private flushVisibleSkins(): void {
    this.witness.aim(this.camera);
    const cars = this.live();
    let followed: DeformableCar | null | undefined;
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      if (!car.deform.skinOwed) continue;
      if (followed === undefined) followed = this.followedCar();
      const stride = car === followed ? 1 : this.skinStride(car);
      if (stride === 1 || (stride > 1 && this.lodStride[i] === 0)) car.flushDeferredSkin();
      this.lodStride[i] = stride;
    }
  }

  /** 0 off-screen, else skin every Nth frame by projected size. Needs `witness.aim` this frame. */
  private skinStride(car: DeformableCar): number {
    _lodCenter.set(car.group.position.x, car.group.position.y + 0.6, car.group.position.z);
    if (!this.witness.mayWitness(_lodCenter, LOD_RADIUS)) return 0;
    const d = _v.setFromMatrixPosition(this.camera.matrixWorld).distanceTo(_lodCenter);
    if (d <= LOD_RADIUS) return 1;
    const halfHeightPx = (this.renderer.domElement.height / this.renderer.getPixelRatio()) * 0.5;
    const px = (LOD_RADIUS / (d * Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)))) * halfHeightPx;
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
  };

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
    this.ragdolls.launch(e, cars, true, release);
    if (this.minigameMode !== null) this.minigames.noteThrown();
    if (this.race.active) this.race.recorder.eject(e);
    this.net.sendEject(e);
  }

  private fixedStep(dt: number): void {
    const cars = this.live();
    // Race: every car (the player too) is driven through its controller slot by the director.
    if (this.race.active) this.race.drive(dt);
    const driven = this.seat.mode === "drive" && !this.race.active ? this.seat.carIndex : -1;
    if (driven >= 0 && driven < cars.length) {
      const car = cars[driven]!;
      if (car.deform.drivetrainAlive && !(this.derbyMode && this.derby.held(driven))) applyDrive(car, this.seat.input(car, dt), dt);
      if (this.seat.selfRight(car.group.matrixWorld.elements[5]!, car.velocity.length(), dt)) this.recoverDriven();
    }
    this.net.drive(cars, dt, driven);
    if (this.derbyMode && this.derby.winnerId == null) {
      const snaps = this.derby.snapshots(cars.length);
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i]!;
        snapshotAiCar(snaps[i]!, i, c, c.deform.drivetrainAlive);
      }
      for (let i = 0; i < cars.length; i++) {
        if (i === driven || this.derbySeated.has(i)) continue;
        applyAiDrive(cars[i]!, this.derby.think(snaps[i]!, snaps, dt), dt);
        if (this.derby.recoverDue(i, cars[i]!, dt)) this.recoverCar(cars[i]!);
      }
    }
    // A crashed car nobody drives still rolls on its drive's law (car-air `driven` skips tyre friction for it): the race, the derby
    // before its winner and the net host drive theirs; the rest take the idle pedals here.
    if (!this.race.active && !(this.derbyMode && this.derby.winnerId == null)) {
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i]!;
        if (i === driven || car.parked || !car.crashed || !car.deform.massActive || this.net.drives(i, driven)) continue;
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
    w.lone = this.race.active;
    if (!this.race.active && !this.showLab) this.syncRigs();
    this.ejection.ctx = this.derbyMode ? "derby" : "default";
    this.ejection.minigame = this.minigameMode !== null;
    w.fine = this.pace.fine;
    lap(w.phases, PHASE.drive);
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
      this.beginCinematic(contact, normal, impulse);
    } else if ((this.derbyMode || this.race.active) && contact && normal && impulse > SPARK_MIN_IMPULSE && this.elapsedWall - this.sparkAt > 0.16 && this.witness.sees(contact, FX_REACH.sparks)) {
      this.sparkAt = this.elapsedWall;
      this.sparkShower(contact, normal, impulse);
    }
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
      this.minigames.step(this.ragdolls, this.seat.mode === "drive" && this.seat.carIndex === 0);
      return;
    }
    // A thrown range driver holds the loop until his landing has been shown (`RangeRun`); otherwise it runs as the
    // fleet's, after any ride-along with thrown drivers. The Lab never loops: the wreckage stays until the player resets.
    const still = this.showRange ? this.ragdolls.latest(_v) : -1;
    const shown = this.showRange && this.rangeRun.step(still >= 0, this.ragdolls.latestSettled, _v.x, wallDt);
    if (this.looping && !this.showLab && !this.showGarage && (shown || (still < 0 && settled && !this.ragdolls.rideAlong && !this.showPistons && this.clock.wallSinceImpact > (this.showCompactor ? 14 : 10.4)))) this.randomizeAndReset();
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

  /** What the shot watches, for the tyre-mark window: the crash cam's hit while it cuts, else the reel's or the seat's car, else the eye. */
  private markFocus(): THREE.Vector3 {
    if (this.cine.cutting) return this.cine.crash.hit;
    const car = this.highlights.playing ? this.highlights.focus() : this.followedCar();
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
    const back = this.view.rear && !this.view.flying ? this.followedCar() : null;
    if (back?.group.visible) this.view.lookBack(back, this.chaseSight(true), wallDt);
  }

  /** The free view's frame: the held keys and sticks (none under a menu), over the scene's footprint. */
  private flyFree(wallDt: number): void {
    sceneExtent(this.view.free.extent, this.derbyMode, this.race.active ? this.race.courseBounds() : this.showRange ? this.minigames.bounds() : null);
    this.view.frameFree(readFreeInput(this.keys, this.pad.state, this.race.menuOpen, this.freeInput), wallDt);
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
    const cut = this.cine.direct(this.camera, wallDt, !this.view.flying && !this.view.userFramed && this.seat.mode !== "drive");
    if (this.view.flying) {
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
