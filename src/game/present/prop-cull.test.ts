import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PREFAB, TRACK_ID } from "../world/constants.ts";
import { placeCourse, type Placed } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { openWorldCourse } from "../world/openworld/openworld-course.ts";
import { layOutLots } from "../world/openworld/openworld-lots.ts";
import { blankPoint, Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { plainMaterials } from "./prefab-materials.test-util.ts";
import { PropTumble } from "./prop-tumble.ts";
import { roofLiftAt } from "./facades.ts";
import { ASSET_FIT } from "./scenery-assets-art.ts";
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
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, stage, course.drawn);
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
    expect(inView > 0 && inShadow > 0, `the start's view draws ${inView} and its shadow box ${inShadow} of them`).toBeTruthy();
    expect(inView, `the view draws ${inView} of ${all} triangles (${((inView / all) * 100).toFixed(1)} %)`).toBeLessThanOrEqual(all * MAIN_SHARE);
    expect(inShadow, `the shadow box draws ${inShadow} of ${all} triangles (${((inShadow / all) * 100).toFixed(1)} %)`).toBeLessThanOrEqual(all * SHADOW_SHARE);
    art.dispose();
  });
});

describe("given a knockable cone standing behind the camera, its draw cell out of view", () => {
  const plain = new THREE.MeshBasicMaterial();
  const mats = plainMaterials(plain);
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
    expect(meshes.length, "the cone's one part").toBe(1);
    const mesh = meshes[0]!;
    mesh.updateMatrixWorld();
    expect(shows(mesh), "standing behind the camera, its cell is culled").toBe(false);
    props.place(0, new THREE.Vector3(0, 0.5, 130), new THREE.Quaternion());
    expect(shows(mesh), "knocked in front of the camera, it draws").toBe(true);
    props.reset();
    expect(shows(mesh), "back on its spot after the reset, its cell is culled again").toBe(false);
  });
});

/** The facade shader lifts the vertices at and over this height (block y) with the roof (`FACADE_LIFT`). */
const ROOF_FROM_Y = 13.9;
/** Float noise in a sphere test (m). */
const SPHERE_SLACK = 1e-3;

describe("given a knockable cone in a 64 m draw cell", () => {
  const plain = new THREE.MeshBasicMaterial();
  const cone: Placed = { prefab: PREFAB.cone, x: 0, y: 0, z: 0, yaw: 0, sx: 1, sy: 1, sz: 1 };
  const eye = new THREE.PerspectiveCamera(LENS.fov, LENS.aspect, LENS.near, 900);
  eye.position.set(0, 2, 100);
  eye.lookAt(0, 1, 200);
  eye.updateMatrixWorld();
  const view = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(eye.projectionMatrix, eye.matrixWorldInverse));

  // mutation: sed -i 's/if (was === 1) for/if (was === 3) for/' src/game/present/prop-tumble.ts
  it("when a car knocks it into the view and the course resets, then its cell's bounds are its standing props' again", () => {
    const meshes: THREE.InstancedMesh[] = [];
    const props = new PropTumble([cone], plainMaterials(plain), (mesh) => meshes.push(mesh), undefined, undefined, undefined, { prop: 64, asset: 64 });
    const mesh = meshes[0]!;
    mesh.updateMatrixWorld();
    expect(view.intersectsObject(mesh), "standing behind the camera, its cell is culled").toBe(false);
    props.place(0, new THREE.Vector3(0, 0.5, 130), new THREE.Quaternion());
    expect(view.intersectsObject(mesh), "knocked in front of the camera, it draws").toBe(true);
    props.reset();
    expect(view.intersectsObject(mesh), "back on its spot after the reset, its cell is culled again").toBe(false);
  });
});

describe("given the open world's props drawn in 96 m cells", () => {
  // mutation: sed -i 's/mesh.boundingSphere!.radius += pad;/mesh.boundingSphere!.radius += 0;/' src/game/present/prop-tumble.ts
  it("when every instance's box is lifted by its roof's lift or widened by its sprite's fit, then it lies inside its mesh's bounding sphere", () => {
    stubBrowser();
    const track = new Track(parseTrack(openWorldCourse(layOutLots())));
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
    const matrix = new THREE.Matrix4();
    const corner = new THREE.Vector3();
    let worst = -Infinity;
    for (const set of [art.props, art.scenery]) {
      for (const mesh of set["meshes"].flat()) {
        mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox!;
        const facade = !Array.isArray(mesh.material) && mesh.material.userData.facadeStyle !== undefined;
        const fit = mesh.geometry.getAttribute(ASSET_FIT);
        const sphere = mesh.boundingSphere!;
        for (let at = 0; at < mesh.count; at++) {
          mesh.getMatrixAt(at, matrix);
          const lift = facade ? roofLiftAt(matrix.elements[12]!, matrix.elements[14]!) : 0;
          for (const y of [box.min.y, box.max.y]) {
            for (const x of [box.min.x, box.max.x]) {
              for (const z of [box.min.z, box.max.z]) {
                corner.set(x * (fit ? fit.getX(at) : 1), y + (y >= ROOF_FROM_Y ? lift : 0), z * (fit ? fit.getY(at) : 1)).applyMatrix4(matrix);
                worst = Math.max(worst, corner.distanceTo(sphere.center) - sphere.radius);
              }
            }
          }
        }
      }
    }
    expect(worst, "the worst corner's distance outside its mesh's sphere (m)").toBeLessThanOrEqual(SPHERE_SLACK);
    art.dispose();
  });
});
