import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { paint } from "./test-support.ts";

/** How far (m) a door glass vertex may stand from the door shell's own move: the glass is the shell's child, so only rounding. */
const FOLLOW_M = 0.01;
/** A door open to its stop swings its glass at least this far (m): the control that the doors are open. */
const OPEN_M = 0.1;

function parked(id: CarStyleId): DeformableCar {
  const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
  car.spawnFacing(0, 0, 0, 0);
  car.group.updateMatrixWorld(true);
  return car;
}

/** Every vertex of `mesh` in the world, as the car stands. */
function worldPoints(mesh: THREE.Mesh): THREE.Vector3[] {
  const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
  return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
}

describe("given every style's car parked and posed open for show", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s door glass is read, then each pane is drawn on its open door: every vertex within ${FOLLOW_M * 100} cm of the door shell's move from its shut place`, () => {
      const shut = parked(id);
      const open = parked(id);
      open.showPose("open");
      open.group.updateMatrixWorld(true);
      let swung = 0;
      const doorSides = [{ side: 0, name: "doorL" }, { side: 1, name: "doorR" }] as const;
      for (const { side, name } of doorSides) {
        const paneShut = shut.glassPanes.find((g) => g.name === name)!;
        const pane = open.glassPanes.find((g) => g.name === name)!;
        expect(pane.state === "intact" && pane.mesh.parent !== null, `${id} ${name}: the pane is present (state ${pane.state})`).toBeTruthy();
        for (let o: THREE.Object3D | null = pane.mesh; o; o = o.parent) expect(o.visible, `${id} ${name}: ${o.name || o.type} is hidden`).toBeTruthy();
        const doorMesh = side === 0 ? open["doorMeshL"] : open["doorMeshR"];
        const doorMeshShut = side === 0 ? shut["doorMeshL"] : shut["doorMeshR"];
        const move = doorMesh.matrixWorld.clone().multiply(doorMeshShut.matrixWorld.clone().invert());
        const from = worldPoints(paneShut.mesh);
        const now = worldPoints(pane.mesh);
        expect(now.length, `${id} ${name}: the pane keeps its vertices`).toBe(from.length);
        let worst = 0;
        for (let i = 0; i < now.length; i++) {
          worst = Math.max(worst, now[i]!.distanceTo(from[i]!.clone().applyMatrix4(move)));
          swung = Math.max(swung, now[i]!.distanceTo(from[i]!));
        }
        expect(worst, `${id} ${name}: a glass vertex ${(worst * 100).toFixed(1)} cm off its door's pose`).toBeLessThanOrEqual(FOLLOW_M);
      }
      expect(swung, `the control: the doors are open (the glass swung ${swung.toFixed(2)} m)`).toBeGreaterThan(OPEN_M);
    });
  }
});
