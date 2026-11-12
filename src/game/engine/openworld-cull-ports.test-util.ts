import { CarDetail } from "../present/car-detail.ts";
import type { OpenWorldCullPorts } from "./engine-openworld-cull.ts";
import type { OpenWorldPorts } from "./engine-openworld.ts";

/** Culling ports with no camera and no solids: every thing is seen, so nothing is ever phased out. */
export function idleCullPorts(): OpenWorldCullPorts {
  const detail = new CarDetail();
  return { eyes: () => [], solids: () => [], playerCars: () => [], walker: () => null, detail: () => detail, followed: () => null, replaying: () => false };
}

/**
 * Every director port as a no-op: a solo host in the open world, no cars, nobody on foot, drawing that keeps nothing.
 * A harness spreads it and overrides only the ports its rows read; a lane that adds a port adds its default here.
 */
export function idleOpenWorldPorts(): OpenWorldPorts {
  return {
    inOpenWorld: () => true,
    isClient: () => false,
    inRoom: () => false,
    seed: () => 0,
    tier: () => 0,
    cars: () => [],
    foot: () => false,
    now: () => 0,
    eye: () => {},
    throwFigure: () => -1,
    removeFigure: () => false,
    hookWallHits: () => () => {},
    makeArt: () => ({ update: () => {}, dispose: () => {} }),
    signsOn: () => false,
    makeSigns: () => ({ update: () => {}, dispose: () => {} }),
    cull: idleCullPorts(),
    makeFacades: () => ({ dispose: () => {} }),
    setDayHour: () => {},
    strikeWalker: () => {},
    staggerWalker: () => {},
    punchProp: () => {},
    pickDoll: () => {},
    pickCar: () => {},
    strikeDoll: () => {},
    shotSparks: () => {},
    shootProp: () => Infinity,
  };
}
