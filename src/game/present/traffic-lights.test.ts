import { beforeAll, describe, expect, it } from "vitest";
import * as THREE from "three";
import { HEADING_DX, HEADING_DZ, buildRoadNetwork } from "../world/openworld/openworld-roads.ts";
import { openWorldGeometry } from "../world/openworld/openworld-layout.ts";
import { LAYOUT } from "../world/openworld/openworld-constants.ts";
import { REG_SIGN, SPEED_LIMIT_MPH, TrafficLightArt, paintRegulatorySigns } from "./traffic-lights.ts";

/** A walker's head clears a plate whose bottom is at least this high (m). */
const WALKER_CLEAR = 2;
const NORMAL_TOL = 1e-6;

const painted: string[] = [];
const context: object = new Proxy(
  {},
  {
    get: (_target, key) => (key === "fillText" ? (text: string) => void painted.push(text) : () => context),
    set: () => true,
  },
);

beforeAll(() => {
  Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) } });
});

/** Where instance `index` stands and the way its plate's printed face points. */
function plateOf(mesh: THREE.InstancedMesh, index: number): { position: THREE.Vector3; normal: THREE.Vector3 } {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  const position = new THREE.Vector3().setFromMatrixPosition(matrix);
  const normal = new THREE.Vector3(0, 0, 1).transformDirection(matrix);
  return { position, normal };
}

describe("given the open world's signal poles", () => {
  const network = buildRoadNetwork(openWorldGeometry(LAYOUT));
  const heads: { heading: number }[] = [];
  for (let junction = 0; junction < network.junctionCount; junction++) {
    for (let heading = 0; heading < 4; heading++) if (network.neighbour[junction * 4 + ((heading + 2) % 4)]! >= 0) heads.push({ heading });
  }

  it("when they are drawn, then every head has a SPEED LIMIT and a NO TURN ON RED plate facing the traffic it faces, both over a walker's head", () => {
    // mutation: sed -i 's/const plateTurn = Math.atan2(faceX, faceZ);/const plateTurn = Math.atan2(-faceX, -faceZ);/' src/game/present/traffic-lights.ts
    const art = new TrafficLightArt(network);
    expect(art.speedSigns.count).toBe(art.heads);
    expect(art.noTurnSigns.count).toBe(art.heads);
    expect(art.heads).toBe(heads.length);
    for (let index = 0; index < art.heads; index++) {
      const heading = heads[index]!.heading;
      for (const mesh of [art.speedSigns, art.noTurnSigns]) {
        const { position, normal } = plateOf(mesh, index);
        expect(normal.x, `head ${index} plate faces its traffic`).toBeCloseTo(-HEADING_DX[heading]!, 5);
        expect(normal.z, `head ${index} plate faces its traffic`).toBeCloseTo(-HEADING_DZ[heading]!, 5);
        expect(Math.abs(normal.y)).toBeLessThan(NORMAL_TOL);
        expect(position.y - REG_SIGN.height / 2, `head ${index} plate bottom`).toBeGreaterThanOrEqual(WALKER_CLEAR);
      }
    }
    art.dispose();
  });

  it("when the plates are painted, then one reads SPEED LIMIT 25 and the other NO TURN ON RED", () => {
    // mutation: sed -i 's/export const SPEED_LIMIT_MPH = 25;/export const SPEED_LIMIT_MPH = 35;/' src/game/present/traffic-lights.ts
    painted.length = 0;
    paintRegulatorySigns(context as CanvasRenderingContext2D);
    expect(painted.join(" ")).toBe(`SPEED LIMIT ${SPEED_LIMIT_MPH} NO TURN ON RED`);
    expect(SPEED_LIMIT_MPH).toBe(25);
  });
});
