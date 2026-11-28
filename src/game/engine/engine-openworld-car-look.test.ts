import { describe, expect, it } from "vitest";
import { LookRay, type Meeting } from "../ai/civilians/civilian-look.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { newCrowd } from "../ai/civilians/civilian-crowd.test-util.ts";
import { NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../ai/civilians/civilian-constants.ts";
import { residentNameText } from "../ai/civilians/civilian-mood.ts";
import { residentColour } from "../ai/openworld-traffic/traffic-look.ts";
import { CAR_STYLES, type CarStyleId } from "../vehicle/car-variants.ts";
import { CarLook, colourWord, type CarLookTraffic, type LookCar } from "./engine-openworld-car-look.ts";

/** The eye stands this far (m) behind the car's middle, at a walker's eye height (m), looking along +z at it. */
const EYE_BACK = 10;
const EYE_HEIGHT = 1;
/** Far enough beside the car (m) that the ray passes it. */
const BESIDE = 5;
const REACH = 30;
const RESIDENT = 0;
const TICK = 100;

function carOf(style: CarStyleId, x = 0): LookCar {
  return {
    stored: false,
    crashed: false,
    yaw: 0,
    group: { visible: true, position: { x, y: 0, z: 0 } },
    style: CAR_STYLES[style],
    velocity: { x: 0, z: 0 },
    paint: { body: 0xc42a2a },
    deform: { drivetrainHealth: 1, wheelsOn: 4 },
  };
}

/** The panel over `cars` with a traffic whose owners are `owners` (car index to resident, -1 none). */
function lookOver(cars: LookCar[], owners: number[], players: LookCar[] = [], followed: LookCar | null = null, own: LookCar | null = null): CarLook {
  const traffic: CarLookTraffic = { ownerOf: (index) => owners[index] ?? -1, isEmptyCar: () => false, ambulanceCar: () => -1 };
  return new CarLook({ cars: () => cars, playerCars: () => players, own: () => own, followed: () => followed, traffic: () => traffic });
}

function rayAt(x: number): LookRay {
  const ray = new LookRay();
  ray.eyeX = x;
  ray.eyeY = EYE_HEIGHT;
  ray.eyeZ = -EYE_BACK;
  return ray;
}

describe("given the look-at panel over the open world's cars", () => {
  const crowd = newCrowd(buildFixtureMap());
  const state = crowd.state;
  const base = RESIDENT * RESIDENT_INT_STRIDE;
  const meeting = (): Meeting => ({ index: -1, along: REACH });

  it("when the eye rests on a resident's parked car, then the panel names its owner, its paint and body, and the place it is parked by", () => {
    const home = state.ints[base + RESIDENT_INT.home]!;
    state.ints[base + RESIDENT_INT.carPlace] = home;
    state.ints[base + RESIDENT_INT.carTo] = NO_PLACE;
    state.ints[base + RESIDENT_INT.carOwner] = NO_PLACE;
    const look = lookOver([carOf("hatchback")], [RESIDENT]);
    const met = look.met(rayAt(0), REACH, meeting());
    expect(met.index, "the car met").toBe(0);
    const text = look.text(met.index, state, TICK);
    expect(text.title).toBe(`${residentNameText(state, RESIDENT)}'s car`);
    expect(text.lines[0]).toBe(`${colourWord(residentColour(RESIDENT))} hatchback`);
    expect(text.lines[1]).toBe(`parked by ${state.map.places[home]!.name}`);
    expect(text.lines.some((line) => line.startsWith("condition: not a scratch")), "its damage").toBe(true);
  });

  it("when the eye rests on a cruiser, then the panel says patrol car", () => {
    const look = lookOver([carOf("police")], [-1]);
    expect(look.text(look.met(rayAt(0), REACH, meeting()).index, state, TICK).title).toBe("Patrol car");
  });

  it("when the eye rests on the player's car while he is on foot, then the panel says your car, and another player's car is a player's; while the camera rides it, the ray passes it", () => {
    const mine = carOf("coupe");
    const theirs = carOf("sedan");
    expect(lookOver([mine], [-1], [mine], null, mine).text(0, state, TICK).title).toBe("Your car");
    expect(lookOver([theirs], [-1], [mine, theirs], null, mine).text(0, state, TICK).title).toBe("A player's car");
    expect(lookOver([mine], [-1], [mine], mine).met(rayAt(0), REACH, meeting()).index, "the car the camera rides").toBe(-1);
  });

  it("when the ray passes beside a car or the car is put away, then nothing is met", () => {
    expect(lookOver([carOf("sedan")], [-1]).met(rayAt(BESIDE), REACH, meeting()).index).toBe(-1);
    const stored = carOf("sedan");
    stored.stored = true;
    expect(lookOver([stored], [-1]).met(rayAt(0), REACH, meeting()).index).toBe(-1);
  });
});
