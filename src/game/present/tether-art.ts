import * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { MAX_TETHERS } from "../kernel/constants.ts";
import { R_STRENGTH, ROW, type TetherSet } from "../contact/tether.ts";

/** What the reticle says about the aim: nothing to hook, a target in reach, a target out of reach. */
export const AIM = { none: 0, valid: 1, far: 2 } as const;
type AimState = (typeof AIM)[keyof typeof AIM];

/** The reticle's state, the way the sight line runs from the camera (the ring is drawn on it) and the world point it would hook (read only when `state` is not `AIM.none`). */
export interface ReticleView {
  state: AimState;
  readonly dir: THREE.Vector3;
  readonly point: THREE.Vector3;
}

/** Points along a drawn cable: enough for a smooth sag. */
const CABLE_POINTS = 24;
/** The reticle ring's half angle on screen (degrees) and the distance (m) in front of the camera it is drawn at. */
const RING_DEG = 1.1;
const RING_DISTANCE = 2;
/** The marker at the point the hook would take: its ring's half angle (degrees), from the camera. */
const MARKER_DEG = 0.9;
/** The ring on the first object hooked in the free camera, while the second is awaited: a little wider than the aim's marker. */
const HELD_DEG = 1.4;
const RING_SEGMENTS = 24;
/** A slack cable shorter than this share of its length under its span draws straight. */
const SLACK_DRAWN = 0.02;
/** The most a slack cable sags, as a share of its length. */
const MAX_SAG = 0.5;
const COLOR = {
  [AIM.none]: new THREE.Color(0xffffff),
  [AIM.valid]: new THREE.Color(0x55ff99),
  [AIM.far]: new THREE.Color(0xff5544),
};
const CABLE_SLACK = new THREE.Color(0xffd36b);
const CABLE_STRAINED = new THREE.Color(0xff4422);

const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _look = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _turn = new THREE.Quaternion();

function ringGeometry(): THREE.BufferGeometry {
  const points = Array.from({ length: RING_SEGMENTS }, (_, i) => new THREE.Vector3(Math.cos((i / RING_SEGMENTS) * Math.PI * 2), Math.sin((i / RING_SEGMENTS) * Math.PI * 2), 0));
  return new THREE.BufferGeometry().setFromPoints(points);
}

function overlayMaterial(): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
}

/**
 * What the tether looks like: a thin line per cable between its anchors (straight while it is taut, a parabola's sag while it is slack, redder as its tension nears
 * its strength) and the aim's reticle (a ring at the screen's middle, a small ring where the hook would land). Cosmetic: it reads the sim and never writes it.
 */
export class TetherArt {
  readonly group = new THREE.Group();
  private readonly cables: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>[];
  private readonly reticle: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly marker: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly holdMarker: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly ring = ringGeometry();

  constructor() {
    this.cables = Array.from({ length: MAX_TETHERS }, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * CABLE_POINTS), 3));
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: CABLE_SLACK, toneMapped: false }));
      line.frustumCulled = false;
      line.visible = false;
      return line;
    });
    this.reticle = new THREE.LineLoop(this.ring, overlayMaterial());
    this.marker = new THREE.LineLoop(this.ring, overlayMaterial());
    this.holdMarker = new THREE.LineLoop(this.ring, overlayMaterial());
    this.holdMarker.material.color.copy(CABLE_SLACK);
    for (const overlay of [this.reticle, this.marker, this.holdMarker]) {
      overlay.frustumCulled = false;
      overlay.renderOrder = 999;
      overlay.visible = false;
    }
    this.group.add(...this.cables, this.reticle, this.marker, this.holdMarker);
  }

  /** Draws the cables of `set` between its anchors as the cars stand now (the frame's drawn poses), the reticle when `view` is given, and a ring on `held`, the first object hooked while the second is awaited. */
  update(set: TetherSet, cars: readonly DeformableCar[], camera: THREE.Camera, view: ReticleView | null, held: THREE.Vector3 | null): void {
    for (let slot = 0; slot < MAX_TETHERS; slot++) this.drawCable(set, slot, cars);
    this.drawReticle(camera, view);
    this.holdMarker.visible = held !== null;
    if (held === null) return;
    camera.getWorldPosition(_eye);
    camera.getWorldQuaternion(_turn);
    this.holdMarker.position.copy(held);
    this.holdMarker.quaternion.copy(_turn);
    this.holdMarker.scale.setScalar(_eye.distanceTo(held) * Math.tan(THREE.MathUtils.degToRad(HELD_DEG)));
  }

  private drawCable(set: TetherSet, slot: number, cars: readonly DeformableCar[]): void {
    const line = this.cables[slot]!;
    line.visible = set.isAlive(slot) && set.anchor(slot, 0, cars, _from) && set.anchor(slot, 1, cars, _to);
    if (!line.visible) return;
    const span = _from.distanceTo(_to);
    const length = set.length(slot);
    const slack = length - span;
    const sag = slack > SLACK_DRAWN * length ? Math.min(Math.sqrt((3 * span * slack) / 8), MAX_SAG * length) : 0;
    const position = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < CABLE_POINTS; i++) {
      const u = i / (CABLE_POINTS - 1);
      const dip = sag * 4 * u * (1 - u);
      position.setXYZ(i, _from.x + (_to.x - _from.x) * u, _from.y + (_to.y - _from.y) * u - dip, _from.z + (_to.z - _from.z) * u);
    }
    position.needsUpdate = true;
    line.material.color.copy(CABLE_SLACK).lerp(CABLE_STRAINED, Math.min(1, set.tension(slot) / set.rows[slot * ROW + R_STRENGTH]!));
  }

  private drawReticle(camera: THREE.Camera, view: ReticleView | null): void {
    this.reticle.visible = view !== null;
    this.marker.visible = view !== null && view.state !== AIM.none;
    if (view === null) return;
    _look.copy(view.dir);
    camera.getWorldPosition(_eye);
    camera.getWorldQuaternion(_turn);
    this.reticle.position.copy(_eye).addScaledVector(_look, RING_DISTANCE);
    this.reticle.quaternion.copy(_turn);
    this.reticle.scale.setScalar(RING_DISTANCE * Math.tan(THREE.MathUtils.degToRad(RING_DEG)));
    this.reticle.material.color.copy(COLOR[view.state]);
    if (!this.marker.visible) return;
    this.marker.position.copy(view.point);
    this.marker.quaternion.copy(_turn);
    this.marker.scale.setScalar(_eye.distanceTo(view.point) * Math.tan(THREE.MathUtils.degToRad(MARKER_DEG)));
    this.marker.material.color.copy(COLOR[view.state]);
  }

  dispose(): void {
    this.ring.dispose();
    for (const line of this.cables) {
      line.geometry.dispose();
      line.material.dispose();
    }
    this.reticle.material.dispose();
    this.holdMarker.material.dispose();
    this.marker.material.dispose();
  }
}
