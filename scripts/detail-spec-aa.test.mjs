import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { CarStage, openGame, ViewPort } from "./trace-core.mjs";
import { applyCarFinish } from "../src/game/vehicle/car-finish.ts";

/** The shot's scale: about 4 mm a pixel at 1 m, the iso door shot's, so the hatch's 20 mm rocker step spans five pixels. */
const SIZE = 128;
const FOV_DEG = 30;
const DISTANCE_M = 1;
/** Seen from a little below and behind, so the studio's softboxes reflect along the rocker, and rolled 45°, so the lines cross the pixel quads diagonally, as in the owner's shot. */
const EYE_OFFSET_M = { up: -0.3, along: 0.2 };
const ROLL_RAD = Math.PI / 4;
/** Measured 1.02 with the detail's spec-AA per pixel and 1.16 with it per quad (main), on the WSL box's d3d12 GPU. */
const MAX_SEAM_RATIO = 1.08;
/** The hatch's rocker step (car frame y, m), behind the front door's cut, where the owner saw the ladder. */
const STEP = { y: 0.235, z: -0.37 };
/** A mid grey: white clips in the studio light and hides the clear coat's highlights. */
const PAINT = 0x8b8a8d;

/**
 * Pixel-to-pixel change of the frame's green channel across 2x2 quad boundaries over the change inside quads, horizontally and
 * vertically, on drawn pixels only: about 1 on a smooth picture, high where a value taken once per quad (`dFdx`) shows as blocks.
 * Quads pair GL rows 2k and 2k+1; the port's rows are flipped from an even height, so its rows pair the same way.
 */
function quadSeamRatio(rgba) {
  const sums = { across: 0, inside: 0 };
  const pair = (a, b, seam) => {
    if (rgba[4 * a + 3] === 0 || rgba[4 * b + 3] === 0) return;
    sums[seam ? "across" : "inside"] += Math.abs(rgba[4 * a + 1] - rgba[4 * b + 1]);
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const at = y * SIZE + x;
      if (x + 1 < SIZE) pair(at, at + 1, x % 2 === 1);
      if (y + 1 < SIZE) pair(at, at + SIZE, y % 2 === 1);
    }
  }
  return sums.across / sums.inside;
}

describe("given a hatchback in the studio light with its finish and detail map on", () => {
  it("when its rocker step is drawn on headless GL at the door shot's scale, rolled across the pixel quads, then the clear coat shows no 2x2 checker: the change across quad seams stays within 8% of the change inside quads", async () => {
    const game = await openGame();
    const port = new ViewPort(game, SIZE, SIZE);
    const stage = new CarStage(game, PAINT);
    stage.build("hatchback", game.STYLE_CLASS.hatchback);
    applyCarFinish(stage.car.group, true);
    const hdr = new HDRLoader().parse(readFileSync(new URL("../public/env-studio.hdr", import.meta.url)).buffer);
    const equirect = new THREE.DataTexture(hdr.data, hdr.width, hdr.height, THREE.RGBAFormat, THREE.HalfFloatType);
    Object.assign(equirect, { colorSpace: THREE.LinearSRGBColorSpace, flipY: true, mapping: THREE.EquirectangularReflectionMapping, needsUpdate: true });
    stage.scene.environment = new THREE.PMREMGenerator(port.renderer).fromEquirectangular(equirect).texture;
    const group = stage.car.group;
    group.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(group.localToWorld(new THREE.Vector3(-3, STEP.y, STEP.z)), new THREE.Vector3(1, 0, 0).transformDirection(group.matrixWorld));
    const hit = ray.intersectObject(group, true)[0];
    expect(hit?.object, "the ray from the right meets the body's paint at the step").toBe(stage.car.body);
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 10);
    camera.position.copy(hit.point).addScaledVector(normal, DISTANCE_M).add(new THREE.Vector3(0, EYE_OFFSET_M.up, EYE_OFFSET_M.along));
    camera.lookAt(hit.point);
    camera.rotateZ(ROLL_RAD);
    expect(quadSeamRatio(port.draw(stage.scene, camera)), "change across quad seams over change inside quads").toBeLessThan(MAX_SEAM_RATIO);
  });
});
