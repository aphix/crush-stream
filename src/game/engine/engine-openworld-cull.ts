import type * as THREE from "three";
import type { CarDetail } from "../present/car-detail.ts";
import { OpenWorldCarLod, type LodCar } from "../present/openworld-car-lod.ts";
import { SIGHT_ID_CAPACITY, SightField } from "../present/openworld-sight.ts";
import type { Occluder } from "../present/spectate-cam.ts";

/** What culling needs of the engine. */
export type OpenWorldCullPorts = {
  /** The cameras that draw the open world. */
  eyes(): readonly THREE.Camera[];
  /** The course's solids that can hide something (empty until the course is up). */
  solids(): readonly Occluder[];
  /** The cars players drive: this browser's and every seated peer's. */
  playerCars(): readonly LodCar[];
  detail(): CarDetail;
  /** The car the camera follows, null in a free view. */
  followed(): LodCar | null;
  /** A reel replay is playing: it owns every car's visibility. */
  replaying(): boolean;
};

/** What the local eyes see of the open world (`SightField`, read by everything that draws or streams) and the cars' share of it. */
export class OpenWorldCulling {
  readonly sight = new SightField([], SIGHT_ID_CAPACITY);
  private readonly ports: OpenWorldCullPorts;
  private readonly cars: OpenWorldCarLod;
  private solidsKnown = false;
  /** The frames' wall seconds summed: the field's clock, so a stepped engine (a probe) and a paused game keep their grace like a running one. */
  private seconds = 0;

  constructor(ports: OpenWorldCullPorts) {
    this.ports = ports;
    this.cars = new OpenWorldCarLod(this.sight, ports.detail());
  }

  /** A frame in the open world, before anything that asks `sight`. */
  frame(liveCars: readonly LodCar[], wallDt: number): void {
    if (!this.sight.enabled) {
      this.cars.release(liveCars);
      return;
    }
    if (!this.solidsKnown) this.takeSolids();
    this.seconds += wallDt;
    this.sight.update(this.ports.eyes(), this.seconds, this.ports.playerCars());
    this.cars.frame(liveCars, this.ports.followed(), this.ports.replaying());
  }

  /** The open world is left: hidden cars are drawn again, ids and solids are given back. */
  stop(liveCars: readonly LodCar[]): void {
    this.cars.stop(liveCars);
    this.sight.clear();
    this.solidsKnown = false;
    this.seconds = 0;
  }

  private takeSolids(): void {
    const solids = this.ports.solids();
    if (solids.length === 0) return;
    this.sight.setSolids(solids);
    this.solidsKnown = true;
  }
}
