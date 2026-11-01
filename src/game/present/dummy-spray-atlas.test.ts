import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { stubBrowser } from "../engine/engine-headless.test-util.ts";
import { NO_PERSON_PICK, PERSON_SPRAY } from "../match/look-data.ts";
import { RagdollSystem } from "./engine-ragdoll.ts";
import { GarageArt } from "./garage-art.ts";
import { People } from "./people.ts";
import { SprayBitmap } from "./spray.ts";
import { DummyMesh } from "./ragdoll-mesh.ts";
import { dummyGeometry } from "./dummy-skin.ts";
import { BASE_SLOTS, SLOTS } from "./ragdoll-config.ts";
import { flatSystem } from "./ragdoll-throws.test-util.ts";
import { ShowcaseArt } from "./showcase-art.ts";
import { compileHooks } from "../vehicle/car-detail-map.test-util.ts";

/** WebGL2's guaranteed `MAX_TEXTURE_SIZE`: a texture past it does not load on every device. */
const WEBGL2_MIN_TEXTURE = 2048;
/** A course's guards at most (`TrackJson.guards.count`), and the VIP: `GroundsArt`'s `People`. */
const GROUNDS_SLOTS = 12 + 1;
const UP = new THREE.Quaternion();
const STILL = new THREE.Vector3();

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

  it("when a pool that built 32 slots (a showcase visit) throws a driver wearing a spray into slot 2, then the atlas is still four bitmaps tall and the spray is in slot 2's bitmap, which the shader reads as four rows", async () => {
    stubBrowser();
    const sys = await flatSystem();
    sys.setCapacity(SLOTS);
    for (let n = 0; n < SLOTS; n++) sys.place(new THREE.Vector3(3 * (n % 8), 1.2, 3 * Math.floor(n / 8)), UP, STILL, STILL, Infinity, -1);
    expect(sys.builtSlots, "slots built").toBe(SLOTS);
    const bitmap = new SprayBitmap(PERSON_SPRAY);
    bitmap.rgba.fill(255);
    sys.lookOf = () => ({ person: NO_PERSON_PICK, personSpray: bitmap });
    sys.place(new THREE.Vector3(0, 1.2, 12), UP, STILL, STILL, Infinity, 2);
    const mesh = sys.pickMesh;
    const { width, height } = atlasOf(mesh);
    expect(`${width} x ${height}`, "four bitmaps stacked in one column").toBe(`${PERSON_SPRAY.w} x ${BASE_SLOTS * PERSON_SPRAY.h}`);
    const painted = (slot: number): boolean => mesh["sprayRgba"]![((slot * PERSON_SPRAY.h + 1) * width + 1) * 4 + 3] === 255;
    expect([1, 2, 3].map(painted).join(), "slot 2's paint, its neighbours bare").toBe("false,true,false");
    expect(compileHooks(mesh.material).uniforms.sprayRows!.value, "the shader's rows").toBe(BASE_SLOTS);
    sys.dispose();
  });

  it("when a slot past the atlas's four is cleared, then nothing is uploaded, and when one within it is, then it is", () => {
    const mesh = new DummyMesh(SLOTS, true, dummyGeometry(), BASE_SLOTS);
    const uploaded = mesh["sprayAtlas"].version;
    mesh.spray(20, null);
    expect(mesh["sprayAtlas"].version, "after clearing slot 20").toBe(uploaded);
    mesh.spray(2, null);
    expect(mesh["sprayAtlas"].version, "after clearing slot 2").toBeGreaterThan(uploaded);
  });

  it("when a mesh of more sprayed slots than a 2048 atlas stacks is made, then it refuses", () => {
    expect(() => new DummyMesh(9, true)).toThrow(/past 2048/);
  });
});
