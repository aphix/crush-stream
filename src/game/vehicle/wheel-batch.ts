import * as THREE from "three";
import { makeWheelGeometry, makeWheelGeometryFar, makeWheelMaterial, treadNormalMap, WHEEL_DESIGNS, type WheelDesign } from "./car-materials.ts";
import type { DeformableCar } from "./car.ts";
import type { CarStyleId } from "./car-variants.ts";
import { spokeSmear } from "./wheel-blur.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import { GRAVITY } from "../kernel/constants.ts";
import { CLASSES, carClass } from "./vehicle-classes.ts";

/** What the batch needs of a renderer: its shadow pass, which it wraps to show the shadow prisms to that pass alone. */
type ShadowPass = { readonly shadowMap: { render: THREE.WebGLShadowMap["render"] } };

/** An untinted wheel: the instance colour that leaves the tyre and the alloy as toned. */
const UNTINTED = new THREE.Color(1, 1, 1);
const _tyre = new THREE.Vector3();
const _drawn = new THREE.Matrix4();

/** Each body style's rim design and its default instance tint (a player's `userData.rim` replaces it), from the reference cars. */
export const STYLE_WHEELS: Readonly<Record<CarStyleId, { design: WheelDesign; tint: THREE.Color }>> = {
  sedan: { design: "split10", tint: UNTINTED },
  hatchback: { design: "five", tint: UNTINTED },
  wagon: { design: "split10", tint: new THREE.Color(0x5c6068) },
  coupe: { design: "mag5", tint: UNTINTED },
  pickup: { design: "six", tint: UNTINTED },
  police: { design: "five", tint: new THREE.Color(0xc4c8ce) },
  monster: { design: "beadlock", tint: UNTINTED },
};

/** A tyre's vertical rate (N/m): a passenger tyre near 2.2 bar; a class's kerb weight over four flattens its foot by weight / rate. */
const TYRE_RATE = 250e3;
/** The loaded sidewall's bulge across (m) per metre of flatten. */
const BULGE_PER_FLATTEN = 0.75;

/** One instanced draw of one wheel geometry: the wheels at one distance rung. */
class WheelLane {
  readonly mesh: THREE.InstancedMesh;
  /** Per instance: how smeared its spokes are drawn (`spokeSmear` of the turn since the last drawn frame). */
  private readonly blur: THREE.InstancedBufferAttribute;
  /** Per instance: the hub-frame down (y, z), flatten over crown radius, and sidewall bulge in the mesh's own units (`makeWheelMaterial`). */
  private readonly squash: THREE.InstancedBufferAttribute;
  private readonly capacity: number;
  private n = 0;

  constructor(geo: THREE.BufferGeometry, capacity: number) {
    // Its own copy of the parts material (and shadow depth material): on the material the plain part meshes use,
    // three re-ran program selection (`getProgram`, an allocation) on every instanced ↔ plain switch, twice a frame.
    const mat = makeWheelMaterial();
    mat.normalMap = treadNormalMap();
    this.capacity = capacity;
    this.blur = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.blur.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("blur", this.blur);
    this.squash = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.squash.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("tyreLoad", this.squash);
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances span the pad and move every frame; a stale bound would cull live wheels.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // A player's rim colour (`userData.rim` on the wheel, `car-look.ts`) tints the instance: the alloy takes it, the black tyre stays black.
    this.mesh.setColorAt(0, UNTINTED);
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  begin(): void {
    this.n = 0;
  }

  /** Whether another wheel fits. */
  get open(): boolean {
    return this.n < this.capacity;
  }

  /** `down` (y, z) the hub-frame down, `flatten` over the crown radius (0 unloaded), `bulge` across in mesh units. */
  add(world: THREE.Matrix4, smear: number, tint: THREE.Color, downY: number, downZ: number, flatten: number, bulge: number): void {
    this.blur.setX(this.n, smear);
    this.squash.setXYZW(this.n, downY, downZ, flatten, bulge);
    this.mesh.setColorAt(this.n, tint);
    this.mesh.setMatrixAt(this.n++, world);
  }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    const attr = this.mesh.instanceMatrix;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, n * 16);
    attr.needsUpdate = true;
    this.blur.clearUpdateRanges();
    this.blur.addUpdateRange(0, n);
    this.blur.needsUpdate = true;
    this.squash.clearUpdateRanges();
    this.squash.addUpdateRange(0, n * 4);
    this.squash.needsUpdate = true;
    const tint = this.mesh.instanceColor!;
    tint.clearUpdateRanges();
    tint.addUpdateRange(0, n * 3);
    tint.needsUpdate = true;
  }
}

/** The shadow proxy's prism is twelve-sided, of equal area to the tyre's circle so the shadow keeps its size. */
const SHADOW_SIDES = 12;
/** Its circumradius (m): the platform tyre's crown radius (0.32) times √(π / 3), since a twelve-sided polygon's area is 3 R². */
const SHADOW_RADIUS = 0.32 * Math.sqrt(Math.PI / 3);
/** The tyre's width (m) between its shoulders (±0.112 on `TYRE_PROFILE`). */
const SHADOW_WIDTH = 0.224;

/**
 * Every car's wheels (tyre, rim, hub) as one instanced draw per rim design (`STYLE_WHEELS`), one far draw and one shadow
 * draw: the design's full wheel for a car the distance detail draws whole, the far wheel (`makeWheelGeometryFar`) for a car
 * cut to its body. Cars keep a bare Group per wheel as the transform that spins, steers, rides the hub and pops; `sync`
 * copies those world matrices in once the scene's matrices are current for the frame. A design no shown car uses draws nothing.
 *
 * The sun's shadow pass draws none of those: it draws `shadow`, every wheel as a 48-triangle tyre prism (the shadow
 * of a wheel is its tyre's silhouette), shown to the pass alone by `attach`'s wrapper of `shadowMap.render`. The main
 * pass builds its draw list before the shadow pass runs, so a mesh that turns visible only for the shadow pass is not in it.
 */
export class WheelBatch {
  /** The full-detail wheels per design in `WHEEL_DESIGNS` order, the far ones, then the shadow prisms (shown to the shadow pass only). */
  readonly meshes: readonly THREE.InstancedMesh[];
  /**
   * The one object the scene holds: every draw in `meshes` under a group that is never hidden, so a scene that takes its hidden
   * children out of the graph (`ParkingScene`) keeps the prisms, hidden outside the shadow pass, and the empty design draws.
   */
  readonly group = new THREE.Group();
  /** One lane per design, in `WHEEL_DESIGNS` order. */
  private readonly near: readonly WheelLane[];
  private readonly far: WheelLane;
  private readonly shadow: THREE.InstancedMesh;
  private readonly isFar: (car: DeformableCar) => boolean;
  private attached: ShadowPass | null = null;
  private detach: (() => void) | null = null;
  /**
   * Each wheel's angle at its last change and the turn that change made: the turn between two drawn frames is what the
   * eye sees. A second `sync` in the same frame (a render pass per target) finds no change and keeps the step.
   */
  private readonly turn = new WeakMap<THREE.Object3D, { angle: number; step: number }>();

  /** `isFar`: whether the distance detail has cut a car to its body (`CarDetail.isFar`): its wheels are drawn far wheels. */
  constructor(capacity: number, isFar: (car: DeformableCar) => boolean) {
    this.isFar = isFar;
    this.near = WHEEL_DESIGNS.map((d) => new WheelLane(makeWheelGeometry(d), capacity));
    this.far = new WheelLane(makeWheelGeometryFar(), capacity);
    const prism = new THREE.CylinderGeometry(SHADOW_RADIUS, SHADOW_RADIUS, SHADOW_WIDTH, SHADOW_SIDES).rotateZ(Math.PI / 2);
    prism.deleteAttribute("normal");
    prism.deleteAttribute("uv");
    this.shadow = new THREE.InstancedMesh(prism, new THREE.MeshBasicMaterial(), capacity);
    this.shadow.customDepthMaterial = new THREE.MeshDepthMaterial();
    this.shadow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadow.castShadow = true;
    this.shadow.frustumCulled = false;
    this.shadow.visible = false;
    this.shadow.count = 0;
    this.meshes = [...this.near.map((l) => l.mesh), this.far.mesh, this.shadow];
    this.group.add(...this.meshes);
  }

  /** Show the shadow prisms to `renderer`'s shadow pass and to nothing else. */
  private attach(renderer: ShadowPass): void {
    this.detach?.();
    this.attached = renderer;
    const map = renderer.shadowMap;
    const render = map.render;
    map.render = (lights, scene, camera) => {
      this.shadow.visible = true;
      try {
        render.call(map, lights, scene, camera);
      } finally {
        this.shadow.visible = false;
      }
    };
    this.detach = () => {
      map.render = render;
    };
  }

  /**
   * Pack the shown wheels of `cars` (world matrices must be current); a car the detail has cut gets the far wheel. `renderer` is the one drawing: its shadow pass is hooked once.
   * A wheel on its hub and down (`wheelsDown`) carries its class's rest load as a flattened foot at its hub-frame bottom.
   */
  sync(cars: readonly DeformableCar[], renderer: ShadowPass): void {
    if (this.attached !== renderer) this.attach(renderer);
    for (const lane of this.near) lane.begin();
    this.far.begin();
    let shadows = 0;
    for (const car of cars) {
      const look = STYLE_WHEELS[car.style.id];
      const lane = this.isFar(car) ? this.far : this.near[WHEEL_DESIGNS.indexOf(look.design)]!;
      // The one wheel mesh is the platform tyre's size: a car's own tyre (its dims) scales it across (width) and in the wheel's plane (radius).
      const { r, halfW } = car.frame.rig.tyre;
      const sized = r !== PLATFORM_TYRE.r || halfW !== PLATFORM_TYRE.halfW;
      _tyre.set(halfW / PLATFORM_TYRE.halfW, r / PLATFORM_TYRE.r, r / PLATFORM_TYRE.r);
      const flatten = (CLASSES[carClass(car)].mass * GRAVITY) / 4 / TYRE_RATE;
      for (let i = 0; i < car.wheels.length; i++) {
        const w = car.wheels[i]!;
        let shown = lane.open;
        let onHub = false;
        for (let p: THREE.Object3D | null = w; p && shown; p = p.parent) {
          shown = p.visible;
          onHub ||= p === car.group;
        }
        let t = this.turn.get(w);
        if (!t) this.turn.set(w, (t = { angle: w.rotation.x, step: 0 }));
        if (w.rotation.x !== t.angle) {
          t.step = w.rotation.x - t.angle;
          t.angle = w.rotation.x;
        }
        if (!shown) continue;
        const world = sized ? _drawn.copy(w.matrixWorld).scale(_tyre) : w.matrixWorld;
        const loaded = onHub && ((car.wheelsDown >> i) & 1) !== 0;
        // The body's down in the spun wheel's frame: the foot stays at the bottom however far the wheel has turned.
        const spin = w.rotation.x;
        lane.add(
          world,
          spokeSmear(t.step),
          (w.userData.rim as THREE.Color | undefined) ?? look.tint,
          -detCos(spin),
          detSin(spin),
          loaded ? flatten / (r * w.scale.y) : 0,
          (BULGE_PER_FLATTEN * flatten * PLATFORM_TYRE.halfW) / (halfW * w.scale.x),
        );
        this.shadow.setMatrixAt(shadows++, world);
      }
    }
    for (const lane of this.near) lane.end();
    this.far.end();
    this.shadow.count = shadows;
    const attr = this.shadow.instanceMatrix;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, shadows * 16);
    attr.needsUpdate = true;
  }

  dispose(): void {
    this.detach?.();
    this.attached = null;
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.dispose();
    }
  }
}
