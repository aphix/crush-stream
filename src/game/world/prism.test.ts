import { afterEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { armSolids, C_DEPTH, C_H, C_NX, C_NY, C_NZ, HIT_SIZE, KNOCK, MOUNT, pointContact, PQ_BODY, PQ_MOUNT, PQ_SIZE, PQ_VX, PQ_VY, PQ_VZ, PQ_X, PQ_Y, PQ_Z, STEP_MAX, Surface, WALL, wheelContact } from "./surfaces.ts";
import { ASKER } from "./prism.ts";
import "./ground.ts";
import { CLASSES, STYLE_CLASS } from "../vehicle/vehicle-classes.ts";
import { carFrame } from "../vehicle/car-rig.ts";
import { CAR_STYLE_IDS, CAR_STYLES } from "../vehicle/car-variants.ts";
import { PLATFORM_TYRE } from "../kernel/rig-spec.ts";
import { ENTRY_WINDOW, SOLID_AT_REST } from "./constants.ts";
import { FF_NX, FF_NZ, FF_PEN, FF_SIZE, FOOT_FX, FOOT_FZ, FOOT_HL, FOOT_HW, FOOT_RX, FOOT_RZ, FOOT_SIZE, FOOT_X, FOOT_Z, footFace } from "./prism.ts";
import { FINE_HZ } from "../kernel/constants.ts";

/** A surface of the given prisms, armed as the scene's solids for the test that asks. */
function solids(...specs: Parameters<Surface["addPrism"]>[0][]): Surface {
  const s = new Surface();
  for (const spec of specs) s.addPrism(spec);
  armSolids(s);
  return s;
}

const q = new Float64Array(PQ_SIZE);
const out = new Float64Array(HIT_SIZE);

function ask(x: number, y: number, z: number, vx = 0, vz = 0, body = false, mount = 0, vy = 0): Float64Array {
  q[PQ_X] = x;
  q[PQ_Y] = y;
  q[PQ_Z] = z;
  q[PQ_VX] = vx;
  q[PQ_VY] = vy;
  q[PQ_VZ] = vz;
  q[PQ_BODY] = body ? 1 : 0;
  q[PQ_MOUNT] = mount;
  pointContact(q, -1, out);
  return out;
}

/** A tyre's own mount (m): `MOUNT` of its drawn radius, the step it climbs by grip. */
const mountOf = (id: "sedan" | "monster") => MOUNT * carFrame(CAR_STYLES[id]).rig.tyre.r * CLASSES[STYLE_CLASS[id]].wheelScale;
/** The scale its tread footprint is asked at: the drawn tyre over the platform's (`wheelsAt`). */
const treadScale = (id: "sedan" | "monster") => CLASSES[STYLE_CLASS[id]].wheelScale * (carFrame(CAR_STYLES[id]).rig.tyre.r / PLATFORM_TYRE.r);
const _hub = new Float64Array(3);
/** The wheel's axes in the world (x across, y up, z along): the level wheel's. */
const _axes = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** The lift (m) a tyre's tread footprint reads at a hub 0.12 m under a 1 m top, over the middle of the armed solids' prism, rolling with `motion` (`wheelContact`'s). */
function treadRead(id: "sedan" | "monster", motion: Float64Array | null = null): number {
  _hub[0] = 0;
  _hub[1] = 1 - 0.12;
  _hub[2] = 0;
  wheelContact(_hub, _axes, treadScale(id), treadScale(id), -1, out, motion);
  return out[C_H]!;
}

/** A 2 m (across) by 4 m (along) box, 1 m tall, its middle at the origin, facing +z. */
const BOX = { x: 0, z: 0, yaw: 0, hx: 1, hz: 2, base: 0, top: 1, id: 0 } as const;
/** The box 3 m tall: a point 0.5 m up in it is far under its top, so only its sides are the way out. */
const TALL = { ...BOX, top: 3 } as const;

describe("given a box prism in the scene's solids", () => {
  it("when a point is above its top then it answers the top's height as a floor with a gap under it", () => {
    solids(BOX);
    const hit = ask(0.2, 1.05, 0.3);
    assert.equal(hit[C_H], 1);
    assert.equal(hit[C_NY], 1);
    assert.ok(Math.abs(hit[C_DEPTH]! + 0.05) < 1e-12, `gap ${hit[C_DEPTH]}`);
    armSolids(null);
  });

  it("when a point is in it deeper than a tyre mounts then it answers a side: no floor, a level normal and the way out", () => {
    solids(BOX);
    const hit = ask(0.9, 0.5, 0, 0, 0);
    assert.equal(hit[C_H], -Infinity);
    assert.equal(hit[C_NY], 0);
    assert.ok(Math.abs(hit[C_DEPTH]! - 0.1) < 1e-12, `depth ${hit[C_DEPTH]}`);
    assert.ok(Math.abs(hit[C_NX]! - 1) < 1e-12 && Math.abs(hit[C_NZ]!) < 1e-12, `normal ${hit[C_NX]} ${hit[C_NZ]}`);
    armSolids(null);
  });

  it("when a point is in it no deeper than the step a tyre mounts then it stands on the top if it is a tyre's or no deeper under it than the face it is in is deep: a body point in a side face is in a wall", () => {
    solids(BOX);
    const kerb = ask(0.9, 1 - STEP_MAX * 0.9, 0);
    assert.equal(kerb[C_H], 1);
    const wall = ask(0.9, 1 - STEP_MAX * 0.9, 0, 0, 0, true);
    assert.equal(wall[C_H], -Infinity);
    assert.equal(wall[C_NY], 0);
    assert.ok(Math.abs(wall[C_DEPTH]! - 0.1) < 1e-12, `depth ${wall[C_DEPTH]}`);
    const beyond = ask(0.9, 1 - STEP_MAX * 1.1, 0);
    assert.equal(beyond[C_H], -Infinity);
    armSolids(null);
  });

  it("when a body point is under the top by less than the face it is in is deep then it stands on the top", () => {
    solids(BOX);
    const hit = ask(0.2, 1 - 0.002, 0.3, 0, 0, true);
    assert.equal(hit[C_H], 1);
    armSolids(null);
  });

  it("when a point under its base is asked then the prism is no floor and no wall: a body passes beneath", () => {
    solids({ ...BOX, base: 3, top: 4 });
    const hit = ask(0, 1, 0);
    assert.equal(hit[C_H], 0, "the ground answers, as if the prism were not there");
    assert.equal(hit[C_NY], 1);
    armSolids(null);
  });

  it("when a point near a corner is closing on the near flank then it leaves through the flank it came in by, not the end that is nearer", () => {
    solids(BOX);
    // 0.3 m in from the +x flank and 0.05 m in from the +z end: nearest exit is the end, but it is moving in along -x, fast enough
    // to have crossed the flank within the step (`ENTRY_WINDOW`) it is asked in.
    const arrived = ask(0.7, 0.5, 1.95, -(0.3 / ENTRY_WINDOW) * 2, 0);
    assert.ok(Math.abs(arrived[C_NX]! - 1) < 1e-12, `normal ${arrived[C_NX]} ${arrived[C_NZ]}`);
    assert.ok(Math.abs(arrived[C_DEPTH]! - 0.3) < 1e-12, `depth ${arrived[C_DEPTH]}`);
    const resting = ask(0.7, 0.5, 1.95, 0, 0);
    assert.ok(Math.abs(resting[C_NZ]! - 1) < 1e-12, `at rest it leaves by the nearest: ${resting[C_NX]} ${resting[C_NZ]}`);
    armSolids(null);
  });

  it("when a point is deeper than its speed could have taken it in one step then it leaves through the nearest face, whatever way it drifts", () => {
    solids(BOX);
    // 0.3 m in from the +x flank, drifting in along -x at half the speed that would cross it within `ENTRY_WINDOW`: it came in earlier.
    const drifting = ask(0.7, 0.5, 1.95, -(0.3 / ENTRY_WINDOW) / 2, 0);
    assert.ok(Math.abs(drifting[C_NZ]! - 1) < 1e-12, `leaves by the nearest: ${drifting[C_NX]} ${drifting[C_NZ]}`);
    assert.ok(Math.abs(drifting[C_DEPTH]! - 0.05) < 1e-12, `depth ${drifting[C_DEPTH]}`);
    armSolids(null);
  });

  it("when a point is moving no faster than the rest speed then it leaves through the nearest face", () => {
    solids(BOX);
    const hit = ask(0.7, 0.5, 1.95, -SOLID_AT_REST * 0.5, 0);
    assert.ok(Math.abs(hit[C_NZ]! - 1) < 1e-12);
    armSolids(null);
  });

  describe("when a body's point is at rest in the prism past its middle", () => {
    afterEach(() => {
      ASKER[0] = NaN;
      ASKER[1] = NaN;
    });

    it("then it leaves by the face the body's centre is outside of, through the middle of the prism, not by the nearer far face", () => {
      solids(TALL);
      // 0.3 m past the middle of the 2 m wide box, toward -x: the -x face is the nearer (0.7 m), the body stands outside the +x face (1.3 m).
      const alone = ask(-0.3, 0.5, 0, 0, 0);
      assert.ok(Math.abs(alone[C_NX]! + 1) < 1e-12 && Math.abs(alone[C_DEPTH]! - 0.7) < 1e-12, `no body asks: ${alone[C_NX]} depth ${alone[C_DEPTH]}`);
      ASKER[0] = 3;
      ASKER[1] = 0;
      const own = ask(-0.3, 0.5, 0, 0, 0);
      assert.ok(Math.abs(own[C_NX]! - 1) < 1e-12 && Math.abs(own[C_DEPTH]! - 1.3) < 1e-12, `its body at +3: ${own[C_NX]} depth ${own[C_DEPTH]}`);
      armSolids(null);
    });

    it("then a body over the prism, outside no face, leaves by the nearest, and a point moving fast enough to have come in keeps its entry face", () => {
      solids(TALL);
      ASKER[0] = 0;
      ASKER[1] = 0;
      const over = ask(-0.3, 0.5, 0, 0, 0);
      assert.ok(Math.abs(over[C_NX]! + 1) < 1e-12, `a body over it: ${over[C_NX]}`);
      ASKER[0] = 3;
      const arrived = ask(0.7, 0.5, 0, -(0.3 / ENTRY_WINDOW) * 2, 0);
      assert.ok(Math.abs(arrived[C_NX]! - 1) < 1e-12 && Math.abs(arrived[C_DEPTH]! - 0.3) < 1e-12, `moving in at +x: ${arrived[C_NX]} depth ${arrived[C_DEPTH]}`);
      armSolids(null);
    });

    it("then in a circle prism it leaves out toward its body, the depth along that way", () => {
      solids({ x: 3, z: 0, yaw: 0, hx: 0.5, hz: 0.5, circle: true, base: 0, top: 3, id: 0 });
      ASKER[0] = 6;
      ASKER[1] = 0;
      const hit = ask(2.9, 1, 0, 0, 0);
      assert.ok(Math.abs(hit[C_NX]! - 1) < 1e-12 && Math.abs(hit[C_DEPTH]! - 0.6) < 1e-12, `depth ${hit[C_DEPTH]} nx ${hit[C_NX]}`);
      armSolids(null);
    });

    it("then the top is the way out only when it is nearer than the nearest side, whichever side its body then takes it out by", () => {
      solids(BOX);
      // 0.3 m past the middle of the 1 m tall box and 0.1 m up in it: the top is 0.9 m over it, the -x face 0.7 m, the +x face its body's side, 1.3 m.
      ASKER[0] = 3;
      ASKER[1] = 0;
      const hit = ask(-0.3, 0.1, 0, 0, 0);
      assert.equal(hit[C_H], -Infinity, `no floor: the top read as the way out, ${hit[C_H]}`);
      assert.ok(Math.abs(hit[C_NX]! - 1) < 1e-12 && Math.abs(hit[C_DEPTH]! - 1.3) < 1e-12, `its body's side: ${hit[C_NX]} depth ${hit[C_DEPTH]}`);
      armSolids(null);
    });

    it("then a point moving slowly in it, which came in by no face within the entry window, leaves by the face its body stands on too, and by the nearest with no body asking", () => {
      solids(TALL);
      // 0.3 m past the middle toward -x, moving +x at 0.5 m/s: the -x face it would have entered by is 1.4 s back, outside the window.
      const alone = ask(-0.3, 0.5, 0, 0.5, 0);
      assert.ok(Math.abs(alone[C_NX]! + 1) < 1e-12 && Math.abs(alone[C_DEPTH]! - 0.7) < 1e-12, `no body asks: ${alone[C_NX]} depth ${alone[C_DEPTH]}`);
      ASKER[0] = 3;
      ASKER[1] = 0;
      const own = ask(-0.3, 0.5, 0, 0.5, 0);
      assert.ok(Math.abs(own[C_NX]! - 1) < 1e-12 && Math.abs(own[C_DEPTH]! - 1.3) < 1e-12, `its body at +3: ${own[C_NX]} depth ${own[C_DEPTH]}`);
      armSolids(null);
    });
  });

  it("when the point is the same distance in however far along the step it started then the face it entered by is the same", () => {
    solids(BOX);
    const faces = new Set<string>();
    for (let k = 0; k < 8; k++) {
      const depth = 0.02 + (k / 8) * 0.23;
      const hit = ask(1 - depth, 0.5, 1.9 - 0.3 * depth, -20, -6);
      faces.add(`${hit[C_NX]!.toFixed(3)} ${hit[C_NZ]!.toFixed(3)}`);
    }
    assert.equal(faces.size, 1, `faces ${[...faces].join(" | ")}`);
    armSolids(null);
  });

  it("when its end is a joint then the end is no face and a point at the end leaves across", () => {
    solids({ ...BOX, ends: 1 });
    const hit = ask(0.5, 0.5, 1.95, 0, 0);
    assert.ok(Math.abs(Math.abs(hit[C_NX]!) - 1) < 1e-12, `normal ${hit[C_NX]} ${hit[C_NZ]}`);
    armSolids(null);
  });

  it("when it is a prop knocked off its spot by a hit then a point query does not meet it", () => {
    solids({ ...BOX, role: KNOCK });
    const hit = ask(0.9, 0.5, 0);
    assert.equal(hit[C_H], 0, "the ground answers");
    assert.equal(hit[C_NY], 1);
    armSolids(null);
  });
});

describe("given a circle prism and a ramp prism", () => {
  it("when a point is inside the circle then it leaves along the radius by the way out", () => {
    solids({ x: 3, z: 0, yaw: 0, hx: 0.5, hz: 0.5, circle: true, base: 0, top: 3, id: 0 });
    const hit = ask(3.3, 1, 0, -1, 0);
    assert.ok(Math.abs(hit[C_DEPTH]! - 0.2) < 1e-12 && Math.abs(hit[C_NX]! - 1) < 1e-12, `depth ${hit[C_DEPTH]} nx ${hit[C_NX]}`);
    armSolids(null);
  });

  it("when the top is tilted then the floor's normal leans away from the high side and its height is the plane's", () => {
    solids({ ...BOX, top: 1, gw: -0.25 });
    const hit = ask(0, 3, 1);
    assert.ok(Math.abs(hit[C_H]! - 0.75) < 1e-12, `height ${hit[C_H]}`);
    assert.ok(hit[C_NZ]! > 0 && Math.abs(hit[C_NZ]! - 0.25 / Math.hypot(0.25, 1)) < 1e-12, `normal ${hit[C_NZ]}`);
    armSolids(null);
  });

  it("when its pose is moved after the seal then the point query follows it", () => {
    const s = new Surface();
    const i = s.addPrism({ ...BOX, moves: true });
    armSolids(s);
    assert.equal(ask(5, 0.5, 0)[C_H], 0, "the prism is not there yet");
    s.movePrism(i, 5.5, 0, 0, 2, 0);
    assert.equal(ask(5, 0.5, 0, 0, 0)[C_H], -Infinity, "it is now");
    armSolids(null);
  });
});

describe("given the step a tyre mounts", () => {
  // A row that fails leaves no solids armed for the next one.
  afterEach(() => armSolids(null));

  it("when it is derived from the classes then it is the biggest tyre's share of its radius", () => {
    const biggest = Math.max(...CAR_STYLE_IDS.map((id) => carFrame(CAR_STYLES[id]).rig.tyre.r * CLASSES[STYLE_CLASS[id]].wheelScale));
    assert.ok(Math.abs(STEP_MAX - MOUNT * biggest) < 1e-9, `${STEP_MAX} against ${MOUNT * biggest}`);
  });

  it("when a sedan's tyre and a monster's are asked at the same point 0.12 m under a box prism's top, then the sedan's own mount reads a side and the monster's a floor", () => {
    solids(BOX);
    const y = 1 - 0.12;
    const sedanHit = ask(0.9, y, 0, 0, 0, false, mountOf("sedan"))[C_H];
    assert.equal(sedanHit, -Infinity, `sedan mount ${mountOf("sedan")}: read ${sedanHit}`);
    const monsterHit = ask(0.9, y, 0, 0, 0, false, mountOf("monster"))[C_H];
    assert.equal(monsterHit, 1, `monster mount ${mountOf("monster")}: read ${monsterHit}`);
    armSolids(null);
  });

  it("when a monster's tyre 0.12 m under a box prism's top is rolling into the side it came in by, then that side is a wall to it; rolling along the side, or standing still, it stands on the top", () => {
    solids(BOX);
    const y = 1 - 0.12;
    // 0.1 m inside the +x face, closing on it at 10 m/s: it came in through it a hundredth of a second ago.
    const into = ask(0.9, y, 0, -10, 0, false, mountOf("monster"));
    assert.equal(into[C_H], -Infinity, `rolling into the side: read ${into[C_H]}`);
    assert.equal(into[C_NX], 1);
    assert.ok(Math.abs(into[C_DEPTH]! - 0.1) < 1e-12, `depth ${into[C_DEPTH]}`);
    // Along +z, the nearest face it closes on is the far end's, 2 m off: crossed longer ago than the entry window.
    assert.equal(ask(0.9, y, 0, 0, 10, false, mountOf("monster"))[C_H], 1, "rolling along the side");
    assert.equal(ask(0.9, y, 0, 0, 0, false, mountOf("monster"))[C_H], 1, "at rest");
    armSolids(null);
  });

  it("when a body point is asked with a tyre's mount, then it reads as it does with none: only a tyre has a mount", () => {
    solids(BOX);
    // 0.12 m under the top, 0.15 m inside a face it closes on: a body point there stands on the top, as the biggest tyre's step lets it.
    const bare = ask(0.85, 1 - 0.12, 0, -1, 0, true);
    assert.equal(bare[C_H], 1, "a body point standing 0.12 m under the top, inside a deeper face");
    const bareRead = [bare[C_H], bare[C_NY], bare[C_DEPTH]].join();
    const mounted = ask(0.85, 1 - 0.12, 0, -1, 0, true, mountOf("sedan"));
    assert.equal([mounted[C_H], mounted[C_NY], mounted[C_DEPTH]].join(), bareRead, `body point with the sedan's mount ${mountOf("sedan")}`);
    armSolids(null);
  });

  it("when a tyre is 0.4 m under a box prism's top and falling, then the sedan's tyre (0.342 m) is not stood on the top, however it came in: it reads the ground under it; the monster's (0.614 m) is stood on it", () => {
    solids(BOX);
    const sedanHit = ask(0, 0.6, 0, 0, 0, false, mountOf("sedan"), -1)[C_H];
    assert.equal(sedanHit, 0, `sedan mount ${mountOf("sedan")}: read ${sedanHit}`);
    const monsterHit = ask(0, 0.6, 0, 0, 0, false, mountOf("monster"), -1)[C_H];
    assert.equal(monsterHit, 1, `monster mount ${mountOf("monster")}: read ${monsterHit}`);
    armSolids(null);
  });

  it("when a tyre's tread footprint stands 0.12 m under the top of a prism narrower than the tyre's step, then the sedan's reads the ground (the prism a wall to it) and the monster's the prism's top", () => {
    const flat = { sedan: treadRead("sedan"), monster: treadRead("monster") };
    solids({ ...BOX, hx: 0.1, hz: 3 });
    assert.equal(treadRead("sedan"), flat.sedan, `sedan tread (scale ${treadScale("sedan").toFixed(3)}, mount ${mountOf("sedan").toFixed(3)})`);
    const monster = treadRead("monster");
    assert.ok(monster > flat.monster + 0.5, `monster tread (scale ${treadScale("monster").toFixed(3)}, mount ${mountOf("monster").toFixed(3)}): ${monster} over the ground's ${flat.monster}`);
    armSolids(null);
  });

  it("when the monster's tread footprint stands 0.12 m under the top of a prism narrower than its step and the wheel rolls across it at 10 m/s, then it reads the ground: the side it came in by is a wall to it", () => {
    const motion = new Float64Array([10, 0, 0, 0, 0]);
    const flat = treadRead("monster", motion);
    solids({ ...BOX, hx: 0.1, hz: 3 });
    const rolling = treadRead("monster", motion);
    assert.equal(rolling, flat, `monster tread rolling across (scale ${treadScale("monster").toFixed(3)}, mount ${mountOf("monster").toFixed(3)}): ${rolling} against the ground's ${flat}`);
    armSolids(null);
  });

  it("when prisms are listed near a point then each one is listed once, and the ones far away are not", () => {
    const s = new Surface();
    for (let k = 0; k < 20; k++) s.addPrism({ ...BOX, x: k * 30, id: k, role: WALL });
    s.seal();
    const count = s.prismsNear(60, 0, 5);
    assert.equal(count, 1);
    assert.equal(s.nearList[0], 2);
    assert.equal(s.prismsNear(45, 0, 20), 2);
  });
});

/**
 * A car's footprint against a circle prism (`footFace`): a trunk 0.9 m off the centre line of a footprint 0.894 m half wide and 2.11 m
 * half long, its middle level with a point 0.2 m short of the footprint's front edge, so the circle stands `RADIUS - 0.006` m into the
 * flank. Driving on at speed it came in through the front (the walk back along the motion leaves the grown footprint there); drifting at
 * 1 m/s the walk back is the footprint's length, 3.9 m and 3.9 s for a flank touch 0.134 m deep, and it leaves the way it is nearest.
 */
describe("given a car's footprint over a circle prism at its flank", () => {
  const HW = 0.894;
  const HL = 2.11;
  const RADIUS = 0.14;
  const SIDE = HW + 0.006;
  const AHEAD = HL - 0.2;
  const foot = new Float64Array(FOOT_SIZE);
  const hit = new Float64Array(FF_SIZE);

  /** The footprint at the origin facing +z, moving `speed` m/s along +z, against the circle at (`SIDE`, `AHEAD`); the hit's depth and normal. */
  function meet(speed: number): { pen: number; nx: number; nz: number } {
    const s = new Surface();
    s.addPrism({ x: SIDE, z: AHEAD, yaw: 0, hx: RADIUS, hz: RADIUS, circle: true, base: 0, top: 2, id: 0 });
    foot[FOOT_X] = 0;
    foot[FOOT_Z] = 0;
    foot[FOOT_RX] = 1;
    foot[FOOT_RZ] = 0;
    foot[FOOT_FX] = 0;
    foot[FOOT_FZ] = 1;
    foot[FOOT_HW] = HW;
    foot[FOOT_HL] = HL;
    assert.ok(footFace(s.p, 0, foot, 0, speed, 1 / FINE_HZ, hit), "they overlap");
    return { pen: hit[FF_PEN]!, nx: hit[FF_NX]!, nz: hit[FF_NZ]! };
  }

  it("when the car drives on at 30 m/s then it met the prism through the footprint's front, the walk back's depth", () => {
    const { pen, nx, nz } = meet(30);
    assert.ok(nz < -0.99, `normal ${nx} ${nz}`);
    assert.ok(pen > RADIUS - 0.006 + 0.05, `depth ${pen}`);
  });

  it("when the car drifts at 1 m/s then it leaves the way it is nearest, across the flank, by the flank's own depth", () => {
    const { pen, nx, nz } = meet(1);
    assert.ok(Math.abs(nx + 1) < 1e-12 && Math.abs(nz) < 1e-12, `normal ${nx} ${nz}`);
    assert.ok(Math.abs(pen - (RADIUS - 0.006)) < 1e-12, `depth ${pen}`);
  });
});
