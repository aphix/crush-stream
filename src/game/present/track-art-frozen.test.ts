import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { TRACK_ID } from "../world/constants.ts";
import { placeCourse } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { WorldStage } from "./engine-world.ts";
import { TrackArt } from "./track-art.ts";

describe("given a course's art in the scene (every cell, prop, ground layer and the gantry built in world space)", () => {
  it("when the scene's matrices are updated, then each of its meshes composes and multiplies nothing, and stands at the identity its geometry is built for", () => {
    stubBrowser();
    const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.nationalMall)!);
    const course = placeCourse(track);
    const scene = new THREE.Scene();
    const art = new TrackArt(track, course.placed, new WorldStage(scene), course.drawn);
    scene.add(art.group);
    scene.updateMatrixWorld(true);
    const tagged: THREE.Mesh[] = [];
    art.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.userData.race !== undefined) tagged.push(o);
    });
    expect(tagged.length, "the control: the art holds tagged meshes").toBeGreaterThan(10);
    expect(tagged.filter((m) => m.matrixAutoUpdate || m.matrixWorldAutoUpdate).map((m) => m.name), "meshes three still composes or multiplies every frame").toEqual([]);
    // A frozen mesh's world matrix is never composed: it stays the identity it started as, whatever its own pose says, so the pose itself must be the identity.
    const identity = new THREE.Matrix4();
    expect(art.group.matrixWorld.equals(identity), "the art's group stands at the scene root, unmoved").toBe(true);
    expect(
      tagged.filter((m) => !new THREE.Matrix4().compose(m.position, m.quaternion, m.scale).equals(identity)).map((m) => m.name),
      "meshes posed off the identity (their pose would be dropped)",
    ).toEqual([]);
    art.dispose();
  });
});
