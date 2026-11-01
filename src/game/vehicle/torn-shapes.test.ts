import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { CAR_STYLE_IDS, type CarStyleId } from "./car-variants.ts";
import { growDrawn } from "./car-parts.ts";
import { boxShape } from "./loose-step.ts";
import { paint } from "./test-support.ts";

/** A torn part measured as it flies (its centre and half extents, and a weighted sum of its 20 shape points). */
type Shape = { centre: readonly number[]; half: readonly number[]; sum: number };

/** Metres, to the 4 decimals the table keeps; the point sum over its 60 coordinates is read at ten times that. */
const TOL = 6e-5;
const SUM_TOL = 1e-3;

/**
 * The sim reads the drawn kit for torn parts: a torn door and a torn arch panel fly as their drawn shells (`boxShape`), and a hung door is
 * lifted off the ground by its drawn box (`liftDoor`, `poseHung`, `growDrawn`). So the door skin's stand (`DOOR_PROUD`) and the arch lips
 * (`arch.lip`) are sim: this table is each style's door box (x extent) and its torn door's and front and rear arch panels' shapes. Change
 * either and these move: re-pin with a REPLAY entry. (Before the 2 mm door stand and the lip resizing the box minimum x of the sedan was -0.8194.)
 */
const SHAPES: Record<CarStyleId, { doorBoxX: readonly [number, number]; doorL: Shape; archFL: Shape; archRL: Shape }> = {
  sedan: { doorBoxX: [-0.8184, 0.195], doorL: { centre: [0.0705, 0.1753, -0.5], half: [0.1445, 0.5131, 0.52], sum: 0.3536 }, archFL: { centre: [0.2217, -0.0415, -0.0505], half: [0.3058, 0.3164, 0.4949], sum: -21.8457 }, archRL: { centre: [0.1955, 0.0067, 0.036], half: [0.3032, 0.3625, 0.4906], sum: -27.5993 } },
  hatchback: { doorBoxX: [-0.7977, 0.1258], doorL: { centre: [0.0374, 0.2006, -0.4475], half: [0.1084, 0.5084, 0.4575], sum: -4.4293 }, archFL: { centre: [0.2163, -0.0251, 0.0098], half: [0.2914, 0.2998, 0.441], sum: -21.6178 }, archRL: { centre: [0.0597, -0.0031, -0.0071], half: [0.1264, 0.3067, 0.4754], sum: -12.0662 } },
  wagon: { doorBoxX: [-0.836, 0.1385], doorL: { centre: [0.0422, 0.2128, -0.4925], half: [0.1164, 0.6006, 0.5025], sum: -5.3041 }, archFL: { centre: [0.0893, -0.0048, 0.0294], half: [0.1634, 0.3719, 0.5633], sum: -15.4116 }, archRL: { centre: [0.064, -0.028, -0.0079], half: [0.1367, 0.3702, 0.5451], sum: -10.2201 } },
  coupe: { doorBoxX: [-0.756, 0.1287], doorL: { centre: [0.0411, 0.1501, -0.555], half: [0.1077, 0.4929, 0.565], sum: -1.0686 }, archFL: { centre: [0.2369, -0.0386, 0.0082], half: [0.3258, 0.317, 0.4664], sum: -23.3347 }, archRL: { centre: [0.232, -0.0014, 0.02], half: [0.3181, 0.3394, 0.4853], sum: -22.8643 } },
  pickup: { doorBoxX: [-0.7633, 0.1533], doorL: { centre: [0.0382, 0.2295, -0.5112], half: [0.1351, 0.5723, 0.5888], sum: 1.6089 }, archFL: { centre: [0.0334, -0.0582, -0.0153], half: [0.1087, 0.2867, 0.5799], sum: -16.2184 }, archRL: { centre: [0.0346, -0.0865, -0.0014], half: [0.0994, 0.2865, 0.5433], sum: -5.7207 } },
  police: { doorBoxX: [-0.8184, 0.195], doorL: { centre: [0.0705, 0.1753, -0.5], half: [0.1445, 0.5131, 0.52], sum: 0.3536 }, archFL: { centre: [0.2217, -0.0415, -0.0505], half: [0.3058, 0.3164, 0.4949], sum: -21.8457 }, archRL: { centre: [0.1955, 0.0067, 0.036], half: [0.3032, 0.3625, 0.4906], sum: -27.5993 } },
  monster: { doorBoxX: [-0.8255, 0.1958], doorL: { centre: [0.0543, 0.191, -0.444], half: [0.1614, 0.5088, 0.454], sum: 3.9492 }, archFL: { centre: [0.0389, 0.0022, 0.0178], half: [0.1121, 0.3003, 0.5436], sum: -9.6102 }, archRL: { centre: [0.0485, 0.0059, 0.0064], half: [0.1135, 0.2951, 0.5809], sum: -9.8597 } },
};

describe("given each style's torn door and torn arch panels", () => {
  for (const id of CAR_STYLE_IDS) {
    it(`when the ${id}'s door box and its torn door and arch panels are measured, then they are the table's (the sim's, read off the drawn kit)`, () => {
      const car = new DeformableCar(paint(), new THREE.Scene(), null, id);
      const want = SHAPES[id];
      const box = new THREE.Box3();
      growDrawn(car["doorL"], box.makeEmpty());
      expect(box.min.x, `${id}: the door box's min x`).toBeCloseTo(want.doorBoxX[0], 4);
      expect(box.max.x, `${id}: the door box's max x`).toBeCloseTo(want.doorBoxX[1], 4);
      for (const name of ["doorL", "archFL", "archRL"] as const) {
        const part = car["parts"].find((p) => p.name === name)!;
        car["detachPart"](part, 0, new THREE.Vector3());
        boxShape(part.shape, part.object);
        const s = part.shape;
        let sum = 0;
        for (let i = 0; i < s.count * 3; i++) sum += s.points[i]! * (1 + (i % 7));
        const target = want[name];
        const got = [...s.centre.toArray(), ...s.half.toArray()];
        const wanted = [...target.centre, ...target.half];
        const worst = Math.max(...got.map((v, i) => Math.abs(v - wanted[i]!)));
        expect(worst, `${id} ${name}: centre and half extents off the table by ${worst.toFixed(5)} m`).toBeLessThan(TOL);
        expect(Math.abs(sum - target.sum), `${id} ${name}: the shape's point sum ${sum.toFixed(4)} against ${target.sum}`).toBeLessThan(SUM_TOL);
      }
      car.dispose();
    });
  }
});
