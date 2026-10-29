import { afterAll, beforeAll, describe, expect, it } from "vitest";
import "../kernel/rapier-node.test-util.ts";
import { setGround } from "../world/ground.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import type { DoorScenario, RamShot } from "../scenes/door-rig.ts";
import { MIRROR_FOLD_MAX } from "../vehicle/car-core.ts";
import type { CrashEngine } from "./engine.ts";
import { bootEngine, stubBrowser } from "./engine-headless.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

const FRAME = 1 / FRAME_HZ;
/** The least crush (mm) a tail shot must leave: a head that met the tail leaves tens of mm, one that went through leaves none. */
const CRUSH_MIN_MM = 50;
/** How far (share) a second click's crush may differ from the first's: the tail's deep crush rides the body's own settling, a few per cent apart between two parks. */
const CRUSH_SHARE_TOL = 0.04;
/** Plus this much (mm), for a shot that crushes nothing. */
const CRUSH_SLACK_MM = 1;
/** The most (mm) the head's furthest point may differ between two clicks: the body rides its springs a few mm differently after each re-park. */
const REACH_TOL_MM = 10;
/** The longest a shot may run (sim s): the ram's run and its settle hold end well inside it. */
const SHOT_LIMIT_S = 90;
/** The door's check-strap stop (deg). */
const DOOR_STOP_DEG = 68;
const R2D = 180 / Math.PI;
const STYLES = ["sedan", "hatch", "suv", "muscle", "truck", "police", "monster"] as const;

/** One lane fired through the Doors scene's button path (`fireDoorRam`): what came of the shot and how far the head got along the car. */
type Fired = { shot: RamShot; furthest: number; wall: number; lidLatched: boolean; lidRad: number; carMoved: number };

/** The real engine in the Doors scene, one for the file (a second `CrashEngine` in the same process never resolves `ready`). */
class DoorsBench {
  engine!: CrashEngine;

  async start(): Promise<void> {
    stubBrowser();
    this.engine = await bootEngine({ pacer: true });
    this.engine["setScene"]("doors");
  }

  stop(): void {
    this.engine.dispose();
    setGround(null);
  }

  /** The scene with `id` as the player's car, parked and settled. */
  park(id: string): void {
    this.engine.setPlayerCar(id);
    for (let i = 0; i < FRAME_HZ; i++) this.engine.advance(FRAME, { frameDt: FRAME });
  }

  /** The scene runs `seconds` more with nothing fired. */
  idle(seconds: number): void {
    for (let i = 0; i < seconds * FRAME_HZ; i++) this.engine.advance(FRAME, { frameDt: FRAME });
  }

  fire(scenario: DoorScenario, kph: number, kg: number): Fired {
    const engine = this.engine;
    engine.setDoorConfig({ kph, kg, side: 1 });
    engine.fireDoorRam(scenario);
    let furthest = -Infinity;
    for (let i = 0; i < SHOT_LIMIT_S * FRAME_HZ && engine["doorRig"].phase !== "idle"; i++) {
      engine.advance(FRAME, { frameDt: FRAME });
      furthest = Math.max(furthest, engine["doorRig"].face);
    }
    const car = engine["carA"];
    const shot = engine["doorShot"];
    must(shot, `${scenario} ${kph} km/h: the shot ended with no result`);
    return { shot, furthest, wall: car.rearSeatBackZ(), lidLatched: car.lidHinge().latched, lidRad: car.lidAngle(), carMoved: car.group.position.length() };
  }
}

const bench = new DoorsBench();
beforeAll(() => bench.start());
afterAll(() => bench.stop());

const HARD_SHOTS = [
  { lane: "mirror", reacts: "the mirror is knocked off", kph: 12, kg: 300, expected: "mirrorR" },
  { lane: "overOpen", reacts: "the door is driven off", kph: 15, kg: 300, expected: "doorR" },
  { lane: "shut", reacts: "the door is slammed off", kph: 40, kg: 300, expected: "doorR" },
  { lane: "panelPush", reacts: "the quarter panel is torn off", kph: 30, kg: 1500, expected: "quarterR" },
  { lane: "panelPull", reacts: "the quarter panel is torn off", kph: 30, kg: 1500, expected: "quarterR" },
  { lane: "lidTear", reacts: "the open lid is torn off by the head", kph: 12, kg: 100, expected: "trunk" },
] as const;

const GENTLE_SHOTS = [
  { lane: "mirror", reacts: "the mirror folds onto its stop and stays on", kph: 4, kg: 38.9 },
  { lane: "overOpen", reacts: "the door is driven to its stop and stays on", kph: 5, kg: 120 },
  { lane: "shut", reacts: "the door is shut and latched", kph: 4, kg: 300 },
  { lane: "panelPush", reacts: "the quarter panel is dented and stays on", kph: 3, kg: 30 },
  { lane: "panelPull", reacts: "the quarter panel is opened further and stays on", kph: 3, kg: 30 },
] as const;

/** F's blow crushes the tail 2.2 cm at the latch (`LID_LATCH_CRUSH_M` is 2 cm): 12 km/h with 100 kg, 333 N·s, which a parked car takes without moving 10 cm. */
const F_HARD = { kph: 12, kg: 100 } as const;
/** The same car under the latch's crush: 6 km/h with 20 kg dents the tail 1.5 cm. */
const F_GENTLE = { kph: 6, kg: 20 } as const;
const G_HARD = { kph: 12, kg: 100 } as const;
const TAIL_SHOTS = [
  { lane: "lidPop", ...F_GENTLE },
  { lane: "lidPop", kph: 12, kg: 300 },
  { lane: "lidPop", ...F_HARD },
  { lane: "lidTear", kph: 6, kg: 30 },
  { lane: "lidTear", kph: 12, kg: 300 },
  { lane: "lidTear", ...G_HARD },
] as const;
/** The furthest (m) a lane that only knocks its part may carry the whole car. */
const CAR_MOVED_MAX_M = 0.1;
/** Shots of each gate row, and how long (s) a sprung gate must stay unlatched after each. */
const GATE_SHOTS = 5;
const GATE_HOLD_S = 2;

/** The reaction a gentle shot on `lane` must show, or "" when it shows it. */
function gentleFailure(lane: DoorScenario, fired: Fired): string {
  const { shot } = fired;
  if (shot.detached.length > 0) return `parts off a gentle shot: [${shot.detached}]`;
  if (lane === "mirror" && shot.mirrorFoldDeg <= MIRROR_FOLD_MAX * R2D - 1) return `mirror folded only ${shot.mirrorFoldDeg}°`;
  if (lane === "overOpen" && Math.abs(shot.doorDeg - DOOR_STOP_DEG) >= 0.5) return `door at ${shot.doorDeg}°, not on its stop`;
  if (lane === "shut" && !(shot.latched && shot.doorDeg < 0.01)) return `door ${shot.doorDeg}°, latched ${shot.latched}`;
  if (lane === "panelPush" && !(shot.panelHinge > 0 && shot.panelHinge < 0.45)) return `panel hinge ${shot.panelHinge}, not dented back`;
  if (lane === "panelPull" && !(shot.panelHinge > 0.45)) return `panel hinge ${shot.panelHinge}, not pulled out`;
  return "";
}

describe("given the real engine in the Doors scene, every lane's button pressed on every car (docs/DOOR_RIG.md, Rig)", () => {
  for (const id of STYLES) {
    for (const c of HARD_SHOTS) {
      it(`when ${c.lane} is fired on the ${id} at ${c.kph} km/h and ${c.kg} kg, then ${c.reacts}, and the car moves under ${CAR_MOVED_MAX_M} m`, () => {
        bench.park(id);
        const fired = bench.fire(c.lane, c.kph, c.kg);
        expect(fired.shot.detached.includes(c.expected), `off [${fired.shot.detached}], wanted ${c.expected}`).toBeTruthy();
        expect(fired.carMoved, `the car moved ${fired.carMoved} m`).toBeLessThan(CAR_MOVED_MAX_M);
      });
    }

    it(`when lidPop is fired on the ${id} at ${F_HARD.kph} km/h and ${F_HARD.kg} kg, then the head springs the lid past its latch by contact, still on the car, and the car moves under ${CAR_MOVED_MAX_M} m`, () => {
      bench.park(id);
      const fired = bench.fire("lidPop", F_HARD.kph, F_HARD.kg);
      expect(!fired.lidLatched && !fired.shot.detached.includes("trunk"), `lid latched ${fired.lidLatched}, off [${fired.shot.detached}]`).toBeTruthy();
      expect(fired.carMoved, `the car moved ${fired.carMoved} m`).toBeLessThan(CAR_MOVED_MAX_M);
    });

    it(`when lidPop is fired on the ${id} at ${F_GENTLE.kph} km/h and ${F_GENTLE.kg} kg, then the lid stays latched and the car moves under ${CAR_MOVED_MAX_M} m`, () => {
      bench.park(id);
      const fired = bench.fire("lidPop", F_GENTLE.kph, F_GENTLE.kg);
      expect(fired.lidLatched && fired.shot.detached.length === 0, `lid latched ${fired.lidLatched}, off [${fired.shot.detached}]`).toBeTruthy();
      expect(fired.carMoved, `the car moved ${fired.carMoved} m`).toBeLessThan(CAR_MOVED_MAX_M);
    });

    for (const g of GENTLE_SHOTS) {
      it(`when ${g.lane} is fired on the ${id} at ${g.kph} km/h and ${g.kg} kg, then ${g.reacts}`, () => {
        bench.park(id);
        expect(gentleFailure(g.lane, bench.fire(g.lane, g.kph, g.kg))).toBe("");
      });
    }
  }
});

describe("given the real engine in the Doors scene, a drop gate's latch sprung by F", () => {
  for (const id of ["truck", "monster"] as const) {
    for (const kph of [12, 16, 20]) {
      it(`when F is fired on the ${id}'s gate five times at ${kph} km/h and 100 kg, then each sprung gate stays unlatched for 2 s after the shot`, () => {
        for (let shot = 0; shot < GATE_SHOTS; shot++) {
          bench.park(id);
          const fired = bench.fire("lidPop", kph, 100);
          expect(!fired.lidLatched, `shot ${shot}: the gate was not sprung`).toBe(true);
          bench.idle(GATE_HOLD_S);
          expect(!bench.engine["carA"].lidHinge().latched, `shot ${shot}: the sprung gate latched again within ${GATE_HOLD_S} s`).toBe(true);
        }
      });
    }
  }
});

describe("given the real engine in the Doors scene, a tail lane's button pressed twice in a row on every car", () => {
  for (const id of STYLES) {
    for (const tail of TAIL_SHOTS) {
      it(`when ${tail.lane} is fired twice on the ${id} at ${tail.kph} km/h and ${tail.kg} kg, then the second shot meets what the first did and neither head passes the rear seat back`, () => {
        bench.park(id);
        const first = bench.fire(tail.lane, tail.kph, tail.kg);
        const second = bench.fire(tail.lane, tail.kph, tail.kg);
        expect(first.furthest, `first head reached z ${first.furthest} past the seat back at ${first.wall}`).toBeLessThanOrEqual(first.wall + 1e-6);
        expect(second.furthest, `second head reached z ${second.furthest} past the seat back at ${second.wall}`).toBeLessThanOrEqual(second.wall + 1e-6);
        expect(first.shot.ramStopped && second.shot.ramStopped, `nothing stopped the head (first ${first.shot.ramStopped}, second ${second.shot.ramStopped})`).toBeTruthy();
        expect(Math.abs(second.furthest - first.furthest), `furthest z ${second.furthest} against ${first.furthest}`).toBeLessThan(REACH_TOL_MM / 1000);
        expect(Math.abs(second.shot.bodyVertexMm - first.shot.bodyVertexMm), `crush ${second.shot.bodyVertexMm} mm against ${first.shot.bodyVertexMm} mm`).toBeLessThanOrEqual(CRUSH_SHARE_TOL * first.shot.bodyVertexMm + CRUSH_SLACK_MM);
        expect(second.shot.detached.join(), "parts off").toBe(first.shot.detached.join());
        if (tail.lane === "lidPop") expect(first.shot.bodyVertexMm, `the tail was barely crushed (${first.shot.bodyVertexMm} mm): the head met little or nothing`).toBeGreaterThan(CRUSH_MIN_MM);
      });
    }
  }

  it("when F is fired after G on the muscle, then the head stops at the rear seat back and springs the lid, as a single F does", () => {
    bench.park("muscle");
    bench.fire("lidTear", G_HARD.kph, G_HARD.kg);
    const second = bench.fire("lidPop", F_HARD.kph, F_HARD.kg);
    expect(second.shot.ramStopped && second.furthest <= second.wall + 1e-6, `F after G: furthest z ${second.furthest}, wall ${second.wall}`).toBeTruthy();
    expect(!second.lidLatched, "F after G left the lid latched").toBe(true);
  });
});
