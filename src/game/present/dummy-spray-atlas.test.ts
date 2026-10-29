import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { GarageArt } from "./garage-art.ts";
import { People } from "./people.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { ShowcaseArt } from "./showcase-art.ts";

/** WebGL2's guaranteed `MAX_TEXTURE_SIZE`: a texture past it does not load on every device. */
const WEBGL2_MIN_TEXTURE = 2048;
/** A course's guards at most (`TrackJson.guards.count`), and the VIP: `GroundsArt`'s `People`. */
const GROUNDS_SLOTS = 12 + 1;

/** The atlas a dummy mesh's paint samples: its texture's width and height. */
const atlasOf = (mesh: DummyMesh): { width: number; height: number } => mesh["sprayAtlas"].image;

describe("given every dummy mesh the game builds", () => {
  it("when each is made, then no spray atlas side passes WebGL2's 2048, and the course's figures (showcase, guards) hold only a 1 x 1 bare stub", () => {
    stubBrowser();
    const ragdolls = new RagdollSystem(new THREE.Scene(), () => {}, () => {});
    const garage = new GarageArt();
    const showcase = new ShowcaseArt();
    const grounds = new People(GROUNDS_SLOTS);
    const meshes = { "thrown drivers": ragdolls["mesh"], garage: garage.dummy, showcase: showcase.people["mesh"], grounds: grounds["mesh"] };
    for (const [name, mesh] of Object.entries(meshes)) {
      const { width, height } = atlasOf(mesh);
      expect(width <= WEBGL2_MIN_TEXTURE && height <= WEBGL2_MIN_TEXTURE, `${name}: atlas ${width} x ${height}`).toBeTruthy();
    }
    for (const name of ["showcase", "grounds"] as const) {
      const { width, height } = atlasOf(meshes[name]);
      expect(width * height, `${name}: the bare stub, ${width} x ${height}`).toBe(1);
    }
    garage.dispose();
  });

  it("when a mesh of more sprayed slots than a 2048 atlas stacks is made, then it refuses", () => {
    expect(() => new DummyMesh(9, true)).toThrow(/past 2048/);
  });
});
