import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFAB, TRACK_ID } from "../world/constants.ts";
import { placeProps, type Placed } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { blankPoint, Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { PropTumble } from "./prop-tumble.ts";
import { TrackArt } from "./track-art.ts";

/** The meshes the draw cells split: the placed props and the course's structures. */
const CELLED = new Set(["prop", "wall", "deck", "pillar", "tunnel"]);
/** The race's chase eye behind the start line: back along the road, up, and the point ahead it looks at (m). */
const EYE = { back: 6, up: 2.5, ahead: 10, lookUp: 1 };
/** The race camera's lens: vertical degrees and a 16:9 screen. */
const LENS = { fov: 50, aspect: 16 / 9, near: 0.1 };
/** The most of the Mall's prop and structure triangles the start's view may draw (28.4 % with 512 m cells, 18 % with 256 m; main drew 67 %: a part with one placement in view drew the course's every one). */
const MAIN_SHARE = 0.35;
/** The most the sun's 48 m shadow box at the start may draw (10.0 % with 512 m cells, 6.4 % with 256 m; main drew 65 %). */
const SHADOW_SHARE = 0.15;

const triangles = (mesh: THREE.Mesh): number => {
  const g = mesh.geometry;
  return ((g.index ? g.index.count : g.getAttribute("position").count) / 3) * (mesh instanceof THREE.InstancedMesh ? mesh.count : 1);
};

/** Triangles of `meshes` three draws through `frustum`: it skips an object only when it is frustum-culled and its bounds miss. */
function drawn(meshes: readonly THREE.Mesh[], frustum: THREE.Frustum): number {
  let sum = 0;
  for (const mesh of meshes) if (!mesh.frustumCulled || frustum.intersectsObject(mesh)) sum += triangles(mesh);
  return sum;
}

describe("given the National Mall's art and the race's chase eye and sun on the start line", () => {
  it("when the view and the sun's shadow box are culled as three culls them, then the props and structures drawn are a small share of the course's", () => {
    stubBrowser();
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.nationalMall)!);
    const stage = new WorldStage(new THREE.Scene());
    const art = new TrackArt(track, placeProps(track), stage);
    art.group.updateMatrixWorld(true);
    const meshes: THREE.Mesh[] = [];
    art.group.traverse((o) => {
      if (o instanceof THREE.Mesh && CELLED.has(o.userData.race?.kind)) meshes.push(o);
    });
    const casters = meshes.filter((mesh) => mesh.castShadow);

    const pt = track.pointAt(0, blankPoint());
    const y = track.ground().heightAt(pt.x, pt.z, pt.y);
    const eye = new THREE.PerspectiveCamera(LENS.fov, LENS.aspect, LENS.near, track.json.environment.far);
    eye.position.set(pt.x - pt.tx * EYE.back, y + EYE.up, pt.z - pt.tz * EYE.back);
    eye.lookAt(pt.x + pt.tx * EYE.ahead, y + EYE.lookUp, pt.z + pt.tz * EYE.ahead);
    eye.updateMatrixWorld();
    const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
    const sun = stage.sun;
    sun.target.position.set(pt.x, 0, pt.z);
    sun.position.copy(sun.target.position).add(stage.sunOffset);
    sun.updateMatrixWorld();
    sun.target.updateMatrixWorld();
    sun.shadow.updateMatrices(sun);

    let all = 0;
    for (const mesh of meshes) all += triangles(mesh);
    const inView = drawn(meshes, view);
    const inShadow = drawn(casters, sun.shadow.getFrustum());
    assert.ok(inView > 0 && inShadow > 0, `the start's view draws ${inView} and its shadow box ${inShadow} of them`);
    assert.ok(inView <= all * MAIN_SHARE, `the view draws ${inView} of ${all} triangles (${((inView / all) * 100).toFixed(1)} %)`);
    assert.ok(inShadow <= all * SHADOW_SHARE, `the shadow box draws ${inShadow} of ${all} triangles (${((inShadow / all) * 100).toFixed(1)} %)`);
    art.dispose();
  });
});

describe("given a knockable cone standing behind the camera, its draw cell out of view", () => {
  const plain = new THREE.MeshBasicMaterial();
  const mats = { plain, concrete: plain, building: plain, billboard: plain, water: plain };
  const cone: Placed = { prefab: PREFAB.cone, x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1 };
  const eye = new THREE.PerspectiveCamera(LENS.fov, LENS.aspect, LENS.near, 900);
  eye.position.set(0, 2, 100);
  eye.lookAt(0, 1, 200);
  eye.updateMatrixWorld();
  const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));
  const shows = (mesh: THREE.InstancedMesh): boolean => !mesh.frustumCulled || view.intersectsObject(mesh);

  it("when a car knocks it 30 m out of its cell into the view, then it draws, and once the course resets, its cell is out of view again", () => {
    const meshes: THREE.InstancedMesh[] = [];
    const props = new PropTumble([cone], mats, (mesh) => meshes.push(mesh));
    assert.equal(meshes.length, 1, "the cone's one part");
    const mesh = meshes[0]!;
    mesh.updateMatrixWorld();
    assert.equal(shows(mesh), false, "standing behind the camera, its cell is culled");
    props.place(0, new THREE.Vector3(0, 0.5, 130), new THREE.Quaternion());
    assert.equal(shows(mesh), true, "knocked in front of the camera, it draws");
    props.reset();
    assert.equal(shows(mesh), false, "back on its spot after the reset, its cell is culled again");
  });
});
