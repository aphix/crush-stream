import * as THREE from "three";
import { DummyMesh } from "../present/ragdoll-mesh.ts";
import type { RagdollSystem } from "../present/engine-ragdoll.ts";
import { ShowcaseArt } from "../present/showcase-art.ts";
import { ShowcaseWalks } from "./showcase-walks.ts";

/** The screen box the pointer's client coordinates are read in (the canvas's `getBoundingClientRect`). */
type Rect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };

const _ndc = new THREE.Vector2();
const _facing = new THREE.Vector3();

/**
 * The showcase's runtime (`#scene=showcase`, reachable by link only): its set (`ShowcaseArt`) and the press that knocks a figure
 * over. A press on a standing figure pushes him at the point it landed (`ShowcaseWalks`: the ragdoll world takes him, he gets up and
 * walks home) and the set lets him go; a press on a dummy that is away knocks him again where he is; a press elsewhere still turns the
 * camera. A reset stands everyone up again.
 */
export class Showcase {
  readonly art = new ShowcaseArt();
  private readonly camera: THREE.Camera;
  private readonly rect: () => Rect;
  private readonly walks: ShowcaseWalks;
  private readonly ragdolls: RagdollSystem;
  private readonly ray = new THREE.Raycaster();

  constructor(camera: THREE.Camera, rect: () => Rect, ragdolls: RagdollSystem) {
    this.camera = camera;
    this.rect = rect;
    this.ragdolls = ragdolls;
    this.walks = new ShowcaseWalks(this.art, ragdolls);
  }

  down(x: number, y: number): boolean {
    const r = this.rect();
    _ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(_ndc, this.camera);
    const away = this.ragdolls.pickMesh;
    const hit = this.ray.intersectObjects([this.art.people.group, away], true).find((h) => h.object instanceof DummyMesh && (h.object !== away || this.walks.isAway(h.instanceId ?? -1)));
    if (hit?.instanceId === undefined) return false;
    this.camera.getWorldDirection(_facing);
    if (hit.object === away) this.walks.knockAgain(hit.instanceId, hit.point, _facing);
    else this.walks.knock(hit.instanceId, hit.point, _facing);
    return true;
  }

  /** One frame before the ragdoll world steps: the figures away get up and walk home. */
  step(wallDt: number): void {
    this.walks.step(wallDt);
  }

  /** Everyone stands on his mark. */
  reset(): void {
    this.walks.reset();
  }

  move(): void {}

  up(): void {}

  dispose(): void {
    this.art.dispose();
  }
}
