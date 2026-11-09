import * as THREE from "three";
import { LIGHT, lightPhase, lightState, phaseOfApproach } from "../ai/openworld-traffic/traffic-lights.ts";
import { HEADING_COUNT, HEADING_DX, HEADING_DZ, HEADING_YAW, rightX, rightZ, type RoadNetwork } from "../world/openworld/openworld-roads.ts";
import { SIGNAL_POLE } from "../world/openworld/openworld-signal-poles.ts";

/** The pole stands `SIGNAL_POLE.fromCurb` (m) from the curb, in the sidewalk's furniture strip (the solid a car meets stands there too), and the head hangs this far (m) over the lane side of it. */
const POLE_FROM_CURB = SIGNAL_POLE.fromCurb;
const HEAD_OVER_LANE = 0.35;
const POLE_WIDTH = SIGNAL_POLE.width;
const POLE_HEIGHT = SIGNAL_POLE.poleHeight;
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

/**
 * The regulatory signs on each signal pole, facing the traffic the head faces (Philadelphia's corners): SPEED LIMIT 25 on the pole under the head, NO TURN ON RED
 * beside the head on the curb side. Both are the 24 x 30 in plate (0.61 x 0.76 m); bottoms over 2 m so a walker passes under them.
 */
export const REG_SIGN = { width: 0.61, height: 0.76, speedY: 2.4, noTurnY: HEAD_HEIGHT, noTurnOut: 0.33, standoff: 0.005 } as const;
/** The two plates' texels: one atlas, two cells side by side. */
const SIGN_CELL = { width: 244, height: 304 } as const;
const SIGN_ATLAS = { width: 512, height: 512 } as const;
const SIGN_INK = "#111111";
const SIGN_PLATE = "#f4f4f2";
/** A plate's back: bare galvanised sheet. */
const SIGN_BACK_COLOUR = 0x8b8f93;
const SIGN_BORDER_PX = 6;
const SIGN_BORDER_INSET = 8;
export const SPEED_LIMIT_MPH = 25;

/** What the plates are painted with: a 2D canvas context's text and rectangle calls. */
type SignPainter = Pick<CanvasRenderingContext2D, "fillStyle" | "strokeStyle" | "lineWidth" | "font" | "textAlign" | "textBaseline" | "fillRect" | "strokeRect" | "fillText">;

function plate(g: SignPainter, x: number): void {
  g.fillStyle = SIGN_PLATE;
  g.fillRect(x, 0, SIGN_CELL.width, SIGN_CELL.height);
  g.strokeStyle = SIGN_INK;
  g.lineWidth = SIGN_BORDER_PX;
  g.strokeRect(x + SIGN_BORDER_INSET, SIGN_BORDER_INSET, SIGN_CELL.width - 2 * SIGN_BORDER_INSET, SIGN_CELL.height - 2 * SIGN_BORDER_INSET);
  g.fillStyle = SIGN_INK;
  g.textAlign = "center";
  g.textBaseline = "middle";
}

/** The atlas: SPEED LIMIT 25 in the left cell, NO TURN ON RED in the right, black on white as on the street. */
export function paintRegulatorySigns(g: SignPainter): void {
  const middle = SIGN_CELL.width / 2;
  plate(g, 0);
  g.font = "bold 44px sans-serif";
  g.fillText("SPEED", middle, 62);
  g.fillText("LIMIT", middle, 112);
  g.font = "bold 130px sans-serif";
  g.fillText(String(SPEED_LIMIT_MPH), middle, 214);
  plate(g, SIGN_CELL.width);
  g.font = "bold 46px sans-serif";
  const lines = "NO TURN ON RED".split(" ");
  for (let line = 0; line < lines.length; line++) g.fillText(lines[line]!, SIGN_CELL.width + middle, 70 + 58 * line);
}

/** A plate quad facing +z, its uvs on atlas cell `cell` (0 speed, 1 no turn). */
function plateGeometry(cell: number): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(REG_SIGN.width, REG_SIGN.height);
  const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
  const u0 = (cell * SIGN_CELL.width) / SIGN_ATLAS.width;
  const u1 = ((cell + 1) * SIGN_CELL.width) / SIGN_ATLAS.width;
  const v0 = 1 - SIGN_CELL.height / SIGN_ATLAS.height;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) === 0 ? u0 : u1, uv.getY(i) === 0 ? v0 : 1);
  return geometry;
}

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
  /** SPEED LIMIT plates (one per head) and NO TURN ON RED plates (one per head), on one atlas. */
  readonly speedSigns: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  readonly noTurnSigns: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  /** The plates' plain backs: a grey quad facing the other way under each plate's matrix, so text never reads mirrored from behind. */
  readonly signBacks: THREE.InstancedMesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly signTexture: THREE.CanvasTexture;
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
    const canvas = document.createElement("canvas");
    canvas.width = SIGN_ATLAS.width;
    canvas.height = SIGN_ATLAS.height;
    paintRegulatorySigns(canvas.getContext("2d")!);
    this.signTexture = new THREE.CanvasTexture(canvas);
    this.signTexture.colorSpace = THREE.SRGBColorSpace;
    const signMaterial = new THREE.MeshStandardMaterial({ map: this.signTexture, roughness: 0.55 });
    this.speedSigns = new THREE.InstancedMesh(plateGeometry(0), signMaterial, this.heads);
    this.noTurnSigns = new THREE.InstancedMesh(plateGeometry(1), signMaterial, this.heads);
    const back = new THREE.PlaneGeometry(REG_SIGN.width, REG_SIGN.height).rotateY(Math.PI);
    this.signBacks = new THREE.InstancedMesh(back, new THREE.MeshStandardMaterial({ color: SIGN_BACK_COLOUR, roughness: 0.8 }), this.heads * 2);
    this.place(network);
    this.group.add(this.poles, this.headMesh, this.lamps, this.speedSigns, this.noTurnSigns, this.signBacks);
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
    this.speedSigns.geometry.dispose();
    this.noTurnSigns.geometry.dispose();
    this.speedSigns.material.dispose();
    this.signTexture.dispose();
    this.speedSigns.dispose();
    this.noTurnSigns.dispose();
    this.signBacks.geometry.dispose();
    this.signBacks.material.dispose();
    this.signBacks.dispose();
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
      // The plates face the traffic the head faces: a plane's front is +z, turned to (faceX, faceZ).
      const plateTurn = Math.atan2(faceX, faceZ);
      turn.setFromAxisAngle(up, plateTurn);
      const onFace = POLE_WIDTH / 2 + REG_SIGN.standoff;
      this.speedSigns.setMatrixAt(index, matrix.compose(position.set(poleX + faceX * onFace, REG_SIGN.speedY, poleZ + faceZ * onFace), turn, unit));
      this.signBacks.setMatrixAt(index * 2, matrix);
      const curbX = poleX + rightX(heading) * REG_SIGN.noTurnOut;
      const curbZ = poleZ + rightZ(heading) * REG_SIGN.noTurnOut;
      this.noTurnSigns.setMatrixAt(index, matrix.compose(position.set(curbX + faceX * onFace, REG_SIGN.noTurnY, curbZ + faceZ * onFace), turn, unit));
      this.signBacks.setMatrixAt(index * 2 + 1, matrix);
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
