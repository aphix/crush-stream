import * as THREE from "three";
import { MAX_TETHERS } from "../kernel/constants.ts";
import { R_STRENGTH, RAPIER, ROW, TetherSet, THING, thingIndex, thingKind, WORLD } from "../contact/tether.ts";
import { BODY_KIND, CABLE_END, type BodyFrame, type BodyMotion } from "../net/body-codec.ts";
import { TetherArt } from "../present/tether-art.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { activeGround } from "../world/ground.ts";
import { TORSO_ABOVE_FEET } from "./body-follow.ts";
import type { OpenWorldBodies } from "./openworld-bodies.ts";
import { DRAWN, type OpenWorldShared } from "./openworld-shared.ts";
import { idOf, kindOf, personOf } from "./people-index.ts";

const NO_CARS: readonly DeformableCar[] = [];
const _point = new THREE.Vector3();
const _spot = { x: 0, z: 0 };

/** The person whose body, or else whose dummy, is in pool slot `slot`; -1 for none. */
function personOfDoll(slot: number, bodies: OpenWorldBodies | null, shared: OpenWorldShared | null): number {
  const person = bodies === null ? -1 : bodies.personOfSlot(slot);
  return person >= 0 || shared === null ? person : shared.personOfDummy(slot);
}

/** Host: the cables of `tethers` written into `out` after its records: a car end is the car and its car-frame point, an end on a person's body or dummy is that person (no point), any other end a world point. */
export function writeCables(out: BodyFrame, tethers: TetherSet, bodies: OpenWorldBodies | null, shared: OpenWorldShared | null, capacity: number): void {
  for (let slot = 0; slot < MAX_TETHERS && out.cables < MAX_TETHERS; slot++) {
    if (!tethers.isAlive(slot)) continue;
    const cable = out.cables++;
    for (let end = 0; end < 2; end++) writeEnd(out, tethers, slot, end, 2 * cable + end, bodies, shared, capacity);
    out.cableLength[cable] = tethers.length(slot);
    out.cableStrain[cable] = tethers.tension(slot) / tethers.rows[slot * ROW + R_STRENGTH]!;
  }
}

/** Cable `slot`'s end `end` as frame end `at`. */
function writeEnd(out: BodyFrame, tethers: TetherSet, slot: number, end: number, at: number, bodies: OpenWorldBodies | null, shared: OpenWorldShared | null, capacity: number): void {
  const car = tethers.endCar(slot, end);
  if (car >= 0) {
    tethers.point(slot, end, _point);
    putEnd(out, at, CABLE_END.car, car, _point.x, _point.y, _point.z);
    return;
  }
  const person = car === RAPIER && thingKind(tethers.thing(slot, end)) === THING.doll ? personOfDoll(thingIndex(tethers.thing(slot, end)), bodies, shared) : -1;
  if (person >= 0) {
    putEnd(out, at, CABLE_END.person + kindOf(person, capacity), idOf(person, capacity), 0, 0, 0);
    return;
  }
  tethers.anchor(slot, end, NO_CARS, _point);
  putEnd(out, at, CABLE_END.world, 0, _point.x, _point.y, _point.z);
}

function putEnd(out: BodyFrame, at: number, kind: number, id: number, x: number, y: number, z: number): void {
  out.endKind[at] = kind;
  out.endId[at] = id;
  out.endPoint[3 * at] = x;
  out.endPoint[3 * at + 1] = y;
  out.endPoint[3 * at + 2] = z;
}

/** The host's cables as a guest draws them: a set of its own, in no world and never solved, and the tether's art over it. */
export class RemoteCables {
  readonly set = new TetherSet();
  readonly art = new TetherArt();

  /**
   * Once a frame: every row is released; with a frame, each cable is opened and its ends set (a car end on that car, a world end at its point, a person end where this machine draws that person: its own
   * player at `own`, anyone else where `shared.drawnAt` says, at her torso's height over the ground there), and drawn. A cable with an end on a person drawn nowhere is not drawn.
   */
  frame(frame: BodyFrame | null, cars: readonly DeformableCar[], camera: THREE.Camera, shared: OpenWorldShared | null, capacity: number, own: BodyMotion | null, ownCar: number): void {
    this.set.clear();
    if (frame !== null && shared !== null) {
      for (let cable = 0; cable < frame.cables; cable++) {
        const slot = this.set.open();
        if (this.setEnds(frame, cable, slot, shared, capacity, own, ownCar)) this.set.setDrawn(slot, frame.cableLength[cable]!, frame.cableStrain[cable]!);
        else this.set.release(slot);
      }
    }
    this.art.update(this.set, cars, camera, null, null);
  }

  private setEnds(frame: BodyFrame, cable: number, slot: number, shared: OpenWorldShared, capacity: number, own: BodyMotion | null, ownCar: number): boolean {
    for (let end = 0; end < 2; end++) {
      const at = 2 * cable + end;
      const kind = frame.endKind[at]!;
      const x = frame.endPoint[3 * at]!;
      const y = frame.endPoint[3 * at + 1]!;
      const z = frame.endPoint[3 * at + 2]!;
      if (kind === CABLE_END.car) this.set.setEnd(slot, end, frame.endId[at]!, x, y, z);
      else if (kind === CABLE_END.world) this.set.setEnd(slot, end, WORLD, x, y, z);
      else if (!this.setPersonEnd(slot, end, kind - CABLE_END.person, frame.endId[at]!, shared, capacity, own, ownCar)) return false;
    }
    return true;
  }

  /** End `end` of `slot` on the person of kind `kind` and id `id`: where this machine draws her; false when it draws her nowhere. */
  private setPersonEnd(slot: number, end: number, kind: number, id: number, shared: OpenWorldShared, capacity: number, own: BodyMotion | null, ownCar: number): boolean {
    if (kind === BODY_KIND.player && id === ownCar) {
      if (own === null) return false;
      this.set.setEnd(slot, end, WORLD, own.x, own.y, own.z);
      return true;
    }
    if (shared.drawnAt(personOf(kind, id, capacity), _spot) === DRAWN.none) return false;
    this.set.setEnd(slot, end, WORLD, _spot.x, activeGround().heightAt(_spot.x, _spot.z, 0.5) + TORSO_ABOVE_FEET, _spot.z);
    return true;
  }

  dispose(): void {
    this.art.dispose();
  }
}
