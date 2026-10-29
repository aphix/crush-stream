import { describe, expect, it } from "vitest";
import type { RaceBrain } from "../ai/race-ai.ts";
import { CAMPAIGN_POINTS } from "../match/campaign.ts";
import { FINISH_GRACE } from "../match/session.ts";
import type { DriveInput } from "../vehicle/car-drive.ts";
import { setGround } from "./ground.ts";
import { FRAME, frame, makeWorld, playerRace, type World } from "./race-world.test-util.ts";
import { hold } from "./survival-run.test-util.ts";
import { Track } from "./track.ts";
import oval from "./tracks/oval.json" with { type: "json" };

/**
 * Co-op races (docs/MULTIPLAYER.md, Co-op): the humans of a hosted room race the AI as one team. Each keeps its own place; the team's result is the
 * best human place, and the team wins when a human finishes first. Nobody has to finish: the finish and DNF rules end the race as they always did.
 * The host drives car 0 through its seat, a peer car 1 through `setRemoteInput` (here never touching its pedals); two AI cars drive themselves.
 */
const track = new Track(oval);
const LAPS = 2;
/** `aiCount` counts the field's cars besides the host's: the peer takes one of its places, so three leave two AI cars. */
const FIELD = 3;
const PARKED: DriveInput = { throttle: 0, steer: 0, brake: 1, ebrake: true, boost: false };

function coopWorld(): World {
  const w = makeWorld();
  w.race.enter();
  w.race.setSeats(new Map([[1, "Zed"]]));
  return w;
}

/** The AI cars answer no pedals but the brake, round after round: a human cannot be beaten by what does not race. */
function parkAi(w: World): void {
  const race = w.race as unknown as { brain: RaceBrain | null };
  const drive = w.race.drive.bind(w.race);
  w.race.drive = (dt) => {
    if (race.brain) race.brain.think = () => PARKED;
    drive(dt);
  };
}

function leave(w: World): void {
  w.race.exit();
  setGround(null);
}

describe("given a co-op race on the oval: the host and a peer who never touches the pedals against two AI cars", () => {
  it("when the scripted host drives flat out, then the team's place is the better of the two humans' places, the peer is a DNF, and the team won exactly when a human crossed first", (t) => {
    const w = coopWorld();
    t.onTestFinished(() => leave(w));
    const o = playerRace(w, track, { lat: 0 }, LAPS, FIELD, 240);
    const hud = w.race.hud();
    expect(hud.phase).toBe("finished");
    const rows = hud.results!;
    const humans = rows.filter((r) => r.kind !== "ai");
    t.annotate(`host P${o.you.place} ${o.you.status}; peer ${rows.find((r) => r.id === 1)!.status}; AI ${rows.filter((r) => r.kind === "ai").map((r) => `P${r.place} ${r.status}`)}`);
    expect(humans.length).toBe(2);
    expect(rows.length, "each car keeps its own row and place").toBe(4);
    const team = hud.team!;
    expect(team.humans).toBe(2);
    expect(team.free).toBe(0);
    expect(team.place).toBe(Math.min(...humans.map((r) => r.place)));
    expect(team.won).toBe(rows.find((r) => r.place === 1)!.kind !== "ai");
    expect(rows.find((r) => r.id === 1)!.status, "the peer was not asked to finish").toBe("dnf");
  });

  it("when the AI cars sit on the grid and the host drives flat out, then the host finishes first, the team won with place 1, and the race ends with the peer and the AI DNF", (t) => {
    const w = coopWorld();
    t.onTestFinished(() => leave(w));
    parkAi(w);
    const o = playerRace(w, track, { lat: 0 }, LAPS, FIELD, 240);
    expect(o.you.place).toBe(1);
    expect(o.you.status).toBe("finished");
    const hud = w.race.hud();
    expect(hud.team?.humans, "team humans").toBe(2);
    expect(hud.team?.free, "team free").toBe(0);
    expect(hud.team?.place, "team place").toBe(1);
    expect(hud.team?.won, "team won").toBe(true);
    expect(hud.winnerName).toBe(o.you.name);
    expect(hud.results!.filter((r) => r.id !== 0).every((r) => r.status === "dnf"), "nobody else finished, and the race still ended").toBeTruthy();
  });
});

describe("given a co-op race on the oval with both humans sitting on the grid", () => {
  it("when the AI cars finish and the grace after the winner runs out, then the race ends with both humans DNF and the team lost, its place the better of their two", (t) => {
    const w = coopWorld();
    t.onTestFinished(() => leave(w));
    w.race.command({ type: "options", options: { trackId: track.id, laps: LAPS, aiCount: FIELD, noReset: false } });
    w.race.command({ type: "start" });
    const state = { acc: 0 };
    const bound = 4.5 + LAPS * 3 * (track.length / 9) + FINISH_GRACE;
    for (let n = 0; n * FRAME < bound && w.race.phase !== "finished"; n++) {
      hold(w);
      frame(w, state);
    }
    const hud = w.race.hud();
    expect(hud.phase, "the race ended with nobody asked to finish").toBe("finished");
    const rows = hud.results!;
    expect(rows.filter((r) => r.kind === "ai").some((r) => r.place === 1), "an AI car won").toBeTruthy();
    const humans = rows.filter((r) => r.kind !== "ai");
    expect(humans.every((r) => r.status === "dnf")).toBeTruthy();
    const team = hud.team!;
    expect(team.humans).toBe(2);
    expect(team.free).toBe(0);
    expect(team.place).toBe(Math.min(...humans.map((r) => r.place)));
    expect(team.won).toBe(false);
  });
});

describe("given a co-op campaign whose first round is the oval, the peer sitting on the grid", () => {
  it("when the team does not win the round and the host presses Next, then the round is raced again with nothing scored; and when the host wins it, then Next scores the round and shows the standings", (t) => {
    const w = coopWorld();
    t.onTestFinished(() => leave(w));
    const toResults = (): void => {
      const state = { acc: 0 };
      for (let n = 0; n < 400 && w.race.hud().menu !== "results"; n++) frame(w, state);
      expect(w.race.hud().menu).toBe("results");
    };
    // The round with the AI racing and both humans sitting: the team loses it.
    w.race.command({ type: "options", options: { trackId: track.id, laps: 1, aiCount: FIELD, noReset: false } });
    w.race.command({ type: "campaign" });
    const state = { acc: 0 };
    for (let n = 0; n * FRAME < 600 && w.race.phase !== "finished"; n++) {
      hold(w);
      frame(w, state);
    }
    toResults();
    expect(w.race.hud().team!.won).toBe(false);
    w.race.command({ type: "next" });
    const again = w.race.hud();
    expect(again.mode).toBe("campaign");
    expect(again.campaign!.round, "the round did not count").toBe(0);
    expect(again.campaign!.standings.every((r) => r.points === 0), "nobody scored").toBeTruthy();
    expect(again.menu, "the round is on again").toBe(null);
    expect(again.phase).toBe("grid");
    // The same round replayed with the AI parked and the host driving: it wins, and Next scores it.
    parkAi(w);
    w.seat.intent.handbrake = false;
    const o = playerRace(w, track, { lat: 0 }, 1, FIELD, 240, null);
    expect(o.you.place).toBe(1);
    toResults();
    expect(w.race.hud().team!.won).toBe(true);
    w.race.command({ type: "next" });
    const after = w.race.hud();
    expect(after.menu).toBe("standings");
    expect(after.campaign!.round, "the round counted").toBe(1);
    expect(after.campaign!.standings.find((r) => r.id === 0)!.points).toBe(CAMPAIGN_POINTS[0]);
  });
});
