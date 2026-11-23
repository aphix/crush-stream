import { describe, expect, it } from "vitest";
import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import { createCrowdPoses, type CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { addBodyRecord, addHidden, BODY_FLAG, BODY_KIND, BODY_POSTURE, clearBodyFrame, makeBodyFrame, readBodyFrame, writeBodyFrame, type BodyFrame } from "../net/body-codec.ts";
import { Reader, Writer } from "../net/codec.ts";
import { INTERP_DELAY } from "../net/net-constants.ts";
import type { FigureStrike } from "../scenes/figure-strike.ts";
import { TORSO_ABOVE_FEET } from "./body-follow.ts";
import { FakeBodyHost } from "./openworld-bodies.test-util.ts";
import { OpenWorldBodies } from "./openworld-bodies.ts";
import { DRAWN, OpenWorldShared, writePoseRows } from "./openworld-shared.ts";

const STEP = 1 / 30;
const CAPACITY = 8;
const HOST_BODIES = 4;
const PHONE_BODIES = 3;
const EYE_AWAY_M = 20;
const FAR_EYE_AWAY_M = 60;
const HAUL_MPS = 2;
const CIVILIAN_KINDS = 1 << BODY_KIND.civilian;
const PLAIN_LOOK = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
const CLOSE_M = 0.5;

/** A host the record is written from by hand: where one more civilian the host's hook holds stands and how. */
type HandRecord = { civilian: number; x: number; z: number; posture: number };

const strikeOn = (guard: number): FigureStrike => ({ guard, car: 0, x: 0, y: 0, z: 0, faceX: 0, faceZ: 1, vx: 0, vy: 0, vz: 8, wx: 0, wy: 0, wz: 0, loose: false });

/** A host's and a guest's bodies, each on a world of its own, over one crowd; the host's frame is heard by the guest each step. The guest's eye stands `eyeAway` m from the origin, along z. */
class Rig {
  readonly poses = createCrowdPoses(CAPACITY);
  readonly hostFake = new FakeBodyHost();
  readonly guestFake = new FakeBodyHost();
  readonly hostBodies = new OpenWorldBodies(this.hostFake, [], CAPACITY, HOST_BODIES);
  readonly guestBodies: OpenWorldBodies;
  readonly shared: OpenWorldShared;
  readonly frame = makeBodyFrame();
  readonly handWritten: HandRecord[] = [];
  /** The host slot a cable holds: its body is not steered back to her crowd spot, as a taut cable overpowers its motors. */
  cableSlot = -1;
  /** What the host writes; false: an empty frame. */
  hostWrites = true;
  readonly eyeZ: number;
  seconds = 0;

  constructor(guestBodies: number, eyeAway: number) {
    this.eyeZ = eyeAway;
    this.guestBodies = new OpenWorldBodies(this.guestFake, [], CAPACITY, guestBodies);
    this.shared = new OpenWorldShared(CAPACITY, { bodies: this.guestBodies, host: this.guestFake, tables: [this.poses, null, null, null], sight: { seen: () => true }, floors: null, ports: { lookOf: (_kind, _id, out) => Object.assign(out, PLAIN_LOOK) } });
  }

  /** The host steps and writes its frame, the guest hears it, places it and steps. */
  step(): void {
    this.seconds += STEP;
    this.hostBodies.step(this.poses, 0, 0, this.seconds, STEP);
    if (this.cableSlot >= 0) this.hostFake.steer(this.cableSlot, 0, 0);
    this.hostFake.advance(STEP);
    clearBodyFrame(this.frame);
    if (this.hostWrites) this.hostBodies.writeHooked(this.frame);
    for (const record of this.handWritten) this.writeByHand(record);
    this.frame.crowdTime = this.seconds;
    this.shared.hear(this.frame, this.seconds);
    const guestSeconds = this.seconds - INTERP_DELAY;
    this.shared.bodyRecords(this.shared.fresh(this.seconds) ? this.shared.frame : null, CIVILIAN_KINDS, -1, guestSeconds, 0, this.eyeZ);
    this.guestBodies.step(this.poses, 0, this.eyeZ, guestSeconds, STEP, { seen: () => true });
    this.guestFake.advance(STEP);
  }

  run(seconds: number): void {
    for (let step = 0; step < Math.round(seconds / STEP); step++) this.step();
  }

  private writeByHand(record: HandRecord): void {
    const at = addBodyRecord(this.frame, BODY_KIND.civilian, record.civilian, record.posture | BODY_FLAG.roped);
    this.frame.pos.set([record.x, TORSO_ABOVE_FEET, record.z], 3 * at);
  }
}

/** A civilian at (x, z) standing on the street, shown. */
function standing(rig: Rig, civilian: number, x: number, z: number): void {
  rig.poses.x[civilian] = x;
  rig.poses.z[civilian] = z;
  rig.poses.speed[civilian] = 0;
  rig.poses.shown[civilian] = 1;
  rig.poses.activity[civilian] = ACTIVITY.none;
  rig.poses.feetY[civilian] = 0;
}

/** How far the guest's body for civilian 0 is from the host's body in `hostSlot` (m). */
function gapBetweenBodies(rig: Rig, hostSlot: number): number {
  const host = rig.hostFake.bodies.get(hostSlot)!;
  const guest = rig.guestFake.bodies.get(rig.guestBodies.slotOf(0))!;
  return hypot2(guest.x - host.x, guest.z - host.z);
}

/** Civilian 0 stands at the origin; the host's hook takes her, a cable hauls her at 2 m/s along +x; the guest's eye is `eyeAway` m off. Her slot in the host's world. */
function hauledByTheHost(rig: Rig): number {
  standing(rig, 0, 0, 0);
  const slot = rig.hostBodies.stand(rig.poses, 0, 0, 0);
  rig.hostFake.ropedSlots.add(slot);
  rig.hostFake.haul(slot, HAUL_MPS, 0);
  rig.cableSlot = slot;
  return slot;
}

/** The most the two bodies are apart over `seconds` of steps. */
function widestGap(rig: Rig, hostSlot: number, seconds: number): number {
  let widest = 0;
  for (let step = 0; step < Math.round(seconds / STEP); step++) {
    rig.step();
    widest = Math.max(widest, gapBetweenBodies(rig, hostSlot));
  }
  return widest;
}

describe("given a civilian the host's hook holds 20 m from a guest's eye, in its sight", () => {
  it("when the host's cable hauls her 2 m/s along the street for 3 s, then pulls her off her feet and drags her 1 s, then from 0.5 s on the guest's body for her is within 0.5 m of the host's, it lies within one frame of the host's lying, and the guest's art is told not to draw her; and when the host's body is moved 5 m in one step, then the guest's stands at the new place on the next step", () => {
    const rig = new Rig(PHONE_BODIES, EYE_AWAY_M);
    const slot = hauledByTheHost(rig);
    rig.run(0.5);
    expect(rig.guestBodies.has(0), "the guest has a body for her").toBe(true);
    expect(widestGap(rig, slot, 2.5), "widest gap while she is hauled upright (m)").toBeLessThan(CLOSE_M);
    expect(rig.guestBodies.held[0], "the guest's art is told not to draw her").toBe(1);
    rig.hostFake.fell(slot);
    rig.step();
    rig.step();
    expect(rig.guestFake.bodies.get(rig.guestBodies.slotOf(0))!.standing, "the guest's body lies within one frame of the host's").toBe(false);
    expect(widestGap(rig, slot, 1), "widest gap while she is dragged lying (m)").toBeLessThan(CLOSE_M);
    rig.hostFake.shift(slot, 5, 0, 0);
    rig.step();
    expect(gapBetweenBodies(rig, slot), "gap one step after the host's body was moved 5 m (m)").toBeLessThan(CLOSE_M);
  });

  it("when the host's next frame no longer has her, then the guest's body is the guest's own again and is kept though it is 10 m behind her crowd spot", () => {
    const rig = new Rig(PHONE_BODIES, EYE_AWAY_M);
    const slot = hauledByTheHost(rig);
    rig.run(1.5);
    expect(rig.guestBodies.followedCount(), "control: her body follows the host's record").toBe(1);
    const guestSlot = rig.guestBodies.slotOf(0);
    rig.poses.x[0] = rig.guestFake.bodies.get(guestSlot)!.x + 10;
    rig.hostWrites = false;
    rig.step();
    expect(rig.guestBodies.followedCount(), "no body follows a record").toBe(0);
    rig.run(1);
    expect(rig.guestBodies.slotOf(0), "she keeps the same body, 10 m behind her spot").toBe(guestSlot);
    expect(rig.guestFake.stopped, "no body of the guest's was let go").toHaveLength(0);
    expect(rig.hostFake.bodies.get(slot)!.out, "control: the host still has hers").toBe(true);
  });
});

describe("given a phone guest whose three bodies are its own civilians, the nearest of them lying where a car struck her, and a fourth civilian the host's hook holds beside it", () => {
  it("when the guest shares the frame, then its farthest standing body is given up, a body stands for her at the host's place, and the lying one stays; and with every body lying or already following a record, the next shared civilian is drawn by the art at the host's place, laid flat while the host has her down and upright while she stands, never at her crowd spot", () => {
    const rig = new Rig(PHONE_BODIES, 0);
    for (let civilian = 0; civilian < 3; civilian++) standing(rig, civilian, 3 + 3 * civilian, 0);
    standing(rig, 3, 12, 0);
    rig.hostWrites = false;
    rig.run(0.5);
    expect([rig.guestBodies.has(0), rig.guestBodies.has(1), rig.guestBodies.has(2)], "control: its three nearest have bodies of its own").toEqual([true, true, true]);
    rig.guestBodies.knock(strikeOn(0));
    rig.handWritten.push({ civilian: 3, x: 4, z: 5, posture: BODY_POSTURE.stand });
    rig.run(0.5);
    expect(rig.guestBodies.has(2), "the farthest standing body is given up").toBe(false);
    expect([rig.guestBodies.has(0), rig.guestBodies.has(1), rig.guestBodies.has(3)], "the lying one stays, and one stands for the hooked civilian").toEqual([true, true, true]);
    const started = rig.guestFake.started.at(-1)!;
    expect(hypot2(started.x - 4, started.z - 5), "her body starts at the host's place (m)").toBeLessThan(CLOSE_M);
    rig.guestBodies.knock(strikeOn(1));
    standing(rig, 4, 25, 25);
    rig.handWritten.push({ civilian: 4, x: 6, z: -4, posture: BODY_POSTURE.stand });
    rig.run(0.2);
    expect(rig.guestBodies.has(4), "no body could be given up for her").toBe(false);
    expect(rig.poses.shown[4], "the art draws her").toBe(1);
    expect(hypot2(rig.poses.x[4]! - 6, rig.poses.z[4]! + 4), "upright at the host's place, not her crowd spot (m)").toBeLessThan(CLOSE_M);
    expect(rig.poses.lying[4], "upright while she stands").toBe(0);
    const at = { x: 0, z: 0 };
    expect(rig.shared.drawnAt(4, at), "she is drawn as a figure").toBe(DRAWN.figure);
    rig.handWritten[1]!.posture = BODY_POSTURE.down;
    rig.run(0.2);
    expect(rig.poses.lying[4], "laid flat while the host has her down").toBe(1);
    expect(rig.poses.z[4]! + 4 + TORSO_ABOVE_FEET, "her feet stand behind her torso, her head along the heading (m)").toBeCloseTo(0, 2);
  });
});

describe("given a guest whose eye is 60 m from the civilian the host's hook holds", () => {
  it("when the host's body stands and is hauled, then the guest stands no body for her and its art draws her at the host's place, not at her crowd spot", () => {
    const rig = new Rig(PHONE_BODIES, FAR_EYE_AWAY_M);
    const slot = hauledByTheHost(rig);
    const crowdSpotX = rig.poses.x[0]!;
    rig.run(3);
    const host = rig.hostFake.bodies.get(slot)!;
    expect(host.x - crowdSpotX, "control: the host's body has been hauled away from her crowd spot (m)").toBeGreaterThan(4);
    expect(rig.guestBodies.has(0), "the guest stands no body for her").toBe(false);
    expect(rig.poses.shown[0], "the art draws her").toBe(1);
    expect(Math.abs(rig.poses.x[0]! - host.x), "at the host's place, not her crowd spot (m)").toBeLessThan(CLOSE_M);
    expect(rig.shared.drawnAt(0, { x: 0, z: 0 }), "as a figure").toBe(DRAWN.figure);
  });
});

/** The cop's pace (m/s), the frame's age (s) at the guest, and what a centimetre-quantised wire and a facing step allow: the place within a centimetre (m), the facing within 1.4 degrees (rad). */
const COP_PACE = 1.4;
const FRAME_AGE_S = 0.1;
const WIRE_CM = 0.011;
const FACING_STEP = (1.4 * Math.PI) / 180;
const HOST_COPS = 4;
const MEDIC_COUNT = 2;
const KNEEL_AT = { x: 30, z: -12 };

/** `host` (a table the writer turns into a frame) sent through the wire into a frame a guest reads. */
function throughWire(host: BodyFrame): BodyFrame {
  const writer = new Writer(2048);
  writeBodyFrame(writer, host);
  const guest = makeBodyFrame();
  expect(readBodyFrame(writer.done().slice(), new Reader(), guest), "the guest reads the frame").toBe(true);
  return guest;
}

/** A table's row `row` shown at (x, z) facing `yaw`, pacing `speed`, acting `activity`. */
function showRow(table: CrowdPoses, row: number, x: number, z: number, yaw: number, speed: number, activity: number): void {
  table.shown[row] = 1;
  table.x[row] = x;
  table.z[row] = z;
  table.feetY[row] = 0;
  table.yaw[row] = yaw;
  table.speed[row] = speed;
  table.activity[row] = activity;
}

describe("given a host whose cop walks at 1.4 m/s with a civilian beside him, both written as pose records, a third civilian hidden, and a guest whose own tables show that cop elsewhere and another cop the host does not show", () => {
  it("when the guest applies the frame 0.1 s old, then its rows for that cop and that civilian are within 1 cm of the host's place moved 0.14 m along his heading, with the host's facing within 1.4 degrees, its pace and its activity; the other cop is not shown; the hidden civilian is not shown; and a civilian the frame does not name is shown as the guest's crowd left her", () => {
    const yaw = 0.7;
    const hostCops = createCrowdPoses(HOST_COPS);
    const hostCrowd = createCrowdPoses(CAPACITY);
    showRow(hostCops, 0, 10, 20, yaw, COP_PACE, ACTIVITY.idle);
    showRow(hostCrowd, 2, 11, 20.5, yaw, COP_PACE, ACTIVITY.kneel);
    const frame = makeBodyFrame();
    frame.crowdTime = 50;
    writePoseRows(frame, BODY_KIND.cop, hostCops, null, 0);
    writePoseRows(frame, BODY_KIND.civilian, hostCrowd, Int16Array.of(2, 3, -1), 3);
    addHidden(frame, 3);
    const heard = throughWire(frame);
    const guestCops = createCrowdPoses(HOST_COPS);
    const guestCrowd = createCrowdPoses(CAPACITY);
    showRow(guestCops, 0, -40, 5, 2, 0, ACTIVITY.none);
    showRow(guestCops, 1, -42, 5, 2, 0, ACTIVITY.none);
    showRow(guestCrowd, 2, -40, 6, 2, 0, ACTIVITY.none);
    showRow(guestCrowd, 3, -41, 6, 2, 0, ACTIVITY.none);
    showRow(guestCrowd, 5, 77, 88, 1, 0.5, ACTIVITY.none);
    const shared = new OpenWorldShared(CAPACITY, { bodies: null, host: null, tables: [guestCrowd, null, guestCops, null], sight: { seen: () => true }, floors: null, ports: { lookOf: () => {} } });
    shared.poseRows(heard, BODY_KIND.civilian, guestCrowd, false, 50 + FRAME_AGE_S, STEP);
    shared.poseRows(heard, BODY_KIND.cop, guestCops, true, 50 + FRAME_AGE_S, STEP);
    shared.hide(heard, guestCrowd);
    const ahead = COP_PACE * FRAME_AGE_S;
    for (const [table, row, x, z, activity] of [[guestCops, 0, 10, 20, ACTIVITY.idle], [guestCrowd, 2, 11, 20.5, ACTIVITY.kneel]] as const) {
      expect(table.shown[row], `row ${row} is shown`).toBe(1);
      expect(Math.abs(table.x[row]! - (x + detSin(yaw) * ahead)), `row ${row}: x (m)`).toBeLessThan(WIRE_CM);
      expect(Math.abs(table.z[row]! - (z + detCos(yaw) * ahead)), `row ${row}: z (m)`).toBeLessThan(WIRE_CM);
      expect(Math.abs(table.yaw[row]! - yaw), `row ${row}: facing (rad)`).toBeLessThanOrEqual(FACING_STEP);
      expect(Math.abs(table.speed[row]! - COP_PACE), `row ${row}: pace (m/s)`).toBeLessThan(WIRE_CM);
      expect(table.activity[row], `row ${row}: activity`).toBe(activity);
      expect(table.partner[row], `row ${row}: no partner`).toBe(-1);
    }
    expect(guestCops.shown[1], "the cop the host does not show is not shown").toBe(0);
    expect(guestCrowd.shown[3], "the hidden civilian is not shown").toBe(0);
    expect([guestCrowd.shown[5], guestCrowd.x[5], guestCrowd.z[5]], "a civilian the frame does not name stays as the guest's crowd left her").toEqual([1, 77, 88]);
  });
});

describe("given a guest with medics kneeling at its own scene and a frame whose two medic pose records kneel 30 m away", () => {
  it("when the guest applies it, then its medics kneel where the host's do; and with a frame that has no medic record, then none is shown", () => {
    const hostMedics = createCrowdPoses(MEDIC_COUNT);
    for (let medic = 0; medic < MEDIC_COUNT; medic++) showRow(hostMedics, medic, KNEEL_AT.x + 0.7 * medic, KNEEL_AT.z, 1.5, 0, ACTIVITY.kneel);
    const frame = makeBodyFrame();
    frame.crowdTime = 10;
    writePoseRows(frame, BODY_KIND.medic, hostMedics, null, 0);
    const guestMedics = createCrowdPoses(MEDIC_COUNT);
    for (let medic = 0; medic < MEDIC_COUNT; medic++) showRow(guestMedics, medic, 2 * medic, 0, 0, 0, ACTIVITY.kneel);
    const shared = new OpenWorldShared(CAPACITY, { bodies: null, host: null, tables: [null, null, null, guestMedics], sight: { seen: () => true }, floors: null, ports: { lookOf: () => {} } });
    shared.poseRows(throughWire(frame), BODY_KIND.medic, guestMedics, true, 10, STEP);
    for (let medic = 0; medic < MEDIC_COUNT; medic++) {
      expect(guestMedics.shown[medic], `medic ${medic} is shown`).toBe(1);
      expect(Math.abs(guestMedics.x[medic]! - (KNEEL_AT.x + 0.7 * medic)) + Math.abs(guestMedics.z[medic]! - KNEEL_AT.z), `medic ${medic}: metres from the host's`).toBeLessThan(WIRE_CM);
      expect(guestMedics.activity[medic], `medic ${medic} kneels`).toBe(ACTIVITY.kneel);
    }
    shared.poseRows(throughWire(makeBodyFrame()), BODY_KIND.medic, guestMedics, true, 11, STEP);
    expect([guestMedics.shown[0], guestMedics.shown[1]], "with no medic record none is shown").toEqual([0, 0]);
  });
});
