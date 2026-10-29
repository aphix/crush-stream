import { describe, expect, it } from "vitest";
import { setGround } from "./ground.ts";
import { FRAME, frame, makeWorld, type World } from "./race-world.test-util.ts";
import { Track } from "./track.ts";
import oval from "./tracks/oval.json" with { type: "json" };
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

/** Frames until the race is over or `bound` race seconds pass (grid and countdown included). */
function runOut(w: World, bound: number): void {
  const state = { acc: 0 };
  for (let n = 0; w.race.phase !== "finished" && n * FRAME < bound; n++) frame(w, state);
}

/** Race seconds the first police car may take to come out on the city course (it does at 14 s with field seed 2). */
const POLICE_BOUND = 40;
/** Seconds Auto runs among the police and traffic cars (it may switch about once a second). */
const AUTO_SECONDS = 10;

describe("given a 1-lap oval race of 4 AI rivals and the AI-driven player slot, with field seed 1", () => {
  it("when the race is run to its end, then it closes on laps with every car home on its single lap, placed and gapped by finish time", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "oval", laps: 1, aiCount: 4 } });
      w.race.reseed(1);
      w.race.command({ type: "start" });
      w.seat.mode = "follow";
      runOut(w, 4.5 + 3 * (new Track(oval).length / 9));
      const snap = w.race.snapshot()!;
      expect(snap.phase).toBe("finished");
      expect(snap.laps).toBe(1);
      expect(snap.winBy).toBe("laps");
      for (const c of snap.cars) {
        expect(c.status, `${c.name} is ${c.status}`).toBe("finished");
        expect(c.lap, `${c.name} laps`).toBe(1);
        expect(c.lapTimes.length, `${c.name} lap times`).toBe(1);
      }
      const rows = w.race.hud().results!;
      const byTime = [...snap.cars].sort((a, b) => a.finishTime! - b.finishTime!);
      expect(rows.map((r) => r.id).join(), "classified in finish-time order").toBe(byTime.map((c) => c.id).join());
      expect(firstMismatch(rows.map((r) => r.place), [1, 2, 3, 4, 5])).toBeUndefined();
      const win = byTime[0]!.finishTime!;
      for (const [k, r] of rows.entries()) expect(Math.abs(r.gap! - (byTime[k]!.finishTime! - win)), `P${r.place} gap ${r.gap}`).toBeLessThan(1e-9);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given a Watch race (spectator only) on the oval with 4 AI rivals and this browser's car racing as AI, field seed 1", () => {
  it("when the viewer cycles through the cars and the race runs out, then there is no player row, the camera follows pole, cycling reaches every car, and the race closes with an all-AI result", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "oval", laps: 1, aiCount: 4, spectate: true } });
      w.race.reseed(1);
      w.race.command({ type: "start" });
      expect(firstMismatch(w.race.racers.map((e) => e.kind), ["ai", "ai", "ai", "ai", "ai"]), "this browser's car races as AI").toBeUndefined();
      const pole = w.race.snapshot()!.cars.find((c) => c.grid === 0)!;
      let hud = w.race.hud();
      expect(hud.you).toBe(null);
      expect(w.seat.mode).toBe("follow");
      expect(w.seat.carIndex).toBe(pole.id);
      expect(hud.spectating).toBe(pole.name);
      const seen = new Set<number>();
      // Six entries: the other four cars, Auto (the car in view stays), then back to the first.
      for (let k = 0; k < 6; k++) {
        w.race.command({ type: "cycle", dir: 1 });
        seen.add(w.seat.carIndex);
      }
      expect(firstMismatch([...seen].sort(), [0, 1, 2, 3, 4]), "Q/E and the touch prev/next reach every car, our own AI one too").toBeUndefined();
      runOut(w, 4.5 + 3 * (new Track(oval).length / 9));
      hud = w.race.hud();
      expect(hud.phase).toBe("finished");
      expect(hud.results!.length).toBe(5);
      expect(hud.standings.every((r) => !r.you), "no You row").toBeTruthy();
      expect(hud.results!.every((r) => r.kind === "ai")).toBeTruthy();
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given an oval race of 2 AI rivals started first as a driving race and then as a Watch race", () => {
  it("when a car is picked by hand and a new Watch race starts, then a Watch start sets the driver and the camera to Auto, a driving start leaves both off, a hand pick overrides Auto, and each new Watch start re-applies it", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "oval", laps: 1, aiCount: 2, spectate: false } });
      w.race.reseed(1);
      w.race.command({ type: "start" });
      expect(w.race.hud().auto).toBe(false);
      expect(w.watchCams).toBe(0);
      w.race.command({ type: "options", options: { trackId: "oval", laps: 1, aiCount: 2, spectate: true } });
      w.race.command({ type: "start" });
      expect(w.race.hud().auto).toBe(true);
      expect(w.watchCams).toBe(1);
      w.race.command({ type: "cycle", dir: 1 });
      expect(w.race.hud().auto, "a hand pick overrides").toBe(false);
      w.race.command({ type: "start" });
      expect(w.race.hud().auto, "each new Watch start re-applies it").toBe(true);
      expect(w.watchCams).toBe(2);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given a Watch race on the oval with 4 AI rivals, whose driver list is the cars, then Auto, then back to car 0", () => {
  it("when the viewer cycles both ways and picks cars by hand or by the standings' Auto row, then Auto is one more entry (the car in view stays, named), a car pick turns it off, the Auto row turns it on, and Auto only switches to a car still racing, at most once a second", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "oval", laps: 1, aiCount: 4, spectate: true } });
      w.race.reseed(1);
      w.race.command({ type: "start" });
      w.race.command({ type: "watch", id: 0 });
      expect(w.race.hud().auto).toBe(false);
      for (let k = 0; k < 4; k++) w.race.command({ type: "cycle", dir: 1 });
      expect(w.seat.carIndex).toBe(4);
      expect(w.race.hud().auto).toBe(false);
      w.race.command({ type: "cycle", dir: 1 });
      let hud = w.race.hud();
      expect(hud.auto, "after the last car comes Auto").toBe(true);
      expect(w.seat.carIndex, "the car in view stays").toBe(4);
      expect(hud.spectating, "and is the one named").toBe(w.race.racers[4]!.name);
      w.race.command({ type: "cycle", dir: 1 });
      expect(w.seat.carIndex, "then the list wraps to car 0").toBe(0);
      expect(w.race.hud().auto).toBe(false);
      w.race.command({ type: "cycle", dir: -1 });
      expect(w.race.hud().auto, "backwards from car 0 is Auto").toBe(true);
      w.race.command({ type: "cycle", dir: -1 });
      expect(w.seat.carIndex).toBe(4);
      expect(w.race.hud().auto).toBe(false);
      w.race.command({ type: "watch", id: -1 });
      expect(w.race.hud().auto, "the standings' Auto row").toBe(true);
      expect(w.seat.carIndex).toBe(4);
      w.race.command({ type: "watch", id: 2 });
      expect(w.race.hud().auto, "a car picked by hand").toBe(false);
      expect(w.seat.carIndex).toBe(2);

      // Off, autoStep leaves the camera alone; on, it switches only to racing cars, no faster than once a second.
      const state = { acc: 0 };
      for (let n = 0; n < 300; n++) {
        frame(w, state);
        w.race.autoStep(-1, true);
      }
      expect(w.seat.carIndex).toBe(2);
      w.race.command({ type: "watch", id: -1 });
      let prev = w.seat.carIndex;
      let at = -Infinity;
      let switches = 0;
      const bound = 4.5 + 3 * (new Track(oval).length / 9);
      for (let n = 0; w.race.phase !== "finished" && n * FRAME < bound; n++) {
        frame(w, state);
        w.race.autoStep(-1, true);
        if (w.seat.carIndex === prev) continue;
        prev = w.seat.carIndex;
        switches++;
        expect(w.race.snapshot()!.cars.find((c) => c.id === prev)!.status, `switched to car ${prev} at ${w.race.time.toFixed(1)} s`).toBe("racing");
        expect(w.race.time - at, `two switches ${(w.race.time - at).toFixed(2)} s apart`).toBeGreaterThanOrEqual(1);
        at = w.race.time;
        hud = w.race.hud();
        expect(hud.auto).toBe(true);
        expect(hud.spectating).toBe(w.race.racers[prev]!.name);
      }
      expect(switches, "Auto never moved off its first car in a whole race").toBeGreaterThanOrEqual(1);
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given a Watch race on the city course with police and traffic cars among the racers", () => {
  it("when the viewer cycles with Q/E and Auto runs, then they visit racers only, never a police or traffic car", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "city", laps: 1, aiCount: 4, spectate: true, police: true } });
      w.race.reseed(2);
      w.race.command({ type: "start" });
      const state = { acc: 0 };
      const racers = w.race.racers.length;
      const policeOut = () => w.live().some((c, i) => i >= racers && c.group.visible && c.style.id === "police");
      // Police park beside the course from a third of the first lap on: the moment starts when the first one is out among the traffic.
      for (let n = 0; n < POLICE_BOUND / FRAME && !policeOut(); n++) frame(w, state);
      expect(policeOut(), `no police car came out within ${POLICE_BOUND} s`).toBeTruthy();
      expect(w.live().length, "the fixture has police and traffic cars past the racers").toBeGreaterThan(racers);
      w.race.command({ type: "watch", id: 0 });
      for (let k = 0; k < 3 * (racers + 1); k++) {
        w.race.command({ type: "cycle", dir: k % 2 === 0 ? 1 : -1 });
        expect(w.seat.carIndex, `cycling landed on car ${w.seat.carIndex}, past the ${racers} racers`).toBeLessThan(racers);
      }
      w.race.command({ type: "watch", id: -1 });
      for (let n = 0; n < AUTO_SECONDS / FRAME; n++) {
        frame(w, state);
        w.race.autoStep(-1, true);
        expect(w.seat.carIndex, `Auto picked car ${w.seat.carIndex} at ${w.race.time.toFixed(1)} s, past the ${racers} racers`).toBeLessThan(racers);
      }
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given a Watch campaign with 3 AI rivals and this browser's car racing as AI", () => {
  it("when the campaign starts, then it has no player row, a car under watch, and standings made of AI cars only", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { laps: 1, aiCount: 3, spectate: true } });
      w.race.command({ type: "campaign" });
      const hud = w.race.hud();
      expect(hud.mode).toBe("campaign");
      expect(hud.you).toBe(null);
      expect(hud.spectating).not.toBe(null);
      expect(firstMismatch(hud.campaign!.standings.map((r) => r.kind), ["ai", "ai", "ai", "ai"])).toBeUndefined();
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});

describe("given a 1-lap Watch race of 4 AI rivals on the oval with police cars on", () => {
  it("when the race runs out, then stakeouts park with sirens off, wake into pursuits with sirens on, Watch cycling never lands on them, police never race or appear in the results, and the race closes", () => {
    const w = makeWorld();
    w.race.enter();
    try {
      w.race.command({ type: "options", options: { trackId: "oval", laps: 1, aiCount: 4, spectate: true, police: true } });
      w.race.reseed(1);
      w.race.command({ type: "start" });
      const racers = w.race.racers.length;
      let parkedDark = 0;
      let chasingLit = 0;
      let watched = false;
      const state = { acc: 0 };
      const bound = 4.5 + 3 * (new Track(oval).length / 9);
      for (let n = 0; w.race.phase !== "finished" && n * FRAME < bound; n++) {
        frame(w, state);
        if (n % 30 !== 0) continue;
        const out = w.live().filter((c, i) => i >= racers && c.group.visible);
        expect(out.every((c) => c.style.id === "police"), "only police cars join the racers (oval has no traffic)").toBeTruthy();
        for (const c of out) {
          if (c.sirens) chasingLit++;
          else if (c.velocity.length() < 0.3) parkedDark++;
        }
        if (!watched && out.length > 0) {
          for (let k = 0; k < racers + out.length; k++) {
            w.race.command({ type: "cycle", dir: 1 });
            expect(w.seat.carIndex, `cycling reached car ${w.seat.carIndex}, a police car on the course`).toBeLessThan(racers);
          }
          watched = true;
        }
      }
      expect(w.race.phase, "the race closed").toBe("finished");
      expect(w.race.policeStats!.pursuits, `pursuits ${w.race.policeStats!.pursuits}`).toBeGreaterThanOrEqual(1);
      expect(parkedDark, "no parked police car with its sirens off was ever seen").toBeGreaterThan(0);
      expect(chasingLit, "no police car ever ran its sirens").toBeGreaterThan(0);
      const results = w.race.hud().results!;
      expect(results.length).toBe(racers);
      expect(results.every((r) => r.id < racers && w.live()[r.id]!.style.id !== "police"), "a police car is in the results").toBeTruthy();
    } finally {
      w.race.exit();
      setGround(null);
    }
  });
});
