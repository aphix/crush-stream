import { describe, expect, it } from "vitest";
import { allocatedBytes, untilQuiet } from "./alloc-sample.test-util.ts";
import { generalizeFields } from "./scalar.ts";

describe("given an object built with several kinds of field and one read-only field", () => {
  const build = () => {
    const o = { flag: false, count: 3, ratio: 0.25, name: "car", list: [1, 2], none: null as null | object, fixed: 0 };
    Object.defineProperty(o, "fixed", { value: 7, writable: false });
    return o;
  };

  // mutation: sed -i '/^    fields\[key\] = value;/d' src/game/kernel/scalar.ts
  it("when its fields are generalized, then every value is as it was, the same object stays the same object, and the read-only field is untouched", () => {
    const o = build();
    const list = o.list;
    generalizeFields(o);
    expect(o.flag, "flag").toBe(false);
    expect(o.count, "count").toBe(3);
    expect(o.ratio, "ratio").toBe(0.25);
    expect(o.name, "name").toBe("car");
    expect(o.list, "list is the same array").toBe(list);
    expect(o.none, "none").toBe(null);
    expect(o.fixed, "fixed").toBe(7);
  });

  // mutation: sed -i 's/^    if (own === undefined || !("value" in own) || own.writable !== true) continue;/    if (own === undefined) continue;/' src/game/kernel/scalar.ts
  it("when a getter-backed own field is met, then it is not written as a plain field", () => {
    const writes: unknown[] = [];
    const o = {};
    Object.defineProperty(o, "lazy", { get: () => 1, set: (v: unknown) => writes.push(v), enumerable: true });
    generalizeFields(o);
    expect(writes, "the setter never ran").toHaveLength(0);
  });
});

describe("given an object with a number field that a loop later writes fractions to", () => {
  const STORES = 50_000;
  /** The loop under the reading: a plain store of a fresh fraction each time. */
  const write = (o: { speed: number }): void => {
    for (let i = 0; i < STORES; i++) o.speed = i * 0.37 + 0.1;
  };

  // mutation: /usr/bin/sed -i 's/? 0.5 : undefined;/? undefined : undefined;/' src/game/kernel/scalar.ts
  it("when its fields are generalized, then storing fractions in the number field allocates nothing: it is still a raw double, not a tagged field that boxes every store", () => {
    const o = { speed: 0 };
    generalizeFields(o);
    const bytes = untilQuiet(() => allocatedBytes(() => write(o)), 4096);
    expect(bytes, `${bytes.toFixed(0)} B for ${STORES} stores`).toBeLessThanOrEqual(4096);
  });
});
