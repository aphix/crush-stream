import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MINIGAME_MODE, START_HILL } from "../scenes/minigame-constants.ts";
import { climbFootX, floorHeightAt, lipHeight, stationBackX, stationFrontX } from "../scenes/minigame-profile.ts";
import { makeLongJumpArt } from "./long-jump-art.ts";
import { STATION_SURFACE_STYLES, SURFACE_DRAW_CALL_BUDGET } from "./minigame-surface-art.ts";

const HEIGHT_TOLERANCE = 0.001;
const COLOUR_TOLERANCE = 1e-6;

function artMeshes(art: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  art.traverse((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  return meshes;
}

/** The (x, y) of every vertex of the art. */
function artVertices(art: THREE.Group): { x: number; y: number; z: number }[] {
  return artMeshes(art).flatMap((mesh) => {
    const positions = mesh.geometry.getAttribute("position");
    return Array.from({ length: positions.count }, (_, index) => ({ x: positions.getX(index), y: positions.getY(index), z: positions.getZ(index) }));
  });
}

/** Whether the surface, at (x, z) on the lane, is painted `hex`: the colour of the first vertex of a triangle that covers the point. */
function isPaintedAt(art: THREE.Group, x: number, z: number, hex: number): boolean {
  const expected = new THREE.Color().setHex(hex);
  for (const mesh of artMeshes(art)) {
    const positions = mesh.geometry.getAttribute("position");
    const colours = mesh.geometry.getAttribute("color");
    for (let first = 0; first < positions.count; first += 3) {
      const corners = [0, 1, 2].map((corner) => ({ x: positions.getX(first + corner), z: positions.getZ(first + corner) }));
      const covers =
        x > Math.min(...corners.map((corner) => corner.x)) && x < Math.max(...corners.map((corner) => corner.x)) && z > Math.min(...corners.map((corner) => corner.z)) && z < Math.max(...corners.map((corner) => corner.z));
      if (!covers) continue;
      return Math.abs(colours.getX(first) - expected.r) < COLOUR_TOLERANCE && Math.abs(colours.getY(first) - expected.g) < COLOUR_TOLERANCE && Math.abs(colours.getZ(first) - expected.b) < COLOUR_TOLERANCE;
    }
  }
  return expect.fail(`no triangle covers (${x}, ${z})`);
}

describe("given the long jump station's art in station-local coordinates", () => {
  const art = makeLongJumpArt();
  const vertices = artVertices(art);

  it("when it is built, then it draws within the surface budget", () => {
    expect(artMeshes(art).length, "something to draw").toBeGreaterThanOrEqual(1);
    expect(artMeshes(art).length, `${artMeshes(art).length} meshes, budget ${SURFACE_DRAW_CALL_BUDGET}`).toBeLessThanOrEqual(SURFACE_DRAW_CALL_BUDGET);
  });

  it("when its extent is read, then it ends at the barrier's line and nothing is drawn past it, where the range's sand and signs already stand", () => {
    expect(Math.abs(Math.max(...vertices.map((vertex) => vertex.x)) - stationFrontX(MINIGAME_MODE.longJump)), "front x").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    expect(stationFrontX(MINIGAME_MODE.longJump), "the long jump's lip is the origin").toBe(0);
    expect(Math.abs(Math.min(...vertices.map((vertex) => vertex.x)) - stationBackX(MINIGAME_MODE.longJump)), "back x").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
  });

  it("when the run is read from the pad to the lip, then it falls to the run-up below the pad and climbs back to the pad's level at the lip", () => {
    const runUpFloor = floorHeightAt(MINIGAME_MODE.longJump, climbFootX(MINIGAME_MODE.longJump), 0);
    expect(runUpFloor, "the run-up lies below the pad").toBeLessThan(0);
    expect(Math.abs(Math.min(...vertices.map((vertex) => vertex.y)) - runUpFloor), "lowest vertex is the run-up's floor").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    const lipVertices = vertices.filter((vertex) => Math.abs(vertex.x) <= HEIGHT_TOLERANCE);
    expect(lipVertices.length, "vertices stand on the lip").toBeGreaterThan(0);
    for (const vertex of lipVertices) expect(Math.abs(vertex.y - lipHeight(MINIGAME_MODE.longJump)), `lip vertex height ${vertex.y}`).toBeLessThanOrEqual(HEIGHT_TOLERANCE);
    expect(Math.abs(Math.max(...vertices.map((vertex) => vertex.y)) - lipHeight(MINIGAME_MODE.longJump)), "nothing rises above the pad's level").toBeLessThanOrEqual(HEIGHT_TOLERANCE);
  });

  it("when the start pad is read, then its bars alternate yellow and asphalt from the back end", () => {
    const style = STATION_SURFACE_STYLES.longJump;
    const sideOfCentreLine = style.laneHalfWidth / 2;
    const backX = stationBackX(MINIGAME_MODE.longJump);
    expect(isPaintedAt(art, backX + 0.5, sideOfCentreLine, style.startPadBarColour!), "first bar").toBeTruthy();
    expect(isPaintedAt(art, backX + 1.5, sideOfCentreLine, style.baseColour), "bare floor after the first bar").toBeTruthy();
    expect(isPaintedAt(art, backX + 2.5, sideOfCentreLine, style.startPadBarColour!), "second bar").toBeTruthy();
    expect(isPaintedAt(art, backX + START_HILL.padLength + 0.5, sideOfCentreLine, style.baseColour), "no bar past the pad").toBeTruthy();
  });
});
