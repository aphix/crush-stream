import * as THREE from "three";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { newCrowd, stepUntilShown } from "../ai/civilians/civilian-crowd.test-util.ts";
import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { buildFixtureMap } from "../ai/civilians/civilian-graph.test-util.ts";
import { createCrowdPoses, type CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import type { AutoWorld } from "../ai/openworld-auto/auto-scan.ts";
import { AMBULANCE } from "../ai/openworld-traffic/ambulance.ts";
import { launch, pooledCar } from "../contact/crash-scenarios.test-util.ts";
import { DeformableCar } from "../vehicle/car.ts";

const MAP = buildFixtureMap();
const POPULATION = 60;
const MORNING_S = 40;
const FRAME_S = 1 / 30;

/** Where a subject stands. */
type Place = { x: number; z: number };
/** A car in the scene: where it stands, how fast it drives along +z, whether it is a police body, and whether a resident is at the wheel. */
type CarSpec = Place & { speed: number; police?: boolean; resident?: boolean };

/** What a scene has in it: people on the pavement, foot cops (a speed in m/s each), cars, and which car (an index in `cars`) is the ambulance out loading. */
export type SceneParts = { civilians?: readonly Place[]; cops?: readonly (Place & { speed: number })[]; cars?: readonly CarSpec[]; ambulance?: number };

/** The open world as the Auto camera reads it, scripted: the parts above, and a way to move every one of them. */
export type AutoScene = { world: AutoWorld; sizes: { residents: number; cops: number; cars: number; events: number }; crowd: CivilianCrowd; cops: CrowdPoses; cars: DeformableCar[]; shift(dx: number): void };

let shared: CivilianCrowd | null = null;

/** One crowd with people out, made once for the file: a scene rewrites its poses and never steps it. */
function morning(): CivilianCrowd {
  if (shared !== null) return shared;
  const crowd = newCrowd(MAP, POPULATION);
  const start = stepUntilShown(crowd);
  for (let seconds = start; seconds < start + MORNING_S; seconds += FRAME_S) crowd.step(seconds, [], true);
  shared = crowd;
  return crowd;
}

/** A police car of the open world: the body the scan follows with no resident to name at the wheel. */
function policeCar(): DeformableCar {
  return new DeformableCar({ body: 0x808080, accent: 0x404040, name: "Patrol" }, new THREE.Scene(), null, "police");
}

/** `parts` made into a world the Auto camera can be pointed at. */
export function sceneOf(parts: SceneParts): AutoScene {
  const crowd = morning();
  const people = parts.civilians ?? [];
  crowd.poses.shown.fill(0);
  for (let at = 0; at < people.length; at++) {
    crowd.poses.shown[at] = 1;
    crowd.poses.x[at] = people[at]!.x;
    crowd.poses.z[at] = people[at]!.z;
    crowd.poses.activity[at] = at === 0 ? ACTIVITY.swing : ACTIVITY.none;
  }
  const foot = parts.cops ?? [];
  const cops = createCrowdPoses(Math.max(1, foot.length));
  for (let at = 0; at < foot.length; at++) {
    cops.shown[at] = 1;
    cops.x[at] = foot[at]!.x;
    cops.z[at] = foot[at]!.z;
    cops.speed[at] = foot[at]!.speed;
  }
  const specs = parts.cars ?? [];
  const cars: DeformableCar[] = [];
  const driverOf = new Map<number, number>();
  for (let at = 0; at < specs.length; at++) {
    const spec = specs[at]!;
    const car = spec.police === true ? policeCar() : pooledCar(at);
    launch(car, spec.x, spec.z, 0, 0, spec.speed);
    if (spec.police === true) car.setSirens(true);
    cars.push(car);
    if (spec.resident === true) driverOf.set(at, at);
  }
  const ambulance = parts.ambulance ?? -1;
  const world: AutoWorld = {
    crowd: () => crowd,
    cops: () => (foot.length === 0 ? null : cops),
    residentAt: (carIndex) => driverOf.get(carIndex) ?? -1,
    cars: () => cars,
    ambulanceCar: () => ambulance,
    ambulanceState: () => (ambulance < 0 ? AMBULANCE.idle : AMBULANCE.loading),
    isPlayerCar: () => false,
  };
  return {
    world,
    sizes: { residents: crowd.poses.count, cops: Math.max(1, foot.length), cars: Math.max(1, specs.length), events: 512 },
    crowd,
    cops,
    cars,
    shift(dx) {
      for (let at = 0; at < people.length; at++) crowd.poses.x[at] = crowd.poses.x[at]! + dx;
      for (let at = 0; at < foot.length; at++) cops.x[at] = cops.x[at]! + dx;
      for (const car of cars) car.group.position.x += dx;
    },
  };
}
