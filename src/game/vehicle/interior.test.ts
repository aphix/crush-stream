import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import { beltY, floorY } from "./car-lines.ts";
import { makeRoofGeometry } from "./car-greenhouse-mesh.ts";
import { roofAt } from "./car-mesh.ts";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle, type CarStyleId } from "./car-variants.ts";
import { BUMPER_F, CABIN_TRIM, INNER_PANEL, LID, PRIMER_ATTRIBUTE, WELL_PANEL } from "./constants.ts";
import { makeDoorGeometry } from "./car-door-mesh.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { bayAt, bayTub, glassX, makeHoodGeometry, sampleSlice, TUB_EDGE } from "./car-mesh.ts";
import { carFrame } from "./car-rig.ts";
import { makeWellLiners } from "./car-well-mesh.ts";
import { cabinGeometry, cageInterior, doorCardGeometry } from "./interior-geometry.ts";
import { CarCabin, driverSeat } from "./interior.ts";
import { PartBatch } from "./part-batch.ts";
import { carPartSeats, PART_KIND, PART_KINDS, partGeometry, type PartSeat } from "./part-geometry.ts";
import { paint } from "./test-support.ts";
import { carInState } from "./drawn-body.test-util.ts";
import { assignClass, CLASSES, STYLE_CLASS } from "./vehicle-classes.ts";

const mm = (v: THREE.Vector3): string => v.toArray().map((x) => x.toFixed(3)).join();

/** A car whose private parts a row can tear and read. */
class Probe extends DeformableCar {
  part(name: string) {
    return this.parts.find((p) => p.name === name)!;
  }
  tear(name: string): void {
    this.detachPart(this.part(name), 0);
  }
}

describe("given a style with seats of its own", () => {
  const own: BodyStyle = { ...CAR_STYLES.sedan, seats: { front: [0.41, 0.47, -0.08], rear: [0.5, -0.5] } };
  const build = (style: BodyStyle) => {
    const seats = carPartSeats();
    new CarCabin(style, seats, new THREE.Group());
    const of = (kind: number): PartSeat[] => seats.filter((s) => s.kind === kind);
    return { front: of(PART_KIND.seatFront), rear: of(PART_KIND.seatRear)[0]! };
  };

  test("when its cabin is built, then the driver's seat stands on its H-point on the driver's side, the passenger's mirrors it and the rear bench is on its row", () => {
    const { front, rear } = build(own);
    assert.equal(mm(front[0]!.position), "0.410,0.470,-0.080");
    assert.equal(mm(front[1]!.position), "-0.410,0.470,-0.080");
    assert.equal(mm(rear.position), "0.000,0.500,-0.500");
    assert.ok(rear.parent !== null, "the bench is in the cabin");
  });

  test("when it has no rear row, then no bench is placed in its cabin", () => {
    const { rear } = build({ ...own, seats: { ...own.seats, rear: null } });
    assert.equal(rear.parent, null);
  });
});

describe("given every style and the cage interior, with the driver on the car's left (+x)", () => {
  /** The mean x of `geometry`'s vertices that `inside` keeps, and how many it kept. */
  const meanX = (geometry: THREE.BufferGeometry, inside: (x: number, y: number, z: number) => boolean): { x: number; count: number } => {
    const pos = geometry.getAttribute("position");
    let sum = 0;
    let count = 0;
    for (let i = 0; i < pos.count; i++) {
      if (!inside(pos.getX(i), pos.getY(i), pos.getZ(i))) continue;
      sum += pos.getX(i);
      count++;
    }
    return { x: sum / count, count };
  };

  test("when the cabins are built, then the driver's H-point, his seat, his wheel, the dash binnacle and the cage interior's wheel are all on the left", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const seat = driverSeat(style);
      assert.ok(seat.hip.x > 0.2 && seat.wheel.x > 0.2, `${id}: H-point x ${seat.hip.x.toFixed(2)}, wheel x ${seat.wheel.x.toFixed(2)}`);
      const seats = carPartSeats();
      new CarCabin(style, seats, new THREE.Group());
      const driver = seats.find((s) => s.kind === PART_KIND.seatFront)!;
      const wheel = seats.find((s) => s.kind === PART_KIND.wheel)!;
      assert.ok(driver.position.x > 0.2 && wheel.position.x > 0.2, `${id}: drawn driver's seat x ${driver.position.x.toFixed(2)}, wheel x ${wheel.position.x.toFixed(2)}`);
    }
    // The binnacle's top (the screen stands on the centre line, the dash top lower); the cage interior's wheel torus alone in its box.
    const binnacle = meanX(cabinGeometry(), (x, y) => y > 0.9 && Math.abs(x) > 0.17);
    const cageWheel = meanX(cageInterior(), (x, y, z) => Math.abs(x) < 0.38 && y > 0.55 && y < 0.8 && z > 0.2 && z < 0.5);
    assert.ok(binnacle.count > 0 && binnacle.x > 0.2, `the dash binnacle's mean x ${binnacle.x.toFixed(2)} (${binnacle.count} vertices)`);
    assert.ok(cageWheel.count > 0 && cageWheel.x > 0.15, `the cage interior's wheel mean x ${cageWheel.x.toFixed(2)} (${cageWheel.count} vertices)`);
  });
});

describe("given every style's seats", () => {
  /** Rear rows per style: a regular-cab pickup has none; the monster is a crew cab; the coupe is a 2+2. */
  const REAR_ROWS: Readonly<Record<CarStyleId, number>> = { sedan: 1, police: 1, hatchback: 1, wagon: 1, coupe: 1, pickup: 0, monster: 1 };
  /** The front H-point stands this far (m) over the cabin floor. */
  const HIP_OVER_FLOOR = 0.14;
  /** Half the cab back wall's thickness (m): the drawn wall box is 4.5 cm deep about `rearBulkhead.z`. */
  const WALL_HALF = 0.0225;
  /** `seat`'s geometry in the cabin's frame (x, y, z per vertex), the vertices `keep` takes by their own (seat-space) height. */
  const placed = (seat: PartSeat, keep: (y: number) => boolean): THREE.Vector3[] => {
    seat.updateMatrix();
    const pos = seat.geometry.getAttribute("position");
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) if (keep(pos.getY(i))) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(seat.matrix));
    return out;
  };

  test("when each cabin is built, then two sit in front at the floor plus 0.14 m, and the rear row (none in a pickup) stands between the B-pillar and the cab's back wall, under its roof line and over its floor pan, clear of the front seats", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const seats = carPartSeats();
      new CarCabin(style, seats, new THREE.Group());
      const front = seats.filter((s) => s.kind === PART_KIND.seatFront && s.parent !== null);
      const rear = seats.filter((s) => s.kind === PART_KIND.seatRear && s.parent !== null);
      assert.equal(`${front.length} front, ${rear.length} rear`, `2 front, ${REAR_ROWS[id]} rear`, id);
      assert.ok(Math.abs(driverSeat(style).hip.y - style.tubs[0]![2] - HIP_OVER_FLOOR) < 1e-9, `${id}: H-point ${driverSeat(style).hip.y} over the floor ${style.tubs[0]![2]}`);
      const bench = rear[0];
      if (!bench) continue;
      const { z: wall, yTop } = style.rearBulkhead;
      assert.ok(bench.position.z > wall && bench.position.z <= style.bPillar.rear, `${id}: bench H-point z ${bench.position.z} outside the wall ${wall} .. B-pillar ${style.bPillar.rear}`);
      const behindWall = placed(bench, () => true).filter((p) => p.y < yTop && p.z < wall + WALL_HALF);
      assert.equal(behindWall.length, 0, `${id}: ${behindWall.length} bench vertices under the wall's top behind its face`);
      const overRoof = placed(bench, () => true).filter((p) => p.y > roofAt(p.z, style).y);
      assert.equal(overRoof.length, 0, `${id}: ${overRoof.length} bench vertices over the roof line, the highest ${Math.max(...overRoof.map((p) => p.y - roofAt(p.z, style).y)).toFixed(3)} m over it`);
      const underFloor = placed(bench, () => true).filter((p) => p.y < floorY(p.z, style));
      assert.equal(underFloor.length, 0, `${id}: ${underFloor.length} bench vertices under the floor pan, the lowest ${Math.min(...underFloor.map((p) => p.y - floorY(p.z, style))).toFixed(3)} m under it`);
      const cushion = new THREE.Box3().setFromPoints(placed(bench, (y) => y < 0));
      const inCushion = front.flatMap((s) => placed(s, () => true)).filter((p) => cushion.containsPoint(p));
      assert.equal(inCushion.length, 0, `${id}: ${inCushion.length} front seat vertices inside the bench's cushion`);
    }
  });

  test("when each cabin is built, then no point of its engine bay stands under the floor pan, as the drawn trough it sits in never does", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const seats = carPartSeats();
      new CarCabin(style, seats, new THREE.Group());
      const bay = seats.find((s) => s.kind === PART_KIND.engineBay)!;
      const under = placed(bay, () => true).filter((p) => p.y < floorY(p.z, style) - 1e-6);
      assert.equal(under.length, 0, `${id}: ${under.length} bay vertices under the floor pan, the lowest at y ${Math.min(...under.map((p) => p.y)).toFixed(3)}`);
    }
  });
});

describe("given a field of one car of every style", () => {
  const scene = new THREE.Scene();
  const cars = CAR_STYLE_IDS.map((id) => {
    const car = new Probe(paint(), scene, null, id);
    car.spawn(0, 0, 0);
    car.group.updateMatrixWorld(true);
    return car;
  });
  const batch = new PartBatch(cars.length);
  const draw = (): Record<number, number> => {
    for (const c of cars) c.group.updateMatrixWorld(true);
    batch.sync(cars);
    return Object.fromEntries(PART_KINDS.map((k) => [k, batch.drawn(k)]));
  };
  const rows = CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].seats.rear !== null).length;
  const lifted = CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].underbody).length;

  test("when the batch syncs, then each prop kind draws the whole field's seats, and nothing under the hood or bumpers shows", () => {
    const counts = draw();
    assert.equal(batch.kinds.length, PART_KINDS.length, "one entry per kind");
    assert.equal(counts[PART_KIND.interior], cars.length);
    assert.equal(counts[PART_KIND.seatFront], 2 * cars.length);
    assert.equal(counts[PART_KIND.seatRear], rows);
    assert.ok(rows < cars.length, "the control: a regular cab has no rear row");
    assert.equal(counts[PART_KIND.wheel], cars.length);
    assert.equal(counts[PART_KIND.engineBay], 0);
    assert.equal(counts[PART_KIND.crashBar], 0);
    assert.equal(counts[PART_KIND.ladderFrame], lifted, "a frame only under a style with an undercarriage");
    assert.equal(counts[PART_KIND.axle], 2 * lifted);
    assert.ok(lifted > 0 && lifted < cars.length, "the control: the monster has one, the rest none");
  });

  test("when one car's hood and another's front bumper come off, then the bay and one crash bar show, in their kinds' one draw each", () => {
    cars[0]!.tear(LID.hood);
    cars[1]!.tear(BUMPER_F);
    const counts = draw();
    assert.equal(counts[PART_KIND.engineBay], 1);
    assert.equal(counts[PART_KIND.crashBar], 1);
    for (const c of cars) c.resetVisual();
    const reset = draw();
    assert.equal(reset[PART_KIND.engineBay], 0, "a reset closes the bay");
    assert.equal(reset[PART_KIND.crashBar], 0);
  });
});

describe("given cars whose crash moves the engine bay, the crash bars and the cabin shell", () => {
  /** The kinds posed every frame (`PoseBlend`, `posePart`, `CarUnderbody.follow`): their seats keep three's own matrix update. */
  const LIVE: readonly number[] = [PART_KIND.mirrorL, PART_KIND.mirrorR, PART_KIND.axle];
  const own = new THREE.Matrix4();
  const expected = new THREE.Matrix4();

  /** Each seat's flag, and for a static seat in the scene graph its world matrix against `parent × compose(position, quaternion, scale)`. */
  const assertSeats = (car: DeformableCar, what: string): void => {
    car.group.updateMatrixWorld(true);
    for (const seat of car.partSeats) {
      const live = LIVE.includes(seat.kind);
      assert.equal(seat.matrixAutoUpdate, live, `${what}: kind ${seat.kind} matrixAutoUpdate`);
      if (live || seat.parent === null) continue;
      own.compose(seat.position, seat.quaternion, seat.scale);
      expected.multiplyMatrices(seat.parent.matrixWorld, own);
      let gap = 0;
      for (let k = 0; k < 16; k++) gap = Math.max(gap, Math.abs(seat.matrixWorld.elements[k]! - expected.elements[k]!));
      assert.ok(gap < 1e-6, `${what}: kind ${seat.kind} world matrix is ${gap.toExponential(1)} off its parent's times its own pose`);
    }
  };

  /** The furthest any `kinds` seat of `car` stands (position, scale) from where `rest`'s does. */
  const moved = (car: DeformableCar, rest: DeformableCar, kinds: readonly number[]): number => {
    let far = 0;
    for (let i = 0; i < car.partSeats.length; i++) {
      const seat = car.partSeats[i]!;
      if (!kinds.includes(seat.kind)) continue;
      far = Math.max(far, seat.position.distanceTo(rest.partSeats[i]!.position), seat.scale.distanceTo(rest.partSeats[i]!.scale));
    }
    return far;
  };

  test("when a car is crashed and refitted, then every static part seat keeps matrixAutoUpdate off and its world matrix is its parent's times its own pose", () => {
    const scene = new THREE.Scene();
    for (const id of CAR_STYLE_IDS) {
      const car = new DeformableCar(paint(), scene, null, id);
      car.spawn(0, 0, 0);
      assertSeats(car, `${id} built`);
    }
    const rest = carInState("untouched", "sedan", STYLE_CLASS.sedan);
    for (const [state, kinds] of [["loaded", [PART_KIND.interior]], ["headon", [PART_KIND.engineBay, PART_KIND.crashBar]]] as const) {
      const car = carInState(state, "sedan", STYLE_CLASS.sedan);
      car.flushDeferredSkin();
      car.updateSkin();
      assert.ok(moved(car, rest, kinds) > 1e-3, `${state}: the control: the crash moved its seats of kinds ${kinds.join()}`);
      assertSeats(car, `${state} crashed`);
      car.resetVisual();
      assertSeats(car, `${state} refitted`);
    }
  });
});

describe("given a monster truck of its class at rest on flat ground", () => {
  const scene = new THREE.Scene();
  const build = (style: "monster" | "pickup"): DeformableCar => {
    const car = new DeformableCar(paint(), scene, null, style);
    assignClass(car, "monster");
    car.spawn(0, 0, 0);
    car.group.updateMatrixWorld(true);
    return car;
  };
  const monster = build("monster");
  const batch = new PartBatch(1);
  batch.sync([monster]);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();

  test("when the batch syncs, then its frame and both axles draw, and a pickup body on the same lift draws none of them", () => {
    assert.equal(batch.drawn(PART_KIND.ladderFrame), 1);
    assert.equal(batch.drawn(PART_KIND.axle), 2);
    const plain = new PartBatch(1);
    plain.sync([build("pickup")]);
    assert.equal(plain.drawn(PART_KIND.ladderFrame) + plain.drawn(PART_KIND.axle), 0);
  });

  test("when its axles are read, then each sits on its wheels' hubs, at the class's hub height (the drawn tyre's radius)", () => {
    const hub = carFrame(monster.style).rig.tyre.r * CLASSES.monster.wheelScale;
    const w = monster.wheels.map((wheel) => wheel.getWorldPosition(new THREE.Vector3()));
    for (const [k, [a, b]] of [[0, 1], [2, 3]].entries()) {
      batch.kinds[PART_KIND.axle]!.getMatrixAt(k, m);
      v.setFromMatrixPosition(m);
      const mid = w[a!]!.clone().add(w[b!]!).multiplyScalar(0.5);
      assert.ok(v.distanceTo(mid) < 1e-4 && Math.abs(v.y - hub) < 1e-4, `axle ${k} at ${mm(v)}, hubs' midpoint ${mm(mid)}, hub height ${hub.toFixed(3)}`);
    }
  });

  test("when every undercarriage vertex is read through its instance, then none is below the ground", () => {
    let low = Infinity;
    for (const kind of [PART_KIND.ladderFrame, PART_KIND.axle]) {
      const mesh = batch.kinds[kind]!;
      const pos = partGeometry(kind).getAttribute("position");
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, m);
        for (let i = 0; i < pos.count; i++) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(m).y);
      }
    }
    assert.ok(low >= 0, `lowest undercarriage vertex at ${low.toFixed(3)} m`);
  });

  test("when its frame is read in body space, then every vertex over a wheel (the coil-overs and their brackets) stands inside the body side, under the flare", () => {
    const pos = partGeometry(PART_KIND.ladderFrame).getAttribute("position");
    const { radius } = monster.style.arch;
    let worst = -Infinity;
    let at = "";
    for (const wheel of carFrame(monster.style).wheels) {
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (Math.abs(v.z - wheel[2]) > radius) continue;
        const past = Math.abs(v.x) - sampleSlice(v.z, monster.style.profile).hw;
        if (past > worst) [worst, at] = [past, mm(v)];
      }
    }
    assert.ok(worst <= 0, `a frame vertex at ${at} stands ${(worst * 100).toFixed(1)} cm past the body side`);
  });

  test("when each drawn well is looked into from the side at its springs' height, then the first well surface stands inboard of the springs, so they show against it", () => {
    /** The springs' band in body space (m): over the bracket boxes, under the top mount. */
    const SPRING = { low: 0.3, high: 0.6, inboard: 0.5, along: 0.25 } as const;
    const frame = partGeometry(PART_KIND.ladderFrame).getAttribute("position");
    const body = makeChassisGeometry(monster.style);
    const liners = makeWellLiners(monster.style, "drawn", body);
    const look = new THREE.Raycaster();
    for (const [k, wheel] of carFrame(monster.style).wheels.entries()) {
      const side = Math.sign(wheel[0]);
      let spring = Infinity;
      for (let i = 0; i < frame.count; i++) {
        v.fromBufferAttribute(frame, i);
        if (v.x * side < SPRING.inboard || v.y < SPRING.low || v.y > SPRING.high || Math.abs(v.z - wheel[2]) > SPRING.along) continue;
        spring = Math.min(spring, v.x * side);
      }
      look.set(new THREE.Vector3(side * 2, (SPRING.low + SPRING.high) / 2, wheel[2]), new THREE.Vector3(-side, 0, 0));
      const hit = look.intersectObject(new THREE.Mesh(liners[k], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))[0];
      const wall = hit ? hit.point.x * side : -Infinity;
      assert.ok(spring < Infinity && hit && wall < spring, `wheel ${k}: first well surface at |x| ${wall.toFixed(3)}, innermost spring at ${spring.toFixed(3)}`);
    }
  });

  test("when its front-left wheel pops off, then the front axle still draws, its stub on the gone wheel's rest hub where it stood", () => {
    const popped = build("monster");
    const own = new PartBatch(1);
    own.sync([popped]);
    const before = new THREE.Matrix4();
    own.kinds[PART_KIND.axle]!.getMatrixAt(0, before);
    popped["dropWheel"](0, "hubFL");
    popped.group.updateMatrixWorld(true);
    own.sync([popped]);
    assert.ok(popped.wheels[0]!.parent === scene, "the control: the wheel left the car");
    assert.equal(own.drawn(PART_KIND.axle), 2, "both axles draw");
    own.kinds[PART_KIND.axle]!.getMatrixAt(0, m);
    const moved = Math.max(...m.elements.map((e, i) => Math.abs(e - before.elements[i]!)));
    assert.ok(moved < 1e-4, `the front axle moved ${moved.toFixed(5)} off its rest place`);
  });

  test("when its wheels are gone and it lies on its right side, then its axle stubs stand clear of the ground that side lies on", () => {
    const lying = build("monster");
    for (const [i, hub] of (["hubFL", "hubFR", "hubRL", "hubRR"] as const).entries()) lying["dropWheel"](i, hub);
    lying.group.rotation.z = -Math.PI / 2;
    lying.group.position.y = lying.style.dims.width / 2;
    lying.group.updateMatrixWorld(true);
    const own = new PartBatch(1);
    own.sync([lying]);
    const mesh = own.kinds[PART_KIND.axle]!;
    const pos = partGeometry(PART_KIND.axle).getAttribute("position");
    let low = Infinity;
    for (let k = 0; k < mesh.count; k++) {
      mesh.getMatrixAt(k, m);
      for (let i = 0; i < pos.count; i++) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(m).y);
    }
    assert.ok(low >= 0, `lowest axle vertex at ${low.toFixed(3)} m`);
  });
});

describe("given a car whose front bumper is torn off", () => {
  const primer = (car: DeformableCar, verts: Int32Array): number => {
    const a = car.body.geometry.getAttribute(PRIMER_ATTRIBUTE);
    let on = 0;
    for (const v of verts) on += a.getX(v);
    return on;
  };

  test("when it tears, then the body it covered turns dark unpainted inner panel, and a reset paints it again", () => {
    const car = new Probe(paint(), new THREE.Scene(), null, "sedan");
    car.spawn(0, 0, 0);
    const bare = car.part(BUMPER_F).bare!;
    assert.ok(bare.length > 20, `the nose under the bumper: ${bare.length} vertices`);
    assert.equal(primer(car, bare), 0);
    car.tear(BUMPER_F);
    assert.equal(primer(car, bare), bare.length * INNER_PANEL);
    car.resetVisual();
    assert.equal(primer(car, bare), 0);
  });
});

describe("given every style's drawn body and hood", () => {
  test("when their paint is read, then the bay trough's walls and floor and the hood's underside are unpainted inner panel, and nothing else on the deck is", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const body = makeChassisGeometry(style);
      const paintOf = body.getAttribute(PRIMER_ATTRIBUTE);
      const pos = body.getAttribute("position");
      const [zRear, zFront, floor] = bayTub(style);
      const linerTop = carFrame(style).wheels[0]![1] + style.arch.radius;
      let trough = 0;
      let deckOutside = 0;
      for (let v = 0; v < pos.count; v++) {
        if (paintOf.getX(v) !== INNER_PANEL) continue;
        const z = pos.getZ(v);
        if (z > zRear && z < zFront && pos.getY(v) <= floor + 1e-6) trough++;
        if (pos.getY(v) > linerTop + 0.1 && (z < zRear - TUB_EDGE || z > zFront + TUB_EDGE)) deckOutside++;
      }
      assert.ok(trough >= 4, `${id}: ${trough} trough floor vertices unpainted`);
      assert.equal(deckOutside, 0, `${id}: unpainted vertices on the deck outside the bay`);
      const hood = makeHoodGeometry(style).getAttribute(PRIMER_ATTRIBUTE);
      let under = 0;
      for (let v = 0; v < hood.count; v++) if (hood.getX(v) === INNER_PANEL) under++;
      assert.ok(under > 0 && under < hood.count / 2, `${id}: ${under} of ${hood.count} hood vertices unpainted`);
      assert.equal(makeChassisGeometry(style, "cage").getAttribute(PRIMER_ATTRIBUTE).array.every((p) => p === 0), true, `${id}: the cage build is all paint`);
    }
  });


  test("when their paint is read, then every wheel liner vertex and nothing over the wells is toned as the dark well", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const body = makeChassisGeometry(style);
      const paintOf = body.getAttribute(PRIMER_ATTRIBUTE);
      const pos = body.getAttribute("position");
      const linerTop = carFrame(style).wheels[0]![1] + style.arch.radius;
      const key = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, v: number) => `${a.getX(v).toFixed(5)},${a.getY(v).toFixed(5)},${a.getZ(v).toFixed(5)}`;
      const linerAt = new Set<string>();
      for (const liner of makeWellLiners(style, "drawn", body)) {
        const lp = liner.getAttribute("position");
        for (let v = 0; v < lp.count; v++) linerAt.add(key(lp, v));
      }
      let onLiner = 0;
      let painted = 0;
      for (let v = 0; v < pos.count; v++) {
        if (!linerAt.has(key(pos, v))) continue;
        onLiner++;
        if (paintOf.getX(v) !== WELL_PANEL) painted++;
      }
      let over = 0;
      for (let v = 0; v < pos.count; v++) if (paintOf.getX(v) === WELL_PANEL && pos.getY(v) > linerTop + 0.1) over++;
      assert.ok(onLiner > 0, `${id}: no liner vertices found in the body`);
      assert.equal(painted, 0, `${id}: ${painted} of ${onLiner} liner vertices not toned as the well`);
      assert.equal(over, 0, `${id}: well-toned vertices over the wells`);
    }
  });

  test("when a body's cabin tub ends near its engine bay, then a cowl of closed deck at least 5 cm long stands between their blends, not a fin", () => {
    /** The closed deck (m) a cowl keeps between the cabin tub's blend and the bay's. */
    const COWL = 0.05;
    /** The deck crown's height (m) over the belt where no tub opens it (`halfRing`'s ring point 0). */
    const CROWN = 0.012;
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const rear = bayTub(style)[0];
      const front = Math.max(...style.tubs.map(([, b]) => b).filter((b) => b < rear));
      if (!Number.isFinite(front)) continue;
      const body = makeChassisGeometry(style);
      const { ring, slices } = body.userData.loft as { ring: number; slices: number };
      const pos = body.getAttribute("position");
      const closed: number[] = [];
      for (let s = 0; s < slices; s++) {
        const z = pos.getZ(s * ring);
        if (z < front + TUB_EDGE - 1e-6 || z > rear - TUB_EDGE + 1e-6) continue;
        if (Math.abs(pos.getY(s * ring) - (sampleSlice(z, style.profile).yBelt + CROWN)) < 1e-5) closed.push(z);
      }
      const span = closed.length > 0 ? Math.max(...closed) - Math.min(...closed) : -1;
      assert.ok(span >= COWL - 1e-6, `${id}: closed deck between z ${(front + TUB_EDGE).toFixed(3)} and ${(rear - TUB_EDGE).toFixed(3)} spans ${span.toFixed(3)} m over ${closed.length} slices`);
    }
  });

  test("when a drawn hood is laid on its body, then every closed-deck vertex under it stands at least 1 mm under the hood's top (no flap, no z-fight), a clamshell's included", () => {
    /** The least clearance (m) between the hood's top and the deck it covers. */
    const CLEAR = 0.001;
    const clamshell: BodyStyle = { ...CAR_STYLES.wagon, hood: { ...CAR_STYLES.wagon.hood, kind: "clamshell" } };
    const cases: readonly (readonly [string, BodyStyle])[] = [...CAR_STYLE_IDS.map((id) => [id, CAR_STYLES[id]] as const), ["wagon with a clamshell", clamshell]];
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    for (const [id, style] of cases) {
      const body = makeChassisGeometry(style);
      const { ring, slices } = body.userData.loft as { ring: number; slices: number };
      const pos = body.getAttribute("position");
      const hood = new THREE.Mesh(makeHoodGeometry(style));
      hood.position.set(0, style.hood.origin[0], style.hood.origin[1]);
      hood.updateMatrixWorld();
      let read = 0;
      for (let s = 0; s < slices; s++) {
        const z = pos.getZ(s * ring);
        if (z < style.hood.z0 + 1e-3 || z > style.hood.z1 - 1e-3 || bayAt(z, style) > 0) continue;
        for (const point of [0, ring - 1]) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, s * ring + point);
          ray.set(new THREE.Vector3(v.x, v.y + 1, v.z), down);
          const top = ray.intersectObject(hood, false)[0]?.point.y ?? -Infinity;
          assert.ok(top - v.y >= CLEAR, `${id}: the deck at (${mm(v)}) stands ${((top - v.y) * 1000).toFixed(2)} mm under the hood's top`);
          read++;
        }
      }
      assert.ok(read > 0, `${id}: no closed deck under the hood`);
    }
  });

  test("when a drawn hood's edge is read along its length, then it stands 7 mm over the belt at every station, its rear end too (a rigid lid never bends into a cabin tub's blend)", () => {
    /** The fender's closed-deck top (4 mm over the belt) plus the hood's 3 mm seat over it. */
    const EDGE_OVER_BELT = 0.007;
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      if (style.hood.kind === "clamshell") continue;
      const hood = makeHoodGeometry(style);
      // Its deck's rings only: a nose fold (`hood.nose`) turns its edge down the nose's face.
      const { ring } = hood.userData.loft as { ring: number };
      const pos = hood.getAttribute("position");
      const [oy, oz] = style.hood.origin;
      for (let s = 0; s < (hood.userData.deckRings as number); s++) {
        for (const point of [0, hood.userData.lidEdge as number]) {
          const v = new THREE.Vector3().fromBufferAttribute(pos, s * ring + point);
          const over = v.y + oy - sampleSlice(v.z + oz, style.profile).yBelt;
          assert.ok(Math.abs(over - EDGE_OVER_BELT) < 1e-5, `${id}: the hood's edge at z ${(v.z + oz).toFixed(3)} stands ${(over * 1000).toFixed(1)} mm over the belt`);
        }
      }
    }
  });
});

describe("given every style's drawn headliner, the roof skin's inner face", () => {
  /** A vertex within this (m) of the skin's tangent plane is on the skin (a crushed roof clips both faces to one plane). */
  const ON_SKIN = 0.001;
  /**
   * The headliner vertex furthest outside the roof skin: its distance (m) past the skin vertex it is inset from, along the normal
   * of the skin's own triangles there at rest (a crush folds the drip lip over, turning the skin's own facing inside out); and
   * that normal's rise at the skin's crown, so a skin wound inward (the headliner standing over it) cannot pass.
   */
  const furthestOut = (car: DeformableCar): { out: number; at: number; count: number; crownUp: number } => {
    car.flushDeferredSkin();
    car.updateSkin();
    const geo = car.body.geometry;
    const twins: unknown = geo.userData.shellTwins;
    assert.ok(twins instanceof Int32Array, "the drawn body names its headliner's vertices");
    const pos = geo.getAttribute("position");
    const headliner = new Set(Array.from({ length: twins.length / 2 }, (_, k) => twins[2 * k]!));
    const all = geo.getIndex()!.array;
    const skinTris: number[] = [];
    for (let t = 0; t < all.length; t += 3) if (!headliner.has(all[t]!) && !headliner.has(all[t + 1]!) && !headliner.has(all[t + 2]!)) skinTris.push(all[t]!, all[t + 1]!, all[t + 2]!);
    const restSkin = new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(car.deform.restSkin, 3)).setIndex(skinTris);
    restSkin.computeVertexNormals();
    const normal = restSkin.getAttribute("normal");
    const step = new THREE.Vector3();
    const n = new THREE.Vector3();
    let worst = { out: -Infinity, at: -1 };
    let crown = twins[1]!;
    for (let k = 0; k < twins.length; k += 2) {
      step.fromBufferAttribute(pos, twins[k]!).sub(n.fromBufferAttribute(pos, twins[k + 1]!));
      const out = step.dot(n.fromBufferAttribute(normal, twins[k + 1]!));
      if (out > worst.out) worst = { out, at: twins[k]! };
      if (car.deform.restSkin[twins[k + 1]! * 3 + 1]! > car.deform.restSkin[crown * 3 + 1]!) crown = twins[k + 1]!;
    }
    return { ...worst, count: twins.length / 2, crownUp: normal.getY(crown) };
  };

  for (const state of ["untouched", "loaded", "rolled"] as const) {
    test(`when ${state}, then no headliner vertex stands outside the roof skin`, () => {
      for (const id of CAR_STYLE_IDS) {
        const { out, at, count, crownUp } = furthestOut(carInState(state, id, STYLE_CLASS[id]));
        assert.ok(count >= 3 * 13, `${id}: ${count} headliner vertices`);
        assert.ok(crownUp > 0.9, `${id}: the roof skin faces ${crownUp.toFixed(2)} up at its crown`);
        assert.ok(out <= ON_SKIN, `${id} ${state}: headliner vertex ${at} stands ${(out * 1000).toFixed(1)} mm outside the roof skin`);
      }
    });
  }

  test("when every style's roof is drawn, then each headliner vertex is paired with the skin vertex it is inset from: within 1 cm of it, at its z, end caps included", () => {
    for (const id of CAR_STYLE_IDS) {
      const geo = makeRoofGeometry(CAR_STYLES[id]);
      const twins: unknown = geo.userData.shellTwins;
      assert.ok(twins instanceof Int32Array && twins.length > 0, `${id}: the drawn roof names its headliner's vertices`);
      const pos = geo.getAttribute("position");
      const [head, skin] = [new THREE.Vector3(), new THREE.Vector3()];
      for (let k = 0; k < twins.length; k += 2) {
        head.fromBufferAttribute(pos, twins[k]!);
        skin.fromBufferAttribute(pos, twins[k + 1]!);
        assert.ok(head.distanceTo(skin) < 0.01 && head.z === skin.z, `${id}: headliner vertex ${twins[k]} at ${mm(head)} paired with skin vertex ${twins[k + 1]} at ${mm(skin)}`);
      }
    }
  });
});

describe("given the door cards", () => {
  test("when their boxes are read, then each is the first lining's box exactly: a torn door flies with the same loose box", () => {
    for (const sign of [-1, 1]) {
      const lining = new THREE.BoxGeometry(0.018, 0.5, 0.52).translate(-sign * 0.024, 0, -0.28);
      lining.computeBoundingBox();
      const card = doorCardGeometry(sign);
      card.computeBoundingBox();
      const box = (b: THREE.Box3): string => [...b.min.toArray(), ...b.max.toArray()].join();
      assert.equal(box(card.boundingBox!), box(lining.boundingBox!), `side ${sign}`);
    }
  });
});

describe("given every style's cabin as its glass shows it", () => {
  test("when the drawn body and doors are read, then the headliner, the cabin tub's floor corners away from its blends, and each door's flat inner face are dark cabin trim, not body paint or bare steel", () => {
    for (const id of CAR_STYLE_IDS) {
      const style = CAR_STYLES[id];
      const body = makeChassisGeometry(style);
      const primer = body.getAttribute(PRIMER_ATTRIBUTE);
      const pos = body.getAttribute("position");
      const twins = body.userData.shellTwins as Int32Array;
      for (let k = 0; k < twins.length; k += 2) assert.equal(primer.getX(twins[k]!), CABIN_TRIM, `${id}: headliner vertex ${twins[k]}`);
      const { ring, slices } = body.userData.loft as { ring: number; slices: number };
      const [zRear, zFront] = style.tubs[0]!;
      let floor = 0;
      for (let s = 0; s < slices; s++) {
        const z = pos.getZ(s * ring);
        if (z < zRear + 2 * TUB_EDGE || z > zFront - 2 * TUB_EDGE || bayAt(z, style) > 0) continue;
        for (const i of [0, ring - 1]) assert.equal(primer.getX(s * ring + i), CABIN_TRIM, `${id}: cabin floor corner at z ${z.toFixed(3)}, ring point ${i}`);
        floor++;
      }
      assert.ok(floor >= 4, `${id}: ${floor} cabin floor slices read`);
      for (const sign of [-1, 1]) {
        const door = makeDoorGeometry(sign, style);
        const [doorPrimer, normal] = [door.getAttribute(PRIMER_ATTRIBUTE), door.getAttribute("normal")];
        let inner = 0;
        for (let v = 0; v < normal.count; v++) {
          if (sign * normal.getX(v) > -0.99) continue;
          inner++;
          assert.equal(doorPrimer?.getX(v), CABIN_TRIM, `${id} door ${sign}: inner-face vertex ${v}`);
        }
        assert.ok(inner > 0, `${id} door ${sign}: an inner face`);
      }
    }
  });

  /** A drawn interior point may stand this far (m) past a pane or the roof line before it shows through: the glass's own thickness. */
  const THROUGH_M = 0.005;

  /** The z of the pane line from `base` to `top` ([y, z] each) at height `y`. */
  const paneZ = (y: number, [y0, z0]: readonly [number, number], [y1, z1]: readonly [number, number]): number => z0 + ((y - y0) / (y1 - y0)) * (z1 - z0);
  for (const id of CAR_STYLE_IDS) {
    test(`when a ${id}'s cabin is built, then no point of its shell, seats, bench or wheel stands over the roof line or through the side glass, the windshield or the rear glass`, () => {
      const style = CAR_STYLES[id];
      const seats = carPartSeats();
      new CarCabin(style, seats, new THREE.Group());
      const kinds = new Set<number>([PART_KIND.interior, PART_KIND.seatFront, PART_KIND.seatRear, PART_KIND.wheel]);
      const through: string[] = [];
      const [ws, wsTop, rg] = [style.windshield.base, style.windshieldTop, style.rearGlass];
      for (const seat of seats) {
        if (!kinds.has(seat.kind) || seat.parent === null) continue;
        seat.updateMatrix();
        const pos = seat.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(seat.matrix);
          const at = `kind ${seat.kind} at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
          if (p.z >= style.roofZ[0] && p.z <= style.roofZ[1] && p.y > roofAt(p.z, style).y + THROUGH_M) through.push(`over the roof line: ${at}`);
          if (p.y > beltY(p.z, style) && Math.abs(p.x) > glassX(p.z, p.y, style) + THROUGH_M) through.push(`through the side glass: ${at}`);
          if (p.y > ws[0] && p.y < wsTop[0] && p.z > paneZ(p.y, ws, wsTop) + THROUGH_M) through.push(`through the windshield: ${at}`);
          if (p.y > rg.base[0] && p.y < rg.top[0] && p.z < paneZ(p.y, rg.base, rg.top) - THROUGH_M) through.push(`through the rear glass: ${at}`);
        }
      }
      assert.equal(through.length, 0, `${id}: ${through.length} interior points outside the greenhouse, e.g. ${through.slice(0, 3).join("; ")}`);
    });
  }
});
