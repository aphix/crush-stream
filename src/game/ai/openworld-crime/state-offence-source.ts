import type { OpenWorldMap } from "../../world/openworld/walk-graph.ts";
import { CENTIMETRES_PER_METRE, DECISION_HZ, NEVER_TICK, NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE } from "../civilians/civilian-constants.ts";
import type { CityState } from "../civilians/civilian-state.ts";
import type { CrowdPoses } from "../civilians/crowd-poses.ts";
import { isWanted } from "../civilians/society-crime.ts";
import type { Spot } from "./offence-source.ts";

/** The crowd's owner: its society rows and its drawn poses. */
type CrowdView = { readonly state: CityState; readonly poses: CrowdPoses };

/** The law's reading of the society: crimes and fights are the brain's rows (`society-crime.ts`), a resident stands where the crowd draws them, else at their fight or crime place. */
export class StateOffenceSource {
  private readonly crowd: CrowdView;
  private readonly map: OpenWorldMap;

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
    return this.atDoor(this.int(resident, RESIDENT_INT.crimePlace), out) || this.atDoor(this.int(resident, RESIDENT_INT.place), out);
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
