import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { TRACK_ID } from "../world/constants.ts";
import { mulberry32, placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { TrackArt } from "./track-art.ts";
import { PROXY_MIN_INSTANCES, ShadowProxy } from "./shadow-proxy.ts";

const INSTANCES = 600;
const CITY = 400;
const BOX_EDGE = 30;
const HALF = 30;

/** A city of big boxes (turned and scaled at random) as one coloured instanced mesh, at the scene's root. */
function cityMesh(): THREE.InstancedMesh {
  const random = mulberry32(3);
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(BOX_EDGE, BOX_EDGE, BOX_EDGE), new THREE.MeshStandardMaterial(), INSTANCES);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(INSTANCES * 3), 3);
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < INSTANCES; i++) {
    const scale = 0.5 + random();
    matrix.compose(new THREE.Vector3((random() - 0.5) * CITY, random() * 10, (random() - 0.5) * CITY), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, random() * 6, 0)), new THREE.Vector3(scale, scale, scale));
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, new THREE.Color(i / INSTANCES, 0, 0));
  }
  mesh.castShadow = true;
  return mesh;
}

/** The sun's frustum: a 60 m box about (x, z), looking down the light from the south-east and up. */
function sunFrustum(x: number, z: number): THREE.Frustum {
  const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 2, 400);
  camera.position.set(x + 120, 160, z + 80);
  camera.lookAt(x, 0, z);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

function eyeFrustum(): THREE.Frustum {
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500);
  camera.position.set(0, 20, 300);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
}

/** The instances (by their matrix's x then z) whose own bounding sphere touches `frustum`, as three's frustum test reads one. */
function touching(mesh: THREE.InstancedMesh, frustum: THREE.Frustum): Set<string> {
  const sphere = new THREE.Sphere();
  const matrix = new THREE.Matrix4();
  const keys = new Set<string>();
  mesh.geometry.computeBoundingSphere();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, matrix);
    sphere.copy(mesh.geometry.boundingSphere!).applyMatrix4(matrix);
    if (frustum.intersectsSphere(sphere)) keys.add(`${matrix.elements[12]},${matrix.elements[14]}`);
  }
  return keys;
}

/** The instances a proxy holds, by the same key. */
function held(proxy: ShadowProxy): Set<string> {
  const keys = new Set<string>();
  const m = proxy.mesh.instanceMatrix.array;
  for (let i = 0; i < proxy.mesh.count; i++) keys.add(`${m[i * 16 + 12]},${m[i * 16 + 14]}`);
  return keys;
}

describe("given a city's worth of big boxes in one shadow-casting instanced mesh", () => {
  it("when the sun's box is asked about, then the proxy holds every instance that touches it, and well under all of them", () => {
    const source = cityMesh();
    const proxy = new ShadowProxy(source);
    const sun = sunFrustum(20, -30);
    expect(proxy.mesh.intersectsFrustum(sun), "the proxy draws").toBe(true);
    const needed = touching(source, sun);
    const kept = held(proxy);
    expect(needed.size, "control: the box touches some of them").toBeGreaterThan(5);
    for (const key of needed) expect(kept.has(key), `instance at ${key}`).toBe(true);
    expect(proxy.mesh.count, "instances the shadow pass draws").toBeLessThan(INSTANCES / 2);
  });

  it("when the eye's frustum is asked about, then the source is drawn and the proxy is not; for the sun's it is the other way round", () => {
    const source = cityMesh();
    const proxy = new ShadowProxy(source);
    source.computeBoundingSphere();
    expect(source.intersectsFrustum(eyeFrustum()), "the eye sees the city").toBe(true);
    expect(proxy.mesh.intersectsFrustum(eyeFrustum()), "the eye never draws the proxy").toBe(false);
    expect(source.intersectsFrustum(sunFrustum(0, 0)), "the sun never draws the source").toBe(false);
  });

  it("when the box moves 3 m, then nothing is rebuilt; when it moves 40 m, then the proxy holds what touches the new box", () => {
    const source = cityMesh();
    const proxy = new ShadowProxy(source);
    proxy.mesh.intersectsFrustum(sunFrustum(0, 0));
    const version = proxy.mesh.instanceMatrix.version;
    expect(proxy.mesh.intersectsFrustum(sunFrustum(3, 0)), "still draws").toBe(true);
    expect(proxy.mesh.instanceMatrix.version, "a small move is not rebuilt").toBe(version);
    const far = sunFrustum(40, 0);
    proxy.mesh.intersectsFrustum(far);
    expect(proxy.mesh.instanceMatrix.version, "a large move is").toBeGreaterThan(version);
    const kept = held(proxy);
    for (const key of touching(source, far)) expect(kept.has(key), `instance at ${key}`).toBe(true);
  });

  it("when an instance is moved into the box, then the next shadow pass draws it with its colour", () => {
    const source = cityMesh();
    const proxy = new ShadowProxy(source);
    const sun = sunFrustum(0, 0);
    proxy.mesh.intersectsFrustum(sun);
    const before = proxy.mesh.count;
    const matrix = new THREE.Matrix4().makeTranslation(-1, 0, -1);
    const outside = Array.from({ length: INSTANCES }, (_, i) => i).find((i) => !held(proxy).has(`${source.instanceMatrix.array[i * 16 + 12]},${source.instanceMatrix.array[i * 16 + 14]}`))!;
    source.setMatrixAt(outside, matrix);
    source.setColorAt(outside, new THREE.Color(0, 1, 0));
    source.instanceMatrix.needsUpdate = true;
    proxy.mesh.intersectsFrustum(sun);
    expect(proxy.mesh.count, "one more").toBe(before + 1);
    expect(held(proxy).has("-1,-1"), "the moved instance").toBe(true);
    const at = Array.from({ length: proxy.mesh.count }, (_, i) => i).find((i) => proxy.mesh.instanceMatrix.array[i * 16 + 12] === -1)!;
    expect(proxy.mesh.instanceColor!.array[at * 3 + 1], "its colour").toBe(1);
  });
});

describe("given the sun turning at a fixed box centre, and instances added", () => {
  /** The sun's frustum about the origin, its light turned `turn` rad about the vertical. */
  function turnedSun(turn: number): THREE.Frustum {
    const camera = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, 2, 400);
    camera.position.set(120 * Math.cos(turn), 160, 80 * Math.sin(turn + 1));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    return new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  }

  it("when the light turns by more than the drift, then the proxy is rebuilt", () => {
    const proxy = new ShadowProxy(cityMesh());
    proxy.mesh.intersectsFrustum(turnedSun(0));
    const version = proxy.mesh.instanceMatrix.version;
    proxy.mesh.intersectsFrustum(turnedSun(0.0001));
    expect(proxy.mesh.instanceMatrix.version, "a tiny turn is not rebuilt").toBe(version);
    proxy.mesh.intersectsFrustum(turnedSun(0.2));
    expect(proxy.mesh.instanceMatrix.version, "a real turn is").toBeGreaterThan(version);
  });

  it("when the source draws more instances with the same matrices, then the proxy is rebuilt", () => {
    const source = cityMesh();
    source.count = 100;
    const proxy = new ShadowProxy(source);
    const sun = sunFrustum(0, 0);
    proxy.mesh.intersectsFrustum(sun);
    const version = proxy.mesh.instanceMatrix.version;
    source.count = INSTANCES;
    proxy.mesh.intersectsFrustum(sun);
    expect(proxy.mesh.instanceMatrix.version).toBeGreaterThan(version);
  });
});

describe("given the National Mall's art", () => {
  it("when it is built, then every large casting instanced mesh has a shadow proxy beside it in the group", () => {
    stubBrowser();
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.nationalMall)!);
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
    const meshes: THREE.InstancedMesh[] = [];
    art.group.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes.push(o);
    });
    const large = meshes.filter((m) => m.castShadow && m.frustumCulled && m.count >= PROXY_MIN_INSTANCES && m.name !== "");
    expect(large.length, "control: the Mall has large casting meshes").toBeGreaterThan(0);
    for (const mesh of large) expect(meshes.some((other) => other !== mesh && other.geometry === mesh.geometry && other.intersectsFrustum !== mesh.intersectsFrustum && other.name === ""), `a proxy beside ${mesh.name}`).toBe(true);
    art.dispose();
  });
});
