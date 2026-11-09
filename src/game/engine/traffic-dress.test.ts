import { describe, expect, it } from "vitest";
import { TrafficDress } from "./traffic-dress.ts";

const RED = 0x7b1e24;
const BLUE = 0x24406e;

/** A dress that counts what it is asked. */
function counted() {
  const calls = { dress: 0, paint: [] as number[] };
  const dress = new TrafficDress<object>(
    () => void calls.dress++,
    (_car, colour) => void calls.paint.push(colour),
  );
  return { calls, dress };
}

describe("given a traffic car stood on a space again and again", () => {
  // mutation: sed -i 's/    if (worn === undefined || (worn !== null \&\& colour === null)) this.dress(car);/    this.dress(car);/' src/game/engine/traffic-dress.ts
  it("when it is stood in the same paint, then it is dressed once and never painted again", () => {
    const { calls, dress } = counted();
    const car = {};
    for (let time = 0; time < 50; time++) dress.stand(car, RED);
    expect(calls.dress, "full dresses").toBe(1);
    expect(calls.paint.length, "paints").toBe(1);
    const own = counted();
    for (let time = 0; time < 50; time++) own.dress.stand(car, null);
    expect(own.calls.dress, "its own paint: dressed once").toBe(1);
    expect(own.calls.paint.length, "its own paint: never painted").toBe(0);
  });

  // mutation: sed -i 's/    if (colour !== null \&\& worn !== colour) this.paint(car, colour);/    if (colour !== null) this.paint(car, colour);/' src/game/engine/traffic-dress.ts
  it("when its colour changes, then only the paint is redone", () => {
    const { calls, dress } = counted();
    const car = {};
    dress.stand(car, RED);
    dress.stand(car, BLUE);
    dress.stand(car, BLUE);
    expect(calls.dress, "full dresses").toBe(1);
    expect(calls.paint.length, "paints: red, then blue").toBe(2);
    expect(calls.paint[1], "the second paint").toBe(BLUE);
  });

  // mutation: sed -i 's/ || (worn !== null \&\& colour === null)) this.dress(car);/) this.dress(car);/' src/game/engine/traffic-dress.ts
  it("when a resident's paint is given up, then the car is dressed again to take its own back", () => {
    const { calls, dress } = counted();
    const car = {};
    dress.stand(car, RED);
    dress.stand(car, null);
    expect(calls.dress, "dressed to take its own paint back").toBe(2);
  });

  it("when another car is stood, then it is dressed on its own account", () => {
    const { calls, dress } = counted();
    dress.stand({}, RED);
    dress.stand({}, RED);
    expect(calls.dress).toBe(2);
  });
});
