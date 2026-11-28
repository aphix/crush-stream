import type { DetachPart } from "./car-core.ts";

/** What `CarParts.posePart` leaves unwritten while no camera sees the car, until `CarParts.settleParts`. */
export class PartPoseWait {
  /** No camera sees the car. */
  unseen = false;
  /** A pose was left unwritten. */
  owed = false;

  /** Whether `p`'s pose waits. Only a part that is a pure function of the car's state does: a shell panel's bend is path-dependent and a torn one's loose shape is read off it (sim). `onRoad` false is a part leaving the car: it is posed now. */
  defers(p: DetachPart, onRoad: boolean): boolean {
    if (!onRoad || !this.unseen || p.region !== null) return false;
    this.owed = true;
    return true;
  }
}
