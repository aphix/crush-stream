import { CarDetail } from "../present/car-detail.ts";
import type { OpenWorldCullPorts } from "./engine-openworld-cull.ts";

/** Culling ports with no camera and no solids: every thing is seen, so nothing is ever phased out. */
export function idleCullPorts(): OpenWorldCullPorts {
  const detail = new CarDetail();
  return { eyes: () => [], solids: () => [], playerCars: () => [], detail: () => detail, followed: () => null, replaying: () => false };
}
