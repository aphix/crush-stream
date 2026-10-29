import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { DeformableCar } from "../vehicle/car.ts";
import { INTERIOR_MESH, SMALL_PART_SEAT, UNDERBODY_SEAT } from "../vehicle/constants.ts";
import { BEHIND_GLASS, PART_KIND, type PartSeat } from "../vehicle/part-geometry.ts";
import { PartBatch } from "../vehicle/part-batch.ts";
import { paint } from "../vehicle/test-support.ts";
import { CarDetail, DETAIL_LEVELS, PHONE_LEVEL } from "./car-detail.ts";

/** A 50 degree lens at the origin looking down +z; cars stand on the axis at the given distance. */
function stage(fov = 50): { camera: THREE.PerspectiveCamera; detail: CarDetail; car(at: number, style?: CarStyleId): DeformableCar } {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 2, 0.1, 900);
  camera.lookAt(0, 0, 1);
  camera.updateMatrixWorld(true);
  return {
    camera,
    detail: new CarDetail(),
    car: (at, style = "sedan") => {
      const car = new DeformableCar(paint(), scene, null, style);
      car.spawn(0, at, 0);
      car.group.updateMatrixWorld(true);
      return car;
    },
  };
}

/** The meshes the camera would draw of the car's own group: on the camera's layers, no hidden ancestor (the rig overlay is hidden). */
function drawn(car: DeformableCar, camera: THREE.Camera): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  car.group.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh || !o.layers.test(camera.layers)) return;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return;
    out.push(o as THREE.Mesh);
  });
  return out;
}

const casters = (meshes: readonly THREE.Mesh[]): number => meshes.filter((m) => m.castShadow).length;

describe("given a car and the farthest rung (small parts beyond 35 m, only the body beyond 75 m) on a 50 degree lens", () => {
  const cases: { at: number; what: "everything" | "its casters and fewer others" | "the body alone" }[] = [
    { at: 20, what: "everything" },
    { at: 34, what: "everything" },
    { at: 40, what: "its casters and fewer others" },
    { at: 70, what: "its casters and fewer others" },
    { at: 80, what: "the body alone" },
    { at: 250, what: "the body alone" },
  ];
  for (const c of cases) {
    test(`when it stands ${c.at} m away, then the camera draws ${c.what}`, () => {
      const { camera, detail, car } = stage();
      const full = drawn(car(1), camera);
      const probe = car(c.at);
      detail.update([probe], camera, null, null);
      const meshes = drawn(probe, camera);
      if (c.what === "everything") expect(meshes.length).toBe(full.length);
      else if (c.what === "its casters and fewer others") {
        expect(casters(meshes)).toBe(casters(full));
        expect(meshes.length, `${meshes.length} of ${full.length} meshes`).toBeLessThan(full.length);
      } else {
        expect(meshes.length).toBe(1);
        expect(meshes[0]).toBe(probe.body);
      }
    });
  }

  test("when it stands 60 m away, undamaged, then the camera still draws its hood, boot lid, doors and bumpers although they cast no shadow", () => {
    const { camera, detail, car } = stage();
    const probe = car(60);
    detail.update([probe], camera, null, null);
    const meshes = drawn(probe, camera);
    expect(casters(meshes), "nothing of its own drawn casts: its flush shadow is the style's batched caster").toBe(0);
    const batch = new PartBatch(1);
    batch.sync([probe]);
    expect(batch.casters.reduce((n, m) => n + m.count, 0), "its shadow caster stays in the batch").toBe(1);
    for (const part of probe.flushCasters) expect(meshes.includes(part), "a flush part left the camera").toBeTruthy();
  });
});

describe("given a car 100 m away", () => {
  test("when it is the camera's car, or the replay's focus, then it keeps full detail while another car there does not", () => {
    const { camera, detail, car } = stage();
    const a = car(100);
    const b = car(100);
    const other = car(100);
    const full = drawn(car(1), camera).length;
    detail.update([a, b, other], camera, a, b);
    expect(drawn(a, camera).length).toBe(full);
    expect(drawn(b, camera).length).toBe(full);
    expect(drawn(other, camera).length).toBe(1);
  });

  test("when the lens narrows to 25 degrees (a zoom), then the car counts as 55 m away: the near cut and not the far one", () => {
    const { camera, detail, car } = stage(25);
    const probe = car(120);
    const full = drawn(car(1), camera);
    detail.update([probe], camera, null, null);
    const meshes = drawn(probe, camera);
    expect(casters(meshes), "every caster still drawn").toBe(casters(full));
    expect(meshes.length, "small parts out").toBeLessThan(full.length);
  });

  test("when it is a wreck (a hood torn off, a door folding), then the far cut takes it too: the body alone, while the torn hood flies in view", () => {
    const { camera, detail, car } = stage();
    const probe = car(100);
    const hood = probe["parts"].find((p) => p.name === "hood")!;
    probe["detachPart"](hood, 10);
    probe["parts"].find((p) => p.name === "doorL")!.folding = true;
    detail.update([probe], camera, null, null);
    const meshes = drawn(probe, camera);
    expect(meshes.length).toBe(1);
    expect(meshes[0]).toBe(probe.body);
    let loose = 0;
    hood.object.traverse((o) => void ((o as THREE.Mesh).isMesh && o.layers.test(camera.layers) && loose++));
    expect(loose, "the loose hood is not the car's mesh: it keeps drawing").toBeGreaterThanOrEqual(1);
  });

  test("when a hood tears off a car already in the far cut, then its meshes are drawn on that same frame, flying in view", () => {
    const { camera, detail, car } = stage();
    const probe = car(100);
    detail.update([probe], camera, null, null);
    const hood = probe["parts"].find((p) => p.name === "hood")!;
    const visible = (): number => {
      let n = 0;
      hood.object.traverse((o) => void ((o as THREE.Mesh).isMesh && o.layers.test(camera.layers) && n++));
      return n;
    };
    expect(visible(), "a whole hood is not drawn at 100 m").toBe(0);
    probe["detachPart"](hood, 10);
    expect(visible(), "the torn hood is the world's: drawn at once, before the next update").toBeGreaterThanOrEqual(1);
    detail.update([probe], camera, null, null);
    expect(visible(), "and the next update leaves it be").toBeGreaterThanOrEqual(1);
    expect(drawn(probe, camera).length, "the car itself stays the body alone").toBe(1);
  });

  test("when it is a police car, then the light bar stays drawn with the body", () => {
    const { camera, detail, car } = stage();
    const probe = car(100, "police");
    detail.update([probe], camera, null, null);
    const names = drawn(probe, camera).map((m) => m.name);
    expect(names.length).toBe(2);
    expect(names.includes("lightBar")).toBeTruthy();
  });

  test("when it is a lifted monster truck past the far cut, then the batch still draws its ladder frame and both axles under the body; a sedan there has none", () => {
    const { camera, detail, car } = stage();
    const monster = car(100, "monster");
    const sedan = car(100);
    detail.update([monster, sedan], camera, null, null);
    expect(drawn(monster, camera).length, "the far cut is in force: the body alone").toBe(1);
    const batch = new PartBatch(2);
    batch.sync([monster, sedan]);
    expect(batch.drawn(PART_KIND.ladderFrame), "the frame the lifted body stands on").toBe(1);
    expect(batch.drawn(PART_KIND.axle), "front and rear axle between the wheels").toBe(2);
    expect(batch.drawn(PART_KIND.crashBar), "the small parts stay cut").toBe(0);
  });
});

describe("given a car that crosses the far distance", () => {
  test("when it approaches from 80 m, then it is whole again at 69 m (92 % of 75), not before; and it goes far again only past 75 m", () => {
    const { camera, detail, car } = stage();
    const probe = car(80);
    const isFar = (): boolean => drawn(probe, camera).length === 1;
    const stepTo = (at: number): boolean => {
      probe.group.position.z = at;
      probe.group.updateMatrixWorld(true);
      detail.update([probe], camera, null, null);
      return isFar();
    };
    expect(stepTo(80)).toBe(true);
    expect(stepTo(72), "inside 75 m but not yet inside 69 m").toBe(true);
    expect(stepTo(68), "inside 69 m: the small parts are still out (mid cut) but the body is not alone").toBe(false);
    expect(stepTo(74), "75 m not yet crossed again").toBe(false);
    expect(stepTo(76)).toBe(true);
  });

  test("when it has been far and comes back to 10 m, then every mesh it had is drawn again", () => {
    const { camera, detail, car } = stage();
    const probe = car(1);
    const full = drawn(probe, camera).length;
    probe.group.position.z = 150;
    detail.update([probe], camera, null, null);
    expect(drawn(probe, camera).length).toBe(1);
    probe.group.position.z = 10;
    detail.update([probe], camera, null, null);
    expect(drawn(probe, camera).length).toBe(full);
  });

  test("when it comes from the far cut to between the two, then the small parts stay out and the rest returns: 40 m draws the same meshes whether it arrived from 150 m or from 20 m", () => {
    const { camera, detail, car } = stage();
    const fromFar = car(150);
    const fromNear = car(20);
    detail.update([fromFar, fromNear], camera, null, null);
    for (const probe of [fromFar, fromNear]) probe.group.position.z = 40;
    fromFar.group.updateMatrixWorld(true);
    fromNear.group.updateMatrixWorld(true);
    detail.update([fromFar, fromNear], camera, null, null);
    const arrived = drawn(fromFar, camera).length;
    expect(arrived).toBe(drawn(fromNear, camera).length);
    expect(arrived, "more than the body").toBeGreaterThan(1);
  });
});

describe("given a car's batched part seats", () => {
  const enabled = (seats: readonly PartSeat[]): boolean[] => seats.map((s) => s.layers.isEnabled(0));

  test("when a car goes past the mid distance, then the small seats and the kit behind the glass leave layer 0 and the cabin and bay stay; past the far distance they go too; back at 10 m, all are on again", () => {
    const { camera, detail, car } = stage();
    const probe = car(10, "monster");
    const interior = probe.partSeats.filter((s) => s.name === INTERIOR_MESH);
    const small = probe.partSeats.filter((s) => s.name === SMALL_PART_SEAT);
    const under = probe.partSeats.filter((s) => s.name === UNDERBODY_SEAT);
    expect(interior.map((s) => s.kind).join(), "the cabin, both front seats, the rear bench, the wheel and the bay go with the far cut").toBe([PART_KIND.interior, PART_KIND.seatFront, PART_KIND.seatRear, PART_KIND.wheel, PART_KIND.engineBay, PART_KIND.seatFront].join());
    expect(under.map((s) => s.kind).join(), "a lifted truck's frame and two axles are the undercarriage seats no cut takes").toBe([PART_KIND.ladderFrame, PART_KIND.axle, PART_KIND.axle].join());
    expect(small.length + interior.length + under.length, "every seat is one of the three").toBe(probe.partSeats.length);
    expect(small.length, "door cards, mirrors, grille, tail trim, the two crash bars and the wipers are the small-part seats the mid cut takes by name").toBe(9);
    const move = (at: number): void => {
      probe.group.position.z = at;
      probe.group.updateMatrixWorld(true);
      detail.update([probe], camera, null, null);
    };
    move(10);
    expect(enabled(small).every(Boolean) && enabled(interior).every(Boolean), "whole at 10 m").toBeTruthy();
    move(50);
    expect(enabled(small).every((on) => !on), "the small seats are cut at 50 m").toBeTruthy();
    const glass = interior.filter((s) => BEHIND_GLASS.has(s.kind));
    expect(glass.map((s) => s.kind).join(), "the front seats, the bench and the wheel are seen through the glass").toBe([PART_KIND.seatFront, PART_KIND.seatRear, PART_KIND.wheel, PART_KIND.seatFront].join());
    expect(enabled(glass).every((on) => !on), "the kit behind the glass goes with it at 50 m").toBeTruthy();
    expect(enabled(interior.filter((s) => !glass.includes(s))).every(Boolean), "the cabin and the bay stay until the far cut").toBeTruthy();
    move(80);
    expect(enabled(interior).every((on) => !on), "the far cut takes the interior kit").toBeTruthy();
    expect(enabled(small).every((on) => !on)).toBeTruthy();
    expect(enabled(under).every(Boolean), "the undercarriage is never cut").toBeTruthy();
    move(10);
    expect(enabled(small).every(Boolean) && enabled(interior).every(Boolean), "give puts them all back").toBeTruthy();
  });
});

describe("given the detail ladder", () => {
  test("when the rungs are read, then each is nearer than the one before and its small-parts distance is inside its far distance", () => {
    for (let i = 0; i < DETAIL_LEVELS.length; i++) {
      const l = DETAIL_LEVELS[i]!;
      expect(l.mid, `rung ${i}`).toBeLessThan(l.far);
      if (i > 0) {
        expect(l.mid, `rung ${i} small parts nearer`).toBeLessThan(DETAIL_LEVELS[i - 1]!.mid);
        expect(l.far, `rung ${i} far nearer`).toBeLessThan(DETAIL_LEVELS[i - 1]!.far);
      }
    }
    expect(PHONE_LEVEL >= 0 && PHONE_LEVEL < DETAIL_LEVELS.length).toBeTruthy();
    expect(DETAIL_LEVELS[0]!.far).toBe(75);
  });

  test("when the phone's rung is in force, then a car 55 m away draws the body alone and one 45 m away does not; and with no cuts at all, a car 500 m away is whole", () => {
    const { camera, car } = stage();
    const detail = new CarDetail(PHONE_LEVEL);
    expect(detail.level).toBe(PHONE_LEVEL);
    const far = car(55);
    const mid = car(45);
    detail.update([far, mid], camera, null, null);
    expect(drawn(far, camera).length).toBe(1);
    expect(drawn(mid, camera).length).toBeGreaterThan(1);
    detail.setDistances(Infinity, Infinity);
    expect(detail.level).toBe(-1);
    detail.update([far, mid], camera, null, null);
    const full = drawn(car(1), camera).length;
    expect(drawn(far, camera).length).toBe(full);
    expect(drawn(mid, camera).length).toBe(full);
    detail.setLevel(99);
    expect(detail.level).toBe(DETAIL_LEVELS.length - 1);
  });
});
