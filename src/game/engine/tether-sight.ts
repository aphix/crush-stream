import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { RAPIER, THING, thingCode, WORLD } from "../contact/tether.ts";
import { AIM, type ReticleView } from "../present/tether-art.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { ANIMAL_MESH_NAMES } from "../present/animal-figure.ts";
import { CIVILIAN_FIGURES_NAME } from "../present/civilian-figure.ts";
import { BOXES_MESH_NAME } from "../present/minigame-art.ts";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import { INTERIOR_GLASS_NAME, INTERIOR_MESH_PREFIX } from "../present/interiors/interior-constants.ts";
import { RAGDOLLS_MESH_NAME } from "../present/ragdoll-pool.ts";

/** How far (m) the sight line is cast, so a surface past the hook's reach still reads red instead of nothing. */
const SIGHT_M = 400;
/** Nothing nearer than this (m) to the eye is hit: the player's own chase camera sits inside its car. */
const NEAR_CLIP_M = 0.5;
/** A drawn civilian is hooked when her chest axis lies within this far (m) behind the first surface the sight line meets: her own figure's front is that surface. */
const PERSON_SLACK_M = 0.5;
/** A building's facade is no wall for the person test when a built room's own mesh (its glass in a window's plane, its shell's wall) lies within this far (m) behind it: the room's meshes then decide whether the line goes on (through a window's opening) or stops (a solid wall). */
const FACADE_WALL_M = 1;

/** What the sight line reads of the engine. */
export interface SightHost {
  readonly camera: THREE.PerspectiveCamera;
  /** The scene whose drawn meshes the sight line meets. */
  readonly scene: THREE.Object3D;
  /** The dummies' world: which dummies are out. */
  readonly ropes: Pick<RagdollSystem, "dollOut">;
  /** Drawn things that move and are not a car (the wheel, lamp and part batches, the balls): a cable cannot hook the place they were drawn at. */
  movers(): readonly THREE.Object3D[];
}

/** What the sight line met: a car (its index), the static world, or a thing in the dummies' world (`RAPIER`, and `thing`: its `thingCode`). */
interface Mark {
  car: number;
  thing: number;
}

/** What one sight line would hook: a car index, `WORLD` or `RAPIER` (and its thing), a car-frame point for a car, the world point otherwise. */
export class Aim {
  state: ReticleView["state"] = AIM.none;
  readonly eye = new THREE.Vector3();
  readonly dir = new THREE.Vector3();
  readonly point = new THREE.Vector3();
  car = WORLD;
  thing = 0;
  readonly at = new THREE.Vector3();
  /** The drawn civilian with no body the aim would hook (-1: none): a body is stood for her when the fire is made. */
  person = -1;
  /** How far (m) along the sight line a drawn person may stand to be hooked: past the first surface that is opaque to the person test, by `PERSON_SLACK_M`. */
  personReach = SIGHT_M;
}

const _point = new THREE.Vector3();

/** Whether `object` is drawn in a building facade's material. */
function isFacade(object: THREE.Object3D): boolean {
  const material = object instanceof THREE.Mesh ? (object.material as THREE.Material | THREE.Material[]) : null;
  return material !== null && !Array.isArray(material) && material.userData.facadeStyle !== undefined;
}

/** The one sight line of an aiming actor through the drawn scene: the first surface it can hook. */
export class SightCaster {
  private readonly host: SightHost;
  private readonly raycaster = new THREE.Raycaster();
  /** Objects the sight line passes through: the tether's own art. */
  private readonly ignored: THREE.Object3D;
  /** The aiming actor's walker slot and his own car, which the sight line passes through (-1: none). */
  skipSlot = -1;
  skipCar = -1;
  /** The actor is not this machine's player: the car LOD hides cars no host eye sees, and rooms are built for the host's eyes only, so his ray meets every car and leaves buildings to their footprints. */
  remote = false;

  constructor(host: SightHost, ignored: THREE.Object3D) {
    this.host = host;
    this.ignored = ignored;
  }

  /**
   * The first drawn surface along `into`'s sight line, the aiming actor's own car and what moves aside: a car's body is hooked at that point of its frame, a dummy, a prop that can be knocked
   * or a box at the world point (and as that thing), anything else at the world point. The same sight line and meshes as picking a car (`carAt`), the garage's spray and the showcase's
   * shove, over the whole scene.
   */
  cast(cars: readonly DeformableCar[], into: Aim): boolean {
    this.raycaster.set(into.eye, into.dir);
    this.raycaster.camera = this.host.camera;
    this.raycaster.near = NEAR_CLIP_M;
    this.raycaster.far = SIGHT_M;
    const movers = this.host.movers();
    let found = false;
    // The person test's own wall: the first surface it cannot see through (a facade with a built room behind it, its glass and its shell's openings aside).
    let opaque = Infinity;
    let facadeAt = -1;
    let roomBehind = false;
    for (const hit of this.raycaster.intersectObject(this.host.scene, true)) {
      const mark = this.markOf(hit, movers, cars);
      if (mark === undefined || (this.skipCar >= 0 && mark.car === this.skipCar)) continue;
      if (!found) {
        found = true;
        into.point.copy(hit.point);
        into.car = mark.car;
        into.thing = mark.thing;
        if (mark.car < 0) into.at.copy(hit.point);
        else into.at.copy(cars[mark.car]!.group.worldToLocal(_point.copy(hit.point)));
      }
      if (this.remote) {
        const bounded = hit.object.name === INTERIOR_GLASS_NAME || hit.object.name.startsWith(INTERIOR_MESH_PREFIX) || isFacade(hit.object);
        into.personReach = bounded ? SIGHT_M : hit.distance + PERSON_SLACK_M;
        return true;
      }
      const room = hit.object.name.startsWith(INTERIOR_MESH_PREFIX) && facadeAt >= 0 && hit.distance - facadeAt <= FACADE_WALL_M;
      if (facadeAt >= 0 && !roomBehind && !room) {
        opaque = facadeAt;
        break;
      }
      roomBehind ||= room;
      if (hit.object.name === INTERIOR_GLASS_NAME) continue;
      if (isFacade(hit.object)) {
        facadeAt = hit.distance;
        roomBehind = false;
        continue;
      }
      opaque = hit.distance;
      break;
    }
    if (opaque === Infinity && facadeAt >= 0 && !roomBehind) opaque = facadeAt;
    into.personReach = opaque === Infinity ? SIGHT_M : opaque + PERSON_SLACK_M;
    return found;
  }

  /** What `hit` is a surface of: a car, a thing of the dummies' world, or the static world; undefined where the sight line passes through (not drawn, not a mesh, a mover, a dummy not out or the tether's own art). */
  private markOf(hit: THREE.Intersection, movers: readonly THREE.Object3D[], cars: readonly DeformableCar[]): Mark | undefined {
    const object = hit.object;
    if (!(object instanceof THREE.Mesh)) return undefined;
    let car = WORLD;
    for (let o: THREE.Object3D | null = object; o; o = o.parent) {
      const index: unknown = o.userData.carIndex;
      const isCar = typeof index === "number" && cars[index]?.group === o;
      if ((!o.visible && !(this.remote && isCar)) || o === this.ignored || movers.includes(o)) return undefined;
      if (isCar) car = index;
    }
    if (car !== WORLD) return { car, thing: 0 };
    // A far figure of the crowd is no surface of the world: the sight line passes her, and the person test hooks her by her chest (a hit on her front had hooked the air where she stood). A cat or a dog is not hooked at all: the sight line passes them too.
    if (object.name === CIVILIAN_FIGURES_NAME || object.name === ANIMAL_MESH_NAMES.cat || object.name === ANIMAL_MESH_NAMES.dog) return undefined;
    // Only the pool's mesh is drawn by slot: a crowd, guard or seated driver drawn on another `DummyMesh` is no dummy of that world, and the sight line passes her.
    if (object instanceof DummyMesh && (object.name !== RAGDOLLS_MESH_NAME || hit.instanceId === undefined || hit.instanceId === this.skipSlot || !this.host.ropes.dollOut(hit.instanceId))) return undefined;
    const thing = this.thingOf(object, hit.instanceId);
    return thing === 0 ? { car: WORLD, thing } : { car: RAPIER, thing };
  }

  /** The thing of the dummies' world instance `instance` of `object` is drawn as (`thingCode`), or 0 where it is none: a dummy, a prop that can be knocked, a box. */
  private thingOf(object: THREE.Mesh, instance: number | undefined): number {
    if (instance === undefined) return 0;
    if (object instanceof DummyMesh) return thingCode(THING.doll, instance);
    if (object.name === BOXES_MESH_NAME) return thingCode(THING.box, instance);
    const knockOf: unknown = object.userData.knockOf;
    const prop = knockOf instanceof Int32Array ? knockOf[instance] : undefined;
    return prop !== undefined && prop >= 0 ? thingCode(THING.prop, prop) : 0;
  }
}
