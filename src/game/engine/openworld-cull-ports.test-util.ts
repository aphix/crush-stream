import { CarDetail } from "../present/car-detail.ts";
import type { OpenWorldCullPorts } from "./engine-openworld-cull.ts";
import type { OpenWorldPorts } from "./engine-openworld.ts";
import { TetherSet } from "../contact/tether.ts";

/** Culling ports with no camera and no solids: every thing is seen, so nothing is ever phased out. */
export function idleCullPorts(): OpenWorldCullPorts {
  const detail = new CarDetail();
  return { eyes: () => [], solids: () => [], playerCars: () => [], walker: () => null, others: (_out, from) => from, detail: () => detail, followed: () => null, replaying: () => false };
}

const IDLE_TETHERS = new TetherSet();

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
    peerName: () => null,
    ownCar: () => null,
    foot: () => false,
    actorPlace: () => false,
    ownActor: () => 0,
    placeCarNear: () => false,
    now: () => 0,
    eye: () => {},
    throwFigure: () => -1,
    removeFigure: () => false,
    spawnOf: () => 0,
    hookWallHits: () => () => {},
    makeArt: () => ({ update: () => {}, dispose: () => {} }),
    signsOn: () => false,
    makeSigns: () => ({ update: () => {}, setNight: () => {}, dispose: () => {} }),
    cull: idleCullPorts(),
    makeFacades: () => ({ dispose: () => {} }),
    setDayHour: () => {},
    strikeWalker: () => {},
    staggerWalker: () => {},
    strikeActor: () => {},
    punchProp: () => {},
    pickDoll: () => {},
    pickCar: () => {},
    strikeDoll: () => {},
    shotSparks: () => {},
    shootProp: () => Infinity,
    footAnchor: () => false,
    ownCarIndex: () => -1,
    playerLook: () => ({ woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false }),
    knockWalker: () => false,
    dragWalker: () => {},
    hookHold: () => false,
    tethers: () => IDLE_TETHERS,
    propMet: () => Infinity,
  };
}