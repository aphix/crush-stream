import { detCos, detSin, hypot2 } from "../../kernel/physics-core.js";
import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { CENTIMETRES_PER_METRE, DECISION_HZ, FLAG, NEVER_TICK, NO_PLACE, PURPOSE, RESIDENT_INT, RESIDENT_INT_STRIDE, WITNESS_RADIUS } from "../civilians/civilian-constants.ts";
import type { CityState } from "../civilians/civilian-state.ts";
import type { CrowdPoses } from "../civilians/crowd-poses.ts";
import { crimePlaceOf, isWanted } from "../civilians/society-crime.ts";
import type { Spot, Walk } from "./offence-source.ts";

/** The crowd's owner: its society rows and its drawn poses. */
type CrowdView = { readonly state: CityState; readonly poses: CrowdPoses };

/** The law's reading of the society: crimes and fights are the brain's rows (`society-crime.ts`), a resident stands where the crowd draws them, else at their fight or crime place. */
export class StateOffenceSource {
  private readonly crowd: CrowdView;
  private readonly map: OpenWorldMap;
  private readonly scratch: Spot = { x: 0, z: 0 };

  constructor(crowd: CrowdView, map: OpenWorldMap) {
    this.crowd = crowd;
    this.map = map;
  }

  get residentCount(): number {
    return this.crowd.state.capacity;
  }

  wanted(resident: number, tick: number): boolean {
    return isWanted(this.crowd.state, resident, tick);
  }

  spellOf(resident: number): number {
    return this.int(resident, RESIDENT_INT.wantedUntilTick);
  }

  fightTick(resident: number): number {
    return this.int(resident, RESIDENT_INT.fightTick);
  }

  fightPartner(resident: number): number {
    return this.int(resident, RESIDENT_INT.fightPartner);
  }

  standing(resident: number, _seconds: number, out: Spot): boolean {
    const { poses } = this.crowd;
    if (poses.shown[resident] === 1) {
      out.x = poses.x[resident]!;
      out.z = poses.z[resident]!;
      return true;
    }
    if (this.fightTick(resident) !== NEVER_TICK) {
      out.x = this.int(resident, RESIDENT_INT.fightX) / CENTIMETRES_PER_METRE;
      out.z = this.int(resident, RESIDENT_INT.fightZ) / CENTIMETRES_PER_METRE;
      return true;
    }
    const crimePlace = crimePlaceOf(this.crowd.state, resident);
    return (crimePlace !== NO_PLACE && this.atDoor(crimePlace, out)) || this.atDoor(this.int(resident, RESIDENT_INT.place), out);
  }

  onStreet(resident: number, out: Walk): boolean {
    const { poses } = this.crowd;
    if (poses.shown[resident] !== 1) return false;
    out.x = poses.x[resident]!;
    out.z = poses.z[resident]!;
    out.dirX = detSin(poses.yaw[resident]!);
    out.dirZ = detCos(poses.yaw[resident]!);
    return true;
  }

  knocked(resident: number): boolean {
    return (this.int(resident, RESIDENT_INT.flags) & FLAG.hurt) !== 0;
  }

  reportDoneTick(resident: number): number {
    const since = this.offenceTick(resident);
    if (since === NEVER_TICK || !this.offenceSpot(resident, this.scratch)) return NEVER_TICK;
    const { placeX, placeZ } = this.crowd.state.index;
    let done = NEVER_TICK;
    for (let caller = 0; caller < this.residentCount; caller++) {
      if (this.int(caller, RESIDENT_INT.legPurpose) !== PURPOSE.report || this.int(caller, RESIDENT_INT.departTick) < since) continue;
      const at = this.int(caller, RESIDENT_INT.place);
      if (hypot2(placeX[at]! - this.scratch.x, placeZ[at]! - this.scratch.z) > WITNESS_RADIUS) continue;
      done = Math.min(done, this.int(caller, RESIDENT_INT.nextDecisionTick));
    }
    return done;
  }

  /** The tick the resident's crime or fight happened, `NEVER_TICK` for neither. */
  private offenceTick(resident: number): number {
    return Math.min(this.int(resident, RESIDENT_INT.crimeTick), this.int(resident, RESIDENT_INT.fightTick));
  }

  /** Where the resident's crime or fight was: the crime place's door, or the fight's spot. */
  private offenceSpot(resident: number, out: Spot): boolean {
    if (this.int(resident, RESIDENT_INT.fightTick) !== NEVER_TICK) {
      out.x = this.int(resident, RESIDENT_INT.fightX) / CENTIMETRES_PER_METRE;
      out.z = this.int(resident, RESIDENT_INT.fightZ) / CENTIMETRES_PER_METRE;
      return true;
    }
    return this.atDoor(crimePlaceOf(this.crowd.state, resident), out);
  }

  legDepartSeconds(resident: number): number {
    return this.int(resident, RESIDENT_INT.departTick) / DECISION_HZ;
  }

  private int(resident: number, field: number): number {
    return this.crowd.state.ints[resident * RESIDENT_INT_STRIDE + field]!;
  }

  private atDoor(place: number, out: Spot): boolean {
    if (place === NO_PLACE || place >= this.map.places.length) return false;
    const entry = this.map.places[place]!;
    if (entry.doorNode < 0) return false;
    out.x = entry.doorX;
    out.z = entry.doorZ;
    return true;
  }
}
