import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { WORLD } from "../contact/tether.ts";
import { AIM } from "../present/tether-art.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, pressKey, runSeconds, stubBrowser } from "./engine-headless.test-util.ts";
import { TETHER_KEYS } from "./engine-keys.ts";

const FRAME = 1 / FRAME_HZ;
const PLAYER = 0;
const OTHER = 1;
/** The most (m) a decal on the floor (the rings, the pools) can pull the first surface of a shallow ray off the floor mesh's own hit. */
const GROUND_DECAL_M = 1;
/** Where the second car waits (m to the side of the player's), on the fleet disc and off the sight line. */
const ASIDE_M = 40;
/** How close (m) a cable's end is to the point the sight line first touches. */
const HIT_TOLERANCE_M = 0.02;

/** The camera's centre ray as the last frame left it: where it starts, which way it points, and how far it runs to the ground plane (infinity when it never gets there). */
interface Sight {
  eye: THREE.Vector3;
  dir: THREE.Vector3;
  ground: number;
}

describe("given the real engine in the fleet with the player at the wheel of car 0, and the camera's centre ray over the field", () => {
  // One engine for the file: a second `CrashEngine` in the same process never resolves `ready`.
  let engine: CrashEngine;
  const tethers = () => engine["world"].tethers;
  const scene = () => engine["scene"] as THREE.Scene;
  const built: THREE.Mesh[] = [];

  /** Two cars at rest and drawn, the player at the wheel, the camera settled, and every drawn matrix current. */
  const stage = (): void => {
    engine["setCarCount"](2);
    engine["fadeScenes"] = false;
    engine["seat"].focus(PLAYER);
    engine["seat"].mode = "drive";
    engine["seat"].view = "first";
    engine["seat"].viewPicked = true;
    place(PLAYER, 0, -10);
    place(OTHER, ASIDE_M, -10);
    engine.autoSlomo = false;
    engine.tether.cut();
    runSeconds(engine, 1);
    scene().updateMatrixWorld(true);
  };
  const sight = (): Sight => {
    const matrix = engine["camera"].matrixWorld;
    const eye = new THREE.Vector3().setFromMatrixPosition(matrix);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(matrix);
    return { eye, dir, ground: dir.y < -1e-3 ? -eye.y / dir.y : Infinity };
  };
  const along = (s: Sight, metres: number): THREE.Vector3 => s.eye.clone().addScaledVector(s.dir, metres);
  /** A wall `width` m wide and 8 m tall, centred at `centre`, facing back along the sight line, in the scene. */
  const wall = (s: Sight, centre: THREE.Vector3, width: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 8, 0.4), new THREE.MeshBasicMaterial());
    mesh.position.copy(centre);
    mesh.lookAt(centre.clone().sub(s.dir));
    scene().add(mesh);
    built.push(mesh);
    return mesh;
  };
  /** Where the sight line first meets a drawn mesh of `object` (nothing invisible), as the last matrix update left it. */
  const firstHit = (s: Sight, object: THREE.Object3D): THREE.Vector3 => {
    for (const hit of new THREE.Raycaster(s.eye, s.dir).intersectObject(object, true)) {
      let drawn = hit.object instanceof THREE.Mesh;
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) drawn &&= o.visible;
      if (drawn) return hit.point;
    }
    return assert.fail("the sight line misses what the row put in its way");
  };
  /** The sandbox's floor, grid, rings, lamp poles and pools hidden (or shown again): what is left in the scene is the row's own. */
  const studio = (shown: boolean): void => {
    for (const part of engine["studio"]) part.visible = shown;
    for (const pole of engine["poles"]) pole.group.visible = shown;
    engine["lampLights"].pools.visible = shown;
  };
  const press = (code: string): void => {
    scene().updateMatrixWorld(true);
    pressKey(engine, code);
    engine["keys"].delete(code);
    engine.advance(FRAME, { frameDt: FRAME });
    scene().updateMatrixWorld(true);
  };
  const endPoint = (end: number): THREE.Vector3 => {
    const point = new THREE.Vector3();
    assert.ok(tethers().anchor(0, end, engine["live"](), point), "the cable's end has a car");
    return point;
  };
  /** A car at (x, z) at rest, drawn. */
  const place = (car: number, x: number, z: number): void => {
    engine["live"]()[car]!.spawnFacing(x, z, 0, 0);
    engine["live"]()[car]!.group.visible = true;
  };
  /** How far (m) along the sight line the rows put their things: to the ground plane, but no farther than 60 m. */
  const reach = (s: Sight): number => Math.min(s.ground, 60);
  /** A spot `fraction` of the way along `reach`. */
  const overGround = (s: Sight, fraction: number): THREE.Vector3 => along(s, fraction * reach(s));
  /** Where the sight line crosses a car's body height (0.7 m), or 25 m out when it runs level above it. */
  const bodySpot = (s: Sight): THREE.Vector3 => along(s, s.dir.y < -1e-3 ? Math.min(25, (s.eye.y - 0.7) / -s.dir.y) : 25);

  before(async () => {
    stubBrowser();
    engine = await bootEngine({ pacer: true });
  });
  after(() => {
    for (const mesh of built) {
      scene().remove(mesh);
      mesh.geometry.dispose();
    }
    engine.dispose();
    setGround(null);
  });

  it("when fire is pressed with a car's body under the ray, then the cable hooks the car at the first point the ray touches it", () => {
    stage();
    const s = sight();
    assert.ok(reach(s) > 8, `the sight line (eye ${s.eye.toArray().map((v) => v.toFixed(1))}, dir ${s.dir.toArray().map((v) => v.toFixed(2))}) meets the ground ${s.ground.toFixed(1)} m out: no room for a car`);
    const spot = bodySpot(s);
    place(OTHER, spot.x, spot.z);
    scene().updateMatrixWorld(true);
    const expected = firstHit(s, engine["live"]()[OTHER]!.group);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out");
    assert.equal(tethers().endCar(0, 0), OTHER, "the first end is on the car");
    assert.equal(tethers().endCar(0, 1), PLAYER, "the second end is the player's car");
    assert.ok(endPoint(0).distanceTo(expected) < HIT_TOLERANCE_M, `hooked ${endPoint(0).distanceTo(expected).toFixed(3)} m from the ray's first hit`);
    assert.ok(endPoint(0).distanceTo(engine["live"]()[OTHER]!.group.position) > 0.3, "the hook is on the body, not at its centre");
  });

  it("when a wall stands in front of a car in the ray, then the cable hooks the wall's face at the world point, not the car behind", () => {
    stage();
    const s = sight();
    const spot = overGround(s, 0.9);
    place(OTHER, spot.x, spot.z);
    const front = wall(s, along(s, 0.6 * reach(s)), 8);
    scene().updateMatrixWorld(true);
    const expected = firstHit(s, front);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out");
    assert.equal(tethers().endCar(0, 0), WORLD, "the first end is a world point");
    assert.ok(endPoint(0).distanceTo(expected) < HIT_TOLERANCE_M, `hooked ${endPoint(0).distanceTo(expected).toFixed(3)} m from the wall's face`);
    scene().remove(front);
  });

  it("when nothing but the ground is in the ray, then the cable hooks the ground at the first point the ray touches it", () => {
    stage();
    const s = sight();
    const onGround = firstHit(s, engine["stage"].ground);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out");
    assert.equal(tethers().endCar(0, 0), WORLD, "the first end is a world point");
    assert.ok(endPoint(0).distanceTo(onGround) < GROUND_DECAL_M, `hooked ${endPoint(0).distanceTo(onGround).toFixed(3)} m from the floor's own hit`);
    assert.ok(Math.abs(endPoint(0).y) < 0.1, `hooked ${endPoint(0).y.toFixed(3)} m above the ground`);
    assert.ok(new THREE.Ray(s.eye, s.dir).distanceToPoint(endPoint(0)) < HIT_TOLERANCE_M, "the hook is on the sight line");
  });

  it("when the ray passes a car's corner without touching it, then the cable hooks the wall behind, not the car", () => {
    stage();
    const s = sight();
    const side = new THREE.Vector3(-s.dir.z, 0, s.dir.x).normalize();
    const nearSpot = overGround(s, 0.5).addScaledVector(side, 2.4);
    place(OTHER, nearSpot.x, nearSpot.z);
    const behind = wall(s, along(s, 0.8 * reach(s)), 30);
    scene().updateMatrixWorld(true);
    assert.equal(new THREE.Raycaster(s.eye, s.dir).intersectObject(engine["live"]()[OTHER]!.group, true).length, 0, "the ray touches the car: the row's geometry is off");
    const expected = firstHit(s, behind);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out");
    assert.equal(tethers().endCar(0, 0), WORLD, "the first end is a world point: the wall's");
    assert.ok(endPoint(0).distanceTo(expected) < HIT_TOLERANCE_M, `hooked ${endPoint(0).distanceTo(expected).toFixed(3)} m from the wall behind the car`);
    scene().remove(behind);
  });

  it("when the first surface is beyond 80 m, then the reticle reads out of reach and fire makes no cable", () => {
    stage();
    studio(false);
    const s = sight();
    const far = wall(s, along(s, 110), 60);
    scene().updateMatrixWorld(true);
    press(TETHER_KEYS.fire);
    studio(true);
    scene().remove(far);
    assert.equal(engine.tether.hud()?.aim, AIM.far, "the reticle's state");
    assert.equal(tethers().count, 0, "cables out");
  });

  it("when the ray touches nothing, then the reticle reads nothing and fire makes no cable", () => {
    stage();
    studio(false);
    press(TETHER_KEYS.fire);
    studio(true);
    assert.equal(engine.tether.hud()?.aim, AIM.none, "the reticle's state");
    assert.equal(tethers().count, 0, "cables out");
  });

  it("when fire is pressed again at something else, then the player's end moves there and the cable runs from the first target to it", () => {
    stage();
    const s = sight();
    const spot = bodySpot(s);
    place(OTHER, spot.x, spot.z);
    press(TETHER_KEYS.fire);
    place(OTHER, ASIDE_M, -10);
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out");
    assert.equal(tethers().endCar(0, 0), OTHER, "the first end stays on the target");
    assert.equal(tethers().endCar(0, 1), WORLD, "the second end is a world point");
  });

  it("when a cable is out and the cut key is pressed, then no cable is left", () => {
    stage();
    press(TETHER_KEYS.fire);
    assert.equal(tethers().count, 1, "cables out before the cut");
    press(TETHER_KEYS.cut);
    assert.equal(tethers().count, 0, "cables out after the cut");
  });

  it("when the retract key is held, then the cables reel, and when it is let go, they stop", () => {
    stage();
    press(TETHER_KEYS.fire);
    engine["keys"].add(TETHER_KEYS.retract);
    engine.advance(FRAME, { frameDt: FRAME });
    assert.equal(tethers().reeling, true, "reeling while held");
    engine["keys"].delete(TETHER_KEYS.retract);
    engine.advance(FRAME, { frameDt: FRAME });
    assert.equal(tethers().reeling, false, "reeling after the release");
  });
});
