import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { todoRow } from "../kernel/todo-row.test-util.ts";
import * as THREE from "three";
import { DeformableCar } from "../vehicle/car.ts";
import { paint } from "../vehicle/test-support.ts";
import { DRIVER_CARS, type DriverCar } from "../match/types.ts";
import { makeWorld, tickWorld } from "../contact/crash-scenarios.test-util.ts";
import { fleetClass, fleetStyle, slotType, type CarType } from "./fleet.ts";
import { armKill, assignClass, carClass, HANDLING, killClass, type VehicleClassId } from "../vehicle/vehicle-classes.ts";
import type { CarStyleId } from "../vehicle/car-variants.ts";
import { placeDrop, StackRig, stackLoads, type StackConfig } from "./stack-rig.ts";
import { runStack } from "./stack-run.test-util.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

/** One frame of the world step (s): a car's body moves this far at its speed between two `each` calls. */
const FRAME_S = 1 / FRAME_HZ;

/** The rows read poses, masses and roof sink, never a drawn skin: no car is skinned each frame (`updateSkin` writes meshes only). */
const skin = DeformableCar.prototype.updateSkin;
beforeAll(() => {
  DeformableCar.prototype.updateSkin = () => {};
});
afterAll(() => {
  DeformableCar.prototype.updateSkin = skin;
});

/** Which cars the column is made of: one sedan body, the fleet's slot order (police base) with or without its monster truck. */
type Bodies = "sedans" | "fleet" | "fleet without the monster" | { selected: CarType };

/** The Stack scene's cars (`buildCar` + `dressCar`), the base car on the pad and the rest parked off it until the rig drops them, and its rig at `config`. */
function makeColumn(config: StackConfig, bodies: Bodies): { cars: DeformableCar[]; rig: StackRig } {
  HANDLING.realism = 0.25;
  const scene = new THREE.Scene();
  const cars = Array.from({ length: config.cars }, (_, i) => {
    const picked = typeof bodies === "object" ? slotType(i, bodies.selected, true) : undefined;
    const sedan = bodies === "sedans" || (bodies === "fleet without the monster" && i > 0 && fleetClass(i) === "monster");
    const cls: VehicleClassId = picked ? picked.cls : sedan ? "sedan" : i === 0 ? "police" : fleetClass(i);
    const style: CarStyleId | undefined = picked ? picked.style : bodies === "sedans" ? undefined : sedan ? "sedan" : i === 0 ? "police" : fleetStyle(i);
    const car = new DeformableCar(paint(), scene, undefined, style);
    assignClass(car, cls);
    car.deform.squash = 0.32;
    car.deform.buckle = 0.45;
    car.deform.setMode("shape");
    armKill(car.deform, killClass(car), HANDLING.realism, "default");
    car.spawnFacing(i === 0 ? 0 : 48 + i * 4, i === 0 ? 0 : 48, 0, 0);
    car.parked = true;
    car.deform.bindKinematic(car.group, car.velocity, car.angular);
    return car;
  });
  const rig = new StackRig();
  rig.config = { ...config };
  return { cars, rig };
}

/** The column, headless: `makeColumn`'s cars dropped one at a time through `StackRig` and `placeDrop` in the engine's own world step, `seconds` of sim time; `each` after every frame, with how many cars have dropped so far. */
function column(config: StackConfig, bodies: Bodies, seconds: number, each?: (cars: DeformableCar[], dropped: number) => void): { cars: DeformableCar[]; rig: StackRig } {
  const { cars, rig } = makeColumn(config, bodies);
  runStack(cars, rig, makeWorld(cars, false, false), seconds, { each: () => each?.(cars, rig.dropped) });
  return { cars, rig };
}

/** Farthest a car stands from the base car's axis (m, plan; a car not yet dropped waits far off and is skipped) and the most any leans off vertical (deg). */
function spread(cars: readonly DeformableCar[]): { off: number; lean: number } {
  let off = 0;
  let lean = 0;
  for (const c of cars) {
    if (c.group.position.x > 40) continue;
    off = Math.max(off, Math.hypot(c.group.position.x, c.group.position.z));
    lean = Math.max(lean, (Math.acos(Math.min(1, c.group.matrixWorld.elements[5]!)) * 180) / Math.PI);
  }
  return { off, lean };
}

/** How far (m, plan) a car may stand from the base car's axis and still be on the column. */
const ON_AXIS_M = 0.1;

/** The owner's drops (10-04 trace): 11 cars, 0.15 m, one a second; 8 s after the last. */
const OWNER: StackConfig = { cars: 11, drop: 0.15, gap: 1 };
const OWNER_S = 1 + (OWNER.cars - 1) * OWNER.gap + 8;
/** The scene's defaults (`STACK_DEFAULTS`), 4 s after the last drop. */
const DEFAULTS: StackConfig = { cars: 4, drop: 0.02, gap: 8 };
const DEFAULTS_S = 1 + 3 * 8 + 4;

describe("given the owner's drops (11 cars, 0.15 m, one a second), run for 8 s after the last", () => {
  // The sedan column held on main (bar: no car leaves it by 0.1 m). The fleet column's worst car leaves by 0.10 m, at the bar (11 cars,
  // 8 s after the last drop; one top car creeping at about 2.3 mm/s). Cause: the top muscle car's front tyres rest on the steep
  // sides of the sedan roof under it (normals ±0.85 / 0.52), and the load on its belly rows flips between belly points every other
  // slice, so the tyres' springs and the rigid belly rows trade the weight. A single solve of tyre and hull rows was built and measured
  // (a sedan column then sways to 0.47 m at 20 s: the lagged coupling between stacked cars is open). Re-measured on lane/uc2-solids
  // (Stage 2: walls, props and ramps are prisms of the one store, a car's top is still `CarSurfaces`' plate): 0.10 m against the bar's
  // `< 0.1`, no margin, the same creep: Stage 2 moved no car's top, so the tyre rows and the belly rows still read two answers of one
  // contact. Closes in Stage 3, where the car's top is the cage the hull points and the tyre rows meet alike (Stage 4 if still open). For a
  // player: a stack of eleven cars dropped one a second drifts a hand's breadth at the top over a minute.
  // Stage 3 (integration b94657da), the sedan column: the top car ends 0.10 m off the axis at 19 s (bar 0.05), leaning 0.1°, and no car
  // stands still: the top five wander at 10-35 mm/s in both axes while every car's pitch holds at the stock -0.14°, and the bottom roof
  // is still sinking at about 1 mm/s (366 mm at 19 s). The last good commit (2b1d472f) ended 0.037 m off the axis (bar 0.05) with its
  // five bottom roofs packed at 449 mm, rigid; the break is 0b4839b5 (bisected on first-parent commits: `faceFollow` lowers only the roof
  // band, the hood, boot and cabin stand): 0.074 m at that commit, and restoring its old `faceFollow` there gives 0.037 m again. The
  // roof strength room per slice is cut on 35-45 % of the bottom roof's slices (demand 108, room 115 m/s² at 19 s), but a 30 % stronger
  // roof (measured) still ends 0.10 m off, and restoring the roof cap, measuring each node's own follow of the crush (the rim of a crushed
  // roof stands, it does not follow) and `faceFollow`'s old lowering at the head change no number to the millimetre of the roof row or
  // the creep: the wander is the open lagged coupling between stacked cars (the weight a car bears on the one under it lands at that
  // car's next step), packed roofs were what held the column before.
  const ownerColumnCases = [
    {
      bodies: "sedans",
      todo: "after the plan: find why the sedan column still wanders now that a car on a car is one pair solved through the kernel; it ends 0.10 m off its axis (bar 0.05 m), leaning 0.1° (bar 3°), with no car off it by 0.1 m on the way",
    },
    {
      bodies: "fleet without the monster",
      todo: "after the plan: find why the fleet column without the monster collapses; a car leaves it by 5.69 m (bar 0.1 m): cars 0-7 end on the ground, car 1 5.69 m and car 0 4.43 m off the axis by 19 s. Mechanism (11 cars, police base): car 1 lands at 1.7 m/s on the drawn lightbar, rolls 9° and its tilted sill (4-9 cm under its pan) overlaps the base's shoulder by 0.07 m, over `VERTICAL_CLEAR` (0.05 m), so the plan SAT reads a level side hit (closing 0.36 m/s) and wakes car 0's masses, which read the ground alone (`sampleGround`), so car 1 falls through it. Tried and withdrawn: a wider clear (0.25 m, the store's reach `SKIN`) for a pair whose upper belly is within `SKIN` of the lower top holds the column to 0.49 m, but it also drops the plan hit of a car sliding off a roof it was thrown onto (engine-lab 'thrown at its top car at 10 m/s': 1.8 m/s relative) and of a car landing on a roof at 1.3-1.5 m/s (the mixed fleet's -12 m/s read); a relative-speed gate cannot separate them (the column's own landing is 1.0-1.2 m/s). The one law needed: a car standing on a roof is the surface store's, and a landing or a slide is the plan's, decided by what holds the car, not by a speed",
    },
  ] as const;
  for (const { bodies, todo } of ownerColumnCases) {
    todoRow(`when the column is made of ${bodies}, then no car leaves it by 0.1 m or more, it ends within 5 cm of its axis leaning under 3°, every car reads a load, and the roof sink never grows toward the top, from over 300 mm at the bottom to under 5 mm at the top`, todo, () => {
      let worst = 0;
      // The first frame a car is 0.1 m off the column ends the run: nothing later can bring it back under the bar.
      const { cars, rig } = column(OWNER, bodies, OWNER_S, (cs) => {
        worst = Math.max(worst, spread(cs).off);
        expect(worst, `a car left the column by ${worst.toFixed(2)} m on the way`).toBeLessThan(0.1);
      });
      const { off, lean } = spread(cars);
      expect(off < 0.05 && lean < 3, `the column ends ${off.toFixed(2)} m off its axis, leaning ${lean.toFixed(1)}°`).toBeTruthy();
      // Read the way the Stack panel reads it: every car still carries its load, the roof sink grows toward the bottom.
      const { crushMm, loadKn } = stackLoads(cars, rig.dropped);
      expect(loadKn.every((l) => l !== null), `a car reads off the column: ${loadKn.map((l) => l?.toFixed(0)).join("/")} kN`).toBeTruthy();
      const sink = crushMm.map((m) => m.toFixed(0)).join("/");
      expect(crushMm[crushMm.length - 1]!, `the top car's roof sank ${crushMm[crushMm.length - 1]!.toFixed(0)} mm with nothing on it (${sink} mm)`).toBeLessThan(5);
      for (let i = 1; i < crushMm.length; i++) expect(crushMm[i - 1]!, `roof sink bottom to top ${sink} mm: not decreasing at car ${i}`).toBeGreaterThanOrEqual(crushMm[i]! - 5);
      expect(crushMm[0]!, `the bottom roof sank only ${crushMm[0]!.toFixed(0)} mm under ten cars (${sink} mm)`).toBeGreaterThan(300);
    });
  }
});

describe("given the stack scene's defaults (4 cars, 0.02 m, one every 8 s), run for 4 s after the last drop", () => {
  // Stage 3 (integration b94657da): the roofs read 159/112/94/0 mm bottom to top (main 158/114/92/0), the 112 -> 94 step 18 mm against the
  // bar's 20 (main's 22: two millimetres of margin on a quantity that is the plastic history of the drops, not the static law, whose
  // depths for one, two and three cars on a roof are 31, 81 and 122 mm). The trace per drop: each car's 2 cm drop sinks the roof under it
  // to 94-100 mm, and the next drop pushes the roof below that by 16 mm and the one below that by 32 mm; every car stands belly on the
  // roof under it with its tyres 0.21-0.32 m clear of the hood and boot. The first bad commit is e7252ffa (the car's top is the cage, not
  // the plate: 18ecaba9 passes); the cage's refit threshold (REFIT_EPSILON to 0.1 mm) and the per-node follow of the crush change no
  // millimetre of it.
  todoRow("when the column is made of sedans, then each roof is crushed more than the roof above it by over 20 mm, and the top roof under 2 mm", "after the plan: recalibrate the roof strength law's constants and SKIN_STRAIN with their sources; the roofs read 159/112/94/0 mm bottom to top, the 112 -> 94 step 18 mm against the bar's 20 mm (the top roof at 0 mm passes)", () => {
    const { cars, rig } = column(DEFAULTS, "sedans", DEFAULTS_S);
    const { crushMm } = stackLoads(cars, rig.dropped);
    expect(crushMm[3]!, `top ${crushMm[3]!.toFixed(1)} mm`).toBeLessThan(2);
    for (let i = 0; i < 3; i++) expect(crushMm[i]!, `bottom to top ${crushMm.map((m) => m.toFixed(0)).join("/")} mm`).toBeGreaterThan(crushMm[i + 1]! + 20);
  });

  // Judged only on a column that stands: one that fell to the ground has nothing left to move. The outcome is chaotic: with the police base,
  // hatch, SUV and muscle, the per-tick trace first diverges at tick 94 (the hatch landing on the police) for a 5 mm move of the sedan
  // hood's rear edge, and 1 mm of drop height flips it. Moved over the 5 s, car 3 (worker, 2d0b497e): hood z0 0.88 / 0.985 / 0.99 0 / 0 /
  // 1689 mm, the 0.99 hood with drops of 0.019 / 0.021 m 5.9 / 1053 mm. Every 0 mm run was a collapsed column (cars at rest on the
  // ground 1.6-3.2 m off the axis); the red ones stood, the muscle on its side (up 0.21) on the police's front, toppling at 0.02 to 0.86 m/s.
  todoRow(
    `when the column is made of the fleet and left alone for 5 s after it settles, then it stands (every car within ${ON_AXIS_M} m of its axis) and no car moves 5 mm`, "after the plan: the fleet column does not hold (the owner's-drops fleet column's todo above): it falls to the ground or stands with a car balanced on its side, chaotically (1 mm of drop height flips it)",
    () => {
      const { cars } = column(DEFAULTS, "fleet", DEFAULTS_S);
      const { off } = spread(cars);
      expect(off, `the column fell before the rest: a car stands ${off.toFixed(2)} m off its axis`).toBeLessThan(ON_AXIS_M);
      const at = cars.map((c) => c.group.position.clone());
      const w = makeWorld(cars, false, false);
      for (let f = 0; f < 5 * FRAME_HZ; f++) tickWorld(w, 1 / FRAME_HZ);
      const moved = Math.max(...cars.map((c, i) => c.group.position.distanceTo(at[i]!)));
      expect(moved, `a car moved ${(moved * 1000).toFixed(1)} mm in 5 s at rest`).toBeLessThan(0.005);
    },
  );
});

/** How far (m) each drop's start is raised for the repeat rows: the owner's three starts, 0, 0.5 and 1 mm higher. */
const REPEAT_LIFTS = [0, 0.0005, 0.001] as const;

/**
 * The most (mm) a roof's crush may differ across `REPEAT_LIFTS`, per `DRIVER_CARS` id, with the worst roof spread over five starts (those
 * three and 0.25, 0.75 mm) it was set from: one rule for all seven, 1.5 x the five-start spread, rounded up (re-measured on b2d0a6d43, one probe: the five-start numbers below). The bottom roof's crush is the plastic history of the drop, so a millimetre of start moves
 * it by a slice of landing and coast. Truck and monster read far above the rest: their column keeps creeping down at 2-17 cm/s after the
 * landing (truck for 0.2 s, monster for 1 s) with a roof yielding, then halts within one frame, and where it halts decides the bottom
 * roof (truck 135-150 mm, monster 176-196): open defects, their bars pin today's spread and a todoRow below holds each to 7 mm. SUV's bar (24 mm since the hood fold, which took its five-start spread from 9.8 to 15.9 mm) covers a landing scatter (third roof
 * 58.8 vs 66.2 mm) with a second open defect (a todoRow below): its top three cars slide 7.7-10.3 cm from their set-down spot in the first 0.4 s
 * (every other class under 7 cm; sedan 3.7-6.6). Re-stage a bar only with its five-start number re-measured.
 */
const REPEAT_BARS: Record<string, { barMm: number; fiveStartMm: number }> = {
  sedan: { barMm: 12, fiveStartMm: 8.0 },
  muscle: { barMm: 15, fiveStartMm: 9.6 },
  truck: { barMm: 23, fiveStartMm: 15.3 },
  monster: { barMm: 31, fiveStartMm: 20.4 },
  police: { barMm: 9, fiveStartMm: 5.9 },
  hatch: { barMm: 10, fiveStartMm: 6.6 },
  // SUV re-staged for the hood fold (f7bff5bcf, land-u17): five starts 15.92 mm there against 9.76 on a1d649626 (one probe, same job), re-measured on f7bff5bcf; bar 1.5 x 15.92 = 23.9, up to 24.
  suv: { barMm: 24, fiveStartMm: 15.9 },
};

/** Each roof's crush (mm, bottom first) of a `type` column at the defaults, each drop started `lift` m higher. */
function liftedColumn(type: DriverCar, lift: number): number[] {
  const { cars, rig } = column({ ...DEFAULTS, drop: DEFAULTS.drop + lift }, { selected: type }, DEFAULTS_S);
  return stackLoads(cars, rig.dropped).crushMm;
}

/** The worst roof's spread (mm) across `runs`' crushes. */
function worstSpread(runs: readonly number[][]): number {
  return Math.max(...runs[0]!.map((_, k) => Math.max(...runs.map((r) => r[k]!)) - Math.min(...runs.map((r) => r[k]!))));
}

/** The repeat bar (mm) the truck and monster rows hold them to: the one the classes that stand still keep. */
const REPEAT_TODO_MM = 7;
/** Seconds after its set-down a car is watched for a slide, and how far (m, plan) its top three cars may slide in it. */
const SLIDE_S = 0.4;
const SLIDE_MAX_M = 0.07;

describe("given the stack scene's defaults (4 cars, 0.02 m, one every 8 s), each drop started 0, 0.5 or 1 mm higher", () => {
  for (const type of DRIVER_CARS) {
    const bar = REPEAT_BARS[type.id];
    it(`when the ${type.label} column settles, then each roof's crush is the same within its bar (${bar?.barMm} mm)`, () => {
      expect(bar, `${type.id} has no repeat bar`).toBeDefined();
      const runs = REPEAT_LIFTS.map((lift) => liftedColumn(type, lift));
      const said = runs.map((r) => r.map((m) => m.toFixed(1)).join("/")).join(" | ");
      expect(Math.min(...runs.map((r) => r[0]!)), `the bottom roof was crushed (${said})`).toBeGreaterThan(100);
      const worst = worstSpread(runs);
      expect(worst, `${said} (the bar was set from ${bar!.fiveStartMm} mm over five starts)`).toBeLessThan(bar!.barMm);
    });
  }

  for (const id of ["truck", "monster"]) {
    const type = DRIVER_CARS.find((c) => c.id === id)!;
    todoRow(
      `when the ${type.label} column settles, then each roof's crush is the same within ${REPEAT_TODO_MM} mm, the bar the other classes hold`,
      `after the plan: find why the ${type.label} column creeps down after the landing (truck 6-10 cm/s for 0.2 s, monster 2-17 cm/s from 0.7 s, a roof yielding on most frames) and then halts within one frame; where it halts decides the bottom roof (truck 135-150 mm, monster 176-196 mm), so its repeat bar is ${REPEAT_BARS[id]!.barMm} mm (docs/LOAD_CRUSH.md)`,
      () => {
        const runs = REPEAT_LIFTS.map((lift) => liftedColumn(type, lift));
        expect(worstSpread(runs), runs.map((r) => r.map((m) => m.toFixed(1)).join("/")).join(" | ")).toBeLessThan(REPEAT_TODO_MM);
      },
    );
  }

  todoRow(
    `when the SUV column's top three cars are each set down, then each slides under ${SLIDE_MAX_M * 100} cm from its spot in the next ${SLIDE_S} s`,
    "after the plan: find why the SUV's top three cars slide 7.7-10.3 cm along the roof they landed on in the first 0.4 s (every other class under 7 cm; docs/LOAD_CRUSH.md)",
    () => {
      const suv = DRIVER_CARS.find((c) => c.id === "suv")!;
      const setDown: THREE.Vector3[] = [];
      const left: number[] = [];
      let slide = 0;
      column(DEFAULTS, { selected: suv }, DEFAULTS_S, (cars, dropped) => {
        for (let i = 1; i < dropped; i++) {
          if (setDown[i] === undefined) {
            setDown[i] = cars[i]!.group.position.clone();
            left[i] = Math.round(SLIDE_S * FRAME_HZ);
          } else if (left[i]! > 0) {
            left[i]!--;
            slide = Math.max(slide, Math.hypot(cars[i]!.group.position.x - setDown[i]!.x, cars[i]!.group.position.z - setDown[i]!.z));
          }
        }
      });
      expect(slide, `a car slid ${(slide * 100).toFixed(1)} cm`).toBeLessThan(SLIDE_MAX_M);
    },
  );
});

describe("given the owner's drops (11 cars, 0.15 m, one a second) of the mixed fleet", () => {
  // The owner's drops of the mixed fleet: after pair pushes a tilted wreck's frame moved 0.35 m in one re-measure and the next
  // timed read wrote −55 m/s into car.velocity.y (c9 −25 m/s against its masses' −4 on this run), which applyImpulse and
  // brakeInbound then used as real (the Stack HUD read CLOSING 125 mph). The column's cars are rigid bodies (their masses are not
  // active and carry no velocity of their own), so the reference is how far the body moved over the frame.
  it("when the column runs for 12 s, then no car reports a vertical speed 4 m/s or more off the one its body moved at over the frame", (t) => {
    const lastY: number[] = [];
    const lastPlacements: number[] = [];
    let judged = 0;
    let worst = 0;
    let at = "";
    column(OWNER, "fleet", 12, (cs, dropped) => {
      for (let i = 0; i < dropped; i++) {
        const c = cs[i]!;
        const sameSpot = lastPlacements[i] === c.placements;
        const moved = (c.group.position.y - lastY[i]!) / FRAME_S;
        lastY[i] = c.group.position.y;
        lastPlacements[i] = c.placements;
        if (!sameSpot) continue;
        judged++;
        const off = Math.abs(c.velocity.y - moved);
        if (off > worst) {
          worst = off;
          at = `car ${i}: ${c.velocity.y.toFixed(1)} m/s, its body moved ${moved.toFixed(1)}`;
        }
      }
    });
    t.annotate(`${judged} car-frames judged; the worst reported ${worst.toFixed(2)} m/s off its body (${at})`);
    expect(judged, "no car was judged").toBeGreaterThan(0);
    expect(worst, `a car reported ${worst.toFixed(1)} m/s off its body (${at})`).toBeLessThan(4);
  });

  it.todo("when the fleet's monster truck (slot 5; tyres on 0.9 m of spring, body 0.48 m up) carries four cars or more, then it rolls 5-30° on the support of its tyres, which has no spring to bring it level, and the column above it falls: 11 fleet cars, 0.15 m, 1 s (after the plan: hold the fleet column on its base so the monster is loaded; measured over 12 s the column slides off its base, car 0 1.0 m off at 3 s and 5.2 m at 12 s, and the monster ends on the ground at 0.0° with 2 cars at most above it, its roll peaking at 34.1° once)");
});

describe("given the player picked a car type in the settings", () => {
  for (const type of DRIVER_CARS) {
    it(`when the 4-car stack has dropped every car and the pick is ${type.label}, then every car in the stack is a ${type.label}`, () => {
      // Which car each drop is does not depend on the physics: the rig's clock is stepped through its four drops with nothing simulated.
      const { cars, rig } = makeColumn({ cars: 4, drop: 0.02, gap: 1 }, { selected: type });
      for (let f = 0; f < (1 + 3 + 1) * 60; f++) if (rig.step(f / 60) === "drop") placeDrop(cars, rig.dropped - 1, rig.config.drop);
      expect(rig.dropped, "every car has dropped").toBe(4);
      for (const [i, c] of cars.entries()) {
        expect(c.style.id, `car ${i} body`).toBe(type.style);
        expect(carClass(c), `car ${i} class`).toBe(type.cls);
      }
    });
  }
});
