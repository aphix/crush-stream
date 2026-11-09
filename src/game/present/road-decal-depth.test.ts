import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { must } from "../kernel/must.test-util.ts";
import { PREFAB } from "../world/constants.ts";
import { OPENWORLD_ID } from "../world/openworld/openworld-constants.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { OFF_MENU } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { TrackArt } from "./track-art.ts";

/** A millimetre of float and baked-ground noise in a drawn height: a fifteenth of the 1.5 cm a road ribbon is lifted by. */
const HEIGHT_SLACK = 0.001;
/** The open world lays 3 crosswalk decals on each of its 48 crossings and a manhole cover on each of its 24 street segments. */
const ROAD_DECALS_AT_LEAST = 150;
/** A ray from this high (m) looks straight down on the flat city's roads. */
const RAY_TOP = 10;

describe("given the open world's art: the decals on its roads (crossings, manhole covers) and the road ribbons' depth proxy", () => {
  // mutation: sed -i 's/.translate(0, ROAD_LIFT, 0))\]);/)]);/' src/game/present/scenery-assets-art.ts
  it("when each decal on a road is read, then no part of it is drawn under the proxy it is depth-tested against", () => {
    stubBrowser();
    const track = new Track(OFF_MENU.find((json) => parseTrack(json).id === OPENWORLD_ID)!);
    const course = placeCourse(track);
    const art = new TrackArt(track, course.placed, new WorldStage(new THREE.Scene()), course.drawn);
    art.group.updateMatrixWorld(true);
    const proxies: THREE.Mesh[] = [];
    const decals: THREE.InstancedMesh[] = [];
    art.group.traverse((object) => {
      if (object instanceof THREE.Mesh && object.name === "ground-depth") proxies.push(object);
      if (object instanceof THREE.InstancedMesh && object.userData.race?.prefab === PREFAB.assetDecal) decals.push(object);
    });
    const proxy = proxies[0];
    must(proxy, "the road ribbons' depth proxy");
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const hits: THREE.Intersection[] = [];
    const instance = new THREE.Matrix4();
    const corner = new THREE.Vector3();
    const under: string[] = [];
    let onRoad = 0;
    for (const mesh of decals) {
      const position = mesh.geometry.getAttribute("position");
      for (let slot = 0; slot < mesh.count; slot++) {
        mesh.getMatrixAt(slot, instance);
        let lowest = Infinity;
        let sumX = 0;
        let sumZ = 0;
        for (let vertex = 0; vertex < position.count; vertex++) {
          corner.fromBufferAttribute(position, vertex).applyMatrix4(instance).applyMatrix4(mesh.matrixWorld);
          lowest = Math.min(lowest, corner.y);
          sumX += corner.x;
          sumZ += corner.z;
        }
        ray.ray.origin.set(sumX / position.count, RAY_TOP, sumZ / position.count);
        hits.length = 0;
        ray.intersectObject(proxy, false, hits);
        if (hits.length === 0) continue;
        onRoad++;
        const proxyY = hits[0]!.point.y;
        if (lowest < proxyY - HEIGHT_SLACK) under.push(`decal at ${ray.ray.origin.x.toFixed(1)}, ${ray.ray.origin.z.toFixed(1)} drawn at ${lowest.toFixed(4)} m, the proxy at ${proxyY.toFixed(4)} m`);
      }
    }
    expect(onRoad, "decals on a road").toBeGreaterThanOrEqual(ROAD_DECALS_AT_LEAST);
    expect(under.slice(0, 3).join("; "), "decals drawn under the road's depth proxy").toBe("");
    art.dispose();
  });
});
