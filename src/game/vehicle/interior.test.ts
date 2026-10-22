import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { BUMPER_F, INNER_PANEL, LID, PRIMER_ATTRIBUTE } from "./constants.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { makeHoodGeometry, TUB_EDGE } from "./car-mesh.ts";
import { carFrame } from "./car-rig.ts";
import { bayTub, doorCardGeometry } from "./interior-geometry.ts";
import { CarCabin } from "./interior.ts";
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
  const own: BodyStyle = { ...CAR_STYLES.sedan, seats: { front: [-0.41, 0.47, -0.08], rear: [0.5, -0.5] } };
  const build = (style: BodyStyle) => {
    const seats = carPartSeats();
    new CarCabin(style, seats, new THREE.Group());
    const of = (kind: number): PartSeat[] => seats.filter((s) => s.kind === kind);
    return { front: of(PART_KIND.seatFront), rear: of(PART_KIND.seatRear)[0]! };
  };

  test("when its cabin is built, then the driver's seat stands on its H-point, the passenger's mirrors it and the rear bench is on its row", () => {
    const { front, rear } = build(own);
    assert.equal(mm(front[0]!.position), "-0.410,0.470,-0.080");
    assert.equal(mm(front[1]!.position), "0.410,0.470,-0.080");
    assert.equal(mm(rear.position), "0.000,0.500,-0.500");
    assert.ok(rear.parent !== null, "the bench is in the cabin");
  });

  test("when it has no rear row, then no bench is placed in its cabin", () => {
    const { rear } = build({ ...own, seats: { ...own.seats, rear: null } });
    assert.equal(rear.parent, null);
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
    return Object.fromEntries(PART_KINDS.map((k) => [k, batch.meshes[k]!.count]));
  };
  const rows = CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].seats.rear !== null).length;
  const lifted = CAR_STYLE_IDS.filter((id) => CAR_STYLES[id].underbody).length;

  test("when the batch syncs, then each prop kind is one instanced draw holding the whole field's seats, and nothing under the hood or bumpers shows", () => {
    const counts = draw();
    assert.equal(batch.meshes.length, PART_KINDS.length, "one mesh per kind");
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
    assert.equal(batch.meshes[PART_KIND.ladderFrame]!.count, 1);
    assert.equal(batch.meshes[PART_KIND.axle]!.count, 2);
    const plain = new PartBatch(1);
    plain.sync([build("pickup")]);
    assert.equal(plain.meshes[PART_KIND.ladderFrame]!.count + plain.meshes[PART_KIND.axle]!.count, 0);
  });

  test("when its axles are read, then each sits on its wheels' hubs, at the class's hub height (the drawn tyre's radius)", () => {
    const hub = carFrame(monster.style).rig.tyre.r * CLASSES.monster.wheelScale;
    const w = monster.wheels.map((wheel) => wheel.getWorldPosition(new THREE.Vector3()));
    for (const [k, [a, b]] of [[0, 1], [2, 3]].entries()) {
      batch.meshes[PART_KIND.axle]!.getMatrixAt(k, m);
      v.setFromMatrixPosition(m);
      const mid = w[a!]!.clone().add(w[b!]!).multiplyScalar(0.5);
      assert.ok(v.distanceTo(mid) < 1e-4 && Math.abs(v.y - hub) < 1e-4, `axle ${k} at ${mm(v)}, hubs' midpoint ${mm(mid)}, hub height ${hub.toFixed(3)}`);
    }
  });

  test("when every undercarriage vertex is read through its instance, then none is below the ground", () => {
    let low = Infinity;
    for (const kind of [PART_KIND.ladderFrame, PART_KIND.axle]) {
      const mesh = batch.meshes[kind]!;
      const pos = partGeometry(kind).getAttribute("position");
      for (let k = 0; k < mesh.count; k++) {
        mesh.getMatrixAt(k, m);
        for (let i = 0; i < pos.count; i++) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(m).y);
      }
    }
    assert.ok(low >= 0, `lowest undercarriage vertex at ${low.toFixed(3)} m`);
  });

  test("when its front-left wheel pops off, then the front axle still draws, its stub on the gone wheel's rest hub where it stood", () => {
    const popped = build("monster");
    const own = new PartBatch(1);
    own.sync([popped]);
    const before = new THREE.Matrix4();
    own.meshes[PART_KIND.axle]!.getMatrixAt(0, before);
    popped["dropWheel"](0, "hubFL");
    popped.group.updateMatrixWorld(true);
    own.sync([popped]);
    assert.ok(popped.wheels[0]!.parent === scene, "the control: the wheel left the car");
    assert.equal(own.meshes[PART_KIND.axle]!.count, 2, "both axles draw");
    own.meshes[PART_KIND.axle]!.getMatrixAt(0, m);
    const moved = Math.max(...m.elements.map((e, i) => Math.abs(e - before.elements[i]!)));
    assert.ok(moved < 1e-4, `the front axle moved ${moved.toFixed(5)} off its rest place`);
  });
});

describe("given a car whose front bumper is torn off", () => {
  const primer = (car: DeformableCar, verts: Int32Array): number => {
    const a = car.body.geometry.getAttribute(PRIMER_ATTRIBUTE);
    let on = 0;
    for (const v of verts) on += a.getX(v);
    return on;
  };

  test("when it tears, then the body it covered turns bare metal, and a reset paints it again", () => {
    const car = new Probe(paint(), new THREE.Scene(), null, "sedan");
    car.spawn(0, 0, 0);
    const bare = car.part(BUMPER_F).bare!;
    assert.ok(bare.length > 20, `the nose under the bumper: ${bare.length} vertices`);
    assert.equal(primer(car, bare), 0);
    car.tear(BUMPER_F);
    assert.equal(primer(car, bare), bare.length);
    car.resetVisual();
    assert.equal(primer(car, bare), 0);
  });
});

describe("given every style's drawn body and hood", () => {
  test("when their paint is read, then the bay trough's walls and floor, the wheel liners and the hood's underside are unpainted inner panel, and nothing else on the deck is", () => {
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
