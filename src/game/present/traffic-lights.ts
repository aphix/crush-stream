import * as THREE from "three";
import { LIGHT, lightPhase, lightState, phaseOfApproach } from "../ai/openworld-traffic/traffic-lights.ts";
import { HEADING_COUNT, HEADING_DX, HEADING_DZ, HEADING_YAW, rightX, rightZ, type RoadNetwork } from "../world/openworld/openworld-roads.ts";

/** The pole stands this far (m) from the curb, in the sidewalk's furniture strip, and the head hangs this far (m) over the lane side of it. */
const POLE_FROM_CURB = 0.6;
const HEAD_OVER_LANE = 0.35;
const POLE_WIDTH = 0.18;
const POLE_HEIGHT = 4.4;
const HEAD_SIZE = { width: 0.42, height: 1.4, depth: 0.36 } as const;
const HEAD_HEIGHT = 3.5;
const LAMP_SIZE = 0.26;
const LAMP_DEPTH = 0.04;
/** Heights (m) of the four lamps from the head's middle: red, yellow, green, left arrow. */
const LAMP_Y = [0.48, 0.16, -0.16, -0.48] as const;
const LAMPS_PER_HEAD = LAMP_Y.length;
const LAMP_RED = 0;
const LAMP_YELLOW = 1;
const LAMP_GREEN = 2;
const LAMP_ARROW = 3;
const LIT = { red: 0xff2b1c, yellow: 0xffc01f, green: 0x25e060 } as const;
const OFF = 0x161a18;
const POLE_COLOUR = 0x3b3f42;
const HEAD_COLOUR = 0x111315;
/** No change of phase seen yet. */
const NO_PHASE = -1;

/** One signal head: the junction it serves and the approach it faces. */
type Head = { junction: number; heading: number };

/**
 * The open world's traffic lights drawn: a pole and a head with red, yellow, green and left-arrow lamps for every approach of every junction, three instanced meshes in all. The lamps show what
 * `lightState` says at the crowd time `update` is given (the same on every peer), and are rewritten only when a junction changes phase.
 */
export class TrafficLightArt {
  readonly group = new THREE.Group();
  /** Heads drawn. */
  readonly heads: number;
  private readonly lamps: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly poles: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private readonly headMesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  private readonly headList: Head[] = [];
  private readonly shown: Int16Array;
  private readonly colour = new THREE.Color();

  constructor(network: RoadNetwork) {
    for (let junction = 0; junction < network.junctionCount; junction++) {
      for (let heading = 0; heading < HEADING_COUNT; heading++) {
        if (network.neighbour[junction * HEADING_COUNT + ((heading + 2) % HEADING_COUNT)]! >= 0) this.headList.push({ junction, heading });
      }
    }
    this.heads = this.headList.length;
    this.shown = new Int16Array(network.junctionCount).fill(NO_PHASE);
    this.poles = new THREE.InstancedMesh(new THREE.BoxGeometry(POLE_WIDTH, POLE_HEIGHT, POLE_WIDTH), new THREE.MeshStandardMaterial({ color: POLE_COLOUR, roughness: 0.7 }), this.heads);
    this.headMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(HEAD_SIZE.width, HEAD_SIZE.height, HEAD_SIZE.depth), new THREE.MeshStandardMaterial({ color: HEAD_COLOUR, roughness: 0.6 }), this.heads);
    this.lamps = new THREE.InstancedMesh(new THREE.BoxGeometry(LAMP_SIZE, LAMP_SIZE, LAMP_DEPTH), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.heads * LAMPS_PER_HEAD);
    this.place(network);
    this.group.add(this.poles, this.headMesh, this.lamps);
  }

  /** Lamps for crowd time `seconds`. */
  update(seconds: number): void {
    let changed = false;
    for (let junction = 0; junction < this.shown.length; junction++) {
      const packed = lightPhase(junction, seconds);
      if (packed === this.shown[junction]) continue;
      this.shown[junction] = packed;
      this.paint(junction, seconds);
      changed = true;
    }
    if (changed && this.lamps.instanceColor !== null) this.lamps.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    for (const mesh of [this.poles, this.headMesh, this.lamps]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
  }

  private place(network: RoadNetwork): void {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const turn = new THREE.Quaternion();
    const unit = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (let index = 0; index < this.heads; index++) {
      const { junction, heading } = this.headList[index]!;
      const baseX = network.junctionX[junction]! - HEADING_DX[heading]! * network.stopBar;
      const baseZ = network.junctionZ[junction]! - HEADING_DZ[heading]! * network.stopBar;
      const out = network.boxHalf + POLE_FROM_CURB;
      const poleX = baseX + rightX(heading) * out;
      const poleZ = baseZ + rightZ(heading) * out;
      turn.setFromAxisAngle(up, HEADING_YAW[heading]! + Math.PI);
      this.poles.setMatrixAt(index, matrix.compose(position.set(poleX, POLE_HEIGHT / 2, poleZ), turn, unit));
      const headX = poleX - rightX(heading) * HEAD_OVER_LANE;
      const headZ = poleZ - rightZ(heading) * HEAD_OVER_LANE;
      this.headMesh.setMatrixAt(index, matrix.compose(position.set(headX, HEAD_HEIGHT, headZ), turn, unit));
      const faceX = -HEADING_DX[heading]!;
      const faceZ = -HEADING_DZ[heading]!;
      const lampReach = HEAD_SIZE.depth / 2 + LAMP_DEPTH / 2;
      for (let lamp = 0; lamp < LAMPS_PER_HEAD; lamp++) {
        this.lamps.setMatrixAt(index * LAMPS_PER_HEAD + lamp, matrix.compose(position.set(headX + faceX * lampReach, HEAD_HEIGHT + LAMP_Y[lamp]!, headZ + faceZ * lampReach), turn, unit));
      }
    }
  }

  /** Rewrites the lamps of every head of `junction` to what its signals show at `seconds`. */
  private paint(junction: number, seconds: number): void {
    for (let index = 0; index < this.heads; index++) {
      const head = this.headList[index]!;
      if (head.junction !== junction) continue;
      const through = phaseOfApproach(head.heading, false);
      const state = lightState(junction, through, seconds);
      const arrow = lightState(junction, through + 1, seconds);
      this.setLamp(index, LAMP_RED, state === LIGHT.red ? LIT.red : OFF);
      this.setLamp(index, LAMP_YELLOW, state === LIGHT.yellow ? LIT.yellow : OFF);
      this.setLamp(index, LAMP_GREEN, state === LIGHT.green ? LIT.green : OFF);
      this.setLamp(index, LAMP_ARROW, arrow === LIGHT.green ? LIT.green : arrow === LIGHT.yellow ? LIT.yellow : OFF);
    }
  }

  private setLamp(head: number, lamp: number, hex: number): void {
    this.lamps.setColorAt(head * LAMPS_PER_HEAD + lamp, this.colour.setHex(hex));
  }
}
