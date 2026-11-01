import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { PERSON_SPRAY } from "../match/look-data.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { GarageArt } from "./garage-art.ts";
import { People } from "./people.ts";
import { SprayBitmap } from "./spray.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { dummyGeometry } from "./dummy-skin.ts";
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

  it("when the thrown drivers' 32 sprayed slots are packed, then they stand 8 to a column in 4 columns, and each slot's paint lands in its own bitmap", () => {
    const mesh = new DummyMesh(32, true);
    const { width, height } = atlasOf(mesh);
    expect(`${width} x ${height}`, "4 columns of 8 bitmaps").toBe(`${4 * PERSON_SPRAY.w} x ${8 * PERSON_SPRAY.h}`);
    const bitmap = new SprayBitmap(PERSON_SPRAY);
    bitmap.rgba.fill(255);
    mesh.spray(19, bitmap);
    const painted = (slot: number): boolean => mesh["sprayRgba"]![(((slot % 8) * PERSON_SPRAY.h + 1) * width + Math.floor(slot / 8) * PERSON_SPRAY.w + 1) * 4 + 3] === 255;
    expect([18, 19, 20, 11, 27].map(painted), "slot 19 painted, its neighbours not").toEqual([false, true, false, false, false]);
  });

  it("when the pool's mesh starts holding four slots' paint and is grown to 32, then the atlas is laid out again with the paint of slot 2 where its slot now is, and the shader reads the new layout", () => {
    const mesh = new DummyMesh(32, true, dummyGeometry(), 4);
    expect(`${atlasOf(mesh).width} x ${atlasOf(mesh).height}`, "four bitmaps in one column").toBe(`${PERSON_SPRAY.w} x ${4 * PERSON_SPRAY.h}`);
    const bitmap = new SprayBitmap(PERSON_SPRAY);
    bitmap.rgba.fill(255);
    mesh.spray(2, bitmap);
    mesh.holdSprays(32);
    const { width, height } = atlasOf(mesh);
    expect(`${width} x ${height}`, "4 columns of 8 bitmaps").toBe(`${4 * PERSON_SPRAY.w} x ${8 * PERSON_SPRAY.h}`);
    const painted = (slot: number): boolean => mesh["sprayRgba"]![(((slot % 8) * PERSON_SPRAY.h + 1) * width + Math.floor(slot / 8) * PERSON_SPRAY.w + 1) * 4 + 3] === 255;
    expect([1, 2, 3].map(painted), "slot 2's paint kept, its neighbours bare").toEqual([false, true, false]);
    const uniforms = mesh["sprayUniform"];
    expect([uniforms.sprayRows!.value, uniforms.sprayColumns!.value, uniforms.sprayMap!.value === mesh["sprayAtlas"]], "the shader's rows, columns and map").toEqual([8, 4, true]);
  });

  it("when a mesh of more sprayed slots than a 2048 atlas packs is made, then it refuses", () => {
    expect(() => new DummyMesh(65, true)).toThrow(/past 2048/);
  });
});
