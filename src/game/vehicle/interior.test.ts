import assert from "node:assert/strict";
import { describe, test } from "node:test";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";
import { BUMPER_F, LID, PRIMER_ATTRIBUTE } from "./constants.ts";
import { doorCardGeometry } from "./interior-geometry.ts";
import { CarCabin } from "./interior.ts";
import { PartBatch } from "./part-batch.ts";
import { carPartSeats, PART_KIND, PART_KINDS, type PartSeat } from "./part-geometry.ts";
import { paint } from "./test-support.ts";

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
