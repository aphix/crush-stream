import { describe, expect, it } from "vitest";
import { LAYOUT } from "../../world/openworld/openworld-constants.ts";
import { openWorldGeometry } from "../../world/openworld/openworld-layout.ts";
import { buildParkingSpots, residentSpotAt } from "../../world/openworld/openworld-parking.ts";
import { buildRoadNetwork } from "../../world/openworld/openworld-roads.ts";
import { residentBody, residentCarPose, residentColour, type ResidentCarPose } from "./traffic-look.ts";
import { EVERYDAY_BODIES } from "./traffic-constants.ts";

const spots = buildParkingSpots(buildRoadNetwork(openWorldGeometry(LAYOUT)));
const DOOR = { x: -65, z: -45 };
const RESIDENTS = 40;
const blank = (): ResidentCarPose => ({ x: 0, z: 0, yaw: 0, groundY: -1, bodyStyle: "monster" });
const groundAt = (x: number, z: number): number => 0.01 * x + 0.02 * z;

describe("given a resident's parked car as the crowd reads it", () => {
  // mutation: sed -i 's/  out.groundY = groundAt(out.x, out.z);/  out.groundY = 0;/' src/game/ai/openworld-traffic/traffic-look.ts
  it("when the pose is asked for a resident at a place's door, then it is that resident's space: its middle, its yaw, the ground there and his body", () => {
    for (let resident = 0; resident < RESIDENTS; resident++) {
      const spot = residentSpotAt(spots, DOOR.x, DOOR.z, resident);
      const pose = blank();
      expect(residentCarPose(spots, DOOR.x, DOOR.z, resident, groundAt, pose), `resident ${resident} has a space`).toBe(true);
      expect(pose.x, `resident ${resident} x`).toBe(spots.x[spot]);
      expect(pose.z, `resident ${resident} z`).toBe(spots.z[spot]);
      expect(pose.yaw, `resident ${resident} yaw`).toBe(spots.yaw[spot]);
      expect(pose.groundY, `resident ${resident} ground`).toBe(groundAt(spots.x[spot]!, spots.z[spot]!));
      expect(pose.bodyStyle, `resident ${resident} body`).toBe(residentBody(resident));
    }
  });

  // mutation: sed -i 's/  return EVERYDAY_BODIES\[Math.floor(hash01(resident, RESIDENT_CAR_SEED)/  return EVERYDAY_BODIES[Math.floor(hash01(0, RESIDENT_CAR_SEED)/' src/game/ai/openworld-traffic/traffic-look.ts
  it("when a hundred residents are looked at, then each has an everyday body and a paint, and not all alike", () => {
    const bodies = new Set<string>();
    const colours = new Set<number>();
    for (let resident = 0; resident < 100; resident++) {
      expect(EVERYDAY_BODIES, `resident ${resident}`).toContain(residentBody(resident));
      bodies.add(residentBody(resident));
      colours.add(residentColour(resident));
    }
    expect(bodies.size, "bodies seen").toBeGreaterThan(1);
    expect(colours.size, "paints seen").toBeGreaterThan(2);
  });
});
