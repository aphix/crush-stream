import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { ALARM_DELAY_MIN_SECONDS, SPECIES } from "../ai/civilians/civilian-constants.ts";
import { LOOK } from "../ai/civilians/civilian-crowd-constants.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { FRAME_HZ } from "../kernel/constants.ts";
import { mulberry32 } from "../world/placements.ts";
import { emptyPoses } from "./civilian-art.test-util.ts";
import { CrowdGaze, STIMULUS } from "./civilian-gaze.ts";
import { ALIGN_SHIFT, HEAD_LATENCY_S, HEAD_YAW_LIMIT, HEAD_YAW_RATE, PITCH_LIMIT, PITCH_RATE, POLL_MASK, TORSO_RATE, TORSO_YAW_LIMIT } from "./civilian-gaze-constants.ts";
import { blankSenses, type GazeCar, type GazeSenses } from "./civilian-gaze-table.ts";

const FRAME = 1 / FRAME_HZ;
const TIGHT = 1e-6;
/** A look word whose head-mover bits are all set: her head turns the whole way, so where it points is where she looks. */
const HEAD_MOVER = 7 << ALIGN_SHIFT;

type Car = GazeCar & { group: { position: { x: number; y: number; z: number } }; velocity: { x: number; z: number } };

function car(x: number, z: number, vx: number): Car {
  return { group: { position: { x, y: 0, z } }, velocity: { x: vx, z: 0 }, sirens: false };
}

/** `count` people standing on the line z = 0 from x = -span/2 to span/2, facing +z (toward a street along x). */
function kerb(count: number, span: number): CrowdPoses {
  const poses = emptyPoses(count);
  for (let civilian = 0; civilian < count; civilian++) poses.x[civilian] = -span / 2 + (span * civilian) / (count - 1);
  return poses;
}

/** Their whole turn toward their +x (rad): the head's from the torso plus the torso's. */
const turnOf = (gaze: CrowdGaze, civilian: number): number => gaze.headYaw[civilian]! + gaze.torsoTwist[civilian]!;

/** Frames of `seconds` with `cars` driven along their velocity, `each` called after each frame with its time. */
function drive(gaze: CrowdGaze, poses: CrowdPoses, senses: GazeSenses, cars: readonly Car[], seconds: number, each: (time: number) => void = () => {}): void {
  for (let frame = 1; frame <= Math.round(seconds / FRAME); frame++) {
    for (const moving of cars) moving.group.position.x += moving.velocity.x * FRAME;
    gaze.update(poses, FRAME, senses);
    each(frame * FRAME);
  }
}

/** When each person first looked at a car (s, Infinity: never), as `cars` drive by for `seconds`. */
function carLookTimes(poses: CrowdPoses, cars: Car[], seconds: number, lineOfSight: GazeSenses["lineOfSight"] = null): number[] {
  const gaze = new CrowdGaze(poses.count);
  const senses = { ...blankSenses(), cars, lineOfSight };
  const first = new Array<number>(poses.count).fill(Infinity);
  drive(gaze, poses, senses, cars, seconds, (time) => {
    for (let civilian = 0; civilian < poses.count; civilian++) if (gaze.lookKind[civilian] === STIMULUS.car && first[civilian] === Infinity) first[civilian] = time;
  });
  return first;
}

describe("given people on a kerb facing the street", () => {
  const PEOPLE = 12;
  const SPAN = 20;

  it("when a car passes fast within a few metres, then every one of them turns to it within a poll and her head's latency of it coming within 15 m", () => {
    const poses = kerb(PEOPLE, SPAN);
    const fast = car(-80, 4, 25);
    const times = carLookTimes(poses, [fast], 6);
    const along15 = Math.sqrt(15 * 15 - 4 * 4);
    for (let civilian = 0; civilian < PEOPLE; civilian++) {
      // From 15 m its pull (0.4) beats a glance, a refusal after one, anything but a crash.
      const within15 = (poses.x[civilian]! - along15 + 80) / 25;
      expect(times[civilian], `person ${civilian} looked at the fast car`).toBeLessThan(Infinity);
      expect(times[civilian]! - within15, `person ${civilian}'s latency (s)`).toBeLessThan((POLL_MASK + 1) * FRAME + HEAD_LATENCY_S + 2 * FRAME);
    }
    // mutation: sed -i 's/  const fast = Math.min(1, Math.max(0, (speed - CAR_CALM_SPEED) \/ (CAR_FAST_SPEED - CAR_CALM_SPEED))) \* s\[SCRATCH.near\]!;/  const fast = 0;/' src/game/present/civilian-gaze-poll.ts
  });

  it("when a car drives by at town speed across the street, then nobody turns to it", () => {
    const poses = kerb(PEOPLE, SPAN);
    const times = carLookTimes(poses, [car(-80, 12, 10)], 16);
    expect(times.filter((time) => time < Infinity), "people who looked at an ordinary car").toEqual([]);
    // mutation: sed -i 's/^export const CAR_CALM_SPEED = 9;/export const CAR_CALM_SPEED = 0;/' src/game/present/civilian-gaze-constants.ts
  });

  it("when a fast car passes beyond a wall that hides it from half of them, then only those who can see it turn", () => {
    const poses = kerb(PEOPLE, SPAN);
    const wallHidesFrom = (ax: number): boolean => ax <= 0;
    const times = carLookTimes(poses, [car(-80, 8, 25)], 8, (ax) => !wallHidesFrom(ax));
    for (let civilian = 0; civilian < PEOPLE; civilian++) {
      if (poses.x[civilian]! > 0) expect(times[civilian], `person ${civilian} in the open`).toBeLessThan(Infinity);
      else expect(times[civilian], `person ${civilian} behind the wall`).toBe(Infinity);
    }
    // mutation: sed -i 's/    return lineOfSight(s\[SCRATCH.ownX\]!, s\[SCRATCH.ownZ\]!, s\[SCRATCH.x\]!, s\[SCRATCH.z\]!);/    return true;/' src/game/present/civilian-gaze.ts
  });
});

describe("given a crowd scattered round a spot, facing every way", () => {
  const PEOPLE = 80;

  function scattered(): CrowdPoses {
    const poses = emptyPoses(PEOPLE);
    const random = mulberry32(5);
    for (let civilian = 0; civilian < PEOPLE; civilian++) {
      const angle = random() * Math.PI * 2;
      const distance = 3 + random() * 25;
      poses.x[civilian] = Math.cos(angle) * distance;
      poses.z[civilian] = Math.sin(angle) * distance;
      poses.yaw[civilian] = random() * Math.PI * 2;
    }
    return poses;
  }

  it("when a crash pulses there, then most heads but not all turn to it, each after her own delay", () => {
    const poses = scattered();
    const gaze = new CrowdGaze(PEOPLE);
    const senses = blankSenses();
    drive(gaze, poses, senses, [], 0.5);
    gaze.pulse(STIMULUS.crash, 0, 1, 0, 40, 1);
    const first = new Array<number>(PEOPLE).fill(Infinity);
    drive(gaze, poses, senses, [], 3, (time) => {
      for (let civilian = 0; civilian < PEOPLE; civilian++) if (gaze.lookKind[civilian] === STIMULUS.crash && first[civilian] === Infinity) first[civilian] = time;
    });
    const reacted = first.filter((time) => time < Infinity);
    expect(reacted.length / PEOPLE, "share who looked").toBeGreaterThan(0.5);
    expect(reacted.length, "some never look").toBeLessThan(PEOPLE);
    expect(Math.min(...reacted), "the quickest").toBeGreaterThanOrEqual(ALARM_DELAY_MIN_SECONDS - TIGHT);
    expect(Math.max(...reacted) - Math.min(...reacted), "spread of the reactions (s)").toBeGreaterThan(0.5);
    expect(new Set(reacted).size, "distinct moments").toBeGreaterThan(reacted.length / 2);
    // mutation: sed -i 's/      if (hash16(civilian, this.serial ^ SALT.react) >= share \* HASH16) continue;//' src/game/present/civilian-gaze.ts
  });
});

describe("given one person and a look that jumps every 0.3 s to a random point all round her, above and below, at uneven frame lengths", () => {
  it("when it plays for a minute, then her head stays within its limits and never turns faster than its rates", () => {
    const poses = emptyPoses(1);
    const gaze = new CrowdGaze(1);
    const senses = blankSenses();
    const random = mulberry32(3);
    let last = { turn: 0, torso: 0, pitch: 0 };
    for (let frame = 0, time = 0, next = 0; time < 60; frame++) {
      const dt = frame % 97 === 0 ? 0.25 : frame % 3 === 0 ? 1 / 30 : FRAME;
      time += dt;
      if (time >= next) {
        next = time + 0.3;
        const angle = random() * Math.PI * 2;
        gaze.attend(0, Math.sin(angle) * 5, 1.6 + (random() - 0.5) * 12, Math.cos(angle) * 5, 1, 1);
      }
      gaze.update(poses, dt, senses);
      const step = Math.min(dt, 0.1);
      const now = { turn: turnOf(gaze, 0), torso: gaze.torsoTwist[0]!, pitch: gaze.headPitch[0]! };
      expect(Math.abs(gaze.headYaw[0]!), "head yaw").toBeLessThanOrEqual(HEAD_YAW_LIMIT + TIGHT);
      expect(Math.abs(now.torso), "torso yaw").toBeLessThanOrEqual(TORSO_YAW_LIMIT + TIGHT);
      expect(Math.abs(now.pitch), "pitch").toBeLessThanOrEqual(PITCH_LIMIT + TIGHT);
      expect(Math.abs(now.turn - last.turn), `turn step at ${time.toFixed(2)} s`).toBeLessThanOrEqual(HEAD_YAW_RATE * step + TIGHT);
      expect(Math.abs(now.torso - last.torso), "torso step").toBeLessThanOrEqual(TORSO_RATE * step + TIGHT);
      // The pitch is drawn as eased (no longer scaled by the cosine of the turn), so its step is its own rate's.
      expect(Math.abs(now.pitch - last.pitch), "pitch step").toBeLessThanOrEqual(PITCH_RATE * step + TIGHT);
      last = now;
    }
    // mutation: sed -i 's/      this.angle\[at\] = Math.max(from - rate \* t, Math.min(from + rate \* t, eased));/      this.angle[at] = this.goal[channel]!;/' src/game/present/civilian-gaze.ts
  });
});

describe("given one person standing and something low on the ground behind her to her left", () => {
  // mutation: sed -i 's/    this.headPitch\[civilian\] = this.angle\[at + PITCH\]!;/    this.headPitch[civilian] = this.angle[at + PITCH]! * Math.cos(turn);/' src/game/present/civilian-gaze.ts
  it("when she is asked to look at it, then she turns past 90 degrees and nods down at it, not up", () => {
    const poses = emptyPoses(1);
    poses.look[0] = HEAD_MOVER;
    const gaze = new CrowdGaze(1);
    const senses = blankSenses();
    gaze.attend(0, -2, 0, -2, 3, 1);
    for (let frame = 0; frame < 2 / FRAME; frame++) gaze.update(poses, FRAME, senses);
    expect(Math.abs(turnOf(gaze, 0)), "her turn (rad)").toBeGreaterThan(Math.PI / 2);
    expect(gaze.headPitch[0], "her nod, down positive (rad)").toBeGreaterThan(0.3);
  });
});

describe("given two people talking, one turned 50 degrees from the other, with town traffic and passers-by about", () => {
  it("when a minute passes, then she looks at her partner most of the time", () => {
    const poses = emptyPoses(8);
    poses.look[0] = HEAD_MOVER;
    const bearing = (50 * Math.PI) / 180;
    poses.x[1] = Math.sin(bearing) * 1.2;
    poses.z[1] = Math.cos(bearing) * 1.2;
    poses.yaw[1] = Math.PI + bearing;
    poses.partner[0] = 1;
    poses.partner[1] = 0;
    poses.activity[0] = poses.activity[1] = ACTIVITY.talk;
    for (let walker = 2; walker < 8; walker++) {
      poses.x[walker] = -6 + walker;
      poses.z[walker] = 3;
      poses.speed[walker] = 1.4;
      poses.yaw[walker] = Math.PI / 2;
    }
    const gaze = new CrowdGaze(8);
    const traffic = [car(-200, 9, 10), car(-120, 9, 11), car(-40, 9, 9)];
    let onPartner = 0;
    let frames = 0;
    drive(gaze, poses, { ...blankSenses(), cars: traffic, player: true, playerX: 4, playerY: 1.55, playerZ: 6 }, traffic, 60, (time) => {
      for (let walker = 2; walker < 8; walker++) poses.x[walker] = ((-6 + walker + 1.4 * time + 10) % 20) - 10;
      if (time < 1) return;
      frames++;
      if (Math.abs(turnOf(gaze, 0) - bearing) < 0.15) onPartner++;
    });
    expect(onPartner / frames, "share of the minute on her partner").toBeGreaterThan(0.65);
    // mutation: sed -i 's/    if (partner >= 0 \&\& partner < poses.count \&\& poses.shown\[partner\] === 1) {/    if (false) {/' src/game/present/civilian-gaze.ts
  });
});

describe("given people on a kerb and the player on foot standing 8 m in front of them", () => {
  // mutation: sed -i 's/s\[SCRATCH.trial\] = NOTICE_FLOOR + (PLAYER_URGENCY - NOTICE_FLOOR) \* s\[SCRATCH.near\]!;/s[SCRATCH.trial] = PLAYER_URGENCY * s[SCRATCH.near]!;/' src/game/present/civilian-gaze-poll.ts
  it("when 20 s pass, then some of them look at him: 8 m is inside the 10 m at which he is noticed", () => {
    const poses = kerb(12, 20);
    const gaze = new CrowdGaze(poses.count);
    const looked = new Set<number>();
    drive(gaze, poses, { ...blankSenses(), player: true, playerX: 0, playerY: 1.55, playerZ: 8 }, [], 20, () => {
      for (let civilian = 0; civilian < poses.count; civilian++) if (gaze.lookKind[civilian] === STIMULUS.player) looked.add(civilian);
    });
    expect(looked.size, "people who looked at him").toBeGreaterThanOrEqual(3);
  });
});

describe("given people standing apart with nothing about them", () => {
  /** The idle glances they begin in 60 s of frames `dt` long. */
  function glances(dt: number): number {
    const poses = kerb(12, 40);
    const gaze = new CrowdGaze(poses.count);
    const senses = blankSenses();
    let begun = 0;
    for (let frame = 0; frame < Math.round(60 / dt); frame++) {
      const before = Array.from(gaze.lookKind);
      gaze.update(poses, dt, senses);
      for (let civilian = 0; civilian < poses.count; civilian++) if (gaze.lookKind[civilian] === STIMULUS.glance && before[civilian] !== STIMULUS.glance) begun++;
    }
    return begun;
  }

  // mutation: sed -i 's/GLANCE_SHARE \* freedom \* FRAME_HZ \* s\[SCRATCH.frameSeconds\]! \* HASH16/GLANCE_SHARE * freedom * HASH16/' src/game/present/civilian-gaze-poll.ts
  it("when a minute is played at 60 and at 240 frames a second, then they glance about as often at both: within 25 %", () => {
    const at60 = glances(FRAME);
    const at240 = glances(FRAME / 4);
    expect(at60, "control: glances at 60 Hz").toBeGreaterThan(20);
    expect(Math.abs(at240 - at60) / at60, `glances: ${at60} at 60 Hz, ${at240} at 240 Hz`).toBeLessThanOrEqual(0.25);
  });
});

describe("given a person standing free on a kerb and a dog trotting back and forth along it in front of her", () => {
  // mutation: sed -i 's/^      if (poses.shown\[civilian\] === 0) continue;$/      if (poses.shown[civilian] === 0 || poses.look[civilian]! >>> LOOK.speciesShift !== SPECIES.person) continue;/' src/game/present/civilian-gaze-poll.ts
  it("when a minute passes, then she glances at the dog, nodding down at it, and the dog looks at nothing", () => {
    const poses = emptyPoses(2);
    poses.look[0] = HEAD_MOVER;
    poses.look[1] = (SPECIES.dog << LOOK.speciesShift) >>> 0;
    poses.z[1] = 2;
    poses.speed[1] = 1.5;
    const gaze = new CrowdGaze(2);
    let atDog = 0;
    let nodded = 0;
    let dogLooked = 0;
    drive(gaze, poses, blankSenses(), [], 60, (time) => {
      // Back and forth across her front, 3 m either way.
      const leg = (1.5 * time) % 12;
      poses.x[1] = leg < 6 ? leg - 3 : 9 - leg;
      poses.yaw[1] = leg < 6 ? Math.PI / 2 : -Math.PI / 2;
      if (gaze.lookKind[0] === STIMULUS.person && gaze.lookSource[0] === 1) {
        atDog++;
        if (gaze.headPitch[0]! > 0.2) nodded++;
      }
      if (gaze.lookKind[1] !== STIMULUS.none) dogLooked++;
    });
    expect(atDog, "frames she looked at the dog").toBeGreaterThan(0);
    expect(nodded, "frames she nodded down at it").toBeGreaterThan(0);
    expect(dogLooked, "frames the dog looked at something").toBe(0);
  });
});
